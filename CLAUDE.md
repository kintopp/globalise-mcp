# CLAUDE.md

## Repository Overview

GLOBALISE MCP Server for accessing Dutch East India Company (VOC) transcriptions. Main code in `globalise-mcp-server/`. API docs in `globalise-transcriptions-api/`.

## Commands

All commands run from `globalise-mcp-server/`:

```bash
npm run build      # 3 stages: vite UI build → tsc → ensure:db (decompress committed DB)
npm run build:db   # regenerate data/archival-index.sqlite from source (slow; build uses ensure:db)
npm run dev        # tsc --watch (npm run dev:ui rebuilds the viewer on change)
npm run inspector  # build + MCP Inspector against dist/index.js
npm start          # run the built server (node dist/index.js)
npm test           # archival-index + viewer-build + smoke tests
```

## Structure (globalise-mcp-server/)

- `src/index.ts` — entry point, tool registration
- `src/tools/` — search, document, document-viewer, convenience, archival-index
- `src/transports/http-server.ts` — HTTP transport (Railway deployment)
- `src/utils/` — api-client, cache, database (SQLite), document-id, iiif, languages, errors, origin (Origin-header validation, spec MUST), types
- `apps/document-viewer/` — MCP Apps UI, bundled by vite during build
- `scripts/build-archival-db.ts` — regenerates `data/archival-index.sqlite` (committed as `.gz`)
- `skills/globalise-voc-research/` — the `globalise-voc-research` skill: `SKILL.md` (the source) + `globalise-voc-research.skill` (the committed package).

### Rebuilding the `.skill` package

The `.skill` is just a zip containing `SKILL.md` under its directory prefix (no build script). After editing `SKILL.md`, repackage it from `globalise-mcp-server/skills/` and commit both files:

```bash
cd globalise-mcp-server/skills
rm -f globalise-voc-research/globalise-voc-research.skill
zip -X globalise-voc-research/globalise-voc-research.skill globalise-voc-research/SKILL.md
# verify: unzip -p .../globalise-voc-research.skill 'globalise-voc-research/SKILL.md' | diff - globalise-voc-research/SKILL.md
```

## Conventions

- `offline/` is gitignored; ignore unless explicitly requested.
- Archived CHANGELOG (v1.0–v1.16) and completed/deferred TODOs are in `offline/outdated/`.
- **Do not modify `.gitignore` without explicit user approval.**
- "TODO" or "todo" means `globalise-mcp-server/TODO.md`.
- CLAUDE.md is tracked in git.
- A SessionEnd hook automatically captures `★ Insight` blocks to `offline/INSIGHTS.md`.

## Shell Best Practices (Lesson Learned)

Complex curl commands fail due to shell parsing. Write JSON to a temp file instead of inline `-d '{...}'`. If curl fails with parsing errors, restructure rather than retry.

## Common Errors

- **Vite UI build fails with `Rollup failed to resolve import "openseadragon"`:** the local `node_modules` is stale (predates a dep the committed `package-lock.json` already pins — e.g. an old tree still on vite 5 with no `openseadragon`). Run `npm install` (or `npm ci` for a clean slate) before `npm run build`; do **not** add the import to `rollupOptions.external` (the viewer bundle must inline it). The committed lockfile is correct; only the on-disk install drifted.

- **Editor flags `Cannot find name 'process'` (or other Node globals) in `scripts/*.ts`:** false positive — do **not** install deps or touch tsconfig. `tsconfig.json` `include` is `src/**/*` only, so `scripts/` is outside the TS project; the editor LSP falls back to an inferred project that doesn't load `@types/node`. The scripts run via `tsx` (transpile-only), so `npm run build` (tsc over `src/`) and `npm test` (tsx) both stay green. **Corollary:** type errors in `scripts/` are caught by neither the build nor the tests — they surface only at runtime, so review test-script types by hand (or run `npx tsc --noEmit` against the file with `@types/node` on the include path if you need a real check).

---

## Upstream API Reference

