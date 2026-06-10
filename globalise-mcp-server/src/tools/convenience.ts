/**
 * Page navigation tool for GLOBALISE API
 *
 * (The former search_by_inventory and search_by_language tools were
 * consolidated into globalise_search_transcriptions — refactor item R6.)
 */

import { z } from 'zod';
import { parseDocumentId } from '../utils/document-id.js';
import { getDocument } from './document.js';

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

  const { inventoryNumber: currentInventory, scanNumber: currentScan } = parseDocumentId(currentDoc.document);
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

  const { inventoryNumber: targetInventory, scanNumber: targetScan } = parseDocumentId(targetDoc.document);
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
