# Technical README

A Model Context Protocol (MCP) server for searching and retrieving historical transcriptions from the Dutch East India Company (VOC) provided by the GLOBALISE project.

**Version:** 1.8.1
**MCP Specification:** 2025-11-25

## Overview

This MCP server provides access to ~4.8 million transcribed pages from the so-called 'Overgekomen Brieven en Papieren' (Letters and papers received, OBP) collection, a key series of Dutch East India Company (VOC) documents and reports that were sent over from the company’s Asian headquarters in Batavia (now Jakarta in Indonesia) to the Dutch Republic between 1609 and 1795.

## Features

### 5 Optimized Tools

All tools include:
- **Input validation** with clear error messages
- **Tool annotations** (readOnlyHint, destructiveHint, idempotentHint)
- **Simplified schemas** for broad client compatibility
- **Clickable viewer links** - Every result includes a link to the GLOBALISE Transcriptions Viewer 

#### 1. globalise_search_transcriptions
**Primary search tool** - Full-text search across all 4.8M transcriptions

Features:
- Boolean operators (AND, OR, NOT)
- Wildcards (* and ?)
- Fuzzy matching (~N for edit distance)
- Exact phrases in quotes
- Phrase proximity (`"word1 word2"~5` for words within N positions)
- Language filtering (23 languages supported)
- Inventory number filtering (single or multiple: `["9966", "4293"]`)
- Sorting by relevance, document ID, or inventory number
- Pagination support
- Each result includes a clickable viewer URL

#### 2. globalise_retrieve_document
**Document retrieval** - Get complete document details by ID

Returns:
- Full transcribed text (line-by-line and concatenated)
- Metadata:
  - Archive collection ID
  - Creation/modification dates
  - Layout analysis system
  - OCR software
  - Annotation generation timestamp
  - Languages with ISO codes
  - License (CC0)
- URLs (as clickable markdown links):
  - **Transcriptions Viewer** - Opens document with scan + transcription side-by-side
  - **National Archives** - Direct link to page scan
- Navigation links (previous/next page IDs)

#### 3. globalise_navigate
**Sequential navigation** - Browse pages in order

Features:
- Navigate to next/previous page
- Automatically retrieves target page content
- Returns full document details
- Handles inventory boundaries

#### 4. globalise_search_by_inventory
**Inventory-scoped search** - Search within specific archival collections

Features:
- Filter by inventory number
- Optional text query within inventory
- Language filtering
- Returns scan numbers and document counts

#### 5. globalise_search_by_language
**Language-specific search** - Find documents in a particular language

Features:
- Supports ISO codes ("fas") or language names ("Persian")
- Optional text query within language
- Returns inventory distribution counts
- For filtering by a document's language

### Getting Statistics & Aggregations

All search tools return aggregations alongside results. To get language distribution or inventory statistics without retrieving full documents:

**Pattern:** Use `query="*"` with `size=1`

```javascript
// Example: Get language breakdown for inventory 4293
globalise_search_transcriptions({
  query: "*",
  inventoryNumber: "4293",
  size: 1
})

// Returns: Total count + language distribution aggregations
// - Dutch: 521 documents (97.4%)
// - English: 4 documents (0.7%)
// - French: 3 documents (0.6%)
// - Unknown: 2 documents (0.4%)
```

This pattern minimizes result payload while providing full aggregation data. Works with all search tools.

### Language Classification Notes

- **"Unknown"**: Refers to pages whose language has not yet been determined (it does not mean that the language itself is unidentifiable)
- **"Cipher"** (ISO code "art"): Pages containing Dutch text encrypted with a cipher - classified by Globalise as an artificial language in the temporary absence of further metadata (per ISO standard such pages should still be classified as Dutch)

### Transcriptions Viewer URLs

All tools return clickable links to the GLOBALISE Transcriptions Viewer, which displays:
- Page scan image alongside the transcription
- Search term highlighting
- Navigation between pages

**URL format:**
```
https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:NL-HaNA_1.04.02_9966_0106
```

**How links appear in responses:**

