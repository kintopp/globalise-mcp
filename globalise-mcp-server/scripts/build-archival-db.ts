/**
 * Build script for creating the archival index SQLite database from CSV sources.
 *
 * Usage: npm run build:db
 *
 * This script:
 * 1. Parses the OBP indexes CSV (~314K rows)
 * 2. Parses the Generale Missiven CSV (~950 rows)
 * 3. Creates SQLite database with FTS5 full-text search
 * 4. Creates indexes for common query patterns
 */

import { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse';
import { createReadStream, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getDatabasePath } from '../src/utils/database.js';
import { runInTransaction, stampDataVersion, writeGzipArtifact } from './db-build-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '..', 'data');
const SOURCES_DIR = join(DATA_DIR, 'sources');
// Same resolution the server uses (ARCHIVAL_DB_PATH override included), so
// the build always writes the DB where the server will look for it
const DB_PATH = getDatabasePath();

const OBP_CSV = join(SOURCES_DIR, 'obp-indexes.csv');
const GM_CSV = join(SOURCES_DIR, 'generale-missiven.csv');

// Data version stamped into the built DB (PRAGMA user_version). Independent of
// the server's semver and of reference.sqlite's counter — bump it only when a
// rebuild changes the shipped finding-aid bytes (new source release, schema
// change, corrected rows). 1 = the OBP v2 (2025) + Generale Missiven build.
// 2 = the same sources with the GM rows the source marks deleted excluded
// (see DELETED_ENTRY_RE).
const DATA_VERSION = 2;

// Batch size for inserts
const BATCH_SIZE = 5000;

type ObpRow = {
  id_csv: number;
  id_tanap: number | null;
  description: string;
  inventory_number: string;
  section: string | null;
  folio_start: number | null;
  folio_end: number | null;
  year_earliest: number | null;
  year_latest: number | null;
  settlement: string | null;
  location_tanap: string | null;
  geographical_coverage: string | null;
  document_type: string | null;
}

type GmRow = {
  id_csv: number;
  id_tanap: number | null;
  inventory_number: string;
  chamber: string | null;
  folio_start: number | null;
  folio_end: number | null;
  scan_start: number | null;
  scan_end: number | null;
  year_earliest: number | null;
  year_latest: number | null;
  description: string;
  date_display: string | null;
  date_numeric: string | null;
  scan_url_first: string | null;
  scan_url_last: string | null;
  htr_available: number;
  rgp_volume: string | null;
  rgp_page: string | null;
}

function parseIntOrNull(val: string | undefined): number | null {
  if (!val || val.trim() === '') return null;
  const parsed = parseInt(val, 10);
  return isNaN(parsed) ? null : parsed;
}

function parseStringOrNull(val: string | undefined): string | null {
  if (!val || val.trim() === '') return null;
  return val.trim();
}

async function parseObpCsv(): Promise<ObpRow[]> {
  console.log('Parsing OBP indexes CSV...');
  const rows: ObpRow[] = [];

  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
    });

    createReadStream(OBP_CSV)
      .pipe(parser)
      .on('data', (record: Record<string, string>) => {
        rows.push({
          id_csv: parseInt(record['ID'], 10),
          id_tanap: parseIntOrNull(record['ID (TANAP)']),
          description: record['DESCRIPTION'] || '',
          inventory_number: record['INVENTORY NUMBER'] || '',
          section: parseStringOrNull(record['SECTION']),
          folio_start: parseIntOrNull(record['FOLIONUMBER (START OF DOCUMENT)']),
          folio_end: parseIntOrNull(record['FOLIONUMBER (END OF DOCUMENT)']),
          year_earliest: parseIntOrNull(record['YEAR (EARLIEST)']),
          year_latest: parseIntOrNull(record['YEAR (LATEST)']),
          settlement: parseStringOrNull(record['SETTLEMENT']),
          location_tanap: parseStringOrNull(record['LOCATION (TANAP)']),
          geographical_coverage: parseStringOrNull(record['GEOGRAPHICAL COVERAGE OF INV. NUMBER']),
          document_type: parseStringOrNull(record['DOCUMENT TYPE (TANAP)']),
        });
      })
      .on('end', () => {
        console.log(`  Parsed ${rows.length} OBP rows`);
        resolve(rows);
      })
      .on('error', reject);
  });
}

/**
 * The GM source keeps deleted entries as blanked-out rows, recording the reason
 * in its manual-check column ("Dit betrof een missive die al elders in de lijst
 * geregistreerd was, en daarom is verwijderd" — a duplicate already registered
 * elsewhere). Only the ID and chamber survive on such a row.
 *
 * Ingesting them put four empty records at the head of *every* GM listing —
 * date_numeric is null, and SQLite sorts nulls first — and inflated the reported
 * gmTotal from 946 to 950. They were invisible to the test suite because an
 * empty description matches no FTS query, and every GM test went through FTS.
 */
const DELETED_ENTRY_RE = /verwijderd/i;

