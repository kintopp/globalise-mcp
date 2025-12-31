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

### SQLite Database for Large Reference Datasets

**Priority:** High
**Status:** Ready to implement (plan complete)

**Background:**
Two GLOBALISE datasets are valuable as queryable tools but too large for MCP resources:
- Digitized Indexes OBP: 314K documents (finding aid with settlement, year, folio, description)
- Generale Missiven overview: 950 letters (dates, RGP references, scan URLs)

**Plan File:** `~/.claude/plans/sparkling-zooming-hinton.md`

**Tool:** `globalise_find_archival_documents`

**Key Design Decisions (2025-12-31):**
- CSVs committed to `data/sources/` (~75MB) for Railway build access
- Database rebuilt on each Railway deploy (~2-3 min build time)
- SQLite with FTS5 for full-text search in descriptions
- Uses `better-sqlite3` (synchronous, Railway-compatible)

**Input Parameters:**
```
source: 'obp' | 'gm' | 'all'     # Data source filter
query: string                    # FTS5 search in descriptions
inventoryNumber: string | string[]
settlement: string               # OBP only
yearFrom/To: number
folioFrom/To: number             # OBP only, proximity search
chamber: string                  # GM only (Amsterdam, Zeeland)
htrAvailable: boolean            # GM only
from/size: pagination
includeAggregations: boolean     # Settlement/year/inventory counts
```

**Output:**
- Discriminated union results (OBP vs GM have different fields)
- GM results include scan URLs, RGP references, HTR status
- Aggregations for scoping (settlement distribution, year range, top inventories)

**Usage Scenarios:**
See `offline/resources/scenarios-combined-index-use.md` for 6 detailed scenarios showing bidirectional workflow between index and transcriptions search.

**Source Data:**
- `offline/resources/GLOBALISE - Digitized Indexes.../...csv` (314K rows, 16 cols)
- `offline/resources/Overzicht van Generale Missiven.../...csv` (950 rows, 25 cols)

**SQLite Schema Highlights:**
- `obp_documents` table with indexes on inventory, settlement, year, folio
- `generale_missiven` table with indexes on inventory, date, chamber
- FTS5 virtual tables for description search
- Shared key: `inventory_number` links to transcriptions API URNs

**Files to Create:**
- `src/utils/database.ts` - SQLite wrapper with lazy init
- `src/tools/archival-index.ts` - Tool implementation
- `scripts/build-archival-db.ts` - CSV-to-SQLite build script
- `data/sources/*.csv` - Source CSVs (committed)
- `data/archival-index.sqlite` - Generated DB (gitignored)

**Version:** Will be 1.14.0

**Related:**
- `offline/resources/_RESOURCE_CONNECTIONS.md` - Dataset survey
- `offline/resources/tanap-resource-options-discussion.txt` - Earlier design discussion

---

### Explore Adding `globalise_help` Tool for Resource Discovery

**Priority:** Low
**Status:** Not started

**Background:**
MCP Resources (added in v1.9.0) are discoverable at the protocol level via `resources/list`, but most MCP clients (including Claude Desktop) don't expose them in their UI. Users have no way to know that curated domain knowledge exists in resources like `globalise://languages` or `globalise://help/query-syntax`.

Currently, resources are hinted at in tool descriptions (e.g., `**REFERENCE:** Query syntax guide available at globalise://help/query-syntax resource.`), but this relies on the LLM reading and acting on these hints.

**Proposed Tool:**
A `globalise_help` tool that the model can invoke to get:
1. List of available resources with URIs and descriptions
2. Optionally, the content of a specific resource
3. General usage guidance for the MCP server

**Example Schema:**
```typescript
{
  name: 'globalise_help',
  description: 'Get help on using the GLOBALISE MCP server. Lists available resources and usage guidance.',
  inputSchema: {
    topic: z.enum(['resources', 'query-syntax', 'languages', 'overview']).optional()
      .describe('Specific help topic. If omitted, returns general overview including resource list.')
  }
}
```

**Pros:**
- Makes resources discoverable through model-controlled invocation
- Consolidates help/reference material in one place
- Could replace embedding long domain knowledge in tool descriptions

