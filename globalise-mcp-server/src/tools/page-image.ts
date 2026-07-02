/**
 * `globalise_inspect_page_image` — fetches a VOC page scan (or a region of
 * it) as an MCP `image` content block for the calling LLM's own visual
 * reading. Rijksmuseum parity port (see plan 020); the reverse channel
 * (viewUUID sessions, navigate_viewer, model-drawn overlays) is plan 021.
 */

import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, VIEWER_URL_PREFIX, documentCache, apiGetBinary } from '../utils/api-client.js';
import { LRUCache } from '../utils/cache.js';
import { normalizeDocumentId, parseDocumentId } from '../utils/document-id.js';
import {
  extractIiifImageUrl, IIIF_REGION_RE, checkRegionBounds, cropPixelsToIiifPixels,
  computeEffectiveSize, buildIiifRegionUrl,
  type RegionBoundsIssue,
} from '../utils/iiif.js';
import { readImageDimensions, compositeOverlays, computeCropRect } from '../utils/overlay-compositor.js';
import { fetchIiifDims } from '../utils/iiif-info.js';
import { viewerQueues } from '../utils/viewer-session.js';
import { DocumentResponse } from '../utils/types.js';

export const inspectPageImageInputSchema = z.object({
  documentId: z.string().min(1, 'Document ID cannot be empty')
    .describe('Document ID or URN (e.g., "NL-HaNA_1.04.02_9966_0106" or "urn:globalise:NL-HaNA_1.04.02_9966_0106")'),
  region: z.string().default('full')
    .refine((v) => IIIF_REGION_RE.test(v), {
      message: "Invalid IIIF region. Use 'full', 'square', 'x,y,w,h' (pixels), 'pct:x,y,w,h' (percentages), or 'crop_pixels:x,y,w,h' (explicit full-image pixels).",
    })
    .describe("IIIF region: 'full' (default), 'square', 'pct:x,y,w,h' (percentage of the full image), 'crop_pixels:x,y,w,h' (pixels of the full image — use with nativeWidth/nativeHeight from a prior response), or 'x,y,w,h' (legacy IIIF pixels). E.g. 'pct:0,60,40,40' for the bottom-left 40%."),
  size: z.number().int().min(200).max(2016).default(1568)
    .describe('Width of the returned image in pixels (200-2016, default 1568). Clamped so the crop is never upscaled. Defaults align to multiples of 28 for clean LLM coordinate handling.'),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0)
    .describe('Clockwise rotation in degrees'),
  quality: z.enum(['default', 'gray']).default('default')
    .describe("Image quality — 'gray' can help read faint ink or inscriptions"),
  viewUUID: z.string().optional()
    .describe('Target a specific viewer session (from globalise_view_document_ui). When omitted, auto-discovers an open viewer for this page.'),
  navigateViewer: z.boolean().default(true)
    .describe("Auto-navigate the open viewer to the inspected region (no effect when region is 'full' or no viewer is open)."),
  show_overlays: z.boolean().default(false)
    .describe('Composite active-viewer overlays onto the returned crop — opt-in verification for globalise_navigate_viewer add_overlay. Requires a non-full region tightly around the overlay (use the verificationRegion from the navigate response). Size is clamped to 448px when enabled.'),
});

