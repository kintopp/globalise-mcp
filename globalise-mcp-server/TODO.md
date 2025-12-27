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

### Review and Edit README.md

**Priority:** Medium
**Status:** Not Started

**Task:**
Continue reviewing and editing the MCP server's README.md. The current version only partially satisfies several, partly conflicting goals:

1. **Quick start for users** - How to get running with Claude Desktop, ChatGPT, etc.
2. **Technical reference** - Tool schemas, parameters, response formats
3. **Project overview** - What the server does, what GLOBALISE is
4. **Developer onboarding** - How to contribute, build, deploy

**Considerations:**
- Should some content be split into separate files (e.g., CONTRIBUTING.md, API.md)?
- What's the right balance between brevity and completeness?
- Which audience is primary: end users or developers?
- **Add MCP security considerations** - Document security best practices, authentication (or lack thereof), data privacy, rate limiting, and what users should consider when using the public Railway instance vs running locally
- **Review end-user focused templates** - Study how other MCP servers document setup/enablement for end users. Look at examples from other Anthropic-endorsed MCP servers to find best practices for clear, step-by-step integration instructions (Claude Desktop, ChatGPT, MSTY, etc.). Look, for example, at https://huggingface.co/settings/mcp 

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

**Specific item: `globalise_retrieve_document` URL description**

The current description says:
> "National Archives URL for viewing page scan (always present as clickable link)"

This is outdated. Since v1.8.0, the Transcriptions Viewer URL is the primary/default link (shows scan + transcription side-by-side with highlighting). The description should:
1. Lead with Transcriptions Viewer as the recommended/default link
2. Mention National Archives as an alternative for raw page scans
3. Reflect that both URLs are returned in the `urls` object

Current in code (`src/index.ts` ~line 138):
```
(4) National Archives URL for viewing page scan (always present as clickable link).
```

Should become something like:
```
(4) Transcriptions Viewer URL (recommended) for viewing scan + transcription side-by-side,
(5) National Archives URL for viewing raw page scan.
```

---

### Fix Language Format Inconsistency Between Tools

**Priority:** Medium
**Status:** Not started

**Background:**
The MCP server returns language information in different formats depending on which tool is used:

| Tool | Format | Example |
|------|--------|---------|
| `globalise_search_transcriptions` | `languages: string[]` | `["English", "Dutch"]` |
| `globalise_retrieve_document` | `languages: {code, label}[]` | `[{code: "eng", label: "English"}, ...]` |

**Root cause:**
- `search.ts:165` maps to `result.langLabel` (labels only)
- `document.ts:148-151` maps the full `lang` array with both ISO codes and labels

**Example document:** `NL-HaNA_1.04.02_3714_0343` (bilingual English/Dutch)

**Options:**

1. **Unify to objects** (recommended) - Both tools return `{code, label}[]`
   - Pro: Consistent, includes ISO codes for programmatic use
   - Con: Breaking change for search results

2. **Unify to strings** - Both tools return `string[]` (labels only)
   - Pro: Simpler output
   - Con: Loses ISO code information

3. **Add both fields** - Search returns both `languages` and `languageCodes`
   - Pro: No breaking change, more information
   - Con: Redundant data

**Recommendation:** Option 1 with a note in CHANGELOG about the format change.

---

### Add Multi-Language Filtering with AND Logic

**Priority:** High
**Status:** Not started

**Background:**
Some documents contain text in multiple languages (e.g., both Dutch and English). Currently:
- `globalise_search_by_language` only accepts a single language string
- `globalise_search_transcriptions` accepts an array but uses OR logic
- There's no way to find documents tagged with ALL specified languages

**Evidence from testing (2025-12-27):**
```
Dutch only:        4,344,249 docs
English only:          3,600 docs
["nld","eng"]:     4,345,394 docs (OR - union)
Overlap (BOTH):       ~2,455 docs (calculated)
```

Example document with multiple languages:
```json
{
  "doc": "NL-HaNA_1.04.02_1237_0535",
  "languages": ["English", "Dutch"]
}
```

