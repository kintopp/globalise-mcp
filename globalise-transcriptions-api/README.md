# GLOBALISE Transcriptions API

A REST API for searching and retrieving approximately 4.78 million indexed pages of Dutch East India Company (VOC) historical transcriptions from the 17th-18th centuries.

## Key Features

- **~4.78M Indexed Pages** - Machine-generated transcriptions of VOC archival documents
- **No Authentication** - Public API, no keys, tokens, or registration required
- **CC0 License** - All transcriptions are freely usable
- **Full-Text Search** - Elasticsearch-like query syntax with boolean operators, wildcards, and fuzzy matching
- **Rich Metadata** - IIIF images, W3C Web Annotations, language classification

## Quick Start

### Your First Search (30 seconds)

Search for documents containing "schip" (ship):

**cURL:**
```bash
curl -X POST "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=5" \
  -H "Content-Type: application/json" \
  -d '{"text": "schip", "terms": {}, "aggs": {}}'
```

**JavaScript (fetch):**
```javascript
const response = await fetch(
  "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search?indexName=globalise-2024.03.18-test&size=5",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "schip", terms: {}, aggs: {} })
  }
);
const data = await response.json();
console.log(`Found ${data.total.value} documents`);
```

### Retrieve a Document

Get the full transcription and metadata for a specific page:

**cURL:**
```bash
curl "https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:NL-HaNA_1.04.02_9966_0106?overlapTypes=px:Page&includeResults=anno,text&views=self&relativeTo=Origin"
```

**JavaScript (fetch):**
```javascript
const docId = "NL-HaNA_1.04.02_9966_0106";
const response = await fetch(
  `https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:${docId}?overlapTypes=px:Page&includeResults=anno,text&views=self&relativeTo=Origin`
);
const doc = await response.json();
console.log(doc.views.self.lines.join("\n")); // Print transcription
```

## Base URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Search API | `https://gloccoli.tt.di.huc.knaw.nl` | Main search and document retrieval |
| Frontend | `https://transcriptions.globalise.huygens.knaw.nl` | Web interface |
| Text Storage | `https://globalise.tt.di.huc.knaw.nl/textrepo` | Raw text repository |
| Annotations | `https://annorepo.globalise.huygens.knaw.nl` | W3C Web Annotations |
| Images | `https://service.archief.nl/iip` | IIIF Image API |

## Text Processing

The API uses Elasticsearch's **standard tokenizer**:

- **Punctuation stripped**: `peper` finds `peper,`, `peper.`, etc. automatically
- **Special characters are word separators**: `oost-indie` = `oost indie`, `Comp=s` = `comp s`
- **Case insensitive**: `Batavia` = `batavia`
- **Page-level results**: Search returns pages, not individual word occurrences

See [Query Syntax](./QUERY_SYNTAX.md#punctuation-and-special-characters) for details.

## Documentation

| Document | Description |
|----------|-------------|
| [API Reference](./API_REFERENCE.md) | Complete endpoint documentation with examples |
| [Authentication](./AUTHENTICATION.md) | Access requirements, CORS, rate limiting |
| [Query Syntax](./QUERY_SYNTAX.md) | Search query language guide |
| [Data Models](./DATA_MODELS.md) | Request/response schemas with TypeScript types |
| [Error Reference](./ERROR_REFERENCE.md) | HTTP status codes and error handling |
| [OpenAPI Spec](./openapi.yaml) | Machine-readable API specification |
| [Methodology](./GLOBALISE_API_Research_Summary.md) | How this API was documented |

## Document URN Structure

Documents are identified by URNs following this pattern:

```
urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}
```

**Example:** `urn:globalise:NL-HaNA_1.04.02_9966_0106`
- **Archive:** `1.04.02` (VOC archive collection)
- **Inventory:** `9966` (inventory number)
- **Scan:** `0106` (page/scan number)

## Current API Version

- **Index:** `globalise-2024.03.18-test`
- **Transcription Date:** March 2024
- **Indexed pages:** `4,784,614` (match-all count verified 2026-08-03)

## License

This project is licensed under the MIT License — see the [LICENSE](../LICENSE) file for details. **The MIT License covers the source code only**; the bundled and derived datasets carry their own terms.

- GLOBALISE transcriptions, document metadata, and National Archives page images: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (Creative Commons Zero).
- Archival finding-aid index (`archival-index.sqlite`), derived from [GLOBALISE — Digitized Indexes of the Dutch East India Company OBP (1602–1799)](https://hdl.handle.net/10622/LVOQTG) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and [Overzicht van Generale Missiven in het archief van de VOC, 1.04.02](https://hdl.handle.net/10622/BHKMWE) ([CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.en)).
- Commodities and weights-&-measures glossaries (`reference.sqlite`), derived from the [GLOBALISE Thesaurus — Commodities](https://hdl.handle.net/10622/YAWDOV) and [GLOBALISE — Weights and Measures in the 18th-Century Indian Ocean World](https://hdl.handle.net/10622/MDNVH5), both [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.en).

The derived databases and the modified source files under [`data/sources/`](../globalise-mcp-server/data/sources/) are redistributed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.en). The glossaries have been substantially revised and are not official GLOBALISE datasets; the [repository README](../README.md#historical-finding-aids-and-glossaries) documents the attribution and the changes made.
