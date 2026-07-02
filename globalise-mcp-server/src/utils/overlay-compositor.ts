/**
 * Sharp-based image utilities for `globalise_inspect_page_image`.
 *
 * GLOBALISE twin of `rijksmuseum-mcp-plus/src/overlay-compositor.ts`. This
 * plan (020) ports only the pixel-dimensions reader; plan 021 extends this
 * file with the full overlay-compositing logic (`show_overlays`).
 */

import sharp from 'sharp';

/** Actual pixel dimensions of returned image bytes (rijksmuseum overlay-compositor.ts:177-180). */
export async function readImageDimensions(imageBytes: Buffer): Promise<{ width?: number; height?: number }> {
  const meta = await sharp(imageBytes).metadata();
  return { width: meta.width, height: meta.height };
}