**Cons:**
- Adds a 6th tool (more tools = more context consumption)
- Goes against "resist adding specialized tools" philosophy (see CLAUDE.md)
- Resources are already accessible via protocol; this duplicates access path
- Risk of Claude Desktop filtering if description seems too broad

**Questions to Explore:**
1. Do clients that support resources already provide discovery UI? (Check MSTY, Cursor, etc.)
2. Would a help tool reduce or increase total description length across all tools?
3. Is there evidence that LLMs fail to use the `**REFERENCE:**` hints in descriptions?
4. Could this be a prompt/resource instead of a tool?

**Related:**
- `offline/Understanding_MCP_Resources.md` Part 4 discusses resource discovery gap
- CHANGELOG v1.2.x documents tool filtering issues to avoid

---

### MCP Resources: Discovery and Usage Gap (Testing Results)

**Priority:** Low
**Status:** Documented (2025-12-30)

**Background:**
MCP resources were added in v1.9.0 with resource read logging added in v1.13.0. Testing on 2025-12-30 revealed that resources are **never accessed** by Claude Desktop, even when the user explicitly asks questions that the resources could answer.

**Testing Performed:**
1. Started GLOBALISE MCP server locally and via Claude Desktop (stdio transport)
2. User asked questions that resources could answer:
   - "What wildcard operators does GLOBALISE support?" → `globalise://help/query-syntax`
   - "What alternative spellings exist for 'gantang'?" → `globalise://reference/weights-measures`
3. User explicitly requested resource read: "Read the globalise://reference/weights-measures resource..."

**Results:**
- ✅ Server started correctly, resources listed in `resources/list` response
- ✅ Tools were called successfully (`globalise_search_transcriptions`)
- ❌ **Zero `resources/read` requests** in logs (checked both server stderr and Claude Desktop logs)
- ❌ When user explicitly mentioned resource URI, Claude Desktop interpreted it as a **file path** and tried to `cat` it

**Key Finding:**
Claude Desktop AI misunderstands resource URIs (`globalise://...`) as file paths, attempting bash commands like:
```bash
cat globalise://reference/weights-measures 2>/dev/null || echo "Resource not found"
find /mnt -name "*weights*" -o -name "*measures*" -o -name "*globalise*"
```

Instead of calling the MCP protocol method `resources/read`, Claude treated the URI as a filesystem path.

**Why Resources Aren't Used:**
1. **AI autonomy gap**: Resources are passive - the AI must decide to read them, but has no clear heuristic for when to do so
2. **No discovery mechanism**: Even when tool descriptions reference resources (e.g., `**REFERENCE:** Query syntax guide available at globalise://help/query-syntax`), Claude doesn't read them
3. **No user affordance**: Users cannot directly trigger resource reads in Claude Desktop - no UI, no command
4. **URI confusion**: Custom URI schemes aren't recognized as MCP protocol calls

**Verification:**
- ✅ Resource read logging implementation is **correct** (would work if called)
- ✅ Resources are **properly advertised** via `resources/list`
- ✅ Resource handler code is **functional** (`src/resources/index.ts:146-176`, `src/index.ts:270-289`)
- ❌ Protocol method `resources/read` is **never invoked** by Claude Desktop

**Implications:**
1. Resources may not be useful in current MCP implementations (at least with Claude Desktop)
2. Domain knowledge is better embedded in tool descriptions (as we currently do)
3. The "help tool" idea (see section above) may be necessary if resource content needs to be accessible
4. Resource logging is working but will likely never fire unless protocol changes or UI is added

**Log Evidence:**
See `/Users/bosse0000/Library/Logs/Claude/mcp-server-Globalise STDIO.log` - contains `tools/list`, `resources/list`, and multiple `tools/call` requests, but zero `resources/read` requests across multiple test sessions.

**Related:**
- Existing TODO item: "Explore Adding `globalise_help` Tool for Resource Discovery" (section above)
- `offline/Understanding_MCP_Resources.md` Part 4 discusses resource discovery gap (written before this testing)
- CHANGELOG v1.13.0: "Add resource read logging for tracking usage" (the logging that revealed this gap)

**Decision:**
Keep resources as-is for now (protocol compliance), but don't expect them to be used. If resource content needs to be accessible, consider converting to a tool or embedding in tool descriptions.

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

**Specific item: Bilingual/multilingual search discovery (v1.10 regression)**

