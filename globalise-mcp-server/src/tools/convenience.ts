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
  language: z.string()
    .min(1, "Language cannot be empty")
    .describe('Language to search for. Can be ISO code (e.g., "fas" for Persian, "ben" for Bengali) or human-readable name (e.g., "Persian", "Bengali", "Dutch")'),
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
    languages: z.array(z.string()),
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
  language: z.string(),
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
    languages: z.array(z.string()),
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
 */
export async function searchByLanguage(input: SearchByLanguageInput): Promise<SearchByLanguageOutput> {
  // Detect if language is an ISO code (2-3 chars) or a human-readable name
  const isISOCode = input.language.length <= 3;

  // Build search query with language filter
  const searchInput: SearchInput = {
    query: input.query || '*', // Match all if no query provided
    from: input.from,
    size: input.size,
    fragmentSize: 100,
    sortBy: '_score',
    sortOrder: 'desc',
    includeAggregations: input.includeInventoryCounts,
  };

  // Add appropriate language filter
  if (isISOCode) {
    searchInput.languages = [input.language];
  } else {
    searchInput.languageLabels = [input.language];
  }

  // Perform the search
  const searchResult = await search(searchInput);

  // Extract scan numbers and inventory numbers from document IDs
  const resultsWithDetails = searchResult.results.map(result => {
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

  // Extract inventory counts from aggregations if requested
  let inventoryCounts;
  if (input.includeInventoryCounts && searchResult.aggregations?.topInventoryNumbers) {
    inventoryCounts = searchResult.aggregations.topInventoryNumbers;
  }

  return {
    language: input.language,
    total: searchResult.total,
    results: resultsWithDetails,
    inventoryCounts,
    pagination: searchResult.pagination,
  };
}
