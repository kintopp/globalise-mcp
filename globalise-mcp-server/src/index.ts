#!/usr/bin/env node

/**
 * GLOBALISE MCP Server
 *
 * MCP server for searching and retrieving Dutch East India Company (VOC)
 * historical transcriptions from the GLOBALISE project.
 *
 * Provides tools to:
 * - Search across ~4.8M transcriptions (with inventory/language filters)
 * - Retrieve detailed document information
 * - Navigate between document pages
 * - Query the local archival index (OBP + Generale Missiven)
 * - View documents with interactive UI (MCP Apps)
 *
 * All registration lives in createServer() so every transport connection
 * gets its own Server instance (the SDK binds exactly one transport per
 * server). Stdio mode calls it once; HTTP mode calls it per request.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Import tool implementations
import {
  searchTranscriptions,
  searchTranscriptionsInputSchema,
  searchOutputSchema,
} from './tools/search.js';
import {
  getDocument,
  getDocumentInputSchema,
  getDocumentOutputSchema,
} from './tools/document.js';
import {
  navigate,
  navigateInputSchema,
  navigateOutputSchema,
} from './tools/convenience.js';
import {
  findArchivalDocuments,
  findArchivalDocumentsInputSchema,
  findArchivalDocumentsOutputSchema,
} from './tools/archival-index.js';
import {
  lookupCommodity,
  lookupCommodityInputSchema,
  lookupCommodityOutputSchema,
} from './tools/commodities.js';
import {
  lookupMeasure,
  lookupMeasureInputSchema,
  lookupMeasureOutputSchema,
} from './tools/measures.js';
import { closeDatabase } from './utils/database.js';
import { resolveVersion, resolveCommit } from './utils/build-info.js';
import { ToolError } from './utils/errors.js';
import { VIEWER_URL_PREFIX } from './utils/api-client.js';
import { FTS_OPERATORS, FTS_AUTOQUOTE } from './utils/fts.js';
import {
  fitResultToBudget,
  recordListTrim,
  searchResultTrim,
  documentLineTrim,
  navigateLineTrim,
  viewerTranscriptionTrim,
  type TrimStrategy,
} from './utils/response-size.js';
import {
  viewDocumentUi,
  viewDocumentUiInputSchema,
  viewDocumentUiOutputSchema,
} from './tools/document-viewer.js';
import {
  inspectPageImage,
  inspectPageImageInputSchema,
  inspectPageImageOutputSchema,
} from './tools/page-image.js';
import {
  navigateViewer,
  navigateViewerInputSchema,
  navigateViewerOutputSchema,
  pollViewerCommandsOutputSchema,
} from './tools/viewer-commands.js';
import { viewerQueues } from './utils/viewer-session.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SERVER_NAME = 'globalise-mcp-server';

/**
 * Version + commit reported at /health and as the MCP `version`. The version is
 * derived from the git tag of a published GitHub release (tag `v1.2.0` → `1.2.0`),
 * not a hand-bumped package.json — see src/utils/build-info.ts for the full
 * precedence chain (baked dist stamp → live git → package.json). Both resolvers
 * take __dirname so they read the right dist/ stamp whether built or run via tsx.
 */
export const SERVER_VERSION = resolveVersion(__dirname);
export const SERVER_COMMIT = resolveCommit(__dirname);

/**
 * Structured output gate (R8): outputSchema + structuredContent are on by
 * default; set STRUCTURED_CONTENT=false for clients that reject them
 * (observed with MSTY and Jan.ai). The text channel stays the primary
 * payload either way.
 */
const STRUCTURED_CONTENT_ENABLED = process.env.STRUCTURED_CONTENT !== 'false';

/**
 * Response-size budget, derived from the documented platform per-result ceiling
 * (claude.ai/Desktop ~150,000 chars). Keep 20% headroom for JSON-RPC framing.
 * Override the ceiling per deployment with RESULT_CHAR_CEILING.
 */
const PLATFORM_RESULT_CHAR_CEILING = Number(process.env.RESULT_CHAR_CEILING) || 150_000;
const SAFE_RESULT_BUDGET = Math.round(PLATFORM_RESULT_CHAR_CEILING * 0.8);

/**
 * The shared result is serialized into up to two copies today: the text block
 * (always — currently a full JSON copy the model reads on claude.ai) and
 * structuredContent. Anthropic documents a ~150K character per-result ceiling,
 * but does not specify whether/how structuredContent is counted relative to
 * text. Until host behavior is clearer, budget conservatively as if duplicated
 * data in both channels can pressure the same result/session limit.
 *
 * FUTURE: once the host fleet reads structuredContent, the text channel can
 * become a small summary/marker that no longer duplicates the data — set
 * RESPONSE_TEXT_DUPLICATES_DATA=false to drop the text copy from the count and
 * reclaim ~2x capacity. (Implementing the summary text channel itself is a
 * separate, deferred change — see plans/README.md.)
 */
const TEXT_CHANNEL_DUPLICATES_DATA = process.env.RESPONSE_TEXT_DUPLICATES_DATA !== 'false';

function effectiveResultBudgetBytes(): number {
  const copies = (STRUCTURED_CONTENT_ENABLED ? 1 : 0) + (TEXT_CHANNEL_DUPLICATES_DATA ? 1 : 0);
  return Math.floor(SAFE_RESULT_BUDGET / Math.max(1, copies));
}

/** structuredContent mirror of a tool result, behind the R8 gate — spread into every non-error CallToolResult. */
function structuredPayload(result: unknown): Pick<CallToolResult, 'structuredContent'> {
  return STRUCTURED_CONTENT_ENABLED
    ? { structuredContent: result as Record<string, unknown> }
    : {};
}