export const inspectPageImageOutputSchema = z.object({
  documentId: z.string(),
  inventory: z.string().optional(),
  scan: z.string().optional(),
  region: z.string(),
  cropRegion: z.string().optional().describe('The region as sent to the IIIF server (crop_pixels: prefix stripped)'),
  requestedSize: z.number().optional().describe('Effective size after the never-upscale clamp'),
  nativeWidth: z.number().optional(),
  nativeHeight: z.number().optional(),
  cropPixelWidth: z.number().optional().describe('Actual pixel width of the returned crop (read from the bytes)'),
  cropPixelHeight: z.number().optional(),
  rotation: z.number().optional(),
  quality: z.string().optional(),
  fetchTimeMs: z.number().optional(),
  viewerUrl: z.string().optional().describe('Web viewer deep link for the whole page'),
  viewUUID: z.string().optional().describe('The active viewer session this inspect targeted (for follow-up globalise_navigate_viewer calls)'),
  viewerNavigated: z.boolean().optional().describe('True if the open viewer was auto-zoomed to the inspected region'),
  overlaysRendered: z.number().optional().describe('Overlays composited onto the crop when show_overlays was enabled'),
  overlaysSkipped: z.number().optional().describe('Active overlays that fell outside the crop and were not drawn'),
  overlaysError: z.string().optional().describe("'no_active_viewer' or 'compositor_failed' when show_overlays could not composite"),
  error: z.string().optional(),
  regionRecovery: z.object({
    requested: z.string(),
    clampedTo: z.string(),
    validRange: z.string(),
  }).optional().describe('Out-of-bounds recovery hint — retry with clampedTo or a corrected box within validRange.'),
});

export type InspectPageImageResult =
  | { ok: true; image: { base64: string; mimeType: string }; meta: z.infer<typeof inspectPageImageOutputSchema>; caption: string }
  | { ok: false; error: string; recovery?: RegionBoundsIssue; text?: string };

/** Full-image fetches repeat in exploration sessions (rijksmuseum caches these too). */
const fullImageCache = new LRUCache<unknown>(20, 300000);    // 20 crops, 5 min

