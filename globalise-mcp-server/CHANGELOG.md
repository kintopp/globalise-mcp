# Changelog

All notable changes to the GLOBALISE MCP Server will be documented in this file.

## [1.10.0] - 2025-12-27

### Added
- **Multi-language filtering with AND logic**: `globalise_search_by_language` now supports finding bilingual/multilingual documents
  - `language` parameter accepts arrays: `["nld", "eng"]` or `["Dutch", "English"]`
  - New `matchAll` parameter: when `true`, returns only documents containing ALL specified languages
  - Example: `language=["nld", "eng"], matchAll=true` finds Dutch-English bilingual documents
  - Default `matchAll=false` uses OR logic (documents with ANY of the languages)
- **Resource hints in tool descriptions**: Tool descriptions now reference relevant resources
  - `globalise_search_transcriptions` → `globalise://help/query-syntax`
  - `globalise_search_by_inventory` → `globalise://corpus/stats`
  - `globalise_search_by_language` → `globalise://languages`

### Changed
- **BREAKING: Language format unified to objects**: All search tools now return `languages` as `{code, label}[]` instead of `string[]`
  - Before: `languages: ["Dutch", "English"]`
  - After: `languages: [{code: "nld", label: "Dutch"}, {code: "eng", label: "English"}]`
  - This matches the format already used by `globalise_retrieve_document`
  - Provides ISO codes alongside human-readable labels for programmatic use

### Technical
- `searchByLanguage` uses post-filtering for AND logic since the upstream API only supports OR
- When `matchAll=true`, filters on the FIRST language only (assumed rarer), then post-filters for remaining languages
- Requests 10x more results when `matchAll=true` to ensure adequate post-filter matches
- IMPORTANT: Put the rarer language first in the array for best results (e.g., `["eng", "nld"]` not `["nld", "eng"]`)
- Updated Zod schemas in `search.ts` and `convenience.ts` to reflect new language object format
- Updated `globalise://help/query-syntax` resource to document multi-language and matchAll syntax

---

## [1.9.0] - 2025-12-27

### Added
- **MCP Resources support**: Implemented the Resources capability from MCP specification
  - `globalise://corpus/stats` - Corpus overview with total documents, language distribution, top inventories
  - `globalise://languages` - Complete language index with ISO codes, labels, counts, and usage notes
  - `globalise://help/query-syntax` - Query syntax reference guide (Markdown format)
- Resources provide application-controlled context that clients can read before making tool calls
- Data is cached (10 min TTL) for performance while remaining fresh

### Technical
- Added `resources` capability declaration with `subscribe: false` and `listChanged: false`
- Registered `ListResourcesRequestSchema` and `ReadResourceRequestSchema` handlers
- Created new `src/resources/index.ts` module with resource definitions and fetch logic
- Resources use existing API client infrastructure with LRU caching

### Learning Notes
This release implements MCP Resources as a learning exercise. Resources differ from Tools in that:
- **Resources** are application-controlled (server decides what context to provide)
- **Tools** are model-controlled (LLM decides when to invoke)
- Resources are ideal for static/semi-static context data like corpus metadata

---

## [1.8.1] - 2025-12-27

### Changed
- **Clickable viewer links**: Transcriptions Viewer URLs are now formatted as clickable markdown links
  - Document retrieval shows: `[NL-HaNA_1.04.02_3714_0343](https://...)`
  - Search results show numbered list of clickable links (max 10)
  - Links appear in a separate "View in Transcriptions Viewer" section after JSON response

---

## [1.8.0] - 2025-12-27

### Added
- **Transcriptions Viewer URL**: All tools now return a `transcriptionsViewer` URL for each document
  - Example: `https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:NL-HaNA_1.04.02_3714_0343`
  - Opens document in the GLOBALISE web interface with scan + transcription side-by-side
  - Includes search term highlighting when coming from a search
  - This is the most user-friendly link - previously only `nationalArchives` (raw scan) was available

### Changed
- `globalise_retrieve_document`: `urls` object now includes `transcriptionsViewer` (always present) and `nationalArchives`
- `globalise_search_transcriptions`: Each result now includes `viewerUrl` field
- `globalise_search_by_inventory`: Each result now includes `viewerUrl` field
- `globalise_search_by_language`: Each result now includes `viewerUrl` field
- `globalise_navigate`: Target document `urls` object now includes `transcriptionsViewer`