These endpoints are external to the codebase and useful when debugging or modifying the server.

| Component | URL |
|-----------|-----|
| Frontend SPA | `https://transcriptions.globalise.huygens.knaw.nl` |
| Search API | `https://gloccoli.tt.di.huc.knaw.nl` (Broccoli/Gloccoli) |
| Text Storage | `globalise.tt.di.huc.knaw.nl/textrepo` |
| Annotations | `annorepo.globalise.huygens.knaw.nl` |
| Images | `service.archief.nl/iip` (IIIF) |

### Key Endpoints

```
POST https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/search
  Query params: indexName, fragmentSize, from, size, sortBy, sortOrder
  Body: { text: "query", terms: {}, aggs: {...} }

GET https://gloccoli.tt.di.huc.knaw.nl/projects/globalise/urn:globalise:{doc_id}
  Query params: overlapTypes, includeResults, views, relativeTo
```

---

## Deployment

| Branch | URL |
|--------|-----|
| `main` | `https://globalise-mcp-production.up.railway.app/mcp` |
| active dev branch (currently `worktree-p0-refactor`) | `https://globalise-mcp-beta-production.up.railway.app/mcp` |

Health check: `/health` — returns `{ status, name, version, node }`. The `node` field is the runtime version Railway actually selected; `curl <url>/health` to confirm it's `v24.x` after a deploy.

**Auto-deployment:** Railway deploys automatically when pushed to GitHub. Each service's GitHub source watches **one configured branch** (not a `feature/*` glob): production tracks `main`; beta tracks whatever branch is set as its source — **currently `worktree-p0-refactor`**. Any push that moves the watched ref triggers a deploy, including a `git commit --amend` + push (the deploy fires on the ref update, not on a changed version/message). To confirm which commit is live when two commits share a version, check the deployment's commit SHA in the Railway dashboard; when versions differ, `/health` is enough. To repoint beta at a different branch, change the service source in the Railway dashboard.

**Node version:** Railway's builder selects Node from `globalise-mcp-server/package.json` `engines.node` (`>=24.15.0 <25.0.0`) and `.nvmrc` (`24.16.0`) — Node 24, matching Claude Desktop's bundled runtime. The builder pins the major; the patch is its choice. The code runs on any Node 24.x (the `>=24.15` floor is for Claude Desktop parity, not a hard requirement — `node:sqlite` is flagless from 24.0). To force the major, set the `NIXPACKS_NODE_VERSION=24` service variable. Verify post-deploy via `/health`.

---

## Version Management

**Every code change requires a version bump.** This has been forgotten in the past.

Update ALL of these (they must match):

1. `package.json` — the only code location; `SERVER_VERSION` (and `/health`) read it at startup
2. `CLAUDE.md` — Current Version below
3. `CHANGELOG.md` — new entry with date
4. `package-lock.json` — run `npm install` (no args) after bumping `package.json` so its two `version` fields follow; don't hand-edit. It has silently lagged before (was stuck at 2.4.0 through v2.5.3).

