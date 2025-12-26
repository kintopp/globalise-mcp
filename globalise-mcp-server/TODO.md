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


## Ideas for Future Consideration

*Add new improvement ideas below as they arise.*


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

- **2025-12-26** - Cross-referenced help page vs API/MCP capabilities. See `globalise-transcriptions-api/research/Help_Page_Cross_Reference.md`. Key findings: (1) Escape characters (`\*`, `\?`) do NOT work as documented - backslash is ignored/acts as separator; (2) Inventory filter requires array syntax, not comma-separated strings; (3) 4 API features undocumented on help page (phrase proximity, language filter, sorting, aggregations).
- **2025-12-26** - Verified all API documentation examples work correctly against live API. Tested: README.md (search, doc retrieval), API_REFERENCE.md (filters, pagination, config, indices, IIIF), QUERY_SYNTAX.md (AND/OR, wildcards, fuzzy, phrases, proximity), DATA_MODELS.md (TypeScript patterns). All 15+ examples pass.
- **2025-12-26** - Updated CLAUDE.md release checklist: added README.md to version bump files, added instruction to verify examples use real API values before publishing.
- **v1.7.0** - Verified and fixed ChatGPT-reported feature limitations: (1) Multi-inventory filtering now supported via array syntax `["9966", "4293"]` - API tested to OR results correctly; (2) Phrase proximity `"phrase"~N` documented in QUERY_SYNTAX.md - works for finding words within N positions; (3) Punctuation handling documented as API limitation (stripped during tokenization); (4) Added sortBy/sortOrder to `globalise_search_transcriptions` for consistency with `search_by_inventory`.
- **v1.6.1** - Simplified document URL output: removed IIIF URLs (canvas/manifest are for IIIF viewers, not direct access), removed high-res image URL, annoRepo, and textRepo. Now returns only National Archives link for viewing page scans. National Archives URL spelling issue could not be reproduced - likely one-off LLM hallucination. Added client-side request throttling (100ms delay between API calls) for good API citizenship. More elaborate options preserved for future if needed: concurrent request limits (semaphore/queue), token bucket/leaky bucket algorithms.
- **v1.5.3** - Railway deployment: Public instance at `https://globalise-mcp-production.up.railway.app/mcp`. Auto-deploys on push to main via GitHub integration. Added `railway.json` configuration.
- **v1.5.2** - Added retry logic with exponential backoff (1s → 2s → 4s, 3 attempts max) for transient failures (network errors, timeouts, 5xx, 429). Respects `Retry-After` header.
- **v1.5.0** - Removed `outputSchema` from tools for broad client compatibility (MSTY, Jan.ai)
