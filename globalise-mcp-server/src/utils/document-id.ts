/**
 * Document ID parsing utilities for GLOBALISE documents.
 *
 * Document IDs follow the format: NL-HaNA_{archive}_{inventory}_{scan}
 * URNs follow the format: urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}
 */

import { ToolError } from './errors.js';

export interface ParsedDocumentId {
  archive: string;
  inventoryNumber: string;
  scanNumber: string;
}

/**
 * Normalize a document ID to URN format.
 * Returns unchanged if already a URN.
 */
export function normalizeDocumentId(docId: string): string {
  // Case-insensitive + anchored: a "URN:GLOBALISE:..." id must be recognized as
  // already-prefixed, not double-prefixed and then rejected (CODE-REVIEW
  // finding 17). Same regex strips it in parseDocumentId.
  if (/^urn:globalise:/i.test(docId)) {
    return docId;
  }
  return `urn:globalise:${docId}`;
}

/** Document ID shape: NL-HaNA_{archive}_{inventory}_{scan}. */
const DOCUMENT_ID_PATTERN = /^NL-HaNA_([\d.]+)_([^_]+)_([^_]+)$/;

/**
 * Extract archive, inventory, and scan numbers from a document ID or URN.
 * Format: NL-HaNA_{archive}_{inventory}_{scan}
 *
 * Malformed IDs throw a structured error (R13) instead of flowing into an
 * upstream URN lookup that would 404 confusingly.
 */
export function parseDocumentId(docId: string): ParsedDocumentId {
  const cleanId = docId.replace(/^urn:globalise:/i, '');
  const match = cleanId.match(DOCUMENT_ID_PATTERN);

  if (!match) {
    throw new ToolError(
      `Invalid document ID: ${docId}`,
      'Expected NL-HaNA_{archive}_{inventory}_{scan}, e.g. "NL-HaNA_1.04.02_9966_0106" (optionally prefixed with "urn:globalise:").',
    );
  }

  return {
    archive: match[1],
    inventoryNumber: match[2],
    scanNumber: match[3],
  };
}
