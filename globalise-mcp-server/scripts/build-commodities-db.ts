/**
 * Build script for the reference-vocabularies SQLite database. It builds the
 * WHOLE reference DB in one run — the VOC commodities glossary and the VOC
 * weights & measures glossary — because both tools read the single shared
 * `data/reference.sqlite` file and the build deletes-and-recreates it (there is
 * no incremental "add a table" path; a schema change to either vocabulary must
 * rebuild both and regenerate the .gz). The npm script keeps its historical
 * name `build:db:commodities` (the ensure-flow and docs reference it; a rename
 * to build:db:reference is deferred — see plan 004 Maintenance notes).
 *
 * Usage: npm run build:db:commodities
 *
 * Sources (committed under data/sources/):
 *   - commodities.tsv          the consolidated thesaurus: bilingual labels,
 *                              spelling variants, and definitions with
 *                              provenance + confidence.
 *   - weights-measures.json    the GLOBALISE W&M dataset (v3.0; 213 units, 385
 *                              spelling variants, 731 period-reported conversion
 *                              relationships; hdl:10622/MDNVH5, CC-BY-SA-4.0).
 *
 * The commodities glossary ships FLAT. The source offered two classifications —
 * an LLM-assigned `class` column and a SKOS `skos:broader` hierarchy — but both
 * were judged too unreliable to surface (the LLM classes misclassify; the SKOS
 * tree is hollow, 65% of concepts hanging off a "NOT YET CLASSIFIED"
 * placeholder), so neither is used. The abandoned `class`/`class_Source`
 * columns have been dropped from the committed TSV; the SKOS tree is left in
 * the gitignored .trig export. See CHANGELOG 2.7.0.
 *
 * The weights & measures glossary ships AS-IS (no filtering): the 22
 * self-referential conversions (from === to) and the few exact-duplicate rows
 * are KEPT — they are incomplete attestations, not errors (CHANGELOG 2.8.0 /
 * Editorial-decisions rule). The only transforms are structural: '; '-joining
 * the spelling variants (the convention commodities.alt_labels uses) and
 * JSON-serializing the per-unit definitions array.
 *
 * Produces data/reference.sqlite (+ a gzipped deploy artifact). The commodities
 * `uuid` column holds the original PoolParty concept URI: that URI is not
 * publicly resolvable, but its trailing UUID was preserved on the vocabulary's
 * public Skosmos home, so the lookup tool derives a stable handle permalink from
 * it (see src/tools/commodities.ts) — the build itself stores only the key. The
 * measures `unit_id` (e.g. "SU_0003") is an internal key, never surfaced.
 */

import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse';
import { createReadStream, existsSync, readFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getReferenceDatabasePath } from '../src/utils/database.js';
import { runInTransaction, stampDataVersion, writeGzipArtifact } from './db-build-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'data');
const SOURCES_DIR = join(DATA_DIR, 'sources');
const DB_PATH = getReferenceDatabasePath();

const COMMODITIES_TSV = join(SOURCES_DIR, 'commodities.tsv');
const MEASURES_JSON = join(SOURCES_DIR, 'weights-measures.json');

// Data version stamped into the built DB (PRAGMA user_version). Independent of
// the server's semver and of archival-index.sqlite's counter — bump it whenever
// a rebuild changes the shipped glossary bytes (corrected definitions, a new
// thesaurus release, schema change). 1 = the post-RFC-4180-parser-fix build.
const DATA_VERSION = 1;

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
      // The TSV is RFC-4180: fields containing a comma are wrapped in "…" and
      // internal quotes are doubled (""). Decode that structure rather than
      // importing the quotes as literal text. (escape defaults to '"', so ""→".)
      quote: '"',
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

// ============================================================================
// Weights & measures (second vocabulary in the shared reference DB)
// ============================================================================

/** Shape of weights-measures.json (v3.0). */
interface MeasuresSource {
  _meta: {
    units_count: number;
    variants_count: number;
    conversions_count: number;
    [k: string]: unknown;
  };
  units: Record<string, { label: string; type?: string; definitions?: Array<{ nl?: string; en?: string }> }>;
  lookup: Record<string, string>;
  conversions: Array<{ from: string; to: string; ratio: string; context?: string }>;
}

