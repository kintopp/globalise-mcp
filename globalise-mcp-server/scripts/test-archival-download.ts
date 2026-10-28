/**
 * Integration tests for the thin-bundle archival index download
 * (src/utils/database.ts `ensureDatabaseFile` → `downloadArchivalDb`): the
 * fail-fast idle timeout and the URL-naming errors added so a wrong or
 * unreachable ARCHIVAL_DB_URL can no longer hang the tool call forever (the
 * localhost-default-with-no-server case). The happy-path 27 MB download is
 * covered end-to-end by `npm run test:mcpb` (thin variant); here a local http
 * server stands in for the host — no network, no committed DB.
 *
 * Failure modes guarded for validation and refresh:
 *  - an invalid 200 body (HTML page, empty) is installed as the index;
 *  - an old-version download is installed;
 *  - a stale file is never refreshed;
 *  - a failed refresh destroys or rejects a usable stale file;
 *  - a failed refresh retries on every call;
 *  - a current file triggers a download.
 *
 * Run with: npm run test:archival-download
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { check, finish } from './test-utils.js';

// DB_PATH is resolved at module load, so set the target BEFORE importing.
const dir = mkdtempSync(join(tmpdir(), 'gl-dl-'));
const target = join(dir, 'archival-index.sqlite');
process.env.ARCHIVAL_DB_PATH = target;
process.env.ARCHIVAL_DB_TIMEOUT_MS = '700'; // fast idle timeout for the hang test
delete process.env.ARCHIVAL_DB_TOKEN;

const { ensureDatabaseFile, takeProvisionReport, expandPathVars, ARCHIVAL_DATA_VERSION: N } = await import('../src/utils/database.js');

const listen = (s: Server): Promise<number> =>
  new Promise((res) => s.listen(0, '127.0.0.1', () => {
    const a = s.address();
    res(typeof a === 'object' && a ? a.port : 0);
  }));
const close = (s: Server): Promise<void> => {
  s.closeAllConnections?.();
  return new Promise((res) => s.close(() => res()));
};
// The download streams into a private temp file beside the target, so a failure
// must leave the directory empty, not merely lack the final file name.
const leftovers = (): string[] => readdirSync(dir);

/** A real tiny SQLite file shaped like the index, stamped with `version`. */
function makeIndexDb(version: number): Buffer {
  const path = join(dir, `make-${randomBytes(4).toString('hex')}.tmpdb`);
  const conn = new DatabaseSync(path);
  conn.exec(`CREATE TABLE obp_documents (id INTEGER); PRAGMA user_version = ${version}`);
  conn.close();
  const buf = readFileSync(path);
  rmSync(path);
  return buf;
}

