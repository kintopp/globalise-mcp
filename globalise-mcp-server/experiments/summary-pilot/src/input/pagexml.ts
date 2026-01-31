/**
 * PageXML parser - extracts structured text with region types and confidence scores
 *
 * PageXML structure:
 * - PcGts > Page > TextRegion (with custom="structure {type:marginalia;}")
 *   - TextLine > Word > TextEquiv > Unicode
 *   - TextLine > TextEquiv (with conf attribute)
 */

import { readFileSync, readdirSync } from 'fs';
import { XMLParser } from 'fast-xml-parser';
import { PageData, PageRegion, LineData } from '../types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
});

type RegionType = 'paragraph' | 'marginalia' | 'header' | 'unknown';

interface ParsedRegion {
  '@_id': string;
  '@_custom'?: string;
  TextLine?: ParsedLine | ParsedLine[];
}

interface ParsedLine {
  '@_id': string;
  TextEquiv?: {
    '@_conf'?: string;
    Unicode?: string;
  };
}

interface ReadingOrderRef {
  '@_regionRef': string;
  '@_index': string;
}

export function parsePageXML(filePath: string): PageData {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parser.parse(content);

  const page = parsed.PcGts?.Page;
  if (!page) {
    throw new Error(`Invalid PageXML: no Page element in ${filePath}`);
  }

  // Extract filename from path
  const filename = filePath.split('/').pop() || '';
  const pageId = filename.replace('.xml', '');

  // Get reading order if available
  const readingOrder = extractReadingOrder(page.ReadingOrder);

  // Parse text regions
  const rawRegions = page.TextRegion;
  const regions: PageRegion[] = [];

  if (rawRegions) {
    const regionArray = Array.isArray(rawRegions) ? rawRegions : [rawRegions];

    // Sort by reading order if available
    const sortedRegions = readingOrder.length > 0
      ? sortByReadingOrder(regionArray, readingOrder)
      : regionArray;

    for (const region of sortedRegions) {
      const parsed = parseRegion(region);
      if (parsed) {
        regions.push(parsed);
      }
    }
  }

  // Combine text from all regions
  const text = regions.map(r => r.text).join('\n\n');
  const wordCount = countWords(text);

  return {
    pageId,
    filename,
    text,
    wordCount,
    regions,
  };
}

function extractReadingOrder(readingOrderElement: unknown): string[] {
  if (!readingOrderElement) return [];

  const orderedGroup = (readingOrderElement as { OrderedGroup?: { RegionRefIndexed?: ReadingOrderRef | ReadingOrderRef[] } }).OrderedGroup;
  if (!orderedGroup?.RegionRefIndexed) return [];

  const refs = Array.isArray(orderedGroup.RegionRefIndexed)
    ? orderedGroup.RegionRefIndexed
    : [orderedGroup.RegionRefIndexed];

  return refs
    .sort((a, b) => parseInt(a['@_index']) - parseInt(b['@_index']))
    .map(ref => ref['@_regionRef']);
}

function sortByReadingOrder(regions: ParsedRegion[], order: string[]): ParsedRegion[] {
  const orderMap = new Map(order.map((id, idx) => [id, idx]));

  return [...regions].sort((a, b) => {
    const orderA = orderMap.get(a['@_id']) ?? Infinity;
    const orderB = orderMap.get(b['@_id']) ?? Infinity;
    return orderA - orderB;
  });
}

function parseRegion(region: ParsedRegion): PageRegion | null {
  const id = region['@_id'];
  const type = extractRegionType(region['@_custom']);

  const lines: LineData[] = [];
  let totalConfidence = 0;
  let confCount = 0;

  if (region.TextLine) {
    const lineArray = Array.isArray(region.TextLine) ? region.TextLine : [region.TextLine];

    for (const line of lineArray) {
      const lineData = parseLine(line);
      if (lineData) {
        lines.push(lineData);
        if (lineData.confidence !== undefined) {
          totalConfidence += lineData.confidence;
          confCount++;
        }
      }
    }
  }

  if (lines.length === 0) {
    return null;
  }

  const text = lines.map(l => l.text).join('\n');
  const avgConfidence = confCount > 0 ? totalConfidence / confCount : undefined;

  return {
    id,
    type,
    text,
    confidence: avgConfidence,
    lines,
  };
}

function extractRegionType(custom: string | undefined): RegionType {
  if (!custom) return 'paragraph';

  // Parse "structure {type:marginalia;}"
  const match = custom.match(/type:(\w+)/);
  if (!match) return 'paragraph';

  const typeStr = match[1].toLowerCase();

  switch (typeStr) {
    case 'marginalia':
      return 'marginalia';
    case 'header':
    case 'heading':
      return 'header';
    case 'paragraph':
    case 'text':
      return 'paragraph';
    default:
      return 'unknown';
  }
}

function parseLine(line: ParsedLine): LineData | null {
  const textEquiv = line.TextEquiv;
  if (!textEquiv?.Unicode) return null;

  const text = typeof textEquiv.Unicode === 'string'
    ? textEquiv.Unicode
    : String(textEquiv.Unicode);

  const confidence = textEquiv['@_conf']
    ? parseFloat(textEquiv['@_conf'])
    : undefined;

  return {
    id: line['@_id'],
    text,
    confidence,
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Parse all PageXML files in a directory
 */
export function parseAllPageXML(dirPath: string): Map<string, PageData> {
  const files = readdirSync(dirPath).filter(f => f.endsWith('.xml'));
  const pages = new Map<string, PageData>();

  for (const file of files) {
    try {
      const page = parsePageXML(`${dirPath}/${file}`);
      pages.set(page.pageId, page);
    } catch (error) {
      console.warn(`Failed to parse ${file}:`, error);
    }
  }

  return pages;
}

/**
 * Generate full XML representation for "pagexml-full" format
 */
export function getPageXMLFull(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}
