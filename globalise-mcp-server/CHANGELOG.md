# Changelog

All notable changes to the GLOBALISE MCP Server will be documented in this file.

> **Archive:** Versions 1.0.0–1.16.5 (Dec 2025 – Jan 2026) are in `offline/outdated/CHANGELOG-v1.0-v1.16.md`.
>
> **Deployment:** Production (`main`) is at **v1.23.0**. Beta (`feature/*`) is at **v1.24.1** with MCP Apps Document Viewer changes not yet merged to main.

## [2.5.0] - 2026-06-10

Closes out the two `.mcpb`-readiness follow-ups flagged in the v2.4.0 notes.

### Changed
- **Migrated the archival DB layer from `better-sqlite3` to Node 24's built-in `node:sqlite` (`DatabaseSync`).** Removes the project's only native dependency, so the production tree (`@modelcontextprotocol/{sdk,ext-apps}`, `cors`, `express`, `zod`) is now pure JavaScript — a pure-JS `.mcpb` bundle is possible without per-platform prebuilt binaries. Verified on Node 24.16: `node:sqlite` is flagless (no `--experimental-sqlite`, no `ExperimentalWarning`), and Node's bundled SQLite has FTS5 compiled in.
  - `src/utils/database.ts`: `new DatabaseSync(path, { readOnly: true })`; pragmas issued via `db.exec('PRAGMA …')` (no `.pragma()` helper). `existsSync` already guards the missing-file case, so `fileMustExist` was dropped.
  - `src/tools/archival-index.ts`: `Statement` → `StatementSync`; bind-params narrowed from `Record<string, unknown>` to `Record<string, string | number>` (`node:sqlite` rejects `unknown` and any named key absent from the SQL); `ObpDbRow`/`GmDbRow` converted from `interface` to `type` so the `Record<string, SQLOutputValue>` result casts compile. Read path validated by `test:archival` (FTS5 MATCH incl. phrase-escape rescue, settlement/chamber filters, OBP→GM pagination boundary, cached aggregations) — all green.
  - `scripts/build-archival-db.ts`: `db.transaction()` (absent in `node:sqlite`) replaced with a `runInTransaction()` helper wrapping `BEGIN`/`COMMIT`/`ROLLBACK`, preserving batched inserts. Validated end-to-end to a temp path: parsed 227,526 OBP + 950 GM rows, built FTS5, `ANALYZE`/`VACUUM`, round-trip query confirmed. The committed deploy artifact (`data/archival-index.sqlite.gz`) is unchanged — the existing better-sqlite3-built DB reads identically under `node:sqlite` (same on-disk format).
- **`vite` 7 → 8.0.16.** `vite-plugin-singlefile@2.3.3` declares vite 8 support; the single-file viewer bundle rebuilds (~686 KB) and `test:viewer-build` passes.

### Added
- **`/health` now reports the runtime Node version** (`{ status, name, version, node }`). `curl <url>/health` after a Railway deploy confirms which Node the platform's builder selected (expected `v24.x`). Railway selects Node from `engines.node` + `.nvmrc`; the major is pinned, the patch is the builder's choice. The code runs on any Node 24.x (the `>=24.15` floor is for Claude Desktop parity, not a hard requirement). CLAUDE.md's Deployment section documents the `NIXPACKS_NODE_VERSION` override.

## [2.4.0] - 2026-06-10

### Changed
- **Pinned the Node runtime to the Claude Desktop line.** Added `"engines": { "node": ">=24.15.0 <25.0.0" }` to `package.json` and a `.nvmrc` (`24.16.0`), so local dev (nvm), CI, and Railway's nixpacks builder all select Node 24 — the version bundled inside Claude Desktop. This is the groundwork for distributing the server as an `.mcpb` (MCP Bundle), which runs on Claude Desktop's embedded Node 24 runtime.
- **Dependency upgrades** (all majors taken; build + full test suite pass, `npm audit` clean):
  - `zod` **3.25 → 4.4.3**. The MCP SDK and `ext-apps` already declare `zod: ^3.25 || ^4.0` as a peer dep, so only our own schemas needed touching. One breaking call site: `z.record(z.array(z.string()))` → `z.record(z.string(), z.array(z.string()))` in `src/tools/search.ts` (zod 4 makes the key schema mandatory). Verified the SDK still emits `$ref`-free, strict (`additionalProperties: false`) tool input/output JSON Schemas — zod 4 switches the SDK to zod's native `z.toJSONSchema()` emitter, and the smoke test confirms the tool contract is unchanged.
  - `better-sqlite3` **11 → 12** (native module; prebuilt binary loads on Node 24, read-only query path verified by `test:archival`). Still the only native dependency — a follow-up `node:sqlite` migration is tracked for the `.mcpb` work.
  - `vite` **5 → 7.3.5** and `vite-plugin-singlefile` **2.3.0 → 2.3.3** (build-only; single-file viewer bundle rebuilds and passes `test:viewer-build`).
  - `typescript` **5.7 → 6.0.3**, `@types/node` **22 → 24.13.1** (matches the pinned runtime).
  - `csv-parse` **5 → 6.2.1** and `n3` **1 → 2.0.3** (build/data-prep scripts only; APIs unchanged, validated directly).
  - `cors` 2.8.5 → 2.8.6, `@types/better-sqlite3`/`@types/cors`/`@types/express` refreshed.