For document retrieval and navigation:
```
**View in Transcriptions Viewer:**
[NL-HaNA_1.04.02_9966_0106](https://transcriptions.globalise.huygens.knaw.nl/detail/...)
```

For search results (numbered list, max 10):
```
**View in Transcriptions Viewer:**
1. [NL-HaNA_1.04.02_9966_0106](https://...)
2. [NL-HaNA_1.04.02_9697_0051](https://...)
...
```

These markdown links render as clickable in MCP clients that support markdown (Claude Desktop, ChatGPT, MSTY).

## Quick Start

### Hosted Instance

A public instance is available at:

```
https://globalise-mcp-production.up.railway.app/mcp
```

Use this URL directly in any MCP client that supports HTTP transport. No authentication is required.

**Health check:** https://globalise-mcp-production.up.railway.app/health

## Transports

The server supports three transport modes for different use cases:

### Stdio Transport (Default)

**For:** Claude Desktop integration and local use

**Start server:**
```bash
node dist/index.js
```

The server communicates via standard input/output (stdio), making it perfect for MCP clients like Claude Desktop.

### HTTP Transport (Remote Access)

**For:** Remote access, web-based clients, OpenAI ChatGPT, and server deployments

**Start server:**
```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

**Configuration:**
- `TRANSPORT` - Set to 'http' for HTTP mode (default: 'stdio')
- `PORT` - Server port (default: 3000)
- `ALLOWED_ORIGINS` - Comma-separated CORS origins (default: '*')

**Endpoints:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST | Streamable HTTP requests (recommended) |
| `/mcp` | GET | SSE stream for notifications |
| `/mcp` | DELETE | Terminate session |
| `/sse` | GET | Legacy SSE connection |
| `/messages` | POST | Legacy SSE messages |
| `/health` | GET | Health check |

**Streamable HTTP (Recommended):**
```bash
# Initialize session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'

# Response includes mcp-session-id header for subsequent requests
```

**OpenAI ChatGPT Integration:**
1. Start server: `TRANSPORT=http PORT=3000 node dist/index.js`
2. Create tunnel: `ngrok http 3000`
3. In ChatGPT: Settings → Connectors → Developer mode → Add MCP server
4. Use ngrok URL + `/mcp` endpoint

**Legacy SSE (Backward Compatible):**
```bash
# Establish SSE connection
curl -N http://localhost:3000/sse

# Send messages to session
curl -X POST "http://localhost:3000/messages?sessionId=<id>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Health check:**
```bash
curl http://localhost:3000/health
# Returns transport status, active sessions, and version info
```

## Testing with MCP Inspector

```bash
npm run inspector
```

This will:
1. Build the TypeScript code
2. Launch the MCP Inspector
3. Allow you to test all tools interactively