/**
 * Corpus-level caveats, stated once per connection instead of duplicated
 * across tool descriptions (R10).
 */
const SERVER_INSTRUCTIONS = `GLOBALISE serves machine transcriptions (HTR) of ~4.8M pages of Dutch East India Company (VOC) records, 17th-18th century, mostly early-modern Dutch. Document IDs look like NL-HaNA_1.04.02_9966_0106 ({archive}_{inventory}_{scan}); any page can be opened in the web viewer at ${VIEWER_URL_PREFIX}{id}.

Corpus caveats that apply to every tool:
- Language metadata: "unknown" means not yet classified, not unidentifiable. The code "art" ("Cipher") marks encrypted Dutch text, not an artificial language. The language aggregation counts only pages carrying transcribed text: blank pages (\`tokenCount\` 0) have no language at all, so the facet can sum to less than the page total — that shortfall is blank pages, not a classification gap.
- Scans are not always one page: many inventories are photographed as two-page openings, and line order follows the layout analysis, so both halves and their marginal columns interleave. Consecutive lines are therefore not necessarily consecutive text — use globalise_inspect_page_image or the viewer when reading order matters for a quotation.
- The HTR model was trained on Latin script only: transcriptions of non-Roman-script languages (Persian, Bengali, Tamil, Sinhala, Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic, Ancient Greek, Ancient Hebrew) are unreliable gibberish — offer the user the National Archives page-scan link from the document metadata instead. Malay ("msa") is a macrolanguage with no script metadata, so offer scan links for it too.
- The search tokenizer strips punctuation and treats hyphens as word separators ("oost-indie" matches like "oost indie").
- Response size: to stay within the client's per-result limit, the four list tools (globalise_search_transcriptions, globalise_find_archival_documents, globalise_lookup_commodity, globalise_lookup_measure) may return fewer than the requested \`size\` — \`pagination.hasMore\` is then true and a \`note\` states how many of how many results were kept; recover the rest by paging with a higher \`from\`, narrowing filters, or lowering \`size\` (or \`fragmentSize\` for search). globalise_retrieve_document and globalise_navigate may likewise drop trailing transcription lines on dense pages, signaled by \`text.truncated\` + \`text.totalLines\`. The reported total count is never affected by either trim.
- Typical workflow: scope with globalise_find_archival_documents (local finding aids), search transcriptions, then retrieve or view individual pages. Two local glossaries resolve VOC vocabulary alongside search — globalise_lookup_commodity (trade good → the Dutch term the corpus uses, a sourced definition, and any period spelling variants) and globalise_lookup_measure (unit of weight/volume/length → its type, spelling variants, and period conversion ratios). globalise_inspect_page_image fetches a page scan (or a region of it) as an image for the assistant's own visual reading — call it when the user highlights a region in the document viewer, or to re-transcribe a specific passage as a second opinion on the HTR. globalise_navigate_viewer zooms/pans the user's open viewer to a region (viewUUID from globalise_view_document_ui).`;

/**
 * Per-tool builders that turn a result into clickable viewer markdown links,
 * passed to registerJsonTool so each registration declares its own links —
 * no tool-name matching to keep in sync. Search results carry no per-row
 * viewerUrl field (R9): links are built from the result id here, in the one
 * place users actually click them.
 */
type ViewerLinksBuilder = (result: Record<string, unknown>) => string[];

/** Single retrieved document with urls.transcriptionsViewer. */
const documentViewerLinks: ViewerLinksBuilder = (result) => {
  const urls = result.urls as { transcriptionsViewer?: string } | undefined;
  const docId = result.document as string | undefined;
  return urls?.transcriptionsViewer
    ? [`[${docId || 'Document'}](${urls.transcriptionsViewer})`]
    : [];
};

/** Navigation target document with urls.transcriptionsViewer. */
const navigateViewerLinks: ViewerLinksBuilder = (result) => {
  const target = result.targetDocument as { document?: string; urls?: { transcriptionsViewer?: string } } | undefined;
  return target?.urls?.transcriptionsViewer
    ? [`[${target.document || 'Target page'}](${target.urls.transcriptionsViewer})`]
    : [];
};

/** Search results: build links from result ids (limit to first 10). */
const searchViewerLinks: ViewerLinksBuilder = (result) => {
  const links: string[] = [];
  const results = result.results as Array<{ id?: string; document?: string }> | undefined;
  if (results && results.length > 0) {
    const maxLinks = Math.min(results.length, 10);
    for (let i = 0; i < maxLinks; i++) {
      const r = results[i];
      if (r.id) {
        const label = r.document || `Result ${i + 1}`;
        links.push(`[${label}](${VIEWER_URL_PREFIX}${r.id})`);
      }
    }
    if (results.length > 10) {
      links.push(`... and ${results.length - 10} more results`);
    }
  }
  return links;
};

/**
 * Extract a readable message and optional suggestion from thrown values.
 *
 * Handles four error shapes:
 * - ToolError (message + suggestion, thrown by tool input validation)
 * - other Error instances (Zod validation, standard errors)
 * - ApiError plain objects from api-client.ts (thrown as { type, error, suggestion, ... })
 * - Any other thrown values (coerced to string)
 */
function formatError(error: unknown): { message: string; suggestion?: string } {
  if (error instanceof ToolError) {
    return { message: error.message, suggestion: error.suggestion };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  if (typeof error === 'object' && error !== null && 'error' in error) {
    const apiError = error as { error: string; suggestion?: string };
    return { message: apiError.error, suggestion: apiError.suggestion };
  }

  // Any other object carrying a string `message` (e.g. a future thrown shape):
  // surface it rather than coercing the whole object to "[object Object]"
  // (CODE-REVIEW finding 20; the deeper fix — making ApiError a class so this
  // duck-typing goes away — is deferred, see TODO/CHANGELOG).
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const e = error as { message: unknown; suggestion?: unknown };
    if (typeof e.message === 'string') {
      return { message: e.message, suggestion: typeof e.suggestion === 'string' ? e.suggestion : undefined };
    }
  }

  return { message: String(error) };
}