- **Pinned `tsx`** (`^4.22.4`) as a devDependency. The `build` (`ensure:db`), `dev`, and all `test`/script commands invoke `npx tsx`, which previously fetched an unpinned tsx on each run — a build-reproducibility gap (it runs during Railway builds). Now resolved from the lockfile.
- **`npm audit` → 0 vulnerabilities.** `npm audit fix` cleared 4 transitive advisories (`path-to-regexp`, `qs`, `postcss`, `picomatch`) via semver-compatible bumps; build + tests re-verified afterward.

## [2.3.1] - 2026-06-10

### Fixed
- **`globalise_search_transcriptions` crashed on result sets containing blank pages** with `Cannot read properties of undefined (reading 'map')`. Upstream omits `langIso`/`langLabel` entirely on zero-token (blank) scans rather than returning empty arrays, and the result mapper called `result.langIso.map(...)` unguarded (`src/tools/search.ts`). Such pages surface whenever a query matches text-free scans — most visibly `query: "*"` combined with `sortBy: "document"`, which returns an inventory from its (often blank) opening scans; keyword queries never hit it because only text-bearing pages match. Now guarded (`(result.langIso ?? []).map(...)`, `result.langLabel?.[i]`), so blank pages yield `languages: []`. The `SearchResult` type now marks `_hits`, `langIso`, and `langLabel` optional so the compiler enforces guarding. Verified live against the bug-report inputs (inv 7535/4293, wildcard ± inventory, and the keyword control).

## [2.3.0] - 2026-06-10

### Changed
- **OpenSeadragon upgraded 4.1.1 → 6.0.2** (the current release). The document viewer's image pane now defaults to **WebGL rendering** (introduced in OSD 5.0), with automatic canvas fallback where WebGL is unavailable. No viewer code changes were required: the viewer only uses OSD's stable core API (`OpenSeadragon()` options, `viewport.{fitBounds,panTo,zoomBy,setRotation,goHome}`, `Rect`/`Point`, and the `open`/`open-failed` events), none of which were affected by the 5.x/6.x breaking changes (Tile data-pipeline overhaul, removed `onPageChange`, deprecated `Tile.context2D`).
- **Dropped the `@types/openseadragon` devDependency**: OSD 6 ships its own TypeScript definitions (`openseadragon/types/index.d.ts`), with the same `export = OpenSeadragon` / `export as namespace` shape, so the default-import + namespace usage in `viewer.ts` is unchanged. Verified `viewer.ts` type-checks cleanly against the bundled types (the main `tsc` build excludes `apps/`, so this was checked separately).

The self-contained viewer bundle grew from ~0.4 MB to ~0.68 MB (the WebGL drawer); the `test:viewer-build` self-containment and inlining checks still pass.

## [2.2.1] - 2026-06-10

Code-quality pass (`/simplify`) over the full P0–P3 diff: four parallel review agents (reuse, simplification, efficiency, altitude), fixes applied, no behavior changes intended.

