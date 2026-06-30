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
npm test           # offline suite: typecheck, FTS, archival/commodities/measures, viewer, CLI, response-size, smoke, shutdown
npm run build:mcpb # pack the full .mcpb (ships the ~112MB index); :thin omits it (downloads on first use)
npm run test:mcpb  # stdio smoke-test the staged bundle (NOT in `npm test` — needs build:mcpb first)
npm run cli        # run the headless CLI client (scripts/cli.mjs) — `npm run cli -- search "peper" --max 5`
npm run test:cli   # CLI smoke test (NOT in `npm test` — needs dist/ + DBs + network; mirrors test:live)
```

### Pre-push testing (optional but recommended)

There is **no CI** — every guard runs only when you run it locally, and a push to `main` **auto-deploys to Railway prod** (see "Deployment"). So before a push that includes **significant code commits** (anything beyond a docs tweak), run the gates that the default chain doesn't:

```bash
npm test            # the offline test chain — always
npm run build && npm run test:cli   # CLI client end-to-end (needs dist/ + DBs + network)
npm run build:mcpb && npm run test:mcpb   # if the .mcpb packaging or server surface changed
npm run test:live   # if an upstream API contract (search/retrieve/navigate) might be affected
```

`test:cli` / `test:mcpb` / `test:live` are deliberately out of `npm test` (they need a built `dist/`, the DBs, or network); pick the ones a given change could plausibly break. A doc-only change needs none of these beyond `npm test`.

## Structure (globalise-mcp-server/)

- `src/index.ts` — entry point, tool registration
- `src/tools/` — search, document, document-viewer, convenience, archival-index, commodities, measures
- `src/transports/http-server.ts` — HTTP transport (Railway deployment)
- `src/utils/` — api-client, cache, database (SQLite), document-id, fts (FTS5 query sanitizer), iiif, languages, errors, origin (Origin-header validation, spec MUST), response-size (byte-budget trimmer), types
- `apps/document-viewer/` — MCP Apps UI, bundled by vite during build
- `scripts/build-archival-db.ts` — regenerates `data/archival-index.sqlite` (committed as `.gz`)
- `scripts/cli.mjs` — the headless CLI **client** (`glob-mcp` bin): an MCP client driving the same server tools an LLM does (6 stateless verbs; viewer tool excluded). stdio default / `--http <url>` (or `GLOBALISE_MCP_HTTP`) override. Tested by `scripts/test-cli.ts` (`npm run test:cli`, out of the default chain). Zero new deps. Ported from `~/Documents/GitHub/rijksmuseum-mcp-plus/scripts/cli.mjs` (+ `scripts/tests/test-cli.mjs`) — the reference model (hand-maintained `VERBS`/`VERB_HELP`, everything else schema-derived from `listTools()`); consult it when re-syncing or extending.
- `justfile` — `just` (command-runner) recipes for the CLI: `setup` (deps + build, for stdio), `deps` (npm deps only, for http-only), `cli`/`http` passthroughs (args + flags forwarded via `set positional-arguments` + `"$@"`; `just`'s echo is stderr so `just cli` stays pipe-safe), `test`. Per-OS `just` install + a stdio-vs-http requirements table are in README "CLI". Optional convenience only — the recipes are thin `npm`/`node scripts/cli.mjs` wrappers. NB when editing: `just --list` shows only the **single comment line directly above** each recipe (multi-line → only the last shows), so keep that line a concise one-liner.
- `skills/globalise-voc-research/` — the `globalise-voc-research` skill **source** (`SKILL.md`). The packaged artifacts live **alongside** this directory (at `skills/` level, **not** inside it): `globalise-voc-research.skill` (the committed package — a zip of `globalise-voc-research/SKILL.md`) and `globalise-voc-research.skill.zip` (that `.skill` wrapped as a `.zip`). Both are committed.
- `manifest.json` / `manifest.thin.json`, `.mcpbignore`, `MCPB.md`, `scripts/build-mcpb.ts`, `scripts/test-mcpb-bundle.ts` — the `.mcpb` (Claude Desktop bundle) packaging (since v2.9.0, on `main`). `mcpb-build/` (generated output) is gitignored.

### Rebuilding the `.skill` package

The `.skill` is just a zip containing `SKILL.md` under its `globalise-voc-research/` directory prefix (no build script). After editing `SKILL.md`, repackage from `globalise-mcp-server/skills/` and commit the source **plus both artifacts**. The `.skill` and `.skill.zip` sit **alongside** the `globalise-voc-research/` directory (at `skills/` level), **not** inside it:

```bash
cd globalise-mcp-server/skills
# 1) the .skill package — a zip of the dir's SKILL.md, placed ALONGSIDE the dir
rm -f globalise-voc-research.skill
zip -X globalise-voc-research.skill globalise-voc-research/SKILL.md
# 2) the .skill.zip — the .skill wrapped as a .zip, sibling of the .skill
#    (-X avoids a macOS __MACOSX/._ AppleDouble fork from the .skill's xattrs)
rm -f globalise-voc-research.skill.zip
zip -X globalise-voc-research.skill.zip globalise-voc-research.skill
# verify the package content matches the source:
unzip -p globalise-voc-research.skill 'globalise-voc-research/SKILL.md' | diff - globalise-voc-research/SKILL.md
```

### Building the `.mcpb` bundles

`npm run build:mcpb` (full) / `build:mcpb:thin` from `globalise-mcp-server/` — each runs `npm run build`, stages a clean runtime tree under `mcpb-build/stage/`, and packs via `npx -y @anthropic-ai/mcpb` (no committed dep). **Full** ships the ~112 MB archival index in the bundle (30.4 MB `.mcpb`); **thin** omits it (4.7 MB) and the server downloads it on first `find_archival_documents` call (`ensureDatabaseFile()` in `database.ts`). Both stage `data/reference.sqlite` (the commodities + measures glossaries — small, so even thin ships it; without it those two tools degrade to "unavailable"). The manifest version is stamped from `package.json` at pack time. `npm run test:mcpb` stdio-smoke-tests the staged tree (auto-detects variant; thin run exercises the real first-run download). `.mcpb` output and the build are documented in `MCPB.md`. See [memory: mcpb-node24-baseline] for history.

## Conventions

- `offline/` is gitignored; ignore unless explicitly requested.
- Completed/deferred TODOs are in `offline/outdated/`.
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
| beta — now also tracks `main` (no active dev branch) | `https://globalise-mcp-beta-production.up.railway.app/mcp` |

