#!/usr/bin/env node

/**
 * GLOBALISE MCP Server
 *
 * MCP server for searching and retrieving Dutch East India Company (VOC)
 * historical transcriptions from the GLOBALISE project.
 *
 * Provides tools to:
 * - Search across ~4.8M transcriptions
 * - Retrieve detailed document information
 * - Navigate between document pages
 * - Filter by inventory numbers
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
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Import tool implementations
import {
  searchSimple,
  searchSimpleInputSchema,
} from './tools/search.js';
import {
  getDocumentSimple,
  getDocumentSimpleInputSchema,
} from './tools/document.js';
import {
  searchByInventory,
  searchByInventoryInputSchema,
  navigate,
  navigateInputSchema,
  searchByLanguage,
  searchByLanguageInputSchema,
} from './tools/convenience.js';
import {
  findArchivalDocuments,
  findArchivalDocumentsInputSchema,
} from './tools/archival-index.js';
import { closeDatabase } from './utils/database.js';
import {
  viewDocumentUi,
  viewDocumentUiInputSchema,
} from './tools/document-viewer.js';

export const SERVER_NAME = 'globalise-mcp-server';
export const SERVER_VERSION = '1.25.0';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract viewer URLs from tool results and format as markdown links
 */
function extractViewerLinks(result: Record<string, unknown>, toolName: string): string[] {
  const links: string[] = [];

  if (toolName === 'globalise_retrieve_document') {
    // Document retrieval: single document with urls.transcriptionsViewer
    const urls = result.urls as { transcriptionsViewer?: string } | undefined;
    const docId = result.document as string | undefined;
    if (urls?.transcriptionsViewer) {
      const label = docId || 'Document';
      links.push(`[${label}](${urls.transcriptionsViewer})`);
    }
  } else if (toolName === 'globalise_navigate') {
    // Navigation: target document with urls.transcriptionsViewer
    const target = result.targetDocument as { document?: string; urls?: { transcriptionsViewer?: string } } | undefined;
    if (target?.urls?.transcriptionsViewer) {
      const label = target.document || 'Target page';
      links.push(`[${label}](${target.urls.transcriptionsViewer})`);
    }
  } else if (toolName === 'globalise_search_transcriptions' ||
             toolName === 'globalise_search_by_inventory' ||
             toolName === 'globalise_search_by_language') {
    // Search results: array of results with viewerUrl
    const results = result.results as Array<{ document?: string; viewerUrl?: string }> | undefined;
    if (results && results.length > 0) {
      // Limit to first 10 results to avoid overwhelming output
      const maxLinks = Math.min(results.length, 10);
      for (let i = 0; i < maxLinks; i++) {
        const r = results[i];
        if (r.viewerUrl) {
          const label = r.document || `Result ${i + 1}`;
          links.push(`[${label}](${r.viewerUrl})`);
        }
      }
      if (results.length > 10) {
        links.push(`... and ${results.length - 10} more results`);
      }
    }
  }

  return links;
}

/**
 * Extract a readable message and optional suggestion from thrown values.
 *
 * Handles three error shapes:
 * - Error instances (Zod validation, standard errors)
 * - ApiError plain objects from api-client.ts (thrown as { type, error, suggestion, ... })
 * - Any other thrown values (coerced to string)
 */
function formatError(error: unknown): { message: string; suggestion?: string } {
  if (error instanceof Error) {
    return { message: error.message };
  }

  if (typeof error === 'object' && error !== null && 'error' in error) {
    const apiError = error as { error: string; suggestion?: string };
    return { message: apiError.error, suggestion: apiError.suggestion };
  }

  return { message: String(error) };
}

/**
 * Cross-cutting post-processing applied to every data tool's result:
 * serialize to JSON and append the clickable viewer-links markdown block.
 */