Testing in Claude Desktop with v1.10 revealed that users asking for "documents in both English and Dutch" don't get the expected AND behavior. The LLM used `globalise_search_by_language` with multiple language codes, but didn't set `matchAll=true`, so the API returned documents with EITHER language (OR logic) instead of documents containing BOTH languages.

The `matchAll` parameter exists and works, but:
1. The tool description may not make the AND vs OR distinction clear enough
2. The LLM may not recognize "documents in both X and Y" as requiring `matchAll=true`
3. The default (`matchAll=false`) silently returns OR results, which can be confusing

**Action needed:**
- Review `globalise_search_by_language` description in `src/index.ts`
- Make AND vs OR behavior explicit in description
- Consider whether `matchAll` should default to `true` when multiple languages specified
- Add example showing bilingual search pattern

**Session excerpt (Claude Desktop, 2025-12-27):**
> User: "can you find documents written in both english and dutch?"
> LLM called `globalise_search_by_language` with `["eng", "nld"]`
> Result: ~4.8M docs (basically entire corpus, since Dutch dominates)
> LLM incorrectly concluded: "the API doesn't currently support a direct 'must have BOTH languages' query"

---

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

### Consider Merging `globalise_search_by_language` into `globalise_search_transcriptions`

**Priority:** Low
**Status:** Analysis complete (2025-12-31)

**Background:**
Both tools ultimately call the same `search()` function. Analysis shows ~80% overlap in functionality.

**Current Overlap:**

| Feature | `search_transcriptions` | `search_by_language` |
|---------|------------------------|---------------------|
| Filter by language ISO | ✅ `languages: ["nld"]` | ✅ `language: "nld"` |
| Filter by language name | ❌ | ✅ `language: "Dutch"` |
| Multiple languages (OR) | ✅ `languages: ["nld", "eng"]` | ✅ |
| Multiple languages (AND) | ❌ | ✅ `matchAll: true` |
| Search query | Required | Optional (default `*`) |
| Inventory filter | ✅ | ❌ |
| Sort options | ✅ | ❌ (fixed to `_score`) |

**Unique `search_by_language` Features:**
1. Human-readable language names (auto-detects ISO vs name by length ≤3)
2. `matchAll` parameter for AND logic (bilingual/multilingual docs)
3. Returns `inventoryCounts` aggregation

**Proposed Merged Schema:**
```typescript
searchSimpleInputSchema = z.object({
  query: z.string().optional().default('*'),  // Make optional
  languages: z.union([
    z.string(),
    z.array(z.string())
  ]).optional(),  // Accept single or array, ISO or name
  languageMatchAll: z.boolean().optional().default(false),  // AND logic
  inventoryNumber: z.union([z.string(), z.array(z.string())]).optional(),
  // ... existing params
});
```

**Pros:**
- Fewer tools = simpler for LLM, less context consumption
- Single entry point for all search functionality
- Follows "resist adding specialized tools" philosophy (CLAUDE.md)

**Cons:**
- Longer description for one tool
- Loss of specialized "language-first" framing in tool name
- `matchAll` post-filtering adds implementation complexity

**Implementation Notes:**
- The `matchAll` logic requires over-fetching and post-filtering (API limitation)
- Human-readable name detection uses length ≤3 heuristic
- Could preserve specialized framing in expanded description

**Decision:** Deferred. Current separation works and provides clear intent. Consider merging if tool count becomes a problem or if description length can be managed.

**Related:**
- `src/tools/search.ts` - `searchSimple()` implementation
- `src/tools/convenience.ts` - `searchByLanguage()` implementation
- CLAUDE.md "Design Philosophy" section

---

### Investigate Archival Index → Transcription Workflow Integration

**Priority:** Medium
**Status:** Analysis complete (2025-12-31)

**Background:**
`globalise_find_archival_documents` and `globalise_retrieve_document` are completely independent tools with no integration. The archival index provides rich metadata (settlement, folio ranges, document types, years) that could guide transcription retrieval, but there's no bridge between them.

**Current State:**
- Tools share no code paths and don't reference each other
- Shared key: `inventory_number` (but different granularities)
- Archival index uses **folio numbers** (physical pages)
- Transcriptions API uses **scan numbers** (digitized images)
- Folio ≠ scan (blank pages, inserts, recto/verso create mismatches)