## Usage with Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "globalise": {
      "command": "node",
      "args": ["/absolute/path/to/globalise-mcp-server/dist/index.js"]
    }
  }
}
```

**Important:** Use the absolute path to the `dist/index.js` file.

Restart Claude Desktop to load the server.

## Example Queries

### Search Examples

**Basic search:**
```typescript
{
  "query": "peper"
}
```

**Boolean search:**
```typescript
{
  "query": "peper AND koffie",
  "size": 20
}
```

**Wildcard search:**
```typescript
{
  "query": "schip*"
}
```

**Fuzzy search:**
```typescript
{
  "query": "voorschreven~1"
}
```

**Language filtering - Dutch only:**
```typescript
{
  "query": "schip",
  "languages": ["nld"]
}
```

**Inventory filtering (single):**
```typescript
{
  "query": "koffie",
  "inventoryNumber": "9966"
}
```

**Inventory filtering (multiple):**
```typescript
{
  "query": "koffie",
  "inventoryNumber": ["9966", "4293"]
}
```

**Sorting:**
```typescript
{
  "query": "peper",
  "sortBy": "document",
  "sortOrder": "asc"
}
```

**Pagination:**
```typescript
{
  "query": "peper",
  "from": 20,
  "size": 10
}
```

**Pagination Limits:**
- Default: 10 results
- Maximum: 500 results per request
- Use `from` parameter to paginate through larger result sets

### Document Retrieval

**Get document by ID:**
```typescript
{
  "documentId": "NL-HaNA_1.04.02_9966_0106"
}
```

**Get document by URN:**
```typescript
{
  "documentId": "urn:globalise:NL-HaNA_1.04.02_9966_0106"
}
```

### Navigation

**Navigate to next page:**
```typescript
{
  "currentDocumentId": "NL-HaNA_1.04.02_9966_0106",
  "direction": "next"
}
```

**Navigate to previous page:**
```typescript
{
  "currentDocumentId": "NL-HaNA_1.04.02_9966_0106",
  "direction": "previous"
}
```

### Search by Inventory

**All documents in inventory:**
```typescript
{
  "inventoryNumber": "9966"
}
```

**Search within inventory:**
```typescript
{
  "inventoryNumber": "9966",
  "query": "koffie",
  "size": 20
}
```

**Inventory search with language filter:**
```typescript
{
  "inventoryNumber": "9966",
  "query": "koffie",
  "languages": ["nld"]
}
```

### Search by Language

**Find all Persian documents:**
```typescript
{
  "language": "Persian"
}
```

**Find Bengali documents with text:**
```typescript
{
  "language": "Bengali",
  "query": "trade"
}
```

**Using ISO codes:**
```typescript
{
  "language": "fas"
}
```

**With inventory distribution:**
```typescript
{
  "language": "Persian",
  "includeInventoryCounts": true
}
```

## Query Syntax

- **Boolean**: `peper AND koffie`, `peper OR koffie`, `peper NOT koffie`
- **Wildcards**: `schip*` (multi-char), `cop?e` (single-char)
- **Fuzzy**: `voorschreven~1` (edit distance of 1)
- **Phrases**: `"exact phrase in quotes"`
- **Proximity**: `"peper koffie"~5` (words within 5 positions of each other)
- **Combine**: `(peper OR koffie) AND schip*`

**Note on punctuation:** Apostrophes, periods, and hyphens are stripped during indexing. Search for `Gravenhage` rather than `'s-Gravenhage`. Years like `1609` work correctly. See [QUERY_SYNTAX.md](../globalise-transcriptions-api/QUERY_SYNTAX.md) for full details.

## Language Support

The GLOBALISE archive contains documents in 23 languages:

The vast majority of the corpus (c. 96%) is in Dutch, with all other languages representing less than 0.1% of the total. Approximately 3% remains 'Unknown' in the sense of not yet classified by either automatic or manual methods. For further details of the language composition of the corpus, see https://globalise.huygens.knaw.nl/the-languages-of-globalise/ 

**Filter by Language:**
- Using ISO codes: `languages: ["nld", "fas", "ben"]`
- Using human names: via `globalise_search_by_language` tool

## Document URN Format

```
urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}
```

**Example:** `urn:globalise:NL-HaNA_1.04.02_9966_0106`
- Archive: `1.04.02` (VOC archive)
- Inventory: `9966`
- Scan: `0106`

## API Details

**Base URL**: `https://gloccoli.tt.di.huc.knaw.nl`

**Current Index**: `globalise-2024.03.18-test` (~4.8M documents)

**Authentication**: None required (public API)

**License**: CC0 1.0

**Request Throttling**: The server enforces a 100ms minimum delay between API requests to avoid overwhelming the upstream GLOBALISE API. This is configurable via `API_CONFIG.REQUEST_DELAY_MS` in `src/utils/api-client.ts`.

**Citation**: When using transcriptions, cite as:
```
NL-HaNA, VOC, [inv.nr.], [scan nr.], transcription GLOBALISE project (https://globalise.huygens.knaw.nl/), March 2024
```

## Architecture

The GLOBALISE ecosystem consists of:
- **Frontend SPA**: https://transcriptions.globalise.huygens.knaw.nl
- **Search API**: Broccoli/Gloccoli platform
- **Text Storage**: TextRepo
- **Annotations**: AnnoRepo
- **Images**: IIIF Image API

This MCP server primarily interacts with the Search API and aggregates data from the other services.

