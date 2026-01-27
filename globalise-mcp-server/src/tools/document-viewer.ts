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

  return output;
}
