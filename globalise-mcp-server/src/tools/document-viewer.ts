/**
 * Document Viewer UI Tool for GLOBALISE API
 *
 * Returns document data formatted for the interactive viewer UI,
 * including IIIF image URL extracted from the API response.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, VIEWER_URL_PREFIX, documentCache } from '../utils/api-client.js';
import { normalizeDocumentId, parseDocumentId } from '../utils/document-id.js';
import { extractIiifImageUrl } from '../utils/iiif.js';
import { fetchIiifDims } from '../utils/iiif-info.js';
import { viewerQueues } from '../utils/viewer-session.js';
import { DocumentResponse } from '../utils/types.js';
import { languageSchema, mapPageLanguages } from '../utils/languages.js';
import { normalizeLicense } from './document.js';
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
  viewUUID: z.string().optional()
    .describe('Existing viewer session to preserve (in-viewer page navigation). When live, the same UUID is kept and the page is swapped. Omit on first open.'),
});

export type ViewDocumentUiInput = z.infer<typeof viewDocumentUiInputSchema>;

/**
 * Archival context from OBP/GM databases. A Zod schema (not a bare interface)
 * so it composes into viewDocumentUiOutputSchema and is validated when emitted
 * as structuredContent.
 */
export const archivalContextSchema = z.object({
  source: z.enum(['obp', 'gm', 'both', 'none']).describe('Which database(s) have entries for this inventory'),
  inventoryTotal: z.number().describe('Total entries in archival index for this inventory'),
  settlements: z.array(z.string()).optional().describe('Top settlements (OBP only)'),
  yearRange: z.object({ from: z.number(), to: z.number() }).optional().describe('Date range across all entries'),
  chamber: z.string().optional().describe('VOC chamber (GM only)'),
  htrAvailable: z.boolean().optional().describe('Whether HTR transcriptions are available (GM only)'),
  locationTanap: z.string().optional().describe('Specific location from TANAP (e.g., "Colombo", "Madurese")'),
  geographicalCoverage: z.string().optional().describe('Geographic coverage/scope'),
  description: z.string().optional().describe('Finding aid description text'),
});

export type ArchivalContext = z.infer<typeof archivalContextSchema>;

/**
 * Output structure for the document viewer UI. Declared as a Zod schema (not a
 * bare interface) so registerAppTool can advertise and validate it as
 * structuredContent — parity with the four data tools.
 */
export const viewDocumentUiOutputSchema = z.object({
  id: z.string(),
  iiifImageUrl: z.string(),
  transcription: z.array(z.string()),
  metadata: z.object({
    inventory: z.string(),
    scan: z.string(),
    languages: z.array(languageSchema),
    license: z.string().optional(),
  }),
  navigation: z.object({
    prev: z.string().nullable(),
    next: z.string().nullable(),
  }),
  urls: z.object({
    viewer: z.string(),
    archive: z.string().nullable(),
  }),
  highlight: z.array(z.string()),
  /** Archival context from OBP/GM databases (if available) */
  archivalContext: archivalContextSchema.optional(),
  /** Viewer session for the LLM→viewer reverse channel (plan 021) */
  viewUUID: z.string().optional()
    .describe('Viewer session UUID — pass to globalise_navigate_viewer to steer this open viewer.'),
  imageWidth: z.number().optional().describe("The scan's native pixel width (for region coordinate projection)"),
  imageHeight: z.number().optional().describe("The scan's native pixel height"),
});

export type ViewDocumentUiOutput = z.infer<typeof viewDocumentUiOutputSchema>;

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

  // Resolve native dims (for the viewer session's region coordinate space) and
  // mint-or-remount the viewer command queue (plan 021). Dims degrade to
  // undefined on failure — the reverse channel still works, regions just can't
  // be projected server-side until a dims-bearing page is opened.
  const dims = await fetchIiifDims(documentUrn, iiifImageUrl);

  // Mint a fresh session, or — when a live UUID is supplied (in-viewer page
  // navigation) — reuse it with remount semantics: identity preserved, content
  // swapped. Do NOT touch lastPolledAt: the iframe is already polling this
  // UUID. A stale supplied UUID (TTL-evicted) silently mints a fresh one; the
  // viewer adopts whatever comes back.
  const viewUUID = input.viewUUID && viewerQueues.has(input.viewUUID) ? input.viewUUID : randomUUID();
  const existing = viewerQueues.get(viewUUID);
  if (existing) {
    existing.documentId = documentUrn;
    existing.imageWidth = dims?.width;
    existing.imageHeight = dims?.height;
    existing.lastAccess = Date.now();
  } else {
    viewerQueues.set(viewUUID, {
      commands: [],
      createdAt: Date.now(),
      lastAccess: Date.now(),
      documentId: documentUrn,
      imageWidth: dims?.width,
      imageHeight: dims?.height,
    });
  }

  return {
    id: documentUrn,
    iiifImageUrl,
    transcription: response.views?.self?.lines || [],
    metadata: {
      inventory: inventoryNumber,
      scan: scanNumber,
      languages: mapPageLanguages(metadata?.lang),
      license: normalizeLicense(metadata?.comment),
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
    viewUUID,
    imageWidth: dims?.width,
    imageHeight: dims?.height,
  };
}