Health check: `/health` — returns `{ status, name, version, node }`. The `node` field is the runtime version Railway actually selected; `curl <url>/health` to confirm it's `v24.x` after a deploy.

**Auto-deployment:** Railway deploys automatically when pushed to GitHub. Each service's GitHub source watches **one configured branch** (not a `feature/*` glob): production tracks `main`; beta tracks whatever branch is set as its source — **currently also `main`** (repointed 2026-06-13; see note below). Any push that moves the watched ref triggers a deploy, including a `git commit --amend` + push (the deploy fires on the ref update, not on a changed version/message). To confirm which commit is live when two commits share a version, check the deployment's commit SHA in the Railway dashboard; when versions differ, `/health` is enough. To repoint beta at a different branch, change the service source in the Railway dashboard.

**`worktree-p0-refactor` retired (done 2026-06-13):** the `worktree-p0-refactor` local branch + git worktree were retired on 2026-06-12 (fast-forward-merged into `main` at `7d6e09a` / v2.8.1); the remote `origin/worktree-p0-refactor` was kept temporarily as the Railway beta deploy source. On 2026-06-13 the beta service (`globalise-mcp-beta`, project `endearing-warmth`) was repointed to `kintopp/globalise-mcp@main` and the remote branch was deleted (`git push origin --delete worktree-p0-refactor` + local prune). Net: beta now tracks `main` (so beta == prod until a new dev branch is set as its source); no `worktree-p0-refactor` ref remains anywhere. To stand up a future beta dev branch, push it and repoint the beta service source in the Railway dashboard.

**Node version:** Railway's builder selects Node from `globalise-mcp-server/package.json` `engines.node` (`>=24.15.0 <25.0.0`) and `.nvmrc` (`24.16.0`) — Node 24, matching Claude Desktop's bundled runtime. The builder pins the major; the patch is its choice. The code runs on any Node 24.x (the `>=24.15` floor is for Claude Desktop parity, not a hard requirement — `node:sqlite` is flagless from 24.0). To force the major, set the `NIXPACKS_NODE_VERSION=24` service variable. Verify post-deploy via `/health`.


---

## Rules

### Editorial Decisions on Content

**Flag content modifications for user review.** Any editorial decisions that modify, truncate, filter, or transform source data must be flagged before implementation and documented in the commit message.