/**
 * Cross-cutting post-processing applied to every data tool's result:
 * serialize to compact JSON (R9), append the clickable viewer-links
 * markdown block, and mirror the result as structuredContent (R8).
 */
function toolResponse(toolName: string, result: unknown, viewerLinks: string[]): CallToolResult {
  const responseText = JSON.stringify(result);

  // Debug logging (enable with DEBUG=true environment variable)
  if (process.env.DEBUG === 'true') {
    console.error(`[TOOL] ${toolName} - Response length: ${responseText.length} chars`);
  }

  const content: CallToolResult['content'] = [
    {
      type: 'text',
      text: responseText,
    },
  ];

  if (viewerLinks.length > 0) {
    const linksSection = viewerLinks.length === 1
      ? `\n\n**View in Transcriptions Viewer:**\n${viewerLinks[0]}`
      : `\n\n**View in Transcriptions Viewer:**\n${viewerLinks.map((link, i) => `${i + 1}. ${link}`).join('\n')}`;

    content.push({
      type: 'text',
      text: linksSection,
    });
  }

  return {
    content,
    ...structuredPayload(result),
  };
}

/**
 * Format thrown errors as tool execution errors (isError: true) per SEP-1303.
 */
function errorResponse(toolName: string, error: unknown): CallToolResult {
  const { message, suggestion } = formatError(error);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: message,
        ...(suggestion && { suggestion }),
        tool: toolName,
      }),
    }],
    isError: true,
  };
}

/**
 * The outputSchema registration field, behind the R8 gate: present only when
 * structured output is enabled (the SDK then requires + validates
 * structuredContent on every non-error result). Single source for the gate,
 * shared by the JSON-tool and app-tool registrations (CODE-REVIEW finding 20).
 */
function outputSchemaField<T>(outputSchema: T): { outputSchema: T } | Record<string, never> {
  return STRUCTURED_CONTENT_ENABLED ? { outputSchema } : {};
}

/**
 * Run a tool handler, formatting any throw as an isError result (SEP-1303).
 * Shared by registerJsonTool and the app-tool handler — their success paths
 * differ (content shape) but their error path is identical (finding 20).
 *
 * Also emits one JSON line per call on stderr — `{tool, ms, ok, error?,
 * input?}` — the family-shared shape (rijksmuseum-mcp-plus `withLogging`,
 * iconclass `registration.ts`), so `railway logs --json` feeds the same
 * analysis pipeline across the sibling servers. `log: false` opts a tool out
 * (only globalise_poll_viewer_commands: the viewer iframe polls it every
 * 1-4 s, which would drown the log — the same exemption rijksmuseum makes).
 */
async function runTool(
  name: string,
  fn: () => Promise<CallToolResult>,
  opts: { input?: unknown; log?: boolean } = {},
): Promise<CallToolResult> {
  const start = performance.now();
  let result: CallToolResult;
  let thrown: string | undefined;
  try {
    result = await fn();
  } catch (error) {
    thrown = error instanceof Error ? error.message : String(error);
    result = errorResponse(name, error);
  }
  if (opts.log !== false) {
    const ms = Math.round(performance.now() - start);
    const ok = result.isError !== true;
    console.error(JSON.stringify({
      tool: name,
      ms,
      ok,
      ...(thrown !== undefined && { error: thrown }),
      ...(opts.input !== undefined && { input: opts.input }),
    }));
  }
  return result;
}

const READ_ONLY_BASE = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

/**
 * Read-only tools that call the live GLOBALISE / Nationaal Archief / IIIF
 * services — an open world. (Per the MCP spec openWorldHint defaults to true
 * when omitted, so this just makes the assumed default explicit.)
 */
const EXTERNAL_READ_ONLY = { ...READ_ONLY_BASE, openWorldHint: true } as const;

/**
 * Read-only tools that read only the bundled/local SQLite glossaries and
 * finding-aid index — a closed, bounded world. This is the substantive hint
 * correction: without it, clients assume these local-lookup tools touch an
 * open world. (The thin-.mcpb one-time index download is provisioning, not the
 * query-time interaction domain, so the searched domain is still closed.)
 */
const LOCAL_READ_ONLY = { ...READ_ONLY_BASE, openWorldHint: false } as const;

/**
 * Viewer-session tools (globalise_navigate_viewer, globalise_poll_viewer_commands)
 * mutate the in-memory command queue: NOT read-only, NOT idempotent, but
 * closed-world and non-destructive (rijksmuseum ANN_VIEWER parity). The smoke
 * test asserts readOnlyHint per-tool because of this exception.
 */
const VIEWER_SESSION = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

/**
 * Register a read-only JSON tool, wrapping its handler with the shared
 * post-processing (viewer links block, structuredContent) and error
 * formatting.
 *
 * The input schema must be pre-derived with .strict() (see the module-scope
 * consts below) so unknown params are rejected instead of silently stripped;
 * the SDK validates input (and applies Zod defaults) before the handler runs.
 * The output schema is registered only when structured output is enabled —
 * the SDK then requires and validates structuredContent on every non-error
 * result.
 */