function toolResponse(toolName: string, result: unknown): CallToolResult {
  const responseText = JSON.stringify(result, null, 2);

  // Debug logging (enable with DEBUG=true environment variable)
  if (process.env.DEBUG === 'true') {
    console.error(`[TOOL] ${toolName} - Response length: ${responseText.length} chars`);
    if (!responseText || responseText.length === 0) {
      console.error(`[TOOL] WARNING: Empty response for ${toolName}!`);
    }
  }

  const content: CallToolResult['content'] = [
    {
      type: 'text',
      text: responseText,
    },
  ];

  // Extract viewer URLs and format as clickable markdown links
  const viewerLinks = extractViewerLinks(result as Record<string, unknown>, toolName);

  if (viewerLinks.length > 0) {
    const linksSection = viewerLinks.length === 1
      ? `\n\n**View in Transcriptions Viewer:**\n${viewerLinks[0]}`
      : `\n\n**View in Transcriptions Viewer:**\n${viewerLinks.map((link, i) => `${i + 1}. ${link}`).join('\n')}`;

    content.push({
      type: 'text',
      text: linksSection,
    });
  }

  return { content };
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
      }, null, 2),
    }],
    isError: true,
  };
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

/**
 * Register a read-only JSON tool, wrapping its handler with the shared
 * post-processing (viewer links block) and error formatting.
 *
 * The schema is registered with .strict() so unknown params are rejected
 * instead of silently stripped; the SDK validates input (and applies Zod
 * defaults) before the handler runs.
 */
function registerJsonTool<Schema extends z.ZodObject<z.ZodRawShape>>(
  server: McpServer,
  name: string,
  description: string,
  schema: Schema,
  handler: (input: z.output<Schema>) => Promise<unknown>,
): void {
  server.registerTool(
    name,
    {
      description,
      inputSchema: schema.strict(),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args): Promise<CallToolResult> => {
      try {
        return toolResponse(name, await handler(args as z.output<Schema>));
      } catch (error) {
        return errorResponse(name, error);
      }
    },
  );
}

// UI Resource URI for Document Viewer
const DOCUMENT_VIEWER_RESOURCE_URI = 'ui://globalise/document-viewer.html';

/**
 * Load the Document Viewer UI HTML
 */
