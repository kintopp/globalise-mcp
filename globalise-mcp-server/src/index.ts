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
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

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

// Import resource definitions
import { RESOURCES, readResource } from './resources/index.js';

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
 * Tool definitions for MCP
 *
 * Note: Claude Desktop can handle 100+ tools, but performance degrades with many tools
 * due to context window consumption. Simplified schemas are used for broad client compatibility.
 */
const TOOLS: Tool[] = [
  // CRITICAL tools (simplified schemas for Claude Desktop compatibility)
  {
    name: 'globalise_search_transcriptions',
    description:
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
      '\n\n**REFERENCE:** Query syntax guide available at globalise://help/query-syntax resource. ' +
      '\n\n**DO NOT USE FOR:** (1) Retrieving a known document by ID → use globalise_retrieve_document instead. ' +
      '(2) Sequential page browsing → use globalise_navigate instead.',
    inputSchema: zodToJsonSchema(searchSimpleInputSchema) as Tool['inputSchema'],
    // outputSchema removed for broad client compatibility (MSTY, Jan.ai, etc.)
    // These clients have issues with outputSchema - they expect structured content types
    // but work fine with JSON text responses
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'globalise_retrieve_document',
    description:
      '**GET SPECIFIC DOCUMENT** - Retrieve complete details for a document when you have its ID or URN. ' +
      '\n\n**USE WHEN:** User provides a document ID (e.g., "NL-HaNA_1.04.02_9966_0106") or wants full text/metadata for a known document. ' +
      'Examples: "get document NL-HaNA_1.04.02_9966_0106", "show me the full text of urn:globalise:...", "retrieve metadata for document X". ' +
      '\n\n**REQUIRES:** Document ID in format "NL-HaNA_{archive}_{inventory}_{scan}" or full URN "urn:globalise:...". ' +
      '\n\n**RETURNS:** (1) Full transcribed text line-by-line and concatenated, (2) Metadata including languages, dates, creator, license, ' +
      '(3) Navigation links to previous/next page IDs, (4) National Archives URL for viewing page scan (always present as clickable link). ' +
      '\n\n**DO NOT USE FOR:** (1) Searching by keywords → use globalise_search_transcriptions instead. ' +
      '(2) Navigating to next/previous page → use globalise_navigate instead (it handles retrieval automatically).',
    inputSchema: zodToJsonSchema(getDocumentSimpleInputSchema) as Tool['inputSchema'],
    // outputSchema removed for broad client compatibility
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },

  // Convenience tools (working, provide shortcuts)
  {
    name: 'globalise_navigate',
    description:
      '**PAGE NAVIGATION** - Move to the previous or next page from a given document for sequential browsing through archival materials. ' +
      '\n\n**USE WHEN:** User wants to browse pages sequentially, explore neighboring scans, or navigate through a document page-by-page. ' +
      'Examples: "show me the next page", "go to the previous page from document X", "navigate forward in this inventory". ' +
      '\n\n**REQUIRES:** (1) Current document ID or URN, (2) Direction: "next", "previous", or "prev". ' +
      '\n\n**RETURNS:** Full details of the target page including text, metadata, and navigation links. ' +
      'If no next/previous page exists, returns error message. ' +
      '\n\n**DO NOT USE FOR:** (1) Searching by keywords → use globalise_search_transcriptions. ' +
      '(2) Getting a specific known document → use globalise_retrieve_document.',
    inputSchema: zodToJsonSchema(navigateInputSchema) as Tool['inputSchema'],
    // outputSchema removed for broad client compatibility
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'globalise_search_by_inventory',
    description:
      '**INVENTORY-SCOPED SEARCH** - Search within a specific inventory number. Inventories contain hundreds of documents (e.g., inventory 4293 has 535 documents). ' +
      '\n\n**USE WHEN:** User mentions an inventory number and wants to search within it or get statistics about it. ' +
      'Examples: "search inventory 9966 for coffee", "find documents in inventory 2174 about trade", "what languages are in inventory 4293?". ' +
      '\n\n**REQUIRES:** Inventory number (e.g., "9966", "4293"). Optional: search query, language filters. ' +
      '\n\n**RETURNS:** Paginated results showing only documents from the specified inventory, with highlighted text fragments and aggregations including language distribution. ' +
      '\n\n**FOR STATISTICS ONLY:** Use query="*" with size=1 to get language counts without retrieving full documents.',
    inputSchema: zodToJsonSchema(searchByInventoryInputSchema) as Tool['inputSchema'],
    // outputSchema removed for broad client compatibility
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'globalise_search_by_language',
    description:
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
    inputSchema: zodToJsonSchema(searchByLanguageInputSchema) as Tool['inputSchema'],
    // outputSchema removed for broad client compatibility
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

/**
 * Create and configure the MCP server
 */
const server = new Server(
  {
    name: 'globalise-mcp-server',
    version: '1.12.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {
        subscribe: false,   // No real-time update notifications
        listChanged: false, // Resource list is static
      },
    },
  }
);

