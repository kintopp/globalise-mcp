# Code Review Findings — 2026-06-11

Whole-codebase review (no diff scope) at v2.7.3 on `worktree-p0-refactor`, run as
7 finder angles (correctness ×3, reuse, simplification, efficiency, altitude)
over ~38 deduplicated candidates, each independently verified against the source
(and where possible empirically, e.g. against the live FTS5 index). 4 candidates
were refuted with hard evidence (§ Refuted, kept to prevent re-flagging).

Line numbers are as of commit `ca4c49e` (v2.7.3). All paths relative to
`globalise-mcp-server/`.

**Status legend:** `[ ]` open · `[x]` fixed (note version) · `[-]` won't fix (note why)

---

## P1 — Silent wrong answers or hard failures

### [x] 1. `retrieve_document`/`navigate` fail entirely when upstream metadata lacks `comment` — fixed v2.7.4

> **Fixed v2.7.4:** `license` is `.optional()` in `getDocumentOutputSchema` and
> `navigateOutputSchema`; `PageMetadata.comment` is optional in `types.ts`; new
> shared `normalizeLicense()` in `document.ts` (reused by `document-viewer.ts`)
> guards the missing case and strips the `'license: '` prefix in both places.


- **Severity:** medium-high (whole tool call errors instead of returning the transcription)
- **Where:** `src/tools/document.ts:117` (mapping), `src/tools/document.ts:34` (schema), `src/tools/convenience.ts:49` (duplicated schema)
- **Bug:** `getDocument` maps `license: metadata.comment` unconditionally, but the
  output schema declares `license: z.string()` **non-optional** (same in
  `navigateOutputSchema`). `STRUCTURED_CONTENT` is on by default
  (`src/index.ts:90`, `process.env.STRUCTURED_CONTENT !== 'false'`) and the SDK
  validates `structuredContent` against `outputSchema` on every non-error result
  — so one upstream page whose annotation metadata lacks `comment` →
  `license: undefined` → zod required-string failure → the entire call errors.
- **Evidence the field is untrusted elsewhere:** `src/tools/document-viewer.ts:61`
  declares the *same* upstream field `z.string().optional()` and guards with
  `metadata?.comment?.replace('license: ', '') || undefined` at `:185`.
  `document.ts` also skips that `'license: '` prefix-strip, so even present
  values are returned unnormalized — divergent handling of one upstream field.
- **Caveat:** `src/utils/types.ts:91` types `PageMetadata.comment` as required,
  so a comment-less page is hypothesized, not demonstrated in the corpus. The
  viewer's defensive code suggests the contract isn't trusted.
- **Fix sketch:** make `license` `.optional()` in both output schemas (document.ts
  and convenience.ts), guard the mapping like the viewer does, and apply the same
  `'license: '` normalization in both places (or extract one shared mapper).
  Consider auditing the other unconditionally-trusted metadata fields
  (`created`, `lastChange`, `creator`) at the same time.

### [x] 2. folioFrom/folioTo silently dropped without inventoryNumber; GM rows never folio-filtered — fixed v2.7.4

> **Fixed v2.7.4:** folio now throws a `ToolError` when given without an
> `inventoryNumber`, and is treated as an **OBP-only filter like settlement**
> (chosen by the user over "apply to GM too" / "keep+note", per the Editorial
> rule): `source:'all'`+folio skips GM with a note, `source:'gm'`+folio throws.
> `hasObpOnlyFilters` now includes folio; the incompatible-filter and skip-note
> messages were generalized. `buildObpWhereClause`/`buildGmWhereClause` are
> unchanged — the new top-of-function guard guarantees folio ⇒ inventoryNumber.


- **Severity:** medium (unfiltered results presented as filtered, no flag; found independently by 3 review angles)
- **Where:** `src/tools/archival-index.ts:239-248` (`buildObpWhereClause`), `:256-270` (`buildGmWhereClause`), contrast `:464-507` (the R7 settlement/chamber treatment)
- **Bug:** both folio conditions sit inside `if (input.inventoryNumber)`, so
  `{settlement:'Batavia', folioFrom:100, folioTo:200}` without an inventory
  returns **every** Batavia document with total unchanged — no `note`, no
  `ToolError`. The only enforcement is the schema-describe prose
  "(OBP only, requires inventoryNumber)". Additionally `buildGmWhereClause` has
  no folio conditions at all even though `GmDbRow` carries
  `folio_start`/`folio_end` — so `source:'all'` + a GM inventory + folio range
  returns folio-filtered OBP rows mixed with unfiltered GM rows in one response.
