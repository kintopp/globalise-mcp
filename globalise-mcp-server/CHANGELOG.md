# Changelog

All notable changes to the GLOBALISE MCP Server will be documented in this file.

> **Archive:** Versions 1.0.0–1.16.5 (Dec 2025 – Jan 2026) are in `offline/outdated/CHANGELOG-v1.0-v1.16.md`.

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
