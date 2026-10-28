/**
 * Tests for build-time DB provisioning (db-build-utils.ts `ensureDb`).
 *
 * Failure modes guarded:
 *  - a stale-version local DB survives instead of being replaced;
 *  - a local DB older than its committed .gz survives (the stale-.sqlite trap);
 *  - a current DB is needlessly replaced or re-fetched;
 *  - gzip served from a non-.gz URL is stored compressed;
 *  - a wrong-version artifact replaces a good file (or leaves a .tmp behind).
 *
 * Local http servers stand in for the download host; no network.
 *
 * Run with: npm run test:ensure-db
 */

import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { check, finish } from './test-utils.js';
import { ensureDb, type EnsureDbOptions } from './db-build-utils.js';

const WANT = 5;
const dir = mkdtempSync(join(tmpdir(), 'gl-ensure-'));
const dbPath = join(dir, 'x.sqlite');
const gzPath = `${dbPath}.gz`;
const URL_ENV = 'TEST_ENSURE_DB_URL';

function makeDb(path: string, version: number): void {
  const d = new DatabaseSync(path);
  d.exec(`CREATE TABLE t (a); PRAGMA user_version = ${version}`);
  d.close();
}
function version(path: string): number {
  const d = new DatabaseSync(path, { readOnly: true });
  try { return (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; } finally { d.close(); }
}
/** Gzipped bytes of a fresh DB at `v`. */
function gzBytes(v: number): Buffer {
  const p = join(dir, `src-${v}.sqlite`);
  rmSync(p, { force: true });
  makeDb(p, v);
  return gzipSync(readFileSync(p));
}

function reset(): void {
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { force: true });
  delete process.env[URL_ENV];
}
const past = (path: string, secondsAgo: number): void => {
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(path, t, t);
};
const opts = (over: Partial<EnsureDbOptions> = {}): EnsureDbOptions => ({
  label: 'Test',
  dbPath,
  gzPath,
  sourcePath: join(dir, 'no-such-source.csv'),
  buildScript: 'build:test',
  packageRoot: dir,
  expectedVersion: WANT,
  unavailableHint: 'n/a',
  ...over,
});
async function reject(fn: () => Promise<unknown>): Promise<Error | null> {
  try { await fn(); return null; } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
}
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
};

let hits = 0;
let body: Buffer = Buffer.alloc(0);
const server: Server = createServer((_req, res) => { hits++; res.end(body); });
const port = await new Promise<number>((r) => server.listen(0, '127.0.0.1', () => {
  const a = server.address();
  r(typeof a === 'object' && a ? a.port : 0);
}));

console.log('1. current DB, older .gz → untouched, no request');
{
  reset();
  makeDb(dbPath, WANT);
  writeFileSync(gzPath, gzBytes(WANT));
  past(gzPath, 100);
  process.env[URL_ENV] = `http://127.0.0.1:${port}/x`;
  hits = 0;
  const before = statSync(dbPath);
  await quiet(() => ensureDb(opts({ urlEnv: URL_ENV })));
  const after = statSync(dbPath);
  check(hits === 0, 'no download request');
  check(after.ino === before.ino && after.mtimeMs === before.mtimeMs, 'file unchanged');
}

console.log('2. wrong-version DB, urlEnv set → re-downloaded');
{
  reset();
  makeDb(dbPath, WANT - 1);
  body = gzBytes(WANT);
  process.env[URL_ENV] = `http://127.0.0.1:${port}/x.sqlite.gz`;
  hits = 0;
  await quiet(() => ensureDb(opts({ urlEnv: URL_ENV })));
  check(hits === 1, 'one download request');
  check(version(dbPath) === WANT, 'final version is the expected one');
}

console.log('3. current DB, newer .gz → replaced from the .gz');
{
  reset();
  makeDb(dbPath, WANT);
  past(dbPath, 100);
  writeFileSync(gzPath, gzBytes(WANT));
  const before = statSync(dbPath);
  await quiet(() => ensureDb(opts()));
  check(statSync(dbPath).ino !== before.ino, 'file replaced');
  check(version(dbPath) === WANT, 'version still expected');
}

console.log('4. corrupt DB, .gz present → replaced from the .gz');
{
  reset();
  writeFileSync(dbPath, randomBytes(4096));
  writeFileSync(gzPath, gzBytes(WANT));
  past(gzPath, 100);
  await quiet(() => ensureDb(opts()));
  check(version(dbPath) === WANT, 'readable DB at the expected version');
}

console.log('5. gzip served from a URL without .gz → stored decompressed');
{
  reset();
  body = gzBytes(WANT);
  process.env[URL_ENV] = `http://127.0.0.1:${port}/asset/12345`;
  await quiet(() => ensureDb(opts({ urlEnv: URL_ENV })));
  check(existsSync(dbPath) && version(dbPath) === WANT, 'decompressed DB at the expected version');
}

console.log('6. wrong-version .gz → rejected, good file kept, no .tmp');
{
  reset();
  makeDb(dbPath, WANT);
  past(dbPath, 100);
  writeFileSync(gzPath, gzBytes(WANT - 2));
  const err = await reject(() => quiet(() => ensureDb(opts())));
  check(err !== null && err.message.includes('expected'), `rejects naming the expectation (got: ${err?.message})`);
  check(version(dbPath) === WANT, 'original file still in place');
  check(!readdirSync(dir).some((f) => f.endsWith('.tmp')), 'no .tmp left');
}

await new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); });
rmSync(dir, { recursive: true, force: true });
finish('ensure-db');
