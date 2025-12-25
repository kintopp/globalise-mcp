# Data Models

JSON schemas and TypeScript type definitions for the GLOBALISE Transcriptions API.

## Table of Contents

- [Search Request](#search-request)
- [Search Response](#search-response)
- [Document Response](#document-response)
- [W3C Annotation](#w3c-annotation)
- [Document URN](#document-urn)
- [TypeScript Definitions](#typescript-definitions)

---

## Search Request

Request body for `POST /projects/globalise/search`

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["text", "terms", "aggs"],
  "properties": {
    "text": {
      "type": "string",
      "description": "Search query text. Supports boolean operators, wildcards, and fuzzy matching."
    },
    "terms": {
      "type": "object",
      "description": "Term filters for faceted search",
      "properties": {
        "invNr": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Filter by inventory numbers"
        },
        "langIso": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Filter by ISO language codes (e.g., 'nld', 'por')"
        },
        "langLabel": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Filter by language names (e.g., 'Dutch', 'Portuguese')"
        },
        "document": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Filter by document identifiers"
        }
      },
      "additionalProperties": {
        "type": "array",
        "items": { "type": "string" }
      }
    },
    "aggs": {
      "type": "object",
      "description": "Aggregation definitions for facet counts",
      "properties": {
        "invNr": { "$ref": "#/$defs/aggregation" },
        "document": { "$ref": "#/$defs/aggregation" },
        "langIso": { "$ref": "#/$defs/aggregation" },
        "langLabel": { "$ref": "#/$defs/aggregation" }
      },
      "additionalProperties": { "$ref": "#/$defs/aggregation" }
    }
  },
  "$defs": {
    "aggregation": {
      "type": "object",
      "properties": {
        "order": {
          "type": "string",
          "enum": ["countDesc", "countAsc", "keyDesc", "keyAsc"],
          "description": "Sort order for aggregation buckets"
        },
        "size": {
          "type": "integer",
          "minimum": 1,
          "description": "Maximum number of buckets to return"
        }
      }
    }
  }
}
```

### Example

```json
{
  "text": "peper AND koffie",
  "terms": {
    "invNr": ["9966"],
    "langIso": ["nld"]
  },
  "aggs": {
    "invNr": { "order": "countDesc", "size": 10 },
    "langIso": { "order": "countDesc", "size": 10 }
  }
}
```

---

## Search Response

Response from `POST /projects/globalise/search`

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["total", "results", "aggs"],
  "properties": {
    "total": {
      "type": "object",
      "required": ["value", "relation"],
      "properties": {
        "value": {
          "type": "integer",
          "description": "Total number of matching documents"
        },
        "relation": {
          "type": "string",
          "enum": ["eq", "gte"],
          "description": "'eq' = exact count, 'gte' = at least this many"
        }
      }
    },
    "results": {
      "type": "array",
      "items": { "$ref": "#/$defs/searchResult" }
    },
    "aggs": {
      "type": "object",
      "description": "Aggregation results: field -> value -> count",
      "additionalProperties": {
        "type": "object",
        "additionalProperties": { "type": "integer" }
      }
    }
  },
  "$defs": {
    "searchResult": {
      "type": "object",
      "required": ["_id"],
      "properties": {
        "_id": {
          "type": "string",
          "description": "Document URN (e.g., 'urn:globalise:NL-HaNA_1.04.02_2174_0057')"
        },
        "_hits": {
          "type": "object",
          "properties": {
            "text": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Text fragments with <em> tags highlighting matches"
            }
          }
        },
        "textTokenCount": {
          "type": "integer",
          "description": "Number of tokens in the document"
        },
        "invNr": {
          "type": "string",
          "description": "Inventory number"
        },
        "document": {
          "type": "string",
          "description": "Document identifier"
        },
        "langIso": {
          "type": "array",
          "items": { "type": "string" },
          "description": "ISO language codes"
        },
        "langLabel": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Human-readable language names"
        }
      }
    }
  }
}
```

### Example

```json
{
  "total": {
    "value": 755310,
    "relation": "eq"
  },
  "results": [
    {
      "_id": "urn:globalise:NL-HaNA_1.04.02_2174_0057",
      "_hits": {
        "text": [
          "<em>schip</em> meerlust - - - - - - - - - - 4: —. na bengalen het <em>schip</em> strijkebolle"
        ]
      },
      "textTokenCount": 351,
      "invNr": "2174",
      "document": "NL-HaNA_1.04.02_2174_0057",
      "langIso": ["nld"],
      "langLabel": ["Dutch"]
    }
  ],
  "aggs": {
    "invNr": {
      "1119": 902,
      "1139": 657
    },
    "langIso": {
      "nld": 754174,
      "unknown": 1078
    }
  }
}
```

---

## Document Response

Response from `GET /projects/globalise/{documentUrn}`

### JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "profile": {
      "type": "object",
      "description": "Performance profiling information"
    },
    "request": {
      "type": "object",
      "description": "Echo of request parameters",
      "properties": {
        "projectId": { "type": "string" },
        "bodyId": { "type": "string" },
        "views": { "type": "array", "items": { "type": "string" } },
        "include": { "type": "array", "items": { "type": "string" } },
        "overlapTypes": { "type": "array", "items": { "type": "string" } },
        "relativeTo": { "type": "string" }
      }
    },
    "anno": {
      "type": "array",
      "items": { "$ref": "#/$defs/w3cAnnotation" },
      "description": "W3C Web Annotations with document metadata"
    },
    "views": {
      "type": "object",
      "properties": {
        "self": {
          "type": "object",
          "properties": {
            "lines": {
              "type": "array",
              "items": { "type": "string" },
              "description": "Transcribed text as array of lines"
            }
          }
        }
      }
    }
  },
  "$defs": {
    "w3cAnnotation": {
      "type": "object",
      "description": "W3C Web Annotation format",
      "properties": {
        "@context": { "const": "http://www.w3.org/ns/anno.jsonld" },
        "id": { "type": "string", "format": "uri" },
        "type": { "const": "Annotation" },
        "motivation": { "type": "string" },
        "generated": { "type": "string", "format": "date-time" },
        "generator": { "$ref": "#/$defs/generator" },
        "body": { "$ref": "#/$defs/annotationBody" },
        "target": {
          "type": "array",
          "items": { "$ref": "#/$defs/annotationTarget" }
        }
      }
    },
    "generator": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "format": "uri" },
        "type": { "type": "string" },
        "name": { "type": "string", "description": "OCR software name (e.g., 'Loghi')" }
      }
    },
    "annotationBody": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "Document URN" },
        "type": { "type": "string", "description": "Usually 'px:Page'" },
        "metadata": { "$ref": "#/$defs/pageMetadata" }
      }
    },
    "pageMetadata": {
      "type": "object",
      "properties": {
        "type": { "const": "PageMetadata" },
        "document": { "type": "string", "description": "Document identifier" },
        "file": { "type": "string", "description": "Source XML filename" },
        "inventoryNumber": { "type": "string" },
        "n": { "type": "string", "description": "Page/scan number" },
        "eDepotId": { "type": "string", "format": "uuid" },
        "creator": { "type": "string", "description": "Layout analysis software (e.g., 'Laypa')" },
        "created": { "type": "string", "format": "date-time" },
        "lastChange": { "type": "string", "format": "date-time" },
        "comment": { "type": "string" },
        "naUrl": { "type": "string", "format": "uri", "description": "National Archives URL" },
        "trUrl": { "type": "string", "format": "uri", "description": "TextRepo URL" },
        "prevPageId": { "type": "string", "description": "Previous page URN" },
        "nextPageId": { "type": "string", "description": "Next page URN" },
        "lang": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "iso": { "type": "string" },
              "label": { "type": "string" }
            }
          }
        },
        "langCorrected": { "type": "boolean" }
      }
    },
    "annotationTarget": {
      "type": "object",
      "properties": {
        "source": { "type": "string", "format": "uri" },
        "type": {
          "type": "string",
          "enum": ["Image", "Canvas", "Text"],
          "description": "Target type"
        },
        "selector": {
          "type": "object",
          "properties": {
            "type": { "const": "TextAnchorSelector" },
            "start": { "type": "integer" },
            "end": { "type": "integer" }
          }
        }
      }
    }
  }
}
```

---

## Document URN

Document identifiers follow a specific URN format.

### Format

```
urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| `urn:globalise:` | URN prefix | Fixed value |
| `NL-HaNA` | National Archives Netherlands | Fixed value |
| `{archive}` | Archive collection number | `1.04.02` (VOC) |
| `{inventory}` | Inventory number | `9966` |
| `{scan}` | Scan/page number (zero-padded) | `0106` |

