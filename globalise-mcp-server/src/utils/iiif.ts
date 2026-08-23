/**
 * IIIF URL utilities for GLOBALISE documents.
 *
 * The National Archives IIIF Image API uses GUID-based paths rather than document IDs.
 * URLs must be extracted from the API response (anno[0].target[0].source), not constructed.
 */

import { DocumentResponse } from './types.js';

/**
 * Extract the IIIF image URL from a document API response.
 *
 * The image URL is found in the annotation target's source field.
 * Format: https://service.archief.nl/iip/{guid-path}.jp2/full/max/0/default.jpg
 */
export function extractIiifImageUrl(response: DocumentResponse): string | undefined {
  // Select the Image target by `type`, not by position. Upstream currently
  // orders targets [Image, Canvas, Text, Text, LogicalText, LogicalText], but
  // the Text/LogicalText entries are credentialed TextRepo URLs (Basic-auth
  // 401 as of 2026-08). A reorder would otherwise feed one of those to the
  // viewer and to globalise_inspect_page_image, where the string check below
  // cannot tell it apart from an image URL. Falls back to [0] so a payload
  // that omits `type` behaves exactly as before.
  const targets = response.anno?.[0]?.target;
  const target = targets?.find((t) => t?.type === 'Image') ?? targets?.[0];

  // Require `source` to actually be a string rather than blind-casting it: the
  // API occasionally shapes a target's source as an object ({ id, type, … }).
  // Casting that to string would hand the viewer "[object Object]" (and, when
  // structured output is on, fail outputSchema validation downstream). A
  // non-string source falls through to undefined → the caller raises a clear
  // "No IIIF image URL found" instead.
  if (target && typeof target === 'object' && 'source' in target && typeof target.source === 'string') {
    return target.source;
  }

  return undefined;
}

/**
 * IIIF region grammar accepted by `globalise_inspect_page_image` (parity
 * with rijksmuseum-mcp-plus `src/registration/state.ts:3`).
 *
 * - `full` — the whole page (default)
 * - `square` — the largest centered square
 * - `x,y,w,h` — legacy IIIF pixel region
 * - `pct:x,y,w,h` — percentage of the full image (recommended)
 * - `crop_pixels:x,y,w,h` — explicit full-image pixels (same numbers as
 *   `x,y,w,h`, but distinguishable from a bare pixel region for callers that
 *   want to be unambiguous)
 */
export const IIIF_REGION_RE = /^(full|square|\d+,\d+,\d+,\d+|pct:[0-9.]+,[0-9.]+,[0-9.]+,[0-9.]+|crop_pixels:\d+,\d+,\d+,\d+)$/;

/** Parse a `pct:x,y,w,h` region into its four numbers, or null if not that shape. */
export function parsePctRegion(region: string): [number, number, number, number] | null {
  const m = region.match(/^pct:([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+)$/);
  if (!m) return null;
  return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])];
}