// `type` aliases (not interfaces) so they satisfy stmt.run()'s
// Record<string, SQLInputValue> param — an interface lacks the implicit index
// signature a type-aliased object literal has. Mirrors CommodityRow above.
type MeasureRow = {
  unit_id: string;
  label: string;
  type: string | null;
  variants: string | null;
  definitions: string;
  def_text: string | null;
};

type ConversionRow = {
  from_unit: string;
  to_unit: string;
  ratio: string;
  context: string | null;
};

/**
 * Read weights-measures.json and produce the rows to insert, enforcing the
 * data-integrity gates as hard failures (Editorial rule: never silently drop
 * source rows). Transforms are structural only: invert the lookup map into a
 * '; '-joined variants column (sorted for determinism — the lowercased label
 * itself appears among its variants, and that is KEPT), and JSON-serialize the
 * per-unit definitions array.
 */
function parseMeasures(): { units: MeasureRow[]; conversions: ConversionRow[]; variantCount: number } {
  console.log('Parsing weights & measures JSON...');
  const data = JSON.parse(readFileSync(MEASURES_JSON, 'utf-8')) as MeasuresSource;

  // Gate 1: every lookup value (variant → unit id) must resolve to a unit.
  // Gate 2: every conversion endpoint must resolve to a unit.
  const variantsByUnit = new Map<string, string[]>();
  let variantCount = 0;
  for (const [variant, unitId] of Object.entries(data.lookup)) {
    if (typeof unitId !== 'string') {
      throw new Error(`Measures integrity: lookup value for "${variant}" is not a string (got ${typeof unitId}).`);
    }
    if (!data.units[unitId]) {
      throw new Error(`Measures integrity: lookup variant "${variant}" points to unknown unit "${unitId}".`);
    }
    let arr = variantsByUnit.get(unitId);
    if (arr === undefined) {
      arr = [];
      variantsByUnit.set(unitId, arr);
    }
    arr.push(variant);
    variantCount++;
  }

  const units: MeasureRow[] = [];
  for (const [unitId, unit] of Object.entries(data.units)) {
    const variants = variantsByUnit.get(unitId);
    const defs = Array.isArray(unit.definitions) ? unit.definitions : [];
    // def_text is FTS fodder only: every nl/en string in the definitions array,
    // newline-joined. null when the unit has no definition text (most units).
    const defStrings: string[] = [];
    for (const def of defs) {
      if (def.nl) defStrings.push(def.nl);
      if (def.en) defStrings.push(def.en);
    }
    units.push({
      unit_id: unitId,
      label: unit.label,
      type: unit.type ?? null,
      variants: variants && variants.length ? [...variants].sort((a, b) => a.localeCompare(b)).join('; ') : null,
      definitions: JSON.stringify(defs),
      def_text: defStrings.length ? defStrings.join('\n') : null,
    });
  }

  const conversions: ConversionRow[] = [];
  for (const c of data.conversions) {
    if (!c.ratio) {
      throw new Error(`Measures integrity: conversion ${JSON.stringify(c)} is missing a ratio.`);
    }
    if (!data.units[c.from] || !data.units[c.to]) {
      throw new Error(`Measures integrity: conversion references unknown unit(s): from="${c.from}" to="${c.to}".`);
    }
    conversions.push({
      from_unit: c.from,
      to_unit: c.to,
      ratio: c.ratio,
      context: c.context ?? null,
    });
  }

  // Gate 3: actual counts must agree with the dataset's self-reported _meta.
  if (units.length !== data._meta.units_count) {
    throw new Error(`Measures integrity: parsed ${units.length} units but _meta.units_count = ${data._meta.units_count}.`);
  }
  if (variantCount !== data._meta.variants_count) {
    throw new Error(`Measures integrity: parsed ${variantCount} variants but _meta.variants_count = ${data._meta.variants_count}.`);
  }
  if (conversions.length !== data._meta.conversions_count) {
    throw new Error(`Measures integrity: parsed ${conversions.length} conversions but _meta.conversions_count = ${data._meta.conversions_count}.`);
  }

  console.log(`  Parsed ${units.length} units, ${variantCount} variants, ${conversions.length} conversions`);
  return { units, conversions, variantCount };
}