async function parseGmCsv(): Promise<GmRow[]> {
  console.log('Parsing Generale Missiven CSV...');
  const rows: GmRow[] = [];
  let skippedDeleted = 0;

  return new Promise((resolve, reject) => {
    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
    });

    createReadStream(GM_CSV)
      .pipe(parser)
      .on('data', (record: Record<string, string>) => {
        // Require the blank inventory number too, so a row that merely *mentions*
        // a correction in the note column is never dropped for its wording.
        const problem = record['Problemen gevonden tijdens handmatige check:'] ?? '';
        if (DELETED_ENTRY_RE.test(problem) && !record['Inv.nr. Nationaal Archief (1.04.02)']?.trim()) {
          skippedDeleted++;
          return;
        }

        const htrVal = record['HTR van IJsberg beschikbaar?'];
        const htrAvailable = htrVal?.toUpperCase() === 'TRUE' ? 1 : 0;

        rows.push({
          id_csv: parseInt(record['ID'], 10),
          id_tanap: parseIntOrNull(record['ID in TANAP database']),
          inventory_number: record['Inv.nr. Nationaal Archief (1.04.02)'] || '',
          chamber: parseStringOrNull(record['Kamer']),
          folio_start: parseIntOrNull(record['Beginfolio']),
          folio_end: parseIntOrNull(record['Eindfolio']),
          scan_start: parseIntOrNull(record['Beginscan']),
          scan_end: parseIntOrNull(record['Eindscan']),
          year_earliest: parseIntOrNull(record['Vroegste jaar']),
          year_latest: parseIntOrNull(record['Laatste jaar']),
          description: record['Beschrijving in TANAP'] || '',
          date_display: parseStringOrNull(record['Datum']),
          date_numeric: parseStringOrNull(record['Datum (numeriek)']),
          scan_url_first: parseStringOrNull(record['LINK naar eerste scan']),
          scan_url_last: parseStringOrNull(record['LINK naar laatste scan']),
          htr_available: htrAvailable,
          rgp_volume: parseStringOrNull(record['RGP Deel waarin de missive is opgenomen']),
          rgp_page: parseStringOrNull(record['RGP pagina waarop de missive begint']),
        });
      })
      .on('end', () => {
        console.log(`  Parsed ${rows.length} GM rows (skipped ${skippedDeleted} marked deleted in the source)`);
        resolve(rows);
      })
      .on('error', reject);
  });
}

function createSchema(db: DatabaseSync): void {
  console.log('Creating database schema...');

  // Plain INTEGER PRIMARY KEY (rowid alias), not AUTOINCREMENT: the DB is
  // built once and never deletes rows, so the monotonic-after-delete guarantee
  // AUTOINCREMENT provides is irrelevant — it would only add sqlite_sequence
  // bookkeeping. content_rowid='id' on the FTS tables still aliases rowid.
  db.exec(`
    CREATE TABLE IF NOT EXISTS obp_documents (
      id INTEGER PRIMARY KEY,
      id_csv INTEGER,
      id_tanap INTEGER,
      description TEXT NOT NULL,
      inventory_number TEXT NOT NULL,
      section TEXT,
      folio_start INTEGER,
      folio_end INTEGER,
      year_earliest INTEGER,
      year_latest INTEGER,
      settlement TEXT,
      location_tanap TEXT,
      geographical_coverage TEXT,
      document_type TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS generale_missiven (
      id INTEGER PRIMARY KEY,
      id_csv INTEGER,
      id_tanap INTEGER,
      inventory_number TEXT NOT NULL,
      chamber TEXT,
      folio_start INTEGER,
      folio_end INTEGER,
      scan_start INTEGER,
      scan_end INTEGER,
      year_earliest INTEGER,
      year_latest INTEGER,
      description TEXT NOT NULL,
      date_display TEXT,
      date_numeric TEXT,
      scan_url_first TEXT,
      scan_url_last TEXT,
      htr_available INTEGER DEFAULT 0,
      rgp_volume TEXT,
      rgp_page TEXT
    );
  `);

  console.log('  Tables created');
}

function insertObpData(db: DatabaseSync, rows: ObpRow[]): void {
  console.log(`Inserting ${rows.length} OBP rows...`);

  const stmt = db.prepare(`
    INSERT INTO obp_documents (
      id_csv, id_tanap, description, inventory_number, section,
      folio_start, folio_end, year_earliest, year_latest,
      settlement, location_tanap, geographical_coverage, document_type
    ) VALUES (
      @id_csv, @id_tanap, @description, @inventory_number, @section,
      @folio_start, @folio_end, @year_earliest, @year_latest,
      @settlement, @location_tanap, @geographical_coverage, @document_type
    )
  `);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    runInTransaction(db, () => {
      for (const row of batch) {
        stmt.run(row);
      }
    });

    if ((i + BATCH_SIZE) % 50000 === 0 || i + BATCH_SIZE >= rows.length) {
      console.log(`  Inserted ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length} rows`);
    }
  }
}