**Recommended Workflow (not enforced):**
1. Use `find_archival_documents` to identify relevant inventories/folio ranges
2. Use `search_by_inventory` with text queries to find specific transcribed pages
3. Use `retrieve_document` for full text of specific pages

**Problem:** LLMs don't automatically follow this workflow. They may:
- Jump directly to `search_transcriptions` without scoping
- Use `retrieve_document` without knowing which scans to request
- Miss the archival context that would help narrow searches

**Investigation Questions:**
1. Can tool descriptions be enhanced to suggest the workflow?
2. Should tools cross-reference each other more explicitly?
3. Would a combined "smart search" tool that chains these steps be better?
4. Could `find_archival_documents` return estimated scan ranges or URNs?

**Potential Solutions:**

*Option A: Enhanced tool descriptions*
Add workflow hints to descriptions:
```
globalise_find_archival_documents:
"...WORKFLOW: Use results to scope subsequent searches.
Pass inventoryNumber to globalise_search_by_inventory to find transcribed pages."

globalise_search_by_inventory:
"...TIP: First use globalise_find_archival_documents to identify
which inventories contain documents about your topic."
```

*Option B: Return actionable suggestions*
Have `find_archival_documents` return a `suggestedNextStep` field:
```json
{
  "results": [...],
  "suggestedNextStep": {
    "tool": "globalise_search_by_inventory",
    "params": { "inventoryNumber": "1068", "query": "Ceylon" }
  }
}
```

*Option C: Folio→scan estimation*
Add estimated scan ranges to OBP results:
```json
{
  "folioStart": 13, "folioEnd": 20,
  "estimatedScanRange": { "from": "0025", "to": "0040" },
  "estimatedDocumentIds": ["NL-HaNA_1.04.02_1068_0025", ...]
}
```
Caveat: Imprecise without a proper folio↔scan mapping table.

*Option D: Composite tool*
Create `globalise_smart_search` that:
1. Searches archival index for matching inventories
2. Automatically searches transcriptions in those inventories
3. Returns combined results with archival context

Cons: Adds another tool, may be too "magic", reduces user control.

**Risks:**
- Cross-references between tools can cause Claude Desktop filtering (see CLAUDE.md)
- Too much workflow guidance in descriptions may bloat context
- Composite tools may hide useful intermediate steps from user

---

*Option E: MCP Prompts (added 2025-12-31)*

MCP Prompts are user-initiated templated workflows exposed via slash commands or UI menus.
See: https://modelcontextprotocol.io/specification/2025-11-25/server/prompts

**Prompt definition:**
```json
{
  "name": "archival_research",
  "title": "Research VOC Documents",
  "description": "Guided workflow: archival index → transcription search",
  "arguments": [
    { "name": "topic", "required": true, "description": "Research topic" },
    { "name": "settlement", "required": false, "description": "Settlement filter" },
    { "name": "yearFrom", "required": false, "description": "Start year" },
    { "name": "yearTo", "required": false, "description": "End year" }
  ]
}
```

**Prompt message would inject workflow:**
```
I want to research: {{topic}}

Follow this workflow:
1. First use globalise_find_archival_documents to identify relevant inventories
   (filter by settlement={{settlement}}, years={{yearFrom}}-{{yearTo}} if provided)
2. Review the inventory numbers and folio ranges returned
3. Use globalise_search_by_inventory for each promising inventory to find transcribed pages
4. Use globalise_retrieve_document to get full text of specific pages

Start with step 1.
```

**Client support:**

| Client | Prompt Support | How It Works |
|--------|---------------|--------------|
| Claude Code | ✅ Full | Slash commands (`/mcp__globalise__archival_research`) |
| Claude Desktop | ⚠️ Limited | Via `+` menu as attachment, awkward UX |
| ChatGPT, MSTY | ❓ Unknown | Needs testing |

**Implementation:**
```typescript
// Add to capabilities in src/index.ts:
capabilities: {
  tools: {},
  resources: {},
  prompts: {}  // Add prompt support
}

// Add prompts/list and prompts/get handlers
```

**Comparison of all options:**