function loadDocumentViewerHtml(): string {
  const htmlPath = path.join(__dirname, '..', 'dist', 'apps', 'index.html');

  try {
    return fs.readFileSync(htmlPath, 'utf-8');
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
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

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
                // Static resources: IIIF images, CDN scripts/styles
                resourceDomains: [
                  'https://service.archief.nl',      // IIIF images
                  'https://cdn.jsdelivr.net',        // OpenSeadragon
                  'https://unpkg.com',               // ext-apps SDK
                ],
                // Network requests: API endpoints
                connectDomains: [
                  'https://gloccoli.tt.di.huc.knaw.nl',
                  'https://annorepo.globalise.huygens.knaw.nl',
                  'https://globalise.tt.di.huc.knaw.nl',
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
    '**PRIMARY SEARCH TOOL** - Search across all 4.8M Dutch East India Company (VOC) historical transcriptions by keywords, phrases, or patterns. ' +
      '\n\n**USE WHEN:** User wants to find documents containing specific text, names, places, or terms. ' +
      'Examples: "find documents about pepper", "search for mentions of Batavia", "documents containing coffee trade". ' +
      '\n\n**FEATURES:** Boolean operators (AND/OR/NOT for combining terms), wildcards (* for multiple chars, ? for single char), ' +
      'fuzzy matching (~N for similar spellings), exact phrases in quotes. ' +
      '\n\n**FILTERS:** Language codes (e.g., ["nld"] for Dutch, ["fas"] for Persian, ["art"] for Cipher), inventory numbers (e.g., "9966"). ' +
      '\n\n**LANGUAGE CLASSIFICATION NOTES:** ' +
      '(1) "unknown" means the language has not yet been classified, not that it is unidentifiable. ' +
      '(2) "Cipher" (code "art") refers to encrypted Dutch text. The code "art" is ISO 639-3 for artificial/constructed languages, but GLOBALISE uses it for encrypted documents which are actually Dutch (nld) written in cipher. ' +
      '\n\n**NON-ROMAN SCRIPT WARNING:** This corpus was machine-transcribed using a model trained only on Latin (Roman) characters. ' +
      'Transcriptions of languages with non-Roman scripts (Persian, Bengali, Tamil, Sinhala, Classical Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic, Ancient Greek, Ancient Hebrew) will be unreliable/gibberish. ' +
      'For these languages, always offer the user the National Archives page scan link from the document metadata. ' +
      '\n\n**MALAY NOTE:** The code "msa" refers to a macrolanguage (multiple Malay varieties), and some pages may be in romanized Malay while others use non-Roman script. No script metadata is available, so always offer page scan links for Malay documents. ' +
      '\n\n**TOKENIZER:** Standard tokenizer - punctuation is stripped automatically (so "peper" finds "peper,"), and special characters like hyphens are word separators (so "oost-indie" = "oost indie"). ' +
      '\n\n**RETURNS:** Paginated results with highlighted text fragments PLUS aggregations showing language distribution, inventory counts, and document counts. ' +
      '\n\n**RESULT LIMITS:** Default: 10 results. For larger analysis, explicitly request up to 500 results (e.g., size=100, size=250, size=500). ' +
      'Note: Large result sets consume more context window. ' +
      '\n\n**GETTING STATISTICS:** To get language distribution or metadata for an inventory without retrieving full documents, use query="*" with size=1. ' +
      'Example: For inventory 4293 language breakdown, use query="*", inventoryNumber="4293", size=1. Returns aggregations with language counts while minimizing result payload. ' +
      '\n\n**DO NOT USE FOR:** (1) Retrieving a known document by ID → use globalise_retrieve_document instead. ' +
      '(2) Sequential page browsing → use globalise_navigate instead.',
    searchSimpleInputSchema,
    searchSimple,
  );

  registerJsonTool(
    server,
    'globalise_retrieve_document',
    '**GET SPECIFIC DOCUMENT** - Retrieve complete details for a document when you have its ID or URN. ' +
      '\n\n**USE WHEN:** User provides a document ID (e.g., "NL-HaNA_1.04.02_9966_0106") or wants full text/metadata for a known document. ' +
      'Examples: "get document NL-HaNA_1.04.02_9966_0106", "show me the full text of urn:globalise:...", "retrieve metadata for document X". ' +
      '\n\n**REQUIRES:** Document ID in format "NL-HaNA_{archive}_{inventory}_{scan}" or full URN "urn:globalise:...". ' +
      '\n\n**RETURNS:** (1) Full transcribed text line-by-line and concatenated, (2) Metadata including languages, dates, creator, license, ' +
      '(3) Navigation links to previous/next page IDs, (4) National Archives URL for viewing page scan (always present as clickable link). ' +
      '\n\n**DO NOT USE FOR:** (1) Searching by keywords → use globalise_search_transcriptions instead. ' +
      '(2) Navigating to next/previous page → use globalise_navigate instead (it handles retrieval automatically).',
    getDocumentSimpleInputSchema,
    getDocumentSimple,
  );

  registerJsonTool(
    server,
    'globalise_navigate',
    '**PAGE NAVIGATION** - Move to the previous or next page from a given document for sequential browsing through archival materials. ' +
      '\n\n**USE WHEN:** User wants to browse pages sequentially, explore neighboring scans, or navigate through a document page-by-page. ' +
      'Examples: "show me the next page", "go to the previous page from document X", "navigate forward in this inventory". ' +
      '\n\n**REQUIRES:** (1) Current document ID or URN, (2) Direction: "next", "previous", or "prev". ' +
      '\n\n**RETURNS:** Full details of the target page including text, metadata, and navigation links. ' +
      'If no next/previous page exists, returns error message. ' +
      '\n\n**DO NOT USE FOR:** (1) Searching by keywords → use globalise_search_transcriptions. ' +
      '(2) Getting a specific known document → use globalise_retrieve_document.',
    navigateInputSchema,
    navigate,
  );

  registerJsonTool(
    server,
    'globalise_search_by_inventory',
    '**INVENTORY-SCOPED SEARCH** - Search within a specific inventory number. Inventories contain hundreds of documents (e.g., inventory 4293 has 535 documents). ' +
      '\n\n**USE WHEN:** User mentions an inventory number and wants to search within it or get statistics about it. ' +
      'Examples: "search inventory 9966 for coffee", "find documents in inventory 2174 about trade", "what languages are in inventory 4293?". ' +
      '\n\n**REQUIRES:** Inventory number (e.g., "9966", "4293"). Optional: search query, language filters. ' +
      '\n\n**RETURNS:** Paginated results showing only documents from the specified inventory, with highlighted text fragments and aggregations including language distribution. ' +
      '\n\n**FOR STATISTICS ONLY:** Use query="*" with size=1 to get language counts without retrieving full documents.',
    searchByInventoryInputSchema,
    searchByInventory,
  );

  registerJsonTool(
    server,
    'globalise_search_by_language',
    '**LANGUAGE-SPECIFIC SEARCH** - Find documents in one or more languages across all inventories. ' +
      '\n\n**USE WHEN:** User wants only documents in a particular language, or bilingual/multilingual documents. ' +
      'Examples: "find all Persian documents", "search for Dutch documents about pepper", "find bilingual Dutch-English documents", "documents in both Portuguese and Dutch". ' +
      '\n\n**REQUIRES:** Language(s) as ISO code (e.g., "fas", "nld", "ben") OR human-readable name (e.g., "Persian", "Dutch", "Bengali"). ' +
      'Single: "Persian" or ["Persian"]. Multiple: ["Dutch", "English"] or ["nld", "eng"]. ' +
      '\n\n**MULTI-LANGUAGE:** Use matchAll=true to find documents containing ALL specified languages (bilingual/multilingual). ' +
      'Default (matchAll=false) finds documents with ANY of the specified languages. ' +
      'IMPORTANT: Put the non-Dutch language FIRST (Dutch is 97% of the corpus, so any other language is always rarer). ' +
      'Example: language=["eng", "nld"], matchAll=true → finds English-Dutch bilingual docs. ' +
      '\n\n**SUPPORTS:** Many languages including Western European (Dutch, French, English, Latin, Portuguese, Spanish, German, Danish, Italian), ' +
      'South Asian (Persian, Bengali, Tamil, Sinhala, Gujarati), East Asian (Classical Chinese, Japanese, Malay, Buginese), and others (Old Church Slavonic, Ancient Greek, Ancient Hebrew). ' +
      '\n\n**LANGUAGE CLASSIFICATION NOTES:** ' +
      '(1) "unknown" means the language has not yet been classified, not that it is unidentifiable. ' +
      '(2) "Cipher" (code "art") refers to encrypted Dutch text. The code "art" is ISO 639-3 for artificial/constructed languages, but GLOBALISE uses it for encrypted documents which are actually Dutch (nld) written in cipher. ' +
      '\n\n**NON-ROMAN SCRIPT WARNING:** This corpus was machine-transcribed using a model trained only on Latin (Roman) characters. ' +
      'Transcriptions of languages with non-Roman scripts (Persian, Bengali, Tamil, Sinhala, Classical Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic, Ancient Greek, Ancient Hebrew) will be unreliable/gibberish. ' +
      'For these languages, always offer the user the National Archives page scan link from the document metadata. ' +
      '\n\n**MALAY NOTE:** The code "msa" refers to a macrolanguage (multiple Malay varieties), and some pages may be in romanized Malay while others use non-Roman script. No script metadata is available, so always offer page scan links for Malay documents. ' +
      '\n\n**RETURNS:** Documents in specified language(s) with inventory distribution counts. When matchAll=true, includes only bilingual/multilingual documents.',
    searchByLanguageInputSchema,
    searchByLanguage,
  );

  registerJsonTool(
    server,
    'globalise_find_archival_documents',
    '**ARCHIVAL INDEX SEARCH** - Query local database of 228K+ VOC archival document indexes (OBP + Generale Missiven) to find documents by metadata before searching transcriptions. ' +
      '\n\n**USE WHEN:** User wants to scope a search using archival metadata like settlement, year range, folio numbers, or needs finding aid information. ' +
      'Examples: "find documents about Ceylon from 1720-1750", "what inventories have documents about Batavia?", "find Generale Missiven from Amsterdam chamber", ' +
      '"locate documents near folio 700 in inventory 1543". ' +
      '\n\n**DATA SOURCES:** ' +
      '(1) OBP (Digitized Indexes): ~227K document entries with settlement, year, folio, inventory, description. ' +
      '(2) GM (Generale Missiven): ~950 official letters with dates, chambers (Amsterdam/Zeeland), RGP references, scan URLs. ' +
      '\n\n**WORKFLOW:** Use this tool first to identify relevant inventories/folios, then use globalise_search_transcriptions or globalise_retrieve_document to access actual transcribed text. ' +
      '\n\n**FILTERS:** source (obp/gm/all), full-text query in descriptions, inventoryNumber, settlement (OBP), yearFrom/To, folioFrom/To (OBP, with inventory), chamber (GM), htrAvailable (GM). ' +
      '\n\n**RETURNS:** Document metadata with inventory numbers, descriptions, year ranges, and aggregations for scoping. GM results include National Archives scan URLs. ' +
      '\n\n**CONNECTION TO TRANSCRIPTIONS:** Inventory numbers link to transcription search. Use inventoryNumber from results with globalise_search_by_inventory to find transcribed pages.',
    findArchivalDocumentsInputSchema,
    findArchivalDocuments,
  );

  // ==========================================================================
  // Document viewer MCP App tool (dual-content response: human-readable
  // summary + full JSON for the viewer iframe; retired only by R8+R19)
  // ==========================================================================

  registerAppTool(
    server,
    'globalise_view_document_ui',
    {
      description:
        '**INTERACTIVE DOCUMENT VIEWER** - Display a VOC document with scanned page image and transcription side-by-side. ' +
        '\n\n**USE WHEN:** User wants to see a document visually with the page scan and transcription together. ' +
        'Examples: "show me document NL-HaNA_1.04.02_9966_0106", "view this page with the image", "display the scan and text". ' +
        '\n\n**REQUIRES:** Document ID in format "NL-HaNA_{archive}_{inventory}_{scan}" or full URN. ' +
        '\n\n**FEATURES:** IIIF image viewer with zoom/pan/rotation, transcribed text with line numbers, search term highlighting. ' +
        '\n\n**TEXT SELECTION:** When the user selects text in the transcription panel, they typically want a translation of those words. ' +
        'Provide a translation from 17th/18th century Dutch to modern English. ' +
        '\n\n**RETURNS:** Interactive UI with split view showing scanned page and transcription.',
      inputSchema: viewDocumentUiInputSchema.shape,
      annotations: READ_ONLY_ANNOTATIONS,
      _meta: {
        ui: {
          resourceUri: DOCUMENT_VIEWER_RESOURCE_URI,
        },
      },
    },
    async (args): Promise<CallToolResult> => {
      try {
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

        // Return both human-readable and JSON for compatibility
        return {
          content: [
            { type: 'text', text: humanReadable },
            { type: 'text', text: JSON.stringify(docResult, null, 2) },
          ],
        };
      } catch (error) {
        return errorResponse('globalise_view_document_ui', error);
      }
    },
  );

  return server;
}

/**
 * Start the server with the specified transport
 */
async function main() {
  const transportMode = process.env.TRANSPORT || 'stdio';

  if (transportMode === 'http' || transportMode === 'sse') {
    // Streamable HTTP transport for remote access (stateless; fresh server per request)
    const { createHttpServer } = await import('./transports/http-server.js');

    const port = parseInt(process.env.PORT || '3000', 10);
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

    createHttpServer({ port, allowedOrigins, createServer });
  } else {
    // Stdio transport (default) for Claude Desktop integration
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('GLOBALISE MCP Server running on stdio');
  }
}

function shutdown(signal: string) {
  console.error(`[SHUTDOWN] ${signal} received, cleaning up...`);
  closeDatabase();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
