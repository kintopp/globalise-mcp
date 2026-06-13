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

**Priority:** Low
**Status:** Commodities (v2.7.0) and Weights & Measures (v2.8.0) shipped (see archive); **Query Syntax** remains

Two of the three archived `archived-resources/` resources are now SQLite-backed lookup tools (`globalise_lookup_commodity`, `globalise_lookup_measure`) over the shared `data/reference.sqlite`. The last one:
- **Query Syntax** → integrate into the search tool descriptions or a simple help tool.

A third vocabulary would follow the same recipe: read-only DB, per-connection state via `createConnectionState`, shared FTS sanitizer (the `globalise_find_archival_documents` pattern).

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
**Status:** Pending — now a decision point (conflicts with v2.8.0)

LLMs can translate entries themselves. Multilingual descriptions in the archived JSON are unnecessary overhead.

**Note (v2.8.0):** `globalise_lookup_measure` shipped the JSON **as-is**, definition translations intact (per the Editorial-decisions rule — ship source data unmodified unless a transform is flagged). In practice this is a small surface: only ~13 of 213 units carry any English text. This item and v2.8.0 now point in opposite directions, so it is a maintainer call: either close this item (keep the EN translations) or pursue translation-stripping as a separate, flagged, data-only change that re-runs `npm run build:db:commodities` and regenerates `data/reference.sqlite.gz`. Do **not** treat it as a routine cleanup.

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

### Revise SKILL.md to link further GLOBALISE reference datasets

**Priority:** Low
**Status:** Not started

SKILL.md names external GLOBALISE resources in prose but rarely links them — the "Weights & measures" section describes the ~213-unit glossary with no URL, and the "Colonial-era language" note cites "separate remediation datasets" for Asian individuals without pointers. Add links to further GLOBALISE references (weights & measures, places/geography, persons/actors, and similar gazetteers/authority files) so the model can hand users a citable source for material this server doesn't expose as a tool. Favour a compact "Further references" table over inline prose, and mind the ~500-line SKILL.md budget (currently 501 — already at the cap, so trim elsewhere to add a table).