function createMeasuresSchema(db: DatabaseSync): void {
  console.log('Creating measures schema...');
  db.exec(`
    CREATE TABLE IF NOT EXISTS measures (
      id INTEGER PRIMARY KEY,
      unit_id TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      type TEXT,
      variants TEXT,
      definitions TEXT NOT NULL,
      def_text TEXT
    );
    CREATE TABLE IF NOT EXISTS measure_conversions (
      id INTEGER PRIMARY KEY,
      from_unit TEXT NOT NULL,
      to_unit TEXT NOT NULL,
      ratio TEXT NOT NULL,
      context TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_conversions_from ON measure_conversions(from_unit);
    CREATE INDEX IF NOT EXISTS idx_conversions_to ON measure_conversions(to_unit);
  `);
  console.log('  Measures tables created');
}

function insertMeasures(db: DatabaseSync, units: MeasureRow[], conversions: ConversionRow[]): void {
  console.log(`Inserting ${units.length} units and ${conversions.length} conversions...`);
  const unitStmt = db.prepare(`
    INSERT INTO measures (unit_id, label, type, variants, definitions, def_text)
    VALUES (@unit_id, @label, @type, @variants, @definitions, @def_text)
  `);
  for (let i = 0; i < units.length; i += BATCH_SIZE) {
    const batch = units.slice(i, i + BATCH_SIZE);
    runInTransaction(db, () => {
      for (const row of batch) unitStmt.run(row);
    });
  }
  const convStmt = db.prepare(`
    INSERT INTO measure_conversions (from_unit, to_unit, ratio, context)
    VALUES (@from_unit, @to_unit, @ratio, @context)
  `);
  for (let i = 0; i < conversions.length; i += BATCH_SIZE) {
    const batch = conversions.slice(i, i + BATCH_SIZE);
    runInTransaction(db, () => {
      for (const row of batch) convStmt.run(row);
    });
  }
  console.log(`  Inserted ${units.length} units, ${conversions.length} conversions`);
}

function createMeasuresFtsIndex(db: DatabaseSync): void {
  console.log('Creating measures FTS5 index...');
  // External-content FTS5. Column order is load-bearing: the tool's bm25()
  // weights reference these positions (label > variants > definition text).
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS measures_fts USING fts5(
      label, variants, def_text,
      content='measures',
      content_rowid='id'
    );
  `);
  db.exec(`
    INSERT INTO measures_fts(rowid, label, variants, def_text)
    SELECT id, label, variants, def_text FROM measures;
  `);
  console.log('  Measures FTS index created');
}

async function main(): Promise<void> {
  console.log('Building reference database (commodities + weights & measures)...\n');

  if (!existsSync(COMMODITIES_TSV)) {
    console.error(`Error: commodities TSV not found at ${COMMODITIES_TSV}`);
    process.exit(1);
  }
  if (!existsSync(MEASURES_JSON)) {
    console.error(`Error: weights & measures JSON not found at ${MEASURES_JSON}`);
    process.exit(1);
  }

  if (existsSync(DB_PATH)) {
    console.log(`Removing existing database at ${DB_PATH}`);
    unlinkSync(DB_PATH);
  }

  const rows = await parseCommoditiesTsv();
  const measures = parseMeasures();

  console.log('');
  const db = new DatabaseSync(DB_PATH);
  try {
    createSchema(db);
    insertData(db, rows);
    createFtsIndex(db);
    createIndexes(db);

    createMeasuresSchema(db);
    insertMeasures(db, measures.units, measures.conversions);
    createMeasuresFtsIndex(db);

    console.log('Optimizing database...');
    db.exec('ANALYZE');
    db.exec('VACUUM');
    stampDataVersion(db, DATA_VERSION);

    const total = db.prepare('SELECT COUNT(*) as c FROM commodities').get() as { c: number };
    const measuresTotal = db.prepare('SELECT COUNT(*) as c FROM measures').get() as { c: number };
    const conversionsTotal = db.prepare('SELECT COUNT(*) as c FROM measure_conversions').get() as { c: number };
    console.log('\nDatabase built successfully!');
    console.log(`  Location: ${DB_PATH}`);
    console.log(`  Commodities: ${total.c.toLocaleString()}`);
    console.log(`  Measures: ${measuresTotal.c.toLocaleString()} units, ${measures.variantCount.toLocaleString()} variants, ${conversionsTotal.c.toLocaleString()} conversions`);
  } finally {
    db.close();
  }

  // Refresh the committed deploy artifact so ensure-reference-db.ts can ship
  // the DB without rebuilding from source on every deploy.
  await writeGzipArtifact(DB_PATH);
}

main().catch((err) => {
  console.error('Error building database:', err);
  process.exit(1);
});
