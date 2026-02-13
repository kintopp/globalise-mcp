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

### Add RGP Published Edition Links (Retroboeken + GitHub)

**Priority:** Medium
**Status:** Ready to implement (mapping complete)

558 of 950 Generale Missiven have RGP published editions available via Retroboeken (interactive viewer) and GitHub (plain text). Add links to `globalise_find_archival_documents` output when `rgp_volume` and `rgp_page` exist.

**Implementation:** URL generator with verified offsets for all 14 volumes. Modify `src/tools/archival-index.ts`.

**Documentation:** `offline/resources/Overzicht van Generale Missiven.../RETROBOEKEN_MAPPING.md` and `GITHUB_RGP_TRANSCRIPTIONS.md`

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

**Priority:** Medium
**Status:** Not started

Review all tool descriptions in `src/index.ts` for accuracy, clarity, and consistency. Specific known issues:

1. **`matchAll` parameter discovery:** Users asking for "documents in both English and Dutch" don't get AND behavior because the LLM doesn't set `matchAll=true`. Make the AND vs OR distinction more explicit.

2. **`globalise_retrieve_document` URL description** is outdated — should lead with Transcriptions Viewer as primary link.

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

### Deploy Size Review

**Priority:** Low
**Status:** Not started

The deploy image includes ~56 MB of unused Bun binaries pulled in by `@modelcontextprotocol/ext-apps`'s `postinstall` script. We only use a single string constant (`RESOURCE_MIME_TYPE`) from that package.

1. **Check ext-apps PR [#451](https://github.com/modelcontextprotocol/ext-apps/pull/451):** Moves Bun/Rollup binaries to devDependencies. If merged and released, upgrading eliminates the bloat. If stalled, consider inlining `RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"` and dropping the dependency.

2. **Reconsider committing the archival SQLite database.** Currently gitignored and rebuilt from CSV on every Railway deploy (~183 MB). The rebuild adds build time and requires the CSV source files and build script to remain in the deploy. Committing the pre-built database (or storing it as a release artifact) would skip this step entirely. Before doing so, confirm all data in the CSVs remains relevant and up-to-date.

**Context:** `node_modules` is ~172 MB locally (macOS), potentially ~400 MB+ on Linux due to platform-specific binaries. The SQLite database is the single largest component at 183 MB.

---

### Document Viewer: OpenSeadragon Enhancements

**Priority:** Low
**Status:** Ideas

- Navigator mini-map (`showNavigator: true`)
- Image filters (brightness, contrast for faded manuscripts)
- Reference strip (thumbnail strip of adjacent pages)
