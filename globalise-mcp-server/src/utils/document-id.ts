/**
 * Document ID parsing utilities for GLOBALISE documents.
 *
 * Document IDs follow the format: NL-HaNA_{archive}_{inventory}_{scan}
 * URNs follow the format: urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}
 */

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
  if (docId.startsWith('urn:globalise:')) {
    return docId;
  }
  return `urn:globalise:${docId}`;
}

/**
 * Document ID shape: NL-HaNA_{archive}_{inventory}_{scan}, with exactly four
 * underscore-separated segments (so a match splits unambiguously).
 */
const DOCUMENT_ID_PATTERN = /^NL-HaNA_[\d.]+_[^_]+_[^_]+$/;

/**
 * Extract archive, inventory, and scan numbers from a document ID or URN.
 * Format: NL-HaNA_{archive}_{inventory}_{scan}
 *
 * Malformed IDs throw a structured error (R13) instead of flowing into an
 * upstream URN lookup that would 404 confusingly.
 */
export function parseDocumentId(docId: string): ParsedDocumentId {
  const cleanId = docId.replace('urn:globalise:', '');

  if (!DOCUMENT_ID_PATTERN.test(cleanId)) {
    throw {
      error: `Invalid document ID: ${docId}`,
      suggestion: 'Expected NL-HaNA_{archive}_{inventory}_{scan}, e.g. "NL-HaNA_1.04.02_9966_0106" (optionally prefixed with "urn:globalise:").',
    };
  }

  const parts = cleanId.split('_');
  return {
    archive: parts[1],
    inventoryNumber: parts[2],
    scanNumber: parts[3],
  };
}
