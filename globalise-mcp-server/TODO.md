# GLOBALISE MCP Server - Future Improvements

This document tracks potential improvements, enhancements, and ideas for the GLOBALISE MCP server. Items here are not bugs or urgent fixes - they represent opportunities to improve compatibility, performance, or functionality in future iterations.

---

## Potential Improvements

### Add Root Path Handlers for Broader Client Compatibility

**Priority:** Low
**Status:** Not implemented

**Background:**
Currently, the MCP server mounts the Streamable HTTP transport at `/mcp`. Some clients (observed: Jan.ai) may expect or attempt to connect at the root path (`/`), resulting in 404 errors.

**Proposed Change:**
Add handlers at `/` that mirror the `/mcp` endpoint functionality:
- `POST /` → Same as `POST /mcp`
- `GET /` → Same as `GET /mcp`
- `DELETE /` → Same as `DELETE /mcp`

**Benefits:**
- Future-proofs against clients that expect root-level mounting
- No breaking changes for existing clients using `/mcp`
- Minimal code change (refactor handlers into shared functions)

**Implementation Notes:**
The handlers in `src/transports/http-server.ts` would need to be refactored:
1. Extract POST/GET/DELETE logic into shared handler functions
2. Mount those handlers at both `/` and `/mcp`
3. Update health endpoint to reflect both paths are active

**Tested Clients (Current Behavior):**
| Client | Works with `/mcp` | Would benefit from `/` |
|--------|-------------------|------------------------|
| ChatGPT | Yes | Unlikely |
| MSTY | Yes | Unlikely |
| Jan.ai | Connects but has other bugs | Possibly |

**Decision:** Deferred until a client is identified that specifically requires root-level mounting and works correctly otherwise.

---

### Add Client-Side Request Throttling

**Priority:** Low
**Status:** Not implemented

**Background:**
No rate limiting exists on the client side. Rapid concurrent requests (e.g., LLM making multiple tool calls in parallel) could overwhelm the GLOBALISE API.

**Current State:**
- The GLOBALISE API has no documented rate limits
- No client-side throttling or concurrent request limits
- Caching reduces repeat requests but doesn't limit new ones

**Proposed Options:**

1. **Simple delay between requests:**
   - Add configurable delay (e.g., 100ms) between API calls
   - Minimal complexity, prevents burst traffic

2. **Concurrent request limit:**
   - Cap simultaneous requests (e.g., max 3 concurrent)
   - Use a semaphore or request queue

3. **Token bucket / leaky bucket:**
   - More sophisticated rate limiting
   - Probably overkill for this use case

**Recommendation:** Start with option 1 (simple delay) or option 2 (concurrent limit). Only add complexity if issues arise.

**Benefits:**
- Prevents accidental API abuse
- Good citizenship toward shared public infrastructure
- Reduces risk of IP blocking

---


## Ideas for Future Consideration

*Add new improvement ideas below as they arise.*

### Update CLAUDE.md Release Checklist

**Priority:** High
**Status:** Not started

**Task:**
Update the "Version Management" section in `CLAUDE.md` to include:

1. **Add README.md to the version bump checklist:**
   - `globalise-mcp-server/README.md` should be updated to reflect any changes to the MCP server in a new release
   - This includes new features, changed tool signatures, updated examples, deployment instructions, etc.

2. **Add instruction to verify all examples use real, executable values:**
   - All code examples in documentation must use real inventory numbers, document URNs, and query parameters
   - Examples should be tested against the live API before publishing
   - Invalid examples erode user trust and cause confusion

**Files to Update:**
- `CLAUDE.md` - Add these instructions to the existing "Version Management" section

**Why:**
The current version management checklist doesn't mention README.md, which is user-facing documentation. Additionally, examples using placeholder or invalid data cannot be tested by users.

---

### Review API Documentation Examples

**Priority:** Medium
**Status:** Not started

**Task:**
Systematically review all code examples in `/globalise-transcriptions-api/` documentation files to verify they work correctly against the live API:
- `README.md` - Quick start examples
- `API_REFERENCE.md` - All cURL and JavaScript examples
- `QUERY_SYNTAX.md` - Query pattern examples
- `DATA_MODELS.md` - TypeScript usage examples

**Why:**
Examples can drift from reality as APIs evolve. Broken examples frustrate users and erode documentation trust.

---

### Cross-Reference Help Page vs Actual Capabilities

**Priority:** Medium
**Status:** Not started

**Task:**
Compare the official GLOBALISE Transcriptions Viewer help page at `https://transcriptions.globalise.huygens.knaw.nl/help` against:
1. What the raw Broccoli/Gloccoli API actually supports
2. What the MCP server tools expose

Check ChatGPT conversation logs from MCP server testing sessions for any discrepancies observed during real usage.

**Why:**
The help page describes the web UI's search capabilities, which may differ from or exceed what we've documented for the API. There may be undocumented features or limitations.

---

### Verify Feature Limitations Discovered in ChatGPT Testing

**Priority:** Medium
**Status:** Not started

**Task:**
Testing in ChatGPT Desktop with GPT 5.2 surfaced several potential feature limitations. These claims need to be verified against the actual API and MCP server implementation.

**Claimed Limitations (Unverified):**

1. **Multi-inventory filtering not supported in one request**
   - Cannot filter by multiple inventory numbers simultaneously (e.g., `invNr: ["9966", "4293"]`)
   - Need to check: Is this documented but not implemented, or not supported by the API at all?

