/**
 * Bundle smoke test: drive the STAGED .mcpb server over stdio exactly the way
 * Claude Desktop launches it (the manifest's command + env), and assert the
 * host-integration contract holds end to end:
 *
 *   1. initialize handshake returns the expected serverInfo + protocolVersion
 *   2. the tools the server actually serves == the tools manifest.json declares
 *   3. the document-viewer MCP App resource (ui://...) is registered
 *   4. an offline tool call (globalise_find_archival_documents) returns a
 *      non-error result with structuredContent
 *
 * The shipped bundle does NOT carry the archival index (it is downloaded on
 * first use), so check 4 normally exercises the download: the test spins up a
 * localhost server for the committed data/archival-index.sqlite.gz, points
 * ARCHIVAL_DB_URL at it and ARCHIVAL_DB_PATH at a fresh temp dir, and proves
 * the FIRST-RUN DOWNLOAD materializes the index and answers the query.
 *
 * The bundled-index branch below is kept as a fallback for a hand-staged tree
 * that has data/archival-index.sqlite in it: it then launches against that file
 * and check 4 proves the on-device index works with no network. The retired
 * "full" bundle variant used to take this path.
 *
 * Usage: npm run test:mcpb            (after npm run build:mcpb)
 *        npx tsx scripts/test-mcpb-bundle.ts [path/to/stage]
 */

import { spawn } from 'node:child_process';
import { createServer as createHttpServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sizeMb } from './db-build-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');
const STAGE_DIR = process.argv[2] ?? join(PACKAGE_ROOT, 'mcpb-build', 'stage');

const PROTOCOL_VERSION = '2025-06-18';
const VIEWER_RESOURCE_URI = 'ui://globalise/document-viewer.html';
const OVERALL_TIMEOUT_MS = 60_000;

type JsonRpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };

/** Minimal newline-delimited JSON-RPC client over a child process' stdio. */
class StdioClient {
  private readonly child;
  private buffer = '';
  private readonly pending = new Map<number, (msg: JsonRpc) => void>();
  private stderr = '';

  constructor(entry: string, env: Record<string, string>) {
    this.child = spawn('node', [entry], {
      cwd: STAGE_DIR,
      // A bare env (only what the manifest sets) mirrors the sandboxed launch
      // Claude Desktop performs from the manifest's mcp_config.
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf-8');
    this.child.stdout.on('data', (chunk: string) => this.onData(chunk));
    this.child.stderr.setEncoding('utf-8');
    this.child.stderr.on('data', (chunk: string) => { this.stderr += chunk; });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg: JsonRpc;
      try {
        msg = JSON.parse(line) as JsonRpc;
      } catch {
        continue; // non-JSON line on stdout (shouldn't happen; logs go to stderr)
      }
      if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
        this.pending.get(msg.id)!(msg);
        this.pending.delete(msg.id);
      }
    }
  }