| Option | Effort | UX | Works Everywhere |
|--------|--------|-----|------------------|
| A: Tool descriptions | Low | Implicit (may be ignored) | Yes |
| B: Output suggestions | Low | Subtle | Yes |
| C: Folio→scan estimation | Medium | Seamless | Yes |
| D: Composite tool | High | Seamless but hidden | Yes |
| E: MCP Prompts | Medium | Good (Code), OK (Desktop) | No |

**Recommendation:**
Use multiple approaches together:
1. **Prompts** - For users who explicitly want guided research
2. **Tool description hints** - For implicit guidance (Option A, light touch)
3. **Output suggestions** - Include `suggestedNextStep` in `find_archival_documents` results (Option B)

---

**Related:**
- `src/tools/archival-index.ts` - Archival index implementation
- `src/tools/document.ts` - Document retrieval implementation
- `offline/resources/scenarios-combined-index-use.md` - Usage scenarios (if exists)
- CLAUDE.md "Design Philosophy" - Resist adding specialized tools
- MCP Prompts spec: https://modelcontextprotocol.io/specification/2025-11-25/server/prompts

---

### Extend `globalise_navigate` for Large Jumps and Direct Scan Access

**Priority:** Medium
**Status:** Analysis complete (2025-12-31)

**Background:**
Currently `globalise_navigate` only supports single-step prev/next navigation using the API's `prevPageId`/`nextPageId` from document metadata. Users may want to:
1. Jump N pages forward/backward
2. Navigate directly to a specific scan number
3. Jump to first/last page of an inventory
4. Navigate based on folio numbers from archival index

**Document ID Format:**
```
NL-HaNA_{archive}_{inventory}_{scan}
         1.04.02   9966       0106
```

**Modification Options:**

*Option 1: Steps parameter (multi-step)*
```typescript
steps: z.number().int().min(1).max(100).default(1)
```
- Pro: Simple extension
- Con: Requires N sequential API calls (inefficient)

*Option 2: Direct scan jump*
```typescript
targetScan: z.string()  // e.g., "0150"
inventoryNumber: z.string()
```
- Pro: Single API call, efficient
- Con: May fail if scan doesn't exist; overlaps with `retrieve_document`

*Option 3: Offset (relative jump)*
```typescript
offset: z.number().int()  // +50 or -20
```
Implementation:
```typescript
const currentScan = parseInt(scanNumber);
const targetScan = (currentScan + offset).toString().padStart(4, '0');
const targetId = `NL-HaNA_1.04.02_${inventory}_${targetScan}`;
```
- Pro: Intuitive for large jumps
- Con: Scan numbers may have gaps

*Option 4: Inventory boundaries*
```typescript
direction: z.enum(['next', 'previous', 'first', 'last'])
```
- Pro: Useful for exploring inventories
- Con: Finding boundaries requires search with sort

*Option 5: Folio-based (OBP integration)*
```typescript
targetFolio: z.number().int()
inventoryNumber: z.string()
```
- Query archival index for folio → estimate scan range
- Pro: Uses archival metadata
- Con: Folio≠scan mismatch; unreliable

**Feasibility:**

| Option | Effort | Reliability | Use Case |
|--------|--------|-------------|----------|
| Steps | Low | High | Browse nearby |
| Direct scan | Low | Medium | Known target |
| Offset | Low | Medium | Jump ±N pages |
| First/last | Medium | High | Explore inventory |
| Folio-based | High | Low | OBP integration |

**Recommended Implementation:**

Combine options 2, 3, and 4:

```typescript
navigateInputSchema = z.object({
  // Existing
  currentDocumentId: z.string().optional(),
  direction: z.enum(['next', 'previous', 'prev', 'first', 'last']).optional(),
  includeText: z.boolean().optional().default(true),

  // New: relative jump
  offset: z.number().int().optional()
    .describe('Jump N scans forward (+) or backward (-) from current'),

  // New: direct jump
  targetScan: z.string().optional()
    .describe('Jump directly to scan number (e.g., "0150")'),
  inventoryNumber: z.string().optional()
    .describe('Inventory for targetScan or first/last navigation'),
});
```

**Logic flow:**
1. If `targetScan` + `inventoryNumber` → construct URN, retrieve directly
2. If `offset` → calculate target scan from current, retrieve
3. If `direction` = first/last → search inventory with size=1, sorted
4. If `direction` = next/prev → existing behavior

