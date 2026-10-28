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
import { formatMb, readDataVersion } from '../src/utils/database.js';

/** "111.6 MB" for a file on disk. Also used by the .mcpb build/test scripts. */
export function sizeMb(path: string): string {
  return `${formatMb(statSync(path).size)} MB`;
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
 * glossary or freeze the data version across a code release. The counters
 * (`ARCHIVAL_DATA_VERSION`, `REFERENCE_DATA_VERSION`) live in
 * `src/utils/database.ts`; reference.sqlite and archival-index.sqlite change
 * independently of each other.
 *
 * Bump the counter whenever a rebuild changes the shipped bytes in a way a
 * consumer should notice (new/renamed column, corrected rows, refreshed source
 * dataset). `ensure:db` compares `PRAGMA user_version` against the expected
 * value and rematerialises a local DB that differs, or whose `.gz` is newer.
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

/** What `writeDb` verifies before a new file replaces the old one. */
interface DbCheck {
  label: string;
  /** Where the bytes came from (URL, .gz path or build command), for the error. */
  from: string;
  expectedVersion: number;
  buildScript: string;
}

function assertDataVersion(path: string, c: DbCheck): void {
  const v = readDataVersion(path);
  if (v !== c.expectedVersion) {
    throw new Error(
      `${c.label} DB from ${c.from} has data version ${v ?? 'unreadable'}, expected ${c.expectedVersion}. ` +
      `Rebuild with npm run ${c.buildScript} and commit the regenerated .gz`,
    );
  }
}

/**
 * Write a DB through a temp file so an interrupted run never leaves a half DB,
 * and verify its data version before the rename so a bad artifact never
 * replaces a good file.
 */
async function writeDb(dbPath: string, source: NodeJS.ReadableStream, gzipped: boolean, c: DbCheck): Promise<void> {
  const tmp = `${dbPath}.tmp`;
  try {
    if (gzipped) {
      await pipeline(source, createGunzip(), createWriteStream(tmp));
    } else {
      await pipeline(source, createWriteStream(tmp));
    }
    assertDataVersion(tmp, c);
    renameSync(tmp, dbPath);
  } catch (error) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw error;
  }
}

/** Total budget for one download in a build step (the runtime uses an idle timeout instead). */
const BUILD_DOWNLOAD_TIMEOUT_MS = 600_000;

async function downloadDb(dbPath: string, url: string, check: DbCheck, token?: string): Promise<void> {
  const headers: Record<string, string> = { accept: 'application/octet-stream' };
  // Bearer token (optional) is what GitHub release assets on private repos need.
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(BUILD_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  // Sniff the magic bytes: GitHub API asset URLs serve gzip with no .gz suffix.
  const reader = response.body.getReader();
  const first = await reader.read();
  const head = first.value;
  const gzipped = !!head && head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;
  async function* chunks(): AsyncGenerator<Uint8Array> {
    if (head) yield head;
    for (let r = await reader.read(); !r.done; r = await reader.read()) yield r.value;
  }
  try {
    await writeDb(dbPath, Readable.from(chunks()), gzipped, check);
  } finally {
    reader.cancel().catch(() => {});
  }
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
  /** `PRAGMA user_version` the DB must carry (`*_DATA_VERSION` in src/utils/database.ts). */
  expectedVersion: number;
  /** Tail of the "nothing available" warning (names the degraded tool). */
  unavailableHint: string;
}

/**
 * Materialize a SQLite DB without rebuilding from source on every deploy (R18).
 *
 * Resolution order:
 *   1. dbPath present, at expectedVersion and not older than gzPath → done
 *      (otherwise it is rematerialised through the steps below)
 *   2. urlEnv set → download it (gzip detected by magic bytes; tokenEnv sent
 *      as a Bearer token), written through a temp file
 *   3. committed gzPath present → gunzip
 *   4. sourcePath present → full rebuild via `npm run <buildScript>`
 *   5. none of the above → warn and return; the server degrades gracefully
 *      (databaseInfo.available: false)
 *
 * Steps 2–4 throw if the result's data version is not expectedVersion.
 */
export async function ensureDb(opts: EnsureDbOptions): Promise<void> {
  const { label, dbPath, gzPath, sourcePath, buildScript, packageRoot, urlEnv, tokenEnv, expectedVersion, unavailableHint } = opts;
  const lower = label.toLowerCase();

  if (existsSync(dbPath)) {
    const v = readDataVersion(dbPath);
    if (v !== expectedVersion) {
      console.log(`${label} DB at ${dbPath} has data version ${v ?? 'unreadable'}, expected ${expectedVersion} — rematerialising`);
    } else if (existsSync(gzPath) && statSync(gzPath).mtimeMs > statSync(dbPath).mtimeMs) {
      console.log(`${label} DB at ${dbPath} is older than ${gzPath} — rematerialising`);
    } else {
      console.log(`${label} DB present: ${dbPath} (${sizeMb(dbPath)})`);
      return;
    }
  }

  const url = urlEnv ? process.env[urlEnv] : undefined;
  if (url) {
    console.log(`Downloading ${lower} DB from ${url} ...`);
    await downloadDb(dbPath, url, { label, from: url, expectedVersion, buildScript }, tokenEnv ? process.env[tokenEnv] : undefined);
    console.log(`Downloaded: ${dbPath} (${sizeMb(dbPath)})`);
    return;
  }

  if (existsSync(gzPath)) {
    console.log(`Decompressing committed artifact ${gzPath} (${sizeMb(gzPath)}) ...`);
    await writeDb(dbPath, createReadStream(gzPath), true, { label, from: gzPath, expectedVersion, buildScript });
    console.log(`Decompressed: ${dbPath} (${sizeMb(dbPath)})`);
    return;
  }

  if (existsSync(sourcePath)) {
    console.log(`No prebuilt ${lower} DB or artifact found; rebuilding from source ...`);
    const result = spawnSync('npm', ['run', buildScript], { cwd: packageRoot, stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error(`${buildScript} exited with status ${result.status}`);
    }
    assertDataVersion(dbPath, { label, from: `npm run ${buildScript}`, expectedVersion, buildScript });
    return;
  }

  console.warn(`WARNING: no ${lower} DB, no .gz artifact, no source — ${unavailableHint}`);
}