### Changed
- **Structured errors formalized**: new `ToolError extends Error` class in `src/utils/errors.ts` replaces the duck-typed `throw { error, suggestion }` plain objects in `document-id.ts` and `archival-index.ts` — compiler-checked shape, stack traces preserved. `formatError` narrows via `instanceof`; the duck-typed branch remains for the pre-existing `ApiError` objects from `api-client.ts`.
- **Archival-index source-skip logic computed once**: the R7 "skip the other source on one-sided filters" decision and the OBP/GM where-clauses are now derived a single time and shared by the result queries and the aggregations (previously two hand-synchronized copies under a "mirror the logic above" comment; clauses were built twice).
- **DB path single-sourced**: `build-archival-db.ts` and `ensure-archival-db.ts` now resolve the SQLite path via `getDatabasePath()` instead of three independent copies. Fixes a latent drift bug: with `ARCHIVAL_DB_PATH` set, the CSV-rebuild fallback wrote the DB to the default path (which the server never reads) while reporting success.
- **`/health` server name plumbed through**: `HttpServerOptions.name` carries `SERVER_NAME` from `index.ts` instead of a second hardcoded `'globalise-mcp-server'` string (same pattern as the R15 version fix).
- **HTTP 405 handlers deduplicated**: GET/DELETE `/mcp` share one `methodNotAllowed` handler factory.
- **Origin guard simplified and bounded**: dropped the never-used `OriginGuardOptions.allowedOrigins` injection parameter; the deny-log rate-limit map is capped at 1000 entries (origins are attacker-controlled, so it could previously grow without bound).
- **Viewer zoom factors centralized**: shared `zoomIn()`/`zoomOut()` helpers used by both the toolbar buttons and the keyboard shortcuts (the 1.5/0.67 factors lived in two places).
- **Minor**: redundant double condition around `sanitizeFtsQuery` collapsed (`note` set ⇔ query rewritten); unreachable "empty response" debug branch removed; the `STRUCTURED_CONTENT` gate extracted to one `structuredPayload()` helper used by `toolResponse` and the viewer app tool.

---

## [2.2.0] - 2026-06-10

