/**
 * Stdio smoke test for the GLOBALISE MCP server.
 *
 * Uses the SDK's Client + StdioClientTransport (never shell-piped JSON-RPC):
 *   1. initialize handshake against dist/index.js
 *   2. tools/list — expects all 7 tools, $ref-free input schemas,
 *      additionalProperties: false (strict), viewer tool UI metadata
 *   3. resources/list — expects the document-viewer UI resource
 *   4. one cheap globalise_find_archival_documents call (local SQLite, no network)
 *
 * Run with: npm run test:smoke (requires a prior npm run build)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, '..', 'dist', 'index.js');

const EXPECTED_TOOLS = [
  'globalise_search_transcriptions',
  'globalise_retrieve_document',
  'globalise_navigate',
  'globalise_search_by_inventory',
  'globalise_search_by_language',
  'globalise_find_archival_documents',
  'globalise_view_document_ui',
];

let failures = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/** Recursively assert a JSON schema contains no $ref keys (claude.ai rejects them). */
function hasRef(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasRef);
  if (typeof node === 'object' && node !== null) {
    if ('$ref' in node) return true;
    return Object.values(node).some(hasRef);
  }
  return false;
}

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
  });
  const client = new Client({ name: 'globalise-smoke-test', version: '1.0.0' });

  console.log('1. initialize');
  await client.connect(transport);
  const serverVersion = client.getServerVersion();
  check(serverVersion?.name === 'globalise-mcp-server', `server name (got: ${serverVersion?.name})`);

  console.log('2. tools/list');
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const expected of EXPECTED_TOOLS) {
    check(names.includes(expected), `tool registered: ${expected}`);
  }
  for (const tool of tools) {
    check(!hasRef(tool.inputSchema), `$ref-free inputSchema: ${tool.name}`);
    check(tool.annotations?.readOnlyHint === true, `readOnlyHint: ${tool.name}`);
  }
  // Strict schemas: unknown params rejected, not stripped (viewer tool uses a
  // raw shape via registerAppTool, so strictness applies to the 6 data tools)
  for (const tool of tools.filter((t) => t.name !== 'globalise_view_document_ui')) {
    check(
      (tool.inputSchema as { additionalProperties?: boolean }).additionalProperties === false,
      `strict (additionalProperties: false): ${tool.name}`,
    );
  }
  const viewerTool = tools.find((t) => t.name === 'globalise_view_document_ui');
  const viewerMeta = viewerTool?._meta as { ui?: { resourceUri?: string } } | undefined;
  check(
    viewerMeta?.ui?.resourceUri === 'ui://globalise/document-viewer.html',
    'viewer tool has _meta.ui.resourceUri',
  );

  console.log('3. resources/list');
  const { resources } = await client.listResources();
  check(
    resources.some((r) => r.uri === 'ui://globalise/document-viewer.html'),
    'document-viewer UI resource listed',
  );

  console.log('4. tools/call globalise_find_archival_documents (local DB)');
  const result = await client.callTool({
    name: 'globalise_find_archival_documents',
    arguments: { source: 'gm', size: 1, includeAggregations: false },
  });
  check(!result.isError, 'call succeeded (isError not set)');
  const content = result.content as Array<{ type: string; text?: string }>;
  const payload = JSON.parse(content[0]?.text ?? '{}');
  check(typeof payload.total?.value === 'number' && payload.total.value > 0, `GM results found (total: ${payload.total?.value})`);

  await client.close();

  if (failures > 0) {
    console.error(`\nSmoke test FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nSmoke test passed.');
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