### Current Version: 2.7.5 (worktree-p0-refactor; v2.7.5 = graceful HTTP shutdown (P2 **finding 5**). Every Railway redeploy SIGTERMs the process, but `shutdown()` was `closeDatabase(); process.exit(0)` — cutting in-flight `/mcp` requests mid-response and accepting new connections right up to exit. Root cause: `createHttpServer` returned the express `app` and **discarded** the `http.Server` from `app.listen()`, so nothing could `.close()` it. Fix: http-server.ts captures + returns the `http.Server` (typed `: Server`); index.ts holds it in a module-scope `httpServer` (http mode only) and `shutdown()` drains it — `closeIdleConnections()` → `server.close()` (stop accepting, await in-flight) → `closeDatabase()` + exit, with a 10s `unref`'d `SHUTDOWN_TIMEOUT_MS` backstop so it never hangs past Railway's grace window. Stdio mode unchanged (synchronous exit). Verified live: SIGTERM → exit **0** (was 143) with the `[SHUTDOWN]` sequence logged, backstop not triggered. No DB rebuild. v2.7.4 = fixed the four **P1 findings** from the v2.7.3 whole-codebase review (`CODE-REVIEW-FINDINGS.md`), batched into one version per that file's process notes. No DB rebuild, no `.skill` change. (1) `retrieve_document`/`navigate` no longer hard-error when an upstream page lacks a license: `license` was mapped unconditionally from `metadata.comment`, but both output schemas declared it a **required** string and `STRUCTURED_CONTENT` (default-on) validates `structuredContent` against the schema — a comment-less page → `license:undefined` → zod failure → whole call errored. Now `.optional()` in `getDocumentOutputSchema` (document.ts) + `navigateOutputSchema` (convenience.ts), `PageMetadata.comment` optional in types.ts, and a shared `normalizeLicense()` (document.ts, reused by document-viewer.ts) guards the missing case **and** strips the `"license: "` prefix — retrieve/navigate now return the bare value (`"CC-BY-4.0"`), matching the viewer. (2) Folio filters no longer silently dropped: `folioFrom`/`folioTo` sat inside `if(inventoryNumber)`, so a folio range without an inventory was discarded and all rows returned as if filtered. Folio now throws a `ToolError` without an `inventoryNumber`, and is treated as **OBP-only like settlement** (chosen via AskUserQuestion over "apply to GM too"/"keep+note", per Editorial rule) — `source:"all"`+folio skips GM with a note, `source:"gm"`+folio throws; kills the old mixed folio-filtered-OBP + unfiltered-GM response. `hasObpOnlyFilters` now includes folio; incompatible/skip messages generalized. buildObp/GmWhereClause unchanged (the top-of-fn guard guarantees folio⇒inventory). (3) matchAll aggregations described the wrong population: matchAll filters upstream on ONE language (ES computes aggs over that pool) then post-filters results/total to ALL-languages pages — aggregations described e.g. all Malay hits, unflagged. Now recomputed client-side over the matched set (`aggregateResults()` in search.ts), upstream aggs no longer requested in matchAll mode (`includeAggregations:!useMatchAll`), note updated. (4) `find_archival_documents` registration in index.ts still documented the pre-v2.7.3 "phrase-escape retry sets a note" contract, contradicting the schema describe's auto-quote contract — rewritten to match (doc-only). Findings 5-20 remain open in CODE-REVIEW-FINDINGS.md. v2.7.3 = FTS5 sanitizer now **preserves boolean operators** instead of silently dropping them. The syntax error from hyphens/slashes/apostrophes is a FTS5 *query-parser* fault (barewords allow only letters/digits/underscore/non-ASCII), NOT a tokenizer issue — a different tokenizer is the wrong layer and would force a DB rebuild for no gain. New `escapeFtsTerms()` in `src/utils/fts.ts` quotes only the offending barewords while keeping `()`, `"phrases"`, `AND`/`OR`/`NOT`/`NEAR`, and trailing `*` intact (peeled outside the quotes); `sanitizeFtsQuery()` chain is raw → per-term → whole-phrase wrap → throw. Measured on the live 227K OBP index: lone punctuated terms were already fine via whole-wrap, but punctuated-term-plus-operator misfired to a silent 0 (`peper OR oost-indie` 0→984; `oost-indie*` 3→16). Query-side only, **no DB rebuild**; shared by `find_archival_documents` + `lookup_commodity`. Both tool descriptions rewritten; new `scripts/test-fts.ts` (24 pure-function checks, wired into `npm test` as `test:fts`) + strengthened archival §3. SKILL.md "Trap 2" rewritten to the auto-quote contract + `.skill` repackaged (rebuild command now documented above). Known FTS5 limit: implicit-AND before a `(group)` (`compagnie (a OR b)`) is rejected by FTS5 itself — write the explicit `AND`; such input falls back safely. v2.7.2 = doc-only refinement of `globalise_lookup_commodity` (tool description in `src/index.ts` + `SKILL.md`) after evaluating 8 test prompts across Sonnet/Opus/Fable — **no code-logic change**. Driven by one data fact: `altLabels` (period spelling variants) exist for only **~9.6%** of the 3,508 concepts (pepper/coffee/nutmeg have none), so the old "main use = query expansion via altLabels" framing oversold an absent feature. Reframe: core value = bilingual label resolution + sourced definition; recall engine = period-spelling reconstruction + fuzzy/wildcards (`koffie`→`coffij`); altLabels a bonus (rich for silk `zijde`=23, null for most). Also: keep source/confidence visible incl. in lists, say only what the definition states, prefer the definition over a sometimes-mistranslated `prefLabelEn` (e.g. `raapfoelie`≠"rapeseed oil"), expand source codes (WNT/AAT/vocGlossarium/PoolParty) for readers. Recall numbers (`koffie` 119 vs `coffij` 25,124) are live-confirmed and kept; source `.trig` checked — no extra SKOS labels, so this is prose not data. `.skill` repackaged. v2.7.1 = internal `/simplify` cleanup of the v2.7.0 commodities tool, **no behavior change** — full tests + smoke green: (a) the duplicated FTS5 `sanitizeFtsQuery` (probe-then-phrase-escape-with-`note`) extracted to shared `src/utils/fts.ts`, taking a prepared probe statement so each tool keeps its own table + caching; both `archival-index.ts` and `commodities.ts` call it; (b) `lookupCommodity` got a per-connection static-state cache (`commoditiesTotal` + `ftsProbe`, keyed by db handle) mirroring archival's `getStaticDbState`, dropping a constant `COUNT(*)` + probe re-prepare per call and a redundant second COUNT on the no-query path; (c) `notes[]` → single `note`, `ftsQuery` indirection folded into one `input.query` branch. v2.7.0 = new tool `globalise_lookup_commodity` — flat-glossary lookup over the VOC commodities thesaurus, 3,508 trade goods/concepts with bilingual NL/EN labels, period spelling variants, and a sourced+confidence-rated definition per concept. Reimplements the v1.17.0-removed `globalise://reference/commodities` MCP resource as the SQLite-backed tool the TODO planned, enriched well beyond the archived minimal thesaurus (labels+hierarchy only) with definitions+provenance. Primary use = query expansion: returned `altLabels` feed back into `search_transcriptions` (which is spelling-blind). New `data/reference.sqlite` (small reference-vocab DB, separate from the archival index; committed `.gz` decompressed at build via the extended `ensure:db`; built by `build:db:commodities` from committed `data/sources/commodities.tsv`). FTS5 over labels+variants+definitions, bm25-weighted so label/variant hits outrank definition-body hits; omit `query` to page alphabetically; reuses the archival tool's phrase-escape-with-`note` recovery. New DB-layer accessors (`getReferenceDatabase` etc.) in `src/utils/database.ts`. Editorial calls (Editorial Decisions rule): (1) glossary ships FLAT — both candidate classifications dropped as too unreliable to surface: the SKOS `skos:broader` tree is hollow ("NOT YET CLASSIFIED" holds 65% of concepts as direct children, rest is abstract SITC), and the LLM `class` misclassifies (e.g. "fire engine"→textile); a misleading taxonomy is worse than none. Abandoned `class`/`class_Source` columns also stripped from the committed `commodities.tsv` (full original stays in gitignored `offline/`). (2) `definitionSource`+`confidence` surfaced on every result since >half are LLM-generated and ~31% low/medium-low; (3) PoolParty concept UUIDs kept internal, never returned. Source: VOC Commodities Thesaurus, GLOBALISE/Huygens, CC-BY-SA-4.0, hdl:10622/YAWDOV)

---

## Rules

### Editorial Decisions on Content

**Flag content modifications for user review.** Any editorial decisions that modify, truncate, filter, or transform source data must be flagged before implementation and documented in CHANGELOG.md.
