# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This repository documents the GLOBALISE Transcriptions Viewer API - a REST API for searching and retrieving Dutch East India Company (VOC) historical transcriptions. The API is powered by the Broccoli/Gloccoli platform.

## Key Documentation Files

- **API docs/README.md**: Starting point for API reference with all endpoints, request/response formats, and examples. See additional files in this directory.
- **research/GLOBALISE_API_Research_Summary.md**: Methodology, lessons learned, and research process documentation

## Semantic Search Tool 'ck'

The semantic code search tool 'ck' is available to you. It can find code by concept, not just keywords. ck understands synonyms, related terms, and conceptual similarity. You can also use it for hybrid search. This combines keyword precision with semantic understanding using Reciprocal Rank Fusion. ck also has drop-in grep compatibility (same flags, same behavior, same output format). Learn more about how to use ck with `ck --help`. 

Semantic and hybrid searches transparently create and refresh their indexes before running. The first search builds what it needs; subsequent searches intelligently reuse cached embeddings. This directory and its contents has already been indexed with ck using the default bge-small model (400-token chunks, fast indexing, good for most code).

## Outdated Files

- **outdated/**: This contains several outdated documents that can be ignored unless the user explicitly requests that they be consulted.

## API Architecture Overview

The GLOBALISE ecosystem consists of:

- **Frontend SPA**: `https://transcriptions.globalise.huygens.knaw.nl`
- **Search API**: `https://gloccoli.tt.di.huc.knaw.nl` (Broccoli/Gloccoli platform)
- **Text Storage**: TextRepo at `globalise.tt.di.huc.knaw.nl/textrepo`
- **Annotations**: AnnoRepo at `annorepo.globalise.huygens.knaw.nl`
- **Images**: IIIF Image API at `service.archief.nl/iip`

## Main API Endpoints

### Search API
```
POST https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search
Query params: indexName, fragmentSize, from, size, sortBy, sortOrder
Body: { text: "query", terms: {}, aggs: {...} }
```

### Document Detail API
```
GET https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:{doc_id}
Query params: overlapTypes, includeResults, views, relativeTo
```

### Configuration
```
GET https://transcriptions.globalise.huygens.knaw.nl/config
```

### Index Information
```
GET https://gloccoli.tt.di.huc.knaw.nl/brinta/globalise/indices
```

## Document URN Structure

Format: `urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}`

Example: `urn:globalise:NL-HaNA_1.04.02_9966_0106`
- Archive: `1.04.02` (VOC archive)
- Inventory: `9966`
- Scan: `0106`

## Search Query Syntax

The API supports Elasticsearch-like query syntax:

- **Boolean operators**: `peper AND koffie`, `peper OR koffie`, `peper NOT koffie`
- **Wildcards**: `schip*` (multi-char), `cop?e` (single-char)
- **Fuzzy matching**: `voorschreven~1` (edit distance)
- **Exact phrases**: `"exact phrase"`

## Browser Automation Approach

The API was documented using the dev-browser plugin with Playwright. Key pattern that worked:

```javascript
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("page-name");

// Network monitoring
const apiCalls = [];
page.on('request', request => { /* capture */ });
page.on('response', async response => { /* capture */ });

