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
import { check, finish } from './test-utils.js';

// DB_PATH is resolved at module load, so set the target BEFORE importing.
const dir = mkdtempSync(join(tmpdir(), 'gl-dl-'));
const target = join(dir, 'archival-index.sqlite');
process.env.ARCHIVAL_DB_PATH = target;
process.env.ARCHIVAL_DB_TIMEOUT_MS = '700'; // fast idle timeout for the hang test
delete process.env.ARCHIVAL_DB_TOKEN;

const { ensureDatabaseFile } = await import('../src/utils/database.js');

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
  await close(srv);
}

rmSync(dir, { recursive: true, force: true });
finish('Archival download');