### Examples

| URN | Archive | Inventory | Scan |
|-----|---------|-----------|------|
| `urn:globalise:NL-HaNA_1.04.02_9966_0106` | 1.04.02 | 9966 | 0106 |
| `urn:globalise:NL-HaNA_1.04.02_2174_0057` | 1.04.02 | 2174 | 0057 |

### Parsing Example

```javascript
function parseDocumentUrn(urn) {
  const match = urn.match(/^urn:globalise:NL-HaNA_([^_]+)_(\d+)_(\d+)$/);

  if (!match) {
    throw new Error(`Invalid URN format: ${urn}`);
  }

  return {
    archive: match[1],
    inventory: match[2],
    scan: match[3],
    documentId: `NL-HaNA_${match[1]}_${match[2]}_${match[3]}`
  };
}

// Usage
const parsed = parseDocumentUrn("urn:globalise:NL-HaNA_1.04.02_9966_0106");
// { archive: "1.04.02", inventory: "9966", scan: "0106", documentId: "NL-HaNA_1.04.02_9966_0106" }
```

---

## Language Codes

Documents are classified using ISO 639-3 language codes:

| ISO Code | Label | Description |
|----------|-------|-------------|
| `nld` | Dutch | Primary language (~754k documents) |
| `por` | Portuguese | Portuguese language |
| `fra` | French | French language |
| `deu` | German | German language |
| `lat` | Latin | Latin language |
| `eng` | English | English language |
| `spa` | Spanish | Spanish language |
| `unknown` | Unknown | Language not yet determined |
| `art` | Cipher | Deliberately encrypted text |