  request(id: number, method: string, params?: unknown): Promise<JsonRpc> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for response to ${method} (id ${id}).\nstderr:\n${this.stderr}`)),
        OVERALL_TIMEOUT_MS,
      );
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(msg: JsonRpc): void {
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  close(): void {
    this.child.stdin.end();
    this.child.kill();
  }
}

/** Serve the committed .gz over localhost so the thin path can download it. */
function startGzServer(gzPath: string): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server: Server = createHttpServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/gzip' });
      createReadStream(gzPath).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/archival-index.sqlite.gz`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

const checks: Array<{ ok: boolean; label: string; detail?: string }> = [];
function check(ok: boolean, label: string, detail?: string): void {
  checks.push({ ok, label, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const entry = join(STAGE_DIR, 'dist', 'index.js');
  if (!existsSync(entry)) {
    throw new Error(`Staged server not found at ${entry}.\nRun \`npm run build:mcpb\` first.`);
  }

  const manifest = JSON.parse(readFileSync(join(STAGE_DIR, 'manifest.json'), 'utf-8')) as { tools: Array<{ name: string }> };
  const declaredTools = new Set(manifest.tools.map((t) => t.name));

  // The shipped bundle omits the index, so this is normally false; it is true
  // only for a hand-staged tree that has the DB copied in.
  const bundledDb = join(STAGE_DIR, 'data', 'archival-index.sqlite');
  const indexIsBundled = existsSync(bundledDb);

  // Build the launch env +, when the index is not bundled, the download source
  // and a temp target for it to land in.
  const env: Record<string, string> = { TRANSPORT: 'stdio', STRUCTURED_CONTENT: 'true' };
  let gzServer: { url: string; close: () => Promise<void> } | undefined;
  let tmpDataDir: string | undefined;
  let downloadTarget: string | undefined;

  if (indexIsBundled) {
    env.ARCHIVAL_DB_PATH = bundledDb;
    console.log('Index: bundled in the stage at data/archival-index.sqlite\n');
  } else {
    const gzPath = join(PACKAGE_ROOT, 'data', 'archival-index.sqlite.gz');
    if (!existsSync(gzPath)) {
      throw new Error(`The download test needs ${gzPath} to serve; run \`npm run build\` to materialize the .gz.`);
    }
    gzServer = await startGzServer(gzPath);
    tmpDataDir = mkdtempSync(join(tmpdir(), 'globalise-mcpb-'));
    downloadTarget = join(tmpDataDir, 'archival-index.sqlite');
    env.ARCHIVAL_DB_URL = gzServer.url;
    env.ARCHIVAL_DB_PATH = downloadTarget;
    console.log(`Index: not bundled — serving at ${gzServer.url}\n       downloading to ${downloadTarget}\n`);
  }

  console.log(`Launching staged bundle server: ${entry}\n`);
  const client = new StdioClient(entry, env);

  try {
    // 1. initialize
    const init = await client.request(1, 'initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcpb-bundle-test', version: '1.0.0' },
    });
    const initResult = init.result as { serverInfo?: { name?: string; version?: string }; protocolVersion?: string } | undefined;
    check(initResult?.serverInfo?.name === 'globalise-mcp-server',
      'initialize returns serverInfo', `name=${initResult?.serverInfo?.name} version=${initResult?.serverInfo?.version} protocol=${initResult?.protocolVersion}`);
    client.notify('notifications/initialized');

    // 2. tools/list — server's actual tools must equal the manifest's declared tools
    const list = await client.request(2, 'tools/list');
    const served = ((list.result as { tools?: Array<{ name: string }> })?.tools ?? []).map((t) => t.name).sort();
    const declared = [...declaredTools].sort();
    const sameTools = served.length === declared.length && served.every((n, i) => n === declared[i]);
    check(sameTools, 'served tools match manifest', `served=[${served.join(', ')}]`);

    // 3. resources/list — the MCP App viewer resource is registered
    const resources = await client.request(3, 'resources/list');
    const uris = ((resources.result as { resources?: Array<{ uri: string }> })?.resources ?? []).map((r) => r.uri);
    check(uris.includes(VIEWER_RESOURCE_URI), 'viewer MCP App resource registered', VIEWER_RESOURCE_URI);

    // 4. offline tool call. FULL: bundled DB. THIN: triggers the first-run download.
    const call = await client.request(4, 'tools/call', {
      name: 'globalise_find_archival_documents',
      arguments: { query: 'Batavia', size: 1, includeAggregations: false },
    });
    const callResult = call.result as { isError?: boolean; content?: Array<{ type: string; text?: string }>; structuredContent?: unknown } | undefined;
    const text = callResult?.content?.find((c) => c.type === 'text')?.text ?? '';
    let parsed: { databaseInfo?: { available?: boolean }; results?: unknown[] } = {};
    try { parsed = JSON.parse(text); } catch { /* leave empty */ }
    check(call.error === undefined && callResult?.isError !== true,
      'archival tool returns a non-error result');
    check(callResult?.structuredContent !== undefined,
      'tool result carries structuredContent');
    check(parsed.databaseInfo?.available === true,
      indexIsBundled ? 'bundled SQLite index is available on-device' : 'index downloaded on first use and queried',
      `results=${Array.isArray(parsed.results) ? parsed.results.length : 'n/a'}`);

    // Download path only: the fetch actually materialized a full-size file.
    if (!indexIsBundled && downloadTarget) {
      const ok = existsSync(downloadTarget) && statSync(downloadTarget).size > 100 * 1024 * 1024;
      check(ok, 'downloaded index file is on disk',
        existsSync(downloadTarget) ? sizeMb(downloadTarget) : 'missing');
    }
  } finally {
    client.close();
    if (gzServer) await gzServer.close();
    if (tmpDataDir) rmSync(tmpDataDir, { recursive: true, force: true });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`Bundle smoke test FAILED (${failed.length} check(s)).`);
    process.exit(1);
  }
  console.log('Bundle smoke test PASSED.');
}

main().catch((error) => {
  console.error(`\ntest-mcpb-bundle failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
