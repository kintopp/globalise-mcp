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
import { ToolError } from './utils/errors.js';
import { VIEWER_URL_PREFIX } from './utils/api-client.js';
import { FTS_OPERATORS, FTS_AUTOQUOTE } from './utils/fts.js';
import {
  fitResultToBudget,
  recordListTrim,
  searchResultTrim,
  type TrimStrategy,
} from './utils/response-size.js';
import {
  viewDocumentUi,
  viewDocumentUiInputSchema,
  viewDocumentUiOutputSchema,
} from './tools/document-viewer.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SERVER_NAME = 'globalise-mcp-server';

/**
 * Single source of truth for the version (R15): package.json. Works from
 * both dist/index.js and src/index.ts (tsx) — the package root is one level
 * up either way.
 */
export const SERVER_VERSION = (
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')) as { version: string }
).version;

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
 * The shared result is serialized into up to two METERED copies today: the text
 * block (always — currently a full JSON copy the model reads on claude.ai) and
 * structuredContent (read by ChatGPT now, by Claude soon). Both count toward the
 * host ceiling, so the shared data must fit `budget / copies`.
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
- Language metadata: "unknown" means not yet classified, not unidentifiable. The code "art" ("Cipher") marks encrypted Dutch text, not an artificial language.
- The HTR model was trained on Latin script only: transcriptions of non-Roman-script languages (Persian, Bengali, Tamil, Sinhala, Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic, Ancient Greek, Ancient Hebrew) are unreliable gibberish — offer the user the National Archives page-scan link from the document metadata instead. Malay ("msa") is a macrolanguage with no script metadata, so offer scan links for it too.
- The search tokenizer strips punctuation and treats hyphens as word separators ("oost-indie" matches like "oost indie").
- Typical workflow: scope with globalise_find_archival_documents (local finding aids), search transcriptions, then retrieve or view individual pages. Two local glossaries resolve VOC vocabulary alongside search — globalise_lookup_commodity (trade good → the Dutch term the corpus uses, a sourced definition, and any period spelling variants) and globalise_lookup_measure (unit of weight/volume/length → its type, spelling variants, and period conversion ratios).`;

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
 */
async function runTool(name: string, fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (error) {
    return errorResponse(name, error);
  }
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
      }),
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
                // the viewer's IIIF info.json fetch (deep-zoom, R19)
                connectDomains: [
                  'https://gloccoli.tt.di.huc.knaw.nl',
                  'https://annorepo.globalise.huygens.knaw.nl',
                  'https://globalise.tt.di.huc.knaw.nl',
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
    'Search the ~4.8M transcribed VOC pages by free text, with filters for inventory number(s) and language(s). ' +
      'Query syntax (Elasticsearch): a bare space means OR — use uppercase AND for all-terms; plus NOT, wildcards (* ?), fuzzy matching (~N, for HTR/OCR spelling noise), exact phrases in quotes; query defaults to "*" (match everything). ' +
      'Languages accept ISO 639-3 codes or English names; matchAll=true requires pages to contain ALL listed languages (bilingual documents) by post-filtering a capped candidate window — totals are then a lower bound, see the response note. ' +
      'Returns paginated hits with highlighted fragments, plus language/inventory/document aggregations. ' +
      'For statistics only (e.g. the language breakdown of an inventory), use query="*" with size=1. ' +
      `Each result id can be opened in the web viewer at ${VIEWER_URL_PREFIX}{id}. ` +
      'For a known document ID use globalise_retrieve_document. ' +
      'Use fragmentSize to trade snippet length for response size (lower = smaller, default 150).',
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
    'Retrieve one page by document ID ("NL-HaNA_{archive}_{inventory}_{scan}") or URN ("urn:globalise:..."). ' +
      'Returns the full transcription line-by-line, metadata (languages, dates, license), previous/next page IDs, ' +
      'and links to the web viewer and the National Archives page scan. ' +
      'To search by keywords use globalise_search_transcriptions; for sequential browsing use globalise_navigate.',
    retrieveToolInputSchema,
    getDocumentOutputSchema,
    getDocument,
    EXTERNAL_READ_ONLY,
    undefined,
    documentViewerLinks,
  );

  registerJsonTool(
    server,
    'globalise_navigate',
    'Fetch the previous or next page relative to a document ID, to read through archival materials sequentially. ' +
      'Returns the target page\'s full details (text, metadata, links); errors if no page exists in that direction.',
    navigateToolInputSchema,
    navigateOutputSchema,
    navigate,
    EXTERNAL_READ_ONLY,
    undefined,
    navigateViewerLinks,
  );

  registerJsonTool(
    server,
    'globalise_find_archival_documents',
    'Search a local index of 228K+ VOC finding-aid entries to scope by metadata before searching transcriptions. ' +
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
    'Look up VOC trade goods in a ~3,500-entry glossary: bilingual labels plus a sourced, confidence-rated definition. ' +
      'Two main uses: (1) resolve a modern/English term to the Dutch word the corpus uses (coffee→koffie, mace→foelie); (2) read a sourced definition. Some concepts also carry period spelling variants (altLabels), but only ~10% do — pepper, coffee, nutmeg have none — so for recall in globalise_search_transcriptions take the Dutch label, OR in any altLabels, then add fuzzy (~1)/wildcards (the corpus prefers c- over k-, -ij over -ie: koffie→coffij). ' +
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
    'Look up VOC weights & measures: ~213 historical units of weight, volume, length, area, quantity, and misc. ' +
      'They come from the 1764–1771 Memoriën van Munten, Maaten, en Gewigten. ' +
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
  // Document viewer MCP App tool. The viewer iframe reads structuredContent
  // (R19); the legacy dual-content shape (summary + full JSON as a second
  // text block) is kept only for STRUCTURED_CONTENT=false clients.
  // ==========================================================================

  registerAppTool(
    server,
    VIEW_DOCUMENT_UI_TOOL_NAME,
    {
      description:
        'Display a VOC page in an interactive viewer: a zoomable IIIF scan image beside its line-numbered transcription. ' +
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

        // Return human-readable summary + JSON data for MCP Apps UI
        const humanReadable = [
          `Document: ${docResult.id}`,
          `Inventory: ${docResult.metadata.inventory}, Scan: ${docResult.metadata.scan}`,
          `Languages: ${docResult.metadata.languages.map((l) => l.label).join(', ')}`,
          `Lines: ${docResult.transcription.length}`,
          docResult.navigation.prev ? `Previous: ${docResult.navigation.prev}` : 'No previous page',
          docResult.navigation.next ? `Next: ${docResult.navigation.next}` : 'No next page',
          '',
          `View in GLOBALISE: ${docResult.urls.viewer}`,
          docResult.urls.archive ? `National Archives: ${docResult.urls.archive}` : '',
          '',
          '**Note:** If the user selects text or interacts with the viewer, check widget context for the latest state.',
        ]
          .filter(Boolean)
          .join('\n');

        // Viewer reads structuredContent; the JSON-as-second-text-block shape
        // survives only behind the STRUCTURED_CONTENT=false gate
        return {
          content: STRUCTURED_CONTENT_ENABLED
            ? [{ type: 'text', text: humanReadable }]
            : [
                { type: 'text', text: humanReadable },
                { type: 'text', text: JSON.stringify(docResult) },
              ],
          ...structuredPayload(docResult),
        };
      }),
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

    httpServer = createHttpServer({ port, allowedOrigins, name: SERVER_NAME, version: SERVER_VERSION, createServer });
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