// NB: annotate the parameter — `strict: true` (noImplicitAny) is on, so a bare
// `(input)` fails this step's own `tsc --noEmit` gate.
export async function inspectPageImage(
  input: z.output<typeof inspectPageImageInputSchema>,
): Promise<InspectPageImageResult> {
  // 1. Normalize + parse the document id (parseDocumentId throws ToolError
  //    on a malformed id — the caller's runTool wrapper handles it).
  const documentUrn = normalizeDocumentId(input.documentId);
  const { inventoryNumber, scanNumber } = parseDocumentId(documentUrn);

  // 1b. Resolve the active viewer for this page (plan 021) — prefer an
  //     explicit viewUUID (must match this document), else the most recently
  //     accessed queue for it. Recency tie-break `>=` so a later insertion in
  //     the same millisecond wins (Map iterates in insertion order); safe for a
  //     read like inspect, and if the caller just placed overlays via
  //     navigate_viewer that queue is the most recent by construction.
  let activeViewUUID: string | undefined;
  if (input.viewUUID) {
    const q = viewerQueues.get(input.viewUUID);
    if (q && q.documentId === documentUrn) {
      activeViewUUID = input.viewUUID;
      q.lastAccess = Date.now();
    }
    // else: don't navigate the wrong viewer
  } else {
    let bestLastAccess = -Infinity;
    for (const [uuid, q] of viewerQueues) {
      if (q.documentId === documentUrn && q.lastAccess >= bestLastAccess) {
        activeViewUUID = uuid;
        bestLastAccess = q.lastAccess;
      }
    }
    if (activeViewUUID) {
      viewerQueues.get(activeViewUUID)!.lastAccess = Date.now();
    }
  }

  // 2. Fetch the document JSON — SAME url + cacheKey as viewDocumentUi, so
  //    inspect-after-view is a documentCache hit.
  const url = buildUrl(
    `${API_CONFIG.BROCCOLI_BASE_URL}/projects/globalise/${documentUrn}`,
    { overlapTypes: 'px:Page', includeResults: 'anno,text', views: 'self', relativeTo: 'Origin' },
  );
  const cacheKey = `${documentUrn}:anno,text`;
  const response = await getCachedApiGet<DocumentResponse>(url, cacheKey, documentCache);

  // 3. extractIiifImageUrl; if missing, structured failure.
  const imageUrl = extractIiifImageUrl(response);
  if (!imageUrl) {
    return { ok: false, error: `No IIIF image URL found for ${documentUrn}` };
  }

  // 3b. show_overlays on region 'full' is a degenerate case: at the 448px
  //     clamp, a feature-scale overlay shrinks below visual threshold. Reject
  //     with a structured error steering the caller to a tight region.
  if (input.show_overlays && input.region === 'full') {
    return {
      ok: false,
      error: 'show_overlays_on_full_not_supported',
      text: 'show_overlays_on_full_not_supported: show_overlays is a feature-scale verification aid — at the 448px clamp, small overlays on a full-image view shrink below visual threshold. Inspect a region that encloses the overlay(s) you want to check (e.g. a pct: region around the target area).',
    };
  }

  // 4. Fetch native dims via info.json (shared with the view tool; degrades
  //    gracefully to undefined on failure — the bounds check + clamp both
  //    handle undefined dims, like rijksmuseum without imageInfo).
  const dims = await fetchIiifDims(documentUrn, imageUrl);
  const width = dims?.width;
  const height = dims?.height;

  // 5. Bounds check — checked before prefix-stripping so `requested` in the
  //    recovery payload echoes the caller's exact input.
  const oob = checkRegionBounds(input.region, width, height);
  if (oob) {
    return { ok: false, error: `Region out of bounds: ${oob.issue}`, recovery: oob };
  }

  // 6. crop_pixels: → plain IIIF pixel region.
  const iiifRegion = input.region.startsWith('crop_pixels:')
    ? (cropPixelsToIiifPixels(input.region) ?? input.region)
    : input.region;

  // 7. Never-upscale clamp. When show_overlays is on, the size is first clamped
  //    to 448px (an LLM context-cost guard — the composite is a verification
  //    aid, not a reading crop), then the never-upscale clamp applies on top.
  const baseSize = input.show_overlays ? Math.min(input.size, 448) : input.size;
  const effectiveSize = computeEffectiveSize(iiifRegion, baseSize, width, height);

  // 8. Build the IIIF region URL.
  const fetchUrl = buildIiifRegionUrl(imageUrl, iiifRegion, effectiveSize, input.rotation, input.quality);
  if (!fetchUrl) {
    return { ok: false, error: `Unexpected IIIF URL shape for ${documentUrn} — cannot build a region crop URL` };
  }

  // 9. Fetch the crop bytes (timed). Full-page fetches are cached — they
  //    repeat often in exploration sessions. `getCachedApiGet` is JSON-only
  //    (it calls `response.json()` internally), so binary crops are cached
  //    manually against the same LRUCache type instead of routing through it.
  const fetchStart = performance.now();
  let image: { base64: string; mimeType: string };
  try {
    if (iiifRegion === 'full') {
      const imgCacheKey = `img:${documentUrn}:${effectiveSize}:${input.rotation}:${input.quality}`;
      const cached = fullImageCache.get(imgCacheKey) as { base64: string; mimeType: string } | undefined;
      if (cached !== undefined) {
        image = cached;
      } else {
        image = await apiGetBinary(fetchUrl);
        fullImageCache.set(imgCacheKey, image);
      }
    } else {
      image = await apiGetBinary(fetchUrl);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to fetch image: ${message}` };
  }
  const fetchTimeMs = Math.round(performance.now() - fetchStart);

  // 10. show_overlays composite (plan 021): draw the active viewer's overlays
  //     onto the crop for visual verification. Non-fatal on any failure — the
  //     plain crop is still returned, with overlaysError flagging why.
  let imageBuffer: Buffer<ArrayBufferLike> = Buffer.from(image.base64, 'base64');
  let cropPixelWidth: number | undefined;
  let cropPixelHeight: number | undefined;
  let overlaysRendered: number | undefined;
  let overlaysSkipped: number | undefined;
  let overlaysError: string | undefined;
  if (input.show_overlays && width && height) {
    const queueForOverlays = activeViewUUID ? viewerQueues.get(activeViewUUID) : undefined;
    if (!queueForOverlays) {
      overlaysError = 'no_active_viewer';
      overlaysRendered = 0;
      overlaysSkipped = 0;
    } else {
      const overlays = queueForOverlays.activeOverlays;
      const cropRect = computeCropRect(iiifRegion, width, height);
      if (overlays.length > 0 && cropRect) {
        try {
          const composite = await compositeOverlays(imageBuffer, overlays, { rect: cropRect, imageWidth: width, imageHeight: height });
          imageBuffer = composite.buffer;
          image = { base64: imageBuffer.toString('base64'), mimeType: composite.mimeType };
          overlaysRendered = composite.rendered;
          overlaysSkipped = composite.skipped;
          cropPixelWidth = composite.width;
          cropPixelHeight = composite.height;
        } catch (err) {
          // Non-fatal: return the plain crop and flag so the failure isn't
          // indistinguishable from "all overlays fell outside".
          const message = err instanceof Error ? err.message : String(err);
          console.warn(`[globalise_inspect_page_image] overlay composite failed: ${message}`);
          overlaysError = 'compositor_failed';
          overlaysRendered = 0;
          overlaysSkipped = overlays.length;
        }
      } else {
        overlaysRendered = 0;
        overlaysSkipped = 0;
      }
    }
  }

  // 10b. Actual crop pixel dimensions (fallback when the composite path didn't
  //      run or didn't expose dims). Non-fatal — dims stay undefined.
  if (cropPixelWidth == null || cropPixelHeight == null) {
    try {
      ({ width: cropPixelWidth, height: cropPixelHeight } = await readImageDimensions(imageBuffer));
    } catch {
      // keep dims undefined
    }
  }

  // 11. Auto-navigate the open viewer to the inspected region (plan 021):
  //     a non-full region + a live viewer + navigateViewer (default true).
  let viewerNavigated = false;
  if (input.navigateViewer && activeViewUUID && iiifRegion !== 'full') {
    const queue = viewerQueues.get(activeViewUUID);
    if (queue) {
      queue.commands.push({ action: 'navigate', region: iiifRegion });
      queue.lastAccess = Date.now();
      viewerNavigated = true;
    }
  }

  // 12. Caption (rijksmuseum format, GLOBALISE fields).
  const regionLabel = input.region === 'full' ? 'full page' : `region ${input.region}`;
  const clampNote = effectiveSize < input.size ? ` (clamped from ${input.size}px — upscaling not supported)` : '';
  const captionParts = [
    `${documentUrn} (inventory ${inventoryNumber}, scan ${scanNumber})`,
    `— (${regionLabel}, ${effectiveSize}px${clampNote}, ${fetchTimeMs}ms)`,
  ];
  if (width && height) {
    captionParts.push(`| native ${width}×${height}px`);
  }
  if (cropPixelWidth && cropPixelHeight) {
    captionParts.push(`| crop ${cropPixelWidth}×${cropPixelHeight}px`);
  }
  if (viewerNavigated) captionParts.push('| viewer navigated');
  else if (activeViewUUID) captionParts.push(`| viewer open (${activeViewUUID.slice(0, 8)})`);
  if (overlaysRendered != null) {
    const errNote = overlaysError ? ` (${overlaysError})` : '';
    captionParts.push(`| overlays: ${overlaysRendered} rendered, ${overlaysSkipped} skipped${errNote}`);
  }
  captionParts.push(`| full page: ${VIEWER_URL_PREFIX}${documentUrn}`);
  const caption = captionParts.join(' ');

  // 13. Structured meta.
  const meta: z.infer<typeof inspectPageImageOutputSchema> = {
    documentId: documentUrn,
    inventory: inventoryNumber,
    scan: scanNumber,
    region: input.region,
    cropRegion: iiifRegion,
    requestedSize: effectiveSize,
    nativeWidth: width,
    nativeHeight: height,
    cropPixelWidth,
    cropPixelHeight,
    rotation: input.rotation,
    quality: input.quality,
    fetchTimeMs,
    viewerUrl: `${VIEWER_URL_PREFIX}${documentUrn}`,
    viewUUID: activeViewUUID,
    viewerNavigated: viewerNavigated || undefined,
    overlaysRendered,
    overlaysSkipped,
    overlaysError,
  };

  return { ok: true, image, meta, caption };
}
