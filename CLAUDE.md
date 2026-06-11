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

### Current Version: 2.6.1 (worktree-p0-refactor; description + skill refinements to the v2.6.0 `publishedEdition` links, from a 9-prompt live MCP-client test pass against beta. No output-schema/behavior/data change — `.describe()` strings + the `globalise-voc-research` skill only; responses byte-for-byte identical to v2.6.0. `githubPageUrl` description now states it is the missive's *first page only* — not the whole letter; long letters spill onto following pages → use `githubVolumeUrl` (a client had framed the per-page link as the entire letter). `publishedEdition` description anchors the RGP edition as a selective, edited scholarly text distinct from the HTR transcription, and refines null to "not published in the RGP edition *in this form*". SKILL.md: stale "citation, not a link" note corrected; new "The RGP published edition links" subsection — three link types + plain-label guidance, page-vs-letter, edited-RGP-vs-HTR distinction with offline-verified provenance (RGP Grote Serie, 14 vols 1610–1767, begun by Coolhaas; GitHub = original-letter text only, CC BY-NC-SA 4.0 via Text Fabric/CLARIAH), an anti-embellishment guard, link-only note, plus do/don't lines. Provenance grounded in the offline dataset resources — `_OVERVIEW.md`, `GITHUB_RGP_TRANSCRIPTIONS.md`; dataset by Kay Pepping, DOI hdl:10622/BHKMWE)

---

## Rules

### Editorial Decisions on Content

**Flag content modifications for user review.** Any editorial decisions that modify, truncate, filter, or transform source data must be flagged before implementation and documented in CHANGELOG.md.
