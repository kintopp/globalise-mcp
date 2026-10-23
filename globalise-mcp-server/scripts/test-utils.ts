/**
 * Shared pass/fail accounting and stubs for the plain-Node test scripts.
 */
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let failures = 0;

export function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/** Assert `pred` holds for every item; an empty list fails, since `[].every()` is vacuously true. */
export function checkEvery<T>(items: readonly T[], pred: (item: T) => boolean, label: string): void {
  check(items.length > 0 && items.every(pred), items.length === 0 ? `${label} (no items)` : label);
}

/**
 * Run `fn` with `globalThis.fetch` replaced by `respond` (given the 0-based call
 * index; throwing simulates a network failure), then restore the real fetch.
 */
export async function withStubbedFetch<T>(
  respond: (call: number) => Response,
  fn: () => Promise<T>,
): Promise<{ calls: number; value?: T; error?: unknown }> {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => respond(calls++)) as typeof fetch;
  try {
    const value = await fn();
    return { calls, value };
  } catch (error) {
    return { calls, error };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Assert that `fn` throws a ToolError-shaped error (message + suggestion). */
export function throwsToolError(fn: () => unknown, label: string): void {
  try {
    fn();
    check(false, `${label} (no error thrown)`);
  } catch (e) {
    const err = e as { name?: string; suggestion?: unknown };
    check(err?.name === 'ToolError' && typeof err.suggestion === 'string', label);
  }
}

/** Print the suite verdict and exit non-zero if any check failed. */
export function finish(suiteName: string): void {
  if (failures > 0) {
    console.error(`\n${suiteName} FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log(`\n${suiteName} passed.`);
}

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(SERVER_ROOT, 'scripts', 'cli.mjs');

export type CliResult = { code: number; stdout: string; stderr: string };

/**
 * Run the headless CLI (scripts/cli.mjs) over its default stdio transport, which spawns the
 * built dist/index.js, with `input` (if any) on stdin. Resolves with {code, stdout, stderr}; never rejects.
 */
export function runCli(
  args: string[],
  { timeout = 90000, input, env: extraEnv }: { timeout?: number; input?: string; env?: Record<string, string> } = {},
): Promise<CliResult> {
  // Strip GLOBALISE_MCP_HTTP (commonly exported in dev shells) so an exported Railway URL can't
  // hijack the stdio path. Tests that need HTTP pass --http, which overrides it. The CLI passes
  // its environment on to the server it spawns, so `env` reaches the server too.
  const { GLOBALISE_MCP_HTTP, ...inherited } = process.env;
  const env = { ...inherited, ...extraEnv };
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: SERVER_ROOT, timeout, maxBuffer: 64 * 1024 * 1024, env },
      (err: any, stdout: string, stderr: string) => {
        resolve({
          // A timeout kill leaves err.code null and a spawn failure makes it a
          // string ('ENOENT'); map both to -1 so neither reads as a clean exit.
          code: !err ? 0 : typeof err.code === 'number' ? err.code : -1,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
    // Close stdin either way, so a CLI reading it never waits on the test process.
    child.stdin?.end(input);
  });
}

/** Read the worked example out of `<verb> --help` as an argv (quotes stripped, `glob-mcp` dropped). */
export function helpExampleArgv(helpText: string): string[] | null {
  const m = helpText.match(/^Example:\n\s+glob-mcp (.+)$/m);
  if (!m) return null;
  return [...m[1].matchAll(/"([^"]*)"|(\S+)/g)].map((t) => t[1] ?? t[2]);
}

/**
 * Local HTTP stub of the Broccoli upstream, for a server started with BROCCOLI_BASE_URL=stub.url.
 *
 * - POST /projects/globalise/search: `total` pages (eq) of inventory 9966, sliced by from/size.
 * - GET  /projects/globalise/urn:globalise:NL-HaNA_1.04.02_{inv}_{scan}: a page whose prev/next
 *   pointers are the neighbouring scans (none before 0001), with `lines` transcription lines
 *   of `lineChars` characters each. Any other path → 404.
 * - GET  /brinta/globalise/indices: one index whose searchable fields include langIso.
 *
 * `requests` records every request path, so a test can tell the stub was actually used.
 */
export async function startUpstreamStub(
  { total = 42, lines = 3, lineChars = 20 }: { total?: number; lines?: number; lineChars?: number } = {},
): Promise<{ url: string; requests: string[]; close: () => Promise<void> }> {
  const requests: string[] = [];
  const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://stub');
    requests.push(`${req.method} ${u.pathname}`);
    req.resume();
    if (req.method === 'POST' && u.pathname === '/projects/globalise/search') {
      const from = Number(u.searchParams.get('from') ?? 0);
      const size = Number(u.searchParams.get('size') ?? 10);
      const results = [];
      for (let i = from; i < Math.min(from + size, total); i++) {
        const document = `NL-HaNA_1.04.02_9966_${String(i + 1).padStart(4, '0')}`;
        results.push({
          _id: `urn:globalise:${document}`, document, invNr: '9966', textTokenCount: 100,
          _hits: { text: [`hit ${i}`] }, langIso: ['nld'], langLabel: ['Dutch'],
        });
      }
      return json(res, 200, { total: { value: total, relation: 'eq' }, results, aggs: {} });
    }
    if (req.method === 'GET' && u.pathname === '/brinta/globalise/indices') {
      return json(res, 200, { 'globalise-2024.03.18-test': { text: 'text', langIso: 'keyword', invNr: 'keyword', document: 'keyword' } });
    }
    const m = u.pathname.match(/^\/projects\/globalise\/urn:globalise:(NL-HaNA_1\.04\.02_(\d+)_(\d{4}))$/);
    if (req.method === 'GET' && m) {
      const [, document, inv, scan] = m;
      const page = (n: number) => `NL-HaNA_1.04.02_${inv}_${String(n).padStart(4, '0')}`;
      const n = Number(scan);
      return json(res, 200, {
        anno: [{
          generator: { name: 'stub-htr' }, generated: '2024-01-01',
          body: { metadata: {
            document, inventoryNumber: inv, created: '2024-01-01', lastChange: '2024-01-01', creator: 'stub',
            naUrl: `https://www.nationaalarchief.nl/stub/${document}`, lang: [{ iso: 'nld', label: 'Dutch' }],
            ...(n > 1 ? { prevPageId: page(n - 1) } : {}), nextPageId: page(n + 1),
          } },
        }],
        views: { self: { lines: Array.from({ length: lines }, (_, i) => `${i}:`.padEnd(lineChars, 'x')) } },
      });
    }
    json(res, 404, { error: 'not found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
