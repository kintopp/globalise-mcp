/**
 * Shared IIIF info.json dimension fetch (plan 021).
 *
 * Extracted from `page-image.ts` so BOTH the inspect tool and the view tool
 * resolve a page's native pixel dimensions the same way (the view tool needs
 * them to seed the viewer session's imageWidth/imageHeight for region
 * coordinate projection). The info.json responses are tiny and immutable per scan, so the
 * cache is aggressive; a fetch failure degrades gracefully to `undefined` —
 * callers keep working without dims (bounds checks + clamps handle it).
 */

import { getCachedApiGet } from './api-client.js';
import { LRUCache } from './cache.js';
import { infoJsonUrlFromImageUrl } from './iiif.js';

interface IiifImageInfo {
  width?: number;
  height?: number;
}

/** info.json responses are tiny and immutable per scan — cache aggressively. */
const iiifInfoCache = new LRUCache<unknown>(200, 3600000);   // 200 pages, 1 h

/**
 * Resolve a page's native pixel dimensions from its IIIF info.json. Returns
 * undefined on any failure (unparseable image URL, fetch error, missing
 * width/height) so callers degrade gracefully.
 */
export async function fetchIiifDims(
  documentUrn: string,
  imageUrl: string,
): Promise<{ width: number; height: number } | undefined> {
  const infoUrl = infoJsonUrlFromImageUrl(imageUrl);
  if (!infoUrl) return undefined;
  try {
    const info = await getCachedApiGet<IiifImageInfo>(infoUrl, `iiif-info:${documentUrn}`, iiifInfoCache);
    if (typeof info.width === 'number' && typeof info.height === 'number') {
      return { width: info.width, height: info.height };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
