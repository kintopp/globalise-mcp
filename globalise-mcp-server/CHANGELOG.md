# Changelog

All notable changes to the GLOBALISE MCP Server will be documented in this file.

> **Archive:** Versions 1.0.0–1.16.5 (Dec 2025 – Jan 2026) are in `offline/outdated/CHANGELOG-v1.0-v1.16.md`.
>
> **Deployment:** Production (`main`) is at **v1.23.0**. Beta (`feature/*`) is at **v1.24.1** with MCP Apps Document Viewer changes not yet merged to main.

## [2.7.10] - 2026-06-12

Surface a public link from each commodity to the live GLOBALISE Commodities thesaurus. Read-path only — no DB rebuild (the `uuid` column already shipped) and no change to search, ranking, or the committed artifacts.

### Added
- **`thesaurusUrl` on every `lookup_commodity` result** — a stable handle permalink (`https://hdl.handle.net/20.500.14722/thesaurus:commodities:<UUID>`) into the public Skosmos thesaurus, where the curated SKOS hierarchy (broader/narrower terms) and the concept's cited source (often a Zotero record) live — the taxonomy the flat tool deliberately omits. Derived in JS from the already-stored PoolParty UUID; the committed DBs stay byte-identical.
  - The vocabulary migrated off PoolParty to a handle-based Skosmos home but preserved every concept UUID verbatim, so the UUID previously stored as an "internal, unresolvable key" is now publicly resolvable. Validated end-to-end: all **3,508** glossary UUIDs resolve to a live concept page (live scheme has 3,621 concepts; our set is a clean subset — **0 dead links**). A UUID-format guard yields `null` rather than a broken link for any malformed key.

### Changed
- The always-loaded `globalise_lookup_commodity` tool description (`src/index.ts`) now names `thesaurusUrl` and when to offer it, and its stale "Concept IDs are internal and not returned" clause (which implied no link exists) was corrected. This is the dependable channel for surfacing behavior: a per-field output-schema `.describe()` alone does not reliably reach the client LLM, and non-skill clients never load SKILL.md — so the trigger had to live in the tool description.
- Refreshed the now-false "never surfaced / not publicly resolvable" rationale in `src/tools/commodities.ts` and `scripts/build-commodities-db.ts` to describe the derived permalink.
- `skills/globalise-voc-research/SKILL.md`: note that `thesaurusUrl` is the escape hatch to the hierarchy and sources the flat lookup omits.

## [2.7.9] - 2026-06-11

Build-script dedup (code-review finding 19). Tooling only — no change to the server, the DBs, or the committed artifacts; the build/ensure scripts run via tsx and aren't part of the tsc project, so this was verified by running them.

### Changed
- **New `scripts/db-build-utils.ts`** holds the helpers the four DB scripts had forked:
  - `runInTransaction(db, fn)` — was character-identical in `build-archival-db.ts` and `build-commodities-db.ts`; both now import it.
  - `writeGzipArtifact(dbPath)` — the `createGzip(level:9)` deploy-artifact tail (+ size log) both build scripts repeated.
  - `ensureDb(opts)` — the parameterized present → `*_DB_URL` download → committed `.gz` gunzip → source rebuild → warn resolution, with the crash-safe temp-write. `ensure-archival-db.ts` and `ensure-reference-db.ts` are now thin wrappers passing their paths/labels/env-var names.
- **`ensure-reference-db.ts` gains what its hand-fork had dropped:** a `REFERENCE_DB_URL`/`REFERENCE_DB_TOKEN` download branch and the temp-write crash-safety, for free via `ensureDb`. Its stale header comment (referenced a non-existent `npm run ensure:db:commodities`) is fixed to `npm run ensure:db`.

### Verified
Ran `build:db:commodities` and `ensure:db` against a temp `REFERENCE_DB_PATH` (build → 3,508 rows + gzip artifact; ensure → decompressed the committed `.gz` correctly), leaving the committed `data/*.sqlite{,.gz}` untouched. Full suite green (150 assertions).

## [2.7.8] - 2026-06-11

