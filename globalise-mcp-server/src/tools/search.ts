/**
 * Search tools for GLOBALISE API
 *
 * One consolidated search tool (R6): free-text query plus composable
 * inventory and language filters, with matchAll for bilingual documents.
 */

import { z } from 'zod';
import { apiPost, buildUrl, API_CONFIG, validateSearchFields } from '../utils/api-client.js';
import { SearchResponse } from '../utils/types.js';

/**
 * ISO 639-3 code to human-readable label mapping for languages in the GLOBALISE corpus.
 * Used for aggregation display and for normalizing user-supplied language names.
 */
const ISO_TO_LABEL: Record<string, string> = {
  nld: 'Dutch',
  eng: 'English',
  fra: 'French',
  deu: 'German',
  spa: 'Spanish',
  por: 'Portuguese',
  ita: 'Italian',
  lat: 'Latin',
  fas: 'Persian',
  ben: 'Bengali',
  tam: 'Tamil',
  sin: 'Sinhala',
  msa: 'Malay',
  jav: 'Javanese',
  zho: 'Chinese',
  jpn: 'Japanese',
  guj: 'Gujarati',
  bug: 'Buginese',
  chu: 'Old Church Slavonic',
  grc: 'Ancient Greek',
  hbo: 'Ancient Hebrew',
  ara: 'Arabic',
  art: 'Cipher',
  unknown: 'Unknown',
};

/** Lowercased label → ISO code, derived from ISO_TO_LABEL. */
const LABEL_TO_ISO: Record<string, string> = Object.fromEntries(
  Object.entries(ISO_TO_LABEL).map(([code, label]) => [label.toLowerCase(), code]),
);

/**
 * Normalize a user-supplied language (ISO 639-3 code or English label,
 * any case) to an ISO code. Unrecognized values pass through lowercased,
 * which simply matches nothing upstream. Replaces the old `length <= 3`
 * heuristic that misrouted mixed input like ["Dutch", "eng"] (R12).
 */
function normalizeLanguage(entry: string): string {
  const lower = entry.toLowerCase();
  if (ISO_TO_LABEL[lower]) return lower;
  return LABEL_TO_ISO[lower] || lower;
}

/** Cap on raw candidates scanned when post-filtering for matchAll. */
const MATCH_ALL_SCAN_CAP = 500;

