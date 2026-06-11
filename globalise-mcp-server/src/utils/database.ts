/**
 * SQLite database wrapper for archival index data.
 * Provides lazy initialization with read-only mode for querying
 * pre-built archival index databases.
 *
 * Uses Node's built-in `node:sqlite` (stable, no flag on Node 24) rather than
 * the native better-sqlite3 addon, so the server is pure JS — a prerequisite
 * for packaging as an .mcpb bundle that runs on Claude Desktop's Node 24.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

/**
 * Driver type aliases re-exported from the wrapper. Consumers reference these
 * instead of importing from `node:sqlite` directly, so the concrete driver is
 * named in exactly one runtime file and a future driver swap stays one-file.
 */
export type Db = DatabaseSync;
export type DbStatement = StatementSync;

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database file location - can be overridden by environment variable
const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'data', 'archival-index.sqlite');
const DB_PATH = process.env.ARCHIVAL_DB_PATH || DEFAULT_DB_PATH;

// Reference vocabularies (commodities thesaurus, and weights & measures later)
// live in a separate, small SQLite file from the large archival index, so each
// can be built, shipped, and degraded independently. Overridable for tests.
const DEFAULT_REFERENCE_DB_PATH = join(__dirname, '..', '..', 'data', 'reference.sqlite');
const REFERENCE_DB_PATH = process.env.REFERENCE_DB_PATH || DEFAULT_REFERENCE_DB_PATH;

// Lazy-initialized database instances
let db: Db | null = null;
let referenceDb: Db | null = null;

/**
 * Get the SQLite database connection.
 * Creates the connection on first call (lazy initialization).
 * Opens in read-only mode with optimized settings for queries.
 *
 * @throws Error if database file doesn't exist
 */
export function getDatabase(): Db {
  if (db) {
    return db;
  }

  if (!existsSync(DB_PATH)) {
    throw new Error(
      `Archival index database not found at ${DB_PATH}. ` +
      `Run 'npm run build:db' to build the database from CSV sources.`
    );
  }

  // existsSync above already guards the missing-file case, so we don't need
  // better-sqlite3's fileMustExist; node:sqlite opens (open defaults to true).
  db = new DatabaseSync(DB_PATH, { readOnly: true });

  // Optimize for read-only queries (only set pragmas that don't require write
  // access). node:sqlite has no .pragma() helper, so issue them via exec().
  db.exec('PRAGMA cache_size = -64000'); // 64MB cache
  db.exec('PRAGMA temp_store = MEMORY');
  // Memory-map the (read-only, ~108MB) DB so cold-page reads skip read()
  // syscalls. 256MB ceiling comfortably covers the whole file; safe on a
  // read-only connection.
  db.exec('PRAGMA mmap_size = 268435456');

  return db;
}

/**
 * Check if the archival index database exists and is accessible.
 */
export function isDatabaseAvailable(): boolean {
  try {
    getDatabase();
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the reference-vocabularies database connection (commodities thesaurus).
 * Lazy, read-only, mirrors getDatabase(). This DB is small (a few MB), so it
 * skips the archival DB's large mmap/cache pragmas.
 *
 * @throws Error if the database file doesn't exist
 */
export function getReferenceDatabase(): Db {
  if (referenceDb) {
    return referenceDb;
  }

  if (!existsSync(REFERENCE_DB_PATH)) {
    throw new Error(
      `Reference database not found at ${REFERENCE_DB_PATH}. ` +
      `Run 'npm run build:db:commodities' to build it from source.`
    );
  }

  referenceDb = new DatabaseSync(REFERENCE_DB_PATH, { readOnly: true });
  referenceDb.exec('PRAGMA cache_size = -16000'); // 16MB cache
  referenceDb.exec('PRAGMA temp_store = MEMORY');

  return referenceDb;
}

/**
 * Check if the reference database exists and is accessible.
 */
export function isReferenceDatabaseAvailable(): boolean {
  try {
    getReferenceDatabase();
    return true;
  } catch {
    return false;
  }
}

/**
 * Close any open database connections.
 * Useful for cleanup in tests or graceful shutdown.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
  if (referenceDb) {
    referenceDb.close();
    referenceDb = null;
  }
}

/**
 * Get the path to the archival index database file.
 */
export function getDatabasePath(): string {
  return DB_PATH;
}

/**
 * Get the path to the reference-vocabularies database file.
 */
export function getReferenceDatabasePath(): string {
  return REFERENCE_DB_PATH;
}
