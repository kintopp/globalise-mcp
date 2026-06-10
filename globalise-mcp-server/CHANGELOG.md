# Changelog

All notable changes to the GLOBALISE MCP Server will be documented in this file.

> **Archive:** Versions 1.0.0–1.16.5 (Dec 2025 – Jan 2026) are in `offline/outdated/CHANGELOG-v1.0-v1.16.md`.
>
> **Deployment:** Production (`main`) is at **v1.23.0**. Beta (`feature/*`) is at **v1.24.1** with MCP Apps Document Viewer changes not yet merged to main.

## [1.25.0] - 2026-06-10

P0 architecture refactor per `MCP-SERVER-REFACTOR-REVIEW.md` (items R1–R4). Spec claims re-verified against the live 2025-11-25 changelog and npm registry before implementation (Phase 0 gate). Version 1.24.x skipped: it was used by the reverted `feature/mcp-apps-document-viewer` branch.

### Changed
- **R1 — Fresh server instance per connection**: all tool/resource registration moved into a `createServer(): McpServer` factory in `index.ts`. Stdio calls it once; HTTP calls it per request; each legacy SSE connection gets its own instance. Fixes the shared-`Server` transport-rebinding bug (the root cause behind the v1.23.0 "session race condition" workaround).
- **R2 — Stateless Streamable HTTP**: `POST /mcp` now creates a per-request server + `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`, torn down on response close. Deleted the session maps (`streamableSessions`, `pendingTransports`), two-phase init tracking, stale-session "auto-recovery", and the DELETE endpoint (~150 lines). `GET /mcp` and `DELETE /mcp` return 405 (spec-legal in stateless mode). `/health` no longer reports session counts.
- **R3 — SDK upgrade and high-level API**: `@modelcontextprotocol/sdk` `^1.10.1` → `^1.29.0`, `@modelcontextprotocol/ext-apps` `^1.0.1` → `^1.7.4`, `zod` → `^3.25.0`. Migrated from low-level `Server` + `setRequestHandler` + hand-built `Tool[]` array to `McpServer.registerTool()` with Zod schemas (registered `.strict()`, so unknown params are rejected). Viewer tool/resource now use ext-apps `registerAppTool`/`registerAppResource` (SDK emits both nested and legacy `ui/resourceUri` metadata keys). The cross-cutting post-processing survives the switch-statement removal: viewer-links markdown block via shared `toolResponse()` wrapper; viewer dual-content response preserved unchanged.
- **Trust proxy**: `app.set('trust proxy', 1)` — required behind Railway's proxy with SDK 1.29's rate-limit middleware.

### Added
- **R4 — Origin validation on MCP endpoints** (`src/utils/origin.ts`): spec MUST (2025-11-25) — invalid origins get 403. Missing Origin, non-web schemes, `null`, and localhost always allowed; `http(s)` origins must match `MCP_ALLOWED_ORIGINS` (exact origins or `*.domain` globs; default allows claude.ai/claude.com/chatgpt.com hosts; `*` disables). Deny logs are rate-limited per origin per 60s.
- **Stdio smoke test** (`scripts/smoke-test.ts`): SDK client over stdio — initialize → `tools/list` → `globalise_find_archival_documents` (local DB, no network). Run with `npm run test:smoke`.

### Removed
- **`zod-to-json-schema` dependency**: the SDK now generates JSON Schema from Zod shapes.
- **Tool-name listing in startup logs** (the registry lives inside the factory now; MCP Inspector or `tools/list` shows the registered tools).

---

## Code Simplification - 2026-02-08

### Changed
- **Extract `formatError` helper** in `index.ts`: Replaced nested ternary error handling with clear `if/else` function
- **Extract `createStreamableSession` helper** in `http-server.ts`: Consolidated duplicated session creation logic (~30 lines removed)
- **Extract `applyHostContext` helper** in `viewer.ts`: Eliminated duplicated theme/style application between `onhostcontextchanged` and `connect()`
- **Extract shared `document-id.ts` utility**: Consolidated document ID parsing duplicated across `document.ts`, `document-viewer.ts`, and `convenience.ts`
- **Consolidate `apiFetchOnce`** in `api-client.ts`: Merged duplicate `apiGetOnce`/`apiPostOnce` into a single function
- **Extract archival query helpers** in `archival-index.ts`: `buildCommonConditions`, `mapObpRow`/`mapGmRow`, `appendNotNull`
- **Simplify filter building** in `search.ts` and `convenience.ts`: Spread syntax replaces repetitive if-blocks
- **Hoist `allTools` array** in `index.ts`: Removed duplication between `http` and `stdio` branches