---

## [1.7.0] - 2025-12-26

### Added
- **Sorting parameters for main search**: `globalise_search_transcriptions` now exposes `sortBy` and `sortOrder` parameters
  - Sort by: `_score` (relevance), `document` (doc ID), `invNr` (inventory number)
  - Previously only `globalise_search_by_inventory` had sorting; now both tools are consistent
- **Multi-inventory filtering**: `inventoryNumber` parameter now accepts array of strings
  - Single: `"9966"` or multiple: `["9966", "4293"]`
  - API confirmed to OR multiple inventories (tested: 495 + 535 = 1030 results)

### Documentation
- **Phrase proximity search**: Documented `"phrase"~N` syntax in `QUERY_SYNTAX.md`
  - Tested: `"peper koffie"~5` returns 15 results vs 5 for exact phrase
  - Works for finding words within N positions of each other
- **Punctuation handling**: Documented tokenization limitations
  - Apostrophes, periods, hyphens are stripped during indexing
  - Numbers (years like `1609`) work correctly
  - Workarounds documented for common patterns

### Verified (ChatGPT Testing Claims)
- Multi-inventory: ✅ API supports array, now exposed in MCP
- Phrase proximity: ✅ Works, was undocumented
- Punctuation: ⚠️ Stripped during tokenization (API limitation, documented)
- Sorting consistency: ✅ Fixed - both search tools now have sorting

---

## [1.6.1] - 2025-12-26

### Removed
- **IIIF URLs from MCP output**: Removed `iiifCanvas` and `iiifManifest` from document retrieval response
  - IIIF Canvas URLs are fragment identifiers for IIIF viewers (e.g., Mirador), not directly browsable URLs
  - The "404 error" when accessing canvas URLs directly was expected behavior, not a bug
  - IIIF manifest JSON provides no useful data beyond what's already available via National Archives link
  - High-resolution images remain accessible via the `nationalArchives` URL
- Removed `includeIIIF` input parameter from document retrieval tool

### Changed
- Tool description updated: "IIIF image URLs" → "High-resolution image URL"
- Simplified URL extraction logic in `src/tools/document.ts`

### Documentation
- Added note to `API_REFERENCE.md` explaining why IIIF URLs are in raw API but not MCP server
- Updated `TODO.md`: Split IIIF/National Archives issue, moved IIIF resolution to Completed

---

## [1.6.0] - 2025-12-26

### Added
- **Field Validation**: Search filters now validated against indexed fields before API calls
  - Uses `/brinta/globalise/indices` endpoint to fetch available fields
  - Provides helpful error messages when invalid field names are used
  - Suggests valid searchable fields: `invNr`, `document`, `langIso`, `langLabel`
  - Results cached for 1 hour to minimize API overhead
- **IIIF Support Enhancement**: Document retrieval now includes top-level IIIF object
  - Added `includeResults=iiif` parameter to document requests
  - Returns clean structure: `{ manifest: string, canvasIds: string[] }`
  - Provides easier access to IIIF Presentation API data than parsing annotation targets
  - Falls back to annotation targets if top-level IIIF data unavailable
- **size=0 Pattern Documentation**: API docs now recommend using `size=0` for aggregations-only queries
  - Reduces payload size by 54.7% when only statistics are needed
  - Standard Elasticsearch pattern for efficient faceted search

### Changed
- Document tool now includes `iiif` in default `includeResults` parameter
- Enhanced error messages for invalid search fields with actionable suggestions

### Technical Details
**New Functions in `src/utils/api-client.ts`:**
- `getIndexedFields(indexName)` - Fetches indexed field names from API
- `validateSearchFields(fields, indexName)` - Validates filter fields before search
- `indicesCache` - LRU cache (1 hour TTL) for field metadata

**IIIF Response Structure:**
```json
{
  "iiif": {
    "manifest": "https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json",
    "canvasIds": ["https://...canvas/p106"]
  }
}
```

**Benefits:**
- Prevents cryptic API errors from invalid field names
- Faster access to IIIF manifest and canvas URLs
- More efficient aggregation-only queries
- Better developer experience with clear error messages