function registerJsonTool<Schema extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  name: string,
  description: string,
  schema: Schema,
  outputSchema: z.ZodTypeAny,
  handler: (input: z.output<Schema>) => Promise<unknown>,
  annotations: typeof EXTERNAL_READ_ONLY | typeof LOCAL_READ_ONLY,
  trimStrategy?: TrimStrategy,
  viewerLinks?: ViewerLinksBuilder,
): void {
  server.registerTool(
    name,
    {
      description,
      // Cast to the concrete constraint: the SDK's conditional callback type
      // does not resolve against a bare generic type parameter
      inputSchema: schema as z.ZodObject<z.ZodRawShape>,
      ...outputSchemaField(outputSchema),
      annotations,
    },
    async (args): Promise<CallToolResult> =>
      runTool(name, async () => {
        const result = await handler(args as z.output<Schema>) as Record<string, unknown>;
        fitResultToBudget(result, trimStrategy, effectiveResultBudgetBytes());
        const links = viewerLinks?.(result) ?? [];
        return toolResponse(name, result, links);
      }, { input: args }),
  );
}

/**
 * .strict() variants derived once at module scope: createServer() runs per
 * HTTP request, so deriving them inside registerJsonTool would repeat the
 * work on every request.
 */
const searchToolInputSchema = searchTranscriptionsInputSchema.strict();
const retrieveToolInputSchema = getDocumentInputSchema.strict();
const navigateToolInputSchema = navigateInputSchema.strict();
const findArchivalToolInputSchema = findArchivalDocumentsInputSchema.strict();
const lookupCommodityToolInputSchema = lookupCommodityInputSchema.strict();
const lookupMeasureToolInputSchema = lookupMeasureInputSchema.strict();
const viewDocumentUiToolInputSchema = viewDocumentUiInputSchema.strict();
const inspectPageImageToolInputSchema = inspectPageImageInputSchema.strict();
const navigateViewerToolInputSchema = navigateViewerInputSchema.strict();
const pollViewerCommandsInputSchema = z.object({ viewUUID: z.string() }).strict();

// UI Resource URI and tool name for the Document Viewer MCP App
const DOCUMENT_VIEWER_RESOURCE_URI = 'ui://globalise/document-viewer.html';
const VIEW_DOCUMENT_UI_TOOL_NAME = 'globalise_view_document_ui';

/**
 * Load the Document Viewer UI HTML. The built file is static for the life of
 * the process, so successful reads are cached; only the not-yet-built case
 * re-probes the disk (so a dev build is picked up without a restart).
 */
let documentViewerHtml: string | undefined;

function loadDocumentViewerHtml(): string {
  if (documentViewerHtml !== undefined) {
    return documentViewerHtml;
  }

  const htmlPath = path.join(__dirname, '..', 'dist', 'apps', 'index.html');

  try {
    documentViewerHtml = fs.readFileSync(htmlPath, 'utf-8');
    return documentViewerHtml;
  } catch {
    // Fallback error message if UI hasn't been built
    return `<!DOCTYPE html>
<html>
<head><title>GLOBALISE Document Viewer</title></head>
<body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
  <div style="text-align:center;color:#666;">
    <h1>Document Viewer Not Built</h1>
    <p>Run <code>npm run build:ui</code> to build the viewer.</p>
  </div>
</body>
</html>`;
  }
}