### Removed
- **Dead code in `iiif.ts`**: Removed unused `IIIF_BASE_URL`, `buildOpenSeadragonTileSource()`, and `buildThumbnailUrl()` exports
- **Un-exported `CacheEntry`** in `cache.ts`: Interface was only used internally

---

## Repo Housekeeping - 2026-02-08

### Changed
- **Track CLAUDE.md**: Removed CLAUDE.md from `.gitignore` so project instructions are version-controlled
- **Rename `examples/` to `issues/`**: Renamed directory and added `scripts/README.md`
- **Update archived file paths**: Updated references to archived CHANGELOG and TODO files in `offline/outdated/`

### Removed
- **Research files**: Moved 7 API research files from `globalise-transcriptions-api/research/` to `offline/research/api-research/`
- **Reverted v1.24.x branch**: Reverted merge of `feature/mcp-apps-document-viewer` (v1.23.1–v1.24.2); server remains at v1.23.0

---

## [1.23.0] - 2026-01-29

### Fixed
- **HTTP Transport Session Race Condition**: Fixed "Connection closed" error on first tool call
  - Root cause: Sessions were stored before initialization completed, causing race conditions when clients sent parallel requests
  - Solution: Use `onsessioninitialized` callback to track pending vs initialized sessions properly

### Changed
- **Session Lifecycle Improved**: HTTP transport now uses two-phase session storage
  - `pendingTransports`: Sessions being initialized (not ready for tool calls)
  - `streamableSessions`: Fully initialized sessions (ready for tool calls)

### Related Issues
- [modelcontextprotocol/typescript-sdk#408](https://github.com/modelcontextprotocol/typescript-sdk/issues/408): Server not initialized error

---

## [1.22.0] - 2026-01-29

### Added
- **Image Rotation**: Document Viewer now has rotate left/right buttons

### Changed
- **Navigation Buttons Hidden**: `app.callServerTool()` is broken in Claude Desktop ([#32](https://github.com/anthropics/claude-ai-mcp/issues/32))
- **Tool Description Updated**: Text selection in transcription triggers translation hint

---

## [1.21.0] - 2026-01-29

### Added
- **External Link Buttons**: Working "GLOBALISE Viewer" and "National Archives" buttons via `app.openLink()`
- **Navigation Buttons**: Added (currently broken, see [#32](https://github.com/anthropics/claude-ai-mcp/issues/32))

### Fixed
- [#31](https://github.com/anthropics/claude-ai-mcp/issues/31): External links now work via `app.openLink()`
- `updateModelContext()` format: Fixed to use `content: [{ type: 'text', text }]` array format
- Text selection context now properly updates model context

---

## [1.20.0] - 2026-01-28

### Added
- **Archival Context in Document Viewer**: Displays metadata from OBP/GM databases
  - Source badge, settlement(s), year range, VOC chamber, HTR availability, document type
- **Option A Architecture**: Tool internally fetches from both data sources in a single call

---

## [1.19.0] - 2026-01-28

### Changed
- **MCP Apps SDK Integration**: Added `@modelcontextprotocol/ext-apps` dependency
  - Dual-format metadata: `_meta.ui.resourceUri` and legacy `_meta["ui/resourceUri"]`
  - CSP configuration with correct field names (`resourceDomains`, `connectDomains`)

### Improved
- Complete MCP Apps lifecycle handlers (partial → input → result → context → teardown)
- Theme integration via host CSS variables with dark mode support
- IntersectionObserver pauses OpenSeadragon when out of view
- Loading spinner during document fetch

---

## [1.18.0] - 2026-01-27

### Added
- **Document Viewer MCP App**: Interactive UI tool (`globalise_view_document_ui`)
  - OpenSeadragon IIIF image viewer with zoom, pan, reset
  - Transcription panel with line numbers and search term highlighting
  - Resizable split-view layout
  - Vite build system with `vite-plugin-singlefile`

### Files Added
- `src/tools/document-viewer.ts`, `src/utils/iiif.ts`, `apps/document-viewer/`

---

## [1.17.1] - 2026-01-24

### Changed
- Default `fragmentSize` increased from 100 to 500 characters for all search tools

---

## [1.17.0] - 2026-01-11

### Removed
- **All MCP Resources**: Removed to reduce context window consumption (~359 KB total)
  - Content preserved in `archived-resources/`
  - Future plan: reimplement as SQLite-backed lookup tools (see TODO.md)
