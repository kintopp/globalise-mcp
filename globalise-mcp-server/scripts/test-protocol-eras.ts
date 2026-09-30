/**
 * Protocol-era matrix: the server must serve both the 2025-era (legacy) and
 * 2026-07-28 (modern) protocols over stdio and HTTP. Each connection asserts
 * the negotiated era, tool listing, an offline tool call and the MCP Apps
 * resource read; the HTTP child is then SIGTERMed while a modern
 * subscriptions/listen stream is open, to prove the shutdown drain closes it.
 *
 * Requires a prior `npm run build` (runs dist/index.js).
 *
 * Run with: npm run test:protocol-eras
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport, type ClientOptions } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { check, finish } from './test-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, '..', 'dist', 'index.js');
const PORT = 3919;

// Duplicated from smoke-test.ts (source of truth); importing it would run the whole smoke test.
const EXPECTED_TOOLS = [
  'globalise_search_transcriptions',
  'globalise_retrieve_document',
  'globalise_navigate',
  'globalise_find_archival_documents',
  'globalise_lookup_commodity',
  'globalise_lookup_measure',
  'globalise_inspect_page_image',
  'globalise_navigate_viewer',
  'globalise_poll_viewer_commands',
  'globalise_view_document_ui',
];

const MODERN: ClientOptions = { versionNegotiation: { mode: { pin: '2026-07-28' } } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(child: ChildProcess, timeoutMs: number): Promise<void> {
  // A stale server on the port would answer /health while our child dies with EADDRINUSE.
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) throw new Error('HTTP server exited before /health was ready (port in use?)');
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.status === 200) {
        await sleep(100);
        if (exited) throw new Error('HTTP server exited before /health was ready (port in use?)');
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(50);
  }
  throw new Error(`/health did not become ready within ${timeoutMs}ms`);
}

async function exercise(client: Client, label: string, expectedEra: 'legacy' | 'modern'): Promise<void> {
  console.log(label);
  const era = client.getProtocolEra();
  check(era === expectedEra, `${label}: era is ${expectedEra} (got: ${era})`);
  check(Boolean(client.getInstructions()), `${label}: server instructions present`);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  check(
    names.length === EXPECTED_TOOLS.length && EXPECTED_TOOLS.every((n) => names.includes(n)),
    `${label}: tool set matches (got ${names.length})`,
  );

  const res = await client.callTool({ name: 'globalise_lookup_commodity', arguments: { query: 'peper', size: 2 } });
  const content = res.content as Array<{ type: string; text?: string }>;
  const payload = JSON.parse(content[0]?.text ?? '{}');
  check(!res.isError && payload.total?.value > 0, `${label}: commodity lookup (total: ${payload.total?.value})`);

  const resource = await client.readResource({ uri: 'ui://globalise/document-viewer.html' });
  const item = resource.contents[0] as { mimeType?: string; text?: string } | undefined;
  console.log(`  viewer mimeType: ${item?.mimeType}`);
  check(
    resource.contents.length === 1 && item?.mimeType === 'text/html;profile=mcp-app' && (item.text?.length ?? 0) > 400_000,
    `${label}: viewer resource (${item?.text?.length} chars)`,
  );
}

async function stdioClient(options?: ClientOptions): Promise<Client> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry], stderr: 'pipe' });
  const client = new Client({ name: 'globalise-era-test', version: '1.0.0' }, options);
  await client.connect(transport);
  return client;
}

async function main() {
  const clients: Client[] = [];
  let child: ChildProcess | undefined;
  try {
    const a = await stdioClient();
    clients.push(a);
    await exercise(a, 'A. stdio / default', 'legacy');

    // Spawns two processes: the SDK probes the era on a short-lived sibling first.
    const b = await stdioClient(MODERN);
    clients.push(b);
    await exercise(b, 'B. stdio / pin 2026-07-28', 'modern');

    const proc = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, TRANSPORT: 'http', PORT: String(PORT) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child = proc;
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += String(d);
    });
    const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
    await waitForHealth(proc, 10_000);

    const url = new URL(`http://localhost:${PORT}/mcp`);
    const c = new Client({ name: 'globalise-era-test', version: '1.0.0' });
    clients.push(c);
    await c.connect(new StreamableHTTPClientTransport(url));
    await exercise(c, 'C. http / default', 'legacy');

    const d = new Client({ name: 'globalise-era-test', version: '1.0.0' }, MODERN);
    clients.push(d);
    await d.connect(new StreamableHTTPClientTransport(url));
    await exercise(d, 'D. http / pin 2026-07-28', 'modern');

    console.log('E. SIGTERM with an open subscriptions/listen stream');
    const sub = await d.listen({ toolsListChanged: true });
    const t0 = Date.now();
    proc.kill('SIGTERM');
    const timer = setTimeout(() => proc.kill('SIGKILL'), 15_000);
    const code = await exited;
    clearTimeout(timer);
    const elapsed = Date.now() - t0;
    console.log(`  exit=${code} elapsed=${elapsed}ms`);
    check(code === 0, `clean exit on SIGTERM (got: ${code})`);
    check(!stderr.includes('drain timed out'), 'drain did not hit the forced-exit backstop');
    check(elapsed < 8000, `drained in ${elapsed}ms (< 8000)`);
    const closed = await Promise.race([sub.closed, sleep(2000).then(() => 'timeout')]);
    console.log(`  subscription closed: ${closed}`);
    check(closed === 'graceful', `listen stream ended gracefully (got: ${closed})`);
  } finally {
    for (const cl of clients) await cl.close().catch(() => {});
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

main()
  .then(() => {
    finish('Protocol eras');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
