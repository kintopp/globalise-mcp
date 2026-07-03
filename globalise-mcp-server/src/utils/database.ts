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
import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { Readable, PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';

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
  // Configure on a local handle and publish to `db` only after the pragmas
  // succeed — otherwise a throwing pragma would leave `db` set to a
  // half-configured handle that every later call returns via the `if (db)`
  // early-return, while the first call reported the DB unavailable (finding 14).
  const conn = new DatabaseSync(DB_PATH, { readOnly: true });

  // Optimize for read-only queries (only set pragmas that don't require write
  // access). node:sqlite has no .pragma() helper, so issue them via exec().
  conn.exec('PRAGMA cache_size = -64000'); // 64MB cache
  conn.exec('PRAGMA temp_store = MEMORY');
  // Memory-map the (read-only, ~108MB) DB so cold-page reads skip read()
  // syscalls. 256MB ceiling comfortably covers the whole file; safe on a
  // read-only connection.
  conn.exec('PRAGMA mmap_size = 268435456');

  db = conn;
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

  // Publish only after the pragmas succeed (see getDatabase, finding 14).
  const conn = new DatabaseSync(REFERENCE_DB_PATH, { readOnly: true });
  conn.exec('PRAGMA cache_size = -16000'); // 16MB cache
  conn.exec('PRAGMA temp_store = MEMORY');

  referenceDb = conn;
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

// ---------------------------------------------------------------------------
// First-run provisioning (thin .mcpb bundle)
//
// The full bundle ships data/archival-index.sqlite, so DB_PATH already exists
// and everything below is a no-op. The *thin* bundle ships without the DB: it
// sets ARCHIVAL_DB_URL (the .gz to fetch) and points ARCHIVAL_DB_PATH at a
// writable cache dir. ensureDatabaseFile() downloads the index once, lazily, on
// first use of globalise_find_archival_documents — so startup and the other
// (network-backed) tools never wait on it.
// ---------------------------------------------------------------------------

/** Shared in-flight download so concurrent tool calls trigger only one fetch. */
let provisionPromise: Promise<void> | null = null;

/**
 * Ensure the archival index exists at DB_PATH, downloading it once if it is
 * absent and ARCHIVAL_DB_URL is configured. Resolves as a no-op when:
 *   - the file already exists (full bundle, or already provisioned), or
 *   - no ARCHIVAL_DB_URL is set — the caller then reports
 *     databaseInfo.available:false, preserving the graceful-degradation path.
 * Rejects only when a *configured* download fails, so the tool can surface why.
 */
export function ensureDatabaseFile(): Promise<void> {
  if (existsSync(DB_PATH)) return Promise.resolve();

  const url = process.env.ARCHIVAL_DB_URL;
  if (!url) return Promise.resolve();

  if (!provisionPromise) {
    provisionPromise = downloadArchivalDb(url, DB_PATH).catch((error: unknown) => {
      provisionPromise = null; // a failed download is retryable on the next call
      throw error;
    });
  }
  return provisionPromise;
}

/**
 * Download the index to a temp file (gunzipping when the URL ends in .gz) and
 * atomically rename into place, so an interrupted run never leaves a half file.
 * Mirrors scripts/ensure-archival-db.ts, the build-time equivalent.
 *
 * The temp name is per-process unique (pid + random). The in-process
 * `provisionPromise` guard only serializes downloads *within* one process; two
 * processes sharing one writable ARCHIVAL_DB_PATH (thin bundle + shared cache
 * dir) both see the file absent and both download. With a fixed `${target}.tmp`
 * they interleave writes into one file and the error-path unlinkSync can delete
 * the peer's in-progress temp → a truncated/corrupt index. A private temp per
 * process means each writes its own file, the rename-into-place (already atomic)
 * is the sole cross-process interaction — last-writer-wins on a *complete* file
 * is harmless — and the catch's unlinkSync only removes this process's own temp.
 */
/** Log network progress at most every ~4 MB of compressed transfer. */
const DOWNLOAD_PROGRESS_BYTES = 4 * 1024 * 1024;

/**
 * Idle timeout: abort if no bytes arrive for this long. Armed before the fetch
 * (so a hung connect/handshake trips it) and re-armed on every chunk (so a
 * mid-stream stall trips it too). Plain `fetch()` has NO timeout, so a wrong or
 * firewalled ARCHIVAL_DB_URL — e.g. the manifest's localhost default with no
 * server running — otherwise hangs the tool call forever. Override via
 * ARCHIVAL_DB_TIMEOUT_MS (raise it on slow links; lower it in tests).
 */
function downloadIdleTimeoutMs(): number {
  const v = Number(process.env.ARCHIVAL_DB_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 30_000;
}

async function downloadArchivalDb(url: string, target: string): Promise<void> {
  console.error(`[archival-db] index not present; downloading from ${url} ...`);

  const headers: Record<string, string> = { accept: 'application/octet-stream' };
  if (process.env.ARCHIVAL_DB_TOKEN) {
    headers.authorization = `Bearer ${process.env.ARCHIVAL_DB_TOKEN}`;
  }

  const idleMs = downloadIdleTimeoutMs();
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleMs);
  };
  const idleSecs = Math.round(idleMs / 1000);

  // Phase 1 — connect + response headers (fail fast if unreachable/hung).
  armIdle();
  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
  } catch (error) {
    clearTimeout(idleTimer);
    const reason = controller.signal.aborted
      ? `no response within ${idleSecs}s — server unreachable or not responding`
      : (error instanceof Error ? error.message : String(error));
    throw new Error(`could not reach ${url}: ${reason}`);
  }
  if (!response.ok || !response.body) {
    clearTimeout(idleTimer);
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  // Phase 2 — stream to a private temp file, gunzipping when the URL ends .gz.
  const totalBytes = Number(response.headers.get('content-length')) || 0;
  const totalMb = totalBytes ? (totalBytes / 1024 / 1024).toFixed(1) : '';
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;

  // A pass-through that counts bytes, re-arms the idle timer, and logs progress
  // so a healthy-but-slow 27 MB download isn't mistaken for a stall.
  let received = 0;
  let nextLogAt = DOWNLOAD_PROGRESS_BYTES;
  const monitor = new PassThrough();
  monitor.on('data', (chunk: Buffer) => {
    received += chunk.length;
    armIdle();
    if (received >= nextLogAt) {
      nextLogAt += DOWNLOAD_PROGRESS_BYTES;
      const mb = (received / 1024 / 1024).toFixed(1);
      const pct = totalBytes ? ` (${Math.round((received / totalBytes) * 100)}%)` : '';
      console.error(`[archival-db] downloaded ${mb}${totalMb ? ` / ${totalMb}` : ''} MB${pct} ...`);
    }
  });

  const bodyStream = response.body as import('node:stream/web').ReadableStream;
  try {
    // Detect gzip by the magic number (1f 8b) rather than the URL suffix: the
    // public browser asset URL ends in .gz, but the api.github.com asset URL
    // (used to test against the private repo with a token) serves the same
    // gzip bytes with no .gz suffix. Peek the first chunk, then re-emit it
    // ahead of the remaining body.
    armIdle();
    const reader = bodyStream.getReader();
    const first = await reader.read();
    reader.releaseLock();
    const head = first.value ? Buffer.from(first.value) : Buffer.alloc(0);
    const isGzip = head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b;

    const source = Readable.from((async function* () {
      if (head.length) yield head;
      yield* Readable.fromWeb(bodyStream);
    })());

    const stages = isGzip
      ? [source, monitor, createGunzip(), createWriteStream(tmp)]
      : [source, monitor, createWriteStream(tmp)];
    await pipeline(stages);
    renameSync(tmp, target);
  } catch (error) {
    if (existsSync(tmp)) unlinkSync(tmp);
    const reason = controller.signal.aborted
      ? `stalled — no data for ${idleSecs}s`
      : (error instanceof Error ? error.message : String(error));
    throw new Error(`download from ${url} failed: ${reason}`);
  } finally {
    clearTimeout(idleTimer);
  }

  console.error(`[archival-db] index ready at ${target} (${(received / 1024 / 1024).toFixed(1)} MB downloaded)`);
}

