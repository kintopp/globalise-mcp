/**
 * `globalise_inspect_page_image` — fetches a VOC page scan (or a region of
 * it) as an MCP `image` content block for the calling LLM's own visual
 * reading. Rijksmuseum parity port (see plan 020); the reverse channel
 * (viewUUID sessions, navigate_viewer auto-zoom) is plan 021.
 */

import { z } from 'zod';
import { getCachedApiGet, buildUrl, API_CONFIG, VIEWER_URL_PREFIX, documentCache, apiGetBinary } from '../utils/api-client.js';
import { LRUCache } from '../utils/cache.js';
import { normalizeDocumentId, parseDocumentId } from '../utils/document-id.js';
import {
  extractIiifImageUrl, IIIF_REGION_RE, checkRegionBounds, cropPixelsToIiifPixels,
  regionPixelDims, buildIiifRegionUrl, computeDeliveryState,
  type RegionBoundsIssue,
} from '../utils/iiif.js';
import { maxInspectWidth, VISION_MAX_EDGE, VISION_FALLBACK_WIDTH } from '../utils/vision-sizing.js';

/**
 * Delivery width when the caller doesn't name one. Kept below VISION_MAX_EDGE:
 * on this corpus the per-shape ceiling is what actually binds, and asking for
 * the absolute maximum on every call would enlarge every payload to buy
 * resolution that measured as making no difference to transcription accuracy.
 */
const DEFAULT_SIZE = 1568;
import { fetchIiifDims } from '../utils/iiif-info.js';
import { readImageDimensions } from '../utils/image-dimensions.js';
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
  // Deliberately NOT `.default(DEFAULT_SIZE)`: an unspecified size means "fit
  // this page", and on ~70% of the corpus DEFAULT_SIZE is already above what
  // the shape can deliver intact. With a Zod default the clamp could not tell
  // an ordinary call from a caller who explicitly over-asked, and the note
  // would fire on most calls — which teaches the model to ignore it.
  size: z.number().int().min(200).max(VISION_MAX_EDGE).optional()
    .describe(`Width of the returned image in pixels (200-${VISION_MAX_EDGE}). Omit it to fit the page automatically (up to ${DEFAULT_SIZE}) — recommended. Whatever you pass is clamped per page shape so the crop is never upscaled and never exceeds what the model accepts intact: a larger size is downscaled before the model sees it, so to read a small hand request a TIGHTER REGION, not a bigger size. Sizes align to multiples of 28 for clean coordinate handling.`),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0)
    .describe('Clockwise rotation in degrees'),
  quality: z.enum(['default', 'gray']).default('default')
    .describe("Image quality — 'gray' can help read faint ink or inscriptions"),
  viewUUID: z.string().optional()
    .describe('Target a specific viewer session (from globalise_view_document_ui). When omitted, auto-discovers an open viewer for this page.'),
  navigateViewer: z.boolean().default(true)
    .describe("Auto-navigate the open viewer to the inspected region (no effect when region is 'full' or no viewer is open)."),
});

