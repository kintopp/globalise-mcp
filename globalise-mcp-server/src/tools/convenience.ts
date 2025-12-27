/**
 * Convenience tools for GLOBALISE API
 */

import { z } from 'zod';
import { search, SearchInput, SearchOutput } from './search.js';
import { getDocument, GetDocumentOutput } from './document.js';

// Search by Inventory Tool
export const searchByInventoryInputSchema = z.object({
  inventoryNumber: z.string()
    .min(1, "Inventory number cannot be empty")
    .describe('Inventory number to search within (e.g., "9966", "2174")'),
  query: z.string()
    .optional()
    .describe('Optional search query within this inventory. If omitted, returns all documents in the inventory'),
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
    .describe('Number of results to return (1-500, default: 10)'),
  sortBy: z.string()
    .optional()
    .default('_score')
    .describe('Field to sort by (default: "_score")'),
  sortOrder: z.enum(['asc', 'desc'])
    .optional()
    .default('desc')
    .describe('Sort order: "asc" or "desc" (default: "desc")'),
  languages: z.array(z.string())
    .optional()
    .describe('Filter by language ISO codes. Example: ["nld"] for Dutch only'),
  languageLabels: z.array(z.string())
    .optional()
    .describe('Filter by human-readable language names. Example: ["Dutch"], ["Persian"]'),
});

// Search by Language Tool
export const searchByLanguageInputSchema = z.object({
  language: z.union([z.string(), z.array(z.string())])
    .describe('Language(s) to search for. Single: "Persian" or "fas". Multiple: ["Dutch", "English"] or ["nld", "eng"]. Can use ISO codes or human-readable names.'),
  matchAll: z.boolean()
    .optional()
    .default(false)
    .describe('If true, documents must contain ALL specified languages (bilingual/multilingual). If false (default), documents with ANY of the languages match.'),
  query: z.string()
    .optional()
    .describe('Optional text search query within this language. If omitted, returns all documents in the language'),
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
    .describe('Number of results to return (1-500, default: 10)'),
  includeInventoryCounts: z.boolean()
    .optional()
    .default(true)
    .describe('Include counts of documents per inventory number (default: true)'),
});

export const searchByInventoryOutputSchema = z.object({
  inventoryNumber: z.string(),
  total: z.object({
    value: z.number(),
    relation: z.enum(['eq', 'gte']),
  }),
  results: z.array(z.object({
    id: z.string(),
    document: z.string(),
    scanNumber: z.string(),
    highlightedFragments: z.array(z.string()),
    tokenCount: z.number(),
    languages: z.array(z.object({
      code: z.string(),
      label: z.string(),
    })).describe('Languages detected on this page with ISO codes and labels'),
    viewerUrl: z.string().describe('Link to view page in GLOBALISE Transcriptions Viewer'),
  })),
  pagination: z.object({
    from: z.number(),
    size: z.number(),
    hasMore: z.boolean(),
  }),
});

export type SearchByInventoryInput = z.infer<typeof searchByInventoryInputSchema>;
export type SearchByInventoryOutput = z.infer<typeof searchByInventoryOutputSchema>;

/**
 * Search within a specific inventory number
 */
export async function searchByInventory(input: SearchByInventoryInput): Promise<SearchByInventoryOutput> {
  // Build search query with inventory filter using the terms API
  const filters: Record<string, string[]> = {
    invNr: [input.inventoryNumber],
  };

  // Add language ISO filter if provided
  if (input.languages && input.languages.length > 0) {
    filters.langIso = input.languages;
  }

  // Add language label filter if provided
  if (input.languageLabels && input.languageLabels.length > 0) {
    filters.langLabel = input.languageLabels;
  }

  const searchInput: SearchInput = {
    query: input.query || '*', // Match all if no query provided
    from: input.from,
    size: input.size,
    fragmentSize: 100, // Default fragment size
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    includeAggregations: false, // Don't need aggregations for this focused search
    filters, // Pass the filters to the API
  };

  // Perform the search
  const searchResult = await search(searchInput);

  // Extract scan numbers from document IDs
  const resultsWithScan = searchResult.results.map(result => {
    // Extract scan number from document ID (format: NL-HaNA_{archive}_{inventory}_{scan})
    const parts = result.document.split('_');
    const scanNumber = parts.length >= 4 ? parts[3] : 'unknown';

    return {
      id: result.id,
      document: result.document,
      scanNumber,
      highlightedFragments: result.highlightedFragments,
      tokenCount: result.tokenCount,
      languages: result.languages,
      viewerUrl: result.viewerUrl,
    };
  });

  return {
    inventoryNumber: input.inventoryNumber,
    total: searchResult.total,
    results: resultsWithScan,
    pagination: searchResult.pagination,
  };
}

