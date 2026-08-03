# GLOBALISE API Research - Summary of Work

**Date:** December 21, 2025
**Objective:** Document the API used by the GLOBALISE Transcriptions Viewer (https://transcriptions.globalise.huygens.knaw.nl)

> **Historical research record:** This file describes the December 2025 discovery session and is
> not the current operational access guide. See [Access & Authentication](./AUTHENTICATION.md)
> and [Error Reference](./ERROR_REFERENCE.md) for current behavior.

## Executive Summary

Successfully documented the GLOBALISE Transcriptions Viewer API through browser automation and network request monitoring. The API uses a REST-based architecture powered by the Broccoli/Gloccoli platform with separate services for search, annotations, and text storage.

**Primary API Base URL:** `https://gloccoli.tt.di.huc.knaw.nl`

**Key Endpoints Documented:**
- Search API: `POST /projects/globalise/search`
- Document Detail: `GET /projects/globalise/urn:globalise:{document_id}`
- Configuration: `GET /config`
- Index Information: `GET /brinta/globalise/indices`

## Methodology

### Approaches That Worked ✅

1. **Dev-Browser Plugin (Most Effective)**
   - Used the dev-browser skill/plugin for persistent browser automation
   - Playwright-based browser control with network monitoring
   - Successfully captured all API requests and responses
   - Key commands used:
     ```bash
     cd skills/dev-browser && bun x tsx <<'EOF'
     import { connect, waitForPageLoad } from "@/client.js";
     # ... script content
     EOF
     ```
   - Network monitoring setup:
     ```javascript
     page.on('request', request => { /* capture */ });
     page.on('response', async response => { /* capture */ });
     ```

2. **Progressive Exploration**
   - Started with homepage to understand initial API calls
   - Performed simple search ("schip") to capture search API
   - Performed complex search ("peper AND koffie") to understand Boolean operators
   - Navigated to detail pages to capture document API
   - This incremental approach allowed systematic discovery of all endpoints

3. **JSON Response Parsing**
   - API responses were clean JSON format
   - Easy to parse and document structure
   - Used `await response.json()` to capture response bodies

4. **Filtering Network Requests**
   - Initially captured all requests (including assets)
   - Refined to filter out `.js`, `.css`, `.png` files
   - Focused on API calls containing 'brinta', 'globalise', or 'api' in URL

### Approaches That Didn't Work ❌

1. **MCP Claude-in-Chrome Extension**
   - Initially used `mcp__claude-in-chrome__*` tools
   - Extension disconnected mid-session
   - Network request monitoring returned extremely large files (267KB+)
   - Files were too large to read directly with Read tool
   - Grep patterns didn't work as expected on the JSON structure
   - **Lesson:** Dev-browser plugin is more reliable for extended automation sessions

2. **Direct File Reading of Network Logs**
   - Attempted to read large network request log files
   - File exceeded maximum size limits (256KB)
   - Even with offset/limit parameters, structure was difficult to parse
   - **Lesson:** Better to capture network data programmatically in-script rather than dumping to files

3. **JavaScript Execution in Disconnected Browser**
   - Tried to use `javascript_tool` after extension disconnected
   - All subsequent calls failed with connection errors
   - **Lesson:** Once browser extension disconnects, need to switch tools entirely

4. **Waiting for Network Responses**
   - Initial attempts didn't wait long enough for all API responses
   - Some detail page API calls weren't captured
   - **Solution:** Added explicit waits (`await page.waitForTimeout(3000)`) after actions
   - Also manually fetched some endpoints using `page.request.get()` to guarantee capture

## Key Discoveries

### 1. Architecture
- **Frontend:** Single-page application (SPA) at `transcriptions.globalise.huygens.knaw.nl`
- **Search Backend:** Gloccoli/Broccoli platform at `gloccoli.tt.di.huc.knaw.nl`
- **Text Storage:** TextRepo at `globalise.tt.di.huc.knaw.nl/textrepo`
- **Annotations:** AnnoRepo at `annorepo.globalise.huygens.knaw.nl`
- **Images:** IIIF Image API at `service.archief.nl/iip`

### 2. Search API Structure
```
POST https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search
Query Params: indexName, fragmentSize, from, size, sortBy, sortOrder
Body: { text: "query", terms: {}, aggs: {...} }
```

- Search uses Elasticsearch-like syntax
- Supports Boolean operators: AND, OR, NOT
- Supports wildcards: * (multi-char), ? (single-char)
- Supports fuzzy matching: ~N (edit distance)
- Supports exact phrases: "quoted text"
- Returns highlighted fragments with `<em>` tags

### 3. Document Detail API
```
GET https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:{doc_id}
Query Params: overlapTypes, includeResults, views, relativeTo
```

- Returns W3C Web Annotations format
- Includes IIIF image URLs
- Includes TextRepo version URLs
- Provides transcribed text as array of lines
- Metadata includes prev/next page navigation

### 4. Data Format
- Document URNs: `urn:globalise:NL-HaNA_{archive}_{inventory}_{scan}`
- Example: `urn:globalise:NL-HaNA_1.04.02_9966_0106`
- Archive is always `1.04.02` (VOC archive)
- Inventory and scan numbers vary

## Code Patterns That Worked

### Basic Browser Setup
```javascript
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("page-name");
await page.setViewportSize({ width: 1280, height: 800 });
```

### Network Monitoring Pattern
```javascript
const apiCalls = [];

page.on('request', request => {
  const url = request.url();
  if (url.includes('brinta') || url.includes('globalise')) {
    apiCalls.push({
      type: 'REQUEST',
      url,
      method: request.method(),
      headers: request.headers(),
      postData: request.postData()
    });
  }
});

page.on('response', async response => {
  const url = response.url();
  if (url.includes('brinta') || url.includes('globalise')) {
    let body = null;
    try {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('json')) {
        body = await response.json();
      }
    } catch (e) {}

    apiCalls.push({
      type: 'RESPONSE',
      url,
      status: response.status(),
      body
    });
  }
});
```

### Performing Actions
```javascript
// Navigate
await page.goto('https://example.com');
await waitForPageLoad(page);

// Fill form
await page.fill('input[type="search"]', 'search query');
await page.keyboard.press('Enter');

// Click element
await page.locator('a[href*="/detail/"]').first().click();

// Wait for response
await page.waitForTimeout(3000);

// Manual fetch if needed
const response = await page.request.get(url);
const data = await response.json();
```

## Challenges Encountered

1. **Large Response Bodies**
   - Some API responses were very large (especially with full annotation data)
   - Solution: Truncated body content for logging
   - For actual use, can fetch full responses as needed

2. **Timing Issues**
   - API calls are asynchronous
   - Initial attempts missed some responses
   - Solution: Added explicit waits and used `page.waitForTimeout()`

3. **Response Body Consumption**
   - Once a response body is read, it can't be read again
   - Solution: Captured in event handlers rather than trying to re-read

4. **Dynamic Content**
   - Frontend is a React/Vue-style SPA
   - URL changes but not always new page loads
   - Solution: Monitored network requests rather than DOM changes

## Recommendations for Future Work

### 1. Building a Client Library

The API is straightforward enough to wrap in a simple client:

```python
# Pseudocode example
class GlobaliseClient:
    def __init__(self):
        self.base_url = "https://gloccoli.tt.di.huc.knaw.nl"
        self.index_name = "globalise-2024.03.18-test"

    def search(self, query, from=0, size=10):
        # POST to /projects/globalise/search
        pass

    def get_document(self, doc_id):
        # GET to /projects/globalise/urn:globalise:{doc_id}
        pass

    def get_config(self):
        # GET to /config
        pass
```

### 2. Testing Different Query Types

Worth testing:
- Complex Boolean queries: `(term1 OR term2) AND term3 NOT term4`
- Wildcard combinations: `schip* AND *koffie`
- Edit distance on different terms
- Very long queries
- Special characters and escaping
- Non-Latin scripts (if present in corpus)

### 3. Pagination Exploration

The search API supports pagination:
- Test large result sets (755,310 results for "schip")
- Verify `from` parameter behavior
- Check if there's a maximum `from` value
- Test `size` parameter limits

### 4. Aggregation Deep Dive

The `aggs` parameter supports:
- `invNr` - inventory numbers
- `document` - document IDs
- `langIso` - language codes
- `langLabel` - language names

Worth exploring:
- What other aggregation types are available?
- Can you filter by aggregation results?
- How do aggregations affect performance?

### 5. Rate Limiting Investigation

- No rate limiting observed during testing
- Should test with higher volumes
- Implement respectful delays in production code
- Monitor for any 429 (Too Many Requests) responses

### 6. Error Handling

Test error cases:
- Invalid index name
- Malformed queries
- Non-existent document IDs
- Invalid pagination parameters
- Network timeouts

### 7. Data Export

For bulk analysis:
- Implement pagination loop to export all results
- Consider using aggregations for overview statistics
- Batch document detail requests
- Store locally for offline analysis

### 8. IIIF Integration

The API returns IIIF image URLs:
- `https://service.archief.nl/iip/.../full/max/0/default.jpg`
- Could integrate with IIIF viewers
- Download high-res images programmatically
- Extract image metadata

### 9. TextRepo Integration

The annotations reference TextRepo:
- `https://globalise.tt.di.huc.knaw.nl/textrepo/rest/versions/{version_id}/contents`
- Could fetch raw transcription text
- Explore TextRepo API separately
- Understand version history

### 10. Performance Optimization

For large-scale use:
- Implement caching of config/index data
- Reuse HTTP connections
- Parallel requests where appropriate
- Monitor memory usage with large result sets

## Files Created

1. **GLOBALISE_API_Documentation.md** - Complete API reference
   - All endpoints documented
   - Request/response examples
   - Parameter descriptions
   - Error handling notes

2. **GLOBALISE_API_Research_Summary.md** (this file) - Research methodology and lessons learned

## Tools and Technologies Used

- **Dev-Browser Plugin**: Playwright-based browser automation
- **Bun**: JavaScript runtime for executing TypeScript
- **Network Monitoring**: Playwright's request/response event handlers
- **JSON Parsing**: Standard JavaScript/TypeScript
- **Claude Code**: For orchestration and documentation

## Next Steps for a New Project

1. **Read both documentation files** to understand the API structure
2. **Start dev-browser server**: `./skills/dev-browser/server.sh &`
3. **Use provided code patterns** for network monitoring
4. **Build on discovered endpoints** rather than re-discovering
5. **Implement error handling** from the start
6. **Add rate limiting/delays** to be respectful
7. **Test edge cases** mentioned in recommendations

## Estimated Effort

Based on this research:
- **Basic search integration**: 1-2 hours
- **Full client library**: 4-6 hours
- **Advanced features (aggregations, filters)**: 4-8 hours
- **Bulk data export**: 2-4 hours
- **IIIF integration**: 2-4 hours

## Important Notes

- ✅ **No authentication required** - Public API, no keys or tokens
- ✅ **CC0 License** - Data is freely usable
- 📝 **Academic citation expected** - CC0 does not legally require attribution, but research use should cite the project
- 🔍 **4,784,614 indexed pages** in the match-all query verified 2026-08-03
- 📅 **Data version**: March 2024 (v2.0 HTR)
- ⚠️ **Machine-generated** - Contains errors, not manually verified

## Contact/Support

Based on the website:
- **Feedback page**: Available on the site for bug reports and feature requests
- **Contact page**: For general questions about the GLOBALISE project
- **GitHub**: Loghi HTR platform - https://github.com/knaw-huc/loghi-htr

## Conclusion

At the time of the December 2025 investigation, the GLOBALISE API was well-structured,
REST-based, and directly reachable from the research environment. The dev-browser approach proved
effective for API discovery, and the major viewer endpoints were documented with examples.

**Current takeaway:** The API contract documented here still holds and remains directly
reachable (re-verified 2026-08-03). Treat this file as methodology/history and use the
maintained reference files for current integration guidance.
