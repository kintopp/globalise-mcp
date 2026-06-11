/**
 * Document retrieval tools for GLOBALISE API
 */

import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, VIEWER_URL_PREFIX, documentCache } from '../utils/api-client.js';
import { normalizeDocumentId, parseDocumentId } from '../utils/document-id.js';
import { DocumentResponse } from '../utils/types.js';
import { languageSchema, mapPageLanguages } from '../utils/languages.js';

/**
 * Normalize the upstream `metadata.comment` field, which carries the page
 * license as a "license: <value>" string (e.g. "license: CC-BY-4.0"). Strips
 * the prefix and maps a missing or empty value to undefined. Shared with the
 * viewer tool (document-viewer.ts) so this one untrusted upstream field is
 * handled identically everywhere instead of one path returning it raw and
 * required while another strips and optionalizes it (CODE-REVIEW finding 1).
 */
export function normalizeLicense(comment: string | undefined): string | undefined {
  return comment?.replace('license: ', '') || undefined;
}

// Public tool input: just the document ID; annotations and text are always included
export const getDocumentInputSchema = z.object({
  documentId: z.string()
    .min(1, "Document ID cannot be empty")
    .describe('Document ID or URN (e.g., "NL-HaNA_1.04.02_9966_0106" or "urn:globalise:NL-HaNA_1.04.02_9966_0106")'),
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
    languages: z.array(languageSchema),
    license: z.string().optional(),
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

/**
 * Internal call options: the public tool always includes annotations and
 * text; navigate() skips text for the current page (it only needs the
 * prev/next pointers).
 */
export interface GetDocumentOptions {
  documentId: string;
  includeAnnotations?: boolean;
  includeText?: boolean;
}

export type GetDocumentOutput = z.infer<typeof getDocumentOutputSchema>;

/**
 * Get detailed document information
 */
export async function getDocument(options: GetDocumentOptions): Promise<GetDocumentOutput> {
  const { documentId, includeAnnotations = true, includeText = true } = options;
  const documentUrn = normalizeDocumentId(documentId);
  const { archive, inventoryNumber, scanNumber } = parseDocumentId(documentUrn);

  // Build include list
  const include: string[] = [];
  if (includeAnnotations) include.push('anno');
  if (includeText) include.push('text');

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
    document: metadata?.document || documentId,
    archive,
    inventoryNumber,
    scanNumber,
  };

  // Add text if requested (lines only — the joined fullText duplicated
  // every transcription's token cost and was dropped in R9)
  if (includeText && response.views?.self?.lines) {
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
      languages: mapPageLanguages(metadata.lang),
      license: normalizeLicense(metadata.comment),
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