// Navigate Tool
export const navigateInputSchema = z.object({
  currentDocumentId: z.string()
    .min(1, "Document ID cannot be empty")
    .describe('Current document ID or URN (e.g., "NL-HaNA_1.04.02_9966_0106" or "urn:globalise:NL-HaNA_1.04.02_9966_0106")'),
  direction: z.enum(['next', 'previous', 'prev'])
    .describe('Navigation direction: "next" for next page, "previous" or "prev" for previous page'),
  includeText: z.boolean()
    .optional()
    .default(true)
    .describe('Include full transcribed text in result (default: true)'),
});

export const navigateOutputSchema = z.object({
  success: z.boolean(),
  currentDocument: z.object({
    id: z.string(),
    document: z.string(),
    inventoryNumber: z.string(),
    scanNumber: z.string(),
  }),
  targetDocument: z.object({
    id: z.string(),
    document: z.string(),
    inventoryNumber: z.string(),
    scanNumber: z.string(),
    text: z.object({
      lines: z.array(z.string()),
      fullText: z.string(),
    }).optional(),
    metadata: z.object({
      created: z.string(),
      lastChange: z.string(),
      layoutAnalysis: z.string(),
      ocrSoftware: z.string().optional(),
      annotationGenerated: z.string().optional(),
      languages: z.array(z.object({
        code: z.string(),
        label: z.string(),
      })),
      license: z.string(),
    }).optional(),
    urls: z.object({
      transcriptionsViewer: z.string().describe('Link to view page in GLOBALISE Transcriptions Viewer'),
      nationalArchives: z.string().optional(),
    }).optional(),
  }).optional(),
  message: z.string(),
});

export type NavigateInput = z.infer<typeof navigateInputSchema>;
export type NavigateOutput = z.infer<typeof navigateOutputSchema>;

/**
 * Navigate to previous or next document page
 */
export async function navigate(input: NavigateInput): Promise<NavigateOutput> {
  // First, get the current document to find navigation links
  const currentDoc = await getDocument({
    documentId: input.currentDocumentId,
    includeAnnotations: true,
    includeText: false,
  });

  // Parse current document ID
  const parts = currentDoc.document.split('_');
  const currentInventory = parts.length >= 3 ? parts[2] : 'unknown';
  const currentScan = parts.length >= 4 ? parts[3] : 'unknown';

  const currentDocInfo = {
    id: currentDoc.id,
    document: currentDoc.document,
    inventoryNumber: currentInventory,
    scanNumber: currentScan,
  };

  // Determine which direction to navigate
  const normalizedDirection = input.direction === 'prev' ? 'previous' : input.direction;
  const targetPageId = normalizedDirection === 'next'
    ? currentDoc.navigation?.nextPageId
    : currentDoc.navigation?.previousPageId;

  // Check if navigation is possible
  if (!targetPageId) {
    return {
      success: false,
      currentDocument: currentDocInfo,
      message: `No ${normalizedDirection} page available from document ${currentDoc.document}`,
    };
  }

  // Get the target document
  const targetDoc = await getDocument({
    documentId: targetPageId,
    includeAnnotations: true,
    includeText: input.includeText,
  });

  // Parse target document ID
  const targetParts = targetDoc.document.split('_');
  const targetInventory = targetParts.length >= 3 ? targetParts[2] : 'unknown';
  const targetScan = targetParts.length >= 4 ? targetParts[3] : 'unknown';

  return {
    success: true,
    currentDocument: currentDocInfo,
    targetDocument: {
      id: targetDoc.id,
      document: targetDoc.document,
      inventoryNumber: targetInventory,
      scanNumber: targetScan,
      text: targetDoc.text,
      metadata: targetDoc.metadata,
      urls: targetDoc.urls,
    },
    message: `Successfully navigated to ${normalizedDirection} page: ${targetDoc.document}`,
  };
}

// Search by Language Tool
export const searchByLanguageOutputSchema = z.object({
  language: z.union([z.string(), z.array(z.string())]).describe('The language(s) searched for'),
  matchAll: z.boolean().optional().describe('Whether AND logic was used (all languages required)'),
  total: z.object({
    value: z.number(),
    relation: z.enum(['eq', 'gte']),
  }),
  results: z.array(z.object({
    id: z.string(),
    document: z.string(),
    inventoryNumber: z.string(),
    scanNumber: z.string(),
    highlightedFragments: z.array(z.string()).optional(),
    tokenCount: z.number(),
    languages: z.array(z.object({
      code: z.string(),
      label: z.string(),
    })).describe('Languages detected on this page with ISO codes and labels'),
    viewerUrl: z.string().describe('Link to view page in GLOBALISE Transcriptions Viewer'),
  })),
  inventoryCounts: z.array(z.object({
    inventoryNumber: z.string(),
    count: z.number(),
  })).optional(),
  pagination: z.object({
    from: z.number(),
    size: z.number(),
    hasMore: z.boolean(),
  }),
});

