/**
 * Labeled format transformer
 *
 * Converts PageXML structured data into labeled plaintext format:
 *
 * [MARGINALIA]
 * Note about this section
 *
 * [PARAGRAPH]
 * Main text content here...
 *
 * [HEADER]
 * Section Title
 */

import { PageData, PageRegion, InputFormat } from '../types.js';
import { parsePageXML } from './pagexml.js';
import { DATA_DIR } from '../config.js';

const REGION_LABELS: Record<string, string> = {
  paragraph: 'PARAGRAPH',
  marginalia: 'MARGINALIA',
  header: 'HEADER',
  unknown: 'TEXT',
};

/**
 * Convert a PageData with regions into labeled plaintext format
 */
export function toLabeledFormat(page: PageData): string {
  if (!page.regions || page.regions.length === 0) {
    // If no regions, wrap the whole text as a paragraph
    return `[PARAGRAPH]\n${page.text}`;
  }

  const sections: string[] = [];

  for (const region of page.regions) {
    const label = REGION_LABELS[region.type] || 'TEXT';
    const confNote = region.confidence !== undefined
      ? ` (conf: ${(region.confidence * 100).toFixed(1)}%)`
      : '';

    sections.push(`[${label}${confNote}]\n${region.text}`);
  }

  return sections.join('\n\n');
}

/**
 * Load page in the specified input format
 */
export function loadPageInFormat(
  pageId: string,
  format: InputFormat,
  plaintextPages: Map<string, PageData>
): string {
  switch (format) {
    case 'plaintext': {
      const page = plaintextPages.get(pageId);
      if (!page) throw new Error(`Page not found: ${pageId}`);
      return page.text;
    }

    case 'pagexml-full': {
      const filename = `${pageId}.xml`;
      const filePath = `${DATA_DIR}/${filename}`;
      // Return raw XML (expensive in tokens but preserves all structure)
      const { readFileSync } = require('fs');
      return readFileSync(filePath, 'utf-8');
    }

    case 'labeled': {
      const filename = `${pageId}.xml`;
      const filePath = `${DATA_DIR}/${filename}`;
      const page = parsePageXML(filePath);
      return toLabeledFormat(page);
    }

    case 'contextual': {
      // Plaintext with archival context prepended
      const page = plaintextPages.get(pageId);
      if (!page) throw new Error(`Page not found: ${pageId}`);

      // Extract inventory and scan from pageId: NL-HaNA_1.04.02_10000_0043
      const parts = pageId.split('_');
      const inventory = parts[2] || 'unknown';
      const scan = parts[3] || 'unknown';

      const context = [
        '--- Archival Context ---',
        'Archive: VOC (Dutch East India Company)',
        'Archive Code: 1.04.02',
        `Inventory: ${inventory}`,
        `Scan: ${scan}`,
        'Settlement: Ceylon',
        'Year: 1786',
        '------------------------',
        '',
      ].join('\n');

      return context + page.text;
    }

    default:
      throw new Error(`Unknown format: ${format}`);
  }
}

/**
 * Get statistics about region types in a set of pages
 */
export function getRegionStats(pages: PageData[]): {
  totalRegions: number;
  byType: Record<string, number>;
  avgConfidence: number;
  lowConfidenceCount: number;
} {
  let totalRegions = 0;
  let totalConfidence = 0;
  let confCount = 0;
  let lowConfCount = 0;
  const byType: Record<string, number> = {
    paragraph: 0,
    marginalia: 0,
    header: 0,
    unknown: 0,
  };

  for (const page of pages) {
    if (!page.regions) continue;

    for (const region of page.regions) {
      totalRegions++;
      byType[region.type] = (byType[region.type] || 0) + 1;

      if (region.confidence !== undefined) {
        totalConfidence += region.confidence;
        confCount++;
        if (region.confidence < 0.8) {
          lowConfCount++;
        }
      }
    }
  }

  return {
    totalRegions,
    byType,
    avgConfidence: confCount > 0 ? totalConfidence / confCount : 0,
    lowConfidenceCount: lowConfCount,
  };
}