/**
 * Create a fully configured MCP server instance.
 *
 * Called once for stdio, and once per request for stateless Streamable HTTP.
 * Cheap: the tool registry is static and the SQLite handle / caches are
 * module-scope singletons shared across instances.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // ==========================================================================
  // MCP Apps UI resource (document viewer HTML with CSP metadata)
  // ==========================================================================

  registerAppResource(
    server,
    'GLOBALISE Document Viewer',
    DOCUMENT_VIEWER_RESOURCE_URI,
    {
      description: 'Interactive document viewer for VOC transcriptions with IIIF images',
    },
    async () => ({
      contents: [
        {
          uri: DOCUMENT_VIEWER_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadDocumentViewerHtml(),
          // CSP configuration per MCP Apps spec (McpUiResourceCsp)
          _meta: {
            ui: {
              csp: {
                // Static resources: IIIF images only — OpenSeadragon and the
                // ext-apps SDK are bundled into the viewer HTML (R11)
                resourceDomains: [
                  'https://service.archief.nl',
                ],
                // Network requests: API endpoints, plus service.archief.nl for
                // the viewer's IIIF info.json fetch (deep-zoom, R19).
                // globalise.tt.di.huc.knaw.nl (TextRepo) was dropped: the
                // viewer never calls it — transcription text arrives
                // pre-resolved from Broccoli as views.self.lines — and the
                // service is Basic-auth gated (401) as of 2026-08.
                connectDomains: [
                  'https://gloccoli.tt.di.huc.knaw.nl',
                  'https://annorepo.globalise.huygens.knaw.nl',
                  'https://service.archief.nl',
                ],
              },
            },
          },
        },
      ],
    }),
  );

  // ==========================================================================
  // Data tools
  // ==========================================================================

  registerJsonTool(
    server,
    'globalise_search_transcriptions',
    'Full-text search of GLOBALISE VOC (Dutch East India Company) transcriptions. ' +
      '~4.8M HTR-transcribed pages from the Nationaal Archief (1.04.02), 17th-18th century. ' +
      'Free-text query over the page transcriptions: covers the full corpus, with filters for inventory number(s) and language(s). ' +
      'Query syntax (Elasticsearch): a bare space means OR — use uppercase AND for all-terms; plus NOT, wildcards (* ?), fuzzy matching (~N, for HTR/OCR spelling noise), exact phrases in quotes; query defaults to "*" (match everything). ' +
      'Languages accept ISO 639-3 codes or English names; matchAll=true requires pages to contain ALL listed languages (bilingual documents) by post-filtering a capped candidate window — totals are then a lower bound, see the response note. ' +
      'Returns paginated hits with highlighted fragments, plus language/inventory/document aggregations. ' +
      'For statistics only (e.g. the language breakdown of an inventory), use query="*" with size=1. ' +
      `Each result id can be opened in the web viewer at ${VIEWER_URL_PREFIX}{id}. ` +
      'For a known document ID use globalise_retrieve_document. ' +
      'Use fragmentSize to trade snippet length for response size (lower = smaller, default 200).',
    searchToolInputSchema,
    searchOutputSchema,
    searchTranscriptions,
    EXTERNAL_READ_ONLY,
    searchResultTrim,
    searchViewerLinks,
  );

  registerJsonTool(
    server,
    'globalise_retrieve_document',
    "Retrieve one page's transcription and metadata by document ID or URN. " +
      'IDs look like "NL-HaNA_{archive}_{inventory}_{scan}" (URN form: "urn:globalise:..."). ' +
      'Returns the transcription line-by-line, metadata (languages, dates, license), previous/next page IDs, ' +
      'and links to the web viewer and the National Archives page scan. ' +
      'On very dense pages trailing lines may be trimmed to fit the response — text.truncated is then true and text.totalLines gives the full count (use globalise_view_document_ui for the complete page). ' +
      'To search by keywords use globalise_search_transcriptions; for sequential browsing use globalise_navigate.',
    retrieveToolInputSchema,
    getDocumentOutputSchema,
    getDocument,
    EXTERNAL_READ_ONLY,
    documentLineTrim,
    documentViewerLinks,
  );

  registerJsonTool(
    server,
    'globalise_navigate',
    'Fetch the previous or next page in a GLOBALISE VOC inventory. ' +
      'Sequential reading through Dutch East India Company records (Nationaal Archief 1.04.02), relative to a document ID. ' +
      'Returns the target page\'s details (text, metadata, links); on very dense pages trailing transcription lines may be trimmed to fit the response (flagged by text.truncated + text.totalLines). Errors if no page exists in that direction.',
    navigateToolInputSchema,
    navigateOutputSchema,
    navigate,
    EXTERNAL_READ_ONLY,
    navigateLineTrim,
    navigateViewerLinks,
  );

  registerJsonTool(
    server,
    'globalise_find_archival_documents',
    'Search finding-aid metadata to scope the archive before full-text search. ' +
      'A local index of 228K+ entries. ' +
      'Two sources: OBP digitized indexes (~227K entries: settlement, year, folio, inventory, description) and GM Generale Missiven (~950 official letters: chamber, dates, scan URLs, and — for the ~558 published in RGP — published-edition links to Retroboeken scans + GitHub plain text). ' +
      'The query field uses SQLite FTS5 — ' + FTS_OPERATORS + ', and (expr) grouping. ' + FTS_AUTOQUOTE + ' ' +
      'Note: settlement is OBP-only; chamber/htrAvailable are GM-only; folio filters require an inventoryNumber. ' +
      'Inventory numbers in the results feed the inventoryNumber filter of globalise_search_transcriptions to reach the actual transcribed pages.',
    findArchivalToolInputSchema,
    findArchivalDocumentsOutputSchema,
    findArchivalDocuments,
    LOCAL_READ_ONLY,
    recordListTrim,
  );

  registerJsonTool(
    server,
    'globalise_lookup_commodity',
    'Resolve a trade good to the historical term the corpus uses, with a definition. ' +
      'A ~3,500-entry glossary: bilingual labels plus a sourced, confidence-rated definition per concept. ' +
      'Two main uses: (1) resolve a modern/English term to the historical, predominantly Dutch word the corpus uses (coffee→koffie, mace→foelie); (2) read a sourced definition. Some concepts also carry period spelling variants (altLabels), but only ~10% do — pepper, coffee, nutmeg have none — so for recall in globalise_search_transcriptions take the Dutch label, OR in any altLabels, then add fuzzy (~1)/wildcards (the corpus prefers c- over k-, -ij over -ie: koffie→coffij). ' +
      'The query field uses SQLite FTS5 over labels + variants + definitions — ' + FTS_OPERATORS + '; label/variant hits rank above definition hits. Omit the query to page through the glossary alphabetically. ' +
      'Every definition carries its definitionSource and a confidence rating — over half are LLM-generated, so present low/medium-low ones tentatively, say only what the definition states, and prefer the authoritative sources (wnt, aat, vocGlossarium, PoolParty). prefLabelEn is occasionally a mistranslation — prefer the definition. The raw concept ID stays internal, but each result includes thesaurusUrl, a public permalink to the concept in the GLOBALISE thesaurus (its SKOS hierarchy of broader/narrower terms + cited source, often a Zotero record) — offer it when a user wants to place a good in its trade taxonomy or follow its source.',
    lookupCommodityToolInputSchema,
    lookupCommodityOutputSchema,
    lookupCommodity,
    LOCAL_READ_ONLY,
    recordListTrim,
  );

  registerJsonTool(
    server,
    'globalise_lookup_measure',
    'Look up historical weights and measures and their conversion ratios. ' +
      '~213 units of weight, volume, length, area, quantity, and misc, from the 1764–1771 Memoriën van Munten, Maaten, en Gewigten. ' +
      'Each result reliably carries: the unit label, its type (weight/volume/length/area/quantities/misc — load-bearing, since a few labels like roede/voet are homonyms distinguished only by type), period spelling variants, and the conversion ratios it appears in (~731 across the dataset). ' +
      'This is NOT a precise unit converter: early-modern units were unstable, so a ratio holds only for the settlement and commodity it was recorded for (a bahar of pepper ≠ a bahar of cloves) — always read each conversion against its `context` field, and do not convert to modern equivalents without it. The context often pins the commodity as well as the place (e.g. "rijst, Batavia", "goud, zilver, Mokka"), and the same unit\'s ratio routinely differs by good — so the context is where the commodity-specific value lives, not just the prose definition. A self-referential ratio ("1 X = 1 X") attests the unit was used in that context without a recorded local equivalence. ' +
      'Spelling variants double as query expansion: feed them into globalise_search_transcriptions (which is spelling-blind) to catch documents a modern spelling misses. ' +
      'Definitions are sparse (only ~22% of units carry any, mostly Dutch) — a bonus, not the core; most units have none. ' +
      'The query field uses SQLite FTS5 over label + variants + definition text — ' + FTS_OPERATORS + '; label/variant hits rank above definition hits. ' + FTS_AUTOQUOTE + ' Omit the query to page through the unit list alphabetically.',
    lookupMeasureToolInputSchema,
    lookupMeasureOutputSchema,
    lookupMeasure,
    LOCAL_READ_ONLY,
    recordListTrim,
  );

  // ==========================================================================
  // Page-image inspection: returns an MCP `image` content block for the
  // calling LLM's own visual reading. Registered directly (not via
  // registerJsonTool): the result must NOT be JSON-serialized into the text
  // channel and must NOT pass through fitResultToBudget — base64 is not
  // trimmable JSON, and hosts meter images separately from text results.
  // ==========================================================================

  server.registerTool(
    'globalise_inspect_page_image',
    {
      description:
        "Returns page-scan image bytes for the assistant's own visual analysis. " +
        'Fetches the scan (base64) — whole page or a region of it. Not for the user to view: use globalise_view_document_ui for the interactive viewer. Not for finding pages: use globalise_search_transcriptions. ' +
        "Use region 'full' (default) to see the whole page, or a region to zoom into details: read a specific passage, a name, a numeral, marginalia, seals, or stamps. " +
        "Call it when the user highlights a region in the document viewer — a chat message or context note like \"[Highlight: region pct:31.2,18.4,22.0,6.1 on document NL-HaNA_1.04.02_9966_0106]\" — passing that documentId and region verbatim. " +
        "Region coordinates: 'pct:x,y,w,h' (percentage of the full image, recommended), 'crop_pixels:x,y,w,h' (pixels of the full image — use with nativeWidth/nativeHeight from a prior response), or 'x,y,w,h' (legacy IIIF pixels). Quick reference: top-left quarter pct:0,0,50,50; bottom-right quarter pct:50,50,50,50; center strip pct:25,25,50,50; whole page 'full'. " +
        "The response includes nativeWidth/nativeHeight (the scan's true pixel size) and cropPixelWidth/cropPixelHeight (the returned crop's size). The size is clamped so crops are never upscaled; request up to 2016px for small handwriting, and quality 'gray' can help with faint ink. " +
        'The corpus transcriptions are machine HTR: use this tool to re-transcribe a specific passage as a second opinion where the HTR looks garbled (strongest on short passages, proper names, numerals, and marginalia; on long dense text the HTR is often the better reading — say so). Transcribe what you actually see and flag uncertain readings. Especially valuable on non-Latin-script pages (Persian, Tamil, Chinese, ...), where the Latin-script HTR is known-unreliable. ' +
        "Auto-navigation: when a viewer is open for this page, it automatically zooms to the inspected region (navigateViewer defaults to true). Use globalise_navigate_viewer separately to steer the user's open viewer to a region without fetching bytes for your own analysis.",
      inputSchema: inspectPageImageToolInputSchema as z.ZodObject<z.ZodRawShape>,
      ...outputSchemaField(inspectPageImageOutputSchema),
      annotations: EXTERNAL_READ_ONLY,
    },
    async (args): Promise<CallToolResult> =>
      runTool('globalise_inspect_page_image', async () => {
        const input = args as z.output<typeof inspectPageImageInputSchema>;
        const result = await inspectPageImage(input);
        if (!result.ok) {
          // Parity with rijksmuseum's cropError: structured error carrying the
          // recovery payload in BOTH channels, so a structuredContent reader
          // can self-correct without parsing prose. (The SDK validates
          // structuredContent only on non-error results, so this is safe.)
          const errorMeta = {
            documentId: input.documentId,
            region: input.region,
            rotation: input.rotation,
            quality: input.quality,
            error: result.error,
            ...(result.recovery && {
              regionRecovery: {
                requested: result.recovery.requested,
                clampedTo: result.recovery.clampedTo,
                validRange: result.recovery.validRange,
              },
            }),
          };
          const hint = result.recovery
            ? ` Nearest valid region: ${result.recovery.clampedTo} (${result.recovery.validRange}).`
            : '';
          return {
            content: [{ type: 'text', text: result.text ?? `${result.error}.${hint}` }],
            ...structuredPayload(errorMeta),
            isError: true,
          };
        }
        return {
          content: [
            { type: 'image', data: result.image.base64, mimeType: result.image.mimeType },
            { type: 'text', text: result.caption },
          ],
          ...structuredPayload(result.meta),
        };
      }, { input: args }),
  );

  // ==========================================================================
  // Reverse channel (plan 021): globalise_navigate_viewer lets the model steer
  // an already-open viewer — zoom/pan to a region — by pushing commands into a
  // server-side per-viewUUID queue that the iframe drains via
  // globalise_poll_viewer_commands. These MUTATE session state, so they carry
  // VIEWER_SESSION annotations (not read-only).
  // ==========================================================================

  server.registerTool(
    'globalise_navigate_viewer',
    {
      description:
        "Zooms or pans the user's already-open page viewer to a region. " +
        'Use it to steer the user\'s view to a detail. ' +
        'Requires a viewUUID from a prior globalise_view_document_ui call (the viewer must be open). ' +
        'Not for opening the viewer — use globalise_view_document_ui. Not for visual analysis — use globalise_inspect_page_image (which also auto-zooms the open viewer to whatever it inspects).\n\n' +
        'By default, region coordinates are in full-image space (percentages or pixels of the original scan), not relative to the current viewport — the same pct:x,y,w,h used in globalise_inspect_page_image targets the identical area here. Exception: when a command includes relativeTo, region is interpreted in that inspected crop\'s local coordinate space.\n\n' +
        'For an accurate zoom, inspect the target area with globalise_inspect_page_image FIRST, verify the region contains what you expect, then use the same or refined coordinates here — do not estimate positions from memory.\n\n' +
        "Region formats: 'pct:x,y,w,h' (percentage of the full scan), 'crop_pixels:x,y,w,h' (pixels of the full scan — bound with nativeWidth/nativeHeight from globalise_inspect_page_image; when used with relativeTo + relativeToSize it is instead pixels within that crop), 'x,y,w,h' (legacy IIIF pixels), or 'full' | 'square'. Out-of-bounds regions are rejected with a recovery hint — correct and retry.\n\n" +
        'Coordinate shortcut: to zoom to a sub-region of a prior inspect crop, pass relativeTo with the crop\'s region string and give region in crop-local coordinates (pct: directly, or crop_pixels: with relativeToSize:{width:cropPixelWidth,height:cropPixelHeight}) — the server projects to full-image space deterministically.\n\n' +
        'The deliveryState field says whether the iframe drained the commands immediately (delivered_recently), the viewer exists but has not polled recently so the commands are queued (queued_waiting_for_viewer — typical when scrolled offscreen), or no viewer has connected yet (no_live_viewer_seen). In the queued case the command is preserved server-side and applies when the viewer resumes polling — do NOT narrate this as a delivery failure. no_live_viewer_seen is normal in the first few seconds after globalise_view_document_ui returns (the widget iframe starts polling only once the host renders it) — the queued commands apply on its first poll, so there is no need to wait or re-send. An unknown or expired viewUUID is a different, explicit error (sessions expire after ~30 min idle; re-open with globalise_view_document_ui). Host caveat: the reverse channel requires the host\'s MCP Apps bridge to support app-initiated tool calls (serverTools) — on hosts without it the iframe never polls and queued commands are never delivered; the response says so once the viewer is >30s old, and globalise_inspect_page_image is the host-independent way to show a detail.',
      inputSchema: navigateViewerToolInputSchema as z.ZodObject<z.ZodRawShape>,
      ...outputSchemaField(navigateViewerOutputSchema),
      annotations: VIEWER_SESSION,
    },
    async (args): Promise<CallToolResult> =>
      runTool('globalise_navigate_viewer', async () => {
        const input = args as z.output<typeof navigateViewerInputSchema>;
        const result = await navigateViewer(input);
        return {
          content: [{ type: 'text', text: result.text }],
          ...structuredPayload(result.data),
          ...(result.ok ? {} : { isError: true as const }),
        };
      }, { input: args }),
  );

  // Poll tool: app-only (_meta.ui.visibility: ['app'], NO resourceUri). The
  // iframe polls this via app.callServerTool() and reads the result directly; a
  // resource template bound to a hidden tool is contradictory (and ChatGPT
  // warns on it). A missing queue returns { commands: [] }, never an error.
  registerAppTool(
    server,
    'globalise_poll_viewer_commands',
    {
      title: 'Poll Viewer Commands',
      description: 'Internal: poll for pending viewer navigation commands.',
      inputSchema: pollViewerCommandsInputSchema as unknown as typeof pollViewerCommandsInputSchema.shape,
      ...outputSchemaField(pollViewerCommandsOutputSchema as unknown as typeof pollViewerCommandsOutputSchema.shape),
      annotations: VIEWER_SESSION,
      _meta: { ui: { visibility: ['app'] } },
    },
    async (args): Promise<CallToolResult> =>
      runTool('globalise_poll_viewer_commands', async () => {
        const { viewUUID } = args as { viewUUID: string };
        const queue = viewerQueues.get(viewUUID);
        if (!queue) {
          return {
            content: [{ type: 'text', text: 'No pending commands' }],
            ...structuredPayload({ commands: [] }),
          };
        }
        queue.lastAccess = Date.now();
        queue.lastPolledAt = Date.now();
        const commands = queue.commands.splice(0);  // drain
        return {
          content: [{ type: 'text', text: commands.length ? `${commands.length} commands polled` : 'No pending commands' }],
          ...structuredPayload({ commands }),
        };
      }, { log: false }),
  );

  // ==========================================================================
  // Document viewer MCP App tool. The viewer iframe reads structuredContent
  // (R19); the legacy dual-content shape (summary + full JSON as a second
  // text block) is kept only for STRUCTURED_CONTENT=false clients.
  // ==========================================================================

  registerAppTool(
    server,
    VIEW_DOCUMENT_UI_TOOL_NAME,
    {
      description:
        'Display a page for the user in an interactive scan-plus-transcription viewer. ' +
        'Shows a zoomable IIIF scan image beside its line-numbered transcription. ' +
        'Takes a document ID or URN; supports optional search-term highlighting. ' +
        'When the user selects text in the transcription panel they typically want a translation of those words from 17th/18th-century Dutch to modern English.',
      // Pass the strict schema at runtime (registerAppTool forwards it verbatim
      // to registerTool, which honors .strict() and rejects unknown params),
      // but type it as a raw shape: the wrapper's generics infer InputArgs from
      // both this value and the ToolCallback arg, and a full ZodObject collides
      // with the ZodRawShapeCompat arm. registerJsonTool casts for the same
      // reason. A plain .shape would be non-strict — hence the strict value.
      inputSchema: viewDocumentUiToolInputSchema as unknown as typeof viewDocumentUiInputSchema.shape,
      // outputSchema only when structured output is enabled: once set, the SDK
      // requires a matching structuredContent on every non-error result, and
      // the STRUCTURED_CONTENT=false branch below emits none.
      ...outputSchemaField(viewDocumentUiOutputSchema as unknown as typeof viewDocumentUiOutputSchema.shape),
      annotations: EXTERNAL_READ_ONLY,
      _meta: {
        ui: {
          resourceUri: DOCUMENT_VIEWER_RESOURCE_URI,
        },
      },
    },
    async (args): Promise<CallToolResult> =>
      runTool(VIEW_DOCUMENT_UI_TOOL_NAME, async () => {
        const docResult = await viewDocumentUi(args);

        // Guard the host's per-result byte ceiling: a single dense page's
        // transcription can exceed it, and unlike the JSON tools this path never
        // trimmed, so the host could reject the whole result. This result is
        // emitted as ONE metered copy — structuredContent, or a lone JSON text
        // block when STRUCTURED_CONTENT=false; the human-readable summary below
        // carries only the line COUNT, not the lines — so it meters against the
        // full SAFE_RESULT_BUDGET rather than the per-copy budget the JSON tools
        // use. That ~2x headroom is deliberate: globalise_retrieve_document points
        // users here "for the complete page" when it truncates, so the viewer must
        // trim only in the rare case a page exceeds even the full budget.
        const totalLines = docResult.transcription.length;
        fitResultToBudget(
          docResult as unknown as Record<string, unknown>,
          viewerTranscriptionTrim,
          SAFE_RESULT_BUDGET,
        );
        const linesTrimmed = docResult.transcription.length < totalLines;

        // Return human-readable summary + JSON data for MCP Apps UI
        const humanReadable = [
          `Document: ${docResult.id}`,
          `Inventory: ${docResult.metadata.inventory}, Scan: ${docResult.metadata.scan}`,
          `Languages: ${docResult.metadata.languages.map((l) => l.label).join(', ')}`,
          linesTrimmed
            ? `Lines: ${docResult.transcription.length} of ${totalLines} (trailing lines trimmed to fit the response; open ${docResult.urls.viewer} for the complete page)`
            : `Lines: ${docResult.transcription.length}`,
          docResult.navigation.prev ? `Previous: ${docResult.navigation.prev}` : 'No previous page',
          docResult.navigation.next ? `Next: ${docResult.navigation.next}` : 'No next page',
          docResult.viewUUID ? `viewUUID: ${docResult.viewUUID}` : '',
          '',
          `View in GLOBALISE: ${docResult.urls.viewer}`,
          docResult.urls.archive ? `National Archives: ${docResult.urls.archive}` : '',
          '',
          '**Note:** If the user selects text or interacts with the viewer, check widget context for the latest state.',
        ]
          .filter(Boolean)
          .join('\n');

        // Viewer reads structuredContent when the host forwards it — but
        // Claude Desktop's STDIO apps bridge strips structuredContent from the
        // ontoolresult it hands the iframe (observed 2026-08-03: the widget
        // received only the human-readable block and showed "Error parsing
        // document", while the HTTP bridge delivered the same result intact).
        // So over stdio always emit the dual-content shape whose JSON block
        // the viewer's fallback parser reads; over HTTP the lone-text shape
        // stays (one metered copy), with the JSON block only for
        // STRUCTURED_CONTENT=false hosts.
        const dualContent = !STRUCTURED_CONTENT_ENABLED || (process.env.TRANSPORT || 'stdio') !== 'http';
        return {
          content: dualContent
            ? [
                { type: 'text', text: humanReadable },
                { type: 'text', text: JSON.stringify(docResult) },
              ]
            : [{ type: 'text', text: humanReadable }],
          ...structuredPayload(docResult),
        };
      }, { input: args }),
  );

  return server;
}

/**
 * Start the server with the specified transport
 */