/**
 * Get the path to the reference-vocabularies database file.
 */
export function getReferenceDatabasePath(): string {
  return REFERENCE_DB_PATH;
}

/**
 * Per-connection state derived from a Db handle, with a statement cache.
 * `prepare(sql)` returns a statement prepared once and reused for the life of
 * the connection (cached by exact SQL string).
 */
export interface ConnectionState {
  readonly db: Db;
  /** Prepare a statement once per connection, cached by exact SQL string. */
  prepare(sql: string): DbStatement;
}

/**
 * Build a memoized accessor for state derived from a Db handle. This owns, in
 * one place, the two invariants both SQLite tools used to hand-copy
 * (CODE-REVIEW finding 15):
 *
 *  - **Handle-keying:** a prepared statement belongs to the handle that created
 *    it, so the cache is keyed by the handle and rebuilt after closeDatabase()
 *    + reopen. The DBs are read-only and rebuilt only at deploy, so any
 *    constants the init derives (totals, probes) hold for the connection's life.
 *  - **Statement caching:** the `prepare()` passed to `init` (and stored on the
 *    returned state) caches by SQL string, so the handful of WHERE shapes a tool
 *    issues per call are compiled once, not re-prepared every call (findings
 *    6/20). node:sqlite is synchronous, so each avoided compile is event-loop
 *    time saved — and it multiplies under concurrent HTTP users.
 *
 * Each call to this factory owns its own slot, so different tools and DBs never
 * collide. The cache is unbounded but bounded in practice: the distinct SQL
 * shapes are few (parameter *values* don't vary the string; only e.g. the
 * count of `IN (@inv0, @inv1, …)` placeholders does).
 */
export function createConnectionState<T>(
  init: (state: ConnectionState) => T,
): (db: Db) => ConnectionState & T {
  let cached: (ConnectionState & T) | null = null;
  return (db: Db): ConnectionState & T => {
    if (cached?.db !== db) {
      const statements = new Map<string, DbStatement>();
      const base: ConnectionState = {
        db,
        prepare(sql: string): DbStatement {
          let stmt = statements.get(sql);
          if (stmt === undefined) {
            stmt = db.prepare(sql);
            statements.set(sql, stmt);
          }
          return stmt;
        },
      };
      cached = Object.assign(base, init(base));
    }
    return cached;
  };
}