**Note:** "Unknown" means the language classification has not yet been performed, not that the language is unidentifiable. "Cipher" uses ISO code `art` (artificial language) for deliberately encrypted historical text.

---

## TypeScript Definitions

Complete TypeScript type definitions for the API:

```typescript
// ============================================
// Search API Types
// ============================================

/** Aggregation order options */
type AggregationOrder = "countDesc" | "countAsc" | "keyDesc" | "keyAsc";

/** Aggregation definition */
interface Aggregation {
  order?: AggregationOrder;
  size?: number;
}

/** Aggregation definitions by field */
interface Aggregations {
  invNr?: Aggregation;
  document?: Aggregation;
  langIso?: Aggregation;
  langLabel?: Aggregation;
  [key: string]: Aggregation | undefined;
}

/** Term filters for faceted search */
interface TermFilters {
  invNr?: string[];
  langIso?: string[];
  langLabel?: string[];
  document?: string[];
  [key: string]: string[] | undefined;
}

/** Search request body */
interface SearchRequest {
  text: string;
  terms: TermFilters;
  aggs: Aggregations;
}

/** Search query parameters */
interface SearchParams {
  indexName: string;
  fragmentSize?: number;
  from?: number;
  size?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

/** Individual search result */
interface SearchResult {
  _id: string;
  _hits?: {
    text?: string[];
  };
  textTokenCount?: number;
  invNr?: string;
  document?: string;
  langIso?: string[];
  langLabel?: string[];
}

/** Total count information */
interface TotalCount {
  value: number;
  relation: "eq" | "gte";
}

/** Aggregation results: field -> value -> count */
type AggregationResults = Record<string, Record<string, number>>;

/** Search response */
interface SearchResponse {
  total: TotalCount;
  results: SearchResult[];
  aggs: AggregationResults;
}

// ============================================
// Document API Types
// ============================================

/** Language information */
interface LanguageInfo {
  iso: string;
  label: string;
}

/** Page metadata from annotation body */
interface PageMetadata {
  type: "PageMetadata";
  document: string;
  file: string;
  inventoryNumber: string;
  n: string;
  eDepotId?: string;
  creator: string;
  created: string;
  lastChange: string;
  comment?: string;
  naUrl: string;
  trUrl: string;
  prevPageId?: string;
  nextPageId?: string;
  lang: LanguageInfo[];
  langCorrected: boolean;
}

/** Annotation body */
interface AnnotationBody {
  id: string;
  type: string;
  metadata: PageMetadata;
}

/** Text anchor selector */
interface TextAnchorSelector {
  type: "TextAnchorSelector";
  start: number;
  end: number;
}

/** Annotation target */
interface AnnotationTarget {
  source: string;
  type: "Image" | "Canvas" | "Text";
  selector?: TextAnchorSelector;
}

/** Software generator */
interface Generator {
  id: string;
  type: string;
  name: string;
}

/** W3C Web Annotation */
interface W3CAnnotation {
  "@context": "http://www.w3.org/ns/anno.jsonld";
  id: string;
  type: "Annotation";
  motivation: string;
  generated: string;
  generator: Generator;
  body: AnnotationBody;
  target: AnnotationTarget[];
}

/** Document views */
interface DocumentViews {
  self?: {
    lines: string[];
  };
}

/** Document response */
interface DocumentResponse {
  profile?: Record<string, Record<string, number>>;
  request?: {
    projectId: string;
    bodyId: string;
    views: string[];
    include: string[];
    overlapTypes: string[];
    relativeTo: string;
  };
  anno: W3CAnnotation[];
  views: DocumentViews;
}

// ============================================
// Configuration Types
// ============================================

/** Application configuration */
interface AppConfig {
  indexName: string;
  broccoliUrl: string;
}

/** Index field types */
type FieldType = "keyword" | "text";

/** Index information */
type IndexInfo = Record<string, Record<string, FieldType>>;

// ============================================
// Utility Types
// ============================================

/** Parsed document URN */
interface ParsedUrn {
  archive: string;
  inventory: string;
  scan: string;
  documentId: string;
}

/** API error response */
interface ApiError {
  error: string;
  details?: string;
  message?: string;
  documentId?: string;
  retryAfter?: number;
  suggestion?: string;
}
```

### Usage Example

```typescript
import type { SearchRequest, SearchResponse, DocumentResponse } from "./types";

async function search(query: string): Promise<SearchResponse> {
  const request: SearchRequest = {
    text: query,
    terms: {},
    aggs: {
      invNr: { order: "countDesc", size: 10 },
      langIso: { order: "countDesc", size: 10 }
    }
  };

  const response = await fetch(
    "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    }
  );

  return response.json() as Promise<SearchResponse>;
}

async function getDocument(documentId: string): Promise<DocumentResponse> {
  const response = await fetch(
    `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:${documentId}?overlapTypes=px:Page&includeResults=anno,text&views=self&relativeTo=Origin`
  );

  return response.json() as Promise<DocumentResponse>;
}
```
