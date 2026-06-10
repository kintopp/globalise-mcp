/**
 * Document retrieval tools for GLOBALISE API
 */

import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, VIEWER_URL_PREFIX, documentCache } from '../utils/api-client.js';
import { normalizeDocumentId, parseDocumentId } from '../utils/document-id.js';
import { DocumentResponse } from '../utils/types.js';

export const getDocumentInputSchema = z.object({
  documentId: z.string().describe('Document ID or URN. Can be either "urn:globalise:NL-HaNA_1.04.02_9966_0106" or just "NL-HaNA_1.04.02_9966_0106"'),
  includeAnnotations: z.boolean().optional().default(true).describe('Include W3C annotations with metadata (default: true)'),
  includeText: z.boolean().optional().default(true).describe('Include full transcribed text (default: true)'),
});

export const getDocumentOutputSchema = z.object({
  id: z.string(),
  document: z.string(),
  inventoryNumber: z.string(),
  scanNumber: z.string(),
  archive: z.string().optional(),
  text: z.object({
    lines: z.array(z.string()),
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
  navigation: z.object({
    previousPageId: z.string().optional(),
    nextPageId: z.string().optional(),
  }).optional(),
  urls: z.object({
    transcriptionsViewer: z.string().describe('Link to view page in GLOBALISE Transcriptions Viewer (scan + transcription with highlighting)'),
    nationalArchives: z.string().optional().describe('Direct link to view page scan at National Archives'),
  }).optional(),
});

// Public tool input: just the document ID; annotations and text are always included
export const getDocumentSimpleInputSchema = z.object({
  documentId: z.string()
    .min(1, "Document ID cannot be empty")
    .describe('Document ID or URN (e.g., "NL-HaNA_1.04.02_9966_0106" or "urn:globalise:NL-HaNA_1.04.02_9966_0106")'),
});

export type GetDocumentInput = z.infer<typeof getDocumentInputSchema>;
export type GetDocumentOutput = z.infer<typeof getDocumentOutputSchema>;

/**
 * Get detailed document information
 */
export async function getDocument(input: GetDocumentInput): Promise<GetDocumentOutput> {
  const documentUrn = normalizeDocumentId(input.documentId);
  const { archive, inventoryNumber, scanNumber } = parseDocumentId(documentUrn);

  // Build include list
  const include: string[] = [];
  if (input.includeAnnotations) include.push('anno');
  if (input.includeText) include.push('text');

  // Build URL with query parameters
  const url = buildUrl(
    `${API_CONFIG.BROCCOLI_BASE_URL}/projects/globalise/${documentUrn}`,
    {
      overlapTypes: 'px:Page',
      includeResults: include.join(','),
      views: 'self',
      relativeTo: 'Origin',
    }
  );

  // Make cached API request (cache key includes URN and include parameters)
  const cacheKey = `${documentUrn}:${include.join(',')}`;
  const response = await getCachedApiGet<DocumentResponse>(url, cacheKey, documentCache);

  // Extract metadata from first annotation
  const metadata = response.anno?.[0]?.body?.metadata;
  const annotation = response.anno?.[0];

  // Build output
  const output: GetDocumentOutput = {
    id: documentUrn,
    document: metadata?.document || input.documentId,
    archive,
    inventoryNumber,
    scanNumber,
  };

  // Add text if requested (lines only — the joined fullText duplicated
  // every transcription's token cost and was dropped in R9)
  if (input.includeText && response.views?.self?.lines) {
    output.text = {
      lines: response.views.self.lines,
    };
  }

  // Add metadata if available
  if (metadata) {
    output.metadata = {
      created: metadata.created,
      lastChange: metadata.lastChange,
      layoutAnalysis: metadata.creator,
      ocrSoftware: annotation?.generator?.name,
      annotationGenerated: annotation?.generated,
      languages: metadata.lang.map(l => ({
        code: l.iso,
        label: l.label,
      })),
      license: metadata.comment,
    };

    // Add navigation
    output.navigation = {
      previousPageId: metadata.prevPageId,
      nextPageId: metadata.nextPageId,
    };

    // Include URLs for viewing the document
    output.urls = {
      transcriptionsViewer: `${VIEWER_URL_PREFIX}${documentUrn}`,
      nationalArchives: metadata.naUrl,
    };
  }

  return output;
}