**Edge cases:**
- Gaps in scan numbers: Return error with suggestion
- Out of bounds: Indicate inventory start/end reached
- Invalid inventory: Validate before constructing URN

**Version:** Would be minor version bump (new optional parameters, backwards compatible)

**Related:**
- `src/tools/convenience.ts` - Current navigate implementation
- `src/tools/document.ts` - Document retrieval and ID parsing

---

### Visual Representation of OBP Corpus Structure

**Priority:** Low
**Status:** Idea (2025-12-31)

**Background:**
Users exploring the VOC transcriptions may benefit from visual representations of the corpus structure. Currently, the only way to understand the collection is through tool responses (aggregations, counts). A visual overview could help users:
- Understand the scope and coverage of the corpus
- Identify where to focus research
- Grasp temporal and geographical distributions

**Two Approaches:**

*Option A: ASCII Art in Tool Responses*

Simple text-based visualizations embedded in tool outputs:

```
GLOBALISE Corpus Overview (4.8M pages)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Languages:
  Dutch     ████████████████████████████████████ 97.2%
  Unknown   ██                                    2.1%
  Persian   ▏                                     0.3%
  Other     ▏                                     0.4%

Inventories by Century:
  1600s     ████████████                         28%
  1700s     ████████████████████████████         72%

Top Settlements (OBP):
  Batavia      ████████████████████              45K docs
  Ceylon       ██████████                        22K docs
  Malacca      ████                               9K docs
```

- Pro: Works everywhere, no external dependencies
- Con: Limited expressiveness, clutters responses

*Option B: Static HTML Dashboard*

Single HTML page with modern visualizations (Chart.js, D3.js, or similar):

```
/dashboard.html or globalise://dashboard resource

Sections:
├── Corpus Overview (total pages, inventories, date range)
├── Language Distribution (pie/bar chart)
├── Temporal Coverage (timeline/heatmap)
├── Geographical Coverage (settlement treemap or map)
├── OBP vs GM comparison
├── Inventory Size Distribution (histogram)
└── Reference Resources
    ├── Weights & Measures (interactive table)
    └── Query Syntax Guide
```

- Pro: Rich visualizations, interactive, comprehensive
- Con: Requires hosting, maintenance, separate from MCP flow

**Implementation Options for Dashboard:**

1. **Static file in repo** (`docs/dashboard.html`)
   - Generated from database aggregations at build time
   - Hosted via GitHub Pages or alongside Railway deployment
   - Tools link to it: `"See corpus overview: https://globalise-mcp.../dashboard.html"`

2. **MCP Resource** (`globalise://dashboard`)
   - Returns HTML that client could render
   - Pro: Integrated with MCP
   - Con: Most clients won't render HTML resources

3. **Generated on demand via `globalise_visualization` tool**
   - Returns both structured data AND ASCII rendering
   - Client can use either representation
   - Could support multiple visualization types

   ```typescript
   globalise_visualization({
     type: 'languages' | 'settlements' | 'timeline' | 'overview' | 'inventory',
     inventoryNumber?: string,  // For inventory-specific viz
     format: 'ascii' | 'data' | 'both',  // Output format
   })
   ```

   **Example output (format: 'both'):**
   ```json
   {
     "type": "languages",
     "ascii": "Languages:\n  Dutch  ████████████████ 97.2%\n  ...",
     "data": {
       "labels": ["Dutch", "Unknown", "Persian"],
       "values": [97.2, 2.1, 0.3],
       "counts": [4660000, 100800, 14400]
     },
     "generatedAt": "2025-12-31T12:00:00Z"
   }
   ```

   - Pro: Flexible (ASCII for terminals, data for rich clients)
   - Pro: Integrated with MCP flow
   - Pro: Can scope to specific inventories/filters
   - Con: Adds another tool (but replaces need for external dashboard)

**What to Visualize:**

| Metric | Source | Visualization |
|--------|--------|---------------|
| Language distribution | Search aggregations | Pie/bar chart |
| Pages per inventory | Search aggregations | Histogram |
| Temporal coverage | OBP year_earliest/latest | Timeline/heatmap |
| Settlement distribution | OBP settlement field | Treemap or bar |
| Chamber distribution | GM chamber field | Pie chart |
| HTR availability | GM htr_available | Progress bar |
| Inventory gaps | OBP coverage analysis | Range chart |
| Weights & measures | Resource data | Searchable table |