// Internal full-featured search input (not exposed as a tool schema)
const searchInputSchema = z.object({
  query: z.string().describe('Search query text'),
  from: z.number().min(0).optional().default(0),
  size: z.number().min(1).max(1000).optional().default(10),
  fragmentSize: z.number().min(50).max(1000).optional().default(500),
  sortBy: z.string().optional().default('_score'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  includeAggregations: z.boolean().optional().default(true),
  indexName: z.string().optional(),
  languages: z.array(z.string()).optional().describe('Filter by language ISO codes'),
  languageLabels: z.array(z.string()).optional().describe('Filter by human-readable language names'),
  filters: z.record(z.string(), z.array(z.string())).optional().describe('Advanced term filters, field name → values'),
});

// Consolidated public tool schema (R6): one search tool with composable filters
export const searchTranscriptionsInputSchema = z.object({
  query: z.string()
    .min(1, 'Search query cannot be empty')
    .optional()
    .default('*')
    .describe('Search query. Supports Boolean operators (AND/OR/NOT), wildcards (* ?), fuzzy matching (~N), exact phrases in quotes, proximity ("phrase"~N). Defaults to "*" (match everything) — combine with filters and size=1 to get aggregation statistics cheaply.'),
  inventoryNumber: z.union([z.string(), z.array(z.string())])
    .optional()
    .describe('Restrict to inventory number(s). Single: "9966" or multiple: ["9966", "4293"]'),
  languages: z.array(z.string())
    .optional()
    .describe('Filter by language(s), as ISO 639-3 codes ("nld", "fas") or English names ("Dutch", "Persian"); mixing is fine. Default: documents matching ANY listed language.'),
  matchAll: z.boolean()
    .optional()
    .default(false)
    .describe('With 2+ languages: require pages to contain ALL of them (bilingual/multilingual). Post-filters a capped candidate window (500 raw hits), so totals are a lower bound — see the note field in the response.'),
  from: z.number()
    .min(0, 'Pagination offset must be 0 or greater')
    .optional()
    .default(0)
    .describe('Pagination offset (default: 0)'),
  size: z.number()
    .min(1, 'Results per page must be at least 1')
    .max(500, 'Results per page cannot exceed 500')
    .optional()
    .default(10)
    .describe('Results per page (1-500, default: 10). Large result sets consume more context.'),
  sortBy: z.string()
    .optional()
    .default('_score')
    .describe('Sort by: "_score" (relevance), "document" (doc ID), "invNr" (inventory). Default: "_score"'),
  sortOrder: z.enum(['asc', 'desc'])
    .optional()
    .default('desc')
    .describe('Sort order: "asc" or "desc" (default: "desc")'),
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
  note: z.string().optional().describe('Caveats about how this result was computed (e.g. matchAll scan cap)'),
});

type SearchInput = z.infer<typeof searchInputSchema>;
export type SearchOutput = z.infer<typeof searchOutputSchema>;
export type SearchTranscriptionsInput = z.infer<typeof searchTranscriptionsInputSchema>;

/**
 * Core search against the upstream Broccoli API.
 */
async function search(input: SearchInput): Promise<SearchOutput> {
  const indexName = input.indexName || API_CONFIG.DEFAULT_INDEX;

  const aggs = input.includeAggregations ? {
    invNr: { order: 'countDesc', size: 10 },
    document: { order: 'countDesc', size: 10 },
    langIso: { order: 'countDesc', size: 10 },
    langLabel: { order: 'countDesc', size: 10 },
  } : {};

  // Build terms filters from language codes, labels, and custom filters
  const terms: Record<string, string[]> = {
    ...(input.languages?.length ? { langIso: input.languages } : {}),
    ...(input.languageLabels?.length ? { langLabel: input.languageLabels } : {}),
    ...input.filters,
  };

  // Validate that all filter fields are indexed and searchable
  const filterFields = Object.keys(terms);
  if (filterFields.length > 0) {
    await validateSearchFields(filterFields, indexName);
  }

  const requestBody = { text: input.query, terms, aggs };

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

  const response = await apiPost<SearchResponse>(url, requestBody);

  const results = response.results.map(result => ({
    id: result._id,
    document: result.document,
    inventoryNumber: result.invNr,
    highlightedFragments: result._hits?.text || [],
    tokenCount: result.textTokenCount,
    // Zero-token pages (blank scans) come back from upstream with langIso /
    // langLabel omitted entirely — a wildcard or document-sorted query surfaces
    // those, so guard both. Keyword queries never hit this (only text-bearing
    // pages match), which is why this only crashed on query:"*" + filters.
    languages: (result.langIso ?? []).map((code, i) => ({
      code,
      label: result.langLabel?.[i] || code,
    })),
  }));

  let aggregations: SearchOutput['aggregations'];
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
      languages: response.aggs.langIso
        ? Object.entries(response.aggs.langIso).map(([code, count]) => ({
            code,
            label: ISO_TO_LABEL[code] || code,
            count,
          }))
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
 * Consolidated search tool (R6): replaces the former search_transcriptions /
 * search_by_inventory / search_by_language trio. Inventory and language
 * filters compose with the free-text query.
 *
 * matchAll (AND across languages) is not expressible upstream (the terms
 * filter is OR-within-field), so it filters at the API on one language —
 * preferring a non-Dutch one, since Dutch is ~97% of the corpus — then
 * post-filters a capped candidate window to require all of them (R12:
 * the cap is reported honestly in `note`).
 */
export async function searchTranscriptions(input: SearchTranscriptionsInput): Promise<SearchOutput> {
  const languages = input.languages?.map(normalizeLanguage);
  const useMatchAll = input.matchAll && (languages?.length ?? 0) > 1;

  const filters = input.inventoryNumber
    ? { invNr: Array.isArray(input.inventoryNumber) ? input.inventoryNumber : [input.inventoryNumber] }
    : undefined;

  // For matchAll, filter upstream on the rarest plausible language (first
  // non-Dutch entry) to avoid a candidate window dominated by Dutch pages.
  const filterLanguages = useMatchAll
    ? [languages!.find(code => code !== 'nld') ?? languages![0]]
    : languages;

  const searchResult = await search({
    query: input.query,
    from: useMatchAll ? 0 : input.from,
    size: useMatchAll ? Math.min(input.size * 10, MATCH_ALL_SCAN_CAP) : input.size,
    fragmentSize: 500,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    includeAggregations: true,
    languages: filterLanguages,
    filters,
  });

  if (!useMatchAll) {
    return searchResult;
  }

  // Post-filter: keep only pages containing ALL requested languages
  const scanned = searchResult.results.length;
  const matched = searchResult.results.filter(result => {
    const docLangCodes = result.languages.map(l => l.code.toLowerCase());
    return languages!.every(code => docLangCodes.includes(code));
  });

  const pageResults = matched.slice(input.from, input.from + input.size);

  return {
    total: { value: matched.length, relation: 'gte' },
    results: pageResults,
    aggregations: searchResult.aggregations,
    pagination: {
      from: input.from,
      size: input.size,
      hasMore: input.from + input.size < matched.length,
    },
    note: `matchAll post-filtered the first ${scanned} candidates (cap: ${MATCH_ALL_SCAN_CAP}); the total is a lower bound and pages beyond the scanned window are unreachable.`,
  };
}
