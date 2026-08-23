/**
 * Integration tests for the thin-bundle archival index download
 * (src/utils/database.ts `ensureDatabaseFile` → `downloadArchivalDb`): the
 * fail-fast idle timeout and the URL-naming errors added so a wrong or
 * unreachable ARCHIVAL_DB_URL can no longer hang the tool call forever (the
 * localhost-default-with-no-server case). The happy-path 27 MB download is
 * covered end-to-end by `npm run test:mcpb` (thin variant); here a local http
 * server stands in for the host — no network, no committed DB.
 *
 * Run with: npm run test:archival-download
 */

import { createServer, type Server } from 'node:http';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
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

const { ensureDatabaseFile, takeProvisionReport, expandPathVars } = await import('../src/utils/database.js');

const listen = (s: Server): Promise<number> =>
  new Promise((res) => s.listen(0, '127.0.0.1', () => {
    const a = s.address();
    res(typeof a === 'object' && a ? a.port : 0);
  }));
const close = (s: Server): Promise<void> => {
  s.closeAllConnections?.();
  return new Promise((res) => s.close(() => res()));
};
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
  check(!existsSync(target), 'no file written on failure');
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
  check(!existsSync(target), 'no file written on timeout');
  await close(hang);
}

// 3. gzip content at a URL that does NOT end in .gz (mimics the api.github.com
//    asset URL used to test against the private repo). Gzip must be detected by
//    magic bytes, not the suffix, and gunzipped. Regression for the .gz-suffix
//    URL is covered by `npm run test:mcpb` (thin, real download).
console.log('3. gzip at a non-.gz URL → sniffed by magic bytes + gunzipped');
{
  const payload = Buffer.from('fake-sqlite-bytes-for-plumbing-test');
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
  check(!existsSync(target), 'no partial file left behind');
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

rmSync(dir, { recursive: true, force: true });
finish('Archival download');
