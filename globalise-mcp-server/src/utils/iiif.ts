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
  const target = response.anno?.[0]?.target?.[0];

  if (target && typeof target === 'object' && 'source' in target) {
    return target.source as string;
  }

  return undefined;
}