/** Independent of the code under test: its own read-only connection. */
function versionOf(path: string): number {
  const conn = new DatabaseSync(path, { readOnly: true });
  try {
    return (conn.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  } finally {
    conn.close();
  }
}

/** Install `buf` at `target` through a rename, so it always gets a new inode. */
function placeTarget(buf: Buffer): void {
  const staged = join(dir, `staged-${randomBytes(4).toString('hex')}.tmpdb`);
  writeFileSync(staged, buf);
  renameSync(staged, target);
}

/** Serves `status`/`body` and counts requests. */
async function countingServer(body: Buffer, status = 200): Promise<{ srv: Server; url: string; count: () => number }> {
  let n = 0;
  const srv = createServer((_req, res) => {
    n++;
    res.statusCode = status;
    res.setHeader('content-length', String(body.length));
    res.end(body);
  });
  const port = await listen(srv);
  return { srv, url: `http://127.0.0.1:${port}/archival-index.sqlite`, count: () => n };
}

async function reject(fn: () => Promise<unknown>): Promise<Error | null> {
  try { await fn(); return null; } catch (e) { return e instanceof Error ? e : new Error(String(e)); }
}

// 1. Unreachable host → fast reject that names the URL (ECONNREFUSED path).
console.log('1. unreachable URL → fast reject, names URL');
{
  const probe = createServer();
  const port = await listen(probe);
  await close(probe); // free the port so a connect is refused
  const url = `http://127.0.0.1:${port}/archival-index.sqlite.gz`;
  process.env.ARCHIVAL_DB_URL = url;
  const start = Date.now();
  const err = await reject(() => ensureDatabaseFile());
  const ms = Date.now() - start;
  check(err !== null, 'rejects instead of hanging');
  check(!!err && err.message.includes(url), `error names the URL (got: ${err?.message})`);
  check(ms < 3000, `fails fast (${ms}ms < 3000)`);
  check(leftovers().length === 0, `no file written on failure (found: ${leftovers().join(', ')})`);
}

// 2. Server that accepts the connection but never responds → idle-timeout.
console.log('2. hanging server → idle-timeout reject (no infinite hang)');
{
  const hang = createServer(() => { /* deliberately never responds */ });
  const port = await listen(hang);
  const url = `http://127.0.0.1:${port}/archival-index.sqlite.gz`;
  process.env.ARCHIVAL_DB_URL = url;
  const start = Date.now();
  const err = await reject(() => ensureDatabaseFile());
  const ms = Date.now() - start;
  check(err !== null, 'rejects instead of hanging');
  check(ms >= 500 && ms < 3000, `trips the ~700ms idle timeout (${ms}ms)`);
  check(!!err && /not responding|no response within/.test(err.message), `timeout-shaped message (got: ${err?.message})`);
  check(leftovers().length === 0, `no file written on timeout (found: ${leftovers().join(', ')})`);
  await close(hang);
}

// 3. gzip content at a URL that does NOT end in .gz (mimics the api.github.com
//    asset URL used to test against the private repo). Gzip must be detected by
//    magic bytes, not the suffix, and gunzipped. Regression for the .gz-suffix
//    URL is covered by `npm run test:mcpb` (thin, real download).
console.log('3. gzip at a non-.gz URL → sniffed by magic bytes + gunzipped');
{
  const payload = makeIndexDb(N);
  const gz = gzipSync(payload);
  const srv = createServer((_req, res) => { res.setHeader('content-length', String(gz.length)); res.end(gz); });
  const port = await listen(srv);
  // No .gz suffix — the old suffix check would have skipped gunzip and written
  // the compressed bytes as the DB.
  process.env.ARCHIVAL_DB_URL = `http://127.0.0.1:${port}/repos/kintopp/globalise-mcp/releases/assets/999`;
  const err = await reject(() => ensureDatabaseFile());
  check(err === null, `resolves without error (got: ${err?.message})`);
  check(existsSync(target), 'target file written');
  check(existsSync(target) && readFileSync(target).equals(payload), 'gzip sniffed + gunzipped despite non-.gz URL');
  // The report is what lets find_archival_documents explain the first-run wait
  // in its `note`. It is claimed, not returned, so the tool that reports it need
  // not be the one that triggered the download.
  const report = takeProvisionReport();
  check(report !== null, 'a download leaves a claimable ProvisionReport');
  check(report?.downloadedBytes === gz.length,
    `report counts compressed bytes (got: ${report?.downloadedBytes} of ${gz.length})`);
  check(typeof report?.elapsedMs === 'number' && report.elapsedMs >= 0, 'report carries elapsedMs');
  check(takeProvisionReport() === null, 'claiming clears it, so the notice cannot repeat');
  await close(srv);
}

// 4. Mid-stream stall (headers + partial body, then silence). Distinct from
//    case 2, which never responds at all: the message must report how far the
//    transfer got, so a slow/flaky link reads differently from a dead server.
console.log('4. mid-stream stall → reject naming bytes received');
{
  rmSync(target, { force: true }); // case 3 left an index in place
  // Incompressible, so the bytes on the wire are the bytes the message reports.
  // A compressible payload shrinks to a few KB and the assertion below can only
  // ever see "0.0 of 0.0 MB" — which is the dead-server reading it must not
  // be confused with.
  const gz = gzipSync(randomBytes(600 * 1024));
  const srv = createServer((_req, res) => {
    res.setHeader('content-length', String(gz.length));
    res.write(gz.subarray(0, Math.floor(gz.length / 3)));
    // deliberately never end() → the idle timer trips mid-transfer
  });
  const port = await listen(srv);
  process.env.ARCHIVAL_DB_URL = `http://127.0.0.1:${port}/archival-index.sqlite.gz`;
  const err = await reject(() => ensureDatabaseFile());
  check(err !== null, 'rejects instead of hanging');
  const stall = err?.message.match(/stalled at ([\d.]+) of ([\d.]+) MB after (\d+)s/);
  check(!!stall, `names bytes received + elapsed (got: ${err?.message})`);
  check(!!stall && Number(stall[1]) > 0 && Number(stall[1]) < Number(stall[2]),
    `reports a partial transfer, not 0.0 (got: ${stall?.[1]} of ${stall?.[2]} MB)`);
  check(leftovers().length === 0, `no partial or temp file left behind (found: ${leftovers().join(', ')})`);
  await close(srv);
}

// 5. Path variable expansion — Claude Desktop passes user_config *defaults*
//    through verbatim, so the manifest's literal "${HOME}/.globalise-mcp"
//    reached fs.mkdir untouched (real-world ENOENT from the 2026-08-03 thin
//    bundle test). expandPathVars must resolve it in code.
console.log('5. expandPathVars resolves host-unexpanded variables');
{
  const { homedir } = await import('node:os');
  const home = homedir();
  check(expandPathVars('${HOME}/.globalise-mcp/x.sqlite') === join(home, '.globalise-mcp', 'x.sqlite'),
    'literal ${HOME} expands to os.homedir()');
  check(expandPathVars('~/.globalise-mcp') === join(home, '.globalise-mcp'),
    'leading ~ expands to os.homedir()');
  const prevHome = process.env.HOME;
  delete process.env.HOME;
  check(expandPathVars('${HOME}/y') === join(home, 'y'),
    '${HOME} falls back to os.homedir() when env HOME is unset');
  if (prevHome !== undefined) process.env.HOME = prevHome;
  check(expandPathVars('${NO_SUCH_VAR_XYZ}/z') === '${NO_SUCH_VAR_XYZ}/z',
    'unknown variables stay literal (so errors still name them)');
  check(expandPathVars('/plain/absolute/path') === '/plain/absolute/path',
    'plain paths pass through untouched');
}

// 6. Invalid 200 body, no file → rejected, nothing installed.
console.log('6. HTML 200 body, no file → rejected, nothing installed');
{
  rmSync(target, { force: true });
  const { srv, url } = await countingServer(Buffer.from('<html><body>Please log in</body></html>'));
  process.env.ARCHIVAL_DB_URL = url;
  const err = await reject(() => ensureDatabaseFile());
  check(!!err && err.message.includes('not a valid archival index'), `rejects as invalid index (got: ${err?.message})`);
  check(!existsSync(target), 'no target installed');
  check(leftovers().length === 0, `no temp left behind (found: ${leftovers().join(', ')})`);
  await close(srv);
}

// 7. Old-version download, no file → rejected, nothing installed.
console.log('7. old-version download, no file → rejected, nothing installed');
{
  const { srv, url } = await countingServer(makeIndexDb(N - 1));
  process.env.ARCHIVAL_DB_URL = url;
  const err = await reject(() => ensureDatabaseFile());
  check(!!err && err.message.includes('this server needs'), `rejects as too old (got: ${err?.message})`);
  check(!existsSync(target), 'no target installed');
  check(leftovers().length === 0, `no temp left behind (found: ${leftovers().join(', ')})`);
  await close(srv);
}

// 8. Stale file + good server → refreshed with exactly one request.
console.log('8. stale file, good server → refreshed');
{
  placeTarget(makeIndexDb(N - 1));
  const { srv, url, count } = await countingServer(makeIndexDb(N));
  process.env.ARCHIVAL_DB_URL = url;
  const err = await reject(() => ensureDatabaseFile());
  check(err === null, `resolves (got: ${err?.message})`);
  check(versionOf(target) === N, `file now at data version ${N} (got: ${versionOf(target)})`);
  check(count() === 1, `one request (got: ${count()})`);
  await close(srv);
}

// 9. Stale readable file + failing server → keeps the file, no retry per call.
console.log('9. stale readable file, failing server → degrades, no per-call retry');
for (const [label, body, status] of [
  ['HTTP 500', Buffer.from('boom'), 500],
  ['HTML 200', Buffer.from('<html>portal</html>'), 200],
] as const) {
  placeTarget(makeIndexDb(N - 1));
  const { srv, url, count } = await countingServer(body, status);
  process.env.ARCHIVAL_DB_URL = url;
  const err = await reject(() => ensureDatabaseFile());
  check(err === null, `${label}: resolves instead of rejecting (got: ${err?.message})`);
  check(versionOf(target) === N - 1, `${label}: stale file left untouched`);
  check(leftovers().length === 1, `${label}: no temp left behind (found: ${leftovers().join(', ')})`);
  const err2 = await reject(() => ensureDatabaseFile());
  check(err2 === null, `${label}: second call resolves`);
  check(count() === 1, `${label}: server hit once, not per call (got: ${count()})`);
  await close(srv);
}

// 10. Unreadable file + failing server → rejects.
console.log('10. unreadable file, failing server → rejects');
{
  placeTarget(randomBytes(4096));
  const { srv, url } = await countingServer(Buffer.from('boom'), 500);
  process.env.ARCHIVAL_DB_URL = url;
  const err = await reject(() => ensureDatabaseFile());
  check(err !== null, 'rejects when nothing usable remains');
  await close(srv);
}

// 11. Current file → no download, however often it is asked.
console.log('11. current file → no request');
{
  placeTarget(makeIndexDb(N));
  const { srv, url, count } = await countingServer(makeIndexDb(N));
  process.env.ARCHIVAL_DB_URL = url;
  const e1 = await reject(() => ensureDatabaseFile());
  const e2 = await reject(() => ensureDatabaseFile());
  check(e1 === null && e2 === null, 'both calls resolve');
  check(count() === 0, `server saw no requests (got: ${count()})`);
  await close(srv);
}

rmSync(dir, { recursive: true, force: true });
finish('Archival download');
