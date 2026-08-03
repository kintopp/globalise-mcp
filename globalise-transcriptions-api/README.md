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

## MCP Server

An MCP (Model Context Protocol) server is available for AI assistant integration. See the [`globalise-mcp-server/`](../globalise-mcp-server/) directory for installation and usage instructions.

**Available Tools:**
- `globalise_find_archival_documents` - Search local archival finding aids (inventory-level)
- `globalise_search_transcriptions` - Full-text search with filters
- `globalise_retrieve_document` - Get document details and transcription
- `globalise_navigate` - Navigate between pages
- `globalise_lookup_commodity` - Resolve a trade good to its Dutch label, definition, and period spelling variants
- `globalise_lookup_measure` - Look up a VOC weight/measure unit — type, spelling variants, and period conversion ratios
- `globalise_view_document_ui` - Open a page in the interactive viewer (MCP Apps UI)

## Document URN Structure

Documents are identified by URNs following this pattern:

```
urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}
```

**Example:** `urn:globalise:NL-HaNA_1.04.02_9966_0106`
- **Archive:** `1.04.02` (VOC archive collection)
- **Inventory:** `9966` (inventory number)
- **Scan:** `0106` (page/scan number)

## License & Citation

All transcriptions are available under **CC0 (Creative Commons Zero)** license.

When using transcriptions in research, please cite:

```
NL-HaNA, VOC, [inv.nr.], [scan nr.], transcription GLOBALISE project
(https://globalise.huygens.knaw.nl/), March 2024
```

**Important:** These are machine-generated transcriptions and may contain errors. They have not been manually verified.

## Current API Version

- **Index:** `globalise-2024.03.18-test`
- **Transcription Date:** March 2024
- **Indexed pages:** `4,784,614` (match-all count verified 2026-08-03)

## Additional Resources

- [GLOBALISE Project](https://globalise.huygens.knaw.nl/) - Main project website
- [National Archives (Nationaal Archief)](https://www.nationaalarchief.nl/) - Source archives
- [Research Methodology](./GLOBALISE_API_Research_Summary.md) - How this API was documented