function insertGmData(db: DatabaseSync, rows: GmRow[]): void {
  console.log(`Inserting ${rows.length} GM rows...`);

  const stmt = db.prepare(`
    INSERT INTO generale_missiven (
      id_csv, id_tanap, inventory_number, chamber,
      folio_start, folio_end, scan_start, scan_end,
      year_earliest, year_latest, description,
      date_display, date_numeric, scan_url_first, scan_url_last,
      htr_available, rgp_volume, rgp_page
    ) VALUES (
      @id_csv, @id_tanap, @inventory_number, @chamber,
      @folio_start, @folio_end, @scan_start, @scan_end,
      @year_earliest, @year_latest, @description,
      @date_display, @date_numeric, @scan_url_first, @scan_url_last,
      @htr_available, @rgp_volume, @rgp_page
    )
  `);

  runInTransaction(db, () => {
    for (const row of rows) {
      stmt.run(row);
    }
  });

  console.log(`  Inserted ${rows.length} GM rows`);
}

function createFtsIndexes(db: DatabaseSync): void {
  console.log('Creating FTS5 full-text search indexes...');

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS obp_fts USING fts5(
      description,
      content='obp_documents',
      content_rowid='id'
    );
  `);

  db.exec(`
    INSERT INTO obp_fts(rowid, description)
    SELECT id, description FROM obp_documents;
  `);

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS gm_fts USING fts5(
      description,
      content='generale_missiven',
      content_rowid='id'
    );
  `);

  db.exec(`
    INSERT INTO gm_fts(rowid, description)
    SELECT id, description FROM generale_missiven;
  `);

  console.log('  FTS indexes created');
}

function createIndexes(db: DatabaseSync): void {
  console.log('Creating regular indexes...');

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_obp_inventory ON obp_documents(inventory_number);
    CREATE INDEX IF NOT EXISTS idx_obp_settlement ON obp_documents(settlement);
    CREATE INDEX IF NOT EXISTS idx_obp_year ON obp_documents(year_earliest, year_latest);
    CREATE INDEX IF NOT EXISTS idx_obp_folio ON obp_documents(inventory_number, folio_start, folio_end);
    -- Covers the default result ORDER BY (archival-index.ts): without it every
    -- OBP page does a full-table SCAN + TEMP B-TREE sort over all ~227K rows to
    -- return one page (~45ms at offset 0, ~456ms deep). With it the planner
    -- walks the index in order and stops after LIMIT+OFFSET (<1ms / ~4ms).
    -- Selective filters (settlement=, FTS) still prefer their own indexes.
    CREATE INDEX IF NOT EXISTS idx_obp_sort ON obp_documents(year_earliest, inventory_number, folio_start);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gm_inventory ON generale_missiven(inventory_number);
    CREATE INDEX IF NOT EXISTS idx_gm_date ON generale_missiven(date_numeric);
    CREATE INDEX IF NOT EXISTS idx_gm_chamber ON generale_missiven(chamber);
    CREATE INDEX IF NOT EXISTS idx_gm_year ON generale_missiven(year_earliest, year_latest);
  `);

  console.log('  Indexes created');
}

function optimizeDatabase(db: DatabaseSync): void {
  console.log('Optimizing database...');
  db.exec('ANALYZE');
  db.exec('VACUUM');
  console.log('  Database optimized');
  stampDataVersion(db, DATA_VERSION);
}

async function main(): Promise<void> {
  console.log('Building archival index database...\n');

  if (!existsSync(OBP_CSV)) {
    console.error(`Error: OBP CSV not found at ${OBP_CSV}`);
    process.exit(1);
  }
  if (!existsSync(GM_CSV)) {
    console.error(`Error: GM CSV not found at ${GM_CSV}`);
    process.exit(1);
  }

  if (existsSync(DB_PATH)) {
    console.log(`Removing existing database at ${DB_PATH}`);
    unlinkSync(DB_PATH);
  }

  const [obpRows, gmRows] = await Promise.all([parseObpCsv(), parseGmCsv()]);

  console.log('');

  const db = new DatabaseSync(DB_PATH);

  try {
    createSchema(db);
    insertObpData(db, obpRows);
    insertGmData(db, gmRows);
    createFtsIndexes(db);
    createIndexes(db);
    optimizeDatabase(db);

    console.log('\nDatabase built successfully!');
    console.log(`  Location: ${DB_PATH}`);

    const obpCount = db.prepare('SELECT COUNT(*) as count FROM obp_documents').get() as { count: number };
    const gmCount = db.prepare('SELECT COUNT(*) as count FROM generale_missiven').get() as { count: number };
    console.log(`  OBP documents: ${obpCount.count.toLocaleString()}`);
    console.log(`  Generale Missiven: ${gmCount.count.toLocaleString()}`);
  } finally {
    db.close();
  }

  // Refresh the deploy artifact (R18) so the committed .gz never drifts from
  // the DB it was built from — ensure-archival-db.ts decompresses it on deploy.
  await writeGzipArtifact(DB_PATH);
}

main().catch((err) => {
  console.error('Error building database:', err);
  process.exit(1);
});
