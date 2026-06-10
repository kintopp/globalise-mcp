/**
 * Stdio smoke test for the GLOBALISE MCP server.
 *
 * Uses the SDK's Client + StdioClientTransport (never shell-piped JSON-RPC):
 *   1. initialize handshake against dist/index.js
 *   2. tools/list — expects the 5 consolidated tools, $ref-free input AND
 *      output schemas, additionalProperties: false (strict), viewer tool
 *      UI metadata, and the absence of the tools removed in R6
 *   3. resources/list — expects the document-viewer UI resource
 *   4. one cheap globalise_find_archival_documents call (local SQLite, no
 *      network), checking both the text channel and structuredContent
 *   5. incompatible-filter combo returns a structured tool error (R7)
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
  'globalise_find_archival_documents',
  'globalise_view_document_ui',
];

// Consolidated into globalise_search_transcriptions (R6)
const REMOVED_TOOLS = ['globalise_search_by_inventory', 'globalise_search_by_language'];

// Data tools registered via registerJsonTool (strict input + output schema)
const DATA_TOOLS = EXPECTED_TOOLS.filter((t) => t !== 'globalise_view_document_ui');

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
  check(Boolean(client.getInstructions()), 'server instructions present');

  console.log('2. tools/list');
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  check(tools.length === EXPECTED_TOOLS.length, `exactly ${EXPECTED_TOOLS.length} tools (got: ${tools.length})`);
  for (const expected of EXPECTED_TOOLS) {
    check(names.includes(expected), `tool registered: ${expected}`);
  }
  for (const removed of REMOVED_TOOLS) {
    check(!names.includes(removed), `tool removed (R6): ${removed}`);
  }
  for (const tool of tools) {
    check(!hasRef(tool.inputSchema), `$ref-free inputSchema: ${tool.name}`);
    check(tool.annotations?.readOnlyHint === true, `readOnlyHint: ${tool.name}`);
  }
  // Strict schemas: unknown params rejected, not stripped (viewer tool uses a
  // raw shape via registerAppTool, so strictness applies to the data tools)
  for (const tool of tools.filter((t) => DATA_TOOLS.includes(t.name))) {
    check(
      (tool.inputSchema as { additionalProperties?: boolean }).additionalProperties === false,
      `strict (additionalProperties: false): ${tool.name}`,
    );
    // R8: structured output on by default (STRUCTURED_CONTENT=false strips it)
    check(tool.outputSchema !== undefined, `outputSchema registered: ${tool.name}`);
    check(!hasRef(tool.outputSchema), `$ref-free outputSchema: ${tool.name}`);
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
  const structured = result.structuredContent as { total?: { value?: number } } | undefined;
  check(
    typeof structured?.total?.value === 'number',
    'structuredContent mirrors the result (R8)',
  );

  console.log('5. tools/call with incompatible filters (R7)');
  const conflict = await client.callTool({
    name: 'globalise_find_archival_documents',
    arguments: { source: 'all', settlement: 'Batavia', chamber: 'Amsterdam', size: 1 },
  });
  check(conflict.isError === true, 'incompatible settlement+chamber combo returns a tool error');
  const conflictContent = conflict.content as Array<{ type: string; text?: string }>;
  const conflictPayload = JSON.parse(conflictContent[0]?.text ?? '{}');
  check(typeof conflictPayload.suggestion === 'string', 'error carries a suggestion');

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