P4 cleanup pass (code-review findings 11, 12, 13, 14, 16, 17, 18, and finding 20's index + viewer items). Mostly internal hardening and dead-code removal; one small behavior fix (finding 11) and one viewer attribute-escaping improvement. No DB rebuild, no `.skill` change. Full suite green (150 assertions, +3).

### Fixed
- **Empty-string settlement/chamber no longer diverge** (finding 11). The source-routing checks tested `!== undefined` while the WHERE builders tested falsiness, so a literal `''` was a filter to one and a no-op to the other: `{settlement:''}` skipped GM and returned every OBP doc as if filtered, and `{source:'gm', settlement:''}` threw. `findArchivalDocuments` now normalizes empty/whitespace settlement & chamber to `undefined` once at the top, so `''` is simply "no filter."
- **`document-id` URN handling is case-insensitive and anchored** (finding 17). `normalizeDocumentId`/`parseDocumentId` used a case-sensitive `startsWith` and a first-occurrence `replace`, so `URN:GLOBALISE:NL-HaNA_…` got double-prefixed and rejected. Both now strip `^urn:globalise:` case-insensitively.
- **FTS sanitizer distinguishes query errors from operational ones** (finding 12). The three `catch {}` in `sanitizeFtsQuery` walked the whole rewrite chain on *any* probe failure and surfaced "Invalid full-text query", masking the real cause (a finalized statement after `closeDatabase()`, SQLITE_BUSY, I/O). It now rethrows anything that isn't an FTS5 query-grammar error (node:sqlite `code === 'ERR_SQLITE_ERROR' && errcode === 1`, empirically confirmed against the live index).
- **`getDatabase`/`getReferenceDatabase` no longer flip-flop on a failing PRAGMA** (finding 14). The handle was published to the module var before the pragmas ran, so a throwing pragma left every later call returning a half-configured handle while the first reported the DB unavailable. The connection is now configured on a local and published only after the pragmas succeed.
- **`getCachedApiGet` cache check + in-flight dedup** (finding 13). Switched the cache hit test from truthiness to `!== undefined` (a legitimately-cached falsy value is a hit), and added per-cache in-flight dedup so N concurrent misses for the same key share one upstream fetch instead of firing N.
- **Viewer `escapeHtml` now escapes quotes** (finding 20). The old `document.createElement('div')`/textContent approach left `"`/`'` intact even though `escapeHtml` is used inside `title="…"` attributes; the regex-based replacement closes that and drops the per-call DOM node.

### Changed
- **FTS query contract single-sourced** (finding 16). Exported `FTS_OPERATORS` + `FTS_AUTOQUOTE` from `src/utils/fts.ts`; both tool-input describes and both `index.ts` registrations now interpolate them, so the next change to the sanitizer's behavior edits one string instead of four prose sites (SKILL.md, a separate-audience doc, stays hand-maintained).
- **`index.ts` STRUCTURED_CONTENT gate + error wrapper extracted** (finding 20). New `outputSchemaField()` (the R8 gate, shared by both registrations) and `runTool()` (the try/catch→errorResponse wrapper, shared by registerJsonTool and the app-tool handler). `formatError` also hardened to surface any object with a string `message` rather than coercing to `[object Object]` (the full ApiError-class migration is deferred — see TODO).
- **Viewer transcription highlighting** (finding 20): one combined highlight regex compiled per render instead of one `new RegExp` per term per line.
- **Viewer splitter drag handlers** (finding 20): the document-level mousemove/mouseup are now registered once at module scope (they were added per `renderDocument` and never removed, accumulating stale pairs), and the drag bounds are read once on mousedown instead of per mousemove (no forced reflow mid-drag).

### Removed (dead code, finding 18)
- `configCache` (zero importers) from `api-client.ts`.
- `LRUCache.clear()/size()/has()/delete()` (zero callers) — `has()` in particular delegated to `get()`, which mutates LRU recency.
- The dead `includeAnnotations` option on `getDocument` (always true; its false branch would have stripped metadata and broken `navigate`).
- The inert `searchInputSchema` zod object (never parsed → defaults never applied) → a plain `SearchInput` interface; dropped the never-passed `indexName`/`languageLabels` knobs and their dead branches.
- The unreachable third parse fallback in the viewer's `parse-result.ts`.

## [2.7.7] - 2026-06-11

Document-viewer fixes — the P3 viewer-only batch (code-review findings 8, 9, 10). Viewer-only (`apps/document-viewer`); no server-tool behavior change, no DB rebuild, no `.skill` change.

### Fixed
- **Rotation no longer desyncs across documents** (finding 8). `rotateImage` tracked the angle in a module-level `currentRotation` that was never reset when a new document loaded a fresh OpenSeadragon viewer at 0°, so the first rotate after navigating jumped to 180°. It now derives from the live `viewer.viewport.getRotation()`, removing the sync invariant entirely; `currentRotation` is deleted and `resetView` no longer touches it.
- **Error screens show the message, not the raw JSON envelope** (finding 9). The server's `errorResponse` emits `JSON.stringify({error, suggestion, tool})` as the error text; the viewer rendered that blob verbatim. The `isError` branch now parses it and shows `error` as the message with `suggestion` as a secondary `.error-suggestion` line, falling back to the raw text for any non-JSON error. New CSS for `.error-suggestion`.

### Changed
- **Server↔viewer contract is now single-sourced and cross-checked** (finding 10). The viewer had hand-written `DocumentData`/`ArchivalContext` interfaces duplicating the server's `viewDocumentUiOutputSchema` (zod) across two separate compilations (tsc over `src/`, vite over `apps/`), so a server-side rename compiled green everywhere and failed only at runtime in the iframe. The viewer now imports the server's zod-inferred `ViewDocumentUiOutput`/`ArchivalContext` types directly (`import type`, erased by esbuild — zod stays out of the bundle, verified: bundle size unchanged). The result-parsing logic moved to a browser-free `apps/document-viewer/src/parse-result.ts` so it can run under node, and a new `scripts/test-viewer-protocol.ts` (wired into `npm test` as `test:viewer-protocol`) feeds a schema-validated payload through it — catching `id`-detection / schema drift that `test:viewer-build` (build-only) never could.

### Deferred
The viewer (`apps/`) is still excluded from `tsc` and only transpiled by vite, so a type error in viewer.ts itself is caught by neither the build nor `npm test` (only the extracted parse path is now node-testable). Full viewer type-checking is a larger build-infra change (an apps tsconfig + DOM/openseadragon/ext-apps types) deferred out of this batch.

## [2.7.6] - 2026-06-11

Per-connection statement-cache refactor across the two SQLite tools (code-review findings 6, 15, and 20's commodities item). No behavior change — same inputs, outputs, and result contract; full suite green (142 assertions, +2 new). No DB rebuild, no `.skill` change.

### Changed
- **New `createConnectionState(init)` in `src/utils/database.ts`** (finding 15). Both tools hand-copied the same per-connection cache (`staticState?.db !== db` handle-keying + an FTS probe + a cached COUNT), and a third copy was planned for the weights-&-measures DB. Extracted to one factory that owns the handle-keying invariant (a prepared statement belongs to its handle, so the cache is rebuilt after `closeDatabase()` + reopen) and exposes a per-connection `prepare(sql)` that caches statements by SQL string. Each factory call owns its own slot, so the archival and reference DBs never collide.
- **`src/tools/archival-index.ts`** (finding 6). `getStaticDbState` → `getDbState = createConnectionState(...)`; every per-call statement (OBP/GM COUNT + SELECT, the three aggregation GROUP BYs) now goes through the cached `prepare()` instead of `db.prepare()`, so each distinct SQL shape is compiled once per connection rather than re-prepared on every call (with a query + `source:'all'` that was up to 8 inline prepares). The lazy unfiltered-aggregation result cache is unchanged.
- **`src/tools/commodities.ts`** (finding 20, first item). `getStaticState` → `getState = createConnectionState(...)`; the FTS COUNT and both SELECT shapes now use the cached `prepare()` too.
- **Tests** — `test-archival-index.ts` §7: a query → `closeDatabase()` → same query asserts identical total/aggregations, locking the handle-keying invariant (state rebuilt on the fresh handle, not reused stale).

### Deferred
Finding 6 also floated materializing the FTS-matched rowids once per call (temp table / CTE) so the same `MATCH` isn't *executed* in every statement. Not done: a per-call temp table conflicts with the statement cache (cached statements referencing a re-created temp table get invalidated), and on the warm read-only DB the redundant `MATCH` cost is modest. The re-prepare cost — the finding's primary fix — is eliminated. Finding 20's other items (viewer regex/handlers, the `STRUCTURED_CONTENT` gate, `formatError`) are untouched and remain open.

## [2.7.5] - 2026-06-11

Graceful HTTP shutdown (P2 finding 5). Every Railway redeploy sends SIGTERM, but `shutdown()` was `closeDatabase(); process.exit(0)` — it cut in-flight `/mcp` requests mid-response (e.g. while awaiting an upstream search fetch) and the socket kept accepting new connections right up to exit. The root cause was a discarded handle: `createHttpServer` called `app.listen()` but returned the express `app`, throwing away the `http.Server`, so nothing could `.close()` it.

### Fixed
- **`src/transports/http-server.ts`** now captures the `http.Server` from `app.listen()` and returns it (typed `: Server`) instead of the express app — which nothing consumed.
- **`src/index.ts`** keeps the running listener in a module-scope `httpServer` (set only in http mode) and `shutdown()` now drains it: `closeIdleConnections()` to release idle keep-alive sockets, then `server.close()` to stop accepting and wait for in-flight requests, then `closeDatabase()` + exit. A `SHUTDOWN_TIMEOUT_MS` (10s, `unref`'d) backstop forces exit if a connection never closes, so we never hang past Railway's grace window. Stdio mode is unchanged (no listener → synchronous exit).

### Verified
Started the http transport, confirmed `/health`, sent SIGTERM: process exited **0** (was 143 = killed) with the `[SHUTDOWN]` drain sequence logged and the timeout backstop not triggered. No DB rebuild, no `.skill` change.

## [2.7.4] - 2026-06-11

Fixed the four P1 findings from the v2.7.3 whole-codebase review (`CODE-REVIEW-FINDINGS.md`): one hard-failure edge case, two silent-wrong-answer bugs, and one contradictory tool description. No database rebuild; no `.skill` change.

### Fixed
- **`retrieve_document` / `navigate` no longer error when an upstream page lacks a license** (finding 1). `getDocument` mapped `license: metadata.comment` unconditionally, but both output schemas declared `license` as a **required** string — with `STRUCTURED_CONTENT` on (the default), the SDK validates `structuredContent` against the schema, so a page whose annotation metadata omits `comment` produced `license: undefined` → a zod required-string failure → the whole tool call errored instead of returning the transcription. `license` is now `.optional()` in `getDocumentOutputSchema` (`document.ts`) and `navigateOutputSchema` (`convenience.ts`), `PageMetadata.comment` is `optional` in `types.ts`, and a shared `normalizeLicense()` helper (`document.ts`, reused by `document-viewer.ts`) handles the field one way everywhere — guarding the missing case **and** stripping the `"license: "` prefix. *Output-format note:* `retrieve_document`/`navigate` now return the bare license value (e.g. `"CC-BY-4.0"`) instead of the raw `"license: CC-BY-4.0"`, matching what the viewer already did.
- **Folio filters no longer silently dropped; GM rows no longer returned unfiltered** (finding 2). `folioFrom`/`folioTo` sat inside `if (input.inventoryNumber)`, so a folio range without an inventory was discarded and *every* matching document returned as if filtered, with no flag. Folio now (a) throws a `ToolError` when given without an `inventoryNumber`, and (b) is treated as an **OBP-only** filter exactly like `settlement`: on `source:"all"` the GM source is skipped with an explanatory `note`; on `source:"gm"` it throws. This removes the previous behavior where `source:"all"` + a folio range returned folio-filtered OBP rows mixed with unfiltered GM rows in one response. (GM carries folio columns but is documented "OBP only"; per the project's Editorial-Decisions rule, applying folio to GM was offered and **not** chosen — the documented scope is unchanged.)
- **matchAll aggregations now describe the result set, not the candidate pool** (finding 3). In matchAll mode the upstream query filters on a single language and ES computes `aggregations` over that population, but `results`/`total` are post-filtered to pages carrying ALL requested languages — so the returned aggregations described a different, usually far larger, population (e.g. all Malay-tagged hits) with nothing in `note`. Aggregations are now recomputed client-side over the post-filtered matched set (`aggregateResults()` in `search.ts`), so `total`, `results`, and `aggregations` describe the same pages; the upstream aggregations are no longer requested in matchAll mode; and the `note` says aggregations describe the matching pages within the scanned window.
- **`globalise_find_archival_documents` description no longer ships a contradictory FTS contract** (finding 4). The registration in `index.ts` still documented the pre-v2.7.3 sanitizer ("Unparseable characters … trigger a phrase-escape retry that sets a response note"), contradicting the schema describe's correct v2.7.3 auto-quote contract — a model reading it would pre-quote or split queries to dodge a collapse that no longer happens. Rewritten to match the schema describe (special-character terms auto-quoted, operators preserved; only genuinely unparseable input falls back). Doc-only.

## [2.7.3] - 2026-06-11

Made the FTS5 query sanitizer preserve boolean operators instead of silently dropping them. Raw input with special characters (hyphens, slashes, apostrophes) makes SQLite's FTS5 **query parser** — not the tokenizer — throw a syntax error, because a bareword may only contain letters/digits/underscore/non-ASCII (https://sqlite.org/fts5.html#fts5_strings). The old fallback wrapped the *entire* query in double quotes as one phrase, which collapsed `peper OR oost-indie` into the literal phrase "peper or oost indie" and returned **0** — a silent false-negative. Measured against the live 227K-row OBP index: lone punctuated terms (`oost-indie`, `'s-gravenhage`) were already fine via the whole-wrap, but any punctuated term *combined with an operator* misfired (`peper OR oost-indie`: 0 → 984; `oost-indie*`: 3 → 16; `oost-indie OR west-indie`: 0 → 3). Query-side fix only — **no database rebuild**, shared by both `find_archival_documents` and `lookup_commodity`.

### Changed
- **`src/utils/fts.ts`** — new `escapeFtsTerms()`, a left-to-right scanner that quotes *only* the individual barewords containing illegal characters while leaving query structure intact: grouping `()`, existing `"phrases"`, the `AND`/`OR`/`NOT`/`NEAR` operators, and a trailing prefix `*` (peeled outside the quotes, so `oost-indie*` → `"oost-indie"*` keeps prefix search). `sanitizeFtsQuery()` now tries the raw query (preserving full power-user syntax) → per-term quoting (operators preserved) → whole-phrase wrap (last resort, note says operators were dropped) → structured error. Distinct `note` wording per path.
- **Tool descriptions** (`archival-index.ts`, `commodities.ts`) — replaced the "server silently drops your operators, quote the term yourself" warning with the new contract: special-character terms are auto-quoted and operators are kept; only genuinely unparseable input (unbalanced quotes/parens, or an operator omitted before a `(group)`) falls back to a whole-phrase search, flagged in the `note`. Updated the commodities output-`note` example.
- **Tests** — new `scripts/test-fts.ts` (24 pure-function assertions on `escapeFtsTerms`, wired into `npm test` as `test:fts`); strengthened `test-archival-index.ts` §3 to assert operators survive end-to-end against the live index; fixed the stale `'exact phrase'` note assertions in the archival and commodities suites.
- **Skill + docs** — rewrote the `globalise-voc-research` SKILL.md "Trap 2" to the new contract (special-character terms are auto-quoted, operators kept; only unbalanced quotes/parens or a missing operator before a group fall back), updated the response-`note` checklist item, and repackaged `globalise-voc-research.skill`. Documented the `.skill` rebuild command in CLAUDE.md (it previously had none).

### Known limitation
FTS5 rejects implicit-AND before a parenthesized group (`compagnie (a OR b)`) even when correctly quoted — its own grammar requires an explicit operator (`compagnie AND (a OR b)`). The escaper does not synthesize the missing `AND` (doing so risks mangling `NEAR(...)` and changing semantics); such input safely falls back to the whole-phrase wrap with a note. Explicit-operator grouping is reconstructed faithfully.

## [2.7.2] - 2026-06-11

Refined the `globalise_lookup_commodity` guidance (tool description + research skill) after evaluating eight test prompts across Sonnet/Opus/Fable. No code-logic change — only the tool's description string and the skill content. Driven by one verified data fact: **`altLabels` (period spelling variants) exist for only ~9.6% of the 3,508 concepts** — pepper, coffee, and nutmeg have none — so the prior "main use is query expansion via altLabels" framing oversold a feature that's mostly absent.

### Changed
- **Tool description (`src/index.ts`)** reframed: the reliable value is (1) bilingual label resolution (modern/English → the Dutch term the corpus uses) and (2) a sourced, confidence-rated definition; `altLabels` is a bonus present for ~10% of concepts. For transcription recall, take the Dutch label, OR in any altLabels, then add fuzzy (`~1`)/wildcards (the corpus prefers `c-` over `k-`, `-ij` over `-ie`: `koffie`→`coffij`). Added: present low-confidence/LLM definitions tentatively and **say only what the definition states**; `prefLabelEn` is occasionally a mistranslation, so **prefer the definition**.
- **Skill (`skills/globalise-voc-research/SKILL.md`)** "Expanding commodity terms" section rewritten as "Looking up commodities": inverts the emphasis (label resolution + definition as core; period-spelling reconstruction + fuzzy as the recall engine; altLabels a bonus, rich for silk/`zijde`'s 23 variants, null for most). Adds explicit, imperative handling of the empty-`altLabels` case; keeps source/confidence visible even in lists; flags model inference vs. source-stated facts; prefers the definition over a possibly-mistranslated English label; expands source codes (WNT/AAT/vocGlossarium/PoolParty) for readers; notes the embedded citation cruft in some definitions. Tool table row, workflow note, worked pattern, and do/don'ts updated to match. Repackaged `globalise-voc-research.skill`.

### Why
Evaluation findings: the prior framing's flagship examples (`pepper→peper/piper`, `coffee→coffij/coffie/kofij`) have **null** `altLabels` and would fail as written; the model correctly found "no altLabels" and (on a weaker model) then bet on a single spelling. The recall *numbers* in the skill (`koffie` 119 vs `coffij` 25,124 pages) are live-confirmed and retained — only the mechanism attribution was corrected. The source `.trig` was checked and carries no additional SKOS labels, so this is a documentation fix, not a data fix.

## [2.7.1] - 2026-06-11

Internal cleanup pass (`/simplify`) over the v2.7.0 commodities tool — no behavior change; all tool inputs, outputs, and the response contract are identical (full test suite + end-to-end smoke test green).

### Changed
- **FTS5 query sanitation deduplicated.** `src/tools/commodities.ts` had a near-verbatim copy of the archival tool's probe-then-phrase-escape-with-`note` recovery (same `note` wording, same `ToolError` suggestion); the copies had already drifted (commodities re-prepared the probe every call). Extracted to a shared `src/utils/fts.ts` `sanitizeFtsQuery(probe, query)` that takes an already-prepared probe statement, so each tool keeps its own FTS table and its own per-connection caching. Both `archival-index.ts` and `commodities.ts` now call it.
- **Per-call work in `lookupCommodity` removed.** Every call ran `SELECT COUNT(*) FROM commodities` (a constant for a read-only DB) and re-prepared the FTS probe; the no-query path ran that same COUNT a *second* time for `total`. Added a per-connection static-state cache (`commoditiesTotal` + `ftsProbe`, keyed by the db handle) mirroring `getStaticDbState` in `archival-index.ts`; the no-query `total` now reuses the cached glossary size instead of a redundant COUNT.
- **`lookupCommodity` simplified.** Dropped the `notes: string[]` accumulator (it only ever held one note — copied from the archival tool where it holds three) in favor of a single `note`, and folded the `ftsQuery` resolve-then-branch into one branch on `input.query`.

## [2.7.0] - 2026-06-11

New tool **`globalise_lookup_commodity`**: a flat-glossary lookup over the VOC commodities thesaurus — 3,508 trade goods and trade-related concepts with bilingual Dutch/English labels, period spelling variants, and a sourced, confidence-rated definition per concept. This reimplements the commodities reference (an MCP *resource* removed in v1.17.0, `globalise://reference/commodities`) as the on-demand SQLite-backed tool the TODO planned — now enriched far beyond the archived "minimal" thesaurus (labels + hierarchy only) with definitions and provenance. Primary use is **query expansion**: the transcription search is spelling-blind, so the returned `altLabels` (period variants) feed back into `globalise_search_transcriptions` to surface documents a single spelling misses. Ships a new `data/reference.sqlite` (a small reference-vocabularies DB kept separate from the large archival index), committed as a ~1 MB `.gz` and decompressed at build like the archival DB. Minor bump for the new tool; no change to existing tools.

### Added
- **`globalise_lookup_commodity`** (`src/tools/commodities.ts`, registered in `src/index.ts`). Inputs: `query` (FTS5 over labels + variants + definitions, bm25-weighted so label/variant hits outrank definition-body hits; omit to page the glossary alphabetically), `from`/`size`. Output per concept: `prefLabelNl`, `prefLabelEn`, `altLabels[]`, `definition`, `definitionLanguage`, `definitionSource`, `definitionSourceDescription`, `confidence`, `definitionSourceUrl`; plus `pagination` and `databaseInfo`. Reuses the archival tool's FTS5 phrase-escape-with-`note` recovery for hostile input (hyphens, unbalanced quotes).
- **Reference database** `data/reference.sqlite` (+ committed `.gz`): a `commodities` table and a `commodities_fts` FTS5 index. Built by `scripts/build-commodities-db.ts` (`npm run build:db:commodities`) from one committed source, `data/sources/commodities.tsv`.
- **DB layer** (`src/utils/database.ts`): `getReferenceDatabase()` / `isReferenceDatabaseAvailable()` / `getReferenceDatabasePath()` (lazy, read-only, mirroring the archival accessors); `closeDatabase()` now closes both connections. `npm run ensure:db` now materializes both DBs via the new `scripts/ensure-reference-db.ts`.
- **Tests** `scripts/test-commodities.ts` (`npm run test:commodities`, 6 sections); the smoke test now expects 6 tools and exercises a live `globalise_lookup_commodity` call.

### Editorial decisions (per the Editorial Decisions rule)
- **The glossary ships flat — both candidate classifications were dropped.** The source offered two: an LLM-assigned `class` column (26 buckets) and a SKOS `skos:broader` hierarchy. Both were judged too unreliable to surface. The SKOS tree is hollow — its top concept "NOT YET CLASSIFIED" holds 2,275 of 3,508 concepts (65%) as direct children, and the meaningful 35% uses an abstract SITC trade-statistics scheme (a poor fit for a fuzzy historical vocabulary). The LLM `class` has full coverage but misclassifies (e.g. "fire engine" → textile). A misleading taxonomy is worse than none, so neither is surfaced or stored: no `class` filter/facet, no `broaderLabel` field. The abandoned `class`/`class_Source` columns were also removed from the committed `commodities.tsv` (the full original remains in the gitignored `offline/` tree).
- **Provenance + confidence surfaced, not hidden.** Over half the definitions are LLM-generated (`llm`/`llm_sparse`) and ~31% are low/medium-low confidence; `definitionSource` and `confidence` are returned on every result, and the tool description directs tentative presentation of low-confidence/LLM definitions and preference for the authoritative sources (`wnt`, `aat`, `vocGlossarium`, `PoolParty`).
- **Concept UUIDs kept internal.** The PoolParty `id` URIs are not publicly resolvable, so they are an internal key only and never returned.

### Source
- VOC Commodities Thesaurus, GLOBALISE Project (Huygens Institute), CC-BY-SA-4.0, hdl:10622/YAWDOV. The consolidated/enriched TSV and the SKOS `.trig` export live under the gitignored `offline/` tree; the build's committed input is `data/sources/commodities.tsv`.
- The `definitionSource` value `poolparty` is normalized to `PoolParty` (the product name, poolparty.biz) in the committed TSV; the `digitaalerfgoed.poolparty.biz` `id` URLs and all other source tokens are left untouched.

## [2.6.1] - 2026-06-11

Description and skill refinements to the v2.6.0 `publishedEdition` links, prompted by a nine-prompt live MCP-client test pass against beta. No output-schema, behavior, or data change — `.describe()` strings and the `globalise-voc-research` skill only; the server's responses are byte-for-byte identical to v2.6.0. Provenance added to the skill is grounded in the offline dataset resources (`_OVERVIEW.md`, `GITHUB_RGP_TRANSCRIPTIONS.md`; dataset by Kay Pepping, DOI hdl:10622/BHKMWE) plus a corroborating web check, not invented.

### Changed
- **`publishedEdition` field descriptions** (`src/tools/archival-index.ts`):
  - `githubPageUrl` now states plainly it is the missive's **first page only** (keyed by `rgp_page`, no offset) — *not* the whole letter; longer letters continue onto following pages, so use `githubVolumeUrl` for the complete text. (A test client had framed the per-page link as the entire letter.)
  - The `publishedEdition` object description anchors the target as "the scholarly Generale Missiven series (Rijks Geschiedkundige Publicatiën), a selective, edited text distinct from the HTR transcription," and refines the null note to "not published in the RGP edition **in this form**" (per the dataset's column definition — a different copy of the same missive may still appear in RGP).
- **`globalise-voc-research` skill** (`skills/globalise-voc-research/SKILL.md`):
  - Corrected the now-stale claim that "the tool gives the citation, not a link" (v2.6.0 added the links).
  - New **"The RGP published edition links"** subsection: the three link types (page-scan / first-page text / full-volume text) with plain-label guidance, the page-vs-letter nuance, the edited-RGP-edition-vs-HTR-original distinction with verified provenance (RGP Grote Serie, 14 vols., 1610–1767, begun by W. Ph. Coolhaas; GitHub repo = original-letter text only with editorial apparatus stripped, CC BY-NC-SA 4.0, Text Fabric/CLARIAH), an anti-embellishment guard, and a link-only/no-inline-fetch note.
  - GM field inventory and the do/don't list updated to mention `publishedEdition`.

## [2.6.0] - 2026-06-11

Adds clickable published-edition links to Generale Missiven results. The 558 GM letters with an RGP (Rijks Geschiedkundige Publicatiën) edition now carry a `publishedEdition` object pointing at the Retroboeken interactive viewer and the GitHub plain-text transcriptions — turning the raw `rgpVolume`/`rgpPage` fields (already surfaced) into usable URLs. Pure URL construction from data already in the DB: no DB rebuild, no network calls, no new dependencies, and the server never fetches or caches the edition text (link-only; GitHub repo is CC BY-NC-SA 4.0). Minor bump for the new output field. URL templates re-verified live (HTTP 200) and against the DB on 2026-06-11.

### Added
- **`publishedEdition` on GM results** (`src/tools/archival-index.ts`). A nested object on each Generale Missive, or `null` when the missive was not published in RGP (~41% are not). Fields:
  - `retroboekenUrl` — Retroboeken viewer (`#source={vol}&page={rgp_page + offset}&view=imagePane`) at the missive's start page; page-precise via a per-volume front-matter offset (all 14 verified). `null` when `rgp_page` is missing.
  - `githubPageUrl` — raw GitHub per-page transcription `txt/GM{vol}/{vol}_{rgp_page}.txt`, keyed **directly** by `rgp_page` with no offset (front matter is stripped, so arabic page 1 = first letter page). `null` when `rgp_page` is missing.
  - `githubVolumeUrl` — raw GitHub full-volume transcription `full_volumes/GM_{vol}.txt`. Needs only the volume, so it is always present when `publishedEdition` exists — including the one row (inv 3066) that has a volume but a null page.
- The `globalise_find_archival_documents` tool description now mentions the published-edition links in its GM clause (`src/index.ts`).
- Test section 6 in `scripts/test-archival-index.ts` (11 assertions): URL/offset correctness for a known row, multi-page `rgp_page` first-page extraction, the volume-only row, and `publishedEdition === null` for an unpublished missive.

### Editorial decisions (per the Editorial Decisions rule)
- **Retroboeken default view is `imagePane`** (page scans), not `htmlPane` (OCR text). The user can flip the pane in the Retroboeken UI; `imagePane` is the landing view for citation-grade visual fidelity.
- **GitHub links surfaced: per-page + full-volume only.** TSV (`GM{vol}.tsv`) is deliberately excluded — its `File` column is a chunk id, not a page number, so it cannot anchor a letter.
- **Multi-page `rgp_page` values** (14 rows, e.g. `"172;173"`, `"350-1"`) use the **first** page; `parseInt` reads the leading integer in every form. The per-page file is the missive's *first* page; long letters spill onto following pages (use the full-volume link for the whole letter).
- **Full-volume blob `#L{line}` deep-link index deferred** — the per-page `.txt` is already letter-precise; the `rgp_page→line` index (a build-time scan of ~25.6 MB plus a new column) is marginal and left as a future enhancement.

## [2.5.5] - 2026-06-11

Tool-description correctness pass on `globalise_find_archival_documents` and `globalise_search_transcriptions`, prompted by reviewing the `globalise-voc-research` skill against the always-loaded tool descriptions. Two of the four fixes correct descriptions that were independently *wrong/misleading* on their own — a skill-less client (the common case) was getting a defective contract and silently wrong results. No runtime/output/behavior change: these are `.describe()` strings and tool-description prose only; the schemas' types and the server's responses are byte-for-byte identical. All facts verified against `data/archival-index.sqlite`.

### Changed
- **`settlement` example no longer returns zero** (`src/tools/archival-index.ts`). The schema offered `"Malacca"` as a sample value, but `settlement='Malacca'` matches **0** rows — the canonical form is `"Malakka"` (6,967). Settlement spellings are normalized to one unpredictable canonical form per place (`Ceylon` not the period `Ceijlon`; `Malakka` not `Malacca`), so the describe now says to run once with `includeAggregations` and copy the exact value, and the examples use working spellings.
- **`htrAvailable` describe no longer claims "has transcriptions"** (`src/tools/archival-index.ts`). It read "Filter for letters with HTR transcriptions available", but the flag mirrors the IJsberg sub-project and is effectively `chamber=Zeeland` (all 70 Zeeland letters true, all 880 Amsterdam false), while many Amsterdam inventories *are* transcribed. Filtering `htrAvailable=true` to find readable letters was actively wrong; the describe now states what the flag means and points to probing `search_transcriptions` instead.
- **Search operators now document the bare-space default** (`src/tools/search.ts`, `src/index.ts`). `search_transcriptions` (Elasticsearch) treats a space as **OR**; `find_archival_documents` (SQLite FTS5) treats a space as **AND** — opposite defaults across the two search tools, previously documented in neither tool description (only in the skill). An agent assuming the usual space=AND silently changed recall. Both descriptions now state their space semantics and flag the contrast.
- **FTS5 phrase-escape retry is now documented** (`src/tools/archival-index.ts`, `src/index.ts`). When `find_archival_documents.query` contains characters FTS5 can't parse (hyphens, slashes, unbalanced quotes/parens), the server retries the whole query as one quoted phrase and adds a `note` — silently dropping operators. The describe now tells callers to quote the offending term (e.g. `kaneel AND "oost-indie"`) and check the response `note`.

## [2.5.4] - 2026-06-10

`mcp-builder` review consistency pass — three findings on `globalise_view_document_ui` and `globalise_search_transcriptions`. No change to normal-path output or server behavior; the viewer's `structuredContent` and the search results are byte-for-byte the same. UI bundle unaffected (no viewer-side code changed).

### Changed
- **`globalise_view_document_ui` now declares an `outputSchema`** (`src/tools/document-viewer.ts`, `src/index.ts`). It was the only tool emitting `structuredContent` (the iframe reads it, R19) without a declared/validated output schema — `ViewDocumentUiOutput` was a bare TS `interface`, so the viewer's data contract was validated nowhere and a handler-shape regression would have shipped silently. Replaced the `ViewDocumentUiOutput` and `ArchivalContext` interfaces with Zod schemas (`viewDocumentUiOutputSchema`, `archivalContextSchema`) and derive the types via `z.infer`, making the schema the single source of truth. The schema is registered as `outputSchema` only behind the `STRUCTURED_CONTENT_ENABLED` gate, matching `registerJsonTool` — once an `outputSchema` is set the SDK requires a matching `structuredContent` on every non-error result, which the `STRUCTURED_CONTENT=false` branch does not emit.
- **`globalise_view_document_ui` input schema is now `.strict()`** (`src/index.ts`). The four data tools derive `.strict()` input variants so unknown params are rejected, not silently stripped; the viewer passed `viewDocumentUiInputSchema.shape` directly, which the SDK rebuilds as a non-strict `z.object()`. Now passes the strict schema value (forwarded verbatim to `registerTool`, which honors `.strict()`); typed via a compile-time cast to a raw shape because `registerAppTool`'s generics infer `InputArgs` from both the schema value and the `ToolCallback` arg, and a full `ZodObject` collides with the `ZodRawShapeCompat` arm of the union constraint — the same wrapper friction `registerJsonTool` already casts around.
- **`globalise_search_transcriptions` `sortBy` is now `z.enum(['_score', 'document', 'invNr'])`** (`src/tools/search.ts`), previously a free `z.string()` with the valid values documented only in prose. Because `.strict()` guards keys not values, an invalid `sortBy` passed validation and was forwarded upstream; the enum rejects it at the schema and self-documents — matching how `sortOrder`, `direction`, and `source` are already typed. The three values are unchanged, so every valid existing call behaves identically.

## [2.5.3] - 2026-06-10

Document Viewer fix — the interactive viewer now loads in Safari (chatgpt.com in Safari, and any Safari/WebKit MCP Apps host). No API, output, or server-behavior change; UI bundle (`dist/apps/index.html`) rebuilt.

### Fixed
- **Document Viewer hung on "Fetching document" in Safari** (`apps/document-viewer/src/viewer.ts`). The view advertised the MCP Apps `tools` capability (`{ tools: { listChanged: false } }`) despite never calling `app.registerTool()` — it exposes no app-side tools. A spec-conformant host that sees `appCapabilities.tools` issues a `tools/list` request to the view, which the ext-apps SDK answers with a "No handler for method tools/list registered" error. On Safari that stray error round-trip races the `ui/initialize` handshake and suppresses delivery of the `ontoolresult` notification: the viewer received the tool *input* (showed "Fetching document: …") but never the *result*, leaving it on the spinner forever. Chrome and the native ChatGPT app interleave the messages survivably, which is why it reproduced only on Safari. The tool itself ran and returned correctly throughout — this was purely a widget-side handshake bug. Fix: declare only the capability the view actually implements — `{ availableDisplayModes: ['inline', 'fullscreen'] }` (the view handles host `displayMode` changes, including fullscreen). Matches the resolution the sibling `rijksmuseum-mcp-plus` artwork viewer adopted for the same issue.

## [2.5.2] - 2026-06-10

Database performance pass — no API, output, or behavior change; the deploy artifact (`data/archival-index.sqlite.gz`) is rebuilt (24.5 → 25.8 MB).

### Changed
- **Added `idx_obp_sort` on `obp_documents(year_earliest, inventory_number, folio_start)`** (`scripts/build-archival-db.ts`). This tuple is the default result `ORDER BY` for every OBP page (`src/tools/archival-index.ts`), and no existing index covered it — so each call did a full-table `SCAN` + `USE TEMP B-TREE FOR ORDER BY`, materializing and sorting all 227,526 rows to return one page. Measured in-engine (avg of 200 runs, M4): the default call (`from=0`) drops **45.2 ms → 0.08 ms** (~560×), and deep pagination (`from=200000`) drops **456 ms → 4.4 ms** (~100×). This matters disproportionately because `node:sqlite` is synchronous: the old sort blocked the Node event loop, stalling all concurrent requests for its duration. The new plan is `SCAN obp_documents USING INDEX idx_obp_sort` with no temp sort. Verified not to regress selective filters — `settlement=` and FTS queries still prefer their own indexes. Index cost: ~4 MB in the DB, ~1.8 MB in the `.gz`.
- **Added `PRAGMA mmap_size = 268435456` (256 MB) to the read-only DB connection** (`src/utils/database.ts`). Memory-maps the ~108 MB DB so cold-page reads skip `read()` syscalls. Safe on a read-only connection; joins the existing `cache_size` / `temp_store` pragmas.
- **Dropped `AUTOINCREMENT` from both table primary keys** (`scripts/build-archival-db.ts`) — now plain `INTEGER PRIMARY KEY` (rowid alias). The DB is built once and never deletes rows, so AUTOINCREMENT's monotonic-after-delete guarantee was irrelevant; it only added `sqlite_sequence` bookkeeping. `content_rowid='id'` on the FTS5 tables still aliases rowid, so FTS is unaffected. Full `test:archival` suite (FTS5 incl. phrase-escape rescue, filters, OBP→GM pagination boundary, cached aggregations) green against the rebuilt DB.

## [2.5.1] - 2026-06-10

Post-v2.5.0 cleanup from two `/simplify` passes — no behavior change except one latent-crash fix.

### Fixed
- **`globalise_retrieve_document` could crash on pages with no language metadata** — the same class of bug as the v2.3.1 search fix. `getDocument` mapped `metadata.lang.map(...)` unguarded (`src/tools/document.ts`), so any page where upstream omits `lang` would throw `Cannot read properties of undefined (reading 'map')`. Now routed through the shared `mapPageLanguages()` helper, which guards and yields `languages: []`. Its sibling `globalise_view_document_ui` already guarded this case; the guard is now uniform across both retrieval paths.

### Changed
- **Consolidated the page-language `{ code, label }` shape and its mappers into `src/utils/languages.ts`.** The shape had been hand-declared five times (Zod schemas in `search.ts` ×2, `document.ts`, `convenience.ts`; a TS type in `document-viewer.ts`) and the upstream→output mapping existed three times with inconsistent null-guarding. Now there is one `languageSchema` (with `type Language = z.infer<…>` as the single source of truth), one `mapPageLanguages(lang?)` for document metadata's `{ iso, label }[]` object-array shape, and one `zipLanguages(langIso?, langLabel?)` for search's parallel `langIso[]`/`langLabel[]` arrays. The guard lives inside the helpers, so a new consumer cannot reintroduce the unguarded crash. Net −31/+12 lines across the four consumers; typecheck and full test suite green.
- **Centralized the `node:sqlite` driver types behind the `database.ts` wrapper.** `src/utils/database.ts` now exports `Db` / `DbStatement` type aliases; `src/tools/archival-index.ts` consumes them instead of importing `StatementSync` directly from `node:sqlite`, so the concrete driver is named in exactly one runtime file and a future driver swap stays a one-file change. Also converted the lone `interface WhereClause` to `type` for intra-file consistency. No runtime change.

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