export const inspectPageImageOutputSchema = z.object({
  documentId: z.string(),
  inventory: z.string().optional(),
  scan: z.string().optional(),
  region: z.string(),
  cropRegion: z.string().optional().describe('The region as sent to the IIIF server (crop_pixels: prefix stripped)'),
  requestedSize: z.number().optional().describe('Effective size after the never-upscale and vision-budget clamps'),
  note: z.string().optional().describe('Caveats about how this result was computed — e.g. a requested size clamped down because the region has no more real pixels, or because anything larger would be downscaled before the assistant sees it (a tighter region is then the way to more detail).'),
  nativeWidth: z.number().optional(),
  nativeHeight: z.number().optional(),
  cropPixelWidth: z.number().optional().describe('Actual pixel width of the returned crop (read from the bytes)'),
  cropPixelHeight: z.number().optional(),
  rotation: z.number().optional(),
  quality: z.string().optional(),
  fetchTimeMs: z.number().optional(),
  viewerUrl: z.string().optional().describe('Web viewer deep link for the whole page'),
  viewUUID: z.string().optional().describe('The active viewer session this inspect targeted (for follow-up globalise_navigate_viewer calls)'),
  viewerNavigated: z.boolean().optional().describe('True only when the open viewer is actively polling and the auto-zoom was delivered. When the zoom was merely queued (iframe not polling), viewerZoomQueued is true instead.'),
  viewerZoomQueued: z.boolean().optional().describe('True when the auto-zoom command was queued but the viewer iframe has not polled recently — it applies if/when the iframe polls. On hosts whose app bridge does not support server tools, queued commands are never delivered.'),
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

/**
 * How wide a crop to actually fetch, and why it differs from what was asked.
 *
 * Two independent ceilings compose as a `min()`: the region's own pixel width
 * (never upscale) and the largest delivery this *shape* survives without the
 * model downscaling it. The second needs the region's HEIGHT — tracking only
 * width was the bug this replaces, and on a corpus of tall leaves and
 * landscape openings it misfires in opposite directions on the two shapes.
 *
 * The reason is worded here, at the clamp, so it cannot drift from the
 * decision. The two reasons must stay distinguishable: they tell the model
 * OPPOSITE things about whether a tighter crop would help.
 *
 * Exported so the tests drive this composition rather than a copy of it.
 */
export function resolveDeliverySize(
  region: string,
  requested: number | undefined,
  imgW?: number,
  imgH?: number,
): { size: number; note?: string } {
  const dims = regionPixelDims(region, imgW, imgH);

  // Shape unknown (info.json failed on a full/square/pct: region). Fall back to
  // the width that is safe on any shape rather than to DEFAULT_SIZE, which the
  // corpus survey found breaches the many-image limit on ~70% of pages.
  if (!dims) {
    return { size: Math.min(requested ?? DEFAULT_SIZE, VISION_FALLBACK_WIDTH) };
  }

  const visionMax = maxInspectWidth(dims.width, dims.height);
  const ceiling = Math.min(dims.width, visionMax);
  const size = Math.min(requested ?? DEFAULT_SIZE, ceiling);

  // Only an EXPLICIT over-request earns a note. Fitting an unspecified size to
  // the page is the documented behaviour, not a denied request, and the
  // delivered size is reported in requestedSize either way.
  if (requested === undefined || size >= requested) return { size };
  return {
    size,
    note: `size clamped from ${requested}px to ${size}px — ${
      visionMax === ceiling
        ? 'anything larger is downscaled before the model sees it; a tighter region gives more detail per patch, a wider size gives nothing'
        : 'upscaling not supported'
    }`,
  };
}

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
  //     read like inspect, and if the caller just navigated via
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

  // 7. Clamp the delivery to what this page's shape can carry intact.
  const { size: effectiveSize, note } = resolveDeliverySize(iiifRegion, input.size, width, height);

  // 8. Build the IIIF region URL.
  const fetchUrl = buildIiifRegionUrl(imageUrl, iiifRegion, effectiveSize, input.rotation, input.quality);
  if (!fetchUrl) {
    return { ok: false, error: `Unexpected IIIF URL shape for ${documentUrn} — cannot build a region crop URL` };
  }

  // 9. Fetch the crop bytes (timed). Full-page fetches are cached — they
  //    repeat often in exploration sessions. The cache is driven directly via
  //    `LRUCache.getOrFetch` (cache-first + in-flight dedup) rather than
  //    `getCachedApiGet`, because the loader here is `apiGetBinary`, not the
  //    JSON-only `apiGet` that wrapper hardcodes.
  const fetchStart = performance.now();
  let image: { base64: string; mimeType: string };
  try {
    if (iiifRegion === 'full') {
      const imgCacheKey = `img:${documentUrn}:${effectiveSize}:${input.rotation}:${input.quality}`;
      image = await fullImageCache.getOrFetch(imgCacheKey, () => apiGetBinary(fetchUrl)) as { base64: string; mimeType: string };
    } else {
      image = await apiGetBinary(fetchUrl);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to fetch image: ${message}` };
  }
  const fetchTimeMs = Math.round(performance.now() - fetchStart);

  // 10. Actual crop pixel dimensions, parsed from the returned JPEG/PNG header
  //     (pure-JS, no native sharp). Non-fatal — dims stay undefined on an
  //     unparseable buffer.
  const imageBuffer = Buffer.from(image.base64, 'base64');
  const cropDims = readImageDimensions(imageBuffer);
  const cropPixelWidth = cropDims?.width;
  const cropPixelHeight = cropDims?.height;

  // 11. Auto-navigate the open viewer to the inspected region (plan 021):
  //     a non-full region + a live viewer + navigateViewer (default true).
  //     "Navigated" is claimed only when the iframe is actually polling
  //     (delivered_recently) — an enqueue alone is reported as queued, so this
  //     caption can no longer contradict navigate_viewer's delivery state for
  //     the same session (2026-08-03 stdio test report §4.2).
  let viewerNavigated = false;
  let viewerZoomQueued = false;
  if (input.navigateViewer && activeViewUUID && iiifRegion !== 'full') {
    const queue = viewerQueues.get(activeViewUUID);
    if (queue) {
      const now = Date.now();
      queue.commands.push({ action: 'navigate', region: iiifRegion });
      queue.lastAccess = now;
      if (computeDeliveryState(queue.lastPolledAt, now) === 'delivered_recently') {
        viewerNavigated = true;
      } else {
        viewerZoomQueued = true;
      }
    }
  }

  // 12. Caption (rijksmuseum format, GLOBALISE fields).
  const regionLabel = input.region === 'full' ? 'full page' : `region ${input.region}`;
  const captionParts = [
    `${documentUrn} (inventory ${inventoryNumber}, scan ${scanNumber})`,
    `— (${regionLabel}, ${effectiveSize}px, ${fetchTimeMs}ms)`,
    // Reuse the string built at the clamp verbatim rather than phrasing the
    // same fact a second time here.
    ...(note ? [`| ${note}`] : []),
  ];
  if (width && height) {
    captionParts.push(`| native ${width}×${height}px`);
  }
  if (cropPixelWidth && cropPixelHeight) {
    captionParts.push(`| crop ${cropPixelWidth}×${cropPixelHeight}px`);
  }
  if (viewerNavigated) captionParts.push('| viewer navigated');
  else if (viewerZoomQueued) captionParts.push('| viewer zoom queued (iframe not polling yet)');
  else if (activeViewUUID) captionParts.push(`| viewer open (${activeViewUUID.slice(0, 8)})`);
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
    viewerZoomQueued: viewerZoomQueued || undefined,
    ...(note ? { note } : {}),
  };

  return { ok: true, image, meta, caption };
}
