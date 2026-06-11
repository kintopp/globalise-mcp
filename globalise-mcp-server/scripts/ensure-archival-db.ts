/**
 * Ensure data/archival-index.sqlite exists — without rebuilding it from CSV on
 * every deploy (R18). Runs as the first step of `npm run ensure:db`.
 *
 * The resolution order (present → ARCHIVAL_DB_URL download → committed .gz →
 * CSV rebuild → warn) and the crash-safe temp-write live in ensureDb()
 * (db-build-utils.ts), shared with the reference DB (CODE-REVIEW finding 19).
 *
 * Usage: npm run ensure:db
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabasePath } from '../src/utils/database.js';
import { ensureDb } from './db-build-utils.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

ensureDb({
  label: 'Archival',
  // Same resolution the server uses (ARCHIVAL_DB_PATH override included), so
  // this always materializes the DB where the server will look for it.
  dbPath: getDatabasePath(),
  gzPath: join(PACKAGE_ROOT, 'data', 'archival-index.sqlite.gz'),
  sourcePath: join(PACKAGE_ROOT, 'data', 'sources', 'obp-indexes.csv'),
  buildScript: 'build:db',
  packageRoot: PACKAGE_ROOT,
  urlEnv: 'ARCHIVAL_DB_URL',
  tokenEnv: 'ARCHIVAL_DB_TOKEN',
  unavailableHint: 'globalise_find_archival_documents will report databaseInfo.available: false',
}).catch((error) => {
  console.error('ensure-archival-db failed:', error);
  process.exit(1);
});