/**
 * Handler for listing available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

/**
 * Handler for listing available resources
 *
 * Resources provide context data that clients can read to understand
 * the corpus before making tool calls.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: RESOURCES,
  };
});

/**
 * Handler for reading a specific resource
 *
 * Returns the resource content in the appropriate format (JSON or Markdown).
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  // Log resource access
  console.error(`[RESOURCE] Reading: ${uri}`);

  try {
    const contents = await readResource(uri);
    const contentLength = contents[0]?.text?.length || 0;
    console.error(`[RESOURCE] Success: ${uri} (${contentLength} chars, ${contents[0]?.mimeType})`);
    return { contents };
  } catch (error) {
    // Return error in MCP format
    console.error(`[RESOURCE] Error: ${uri}`, error instanceof Error ? error.message : error);
    if (error instanceof Error) {
      throw new Error(`Resource not found: ${uri}. ${error.message}`);
    }
    throw error;
  }
});

/**
 * Handler for tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: unknown;

    switch (name) {
      case 'globalise_search_transcriptions': {
        const input = searchSimpleInputSchema.parse(args);
        result = await searchSimple(input);
        break;
      }

      case 'globalise_retrieve_document': {
        const input = getDocumentSimpleInputSchema.parse(args);
        result = await getDocumentSimple(input);
        break;
      }

      case 'globalise_search_by_inventory': {
        const input = searchByInventoryInputSchema.parse(args);
        result = await searchByInventory(input);
        break;
      }

      case 'globalise_navigate': {
        const input = navigateInputSchema.parse(args);
        result = await navigate(input);
        break;
      }

      case 'globalise_search_by_language': {
        const input = searchByLanguageInputSchema.parse(args);
        result = await searchByLanguage(input);
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    const responseText = JSON.stringify(result, null, 2);

    // Debug logging (enable with DEBUG=true environment variable)
    if (process.env.DEBUG === 'true') {
      console.error(`[TOOL] ${name} - Response length: ${responseText.length} chars`);
      if (!responseText || responseText.length === 0) {
        console.error(`[TOOL] WARNING: Empty response for ${name}!`);
      }
    }

    // Extract viewer URLs and format as clickable markdown links
    const viewerLinks = extractViewerLinks(result as Record<string, unknown>, name);

    const content: Array<{ type: 'text'; text: string }> = [
      {
        type: 'text',
        text: responseText,
      },
    ];

    // Append clickable links section if URLs were found
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
  } catch (error) {
    // Handle validation errors from Zod
    if (error instanceof Error) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                error: error.message,
                tool: name,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    throw error;
  }
});

/**
 * Start the server with the specified transport
 */
async function main() {
  const transportMode = process.env.TRANSPORT || 'stdio';

  if (transportMode === 'http' || transportMode === 'sse') {
    // HTTP/SSE transport for remote access
    const { createHttpServer } = await import('./transports/http-server.js');

    const port = parseInt(process.env.PORT || '3000', 10);
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['*'];

    createHttpServer(server, { port, allowedOrigins });

    console.error(`[HTTP] ${TOOLS.length} tools available:`, TOOLS.map(t => t.name).join(', '));
    console.error(`[HTTP] ${RESOURCES.length} resources available:`, RESOURCES.map(r => r.uri).join(', '));
  } else {
    // Stdio transport (default) for Claude Desktop integration
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Log to stderr since stdout is used for MCP communication
    console.error('GLOBALISE MCP Server running on stdio');
    console.error(`${TOOLS.length} tools available:`, TOOLS.map(t => t.name).join(', '));
    console.error(`${RESOURCES.length} resources available:`, RESOURCES.map(r => r.uri).join(', '));
  }
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