## Development

### Project Structure

```
globalise-mcp-server/
├── src/
│   ├── index.ts              # Server entry point, tool definitions
│   ├── tools/
│   │   ├── search.ts         # Search tool with simplified schema
│   │   ├── document.ts       # Document retrieval with simplified schema
│   │   ├── config.ts         # Config and indices (internal use)
│   │   └── convenience.ts    # Inventory, language, and navigation tools
│   ├── transports/
│   │   └── http-server.ts    # Streamable HTTP + SSE transports
│   └── utils/
│       ├── api-client.ts     # HTTP client with timeout & caching
│       ├── cache.ts          # LRU cache with TTL support
│       └── types.ts          # Type definitions
├── dist/                     # Compiled JavaScript (generated)
├── package.json
├── tsconfig.json
└── README.md
```

### TypeScript Configuration

- Target: ES2022
- Module: Node16 (ESM)
- Strict mode enabled
- Source maps enabled

### Build Scripts

```json
{
  "build": "tsc",
  "dev": "tsc --watch",
  "start": "node dist/index.js",
  "inspector": "npm run build && npx @modelcontextprotocol/inspector dist/index.js"
}
```

### Adding New Tools

When adding new tools, follow these guidelines to ensure Claude Desktop compatibility:

1. **Use simplified schemas** - Avoid:
   - `additionalProperties` (use specific fields instead)
   - More than 5 optional boolean parameters
   - More than 10 total parameters
   - Generic tool names (search, get, create, update, delete)

2. **Use specific, descriptive names**
   - ✅ `globalise_search_transcriptions`
   - ❌ `globalise_search`

3. **Add validation messages**
   ```typescript
   query: z.string()
     .min(1, "Search query cannot be empty")
     .describe('Search query text...')
   ```

4. **Include tool annotations**
   ```typescript
   annotations: {
     readOnlyHint: true,      // Is this read-only?
     destructiveHint: false,  // Does it modify data?
     idempotentHint: true     // Same input = same output?
   }
   ```

5. **Add structured descriptions**
   ```typescript
   description:
     '**TOOL TYPE** - Brief description. ' +
     '\n\n**USE WHEN:** Specific scenarios. Examples: "example 1", "example 2". ' +
     '\n\n**REQUIRES:** Required parameters. ' +
     '\n\n**RETURNS:** What it returns. ' +
     '\n\n**DO NOT USE FOR:** When not to use this tool.'
   ```

See `STRATEGIES_IMPLEMENTED.md` for complete maintenance guidelines.

## MCP Specification Compliance

This server complies with the **MCP 2025-11-25 specification**:

✅ **Protocol Features:**
- JSON-RPC 2.0 message format
- Stdio transport for local usage
- Tools capability with 5 optimized tools
- Proper error handling with `isError: true`

✅ **Tool Best Practices:**
- Tool annotations (readOnlyHint, destructiveHint, idempotentHint)
- Input schemas with Zod validation
- Output schemas for type safety
- Clear, actionable descriptions
- Validation error messages

✅ **Type Safety:**
- TypeScript strict mode
- Zod schema validation
- Type inference throughout

## Resources

- **GLOBALISE Project**: https://globalise.huygens.knaw.nl/
- **Transcriptions Viewer**: https://transcriptions.globalise.huygens.knaw.nl
- **Loghi HTR**: https://github.com/knaw-huc/loghi-htr
- **National Archives**: https://www.nationaalarchief.nl/
- **MCP Documentation**: https://modelcontextprotocol.io/
- **MCP Specification**: https://modelcontextprotocol.io/specification/2025-11-25

## License

MIT License - see LICENSE file

## Author

Arno Bosse with Claude Code

## Contributing

Contributions welcome! Please ensure:
- TypeScript compiles without errors (`npm run build`)
- All tools have proper Zod schemas with validation messages
- Tools include annotations and output schemas
- Tools are tested with MCP Inspector (`npm run inspector`)
- Documentation is updated
- Follow the maintenance guidelines in `STRATEGIES_IMPLEMENTED.md`
