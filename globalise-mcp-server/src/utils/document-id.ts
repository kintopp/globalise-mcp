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
 * Extract archive, inventory, and scan numbers from a document ID or URN.
 * Format: NL-HaNA_{archive}_{inventory}_{scan}
 */
export function parseDocumentId(docId: string): ParsedDocumentId {
  const cleanId = docId.replace('urn:globalise:', '');
  const parts = cleanId.split('_');

  if (parts.length >= 4) {
    return {
      archive: parts[1],
      inventoryNumber: parts[2],
      scanNumber: parts[3],
    };
  }

  return {
    archive: 'unknown',
    inventoryNumber: 'unknown',
    scanNumber: 'unknown',
  };
}