- **Fix sketch:** apply the existing R7 pattern from the same function: throw a
  `ToolError` ("folioFrom/folioTo require inventoryNumber") or push a `note` when
  folio params arrive without inventoryNumber; and either add folio conditions to
  `buildGmWhereClause` or push a note that GM ignores the folio filter.

### [x] 3. matchAll aggregations describe a different population than the results — fixed v2.7.4

> **Fixed v2.7.4:** chose option (b) — aggregations are recomputed client-side
> over the post-filtered `matched` set via new `aggregateResults()` in
> `search.ts`, so `total`/`results`/`aggregations` describe the same pages.
> Upstream aggregations are no longer requested in matchAll mode
> (`includeAggregations: !useMatchAll`), and the `note` now states the
> aggregations describe the matching pages within the scanned window.


- **Severity:** medium (model cites statistics that don't describe the result set)
- **Where:** `src/tools/search.ts:260-262` (single-language upstream filter), `:264-274` (the one upstream call producing aggregations), `:282-290` (post-filtered results/total), `:292` (passthrough), `:298` (note covers only the scan cap)
- **Bug:** in matchAll mode the upstream query filters on only
  `[languages.find(code => code !== 'nld') ?? languages[0]]` (ONE language) over
  the capped candidate window; ES computes the returned `aggregations` over that
  population. `results`/`total` are then post-filtered to pages matching ALL
  requested languages. Example: `{languages:['Dutch','Malay'], matchAll:true}`
  returns N bilingual pages alongside a `languages`/`topInventoryNumbers`
  aggregation computed over **all Malay-tagged hits** (orders of magnitude
  larger, including pages with no Dutch). Nothing in `note` mentions it.
- **Fix sketch (pick one):** (a) omit `aggregations` in matchAll mode; (b) recompute
  the aggregations client-side over the post-filtered `matched` set (it's already
  in memory); (c) at minimum extend the matchAll `note` to state the aggregations
  describe the single-language candidate pool, not the matchAll result set.

### [x] 4. `index.ts` tool description still documents the pre-v2.7.3 FTS sanitizer contract — fixed v2.7.4

> **Fixed v2.7.4:** the `find_archival_documents` registration paragraph in
> `index.ts` was rewritten to the v2.7.3 auto-quote contract, matching
> `archival-index.ts:16`. The commodities registration/describe were left as-is
> (they never advertised the old retry contract or `(group)` syntax, so no
> contradiction); the structural single-sourcing is still tracked as finding 16.


- **Severity:** medium (two contradictory contracts shipped to the client; 5-minute fix)
- **Where:** `src/index.ts:445` (find_archival_documents registration description) vs `src/tools/archival-index.ts:16` (input-schema describe)
- **Bug:** the registration still says *"Unparseable characters (hyphens,
  slashes) trigger a phrase-escape retry that sets a response note"* (the
  pre-v2.7.3 whole-input-collapse contract), while the schema describe correctly
  documents the v2.7.3 behavior (*"auto-quoted for you while your AND/OR/NOT
  operators are kept intact"*, note only on a genuine FTS5 parse failure). A
  model reading the registration will pre-quote or split `peper OR oost-indie`
  into multiple calls to dodge a collapse that no longer happens.
- **Related drift (fix together):** `src/tools/commodities.ts:35` describe omits
  the implicit-AND-before-`(group)` caveat that `archival-index.ts:16` documents,
  though both call the same `sanitizeFtsQuery`. (Mitigated: commodities' describe
  never advertises `(expr)` grouping.) The same contract also lives in the
  commodities registration in `index.ts` and in `SKILL.md` — check all prose
  sites when touching `src/utils/fts.ts` (see finding 16).
- **Fix sketch:** rewrite the `index.ts:445` paragraph to match
  `archival-index.ts:16`; add the group-caveat sentence to commodities' describe
  (or drop grouping claims there entirely). Doc-only — but per Version Management
  rules still needs a version bump. Remember the `.skill` repackage if SKILL.md
  is touched.

---

## P2 — Operational (bite under deploys / concurrency)

### [ ] 5. SIGTERM/SIGINT shutdown never closes or drains the HTTP listener

- **Severity:** medium (every Railway redeploy cuts in-flight requests)
- **Where:** `src/index.ts:564-568` (`shutdown()`), `src/transports/http-server.ts:123-135` (the `app.listen()` return value is **discarded**, so no server handle even exists to close)
- **Bug:** `shutdown()` is `closeDatabase(); process.exit(0);` — in-flight `/mcp`
  requests (e.g. awaiting an upstream search fetch) are cut mid-response, and the
  socket keeps accepting new connections right up to exit. Note: the
  "handler resumes between closeDatabase() and exit()" variant is NOT possible
  (the two statements are synchronous, no event-loop turn interleaves).
- **Fix sketch:** have `createHttpServer` return the `http.Server` from
  `app.listen()`; in `shutdown()`, `server.close()` (stops accepting, drains
  keep-alives via `closeIdleConnections()`), await with a ~5-10s timeout
  (Railway's grace period), then `closeDatabase()` and exit. Stdio mode keeps the
  current synchronous path.

### [ ] 6. Archival query path executes the identical FTS5 MATCH up to 8× per call and re-prepares every statement

- **Severity:** medium (synchronous node:sqlite blocks the event loop per redundant scan; multiplies under concurrent HTTP users)
- **Where:** `src/tools/archival-index.ts` — sanitizer probe via `:493`, OBP COUNT `:528`, OBP SELECT `:536`, GM COUNT `:549`, GM SELECT `:562`, plus 3 aggregation GROUP BYs `:417/:424/:438` (default `includeAggregations:true`)
- **Bug:** with a query and `source:'all'`, the same MATCH runs in up to 8
  statements; only `ftsProbe` is cached in `getStaticDbState` — every other
  statement is `db.prepare()`d inline per call. Broad terms matching tens of
  thousands of the 227K OBP rows pay several redundant full FTS scans per call.
- **Fix sketch:** (a) cache prepared statements in the existing
  `getStaticDbState` keyed by SQL string (the WHERE shapes are few);
  (b) bigger win: materialize the FTS-matched rowids once per call
  (e.g. `CREATE TEMP TABLE` or a CTE the COUNT/SELECT/aggregations all join
  against), or at least derive COUNT from the SELECT page + a single COUNT.
  The same (much milder) pattern exists in commodities — see finding 20.

### [ ] 7. Global promise-chain throttle serializes ALL upstream calls across all concurrent users

- **Severity:** medium under concurrency (KNOWN tradeoff — the R14 comment at `src/utils/api-client.ts:33-37` already names the fix)
- **Where:** `src/utils/api-client.ts:38-53` (`throttle()`, module-global `throttleQueue`, `REQUEST_DELAY_MS=100`); every `apiGet`/`apiPost` enters via `apiFetchOnce` `:273`, and every retry attempt re-enters
- **Bug/cost:** K concurrent callers → the K-th waits ~K×100ms of pure queue
  latency; pending backlog grows linearly under sustained parallel load (settled
  links are GC'd, so it's latency stacking, not a memory leak).
- **Fix sketch:** per the code's own comment — replace the global chain with a
  per-host token bucket (allow N in-flight per upstream host, 100ms refill).
  Only worth doing when concurrent-user load becomes real; record the decision
  here either way.

---

## P3 — Viewer (user-visible polish + structural)

### [ ] 8. Rotation state desyncs when loading a new document

- **Severity:** medium (visible misbehavior on a common path)
- **Where:** `apps/document-viewer/src/viewer.ts:68` (module-level `currentRotation`), `:519` (`rotateImage`), `:530` (`resetView`), `:424-480` (`initializeImageViewer` — creates a fresh OSD viewer at 0° and never resets `currentRotation`)
- **Bug:** rotate document A to 90°, navigate to document B (renders at 0°,
  `currentRotation` still 90): first rotate-right click computes `(90+90)%360`
  and jumps the fresh image straight to 180°. Only Reset realigns.
- **Fix sketch:** delete `currentRotation` and derive inside `rotateImage` from
  `viewer.viewport.getRotation()`; or reset it to 0 in `initializeImageViewer`.
  Deriving is strictly better (removes the sync invariant entirely).

### [ ] 9. Viewer renders the server's JSON error envelope verbatim as the error message

- **Severity:** medium (raw JSON blob shown to the user; suggestion buried)
- **Where:** `apps/document-viewer/src/viewer.ts:120-124` (isError path renders `content[0].text` verbatim) vs `src/index.ts:~229` (`errorResponse` emits `JSON.stringify({error, suggestion, tool})` as that text; the view_document_ui handler routes all throws through it at `:532`)
- **Bug:** malformed ID → iframe error screen shows
  `{"error":"Invalid document ID...","suggestion":"...","tool":"globalise_view_document_ui"}`.
- **Fix sketch:** in the viewer's isError branch, `try { JSON.parse(text) }` and
  render `parsed.error` as the message with `parsed.suggestion` as a secondary
  line, falling back to the raw text. (Or change the server to emit prose for
  the app tool — but the JSON envelope is shared with the non-UI tools, so the
  viewer-side parse is the smaller change.)

### [ ] 10. Server↔viewer protocol contract typed twice, never cross-checked, detection hinges on `'id' in structured`

- **Severity:** medium (latent; regressions invisible to `npm test`)
- **Where:** `src/tools/document-viewer.ts:53-74` (`viewDocumentUiOutputSchema`, zod) vs `apps/document-viewer/src/viewer.ts:29-62` (hand-written `DocumentData`/`ArchivalContext` interfaces); detection at `viewer.ts:132` (`'id' in structured`)
- **Bug:** the two definitions live in separate compilations (tsc over `src/`,
  vite over `apps/`) so no compiler cross-checks them. Renaming any server-side
  field compiles green everywhere and fails only at runtime in the iframe;
  renaming `id` specifically makes detection fall through to fallbacks that also
  fail in default STRUCTURED_CONTENT mode → "Could not parse document data".
  `npm test`'s viewer test only checks the build succeeds.
- **Fix sketch:** create a shared types module (e.g. `shared/viewer-protocol.ts`)
  imported by both builds — derive the viewer's type via `z.infer` of the zod
  schema if the app build can import zod types, else a plain interface both
  sides import. Optionally add a smoke test that feeds a server-built payload
  through the viewer's parse path.

---

## P4 — Verified but lower priority (cleanup-pass material)

### [ ] 11. Empty-string `settlement`/`chamber` diverge between source-compat checks and WHERE builders

`src/tools/archival-index.ts:464` uses `input.settlement !== undefined` (so `''`
counts as a filter) but `buildObpWhereClause:234` uses falsy `if (input.settlement)`
(so `''` adds no condition); same mismatch for `chamber` at `:259`.
`{source:'all', settlement:''}` → skips GM, emits the "GM skipped" note, returns
ALL 227K OBP docs unfiltered; `{source:'gm', settlement:''}` → ToolError at `:479`
despite no effective filter. **Fix:** normalize empty strings to undefined at
input (or `.min(1)` on the zod strings).

### [ ] 12. Bare `catch` in `sanitizeFtsQuery` conflates any DB failure with FTS5 syntax errors

All three catches (`src/utils/fts.ts:126/:139/:154`) are bare `catch {}`. A
non-syntax probe failure (stale statement after `closeDatabase`, SQLITE_BUSY,
I/O) walks the whole rewrite chain and surfaces as ToolError "Invalid full-text
query", masking the real failure. Rare in this deployment profile (local
read-only DB, single process). **Fix:** inspect the error (node:sqlite exposes
`errcode`/message; FTS5 grammar errors say `fts5: syntax error` / `unterminated
string`) and rethrow non-syntax errors.

### [ ] 13. `getCachedApiGet`: truthiness cache check + no in-flight dedup

`src/utils/api-client.ts:360-363` — `if (cached)` treats falsy cached values as
misses (currently unreachable: both cached endpoints return objects), and N
concurrent identical misses fire N upstream fetches (softened by the global
throttle). **Fix:** `!== undefined` check + a `Map<string, Promise>` of
in-flight fetches.

### [ ] 14. `getDatabase` flip-flops availability if a PRAGMA throws after handle assignment

`src/utils/database.ts:63-74` (and `getReferenceDatabase` `:108-110`): `db` is
assigned before the `db.exec('PRAGMA ...')` calls and `:50` early-returns on
`if (db)`. If a pragma threw, call 1 reports DB unavailable, call 2+ silently
returns the half-configured handle. The three pragmas are perf-only and
essentially never throw on an opened read-only connection — structural, not
live. **Fix:** assign to a local, run pragmas, then publish to the module var.

### [ ] 15. Per-connection static-state cache hand-copied between the two SQLite tools

`src/tools/commodities.ts:122-133` (`getStaticState`) mirrors
`src/tools/archival-index.ts:390-410` (`getStaticDbState`) — same
`staticState?.db !== db` handle-keying, FTS probe, cached COUNT; the copies
already differ (archival adds lazy `??=` aggregation caching).
`src/utils/database.ts:32` plans a third vocabulary DB ("weights & measures
later") → third copy. The handle-keying detail is the non-obvious correctness
invariant a third copy could miss. **Fix:** generic `perConnectionState(db, init)`
helper in `database.ts`; fold finding 6's statement cache into it.

### [ ] 16. FTS auto-quote contract described in ≥4 prose places (already drifted)

Sites: `archival-index.ts:16` describe, `commodities.ts:35` describe, both tool
descriptions in `src/index.ts`, `skills/globalise-voc-research/SKILL.md`.
Findings 4 covers the two live contradictions. **Fix (structural):** single
source the contract paragraph (e.g. exported const interpolated into both
describes and both registrations) so the next `fts.ts` change edits one string.

### [ ] 17. `document-id.ts` prefix handling: case-sensitive `startsWith` + unanchored `replace`

`src/utils/document-id.ts:21` (`startsWith('urn:globalise:')`, case-sensitive)
and `:38` (`replace('urn:globalise:', '')`, first occurrence anywhere).
`URN:GLOBALISE:NL-HaNA_...` gets double-prefixed then rejected with a structured
ToolError (clear rejection, not silent misbehavior). **Fix:** case-insensitive
anchored strip: `docId.replace(/^urn:globalise:/i, '')` in both.

### [ ] 18. Dead/inert code (each verified zero-caller by grep)

- `src/utils/api-client.ts:342` — exported `configCache` has zero importers.
- `src/tools/search.ts:65` — `searchInputSchema` is never `.parse()`d (only
  `z.infer`), so every `.default()` is inert; sole caller hardcodes
  `fragmentSize:500`/`includeAggregations:true` and never passes
  `indexName`/`languageLabels`, leaving `:157`/`:164`/`:169`/`:205` branches dead.
  Editing `.default(500)` changes nothing — trap for future tuning.
- `src/tools/document.ts:53` — `includeAnnotations` is true at every call site;
  the false-branch is dead and would silently strip metadata/navigation/urls
  (and break `navigate`) if ever used.
- `src/utils/cache.ts:92-108` — `clear()/size()/has()/delete()` have zero
  callers; `has()` delegates to `get()` which **mutates LRU recency** — a future
  passive `has()` check silently reorders eviction. Delete or fix `has()`.
- `apps/document-viewer/src/viewer.ts:149-158` — third parse fallback (parse
  `content[0]` if it starts with `{`) is unreachable against this server's
  content ordering in both STRUCTURED_CONTENT modes.

### [ ] 19. Script duplication: ensure-* and build-* pairs forked

- `scripts/ensure-reference-db.ts` mirrors `scripts/ensure-archival-db.ts`
  step-for-step but dropped the `gzipped` flag and the
  `ARCHIVAL_DB_URL`/`ARCHIVAL_DB_TOKEN` download branch — a `REFERENCE_DB_URL`
  or crash-safety fix must be hand-ported. Also `ensure-reference-db.ts:12`
  documents `npm run ensure:db:commodities`, which doesn't exist in package.json
  (only `ensure:db` chains both).
- `scripts/build-commodities-db.ts:106` — `runInTransaction` is
  character-identical to `build-archival-db.ts:178`; remove-DB + ANALYZE/VACUUM +
  gzip tail repeated. (`strOrNull` vs `parseStringOrNull` semantics verified
  identical for all in-type inputs — NOT a data risk.)
- **Fix:** extract `scripts/db-build-utils.ts` (transaction wrapper, artifact
  tail) and a parameterized `ensureDb({dbPath, gzPath, buildScript, urlEnv})`.

### [ ] 20. Minor efficiency (verified real, marginal magnitude)

- `src/tools/commodities.ts:167/:178` — COUNT/SELECT re-prepared per call (3
  constant SQL strings; cacheable in `getStaticState`); text query runs the
  MATCH 3× (probe/COUNT/SELECT). Sub-ms on 3.5K rows — fold into finding 15.
- `apps/document-viewer/src/viewer.ts:485-501` — new RegExp per highlight term
  per line + `escapeHtml`'s throwaway `document.createElement('div')` per line;
  hoist one regex per term (or one alternation) outside the `.map`.
- `apps/document-viewer/src/viewer.ts:591/:606` — document-level
  mousemove/mouseup splitter handlers added per `renderDocument`, never removed.
  Stale handlers are inert (`if (!isDragging) return;` and their captured
  splitter is detached) — unbounded but low-cost accumulation. During an active
  drag, the live handler reads `getBoundingClientRect` per mousemove after style
  writes (forced reflow); read once on mousedown.
- `src/index.ts` — the STRUCTURED_CONTENT gate appears 4× (registerJsonTool
  `:273`, registerAppTool `:489-491`, app-tool handler `:523-527`,
  `structuredPayload` `:93-97`) and the app handler re-implements
  registerJsonTool's try/catch→errorResponse wrapper. Extract the gate
  conditional + error wrapper; some hand-rolling is inherent (the app tool's
  content shape genuinely differs).
- `src/index.ts` `formatError` (`:175`) duck-types api-client's untyped
  `{type, error, suggestion}` throws (`api-client.ts:386/:409`) via `'error' in
  error`; a future `{message, suggestion}` throw silently degrades to
  `[object Object]`. No such site exists today. **Fix:** make ApiError a class in
  `src/utils/errors.ts` and move `formatError` next to it.

---

## Refuted (do not re-flag)

- **Empty `inventoryNumber: []` → `IN ()`:** SQLite explicitly permits an empty
  IN list (verified empirically with node:sqlite) — returns 0 rows, no syntax
  error. (Silent `total:0` for `[]` input is arguably odd but harmless.)
- **FTS5 NEAR-comma escaping** (`src/utils/fts.ts:36` STRUCTURAL omitting `,`):
  empirically tested against the live index — `NEAR("oost-indie," peper)`
  PARSES; the quoted comma is tokenizer-invisible (`"peper,"` matches identically
  to `peper`), so NEAR semantics are preserved, and the user's verbatim
  comma-form was invalid FTS5 anyway. **One real adjacent quirk found:** the
  distance form `NEAR(oost-indie peper, 5)` rewrites to
  `NEAR("oost-indie" "peper," 5)` which parses but silently demotes `5` from a
  distance to a third phrase (default distance 10 applies). Low-grade; note it
  in fts.ts if ever touched.
- **HTTP wedged response after headers sent** (`http-server.ts:93`):
  `transport.handleRequest` delegates to @hono/node-server's request listener,
  whose `handleResponseError` always `end()`s AND `destroy()`s the connection on
  post-header errors; only pre-header throws reach the express catch, and those
  hit the existing `!res.headersSent` 500 branch.
- **`hasMore` formula divergence** (4 sites, 3 formulas): all four verified
  correct-and-equivalent in their own data flows, including short last pages
  (`slice`-based and `LIMIT/OFFSET`-based variants are provably the same
  boolean). Stylistic inconsistency only; unify opportunistically.
- Also verified-fine: the per-connection caches invalidate correctly on reopen;
  LRU TTL math is correct; `origin.ts` bounds its deny-log map; per-request
  McpServer construction in stateless HTTP mode is the SDK's documented pattern
  (the expensive zod `.strict()` derivations are already hoisted); the
  transport.close() double-close is guarded (`_onclose` clears `_transport`
  before `server.close()` runs) — though the two floating promises in the res
  'close' listener (`http-server.ts:84`) could still use a `.catch(() => {})`
  to be safe against unhandledRejection on Node 24.

---

## Process notes for the fixing session

- **Every code fix needs the full version-bump ritual** (package.json,
  CLAUDE.md Current Version, CHANGELOG.md, `npm install` for the lockfile).
  Batch related findings into one version where sensible.
- Findings 1-4 are independent and safely batchable; finding 5 touches the
  http-server signature; findings 6+15+20(commodities) are one statement-cache
  refactor; findings 8-10 are viewer-only (rebuild via `npm run build`,
  `test:viewer-build` only checks the build).
- Mark a finding `[x]` with the fixing version, or `[-]` with the reason, so this
  file stays the single source of truth on what's outstanding.
