/**
 * Stdio smoke test for the GLOBALISE MCP server.
 *
 * Uses the SDK's Client + StdioClientTransport (never shell-piped JSON-RPC):
 *   1. initialize handshake against dist/index.js
 *   2. tools/list — expects the 6 consolidated tools, $ref-free input AND
 *      output schemas, additionalProperties: false (strict), viewer tool
 *      UI metadata, and the absence of the tools removed in R6
 *   3. resources/list — expects the document-viewer UI resource
 *   4. one cheap globalise_find_archival_documents call (local SQLite, no
 *      network), checking both the text channel and structuredContent
 *   5. incompatible-filter combo returns a structured tool error (R7)
 *   6. malformed document ID returns a structured tool error before any
 *      upstream call (R13)
 *
 * Run with: npm run test:smoke (requires a prior npm run build)
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish } from './test-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverEntry = path.join(__dirname, '..', 'dist', 'index.js');

const EXPECTED_TOOLS = [
  'globalise_search_transcriptions',
  'globalise_retrieve_document',
  'globalise_navigate',
  'globalise_find_archival_documents',
  'globalise_lookup_commodity',
  'globalise_lookup_measure',
  'globalise_view_document_ui',
];

// Consolidated into globalise_search_transcriptions (R6)
const REMOVED_TOOLS = ['globalise_search_by_inventory', 'globalise_search_by_language'];

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
    // Strict schemas: unknown params rejected, not stripped. All five tools are
    // strict — the four data tools via registerJsonTool's .strict() variants,
    // and the viewer via the strict schema passed through registerAppTool
    // (v2.5.4; it previously shipped a non-strict raw shape).
    check(
      (tool.inputSchema as { additionalProperties?: boolean }).additionalProperties === false,
      `strict (additionalProperties: false): ${tool.name}`,
    );
    // R8: structured output on by default (STRUCTURED_CONTENT=false strips it);
    // the viewer's outputSchema is registered behind the same gate (v2.5.4).
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

  console.log('4b. tools/call globalise_lookup_commodity (reference DB)');
  // A real call is the only thing that exercises the SDK's validation of
  // structuredContent against the tool's output schema.
  const commodity = await client.callTool({
    name: 'globalise_lookup_commodity',
    arguments: { query: 'peper', size: 2 },
  });
  check(!commodity.isError, 'commodity lookup succeeded (isError not set)');
  const commodityContent = commodity.content as Array<{ type: string; text?: string }>;
  const commodityPayload = JSON.parse(commodityContent[0]?.text ?? '{}');
  check(
    typeof commodityPayload.total?.value === 'number' && commodityPayload.total.value > 0,
    `commodity results found (total: ${commodityPayload.total?.value})`,
  );
  check(
    Array.isArray(commodityPayload.results?.[0]?.altLabels),
    'commodity result carries an altLabels array (query-expansion contract)',
  );

  /** Call a tool expecting a structured error; returns the parsed error payload. */
  async function expectToolError(
    name: string,
    args: Record<string, unknown>,
    label: string,
  ): Promise<{ suggestion?: unknown }> {
    const errResult = await client.callTool({ name, arguments: args });
    check(errResult.isError === true, label);
    const errContent = errResult.content as Array<{ type: string; text?: string }>;
    return JSON.parse(errContent[0]?.text ?? '{}');
  }

  console.log('5. tools/call with incompatible filters (R7)');
  const conflictPayload = await expectToolError(
    'globalise_find_archival_documents',
    { source: 'all', settlement: 'Batavia', chamber: 'Amsterdam', size: 1 },
    'incompatible settlement+chamber combo returns a tool error',
  );
  check(typeof conflictPayload.suggestion === 'string', 'error carries a suggestion');

  console.log('6. tools/call with malformed document ID (R13, no network)');
  const badIdPayload = await expectToolError(
    'globalise_retrieve_document',
    { documentId: 'not-a-valid-id' },
    'malformed document ID returns a tool error',
  );
  check(
    typeof badIdPayload.suggestion === 'string' && badIdPayload.suggestion.includes('NL-HaNA'),
    'error suggestion shows the expected ID format',
  );

  await client.close();

  finish('Smoke test');
}

main().catch((error) => {
  console.error('Smoke test crashed:', error);
  process.exit(1);
});