export type SearchByLanguageInput = z.infer<typeof searchByLanguageInputSchema>;
export type SearchByLanguageOutput = z.infer<typeof searchByLanguageOutputSchema>;

/**
 * Search for all documents in a specific language across all inventories
 * Detects whether input is ISO code or human-readable name
 * Supports multiple languages with AND (matchAll) or OR logic
 */
export async function searchByLanguage(input: SearchByLanguageInput): Promise<SearchByLanguageOutput> {
  // Normalize language to array
  const languages = Array.isArray(input.language) ? input.language : [input.language];

  // Detect if languages are ISO codes (2-3 chars) or human-readable names
  // Assume all are same type based on first entry
  const isISOCode = languages[0].length <= 3;

  // For matchAll (AND logic), we use a smarter strategy:
  // 1. Filter on just ONE language at the API level (the one in the filter)
  // 2. Post-filter results to require ALL languages
  // This works better because filtering on multiple languages with OR
  // returns results dominated by the most common language (e.g., Dutch)
  // We filter on the first language in the array, which should be the rarer one
  // for best results (e.g., ["eng", "nld"] filters for English, then checks for Dutch)
  const requestSize = input.matchAll && languages.length > 1
    ? Math.min(input.size * 10, 500) // Request 10x more for post-filtering
    : input.size;

  // Build search query with language filter
  const searchInput: SearchInput = {
    query: input.query || '*', // Match all if no query provided
    from: input.matchAll && languages.length > 1 ? 0 : input.from, // Start from 0 for post-filtering
    size: requestSize,
    fragmentSize: 100,
    sortBy: '_score',
    sortOrder: 'desc',
    includeAggregations: input.includeInventoryCounts,
  };

  // Add language filter
  // When matchAll=true, filter on first language only (assumed to be rarer)
  // Then post-filter for remaining languages
  const filterLanguages = input.matchAll && languages.length > 1
    ? [languages[0]] // Use first language only for API filter
    : languages;     // Use all languages for OR logic

  if (isISOCode) {
    searchInput.languages = filterLanguages;
  } else {
    searchInput.languageLabels = filterLanguages;
  }

  // Perform the search
  const searchResult = await search(searchInput);

  // Extract scan numbers and inventory numbers from document IDs
  let resultsWithDetails = searchResult.results.map(result => {
    // Extract inventory and scan number from document ID (format: NL-HaNA_{archive}_{inventory}_{scan})
    const parts = result.document.split('_');
    const inventoryNumber = parts.length >= 3 ? parts[2] : 'unknown';
    const scanNumber = parts.length >= 4 ? parts[3] : 'unknown';

    return {
      id: result.id,
      document: result.document,
      inventoryNumber,
      scanNumber,
      highlightedFragments: input.query ? result.highlightedFragments : undefined,
      tokenCount: result.tokenCount,
      languages: result.languages,
      viewerUrl: result.viewerUrl,
    };
  });

  // Apply AND logic post-filter if matchAll is true
  let filteredTotal = searchResult.total;
  if (input.matchAll && languages.length > 1) {
    // Filter to only documents that have ALL specified languages
    resultsWithDetails = resultsWithDetails.filter(result => {
      const docLangCodes = result.languages.map(l => l.code.toLowerCase());
      const docLangLabels = result.languages.map(l => l.label.toLowerCase());

      return languages.every(lang => {
        const langLower = lang.toLowerCase();
        return docLangCodes.includes(langLower) || docLangLabels.includes(langLower);
      });
    });

    // Update total to reflect filtered count
    // Note: This is an approximation - the true total requires scanning all results
    filteredTotal = {
      value: resultsWithDetails.length,
      relation: 'gte' as const, // Indicates there may be more
    };

    // Apply pagination after filtering
    const startIdx = input.from;
    const endIdx = input.from + input.size;
    resultsWithDetails = resultsWithDetails.slice(startIdx, endIdx);
  }

  // Extract inventory counts from aggregations if requested
  let inventoryCounts;
  if (input.includeInventoryCounts && searchResult.aggregations?.topInventoryNumbers) {
    inventoryCounts = searchResult.aggregations.topInventoryNumbers;
  }

  return {
    language: input.language,
    matchAll: input.matchAll && languages.length > 1 ? true : undefined,
    total: filteredTotal,
    results: resultsWithDetails,
    inventoryCounts,
    pagination: {
      from: input.from,
      size: input.size,
      hasMore: input.matchAll && languages.length > 1
        ? resultsWithDetails.length === input.size // Approximate for AND logic
        : filteredTotal.value > input.from + input.size,
    },
  };
}