2. **Phrase proximity operators not supported**
   - No "N words apart" syntax (e.g., `"peper koffie"~5`)
   - Need to verify against Elasticsearch/Broccoli query syntax

3. **Punctuation-literal matching not supported**
   - Due to tokenization limitations in the index
   - Punctuation is stripped/normalized during indexing
   - Need to test with actual queries

4. **Server-side sorting inconsistency:**
   - `globalise_search_transcriptions` - reportedly cannot be server-sorted via MCP
   - `globalise_search_by_inventory` - reportedly CAN be server-sorted via MCP
   - Client-side sorting always possible after retrieval
   - Need to check: Are `sortBy`/`sortOrder` params exposed in both tools?

**Verification Steps:**
1. Check MCP tool schemas in `src/index.ts` for sorting parameters
2. Test multi-inventory filter: `terms: { invNr: ["9966", "4293"] }`
3. Test proximity query: `"peper koffie"~5` against raw API
4. Test punctuation query: search for `"d'"` or `"1.04.02"`
5. Compare with QUERY_SYNTAX.md documentation

**Source:** ChatGPT Desktop testing session with GPT 5.2

---

### Investigate IIIF and National Archives URL Issues

**Priority:** High
**Status:** Not started

**Task:**
Investigate inconsistent/incorrect URLs being returned or displayed for IIIF and National Archives links.

**Observed Issues:**

1. **National Archives URL spelling varies by LLM client** (both using Claude Sonnet 4.5):
   - MSTY: `https://www.nationaalarchiv.nl/onderzoeken/archief/1.04.02/invnr/10435/file/NL-HaNA_1.04.02_10435_0237` ❌ (missing "ef")
   - Claude Desktop: `https://www.nationaalarchief.nl/onderzoeken/archief/1.04.02/invnr/10435/file/NL-HaNA_1.04.02_10435_0237` ✅ (correct)

2. **IIIF Canvas URL returns 404:**
   - URL: `https://data.globalise.huygens.knaw.nl/manifests/inventories/10435.json/canvas/p237`
   - This URL pattern is what the API returns, but it 404s

**Questions to Investigate:**
- Is the MCP server returning correct URLs, and clients are corrupting them?
- Is the IIIF canvas URL pattern wrong in our code or in the upstream API?
- Are canvas URLs meant to be accessed directly, or only via manifest?
- Should we validate URLs before returning them?

**Test Steps:**
1. Call `globalise_retrieve_document` directly and inspect raw response
2. Check if the manifest exists: `https://data.globalise.huygens.knaw.nl/manifests/inventories/10435.json`
3. Verify the canvas ID format expected by IIIF viewers
4. Compare URL construction in `src/tools/document.ts`

---

### Review and Edit MCP Server Tool Descriptions

**Priority:** Medium
**Status:** Not started

**Task:**
Review all tool descriptions in `src/index.ts` for:
1. **Accuracy** - Do descriptions match actual behavior?
2. **Clarity** - Are they understandable to LLMs and users?
3. **Completeness** - Are all parameters and return values documented?
4. **Consistency** - Do similar tools use consistent terminology?

Also check for any cross-references between tools that might cause Claude Desktop filtering issues (see CLAUDE.md "Lessons Learned" section).

**Why:**
Tool descriptions directly impact how well LLMs use the tools. Poor descriptions lead to incorrect tool selection, wrong parameters, and user frustration. Claude Desktop has been observed to filter tools with certain description patterns.

---

### Investigate MSTY SSE Stream Behavior

**Priority:** Low
**Status:** Not started

**Background:**
Railway logs show frequent "SSE stream requested for session" messages when MSTY connects via Streamable HTTP. This is the `GET /mcp` endpoint being called for server→client notifications as part of the Streamable HTTP protocol.

**Questions:**
- Is MSTY reconnecting the SSE stream frequently? (timeout/keepalive issues?)
- Are sessions accumulating or being properly reused?
- Is this causing unnecessary resource usage?

**Investigation Steps:**
1. Add diagnostic logging: session count, connection duration, reconnect frequency
2. Monitor Railway logs during active MSTY usage
3. Check if MSTY has configurable timeout/keepalive settings
4. Compare behavior with Claude Code client (which uses same transport)

**Note:** This may be completely normal behavior - just worth understanding better.

---

### Documentation: AnythingLLM Configuration

**Note:** AnythingLLM requires explicit `type` field in MCP configuration:
```json
{
  "mcpServers": {
    "globalise": {
      "url": "https://globalise-mcp-production.up.railway.app/mcp",
      "transport": "http",
      "type": "streamable"
    }
  }
}
```

Unlike ChatGPT/MSTY which auto-detect transport type, AnythingLLM will default to SSE if `type` is omitted, causing connection failures when using the `/mcp` endpoint. Add this example to user-facing documentation and `offline/mcp-configurations.txt`.

---

## Completed Improvements

*Move items here once implemented, with version number and date.*

- **v1.5.3** - Railway deployment: Public instance at `https://globalise-mcp-production.up.railway.app/mcp`. Auto-deploys on push to main via GitHub integration. Added `railway.json` configuration.
- **v1.5.2** - Added retry logic with exponential backoff (1s → 2s → 4s, 3 attempts max) for transient failures (network errors, timeouts, 5xx, 429). Respects `Retry-After` header.
- **v1.5.0** - Removed `outputSchema` from tools for broad client compatibility (MSTY, Jan.ai)
