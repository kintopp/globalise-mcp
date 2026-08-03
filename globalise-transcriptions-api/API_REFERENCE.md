# API Reference

Complete endpoint documentation for the GLOBALISE Transcriptions API.

**Base URL:** `https://gloccoli.tt.di.huc.knaw.nl`

> **Access status (verified 2026-08-03):** The API is public — no keys or tokens — and is
> reachable directly from ordinary client networks. See
> [Access & Authentication](./AUTHENTICATION.md).

---

## Endpoints Overview

| Endpoint | Method | Description | MCP Server Usage |
|----------|--------|-------------|------------------|
| [`/projects/globalise/search`](#search-transcriptions) | POST | Full-text search | `globalise_search_transcriptions` |
| [`/projects/globalise/{urn}`](#get-document) | GET | Get document details | `globalise_retrieve_document`, `globalise_navigate`, `globalise_view_document_ui` |
| [`/config`](#get-configuration) | GET | Application config | Internal only |
| [`/brinta/globalise/indices`](#get-indices) | GET | Index information | Internal only |

---

## Search Transcriptions

Full-text search across approximately 4.78 million indexed VOC transcription pages.

**Endpoint:** `POST /projects/globalise/search`

**Base URL:** `https://gloccoli.tt.di.huc.knaw.nl`

**MCP Server Usage:** Used by `globalise_search_transcriptions`

### Request

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `indexName` | string | No | (single available index) | Search index name (e.g., `globalise-2024.03.18-test`). Optional in practice: omitting it falls back to the only index the server exposes. Passing an unknown name returns `404 Unknown index`. |
| `fragmentSize` | integer | No | 100 | Size of text fragments in results |
| `from` | integer | No | 0 | Offset for pagination (0-indexed) |
| `size` | integer | No | 10 | Number of results to return (max varies) |
| `sortBy` | string | No | `_score` | Field to sort by (`_score`, `invNr`, etc.) |
| `sortOrder` | string | No | `desc` | Sort direction (`asc` or `desc`) |

**Request Headers:**

| Header | Value | Required |
|--------|-------|----------|
| `Content-Type` | `application/json` | Yes |

**Request Body:**

```json
{
  "text": "schip",
  "terms": {},
  "aggs": {
    "invNr": { "order": "countDesc", "size": 10 },
    "document": { "order": "countDesc", "size": 10 },
    "langIso": { "order": "countDesc", "size": 10 },
    "langLabel": { "order": "countDesc", "size": 10 }
  }
}
```

**Body Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | Search query (see [Query Syntax](./QUERY_SYNTAX.md)) |
| `terms` | object | No | Term filters for faceted search (defaults to `{}` if omitted) |
| `aggs` | object | No | Aggregation definitions (defaults to `{}` if omitted) |

> Only `text` is required by the live API. `terms`/`aggs` may be omitted, but sending them (even as `{}`) is recommended for clarity.

**Terms Object (Filtering):**

Filter results by specific field values:

```json
{
  "terms": {
    "invNr": ["9966"],
    "langIso": ["nld"]
  }
}
```

| Filter Field | Type | Description |
|--------------|------|-------------|
| `invNr` | string[] | Filter by inventory numbers |
| `langIso` | string[] | Filter by ISO language codes (`nld`, `por`, `unknown`) |
| `langLabel` | string[] | Filter by language names (`Dutch`, `Portuguese`, `Unknown`) |
| `document` | string[] | Filter by document IDs |

**Aggregations Object:**

Request facet counts for filtering UI:

```json
{
  "aggs": {
    "invNr": { "order": "countDesc", "size": 10 },
    "langIso": { "order": "countDesc", "size": 10 }
  }
}
```

| Aggregation | Description |
|-------------|-------------|
| `invNr` | Count by inventory number |
| `document` | Count by document ID |
| `langIso` | Count by ISO language code |
| `langLabel` | Count by language name |

**Aggregation Options:**

| Option | Values | Description |
|--------|--------|-------------|
| `order` | `countDesc`, `countAsc`, `keyDesc`, `keyAsc` | Sort order for buckets |
| `size` | integer | Maximum buckets to return |

### Response

**Success Response (200 OK):**

**Response Headers:**

| Header | Value |
|--------|-------|
| `Content-Type` | `application/json` |
| `Access-Control-Allow-Origin` | *reflects the request `Origin`* (only present when an `Origin` header is sent) |
| `Access-Control-Allow-Credentials` | `true` |

See [Authentication › CORS Policy](./AUTHENTICATION.md#cors-policy) for details — the server echoes the caller's `Origin` rather than returning a literal `*`.

**Response Body:**

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
    },
    "langLabel": {
      "Dutch": 754174,
      "Unknown": 1078
    }
  }
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `total.value` | integer | Total matching documents |
| `total.relation` | string | `eq` (exact) or `gte` (at least) |
| `results` | array | Array of search results |
| `results[]._id` | string | Document URN |
| `results[]._hits.text` | string[] | Highlighted text fragments (`<em>` tags mark matches) |
| `results[].textTokenCount` | integer | Token count in document |
| `results[].invNr` | string | Inventory number |
| `results[].document` | string | Document identifier |
| `results[].langIso` | string[] | ISO language codes |
| `results[].langLabel` | string[] | Language names |
| `aggs` | object | Aggregation results (field -> value -> count) |

**Error Responses:**

See [Error Reference](./ERROR_REFERENCE.md) for detailed error documentation.

| Status | Description |
|--------|-------------|
| 400 | Invalid query syntax or malformed request |
| 404 | Unknown `indexName` |
| 500 | Internal server error |
| 504 | Request timeout (reduce result size) |

### Examples

**Simple Search:**

```bash
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=10" \
  -H "Content-Type: application/json" \
  -d '{"text": "schip", "terms": {}, "aggs": {}}'
```

```javascript
// JavaScript (Browser)
async function searchTranscriptions(query, options = {}) {
  const { size = 10, from = 0 } = options;

  const params = new URLSearchParams({
    indexName: "globalise-2024.03.18-test",
    size: size.toString(),
    from: from.toString()
  });

  const response = await fetch(
    `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: query,
        terms: {},
        aggs: {
          invNr: { order: "countDesc", size: 10 },
          langIso: { order: "countDesc", size: 10 }
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  return response.json();
}

// Usage
const results = await searchTranscriptions("peper AND koffie");
console.log(`Found ${results.total.value} documents`);
```

```javascript
// Node.js (axios)
const axios = require("axios");

async function searchTranscriptions(query, options = {}) {
  const { size = 10, from = 0 } = options;

  const response = await axios.post(
    "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search",
    {
      text: query,
      terms: {},
      aggs: {
        invNr: { order: "countDesc", size: 10 },
        langIso: { order: "countDesc", size: 10 }
      }
    },
    {
      params: {
        indexName: "globalise-2024.03.18-test",
        size,
        from
      },
      timeout: 30000
    }
  );

  return response.data;
}
```

**Search with Filters:**

```bash
# Filter by inventory number
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=10" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "koffie",
    "terms": { "invNr": ["9966"] },
    "aggs": {}
  }'

# Filter by language
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=10" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "*",
    "terms": { "langIso": ["por"] },
    "aggs": {}
  }'
```

**Pagination:**

```javascript
// Get page 3 (results 20-29)
const page = 3;
const pageSize = 10;

const response = await fetch(
  `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&from=${(page - 1) * pageSize}&size=${pageSize}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "schip", terms: {}, aggs: {} })
  }
);
```

**Get Statistics Only (No Results):**

```javascript
// Use size=0 to get only aggregations without any result documents
const response = await fetch(
  "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=0",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "*",
      terms: { "invNr": ["4293"] },
      aggs: {
        langIso: { order: "countDesc", size: 100 }
      }
    })
  }
);

const { total, aggs } = await response.json();
console.log(`Inventory 4293 has ${total.value} documents`);
console.log("Language distribution:", aggs.langIso);
// Note: results array will be empty ([]) when size=0
```

---

## Get Document

Retrieve detailed information for a specific document including transcription, annotations, and IIIF references.

**Endpoint:** `GET /projects/globalise/{documentUrn}`

**Base URL:** `https://gloccoli.tt.di.huc.knaw.nl`

**MCP Server Usage:** Used by `globalise_retrieve_document`, `globalise_navigate`, `globalise_view_document_ui`

### Request

**Path Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentUrn` | string | Yes | Full document URN (e.g., `urn:globalise:NL-HaNA_1.04.02_9966_0106`) |

**Query Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `overlapTypes` | string | No | - | Type filter (e.g., `px:Page`) |
| `includeResults` | string | No | - | Comma-separated: `anno`, `iiif`, `text` |
| `views` | string | No | - | View type (e.g., `self`) |
| `relativeTo` | string | No | - | Reference point (e.g., `Origin`) |

**Recommended Parameters:**

For full document retrieval with IIIF image data, use these parameters:

```
?overlapTypes=px:Page&includeResults=anno,iiif,text&views=self&relativeTo=Origin
```

**Note:** Including `iiif` in `includeResults` returns a top-level `iiif` object with manifest and canvas URLs, providing cleaner access to IIIF data than parsing annotation targets.

### Response

**Success Response (200 OK):**

```json
{
  "profile": {
    "anno": { "findByBodyId": 0, "fetchOverlap[text]": 0, "fetchManifest": 0 },
    "text": { "fetchTextLines": 43 },
    "self": { "total": 43 }
  },
  "request": {
    "projectId": "globalise",
    "bodyId": "urn:globalise:NL-HaNA_1.04.02_9966_0106",
    "views": ["self"],
    "include": ["anno", "text"],
    "overlapTypes": ["px:Page"],
    "relativeTo": "Origin"
  },
  "anno": [
    {
      "@context": "http://www.w3.org/ns/anno.jsonld",
      "id": "https://annorepo.globalise.huygens.knaw.nl/w3c/globalise-2024-03-18/...",
      "type": "Annotation",
      "motivation": "classifying",
      "generated": "2024-03-18T18:29:51.438127",
      "generator": {
        "id": "https://github.com/knaw-huc/loghi-htr",
        "type": "Software",
        "name": "Loghi"
      },
      "body": {
        "id": "urn:globalise:NL-HaNA_1.04.02_9966_0106",
        "type": "px:Page",
        "metadata": {
          "type": "PageMetadata",
          "document": "NL-HaNA_1.04.02_9966_0106",
          "file": "NL-HaNA_1.04.02_9966_0106.xml",
          "inventoryNumber": "9966",
          "n": "0106",
          "eDepotId": "d0f3a03c-5a52-4343-9d61-4f577a1ec8f3",
          "creator": "Laypa",
          "created": "2023-09-04T01:43:55",
          "lastChange": "2023-09-04T02:52:52",
          "comment": "license: CC0",
          "naUrl": "https://www.nationaalarchief.nl/onderzoeken/archief/1.04.02/invnr/9966/file/NL-HaNA_1.04.02_9966_0106",
          "trUrl": "https://globalise.tt.di.huc.knaw.nl/textrepo/task/find/NL-HaNA_1.04.02_9966_0106/file/contents?type=pagexml",
          "prevPageId": "urn:globalise:NL-HaNA_1.04.02_9966_0105",
          "nextPageId": "urn:globalise:NL-HaNA_1.04.02_9966_0107",
          "lang": [
            { "iso": "nld", "label": "Dutch" }
          ],
          "langCorrected": false
        }
      },
      "target": [
        {
          "source": "https://service.archief.nl/iip/...",
          "type": "Image"
        },
        {
          "source": "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json/canvas/p106",
          "type": "Canvas"
        },
        {
          "source": "https://globalise.tt.di.huc.knaw.nl/textrepo/rest/versions/.../contents",
          "type": "Text",
          "selector": { "type": "TextAnchorSelector", "start": 5245, "end": 5292 }
        }
      ]
    }
  ],
  "views": {
    "self": {
      "lines": [
        "314",
        "de singaleesche kar=",
        "damom:.",
        "verslag nopens",
        "de koffie:"
      ]
    }
  },
  "iiif": {
    "manifest": "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json",
    "canvasIds": [
      "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json/canvas/p106"
    ]
  }
}
```

**Key Response Fields:**

| Field | Description |
|-------|-------------|
| `anno[].body.metadata.document` | Document identifier |
| `anno[].body.metadata.inventoryNumber` | Archive inventory number |
| `anno[].body.metadata.creator` | Layout analysis software (e.g., "Laypa") |
| `anno[].body.metadata.naUrl` | Link to National Archives page |
| `anno[].body.metadata.trUrl` | TextRepo provenance URL — **not publicly retrievable** (see note below) |
| `anno[].body.metadata.prevPageId` | Previous page URN (for navigation) |
| `anno[].body.metadata.nextPageId` | Next page URN (for navigation) |
| `anno[].body.metadata.lang` | Language classification |
| `anno[].generator.name` | OCR software (e.g., "Loghi") |
| `anno[].target[]` | IIIF image, canvas, and text references |
| `views.self.lines` | Transcribed text as array of lines |
| `iiif.manifest` | IIIF Presentation API manifest URL (when `includeResults=iiif`) |
| `iiif.canvasIds[]` | IIIF Canvas URLs for this document (when `includeResults=iiif`) |

> **Timestamp note:** Fields such as `generated`, `created`, and `lastChange` use ISO-like
> strings without a timezone offset in the live data (for example,
> `2023-09-04T01:43:55`). Treat them as upstream-local/unspecified-zone timestamps rather
> than strict RFC 3339 instants.

> **Note on TextRepo URLs:** `trUrl`, and the `Text`/`LogicalText` entries in `anno[].target[]`,
> point at `globalise.tt.di.huc.knaw.nl/textrepo`. That service is gated behind HTTP Basic auth
> (`WWW-Authenticate: Basic realm="Globalise Text Repository API"`) and returns **401 to
> unauthenticated callers** on every route, verified 2026-08-03. Treat these as provenance
> identifiers, not fetchable endpoints. You do not need them: Broccoli resolves the transcription
> server-side and returns it in `views.self.lines` — that is where the text in this endpoint's
> response comes from.

> **Note on IIIF URLs:** The `iiif.manifest` and `iiif.canvasIds` fields are available in the raw API but are **not exposed in the MCP server**. IIIF Canvas URLs are fragment identifiers meant for IIIF viewers (e.g., Mirador), not direct access. The IIIF manifest JSON contains no useful information beyond what's already provided: high-resolution images are accessible via the `nationalArchives` URL, and inventory titles are in the document metadata. For viewing page scans, use the National Archives link returned by the MCP server.

**Error Responses:**

| Status | Description |
|--------|-------------|
| 404 | Document not found |
| 500 | Internal server error |

### Examples

**Get Full Document:**

```bash
curl "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:NL-HaNA_1.04.02_9966_0106?overlapTypes=px:Page&includeResults=anno,iiif,text&views=self&relativeTo=Origin"
```

```javascript
// JavaScript (Browser)
async function getDocument(documentId) {
  const params = new URLSearchParams({
    overlapTypes: "px:Page",
    includeResults: "anno,iiif,text",
    views: "self",
    relativeTo: "Origin"
  });

  const response = await fetch(
    `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:${documentId}?${params}`
  );

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Document not found: ${documentId}`);
    }
    throw new Error(`Failed to retrieve document: ${response.status}`);
  }

  return response.json();
}

// Usage
const doc = await getDocument("NL-HaNA_1.04.02_9966_0106");

// Get transcription text
const transcription = doc.views.self.lines.join("\n");
console.log(transcription);

// Get navigation links
const metadata = doc.anno[0]?.body?.metadata;
console.log("Previous:", metadata?.prevPageId);
console.log("Next:", metadata?.nextPageId);

// Get IIIF references (cleaner access via top-level iiif object)
console.log("IIIF Manifest:", doc.iiif?.manifest);
console.log("IIIF Canvas:", doc.iiif?.canvasIds?.[0]);

// Get high-resolution image URL (from annotation targets)
const imageTarget = doc.anno[0]?.target?.find(t => t.type === "Image");
console.log("Image:", imageTarget?.source);
```

```javascript
// Node.js (axios)
const axios = require("axios");

async function getDocument(documentId) {
  const response = await axios.get(
    `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:${documentId}`,
    {
      params: {
        overlapTypes: "px:Page",
        includeResults: "anno,iiif,text",
        views: "self",
        relativeTo: "Origin"
      },
      timeout: 30000
    }
  );

  return response.data;
}
```

**Navigate Between Pages:**

```javascript
async function navigateToPage(currentDocId, direction) {
  const doc = await getDocument(currentDocId);
  const metadata = doc.anno[0]?.body?.metadata;

  const targetUrn = direction === "next"
    ? metadata?.nextPageId
    : metadata?.prevPageId;

  if (!targetUrn) {
    throw new Error(`No ${direction} page available`);
  }

  // Extract document ID from URN
  const targetDocId = targetUrn.replace("urn:globalise:", "");
  return getDocument(targetDocId);
}
```

---

## Get Configuration

Retrieve application configuration including the current index name.

**Endpoint:** `GET /config`

**Base URL:** `https://transcriptions.globalise.huygens.knaw.nl`

**MCP Server Usage:** Internal use only (not exposed as a public tool)

### Request

No parameters required.

### Response

```json
{
  "indexName": "docs-2024-03-18-test",
  "broccoliUrl": "https://gloccoli.tt.di.huc.knaw.nl"
}
```

| Field | Description |
|-------|-------------|
| `indexName` | Index name configured for the **frontend SPA** (see warning below) |
| `broccoliUrl` | Base URL for the search API |

> ⚠️ **Do not use `/config`'s `indexName` for the search API.** As of 2026-08-03, `/config`
> advertises `docs-2024-03-18-test`, but searching the Broccoli API with that name returns
> `404 Unknown index`. The only index the search/document endpoints actually serve is
> `globalise-2024.03.18-test` (confirm via [`/brinta/globalise/indices`](#get-indices)).
> `/config` reflects the SPA's own configuration, which has drifted from the search backend.
> Use the hardcoded `globalise-2024.03.18-test`, or omit `indexName` entirely (it falls back
> to the single available index).

### Example

```bash
curl "https://transcriptions.globalise.huygens.knaw.nl/config"
```

---

## Get Indices

Retrieve available search indices and their field types.

**Endpoint:** `GET /brinta/globalise/indices`

**Base URL:** `https://gloccoli.tt.di.huc.knaw.nl`

**MCP Server Usage:** Internal use only (not exposed as a public tool)

### Request

No parameters required.

### Response

```json
{
  "globalise-2024.03.18-test": {
    "invNr": "keyword",
    "document": "keyword",
    "langIso": "keyword",
    "langLabel": "keyword"
  }
}
```

| Field | Description |
|-------|-------------|
| `[indexName]` | Object containing field type mappings |
| `invNr` | Inventory number field (keyword type) |
| `document` | Document ID field (keyword type) |
| `langIso` | ISO language code field (keyword type) |
| `langLabel` | Language label field (keyword type) |

### Example

```bash
curl "https://gloccoli.tt.di.huc.knaw.nl/brinta/globalise/indices"
```

---

## Language Classifications

Documents may carry more than one language, so the counts below overlap and do not sum to the
match-all total. The full set of 23 codes was read from the live `langIso`/`langLabel`
aggregations on 2026-08-03; treat the list as observed corpus data rather than an API enum that
forbids future codes.

| ISO Code | Label | Matching pages |
|----------|-------|---------------:|
| `nld` | Dutch | 4,344,249 |
| `unknown` | Unknown | 136,014 |
| `fra` | French | 5,596 |
| `eng` | English | 3,600 |
| `lat` | Latin | 2,196 |
| `por` | Portuguese | 583 |
| `msa` | Malay | 502 |
| `spa` | Spanish | 273 |
| `deu` | German | 139 |
| `sin` | Sinhala | 113 |
| `dan` | Danish | 29 |
| `lzh` | Classical Chinese | 20 |
| `ita` | Italian | 18 |
| `art` | Cipher | 8 |
| `fas` | Persian | 8 |
| `tam` | Tamil | 8 |
| `jpn` | Japanese | 6 |
| `ben` | Bengali | 3 |
| `bug` | Buginese | 2 |
| `chu` | Old Church Slavonic | 2 |
| `guj` | Gujarati | 2 |
| `grc` | Ancient Greek | 1 |
| `hbo` | Ancient Hebrew | 1 |

**Note:** "Unknown" means the language has not yet been classified, not that it is unidentifiable.
"Cipher" uses ISO code `art` ("artificial language") for deliberately encrypted historical text.

**Transcription reliability:** the HTR model was trained on Latin script only, so transcriptions
of the non-Roman-script languages above (`fas`, `ben`, `tam`, `sin`, `lzh`, `jpn`, `guj`, `bug`,
`chu`, `grc`, `hbo`) are unreliable. Prefer the `naUrl` page scan for those documents.

---

## Common Patterns

### Get Inventory Statistics

```javascript
// Get document count and language distribution for an inventory
const response = await fetch(
  "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=1",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: "*",
      terms: { invNr: ["4293"] },
      aggs: { langIso: { order: "countDesc", size: 100 } }
    })
  }
);

const { total, aggs } = await response.json();
// total.value = document count
// aggs.langIso = { "nld": 500, "unknown": 35, ... }
```

### Build a Search UI

```javascript
async function search(query, filters = {}, page = 1, pageSize = 20) {
  const response = await fetch(
    `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&from=${(page - 1) * pageSize}&size=${pageSize}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: query || "*",
        terms: filters,
        aggs: {
          invNr: { order: "countDesc", size: 20 },
          langLabel: { order: "countDesc", size: 10 }
        }
      })
    }
  );

  const data = await response.json();

  return {
    total: data.total.value,
    page,
    pageSize,
    totalPages: Math.ceil(data.total.value / pageSize),
    results: data.results.map(r => ({
      id: r._id,
      documentId: r.document,
      inventory: r.invNr,
      language: r.langLabel[0],
      snippet: r._hits?.text?.[0] || ""
    })),
    facets: {
      inventories: Object.entries(data.aggs.invNr || {}),
      languages: Object.entries(data.aggs.langLabel || {})
    }
  };
}
```
