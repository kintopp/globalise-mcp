/**
 * Type definitions for GLOBALISE API responses
 */

export interface SearchResponse {
  total: {
    value: number;
    relation: 'eq' | 'gte';
  };
  results: SearchResult[];
  aggs: {
    invNr?: Record<string, number>;
    document?: Record<string, number>;
    langIso?: Record<string, number>;
    langLabel?: Record<string, number>;
  };
}

export interface SearchResult {
  _id: string;
  // Upstream omits these on zero-token (blank) pages — and `_hits` whenever
  // there are no highlight fragments — rather than returning empty arrays.
  // Optional here so consumers are forced to guard them (see search.ts).
  _hits?: {
    text: string[];
  };
  textTokenCount: number;
  invNr: string;
  document: string;
  langIso?: string[];
  langLabel?: string[];
}

export interface DocumentResponse {
  profile: {
    anno: Record<string, number>;
    text: Record<string, number>;
    self: {
      total: number;
    };
  };
  request: {
    projectId: string;
    bodyId: string;
    views: string[];
    include: string[];
    overlapTypes: string[];
    relativeTo: string;
  };
  anno: Annotation[];
  views: {
    self: {
      lines: string[];
    };
  };
  iiif?: {
    manifest: string;
    canvasIds: string[];
  };
}

export interface Annotation {
  '@context': string;
  id: string;
  type: string;
  motivation: string;
  generated: string;
  generator: {
    id: string;
    type: string;
    name: string;
  };
  body: {
    id: string;
    type: string;
    metadata: PageMetadata;
  };
  target: AnnotationTarget[];
}

export interface PageMetadata {
  type: string;
  document: string;
  file: string;
  inventoryNumber: string;
  n: string;
  eDepotId: string;
  creator: string;
  created: string;
  lastChange: string;
  // Carries the page license as a "license: <value>" string. Upstream is not
  // guaranteed to set it on every page, so it is optional and untrusted —
  // normalizeLicense() in document.ts maps a missing/empty value to undefined
  // (CODE-REVIEW finding 1).
  comment?: string;
  naUrl: string;
  trUrl: string;
  prevPageId?: string;
  nextPageId?: string;
  lang: Array<{
    iso: string;
    label: string;
  }>;
  langCorrected: boolean;
}

export interface AnnotationTarget {
  source: string;
  type: string;
  selector?: {
    type: string;
    start: number;
    end: number;
  };
}

export interface IndicesResponse {
  [indexName: string]: {
    [fieldName: string]: 'keyword' | 'text' | 'date';
  };
}
