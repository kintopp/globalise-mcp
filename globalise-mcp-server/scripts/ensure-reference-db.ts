/**
 * Ensure data/reference.sqlite exists — without rebuilding it from source on
 * every deploy. Runs as part of `npm run ensure:db` (after the archival DB);
 * there is no standalone npm script for just this step.
 *
 * Shares ensureDb() (db-build-utils.ts) with the archival DB (CODE-REVIEW
 * finding 19), so it now gets the REFERENCE_DB_URL download branch and the
 * crash-safe temp-write the hand-forked copy had dropped.
 *
 * Usage: npm run ensure:db
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReferenceDatabasePath } from '../src/utils/database.js';
import { ensureDb } from './db-build-utils.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

ensureDb({
  label: 'Reference',
  dbPath: getReferenceDatabasePath(),
  gzPath: join(PACKAGE_ROOT, 'data', 'reference.sqlite.gz'),
  sourcePath: join(PACKAGE_ROOT, 'data', 'sources', 'commodities.tsv'),
  buildScript: 'build:db:commodities',
  packageRoot: PACKAGE_ROOT,
  urlEnv: 'REFERENCE_DB_URL',
  tokenEnv: 'REFERENCE_DB_TOKEN',
  unavailableHint: 'globalise_lookup_commodity will report databaseInfo.available: false',
}).catch((error) => {
  console.error('ensure-reference-db failed:', error);
  process.exit(1);
});
