/**
 * IIIF URL utilities for GLOBALISE documents
 *
 * The National Archives IIIF Image API uses GUID-based paths rather than document IDs.
 * URLs must be extracted from the API response (anno[0].target[0].source), not constructed.
 */

import { DocumentResponse } from './types.js';

/**
 * IIIF Image API base URL for the National Archives
 */
export const IIIF_BASE_URL = 'https://service.archief.nl/iip';

/**
 * Extract the IIIF image URL from a document API response.
 *
 * The image URL is found in the annotation target's source field.
 * Format: https://service.archief.nl/iip/{guid-path}.jp2/full/max/0/default.jpg
 *
 * @param response - The API response from retrieving a document
 * @returns The IIIF image URL or undefined if not available
 */
export function extractIiifImageUrl(response: DocumentResponse): string | undefined {
  // The IIIF image URL is in anno[0].target[0].source
  const target = response.anno?.[0]?.target?.[0];

  if (target && typeof target === 'object' && 'source' in target) {
    return target.source as string;
  }

  return undefined;
}

/**
 * Build an OpenSeadragon-compatible tile source configuration
 *
 * For IIIF images, we need to provide the info.json URL for OpenSeadragon's
 * IIIFTileSource. The info.json endpoint is derived from the image URL by
 * replacing the image parameters with 'info.json'.
 *
 * @param iiifImageUrl - The full IIIF image URL
 * @returns Object with tileSources configuration for OpenSeadragon
 */
export function buildOpenSeadragonTileSource(iiifImageUrl: string): {
  type: 'image' | 'tilesource';
  url: string;
} {
  // IIIF URLs follow the pattern:
  // .../full/max/0/default.jpg -> extract base and use info.json
  // For IIPImage servers, we might need to use the image directly

  // Check if this is an IIPImage IIIF endpoint (service.archief.nl)
  if (iiifImageUrl.includes('service.archief.nl')) {
    // IIPImage doesn't support info.json in the expected way
    // Use the image directly as a simple image source
    return {
      type: 'image',
      url: iiifImageUrl,
    };
  }

  // For standard IIIF servers, try to derive the info.json URL
  const infoJsonUrl = iiifImageUrl.replace(/\/full\/[^/]+\/\d+\/default\.\w+$/, '/info.json');

  return {
    type: 'tilesource',
    url: infoJsonUrl,
  };
}

/**
 * Build a thumbnail URL from an IIIF image URL
 *
 * @param iiifImageUrl - The full IIIF image URL
 * @param width - Thumbnail width (height will be scaled proportionally)
 * @returns Thumbnail URL
 */
export function buildThumbnailUrl(iiifImageUrl: string, width: number = 400): string {
  // Replace IIIF parameters: /full/max/0/default.jpg -> /full/{width},/0/default.jpg
  return iiifImageUrl.replace(
    /\/full\/max\/(\d+)\/default\.(\w+)$/,
    `/full/${width},/$1/default.$2`
  );
}
