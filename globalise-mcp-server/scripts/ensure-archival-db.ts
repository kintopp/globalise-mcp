/**
 * Ensure data/archival-index.sqlite exists — without rebuilding it from CSV
 * on every deploy (R18). Runs as the last step of `npm run build`.
 *
 * Resolution order:
 *   1. data/archival-index.sqlite already present → done
 *   2. ARCHIVAL_DB_URL set → download it (gunzipped when the URL ends in
 *      .gz; optional ARCHIVAL_DB_TOKEN sent as a Bearer token with
 *      Accept: application/octet-stream, which is what GitHub release
 *      assets on private repos require)
 *   3. committed artifact data/archival-index.sqlite.gz present → gunzip
 *   4. CSV sources present → full rebuild via `npm run build:db`
 *   5. none of the above → warn and exit 0; the server degrades gracefully
 *      (databaseInfo.available: false)
 *
 * Usage: npm run ensure:db
 */

import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { getDatabasePath } from '../src/utils/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const DATA_DIR = join(PACKAGE_ROOT, 'data');
// Same resolution the server uses (ARCHIVAL_DB_PATH override included), so
// this script always materializes the DB where the server will look for it
const DB_PATH = getDatabasePath();
const GZ_PATH = join(DATA_DIR, 'archival-index.sqlite.gz');
const CSV_PATH = join(DATA_DIR, 'sources', 'obp-indexes.csv');
const TMP_PATH = `${DB_PATH}.tmp`;

function sizeMb(path: string): string {
  return `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
}

/** Write through a temp file so an interrupted run never leaves a half DB. */
async function writeDb(source: NodeJS.ReadableStream, gzipped: boolean): Promise<void> {
  try {
    if (gzipped) {
      await pipeline(source, createGunzip(), createWriteStream(TMP_PATH));
    } else {
      await pipeline(source, createWriteStream(TMP_PATH));
    }
    renameSync(TMP_PATH, DB_PATH);
  } catch (error) {
    if (existsSync(TMP_PATH)) unlinkSync(TMP_PATH);
    throw error;
  }
}

async function downloadDb(url: string): Promise<void> {
  const headers: Record<string, string> = { accept: 'application/octet-stream' };
  if (process.env.ARCHIVAL_DB_TOKEN) {
    headers.authorization = `Bearer ${process.env.ARCHIVAL_DB_TOKEN}`;
  }

  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const gzipped = new URL(url).pathname.endsWith('.gz');
  await writeDb(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), gzipped);
}

async function main(): Promise<void> {
  if (existsSync(DB_PATH)) {
    console.log(`Archival DB present: ${DB_PATH} (${sizeMb(DB_PATH)})`);
    return;
  }

  const url = process.env.ARCHIVAL_DB_URL;
  if (url) {
    console.log(`Downloading archival DB from ${url} ...`);
    await downloadDb(url);
    console.log(`Downloaded: ${DB_PATH} (${sizeMb(DB_PATH)})`);
    return;
  }

  if (existsSync(GZ_PATH)) {
    console.log(`Decompressing committed artifact ${GZ_PATH} (${sizeMb(GZ_PATH)}) ...`);
    await writeDb(createReadStream(GZ_PATH), true);
    console.log(`Decompressed: ${DB_PATH} (${sizeMb(DB_PATH)})`);
    return;
  }

  if (existsSync(CSV_PATH)) {
    console.log('No prebuilt DB or artifact found; rebuilding from CSV sources ...');
    const result = spawnSync('npm', ['run', 'build:db'], { cwd: PACKAGE_ROOT, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`build:db exited with status ${result.status}`);
    }
    return;
  }

  console.warn(
    'WARNING: no archival DB, no .gz artifact, no CSV sources — ' +
    'globalise_find_archival_documents will report databaseInfo.available: false',
  );
}

main().catch((error) => {
  console.error('ensure-archival-db failed:', error);
  process.exit(1);
});
