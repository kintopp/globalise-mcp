/**
 * Shared helpers for the DB build + ensure scripts (CODE-REVIEW finding 19).
 *
 * Both build scripts wrapped batch inserts in an identical `runInTransaction`
 * and repeated the gzip-artifact tail; both ensure scripts repeated the
 * present → download → gunzip → rebuild → warn resolution, and the reference
 * copy had silently dropped the URL-download branch and the crash-safe temp
 * write. Centralizing them here means a fix (a new `*_DB_URL`, a crash-safety
 * tweak) lands in one place.
 *
 * These run under tsx (transpile-only, outside the tsc project), so the node
 * globals used here are resolved at runtime.
 */

import { spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import type { DatabaseSync } from 'node:sqlite';

export function sizeMb(path: string): string {
  return `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Run `fn` inside a transaction. node:sqlite (unlike better-sqlite3) has no
 * .transaction() helper, so batch inserts wrap their loop manually: BEGIN, run,
 * COMMIT — rolling back and rethrowing on error. Committing once per batch
 * instead of per row keeps large inserts (the 227K-row OBP table) fast.
 */
export function runInTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Stamp a data version into the DB header (`PRAGMA user_version`).
 *
 * This is the *data* version, deliberately independent of the server's semver:
 * the DBs are rebuilt from their own sources on their own cadence, so aligning
 * them to the code version would either bump the code for a typo fix in a
 * glossary or freeze the data version across a code release. Each build script
 * owns its own counter (`DATA_VERSION`) for the same reason — reference.sqlite
 * and archival-index.sqlite change independently of each other.
 *
 * Bump the calling script's DATA_VERSION whenever a rebuild changes the shipped
 * bytes in a way a consumer should notice (new/renamed column, corrected rows,
 * refreshed source dataset). Readers can then compare `PRAGMA user_version`
 * against what they expect instead of guessing from file mtimes.
 *
 * Note the limit: this catches drift *across* a bump, not within one. A stale
 * decompressed .sqlite built from the same DATA_VERSION still reads as current,
 * so the `ensure:db` "only decompresses when absent" trap in CLAUDE.md is not
 * fixed by this — it is only made diagnosable once a bump has happened. Bump
 * conservatively (any shipped-byte change) to keep that window small.
 */
export function stampDataVersion(db: DatabaseSync, version: number): void {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`DATA_VERSION must be a non-negative integer, got ${version}`);
  }
  // PRAGMA takes a literal, not a bound parameter; the guard above keeps the
  // interpolation safe. Stamped after VACUUM so it cannot depend on VACUUM's
  // (real, but implicit) guarantee to preserve user_version.
  db.exec(`PRAGMA user_version = ${version}`);
  const readBack = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (readBack.user_version !== version) {
    throw new Error(`user_version stamp failed: wrote ${version}, read ${readBack.user_version}`);
  }
  console.log(`  Data version: ${version} (PRAGMA user_version)`);
}

/**
 * Refresh the committed deploy artifact (`${dbPath}.gz`) from the freshly-built
 * DB, so ensure-*-db.ts can ship it without rebuilding from source on every
 * deploy (R18) and the committed .gz never drifts from the DB it was built from.
 */
export async function writeGzipArtifact(dbPath: string): Promise<void> {
  const gzPath = `${dbPath}.gz`;
  console.log('\nCompressing deploy artifact...');
  await pipeline(createReadStream(dbPath), createGzip({ level: 9 }), createWriteStream(gzPath));
  console.log(`  Artifact: ${gzPath} (${sizeMb(gzPath)})`);
}

/** Write a DB through a temp file so an interrupted run never leaves a half DB. */
async function writeDb(dbPath: string, source: NodeJS.ReadableStream, gzipped: boolean): Promise<void> {
  const tmp = `${dbPath}.tmp`;
  try {
    if (gzipped) {
      await pipeline(source, createGunzip(), createWriteStream(tmp));
    } else {
      await pipeline(source, createWriteStream(tmp));
    }
    renameSync(tmp, dbPath);
  } catch (error) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw error;
  }
}

async function downloadDb(dbPath: string, url: string, token?: string): Promise<void> {
  const headers: Record<string, string> = { accept: 'application/octet-stream' };
  // Bearer token (optional) is what GitHub release assets on private repos need.
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  const gzipped = new URL(url).pathname.endsWith('.gz');
  await writeDb(dbPath, Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), gzipped);
}

export interface EnsureDbOptions {
  /** Human label for logs, e.g. "Archival" / "Reference". */
  label: string;
  dbPath: string;
  /** Committed gzipped artifact to decompress when no DB is present. */
  gzPath: string;
  /** CSV/TSV source; its presence means a full rebuild from source is possible. */
  sourcePath: string;
  /** npm script that rebuilds from source, e.g. "build:db". */
  buildScript: string;
  /** cwd for the rebuild spawn (the package root). */
  packageRoot: string;
  /** Optional env var holding a download URL (e.g. "ARCHIVAL_DB_URL"). */
  urlEnv?: string;
  /** Optional env var holding a Bearer token for the download. */
  tokenEnv?: string;
  /** Tail of the "nothing available" warning (names the degraded tool). */
  unavailableHint: string;
}

/**
 * Materialize a SQLite DB without rebuilding from source on every deploy (R18).
 *
 * Resolution order:
 *   1. dbPath already present → done
 *   2. urlEnv set → download it (gunzipped when the URL ends in .gz; tokenEnv
 *      sent as a Bearer token), written through a temp file
 *   3. committed gzPath present → gunzip
 *   4. sourcePath present → full rebuild via `npm run <buildScript>`
 *   5. none of the above → warn and return; the server degrades gracefully
 *      (databaseInfo.available: false)
 */
export async function ensureDb(opts: EnsureDbOptions): Promise<void> {
  const { label, dbPath, gzPath, sourcePath, buildScript, packageRoot, urlEnv, tokenEnv, unavailableHint } = opts;
  const lower = label.toLowerCase();

  if (existsSync(dbPath)) {
    console.log(`${label} DB present: ${dbPath} (${sizeMb(dbPath)})`);
    return;
  }

  const url = urlEnv ? process.env[urlEnv] : undefined;
  if (url) {
    console.log(`Downloading ${lower} DB from ${url} ...`);
    await downloadDb(dbPath, url, tokenEnv ? process.env[tokenEnv] : undefined);
    console.log(`Downloaded: ${dbPath} (${sizeMb(dbPath)})`);
    return;
  }

  if (existsSync(gzPath)) {
    console.log(`Decompressing committed artifact ${gzPath} (${sizeMb(gzPath)}) ...`);
    await writeDb(dbPath, createReadStream(gzPath), true);
    console.log(`Decompressed: ${dbPath} (${sizeMb(dbPath)})`);
    return;
  }

  if (existsSync(sourcePath)) {
    console.log(`No prebuilt ${lower} DB or artifact found; rebuilding from source ...`);
    const result = spawnSync('npm', ['run', buildScript], { cwd: packageRoot, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`${buildScript} exited with status ${result.status}`);
    }
    return;
  }

  console.warn(`WARNING: no ${lower} DB, no .gz artifact, no source — ${unavailableHint}`);
}