P3 wave per `MCP-SERVER-REFACTOR-REVIEW.md` (items R17, R18, R19; the review's optional PageXML word-coordinates project under R19 is not included). Closes out the review.

### Added
- **R18 — Prebuilt DB ships as a compressed artifact**: `data/archival-index.sqlite.gz` (~25 MB, gzip −9) is committed to the repo, and a new `npm run ensure:db` step (now the last stage of `npm run build`) materializes `archival-index.sqlite` from it in seconds instead of re-parsing 78 MB of CSV on every Railway deploy. Resolution order: existing DB → `ARCHIVAL_DB_URL` download (optional `ARCHIVAL_DB_TOKEN` bearer auth, gunzip when the URL ends in `.gz`) → committed `.gz` artifact → CSV rebuild → graceful absence. `npm run build:db` regenerates the `.gz` alongside the DB so the artifact cannot drift. Verified byte-identical via both the local-artifact and URL-download paths.
- **R19 — Viewer keyboard shortcuts wired**: the control-button title hints (`+`/`=` zoom in, `−` zoom out, `0` reset view, `R` rotate left, `Shift+R` rotate right) now have a matching `keydown` handler instead of being decorative.

### Changed
- **R19 — Viewer reads `structuredContent`**: `globalise_view_document_ui` returns the document as `structuredContent` plus a single human-readable text block; the fragile "second text block should be the JSON" dual-content contract is retired. The viewer parses `structuredContent` first and keeps content-sniffing only as a fallback; with `STRUCTURED_CONTENT=false` the server still emits the legacy dual-content shape (verified both ways via SDK client).
- **R19 — IIIF deep-zoom enabled**: the "IIPImage at service.archief.nl doesn't support standard IIIF info.json" assumption was re-checked (2026-06-10) and no longer holds — the service answers IIIF Image API v3 `info.json` with a 256px tile pyramid (level2, CORS `*`). The viewer now fetches `info.json` and feeds the tile pyramid to OpenSeadragon, cutting initial bandwidth ~10× on large scans; the full-resolution single JPEG remains as fallback when the fetch fails. `https://service.archief.nl` was added to the CSP `connectDomains` for the `info.json` fetch.
- **R17 — `TRANSPORT=sse` alias dropped**: the deprecation shim (warn + run HTTP) is gone; use `TRANSPORT=http`.
- **R17 — Build-only deps out of the production tree**: `csv-parse` (DB build script) and `n3` (offline commodity script) moved to `devDependencies`.

### Removed
- **R17 — Dead code & strays**: the unused `getDocumentInputSchema`/`getDocumentSimpleInputSchema` duality collapsed to one public input schema plus a plain internal options type (`navigate()` keeps its `includeText: false` optimization for the current page); the tracked 0-byte `data/archival-index.db` stray deleted. (The review's other hygiene items — committed `.DS_Store` files, nested empty `globalise-mcp-server/globalise-mcp-server/` dir — were already absent from the tracked tree.)

### Tests
- Viewer build check extended: asserts the bundle reads `structuredContent` and fetches IIIF `info.json` (R19). Full suite: 65 checks passing.

---

## [2.1.1] - 2026-06-10

Code-quality pass over the 2.1.0 P2 wave (no behavior changes intended).

### Changed
- **Aggregation caching de-duplicated**: the unfiltered-aggregation cache logic in `archival-index.ts` (R14) is collapsed — the GROUP-BY queries move into pure `computeObpAggregations`/`computeGmAggregations` functions and the cacheable-or-not decision is a single `??=` expression per source, instead of separate read/write checks that had to stay synchronized by hand.
- **Document-ID parse uses capture groups**: `parseDocumentId` matches one regex with capture groups instead of `test()` + `split('_')`, so the validation pattern and the segment extraction can no longer disagree.
- **Shared test utilities**: the `check()`/failure-count/verdict boilerplate, previously copied verbatim into all three test scripts, lives once in `scripts/test-utils.ts` (`check` + `finish`). The smoke test's two structured-tool-error assertions (R7, R13) share a local `expectToolError` helper.
- **Test-suite trims**: the one-sided-filter tests in `test:archival` pass `includeAggregations: false` (their aggregations were computed but never inspected); `test:viewer-build` stats the built HTML once instead of twice.

---

## [2.1.0] - 2026-06-10

P2 wave per `MCP-SERVER-REFACTOR-REVIEW.md` (items R11, R13, R14, R15, R16; R12 already landed inside R6's consolidation in 2.0.0). No breaking changes.

### Added
- **R13 — Document-ID validation**: malformed document IDs (anything not matching `NL-HaNA_{archive}_{inventory}_{scan}`, with optional `urn:globalise:` prefix) now fail fast with a structured error and an example of the expected format, instead of flowing into an upstream URN lookup that 404'd confusingly.
- **R16 — Test harness rounded out**: `npm test` runs three suites — `test:archival` (filter-combination matrix, FTS5 hostile inputs, combined OBP→GM pagination boundary, aggregation-cache stability; plain Node scripts, local DB only), `test:viewer-build` (built viewer exists, is self-contained, has no CDN references), and the existing `test:smoke` (now also checks the R13 malformed-ID error path).

### Changed
- **R11 — Viewer dependencies bundled**: the document viewer no longer imports the ext-apps SDK from unpkg (which had silently pinned it to 1.0.1) or OpenSeadragon from jsdelivr; both are bundled from node_modules into the single-file HTML (~580 KB) by Vite. A CDN hiccup can no longer blank the viewer iframe, and `resourceDomains` in the CSP shrinks to just `https://service.archief.nl` (IIIF images).
- **R14 — Static DB work cached per connection**: the two full-table `COUNT(*)` totals are computed once per database connection (previously run on every `findArchivalDocuments` call), and unfiltered aggregations (GROUP BYs over ~227K rows) are cached after first computation — better-sqlite3 is synchronous, so these blocked the event loop per request. The global outbound-API throttle's latency-stacking caveat under concurrent users is now documented in `api-client.ts` (kept as-is for the current 1–2 users).
- **R15 — Version single-sourced in code**: `SERVER_VERSION` is read from `package.json` at startup; the hardcoded copy in `src/index.ts` is gone. The version-bump lockstep list shrinks to package.json + CLAUDE.md + CHANGELOG.

---

## [2.0.1] - 2026-06-10

Code-quality pass over the P0/P1 refactor commits (no behavior changes intended).

### Changed
- **Single viewer-URL constant**: `VIEWER_URL_PREFIX` now lives in `utils/api-client.ts` (derived from `API_CONFIG.FRONTEND_BASE_URL`) and is imported by `index.ts`, `document.ts`, and `document-viewer.ts`, replacing three independent copies of the URL string.
- **Viewer links co-located with registrations**: the tool-name `if/else` chain in `extractViewerLinks` is gone; each `registerJsonTool` call now passes its own links-builder callback, so new tools can't silently miss link extraction.
- **Version single-sourced**: `http-server.ts` no longer hardcodes its own `VERSION`; `/health` and the startup log report the version passed via `HttpServerOptions` (from `SERVER_VERSION` in `index.ts`). One fewer file in the version-bump lockstep list.
- **Per-request hot path slimmed**: `.strict()` input-schema variants are derived once at module scope instead of inside every per-request `createServer()`; the document-viewer HTML is read from disk once and cached (the not-yet-built fallback still re-probes so a dev build is picked up without restart).
- **Prepared statements reused**: the FTS5 probe and the two table-total `COUNT(*)` statements in `archival-index.ts` are prepared once per database connection instead of recompiled on every `findArchivalDocuments` call.
- **Dead surface removed**: `getDocumentSimple` passthrough wrapper deleted (`globalise_retrieve_document` calls `getDocument` directly); `search`/`searchInputSchema`/`SearchInput` un-exported (file-private); unused `GetDocumentSimpleInput` type removed.

---

## [2.0.0] - 2026-06-10

P1 refactor per `MCP-SERVER-REFACTOR-REVIEW.md` (items R5–R10). Major version bump: this is the breaking-change wave for clients (tool consolidation, response-shape changes).

### Breaking
- **R6 — Search tools consolidated 3 → 1**: `globalise_search_by_inventory` and `globalise_search_by_language` removed. `globalise_search_transcriptions` now covers both: `query` is optional (defaults to `"*"`), `inventoryNumber` and `languages` filters compose, and `matchAll` finds bilingual/multilingual pages. Language values accept ISO 639-3 codes or English names in any mix, normalized per-entry via the ISO↔label maps (replaces the `length <= 3` heuristic that misrouted mixed input — from R12). For matchAll the upstream filter language is the first non-Dutch entry (Dutch is ~97% of the corpus), and the response carries a `note` stating the 500-candidate scan cap and that totals are a lower bound (R12 honesty fix). 7 tools → 5. Search result rows no longer include `scanNumber` (trivially readable from the document ID).
- **R5 — Legacy SSE transport removed**: `/sse` + `/messages` endpoints (pre-2025-03-26 protocol) deleted; Streamable HTTP (`/mcp`) and stdio remain. `TRANSPORT=sse` still starts HTTP mode but logs a deprecation warning. `/health` slimmed to `{status, name, version}`.
- **R9 — Response-shape diet**: tool results are now compact JSON (pretty-printing inflated token cost ~25–40% on array-heavy payloads); `getDocument`/`navigate` no longer return `text.fullText` (it duplicated `text.lines` verbatim); search results no longer carry a per-row `viewerUrl` (the template `https://transcriptions.globalise.huygens.knaw.nl/detail/{id}` is stated once in the tool description and server instructions; the clickable viewer-links markdown block, capped at 10, remains and is now built from result ids).

### Added
- **R8 — Structured output restored behind an env gate**: the four data tools register `outputSchema` and return `structuredContent` (SDK-validated) by default; set `STRUCTURED_CONTENT=false` to strip both for clients that reject them (MSTY, Jan.ai). The text channel remains the primary payload. The viewer tool keeps its dual-content shape (retired only by R19).
- **R10 — Server `instructions`**: corpus-level caveats (unknown/cipher language classification, non-Roman-script HTR unreliability, Malay macrolanguage, tokenizer behavior, viewer URL template, scoping workflow) moved to the `McpServer` instructions field, stated once per connection. Tool descriptions rewritten as short informative paragraphs — the `**USE WHEN**`/`**DO NOT USE FOR**` routing tables and the caveat blocks duplicated across two tools are gone.
- **R7 — `findArchivalDocuments` correctness**: incompatible filter combos (`settlement` is OBP-only; `chamber`/`htrAvailable` are GM-only) now return a structured error with a suggestion instead of silently returning `total: 0`; when `source: "all"` skips one source because of a source-specific filter, the response says so in a `note` field (aggregations now respect the same skip). FTS5 syntax errors (e.g. `oost-indie`, unbalanced quotes) no longer crash the tool: the query is retried phrase-escaped (noted in the response) or rejected with a quoting suggestion. Deleted the dead `results.length < input.size` branch.

### Fixed
- Stale README: removed the `globalise://help/...` resources table (those resources were archived pre-P0; only the viewer UI resource exists) and documented the `MCP_ALLOWED_ORIGINS`/`STRUCTURED_CONTENT` env vars.
- Smoke test extended: exact tool count, removed-tool absence, `$ref`-free output schemas, `structuredContent` presence, server instructions presence, and the R7 incompatible-filter error path.

---

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