/** Parse a `crop_pixels:x,y,w,h` region into its four integers, or null if not that shape. */
export function parseCropPixelsRegion(region: string): [number, number, number, number] | null {
  const m = region.match(/^crop_pixels:(\d+),(\d+),(\d+),(\d+)$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
}

/** Parse a bare `x,y,w,h` IIIF pixel region into its four integers, or null. */
export function parsePixelRegion(region: string): [number, number, number, number] | null {
  const m = region.match(/^(\d+),(\d+),(\d+),(\d+)$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
}

/**
 * Either pixel form — `crop_pixels:x,y,w,h` or bare `x,y,w,h` — as four
 * integers. The two always travel together (the prefix is cosmetic; step 6 of
 * the inspect handler strips it), so callers that measure a region want both.
 */
export function parseAnyPixelRegion(region: string): [number, number, number, number] | null {
  return parseCropPixelsRegion(region) ?? parsePixelRegion(region);
}

/** Strip the `crop_pixels:` prefix, returning a plain IIIF pixel region (`x,y,w,h`). */
export function cropPixelsToIiifPixels(region: string): string | null {
  const p = parseCropPixelsRegion(region);
  if (!p) return null;
  return `${p[0]},${p[1]},${p[2]},${p[3]}`;
}

export interface RegionBoundsIssue {
  requested: string;
  clampedTo: string;
  issue: string;
  validRange: string;
}

/**
 * Validate region bounds (port of rijksmuseum-mcp-plus
 * `src/registration/geometry.ts` `checkRegionBounds`). `pct:` regions are
 * always checkable (against 0-100, with a 100.01 epsilon on the x+w/y+h
 * sums); `x,y,w,h` / `crop_pixels:x,y,w,h` regions are checked against the
 * native image dimensions when provided (skipped, beyond w>0/h>0, when
 * dimensions are unknown). `full` and `square` are always in-bounds.
 *
 * Returns null when in-bounds (or when the bounds check doesn't apply);
 * otherwise a flat `RegionBoundsIssue` carrying a clamped suggestion.
 */
export function checkRegionBounds(
  region: string,
  imgW?: number,
  imgH?: number,
): RegionBoundsIssue | null {
  if (region === 'full' || region === 'square') return null;

  const pct = parsePctRegion(region);
  if (pct) {
    const [x, y, w, h] = pct;
    const issues: string[] = [];
    if (x < 0 || x > 100) issues.push(`x=${x} outside 0–100`);
    if (y < 0 || y > 100) issues.push(`y=${y} outside 0–100`);
    if (w <= 0) issues.push(`w=${w} must be > 0`);
    if (h <= 0) issues.push(`h=${h} must be > 0`);
    if (x + w > 100.01) issues.push(`x+w=${(x + w).toFixed(2)} exceeds 100`);
    if (y + h > 100.01) issues.push(`y+h=${(y + h).toFixed(2)} exceeds 100`);
    if (issues.length === 0) return null;
    const cx = Math.max(0, Math.min(100, x));
    const cy = Math.max(0, Math.min(100, y));
    const cw = Math.max(0, Math.min(100 - cx, w));
    const ch = Math.max(0, Math.min(100 - cy, h));
    return {
      requested: region,
      clampedTo: `pct:${cx},${cy},${cw},${ch}`,
      issue: issues.join('; '),
      validRange: 'each value must be between 0 and 100, and x+w, y+h must not exceed 100',
    };
  }

  // crop_pixels: or plain IIIF pixels
  const cp = parseCropPixelsRegion(region);
  const pixelMatch = parseAnyPixelRegion(region);
  if (!pixelMatch) return null;
  const [x, y, w, h] = pixelMatch;
  const issues: string[] = [];
  if (w <= 0) issues.push(`w=${w} must be > 0`);
  if (h <= 0) issues.push(`h=${h} must be > 0`);
  if (imgW != null && imgH != null) {
    if (x < 0 || x >= imgW) issues.push(`x=${x} outside 0–${imgW - 1}`);
    if (y < 0 || y >= imgH) issues.push(`y=${y} outside 0–${imgH - 1}`);
    if (x + w > imgW) issues.push(`x+w=${x + w} exceeds imageWidth=${imgW}`);
    if (y + h > imgH) issues.push(`y+h=${y + h} exceeds imageHeight=${imgH}`);
  }
  if (issues.length === 0) return null;
  const prefix = cp ? 'crop_pixels:' : '';
  const cx = imgW != null ? Math.max(0, Math.min(imgW - 1, x)) : x;
  const cy = imgH != null ? Math.max(0, Math.min(imgH - 1, y)) : y;
  const cw = imgW != null ? Math.max(0, Math.min(imgW - cx, w)) : Math.max(0, w);
  const ch = imgH != null ? Math.max(0, Math.min(imgH - cy, h)) : Math.max(0, h);
  return {
    requested: region,
    clampedTo: `${prefix}${cx},${cy},${cw},${ch}`,
    issue: issues.join('; '),
    validRange: imgW != null
      ? `x in [0, ${imgW}), y in [0, ${imgH}), x+w ≤ ${imgW}, y+h ≤ ${imgH}, w>0, h>0`
      : 'w>0, h>0 (image dimensions unknown)',
  };
}

/**
 * `…/{id}.jp2/full/max/0/default.jpg` → `…/{id}.jp2/info.json` — server-side
 * twin of the viewer's `infoJsonUrl()` (`apps/document-viewer/src/viewer.ts`).
 */
export function infoJsonUrlFromImageUrl(imageUrl: string): string | null {
  const m = imageUrl.match(/^(.+)\/full\/[^/]+\/\d+\/default\.\w+$/);
  return m ? `${m[1]}/info.json` : null;
}

/** Pixel extent of an inspected region, as `regionPixelDims` computes it. */
export interface RegionPixelDims {
  width: number;
  height: number;
}

/**
 * Pixel extent of a region, in full-image pixels. Accepts unnormalized input
 * (`crop_pixels:` need not be stripped first) so callers can't get the order
 * wrong, and returns null only when the region's size genuinely can't be known
 * (`full` / `square` / `pct:` without native dimensions).
 *
 * Two consumers with opposite failure directions share this, so the rounding
 * is deliberate on each axis:
 *
 * - **Width** carries the historic 3px IIIF rounding margin on `pct:` regions
 *   (the server can deliver a couple of pixels fewer than the exact
 *   computation). It feeds the never-upscale clamp, where asking for more
 *   pixels than exist is the failure.
 * - **Height** is left unfudged, so the derived aspect ratio errs *tall*. It
 *   feeds `maxInspectWidth`, where under-predicting the delivered height is
 *   the failure — the same safety direction as its own `ceil()`.
 */
export function regionPixelDims(region: string, imgW?: number, imgH?: number): RegionPixelDims | null {
  // Explicit pixel regions carry their own extent — native dims not needed.
  const px = parseAnyPixelRegion(region);
  if (px) return { width: px[2], height: px[3] };

  if (!imgW || !imgH) return null;

  if (region === 'square') {
    const side = Math.min(imgW, imgH);
    return { width: side, height: side };
  }

  const pct = parsePctRegion(region);
  if (pct) {
    return {
      width: Math.max(1, Math.floor(imgW * pct[2] / 100) - 3),
      height: Math.max(1, Math.floor(imgH * pct[3] / 100)),
    };
  }

  return { width: imgW, height: imgH };   // 'full'
}

/**
 * `…/full/max/0/default.jpg` tail → `/{region}/{size},/{rotation}/{quality}.jpg`
 * (rijksmuseum URL form). Returns null if `imageUrl` doesn't end in the
 * expected `/full/{size}/{rotation}/default.{ext}` shape.
 */
export function buildIiifRegionUrl(imageUrl: string, region: string, size: number, rotation: number, quality: string): string | null {
  const m = imageUrl.match(/^(.+)\/full\/[^/]+\/\d+\/default\.\w+$/);
  if (!m) return null;
  return `${m[1]}/${region}/${size},/${rotation}/${quality}.jpg`;
}

// ── Reverse-channel geometry (plan 021, rijksmuseum geometry.ts parity) ──
// All pure; reuse parsePctRegion / parseCropPixelsRegion above.

/** Actual pixel dimensions of an inspected crop (for crop-local coordinates). */
export interface CropLocalSize {
  width: number;
  height: number;
}

/**
 * Classify how a navigate_viewer call's commands will reach the iframe, given
 * the queue's last-poll timestamp (rijksmuseum geometry.ts
 * `computeDeliveryState`). Pure for unit testing.
 *
 *   delivered_recently         — iframe polled within `recentMs` and will drain on its next tick
 *   queued_waiting_for_viewer  — iframe has polled before but not recently (typical when scrolled offscreen)
 *   no_live_viewer_seen        — no poll has been recorded for this UUID yet
 */
export type DeliveryState =
  | 'delivered_recently'
  | 'queued_waiting_for_viewer'
  | 'no_live_viewer_seen';

export function computeDeliveryState(
  lastPolledAtMs: number | undefined,
  nowMs: number,
  recentMs = 5000,
): DeliveryState {
  if (lastPolledAtMs == null) return 'no_live_viewer_seen';
  if (nowMs - lastPolledAtMs < recentMs) return 'delivered_recently';
  return 'queued_waiting_for_viewer';
}

/**
 * Project crop-local pct or crop-local pixel coordinates to full-image pct
 * space (rijksmuseum geometry.ts `projectToFullImage`). `relativeTo` is the
 * inspected crop's full-image pct region; `local` is the box within that crop
 * (pct: directly, or crop_pixels: with `localSize`). Returns null on invalid
 * shapes.
 */
export function projectToFullImage(local: string, relativeTo: string, localSize?: CropLocalSize): string | null {
  const o = parsePctRegion(relativeTo);
  if (!o) return null;
  const pct = parsePctRegion(local);
  const px = parseCropPixelsRegion(local);
  if (!pct && !px) return null;
  if (px && !localSize) return null;

  const l = pct ?? [
    (px![0] / localSize!.width) * 100,
    (px![1] / localSize!.height) * 100,
    (px![2] / localSize!.width) * 100,
    (px![3] / localSize!.height) * 100,
  ];
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const fx = round2(o[0] + (l[0] / 100) * o[2]);
  const fy = round2(o[1] + (l[1] / 100) * o[3]);
  const fw = round2((l[2] / 100) * o[2]);
  const fh = round2((l[3] / 100) * o[3]);
  return `pct:${fx},${fy},${fw},${fh}`;
}
