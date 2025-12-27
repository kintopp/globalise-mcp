/**
 * Search tools for GLOBALISE API
 */

import { z } from 'zod';
import { apiPost, buildUrl, API_CONFIG, validateSearchFields } from '../utils/api-client.js';
import { SearchResponse } from '../utils/types.js';

export const searchInputSchema = z.object({
  query: z.string().describe('Search query text. Supports Boolean operators (AND, OR, NOT), wildcards (* and ?), fuzzy matching (~N for edit distance), and exact phrases in quotes. Example: "peper AND koffie", "schip*", "voorschreven~1"'),
  from: z.number().min(0).optional().default(0).describe('Pagination offset - starting result index (default: 0)'),
  size: z.number().min(1).max(1000).optional().default(10).describe('Number of results per page (1-1000, default: 10). Use pagination for larger result sets.'),
  fragmentSize: z.number().min(50).max(500).optional().default(100).describe('Size of text fragments with highlights (default: 100)'),
  sortBy: z.string().optional().default('_score').describe('Field to sort by. Valid options: "_score" (relevance, default), "document" (document ID alphabetically), "invNr" (inventory number), "langLabel" (language name)'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort order: "asc" (ascending) or "desc" (descending, default)'),
  includeAggregations: z.boolean().optional().default(true).describe('Include aggregation counts for inventory numbers, documents, and languages (default: true)'),
  indexName: z.string().optional().describe('Search index name (defaults to current index from config)'),
  languages: z.array(z.string()).optional().describe('Filter by language ISO codes. Example: ["nld"] for Dutch, ["fas"] for Persian, ["ben"] for Bengali. Common codes: "nld" (Dutch), "eng" (English), "fas" (Persian), "ben" (Bengali), "unknown"'),
  languageLabels: z.array(z.string()).optional().describe('Filter by human-readable language names. Example: ["Dutch"], ["Persian"], ["Bengali"]. Use this for user-friendly language names instead of ISO codes.'),
  filters: z.record(z.array(z.string())).optional().describe('Advanced filters for term matching. Object with field names as keys and arrays of values. Example: {"langIso": ["nld"], "invNr": ["9966"]}'),
});

// Simplified search schema without complex features (for testing Claude Desktop filtering)
export const searchSimpleInputSchema = z.object({
  query: z.string()
    .min(1, "Search query cannot be empty")
    .describe('Search query. Supports Boolean operators (AND/OR/NOT), wildcards (* ?), fuzzy matching (~N), exact phrases in quotes, proximity ("phrase"~N)'),
  from: z.number()
    .min(0, "Pagination offset must be 0 or greater")
    .optional()
    .default(0)
    .describe('Pagination offset (default: 0)'),
  size: z.number()
    .min(1, "Results per page must be at least 1")
    .max(500, "Results per page cannot exceed 500")
    .optional()
    .default(10)
    .describe('Results per page (1-500, default: 10). For large-scale analysis, up to 500 results can be requested.'),
  sortBy: z.string()
    .optional()
    .default('_score')
    .describe('Sort by: "_score" (relevance), "document" (doc ID), "invNr" (inventory). Default: "_score"'),
  sortOrder: z.enum(['asc', 'desc'])
    .optional()
    .default('desc')
    .describe('Sort order: "asc" or "desc" (default: "desc")'),
  languages: z.array(z.string())
    .optional()
    .describe('Filter by language codes: ["nld"], ["fas"], ["ben"], etc.'),
  inventoryNumber: z.union([z.string(), z.array(z.string())])
    .optional()
    .describe('Filter by inventory number(s). Single: "9966" or multiple: ["9966", "4293"]'),
});

export const searchOutputSchema = z.object({
  total: z.object({
    value: z.number(),
    relation: z.enum(['eq', 'gte']),
  }),
  results: z.array(z.object({
    id: z.string(),
    document: z.string(),
    inventoryNumber: z.string(),
    highlightedFragments: z.array(z.string()),
    tokenCount: z.number(),
    languages: z.array(z.object({
      code: z.string(),
      label: z.string(),
    })).describe('Languages detected on this page with ISO codes and labels'),
    viewerUrl: z.string().describe('Link to view page in GLOBALISE Transcriptions Viewer'),
  })),
  aggregations: z.object({
    topInventoryNumbers: z.array(z.object({
      inventoryNumber: z.string(),
      count: z.number(),
    })).optional(),
    topDocuments: z.array(z.object({
      document: z.string(),
      count: z.number(),
    })).optional(),
    languages: z.array(z.object({
      code: z.string(),
      label: z.string(),
      count: z.number(),
    })).optional(),
  }).optional(),
  pagination: z.object({
    from: z.number(),
    size: z.number(),
    hasMore: z.boolean(),
  }),
});

export type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type SearchSimpleInput = z.infer<typeof searchSimpleInputSchema>;

/**
 * Search GLOBALISE transcriptions
 */
export async function search(input: SearchInput): Promise<SearchOutput> {
  // Get index name if not provided
  let indexName = input.indexName || API_CONFIG.DEFAULT_INDEX;

  // Build aggregations object
  const aggs = input.includeAggregations ? {
    invNr: { order: 'countDesc', size: 10 },
    document: { order: 'countDesc', size: 10 },
    langIso: { order: 'countDesc', size: 10 },
    langLabel: { order: 'countDesc', size: 10 },
  } : {};

  // Build terms filters
  const terms: Record<string, string[]> = {};

  // Add language ISO code filter if provided
  if (input.languages && input.languages.length > 0) {
    terms.langIso = input.languages;
  }

  // Add language label filter if provided (human-readable names)
  if (input.languageLabels && input.languageLabels.length > 0) {
    terms.langLabel = input.languageLabels;
  }

  // Add custom filters if provided
  if (input.filters) {
    Object.entries(input.filters).forEach(([key, values]) => {
      terms[key] = values;
    });
  }

  // Validate that all filter fields are indexed and searchable
  const filterFields = Object.keys(terms);
  if (filterFields.length > 0) {
    await validateSearchFields(filterFields, indexName);
  }

  // Build request body
  const requestBody = {
    text: input.query,
    terms,
    aggs,
  };

  // Build URL with query parameters
  const url = buildUrl(
    `${API_CONFIG.BROCCOLI_BASE_URL}/projects/globalise/search`,
    {
      indexName,
      fragmentSize: input.fragmentSize,
      from: input.from,
      size: input.size,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    }
  );

  // Make API request
  const response = await apiPost<SearchResponse>(url, requestBody);

  // Transform response to output format
  const results = response.results.map(result => ({
    id: result._id,
    document: result.document,
    inventoryNumber: result.invNr,
    highlightedFragments: result._hits?.text || [],
    tokenCount: result.textTokenCount,
    // Map langIso and langLabel arrays to {code, label}[] objects
    languages: result.langIso.map((code, i) => ({
      code,
      label: result.langLabel[i] || code,
    })),
    viewerUrl: `https://transcriptions.globalise.huygens.knaw.nl/detail/${result._id}`,
  }));

  // Transform aggregations if present
  let aggregations;
  if (input.includeAggregations && response.aggs) {
    aggregations = {
      topInventoryNumbers: response.aggs.invNr
        ? Object.entries(response.aggs.invNr)
            .map(([invNr, count]) => ({ inventoryNumber: invNr, count }))
            .slice(0, 10)
        : undefined,
      topDocuments: response.aggs.document
        ? Object.entries(response.aggs.document)
            .map(([doc, count]) => ({ document: doc, count }))
            .slice(0, 10)
        : undefined,
      languages: response.aggs.langIso && response.aggs.langLabel
        ? Object.entries(response.aggs.langIso).map(([code, count]) => {
            const label = Object.keys(response.aggs.langLabel || {}).find(
              key => response.aggs.langLabel![key] === count
            ) || code;
            return { code, label, count };
          })
        : undefined,
    };
  }

  return {
    total: response.total,
    results,
    aggregations,
    pagination: {
      from: input.from,
      size: input.size,
      hasMore: response.total.value > input.from + input.size,
    },
  };
}

/**
 * Simplified search function (maps to full search with reduced parameters)
 * For testing Claude Desktop filtering issues
 */
export async function searchSimple(input: SearchSimpleInput): Promise<SearchOutput> {
  // Map simple input to full search input
  const searchInput: SearchInput = {
    query: input.query,
    from: input.from,
    size: input.size,
    fragmentSize: 100, // Fixed default
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    includeAggregations: true, // Fixed default
    languages: input.languages,
  };

  // Add inventory filter if provided (supports single string or array)
  if (input.inventoryNumber) {
    const invNrArray = Array.isArray(input.inventoryNumber)
      ? input.inventoryNumber
      : [input.inventoryNumber];
    searchInput.filters = {
      invNr: invNrArray,
    };
  }

  // Call the full search function
  return search(searchInput);
}
