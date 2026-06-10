/**
 * Document Viewer UI Tool for GLOBALISE API
 *
 * Returns document data formatted for the interactive viewer UI,
 * including IIIF image URL extracted from the API response.
 */

import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, VIEWER_URL_PREFIX, documentCache } from '../utils/api-client.js';
import { normalizeDocumentId, parseDocumentId } from '../utils/document-id.js';
import { extractIiifImageUrl } from '../utils/iiif.js';
import { DocumentResponse } from '../utils/types.js';
import { type Language, mapPageLanguages } from '../utils/languages.js';
import { findArchivalDocuments } from './archival-index.js';

/**
 * Input schema for the document viewer UI tool
 */
export const viewDocumentUiInputSchema = z.object({
  documentId: z.string()
    .min(1, 'Document ID cannot be empty')
    .describe('Document ID or URN (e.g., "NL-HaNA_1.04.02_9966_0106" or "urn:globalise:NL-HaNA_1.04.02_9966_0106")'),
  highlightTerms: z.array(z.string()).optional().default([])
    .describe('Search terms to highlight in the transcription'),
});

export type ViewDocumentUiInput = z.infer<typeof viewDocumentUiInputSchema>;

/**
 * Archival context from OBP/GM databases
 */
export interface ArchivalContext {
  /** Which database(s) have entries for this inventory */
  source: 'obp' | 'gm' | 'both' | 'none';
  /** Total entries in archival index for this inventory */
  inventoryTotal: number;
  /** Top settlements (OBP only) */
  settlements?: string[];
  /** Date range across all entries */
  yearRange?: { from: number; to: number };
  /** VOC chamber (GM only) */
  chamber?: string;
  /** Whether HTR transcriptions are available (GM only) */
  htrAvailable?: boolean;
  /** Specific location from TANAP (e.g., "Colombo", "Madurese") */
  locationTanap?: string;
  /** Geographic coverage/scope */
  geographicalCoverage?: string;
  /** Finding aid description text */
  description?: string;
}

/**
 * Output structure for the document viewer UI
 */
export interface ViewDocumentUiOutput {
  id: string;
  iiifImageUrl: string;
  transcription: string[];
  metadata: {
    inventory: string;
    scan: string;
    languages: Language[];
    license?: string;
  };
  navigation: {
    prev: string | null;
    next: string | null;
  };
  urls: {
    viewer: string;
    archive: string | null;
  };
  highlight: string[];
  /** Archival context from OBP/GM databases (if available) */
  archivalContext?: ArchivalContext;
}

/**
 * Determine which database source(s) are represented in the results.
 */
function determineSource(results: { type: string }[]): ArchivalContext['source'] {
  const hasObp = results.some(r => r.type === 'obp');
  const hasGm = results.some(r => r.type === 'gm');

  if (hasObp && hasGm) return 'both';
  if (hasObp) return 'obp';
  if (hasGm) return 'gm';
  return 'none';
}

/**
 * Build archival context from OBP/GM database results.
 * Returns undefined if the database is unavailable or has no results.
 */
async function fetchArchivalContext(inventoryNumber: string): Promise<ArchivalContext | undefined> {
  try {
    const result = await findArchivalDocuments({
      source: 'all',
      inventoryNumber,
      from: 0,
      size: 10,
      includeAggregations: true,
    });

    if (result.total.value === 0) return undefined;

    const context: ArchivalContext = {
      source: determineSource(result.results),
      inventoryTotal: result.total.value,
    };

    // Settlements from aggregations (OBP)
    const settlements = result.aggregations?.settlements;
    if (settlements?.length) {
      context.settlements = settlements.slice(0, 5).map(s => s.settlement);
    }

    // Year range from results
    const years = result.results
      .flatMap(r => [r.yearEarliest, r.yearLatest])
      .filter((y): y is number => y !== null && y !== undefined);
    if (years.length > 0) {
      context.yearRange = { from: Math.min(...years), to: Math.max(...years) };
    }

    // GM-specific fields
    const gmResult = result.results.find(r => r.type === 'gm');
    if (gmResult?.type === 'gm') {
      context.chamber = gmResult.chamber ?? undefined;
      context.htrAvailable = gmResult.htrAvailable;
    }

    // OBP-specific fields, with fallback description from first result
    const obpResult = result.results.find(r => r.type === 'obp');
    if (obpResult?.type === 'obp') {
      context.locationTanap = obpResult.locationTanap ?? undefined;
      context.geographicalCoverage = obpResult.geographicalCoverage ?? undefined;
      context.description = obpResult.description;
    } else {
      context.description = result.results[0]?.description;
    }

    return context;
  } catch (error) {
    // Archival context is optional -- don't fail if database is unavailable
    console.error('Failed to fetch archival context:', error);
    return undefined;
  }
}

/**
 * Get document data formatted for the viewer UI
 */
export async function viewDocumentUi(input: ViewDocumentUiInput): Promise<ViewDocumentUiOutput> {
  const documentUrn = normalizeDocumentId(input.documentId);
  const { inventoryNumber, scanNumber } = parseDocumentId(documentUrn);

  const url = buildUrl(
    `${API_CONFIG.BROCCOLI_BASE_URL}/projects/globalise/${documentUrn}`,
    {
      overlapTypes: 'px:Page',
      includeResults: 'anno,text',
      views: 'self',
      relativeTo: 'Origin',
    }
  );

  const cacheKey = `${documentUrn}:anno,text`;
  const response = await getCachedApiGet<DocumentResponse>(url, cacheKey, documentCache);
  const metadata = response.anno?.[0]?.body?.metadata;
  const iiifImageUrl = extractIiifImageUrl(response);

  if (!iiifImageUrl) {
    throw new Error(`No IIIF image URL found for document ${documentUrn}`);
  }

  return {
    id: documentUrn,
    iiifImageUrl,
    transcription: response.views?.self?.lines || [],
    metadata: {
      inventory: inventoryNumber,
      scan: scanNumber,
      languages: mapPageLanguages(metadata?.lang),
      license: metadata?.comment?.replace('license: ', '') || undefined,
    },
    navigation: {
      prev: metadata?.prevPageId || null,
      next: metadata?.nextPageId || null,
    },
    urls: {
      viewer: `${VIEWER_URL_PREFIX}${documentUrn}`,
      archive: metadata?.naUrl || null,
    },
    highlight: input.highlightTerms || [],
    archivalContext: await fetchArchivalContext(inventoryNumber),
  };
}
