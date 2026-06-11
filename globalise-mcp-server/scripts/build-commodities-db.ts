/**
 * Build script for the reference-vocabularies SQLite database, starting with
 * the VOC commodities glossary.
 *
 * Usage: npm run build:db:commodities
 *
 * Source (committed under data/sources/):
 *   - commodities.tsv   the consolidated thesaurus: bilingual labels, spelling
 *                       variants, and definitions with provenance + confidence.
 *
 * The glossary ships FLAT. The source offered two classifications — an
 * LLM-assigned `class` column and a SKOS `skos:broader` hierarchy — but both
 * were judged too unreliable to surface (the LLM classes misclassify; the SKOS
 * tree is hollow, 65% of concepts hanging off a "NOT YET CLASSIFIED"
 * placeholder), so neither is used. The abandoned `class`/`class_Source`
 * columns have been dropped from the committed TSV; the SKOS tree is left in
 * the gitignored .trig export. See CHANGELOG 2.7.0.
 *
 * Produces data/reference.sqlite (+ a gzipped deploy artifact), with a
 * `commodities` table and an FTS5 index over labels/variants/definition. The
 * PoolParty UUID is stored as an internal key only — never surfaced by the tool
 * (the PoolParty links are not publicly resolvable).
 */

import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse';
import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { getReferenceDatabasePath } from '../src/utils/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'data');
const SOURCES_DIR = join(DATA_DIR, 'sources');
const DB_PATH = getReferenceDatabasePath();

const COMMODITIES_TSV = join(SOURCES_DIR, 'commodities.tsv');

const BATCH_SIZE = 1000;

type CommodityRow = {
  uuid: string;
  pref_nl: string | null;
  pref_en: string | null;
  alt_labels: string | null;
  definition: string;
  definition_language: string | null;
  definition_source: string | null;
  definition_source_desc: string | null;
  confidence: string | null;
  definition_source_url: string | null;
};

function strOrNull(val: string | undefined): string | null {
  if (val === undefined) return null;
  const trimmed = val.trim();
  return trimmed === '' ? null : trimmed;
}

async function parseCommoditiesTsv(): Promise<CommodityRow[]> {
  console.log('Parsing commodities TSV...');
  const rows: CommodityRow[] = [];

  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      delimiter: '\t',
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      // Definitions contain stray quote characters; treat the TSV as plain
      // tab-delimited text rather than RFC-4180 quoted fields.
      quote: false,
    });

    createReadStream(COMMODITIES_TSV)
      .pipe(parser)
      .on('data', (record: Record<string, string>) => {
        const uuid = (record['id'] || '').trim();
        if (!uuid) return; // skip any blank-id row
        rows.push({
          uuid,
          pref_nl: strOrNull(record['prefLabel_nl']),
          pref_en: strOrNull(record['prefLabel_en']),
          alt_labels: strOrNull(record['altLabels']),
          definition: record['definition'] || '',
          definition_language: strOrNull(record['definitionLanguage']),
          definition_source: strOrNull(record['definitionSource']),
          definition_source_desc: strOrNull(record['definitionSource_desc']),
          confidence: strOrNull(record['confidence']),
          definition_source_url: strOrNull(record['definitionSource_url']),
        });
      })
      .on('end', () => {
        console.log(`  Parsed ${rows.length} commodity rows`);
        resolve(rows);
      })
      .on('error', reject);
  });
}

function runInTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function createSchema(db: DatabaseSync): void {
  console.log('Creating schema...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS commodities (
      id INTEGER PRIMARY KEY,
      uuid TEXT NOT NULL,
      pref_nl TEXT,
      pref_en TEXT,
      alt_labels TEXT,
      definition TEXT NOT NULL,
      definition_language TEXT,
      definition_source TEXT,
      definition_source_desc TEXT,
      confidence TEXT,
      definition_source_url TEXT
    );
  `);
  console.log('  Table created');
}

function insertData(db: DatabaseSync, rows: CommodityRow[]): void {
  console.log(`Inserting ${rows.length} rows...`);
  const stmt = db.prepare(`
    INSERT INTO commodities (
      uuid, pref_nl, pref_en, alt_labels,
      definition, definition_language, definition_source,
      definition_source_desc, confidence, definition_source_url
    ) VALUES (
      @uuid, @pref_nl, @pref_en, @alt_labels,
      @definition, @definition_language, @definition_source,
      @definition_source_desc, @confidence, @definition_source_url
    )
  `);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    runInTransaction(db, () => {
      for (const row of batch) {
        stmt.run(row);
      }
    });
  }
  console.log(`  Inserted ${rows.length} rows`);
}

function createFtsIndex(db: DatabaseSync): void {
  console.log('Creating FTS5 index...');
  // External-content FTS5 over the searchable text columns. Column order is
  // load-bearing: the tool's bm25() weights reference these positions to rank
  // label/variant hits above definition-body hits.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS commodities_fts USING fts5(
      pref_nl, pref_en, alt_labels, definition,
      content='commodities',
      content_rowid='id'
    );
  `);
  db.exec(`
    INSERT INTO commodities_fts(rowid, pref_nl, pref_en, alt_labels, definition)
    SELECT id, pref_nl, pref_en, alt_labels, definition FROM commodities;
  `);
  console.log('  FTS index created');
}

function createIndexes(db: DatabaseSync): void {
  console.log('Creating regular indexes...');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_commodities_uuid ON commodities(uuid);`);
  console.log('  Indexes created');
}

async function main(): Promise<void> {
  console.log('Building reference (commodities) database...\n');

  if (!existsSync(COMMODITIES_TSV)) {
    console.error(`Error: commodities TSV not found at ${COMMODITIES_TSV}`);
    process.exit(1);
  }

  if (existsSync(DB_PATH)) {
    console.log(`Removing existing database at ${DB_PATH}`);
    unlinkSync(DB_PATH);
  }

  const rows = await parseCommoditiesTsv();

  console.log('');
  const db = new DatabaseSync(DB_PATH);
  try {
    createSchema(db);
    insertData(db, rows);
    createFtsIndex(db);
    createIndexes(db);
    console.log('Optimizing database...');
    db.exec('ANALYZE');
    db.exec('VACUUM');

    const total = db.prepare('SELECT COUNT(*) as c FROM commodities').get() as { c: number };
    console.log('\nDatabase built successfully!');
    console.log(`  Location: ${DB_PATH}`);
    console.log(`  Commodities: ${total.c.toLocaleString()}`);
  } finally {
    db.close();
  }

  // Refresh the committed deploy artifact so ensure-reference-db.ts can ship
  // the DB without rebuilding from source on every deploy.
  const gzPath = `${DB_PATH}.gz`;
  console.log('\nCompressing deploy artifact...');
  await pipeline(createReadStream(DB_PATH), createGzip({ level: 9 }), createWriteStream(gzPath));
  console.log(`  Artifact: ${gzPath} (${(statSync(gzPath).size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error('Error building database:', err);
  process.exit(1);
});