async function main() {
  const transportMode = process.env.TRANSPORT || 'stdio';

  if (transportMode === 'http') {
    // Streamable HTTP transport for remote access (stateless; fresh server per request)
    const { createHttpServer } = await import('./transports/http-server.js');

    const port = parseInt(process.env.PORT || '3000', 10);
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

    httpServer = createHttpServer({ port, allowedOrigins, name: SERVER_NAME, version: SERVER_VERSION, commit: SERVER_COMMIT, createServer });
  } else {
    // Stdio transport (default) for Claude Desktop integration
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('GLOBALISE MCP Server running on stdio');
  }
}

/**
 * Grace period for draining in-flight HTTP requests on shutdown. Railway sends
 * SIGTERM, waits, then SIGKILLs; this backstop forces exit if a connection
 * never closes, so we never hang past the platform's window.
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** The running HTTP listener (set only in http mode), so shutdown() can drain it. */
let httpServer: Server | undefined;

/**
 * Graceful shutdown. In HTTP mode, stop accepting new connections and let
 * in-flight /mcp requests finish before closing the DB and exiting — a bare
 * exit cuts every in-flight response on each Railway redeploy (finding 5).
 * Stdio mode has no listener to drain, so it exits synchronously.
 */
function shutdown(signal: string) {
  console.error(`[SHUTDOWN] ${signal} received, cleaning up...`);

  if (!httpServer) {
    closeDatabase();
    process.exit(0);
  }

  // Backstop: if a connection never closes, exit anyway before SIGKILL. unref()
  // so this timer alone can't keep the process alive once draining is done.
  const forceExit = setTimeout(() => {
    console.error('[SHUTDOWN] drain timed out; forcing exit');
    closeDatabase();
    process.exit(0);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  // Stop accepting new connections and release idle keep-alive sockets, so
  // close() waits only on requests still in flight, then tear down once they
  // finish.
  httpServer.closeIdleConnections();
  httpServer.close(() => {
    clearTimeout(forceExit);
    closeDatabase();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
