/**
 * Document Viewer UI Tool for GLOBALISE API
 *
 * Returns document data formatted for the interactive viewer UI,
 * including IIIF image URL extracted from the API response.
 */

import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, documentCache } from '../utils/api-client.js';
import { DocumentResponse } from '../utils/types.js';
import { extractIiifImageUrl } from '../utils/iiif.js';
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
    languages: Array<{ code: string; label: string }>;
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
 * Normalize document ID to URN format
 */
function normalizeDocumentId(docId: string): string {
  if (docId.startsWith('urn:globalise:')) {
    return docId;
  }
  return `urn:globalise:${docId}`;
}

/**
 * Extract inventory and scan numbers from document ID
 */
function parseDocumentId(docId: string): { inventoryNumber: string; scanNumber: string } {
  // Remove URN prefix if present
  const cleanId = docId.replace('urn:globalise:', '');

  // Format: NL-HaNA_{archive}_{inventory}_{scan}
  const parts = cleanId.split('_');

  if (parts.length >= 4) {
    return {
      inventoryNumber: parts[2],
      scanNumber: parts[3],
    };
  }

  return {
    inventoryNumber: 'unknown',
    scanNumber: 'unknown',
  };
}

/**
 * Get document data formatted for the viewer UI
 */
export async function viewDocumentUi(input: ViewDocumentUiInput): Promise<ViewDocumentUiOutput> {
  const documentUrn = normalizeDocumentId(input.documentId);
  const { inventoryNumber, scanNumber } = parseDocumentId(documentUrn);

  // Build URL with query parameters to get all needed data
  const url = buildUrl(
    `${API_CONFIG.BROCCOLI_BASE_URL}/projects/globalise/${documentUrn}`,
    {
      overlapTypes: 'px:Page',
      includeResults: 'anno,text',
      views: 'self',
      relativeTo: 'Origin',
    }
  );

  // Make cached API request
  const cacheKey = `${documentUrn}:anno,text`;
  const response = await getCachedApiGet<DocumentResponse>(url, cacheKey, documentCache);

  // Extract metadata from first annotation
  const metadata = response.anno?.[0]?.body?.metadata;

  // Extract IIIF image URL from annotation target
  const iiifImageUrl = extractIiifImageUrl(response);

  if (!iiifImageUrl) {
    throw new Error(`No IIIF image URL found for document ${documentUrn}`);
  }

  // Build the output structure for the UI
  const output: ViewDocumentUiOutput = {
    id: documentUrn,
    iiifImageUrl,
    transcription: response.views?.self?.lines || [],
    metadata: {
      inventory: inventoryNumber,
      scan: scanNumber,
      languages: metadata?.lang?.map(l => ({
        code: l.iso,
        label: l.label,
      })) || [],
      license: metadata?.comment?.replace('license: ', '') || undefined,
    },
    navigation: {
      prev: metadata?.prevPageId || null,
      next: metadata?.nextPageId || null,
    },
    urls: {
      viewer: `https://transcriptions.globalise.huygens.knaw.nl/detail/${documentUrn}`,
      archive: metadata?.naUrl || null,
    },
    highlight: input.highlightTerms || [],
  };

  // Fetch archival context from OBP/GM databases
  try {
    const archivalResult = await findArchivalDocuments({
      source: 'all',
      inventoryNumber,
      from: 0,
      size: 10,  // Get a few entries to extract metadata
      includeAggregations: true,
    });

    if (archivalResult.total.value > 0) {
      const archivalContext: ArchivalContext = {
        source: 'none',
        inventoryTotal: archivalResult.total.value,
      };

      // Determine source type from results
      const hasObp = archivalResult.results.some(r => r.type === 'obp');
      const hasGm = archivalResult.results.some(r => r.type === 'gm');
      if (hasObp && hasGm) {
        archivalContext.source = 'both';
      } else if (hasObp) {
        archivalContext.source = 'obp';
      } else if (hasGm) {
        archivalContext.source = 'gm';
      }

      // Extract settlements from aggregations (OBP)
      if (archivalResult.aggregations?.settlements && archivalResult.aggregations.settlements.length > 0) {
        archivalContext.settlements = archivalResult.aggregations.settlements
          .slice(0, 5)
          .map(s => s.settlement);
      }

      // Extract year range from results
      const years = archivalResult.results
        .flatMap(r => [r.yearEarliest, r.yearLatest])
        .filter((y): y is number => y !== null && y !== undefined);
      if (years.length > 0) {
        archivalContext.yearRange = {
          from: Math.min(...years),
          to: Math.max(...years),
        };
      }

      // Extract chamber from GM results
      const gmResult = archivalResult.results.find(r => r.type === 'gm');
      if (gmResult && gmResult.type === 'gm') {
        if (gmResult.chamber) {
          archivalContext.chamber = gmResult.chamber;
        }
        archivalContext.htrAvailable = gmResult.htrAvailable;
      }

      // Extract location and description from first OBP result
      const obpResult = archivalResult.results.find(r => r.type === 'obp');
      if (obpResult && obpResult.type === 'obp') {
        if (obpResult.locationTanap) {
          archivalContext.locationTanap = obpResult.locationTanap;
        }
        if (obpResult.geographicalCoverage) {
          archivalContext.geographicalCoverage = obpResult.geographicalCoverage;
        }
        archivalContext.description = obpResult.description;
      } else {
        // Fallback to first result's description (for GM)
        const firstResult = archivalResult.results[0];
        if (firstResult) {
          archivalContext.description = firstResult.description;
        }
      }

      output.archivalContext = archivalContext;
    }
  } catch (error) {
    // Archival context is optional - don't fail if database is unavailable
    console.error('Failed to fetch archival context:', error);
  }

  return output;
}
