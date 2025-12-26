/**
 * Document retrieval tools for GLOBALISE API
 */

import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, documentCache } from '../utils/api-client.js';
import { DocumentResponse } from '../utils/types.js';

export const getDocumentInputSchema = z.object({
  documentId: z.string().describe('Document ID or URN. Can be either "urn:globalise:NL-HaNA_1.04.02_9966_0106" or just "NL-HaNA_1.04.02_9966_0106"'),
  includeAnnotations: z.boolean().optional().default(true).describe('Include W3C annotations with metadata (default: true)'),
  includeText: z.boolean().optional().default(true).describe('Include full transcribed text (default: true)'),
  includeIIIF: z.boolean().optional().default(true).describe('Include IIIF image and manifest URLs (default: true)'),
});

export const getDocumentOutputSchema = z.object({
  id: z.string(),
  document: z.string(),
  inventoryNumber: z.string(),
  scanNumber: z.string(),
  archive: z.string().optional(),
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
  navigation: z.object({
    previousPageId: z.string().optional(),
    nextPageId: z.string().optional(),
  }).optional(),
  urls: z.object({
    nationalArchives: z.string().optional(),
    annoRepo: z.string().optional(),
    highResolutionImage: z.string().optional(),
    textRepo: z.string().optional(),
    iiifCanvas: z.string().optional(),
    iiifManifest: z.string().optional(),
  }).optional(),
});

// Simplified document schema (for testing Claude Desktop filtering)
export const getDocumentSimpleInputSchema = z.object({
  documentId: z.string()
    .min(1, "Document ID cannot be empty")
    .describe('Document ID or URN (e.g., "NL-HaNA_1.04.02_9966_0106" or "urn:globalise:NL-HaNA_1.04.02_9966_0106")'),
});

export type GetDocumentInput = z.infer<typeof getDocumentInputSchema>;
export type GetDocumentOutput = z.infer<typeof getDocumentOutputSchema>;
export type GetDocumentSimpleInput = z.infer<typeof getDocumentSimpleInputSchema>;

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
function parseDocumentId(docId: string): { archive: string; inventoryNumber: string; scanNumber: string } {
  // Remove URN prefix if present
  const cleanId = docId.replace('urn:globalise:', '');

  // Format: NL-HaNA_{archive}_{inventory}_{scan}
  const parts = cleanId.split('_');

  if (parts.length >= 4) {
    return {
      archive: parts[1],
      inventoryNumber: parts[2],
      scanNumber: parts[3],
    };
  }

  return {
    archive: 'unknown',
    inventoryNumber: 'unknown',
    scanNumber: 'unknown',
  };
}

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
  if (input.includeIIIF) include.push('iiif');

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

  // Add text if requested
  if (input.includeText && response.views?.self?.lines) {
    output.text = {
      lines: response.views.self.lines,
      fullText: response.views.self.lines.join('\n'),
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

    // Extract URLs from annotation targets and IIIF data
    if (input.includeIIIF || input.includeAnnotations) {
      const targets = response.anno[0].target;
      output.urls = {
        nationalArchives: metadata.naUrl,
        annoRepo: annotation?.id,
        textRepo: metadata.trUrl,
      };

      // Use top-level IIIF data if available (cleaner structure)
      if (response.iiif) {
        output.urls.iiifManifest = response.iiif.manifest;
        output.urls.iiifCanvas = response.iiif.canvasIds?.[0];
      }

      // Also extract image URL from annotation targets
      if (targets) {
        const imageTarget = targets.find(t => t.type === 'Image');
        if (imageTarget) {
          output.urls.highResolutionImage = imageTarget.source;
        }

        // Fallback to annotation targets for IIIF if top-level data not available
        if (!response.iiif) {
          const canvasTarget = targets.find(t => t.type === 'Canvas');
          if (canvasTarget) {
            output.urls.iiifCanvas = canvasTarget.source;
            // Extract manifest URL from canvas URL
            const match = canvasTarget.source.match(/(.*\/manifests\/.*\.json)/);
            if (match) {
              output.urls.iiifManifest = match[1];
            }
          }
        }
      }
    }
  }

  return output;
}

/**
 * Simplified document retrieval (maps to full getDocument with all features enabled)
 * For testing Claude Desktop filtering issues
 */
export async function getDocumentSimple(input: GetDocumentSimpleInput): Promise<GetDocumentOutput> {
  // Map simple input to full input with all features enabled
  return getDocument({
    documentId: input.documentId,
    includeAnnotations: true,
    includeText: true,
    includeIIIF: true,
  });
}
