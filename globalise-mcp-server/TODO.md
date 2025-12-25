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

---

## Completed Improvements

*Move items here once implemented, with version number and date.*

- **v1.5.3** - Railway deployment: Public instance at `https://globalise-mcp-production.up.railway.app/mcp`. Auto-deploys on push to main via GitHub integration. Added `railway.json` configuration.
- **v1.5.2** - Added retry logic with exponential backoff (1s → 2s → 4s, 3 attempts max) for transient failures (network errors, timeouts, 5xx, 429). Respects `Retry-After` header.
- **v1.5.0** - Removed `outputSchema` from tools for broad client compatibility (MSTY, Jan.ai)
