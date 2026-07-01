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