**Data Sources:**

```typescript
// Corpus-wide stats (could cache at build time)
const stats = {
  totalPages: 4_800_000,
  totalInventories: 3987 - 1053 + 1, // OBP range
  dateRange: { from: 1610, to: 1794 },
  languages: await search({ query: '*', size: 1 }).aggregations.languages,
  settlements: await findArchivalDocuments({ source: 'obp', size: 1 }).aggregations.settlements,
};
```

**Potential Extensions:**

- **Interactive filters**: Click on a settlement → shows inventories for that settlement
- **Deep links**: Each visualization element links to relevant tool call
- **Comparison views**: Side-by-side OBP vs GM coverage
- **Search integration**: Dashboard includes search box that calls tools

**Questions to Explore:**

1. What's the right balance between static (fast, simple) and dynamic (current, interactive)?
2. Should this be part of the MCP server or a separate documentation site?
3. Would ASCII art in responses be useful, or just noise?
4. Could this become a "corpus explorer" UI that wraps MCP tools?

**Related:**
- `src/tools/archival-index.ts` - OBP/GM aggregations
- `src/tools/search.ts` - Language aggregations
- `src/resources/index.ts` - Weights & measures resource
- Railway deployment - Could host static files

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

### Optimize Weights & Measures Resource JSON

**Priority:** Low
**Status:** ✅ Completed (v1.16.0, 2025-12-31)

**Resolution:**
Redesigned the resource for LLM use (search + conversion assistance):
- Added 731 unit conversion records with human-readable ratios and context
- Kept bilingual definitions (nl/en), dropped scholarly source citations
- Kept SU_xxxx unit IDs for traceability to source dataset
- Added conversions with commodity and location context
- File size: 114 KB (was 57 KB, increase due to conversions)

For scholarly use, users should refer to the Dataverse source: hdl:10622/MDNVH5

---

### Add Commodities Thesaurus Resource

**Priority:** High
**Status:** ✅ Completed (v1.15.0, 2025-12-31)

**Resolution:**
Implemented `globalise://reference/commodities` resource with:
- 1,359 trade goods (excluded 2,275 "NOT YET CLASSIFIED" unless they had alt labels or definitions)
- 2,481 spelling variants for query expansion
- Bidirectional hierarchy: `broader` (parent) and `narrower` (children)
- Full UUIDs as concept IDs (future-proof for PoolParty)
- Clean definitions (stripped citation metadata)
- Sensitive content note with datasheet link
- 569 KB JSON

**Design Decisions Made:**
1. Full UUIDs as IDs (future-proof if PoolParty becomes public)
2. Exclude unclassified EXCEPT those with alt labels or definitions (rescued 14)
3. Include `narrower` arrays for bidirectional navigation
4. Drop all external links (Getty AAT, RCE-CHT, SITC)
5. Strip citation suffixes from definitions
6. Add datasheet link to sensitive content note

**Implementation:**
- Parser: `scripts/parse-commodities.js` using `n3` library
- Source: hdl:10622/YAWDOV (CC-BY-SA-4.0)

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

- **2025-12-28** - **API docs reviewed for v1.9.0 language fields**: Confirmed `globalise-transcriptions-api/` documentation accurately describes `langIso` and `langLabel` in aggregations, search results, filtering, and TypeScript types. No changes needed—documentation was already complete.
- **v1.10.0** - **Language format unified**: All search tools now return `languages` as `{code, label}[]` instead of `string[]`. This is a breaking change but provides consistency with `globalise_retrieve_document` and includes ISO codes for programmatic use.
- **v1.10.0** - **Multi-language filtering with AND logic**: `globalise_search_by_language` now accepts arrays and supports `matchAll` parameter. When `matchAll=true`, returns only documents containing ALL specified languages (bilingual/multilingual). Uses post-filtering since API only supports OR.
- **v1.10.0** - **Resource hints in tool descriptions**: Added `**REFERENCE:**` sections pointing to relevant resources (query-syntax, corpus/stats, languages).
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
