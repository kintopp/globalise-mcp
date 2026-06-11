# GLOBALISE MCP Server - Open Items

> **Archive:** Completed items, blocked items, research notes, and deferred ideas are in `offline/outdated/TODO-archive.md`.

---

### PageXML Word Coordinates Database

**Priority:** Medium
**Status:** Ready for implementation (investigation complete 2026-01-29)
**Unblocks:** Image overlays and text-image linking in Document Viewer (both currently blocked)

Word-level coordinates exist in PageXML files but aren't exposed through the public API. PageXML files are publicly available and can be parsed directly.

**Approach:** Parse PageXML → extract word bounding boxes → store in SQLite → serve via new tool.

**Key numbers:** ~200 words/page, 4.8M pages, ~10-12 GB SQLite database. Query speed <1ms with index.

**Open questions:**
1. How to access PageXML files at scale? (Direct download, data request?)
2. Store full polygons (accurate) or bounding boxes (compact)?
3. Incremental updates when new transcriptions are added?

**Details:** `offline/outdated/TODO-archive.md` has full schema, storage estimates, and implementation steps.

---

### Reimplement Removed Resources as SQLite-backed Tools

**Priority:** Medium
**Status:** Planned (resources removed in v1.17.0)

Archived content in `archived-resources/`. Reimplement as on-demand lookup tools:
- **Weights & Measures** → `globalise_lookup_measure` (term → variants, conversions)
- **Commodities** → `globalise_lookup_commodity` (term → concepts, hierarchy, variants)
- **Query Syntax** → integrate into search tool descriptions or simple help tool

Could share a single `data/reference.sqlite` database. Follows `globalise_find_archival_documents` pattern.

---

### Review and Edit Tool Descriptions

**Priority:** Low
**Status:** Open-ended pass; both previously-flagged issues resolved

Review all tool descriptions in `src/index.ts` for accuracy, clarity, and consistency.

---

### Review and Edit README.md

**Priority:** Medium
**Status:** Not started

README serves multiple audiences (end users, developers, API reference) without serving any well. Consider splitting, adding security considerations, and studying how other MCP servers document setup.

---

### Remove Unnecessary Translations from Weights & Measures JSON

**Priority:** Low
**Status:** Pending

LLMs can translate entries themselves. Multilingual descriptions in the archived JSON are unnecessary overhead.

---

### Draft MCP Spec Migration (stateless protocol) + CacheableResult

**Priority:** Low
**Status:** Watching — blocked on `@modelcontextprotocol/sdk` shipping draft support (draft is not yet a released protocol version; see https://modelcontextprotocol.io/specification/draft/changelog)

The draft makes MCP **stateless**: removes the `initialize`/`initialized` handshake (protocol version, clientInfo, capabilities move to `_meta`), removes protocol-level sessions and `Mcp-Session-Id`, removes `ping`/`logging/setLevel`, adds a mandatory `server/discover` RPC, requires `Mcp-Method`/`Mcp-Name` POST headers, changes resource-not-found from `-32002` to `-32602`, and deprecates Roots/Sampling/Logging.

**Why this is low-effort for us (mostly SDK-internal):** every breaking change lives in the transport/lifecycle layer the SDK owns. The server is already aligned — stateless Streamable HTTP (`sessionIdGenerator: undefined`, GET/DELETE → 405), no server-initiated requests (no sampling/roots/elicitation), no Logging capability (logs to `stderr` via `console.error`, the draft's recommended migration), deterministic `tools/list` order, and `$ref`-free schemas. We use **none** of the removed/deprecated features.

**Actions when the SDK lands draft support:**
1. Bump `@modelcontextprotocol/sdk`; confirm the SDK handles handshake removal, `server/discover`, `_meta` protocol fields, the new POST headers, and the `-32602` error code. Re-run `npm test` (smoke asserts the tool surface) + a live viewer call. No expected change to tool/resource code.
2. **Adopt `CacheableResult` (additive enhancement, not a fix):** emit `ttlMs` + `cacheScope: "public"` on `tools/list` and `resources/read`. The archival index is static (rebuilt only at deploy) and the corpus is read-only, so it's an ideal fit for long freshness hints — a genuine win, not just conformance.

Migration is directional only until the draft finalizes a version date — do not implement against it now (moving target).

---

### Document Viewer: OpenSeadragon Enhancements

**Priority:** Low
**Status:** Ideas

- Navigator mini-map (`showNavigator: true`)
