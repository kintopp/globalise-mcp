/**
 * Ensure data/reference.sqlite exists — without rebuilding it from source on
 * every deploy. Runs as part of `npm run ensure:db` (after the archival DB).
 *
 * Resolution order:
 *   1. data/reference.sqlite already present → done
 *   2. committed artifact data/reference.sqlite.gz present → gunzip
 *   3. TSV sources present → full rebuild via `npm run build:db:commodities`
 *   4. none of the above → warn and exit 0; the server degrades gracefully
 *      (globalise_lookup_commodity reports databaseInfo.available: false)
 *
 * Usage: npm run ensure:db:commodities
 */

import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { getReferenceDatabasePath } from '../src/utils/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const DATA_DIR = join(PACKAGE_ROOT, 'data');
const DB_PATH = getReferenceDatabasePath();
const GZ_PATH = join(DATA_DIR, 'reference.sqlite.gz');
const TSV_PATH = join(DATA_DIR, 'sources', 'commodities.tsv');
const TMP_PATH = `${DB_PATH}.tmp`;

function sizeMb(path: string): string {
  return `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
}

/** Write through a temp file so an interrupted run never leaves a half DB. */
async function gunzipTo(source: NodeJS.ReadableStream): Promise<void> {
  try {
    await pipeline(source, createGunzip(), createWriteStream(TMP_PATH));
    renameSync(TMP_PATH, DB_PATH);
  } catch (error) {
    if (existsSync(TMP_PATH)) unlinkSync(TMP_PATH);
    throw error;
  }
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) {
    console.log(`Reference DB present: ${DB_PATH} (${sizeMb(DB_PATH)})`);
    return;
  }

  if (existsSync(GZ_PATH)) {
    console.log(`Decompressing committed artifact ${GZ_PATH} (${sizeMb(GZ_PATH)}) ...`);
    await gunzipTo(createReadStream(GZ_PATH));
    console.log(`Decompressed: ${DB_PATH} (${sizeMb(DB_PATH)})`);
    return;
  }

  if (existsSync(TSV_PATH)) {
    console.log('No prebuilt reference DB or artifact found; rebuilding from TSV sources ...');
    const result = spawnSync('npm', ['run', 'build:db:commodities'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`build:db:commodities exited with status ${result.status}`);
    }
    return;
  }

  console.warn(
    'WARNING: no reference DB, no .gz artifact, no TSV sources — ' +
    'globalise_lookup_commodity will report databaseInfo.available: false',
  );
}

main().catch((error) => {
  console.error('ensure-reference-db failed:', error);
  process.exit(1);
});
