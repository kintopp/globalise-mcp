# CLAUDE.md

## Repository Overview

GLOBALISE MCP Server for accessing Dutch East India Company (VOC) transcriptions. Main code in `globalise-mcp-server/`. API docs in `globalise-transcriptions-api/`.

## Conventions

- `offline/` is gitignored; ignore unless explicitly requested.
- Archived CHANGELOG (v1.0–v1.16) and completed/deferred TODOs are in `offline/outdated/`.
- **Do not modify `.gitignore` without explicit user approval.**
- "TODO" or "todo" means `globalise-mcp-server/TODO.md`.
- CLAUDE.md is tracked in git.
- A SessionEnd hook automatically captures `★ Insight` blocks to `offline/INSIGHTS.md`.

## Shell Best Practices (Lesson Learned)

Complex curl commands fail due to shell parsing. Write JSON to a temp file instead of inline `-d '{...}'`. If curl fails with parsing errors, restructure rather than retry.

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
| `feature/*` | `https://globalise-mcp-beta-production.up.railway.app/mcp` |

Health check: `/health`

**Auto-deployment:** Railway deploys automatically when pushed to GitHub. Production from `main`, beta from the active feature branch.

---

## Version Management

**Every code change requires a version bump.** This has been forgotten in the past.

Update ALL of these (they must match):

1. `package.json`
2. `src/index.ts` — server constructor version
3. `src/transports/http-server.ts` — VERSION constant
4. `CLAUDE.md` — Current Version below
5. `CHANGELOG.md` — new entry with date

### Current Version: 1.25.0

---

## Rules

### Editorial Decisions on Content

**Flag content modifications for user review.** Any editorial decisions that modify, truncate, filter, or transform source data must be flagged before implementation and documented in CHANGELOG.md.
