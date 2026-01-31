/**
 * Plaintext parser - extracts per-page text from the consolidated TXT file
 *
 * Format:
 * #+ ---
 * #+ NL-HaNA_1.04.02_10000_0001.xml
 * #+ ---
 * <page content>
 * #+ ---
 * #+ NL-HaNA_1.04.02_10000_0002.xml
 * #+ ---
 */

import { readFileSync } from 'fs';
import { PageData } from '../types.js';

const DELIMITER_PATTERN = /^#\+ ---\s*$/;
const FILENAME_PATTERN = /^#\+ (NL-HaNA_[\w.]+\.xml)\s*$/;

export function parsePlaintextFile(filePath: string): Map<string, PageData> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const pages = new Map<string, PageData>();
  let currentFilename: string | null = null;
  let currentLines: string[] = [];
  let inDisclaimer = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip disclaimer at the start (lines starting with #+)
    if (inDisclaimer && line.startsWith('#+') && !DELIMITER_PATTERN.test(line)) {
      continue;
    }

    // Check for delimiter
    if (DELIMITER_PATTERN.test(line)) {
      inDisclaimer = false;

      // Save previous page if we have one
      if (currentFilename && currentLines.length > 0) {
        const text = currentLines.join('\n').trim();
        const wordCount = countWords(text);
        const pageId = currentFilename.replace('.xml', '');

        pages.set(pageId, {
          pageId,
          filename: currentFilename,
          text,
          wordCount,
        });
      }

      // Look for filename on next line
      const nextLine = lines[i + 1];
      if (nextLine) {
        const match = nextLine.match(FILENAME_PATTERN);
        if (match) {
          currentFilename = match[1];
          currentLines = [];
          i++; // Skip the filename line

          // Skip the closing delimiter
          if (lines[i + 1] && DELIMITER_PATTERN.test(lines[i + 1])) {
            i++;
          }
        }
      }
      continue;
    }

    // Accumulate content lines
    if (currentFilename) {
      currentLines.push(line);
    }
  }

  // Handle last page
  if (currentFilename && currentLines.length > 0) {
    const text = currentLines.join('\n').trim();
    const wordCount = countWords(text);
    const pageId = currentFilename.replace('.xml', '');

    pages.set(pageId, {
      pageId,
      filename: currentFilename,
      text,
      wordCount,
    });
  }

  return pages;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}

/**
 * Get a single page by ID
 */
export function getPageText(pages: Map<string, PageData>, pageId: string): PageData | undefined {
  // Handle both with and without scan number padding
  if (pages.has(pageId)) {
    return pages.get(pageId);
  }

  // Try to find by scan number suffix
  for (const [id, page] of pages) {
    if (id.endsWith(pageId) || pageId.endsWith(id)) {
      return page;
    }
  }

  return undefined;
}

/**
 * Get statistics about the parsed pages
 */
export function getPageStats(pages: Map<string, PageData>): {
  totalPages: number;
  emptyPages: number;
  avgWordCount: number;
  minWordCount: number;
  maxWordCount: number;
  distribution: { short: number; medium: number; long: number };
} {
  const wordCounts = Array.from(pages.values()).map(p => p.wordCount);
  const nonEmpty = wordCounts.filter(c => c > 0);

  return {
    totalPages: pages.size,
    emptyPages: wordCounts.filter(c => c === 0).length,
    avgWordCount: nonEmpty.length > 0
      ? Math.round(nonEmpty.reduce((a, b) => a + b, 0) / nonEmpty.length)
      : 0,
    minWordCount: nonEmpty.length > 0 ? Math.min(...nonEmpty) : 0,
    maxWordCount: nonEmpty.length > 0 ? Math.max(...nonEmpty) : 0,
    distribution: {
      short: wordCounts.filter(c => c >= 50 && c <= 150).length,
      medium: wordCounts.filter(c => c > 150 && c <= 300).length,
      long: wordCounts.filter(c => c > 300).length,
    },
  };
}