**Research Credits:**
These features were discovered by comparing API calls from the Suriano correspondence platform (https://edition.suriano.huygens.knaw.nl/), which shares the same Broccoli/Gloccoli architecture as GLOBALISE.

## [1.5.3] - 2025-12-25

### Added
- **Railway Deployment**: Public hosted instance at `https://globalise-mcp-production.up.railway.app/mcp`
  - Auto-deploys on push to main via GitHub integration
  - Health check endpoint: `/health`
  - Added `railway.json` configuration file
- **Auto-Session Recovery**: Seamlessly handles stale sessions after server restarts
  - When client sends a stale session ID, server creates a new session reusing the same ID
  - Clients don't need to reinitialize or detect session loss
  - Works for both POST /mcp requests and GET /mcp SSE streams
  - Logs `[MCP] Auto-recovering stale session: <id>` for debugging

### Technical Details
**Session Recovery Logic:**
```typescript
// If client sends stale session ID, reuse it for the new session
const newSessionId = sessionId || randomUUID();
// Client continues seamlessly without knowing session was recreated
```

**Benefits:**
- Zero-downtime experience for clients during Railway deploys
- No "Resource not found" errors after server restarts
- Backwards compatible - existing clients work without changes

## [1.5.2] - 2025-12-25

### Added
- **Automatic Retry with Exponential Backoff**: API calls now automatically retry on transient failures
  - Retries on: Network errors, timeouts, 5xx server errors, 429 rate limits
  - Does not retry on: 4xx client errors (bad request, not found, etc.)
  - Backoff pattern: 1s → 2s → 4s (3 attempts max, configurable)
  - Respects `Retry-After` header when present on 429 responses
  - Supports both seconds and HTTP-date formats for Retry-After

### Documentation
- **GETTING_STARTED.md**: New beginner-friendly setup guide with step-by-step instructions for Claude Desktop, Claude.ai, OpenAI ChatGPT, MSTY, Jan.ai, and Claude Code CLI
- **TODO.md**: Added Railway deployment workflow as future improvement

### Changed
- `apiGet()` and `apiPost()` now include automatic retry behavior
- Added `retryAfterMs` field to `ApiError` interface for rate limit responses
- Rate limit error messages now include server-specified wait time when available

### Technical Details
**New Configuration:**
```typescript
API_CONFIG.RETRY_MAX_ATTEMPTS = 3
API_CONFIG.RETRY_BASE_DELAY_MS = 1000  // 1s, 2s, 4s exponential
```

**New Functions in `src/utils/api-client.ts`:**
- `withRetry<T>(fn, maxAttempts)` - Retry wrapper with exponential backoff
- `isRetryableError(error)` - Determines if an error type is retryable
- `calculateRetryDelay(attempt, error)` - Calculates delay, respects Retry-After
- `parseRetryAfter(response)` - Parses Retry-After header (seconds or HTTP-date)

**Benefits:**
- Gracefully handles temporary API outages and network blips
- Reduces user-facing errors for transient issues
- Standard practice for production API clients
- No configuration required - works out of the box

## [1.5.1] - 2025-12-25

### Changed
- **Increased Result Limit**: Maximum results per request increased from 100 to 500 for all search tools
  - Allows larger-scale corpus analysis while balancing context window usage
  - Default remains 10 for efficient queries
- **Removed outputSchema from tools**: Improves compatibility with strict MCP clients (MSTY, Jan.ai)
  - Tools now return JSON-formatted text responses universally
  - No functional change to response content

### Added
- **Enhanced Language Classification Notes**: Tool descriptions now include detailed guidance on:
  - "Unknown" vs "Undefined" language classification
  - "Cipher" (art) code usage for encrypted Dutch text
  - Non-Roman script transcription limitations with National Archives link guidance
  - Malay macrolanguage considerations
- **Debug Logging**: Enable verbose tool logging with `DEBUG=true` environment variable
  - Logs tool response lengths for troubleshooting
  - Silent by default in production
- **TODO.md**: New file tracking future improvements (retry logic, throttling, root path handlers)
- **JAN_AI_HTTP_BUG_REPORT.md**: Detailed bug report for Jan.ai developers regarding HTTP transport issues

### Removed
- **Dead Code Cleanup**:
  - Removed `src/tools/config.ts` (getConfig, getIndices tools were defined but never exposed)
  - Removed unused imports from index.ts (search, searchInputSchema, outputSchemas, etc.)
  - Removed ConfigResponse and IndicesResponse types from types.ts
- **Misleading Comment**: Removed incorrect claim about "~6 tool limit" in Claude Desktop
  - Research confirmed Claude Desktop handles 100+ tools; practical recommendation is ~50 for performance

### Fixed
- **Client Compatibility**: Server now works correctly with MSTY (Claude, GPT-4o) via HTTP transport

## [1.5.0] - 2025-12-24

### Added
- **Streamable HTTP Transport**: New recommended transport for remote access (MCP spec 2025-03-26)
  - Single `/mcp` endpoint handling POST, GET, and DELETE methods
  - Session management via `mcp-session-id` header
  - Bidirectional communication with SSE streaming for notifications
  - Compatible with OpenAI ChatGPT Developer Mode and Responses API
  - Compatible with Claude Desktop (stdio remains default)

### Changed
- **MCP SDK Update**: Upgraded from `^1.0.4` to `^1.25.1` (latest stable)
  - Includes StreamableHTTPServerTransport support
  - Backward compatible with existing SSE code
- **Express Update**: Upgraded from `^4.21.2` to `^5.2.1`
  - Native async/await middleware support
  - Performance improvements

- **Health Endpoint Enhanced**: Now reports both transports with detailed status
  ```json
  {
    "transports": {
      "streamableHttp": { "endpoint": "/mcp", "status": "active" },
      "sse": { "endpoint": "/sse", "status": "active (legacy)" }
    },
    "activeSessions": { "streamableHttp": 0, "sse": 0 }
  }
  ```

### Technical Details
**Endpoints (HTTP mode):**
- `POST /mcp` - MCP requests (creates/reuses session)
- `GET /mcp` - SSE stream for server notifications (requires session)
- `DELETE /mcp` - Terminate session
- `GET /sse` - Legacy SSE connection (still supported)
- `POST /messages?sessionId=<id>` - Legacy SSE messages (still supported)
- `GET /health` - Enhanced health check

**Why Streamable HTTP?**
The MCP specification deprecated SSE (March 2025) in favor of Streamable HTTP:
- Single endpoint vs. dual `/sse` + `/messages`
- Bidirectional communication
- Better HTTP/2 and HTTP/3 compatibility
- On-demand resource allocation (stateless option)
- Future support for resumable operations

### Usage Examples

**HTTP Mode with Streamable HTTP:**
```bash
TRANSPORT=http PORT=3000 node dist/index.js

# Initialize session
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
```

**OpenAI ChatGPT Integration:**
1. Start server: `TRANSPORT=http PORT=3000 node dist/index.js`
2. Create tunnel: `ngrok http 3000`
3. Add MCP server in ChatGPT Developer Mode with ngrok URL + `/mcp`

### Backward Compatibility
- **Stdio mode**: Unchanged, remains default for Claude Desktop
- **SSE transport**: Still fully supported via `/sse` and `/messages`
- **All 5 tools**: Unchanged and working with both transports

## [1.4.0] - 2025-12-23

### Added
- **Request Timeouts**: All API calls now have a 30-second timeout to prevent indefinite hangs
  - Uses AbortController for proper timeout handling
  - Configurable timeout duration via `API_CONFIG.TIMEOUT_MS`
  - Clear timeout error messages with actionable suggestions

- **Enhanced Error Messages**: Context-aware error handling with detailed information
  - Classified error types: TIMEOUT, NETWORK, HTTP_CLIENT, HTTP_SERVER, RATE_LIMIT, NOT_FOUND, UNKNOWN
  - Document-specific error messages (e.g., "Document not found" with format guidance)
  - Rate limiting detection (429 errors) with retry suggestions
  - Network error detection with connection troubleshooting advice
  - Server error messages (5xx) with clear indication of server-side issues
  - Each error includes actionable suggestions for resolution

- **HTTP/SSE Transport Support**: Server can now run in remote-access mode
  - New multi-transport architecture supporting stdio (default) and HTTP/SSE
  - Environment variable configuration: `TRANSPORT=http` for HTTP mode
  - Health check endpoint: `GET /health` returns server status and version
  - SSE endpoint: `GET /sse` for establishing MCP connections
  - Message endpoint: `POST /messages?sessionId=<id>` for client requests
  - Configurable port and CORS origins via environment variables
  - Dual-mode operation: stdio for Claude Desktop, HTTP for remote access

- **Response Caching**: LRU cache with TTL for improved performance
  - Document cache: 100 documents, 5-minute TTL
  - Config cache: 10 items, 1-hour TTL
  - Automatic expiration and least-recently-used eviction
  - Cache keys include request parameters for correct invalidation
  - Significantly faster repeated document lookups during navigation

### Changed
- `apiGet()` and `apiPost()` now accept optional `timeoutMs` parameter
- `ApiError` interface enhanced with `type`, `details`, and `suggestion` fields
- Document and config endpoints now use cached API calls
- Server startup logs adapted for both stdio and HTTP modes

### Technical Details
**New Files:**
- `src/utils/cache.ts` - LRU cache implementation with TTL support
- `src/transports/http-server.ts` - HTTP/SSE server for remote access

**Modified Files:**
- `src/utils/api-client.ts` - Timeout support, enhanced errors, cache integration
- `src/tools/document.ts` - Uses cached document retrieval
- `src/tools/config.ts` - Uses cached config/indices retrieval
- `src/index.ts` - Multi-transport support (stdio + HTTP)

**Dependencies:**
- Added: `express` (^4.21.2), `cors` (^2.8.5)
- Added dev: `@types/express` (^5.0.0), `@types/cors` (^2.8.17)

**Environment Variables:**
- `TRANSPORT` - Set to 'http' or 'sse' for HTTP mode (default: 'stdio')
- `PORT` - HTTP server port (default: 3000)
- `ALLOWED_ORIGINS` - Comma-separated CORS origins (default: '*')

### Benefits
- **Reliability**: Timeouts prevent hanging requests, better error recovery
- **UX**: Clear, actionable error messages help users troubleshoot issues
- **Performance**: Caching speeds up repeated lookups (navigation, config access)
- **Deployment**: HTTP transport enables remote access and web-based clients
- **Backward Compatibility**: Stdio mode remains default, no breaking changes

### Usage Examples

**Stdio Mode (Default):**
```bash
node dist/index.js
```

**HTTP Mode (Remote Access):**
```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

**Test Health Endpoint:**
```bash
curl http://localhost:3000/health
```

## [1.3.1] - 2025-12-23

### Changed
- **Enhanced Tool Descriptions for Statistics Use Cases**: Updated tool descriptions to guide Claude Desktop toward efficient patterns for getting language distribution and inventory statistics.
  - `globalise_search_transcriptions`: Added "GETTING STATISTICS" section with example showing `query="*"`, `size=1` pattern for retrieving aggregations without full document payloads
  - `globalise_search_by_inventory`: Added context that inventories contain hundreds of documents, included language statistics example ("what languages are in inventory 4293?"), and added "FOR STATISTICS ONLY" guidance
  - Removed problematic cross-references between tools (e.g., "use tool X instead") to avoid Claude Desktop filtering issues learned from v1.2.x
  - Clarified that aggregations (language distribution, inventory counts) are returned alongside search results

- **Added Language Classification Clarifications**: Documented the specific meanings of "Unknown" and "Cipher" language categories.
  - `globalise_search_transcriptions`: Added note that "unknown" means language not yet determined (not unidentifiable), and "art" (Cipher) means deliberately encrypted text
  - `globalise_search_by_language`: Added "LANGUAGE NOTES" section explaining "Unknown" (language not yet determined) and "Cipher" (ISO code "art" for artificial language - deliberately encrypted text per ISO standards)

### Documentation
- Documented the correct pattern for getting language distribution: use `query="*"` with `size=1` to minimize result payload while obtaining full aggregation data
- Example: For inventory 4293's language breakdown, use `globalise_search_transcriptions` or `globalise_search_by_inventory` with `query="*"`, `inventoryNumber="4293"`, `size=1`
- This pattern is efficient and intentional, not a workaround - it's standard search API design (filter + aggregate)

### Context
After user testing revealed confusion about how to get language distribution for specific inventories, analysis showed the existing API already supports this elegantly through the aggregations feature. Rather than adding redundant parameters or new tools (which risks Claude Desktop filtering), we enhanced documentation to make this pattern discoverable. This follows lessons learned from v1.2.1-1.2.3 where cross-references and feature comparisons caused tool filtering.

## [1.3.0] - 2025-12-23

### Added
- **Enhanced Metadata Exposure**: Document retrieval now includes comprehensive metadata
  - `archive` - Archive collection ID (e.g., "1.04.02" for VOC archives)
  - `metadata.layoutAnalysis` - Layout analysis system used (e.g., "Laypa")
  - `metadata.ocrSoftware` - OCR software name (e.g., "Loghi")
  - `metadata.annotationGenerated` - W3C annotation generation timestamp
  - `urls.annoRepo` - AnnoRepo annotation URL for W3C annotation access
  - `urls.highResolutionImage` - Direct URL to high-resolution IIIF image

### Changed
- Renamed `metadata.creator` to `metadata.layoutAnalysis` for clarity
- Renamed `urls.iiifImage` to `urls.highResolutionImage` for clarity
- Updated `navigate` tool output schema to match document schema
- Updated all TypeScript types and schemas

### Technical Details
The metadata now exposes:
- **Document Information**: Archive, inventory number, page number
- **Source Details**: Archive name, collection ID, language, license (CC0)
- **Technical Details**: Created/modified dates, OCR processing (Loghi HTR), layout analysis (Laypa), annotation generation date
- **Access Links**: High-resolution images, National Archives pages, AnnoRepo annotations

## [1.2.3] - 2025-12-21

### Fixed
- **CRITICAL: Removed problematic cross-references between tools**
  - `globalise_search_by_inventory` and `globalise_search_by_language` previously said "Limited to 100 results per query" and "use globalise_search instead for larger result sets"
  - This caused Claude Desktop to infer that `globalise_search` supports MORE than 100 results, which it then filtered as unrealistic
  - **Root cause identified**: The problem wasn't just the max limit, but the IMPLIED limit from cross-references
  - Removed all mentions of "100 results", "larger result sets", and cross-tool comparisons
  - Made all tool descriptions neutral and factual without comparisons

- **Maximum Results Limit**: Reduced technical maximum from 10,000 to 1,000 results per query
  - Changed schema from `.max(10000)` to `.max(1000)`
  - Removed "Main search tool", "More flexible", and other superlative language
  - Simplified description to just list features without comparisons

### Context
After testing versions 1.2.1 and 1.2.2 with both Opus 4.5 and Sonnet 4.5, Claude Desktop continued to filter out the `globalise_search` tool. User discovered the smoking gun: Claude Desktop mentioned "without the 100-result limit" when discussing the missing tool, revealing it was reading the specialized tools' descriptions that said "Limited to 100 results" and "use globalise_search for larger result sets". This created an inference chain that made `globalise_search` appear to have unrealistic capabilities.

## [1.2.2] - 2025-12-21

### Fixed
- **Tool Filtering Issue**: Toned down tool descriptions to prevent Claude Desktop from filtering them
  - Removed mention of "10,000 results" from descriptions (kept in schema)
  - Changed from "**PRIMARY SEARCH TOOL**" to "Main search tool"
  - Removed markdown formatting that might confuse parsing
  - Changed "SPECIALIZED TOOL" to simpler language
  - Tool still supports 10,000 results technically, but description now says "Supports pagination for large result sets"

### Context
User discovered that Claude Desktop might be filtering out `globalise_search` because it advertises support for 10,000 results, which Claude's AI may perceive as unrealistic or problematic. This version de-emphasizes the large numbers while keeping the technical capability intact.

## [1.2.1] - 2025-12-21

### Fixed
- **Tool Selection Issue**: Improved tool descriptions to guide Claude Desktop to use the correct tools
  - Marked `globalise_search` as "**PRIMARY SEARCH TOOL**"
  - Clarified it supports up to 10,000 results per query
  - Added note that it combines functionality of specialized tools
  - Marked `globalise_search_by_inventory` and `globalise_search_by_language` as "SPECIALIZED TOOL"
  - Added explicit notes to use `globalise_search` for general queries
  - Specified max 100 result limits on specialized tools

### Context
Claude Desktop was receiving all 7 tools correctly but choosing specialized tools (`globalise_search_by_language`, `globalise_search_by_inventory`) instead of the main `globalise_search` tool. This was an AI decision-making issue, not a technical MCP problem. The improved descriptions make tool selection clearer.

## [1.2.0] - 2025-12-21

### Added
- **Enhanced Size Limits**: Increased maximum results per request from 100 to 10,000
  - Recommended maximum: 1,000 results (~1-2s response time)
  - API maximum: 10,000 results (~7s response time)
  - Updated schema validation and documentation

- **Enhanced Sorting Documentation**: Clarified all available sort fields
  - `_score` - Relevance (default)
  - `document` - Document ID alphabetically
  - `invNr` - Inventory number
  - `langLabel` - Language name
  - Both `asc` and `desc` order supported

### Changed
- Updated `size` parameter from `max(100)` to `max(10000)` in search schema
- Enhanced `sortBy` parameter description with all valid options
- Updated README.md with sorting examples and performance guidance
- Bumped version from 1.1.0 to 1.2.0

### Performance Notes
- 1,000 results: ~1-2 seconds (recommended for bulk retrieval)
- 5,000 results: ~5-6 seconds
- 10,000 results: ~7-8 seconds (use pagination for better UX)

### Testing
- Added `test-size-and-sorting.js` comprehensive test suite
- Verified all sort fields work correctly
- Confirmed API maximum of 10,000 results (400 error beyond that)

## [1.1.0] - 2025-12-21

### Added
- **Language Filtering Enhancements**:
  - New `languageLabels` parameter for human-readable language names
  - Support for all 23 languages including Cipher, Persian, Bengali, etc.
  - New `globalise_search_by_language` tool (7th tool)
  - Auto-detection of ISO codes vs. human-readable names

- **Documentation**:
  - LANGUAGES_REFERENCE.md - Complete language list with document counts
  - LANGUAGE_FEATURES_UPDATE.md - Feature documentation
  - TESTING_LANGUAGES.md - Testing guide for Claude Desktop

### Changed
- Enhanced tool descriptions to explicitly list all 23 supported languages
- Updated search tools to support both ISO codes and language labels
- Fixed bug with missing `_hits.text` for wildcard searches

### Fixed
- Wildcard searches (*) now handle missing highlights gracefully
- Optional chaining for `_hits?.text` prevents runtime errors

## [1.0.0] - 2025-12-20

### Added
- Initial release of GLOBALISE MCP Server
- 6 core tools:
  - `globalise_search` - Full-text search across ~4.8M transcriptions
  - `globalise_get_document` - Retrieve detailed document information
  - `globalise_get_config` - Get API configuration
  - `globalise_get_indices` - Get available search indices
  - `globalise_search_by_inventory` - Search within specific inventory
  - `globalise_navigate` - Navigate between document pages

### Features
- Boolean search operators (AND, OR, NOT)
- Wildcard search (* and ?)
- Fuzzy matching (~N)
- Exact phrase matching
- Language filtering (ISO codes)
- Pagination support
- IIIF image integration
- Full TypeScript implementation
- Zod schema validation
- Comprehensive documentation

---

## Version History

- **1.5.2** - Automatic retry with exponential backoff, GETTING_STARTED.md guide
- **1.5.1** - Increased result limit to 500, removed outputSchema, debug logging
- **1.5.0** - Streamable HTTP transport, SDK 1.25.1, Express 5.x
- **1.4.0** - Request timeouts, enhanced errors, response caching, HTTP/SSE transport
- **1.3.1** - Enhanced tool descriptions to guide Claude Desktop toward statistics/aggregation use cases
- **1.3.0** - Enhanced metadata exposure with archive, OCR software, layout analysis, and AnnoRepo URLs
- **1.2.3** - Reduced maximum results to 1,000 to fix Claude Desktop filtering
- **1.2.2** - Toned down tool descriptions (didn't fix the issue)
- **1.2.1** - Improved tool descriptions to guide tool selection (didn't fix the issue)
- **1.2.0** - Enhanced size limits and sorting documentation
- **1.1.0** - Language filtering enhancements and 7th tool
- **1.0.0** - Initial release with 6 core tools