// Perform actions
await page.goto(url);
await page.fill('input[type="search"]', 'query');
await page.keyboard.press('Enter');
await page.waitForTimeout(3000); // Wait for API responses
```

## Important Notes

- **No authentication required** - API is public
- **CC0 License** - All transcriptions freely usable
- **Citation required** when using data:
  ```
  NL-HaNA, VOC, [inv.nr.], [scan nr.], transcription GLOBALISE project (https://globalise.huygens.knaw.nl/), March 2024
  ```
- **Machine-generated transcriptions** - Contains errors, not manually verified
- **Current index**: `globalise-2024.03.18-test`
- **~4.8M transcriptions** available

## Response Formats

### Search Response Structure
- `total`: Total matching documents
- `results[]`: Array of search results with highlighted fragments (`<em>` tags)
- `aggs`: Aggregation results (invNr, document, langIso, langLabel)

### Document Detail Response Structure
- `anno[]`: W3C Web Annotations with metadata
- `views.self.lines[]`: Transcribed text as array of lines
- Includes IIIF image URLs, TextRepo version URLs, and navigation (prev/next page)

## Development Recommendations

When building integrations with this API:

1. **Start with the documentation files** - All endpoints are fully documented
2. **Use dev-browser for testing** - More reliable than MCP browser extensions
3. **Implement pagination** - Use `from` and `size` parameters for large result sets
4. **Add explicit waits** - API calls are async, wait for responses
5. **Be respectful** - No documented rate limits, but add delays between requests
6. **Handle errors gracefully** - Test with invalid queries, missing documents, etc.

## Potential Use Cases

- Search client library implementation
- Bulk data export tools
- Custom search interfaces
- Historical research analysis tools
- IIIF image integration
- Text mining and NLP analysis

## MCP Server Implementation

### Current Version: 1.5.1

The `globalise-mcp-server/` directory contains a production-ready MCP server providing 5 optimized tools for accessing the GLOBALISE API.

**Transports:**
- **Stdio** (default) - For Claude Desktop local integration
- **Streamable HTTP** (`/mcp`) - For OpenAI ChatGPT, remote access, web clients
- **SSE** (`/sse`) - Legacy transport, maintained for backward compatibility

**Tested with:**
- Claude Desktop (stdio) ✅
- OpenAI ChatGPT Developer Mode (Streamable HTTP via ngrok) ✅
- MSTY (Streamable HTTP) - Claude, GPT-4o ✅
- Jan.ai (stdio) ✅ | Jan.ai HTTP ⚠️ (experimental MCP support has tool execution bug)
- MCP Inspector (both transports) ✅

### Key Files:

- `src/index.ts` - Tool definitions and MCP server configuration
- `src/tools/search.ts` - Search implementation with aggregations
- `src/tools/document.ts` - Document retrieval with comprehensive metadata
- `src/tools/convenience.ts` - Specialized search tools (inventory, language, navigation)
- `src/utils/api-client.ts` - HTTP client with timeouts, errors, and caching
- `src/utils/cache.ts` - LRU cache implementation
- `src/transports/http-server.ts` - Streamable HTTP + SSE transports
- `CHANGELOG.md` - Complete version history and lessons learned

### Remote Access (HTTP Mode)

Start the server in HTTP mode for remote access:
```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | Streamable HTTP requests (recommended) |
| `/mcp` | GET | SSE stream for notifications |
| `/mcp` | DELETE | Terminate session |
| `/sse` | GET | Legacy SSE connection |
| `/messages` | POST | Legacy SSE messages |
| `/health` | GET | Health check with transport status |

**OpenAI ChatGPT Integration:**
1. Start server: `TRANSPORT=http PORT=3000 node dist/index.js`
2. Create tunnel: `ngrok http 3000`
3. Add MCP server in ChatGPT with ngrok URL + `/mcp`

### Metadata Access

Documents retrieved via `globalise_retrieve_document` include:
- Archive collection ID (e.g., "1.04.02" for VOC archives)
- Layout analysis system (Laypa) and OCR software (Loghi HTR)
- Annotation generation timestamps
- High-resolution IIIF image URLs
- AnnoRepo annotation URLs (W3C Web Annotations)
- National Archives page links
- IIIF Canvas and Manifest URLs

### Statistics & Aggregations Pattern

To get language distribution or inventory statistics without retrieving full documents:
```javascript
// Use query="*" with size=1
globalise_search_transcriptions({
  query: "*",
  inventoryNumber: "4293",
  size: 1
})
```

This returns aggregations (language distribution, inventory counts) while minimizing result payload. This is the **intended pattern**, not a workaround - it's standard search API design (filter + aggregate).

### Lessons Learned: Claude Desktop Tool Filtering

**Versions 1.2.1-1.2.3 revealed tool filtering issues:**

1. **Cross-references between tools cause filtering**: Descriptions saying "use tool X instead" or comparing capabilities creates inference chains that make tools appear unrealistic
2. **Implied limits are problematic**: Saying a specialized tool has "100 result limit" while suggesting "use main tool for larger sets" causes Claude to filter the main tool
3. **Superlative language triggers filtering**: Words like "PRIMARY", "BETTER", "MORE POWERFUL" can trigger filtering
4. **Keep schemas simple**: Complex schemas with many boolean parameters or additionalProperties may be filtered

**Working patterns:**
- Neutral, factual descriptions without comparisons
- Concrete examples with real data (e.g., "inventory 4293 has 535 documents")
- No cross-references between tools
- Schema simplicity over feature richness
- Test immediately in Claude Desktop after changes

### Notes on Language Classification

- **"Unknown"**: Documents whose language has not yet been classified (not that it's unidentifiable). ISO 639-3 has code "und" for undefined, but GLOBALISE uses "unknown".
- **"Cipher"** (ISO code "art"): Encrypted Dutch text. The code "art" is ISO 639-3 for artificial/constructed languages, but GLOBALISE uses it for documents that are actually Dutch written in cipher.
- **Non-Roman Scripts**: The corpus was machine-transcribed using a model trained only on Latin characters. Transcriptions of Persian, Bengali, Tamil, Sinhala, Classical Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic, Ancient Greek, and Ancient Hebrew are unreliable. Always offer National Archives page scan links for these languages.
- **Malay** ("msa"): A macrolanguage code covering multiple Malay varieties. Some pages may be romanized, others not. No script metadata is available, so always offer page scan links.

### Design Philosophy

**Resist adding specialized tools when a general-purpose tool can handle the use case.**

More tools ≠ better UX. Often means:
- More confusion about which tool to use
- Higher maintenance burden
- Greater risk of Claude Desktop filtering
- Fragmented functionality

The current design prioritizes:
- Powerful, flexible general-purpose tools
- Clear documentation with concrete examples
- Consistent API patterns across tools
- Stability and predictability