**Proposed changes:**

1. **Update `globalise_search_by_language`** to accept array:
   ```typescript
   language: z.union([z.string(), z.array(z.string())])
   ```

2. **Add `matchAll` parameter** to control OR vs AND logic:
   ```typescript
   matchAll: z.boolean().optional().default(false)
     .describe('If true, documents must have ALL specified languages. If false (default), documents with ANY language match.')
   ```

3. **Implementation options:**
   - If API supports AND logic natively → use it
   - Otherwise → post-filter results client-side (less efficient but works)

**Use cases:**
- "Find bilingual Dutch-English documents"
- "Find documents with both Portuguese and Dutch"
- Research on multilingual correspondence

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

- **2025-12-27** - Added Transcriptions Viewer URL to all tool outputs. Now returns `transcriptionsViewer` URL (e.g., `https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:NL-HaNA_1.04.02_3714_0343`) for every document in search results, document retrieval, and navigation. This is the most useful link for users - shows scan + transcription side-by-side with highlighting.
- **2025-12-27** - Documented tokenizer behavior across all documentation. Testing revealed GLOBALISE uses **standard Elasticsearch tokenizer** (not whitespace as reported in [textannoviz#134](https://github.com/knaw-huc/textannoviz/issues/134)). Punctuation is stripped automatically, special characters are word separators. Updated: `offline/Help_Revised.md`, `globalise-transcriptions-api/README.md`, `globalise-transcriptions-api/QUERY_SYNTAX.md`, `src/index.ts` tool description. Full analysis in `globalise-transcriptions-api/research/Tokenizer_Analysis.md`.
- **2025-12-26** - Cross-referenced help page vs API/MCP capabilities. See `globalise-transcriptions-api/research/Help_Page_Cross_Reference.md`. Key findings: (1) Escape characters (`\*`, `\?`) do NOT work as documented - backslash is ignored/acts as separator; (2) Inventory filter requires array syntax, not comma-separated strings; (3) 4 API features undocumented on help page (phrase proximity, language filter, sorting, aggregations).
- **2025-12-26** - Verified all API documentation examples work correctly against live API. Tested: README.md (search, doc retrieval), API_REFERENCE.md (filters, pagination, config, indices, IIIF), QUERY_SYNTAX.md (AND/OR, wildcards, fuzzy, phrases, proximity), DATA_MODELS.md (TypeScript patterns). All 15+ examples pass.
- **2025-12-26** - Updated CLAUDE.md release checklist: added README.md to version bump files, added instruction to verify examples use real API values before publishing.
- **v1.7.0** - Verified and fixed ChatGPT-reported feature limitations: (1) Multi-inventory filtering now supported via array syntax `["9966", "4293"]` - API tested to OR results correctly; (2) Phrase proximity `"phrase"~N` documented in QUERY_SYNTAX.md - works for finding words within N positions; (3) Punctuation handling documented as API limitation (stripped during tokenization); (4) Added sortBy/sortOrder to `globalise_search_transcriptions` for consistency with `search_by_inventory`.
- **v1.6.1** - Simplified document URL output: removed IIIF URLs (canvas/manifest are for IIIF viewers, not direct access), removed high-res image URL, annoRepo, and textRepo. Now returns only National Archives link for viewing page scans. National Archives URL spelling issue could not be reproduced - likely one-off LLM hallucination. Added client-side request throttling (100ms delay between API calls) for good API citizenship. More elaborate options preserved for future if needed: concurrent request limits (semaphore/queue), token bucket/leaky bucket algorithms.
- **v1.5.3** - Railway deployment: Public instance at `https://globalise-mcp-production.up.railway.app/mcp`. Auto-deploys on push to main via GitHub integration. Added `railway.json` configuration.
- **v1.5.2** - Added retry logic with exponential backoff (1s → 2s → 4s, 3 attempts max) for transient failures (network errors, timeouts, 5xx, 429). Respects `Retry-After` header.
- **v1.5.0** - Removed `outputSchema` from tools for broad client compatibility (MSTY, Jan.ai)
