/**
 * How large an image the calling model will actually accept.
 *
 * Deliberately NOT in `iiif.ts`: the IIIF region grammar and a vision model's
 * billing limits change for entirely unrelated reasons, and nobody revising a
 * model tier's limits would think to look in a file about IIIF URLs.
 *
 * Measured against the corpus (499-page uniform random sample, 2026-08-23):
 * GLOBALISE scan shapes are bimodal — tall single leaves around w/h 0.75 (85%)
 * and landscape two-page openings around 1.4 (15%), with *no* pages between
 * 0.90 and 1.20. No single width serves both: the largest constant safe on all
 * 499 is 1220px, which costs 17% linear resolution on leaves and 39% on
 * openings against solving per shape. Hence `maxInspectWidth`.
 *
 * Those figures are measured, not derived, and the survey that produced them
 * does not live in this repo — re-measure before trusting them against a
 * changed corpus or a different model tier.
 */

/**
 * Vision models bill an image in 28x28-pixel patches — ceil(w/28) * ceil(h/28)
 * visual tokens — and downscale anything over budget before the model sees it,
 * so an oversized crop costs a fetch and a transfer for pixels that get thrown
 * away.
 *
 * The edge cap is 71 patches (1988px) rather than the high-resolution tier's
 * 2576 because a request carrying more than 20 image blocks — counting images
 * resent from earlier turns — drops every image in it to a ~2000px per-side
 * limit. Breaching that rejects the whole request, and since the history is
 * resent, every later turn fails identically until the conversation is
 * abandoned. A page-by-page reading session reaches 20 images easily, so this
 * is the limit that actually bites here.
 *
 * Don't round the cap up to the next patch boundary (2016): that is over the
 * limit, and the edge check runs on the padded width, so no width between 1989
 * and 2016 is reachable anyway.
 */
export const VISION_PATCH = 28;
export const VISION_MAX_EDGE = 71 * VISION_PATCH;   // 1988
export const VISION_MAX_TOKENS = 4784;

/**
 * Delivery width when the page's shape can't be measured — `fetchIiifDims`
 * degrades to undefined on an info.json failure, and a `full` / `square` /
 * `pct:` region is then unmeasurable. This is the largest width that survives
 * *every* page in the corpus sample regardless of shape, so the guarantee
 * holds on the degraded path too. Softer than a shape-aware fit (−17% on a
 * leaf, −39% on an opening); the alternative is a request that can poison a
 * whole conversation.
 */
export const VISION_FALLBACK_WIDTH = 1220;

/** Width or height rounded up to the patch grid — what the encoder measures. */
export function padToPatch(px: number): number {
  return Math.ceil(px / VISION_PATCH) * VISION_PATCH;
}

/** Visual-token cost of a w x h image: one token per 28x28 patch. */
export function visualTokens(width: number, height: number): number {
  return Math.ceil(width / VISION_PATCH) * Math.ceil(height / VISION_PATCH);
}

/**
 * Largest delivery width for a region of this shape that arrives untouched.
 *
 * IIIF is asked for `{width},` and derives the height, so the height is
 * predicted with ceil() — over-estimating the patch count wastes a few pixels,
 * under-estimating invites the silent server-side downscale this exists to
 * avoid. (The vision docs' reference implementation rounds half-to-even to
 * match the API exactly; we cannot, because IIIF owns that rounding and we do
 * not control it. Off by at most a pixel, always in the safe direction.)
 */
export function maxInspectWidth(regionWidth: number, regionHeight: number): number {
  if (!(regionWidth > 0) || !(regionHeight > 0)) return VISION_MAX_EDGE;

  const fits = (w: number): boolean => {
    const h = Math.max(1, Math.ceil(w * regionHeight / regionWidth));
    return padToPatch(w) <= VISION_MAX_EDGE
      && padToPatch(h) <= VISION_MAX_EDGE
      && visualTokens(w, h) <= VISION_MAX_TOKENS;
  };

  // Largest-first, so the first fit is the answer. A binary search would be
  // fewer probes but would rest on an unstated monotonicity invariant, and its
  // guard clauses would be load-bearing for correctness rather than speed —
  // without an `if (fits(VISION_MAX_EDGE))` pre-check a wide region searches
  // below the cap and returns a wrong answer. At a couple of microseconds
  // against the IIIF fetch on the same path, the scan is not worth the extra
  // thing to prove.
  for (let w = VISION_MAX_EDGE; w > 1; w--) {
    if (fits(w)) return w;
  }
  return 1; // region taller than the edge cap even one pixel wide
}
