# GLOBALISE MCP Server

An MCP server for searching and retrieving ~4.8M transcribed pages from the Dutch East India Company (VOC) archives, provided by the [GLOBALISE project](https://globalise.huygens.knaw.nl/).

## Tools

Ask your AI assistant a question in natural language, and will automatically choose and combine the ten tools below to answer (often chaining several together in sequence).

**`globalise_search_transcriptions`** — Searches the full text of all ~4.8 million transcribed pages for a word or phrase, much like a regular keyword search of a digitised archive, and returns the best-matching passages with the search terms highlighted. It can narrow by inventory number or language and combine terms with `AND`/`OR`/`NOT`, quoted phrases, wildcards, and fuzzy matching (the latter helps to catch HTR errors and the inconsistent orthography typical of early-modern Dutch). This also helps address historical variants (the two glossary tools below assist with exactly this).

**`globalise_retrieve_document`** — Fetches a single page when you already have its identifier (for example `NL-HaNA_1.04.02_9966_0106`), returns the complete transcription line by line together with its metadata: languages, dates, and rights statement. It also reports the identifiers of the preceding and following pages and provides links to the GLOBALISE transcription viewer and the original scan held by the Dutch National Archives.

**`globalise_navigate`** — Moves one page forward or backward from a given page, so you can read through a volume in sequence instead of jumping between scattered search results. It returns the neighbouring page in full — transcription, metadata, and links — and tells you when you have reached the beginning or end of the run.

**`globalise_find_archival_documents`** — Searches a local TANAP index of more than 228,000 finding-aid entries — the catalogue level that sits above the page transcriptions — so you can locate the right inventories before reading any pages. It covers two bodies of material: the OBP digitised indexes (some 227,000 entries recording, for each set of papers, the VOC settlement it came from, the year, and the inventory and folio) and the roughly 950 Generale Missiven, the governors-general's official dispatches from Batavia to the Dutch Republic, many of which link to their scholarly published edition (the RGP series). The inventory numbers it returns can be passed straight to a transcription search to reach the actual pages.

**`globalise_lookup_commodity`** — Looks up a trade good in a glossary of about 3,500 VOC commodities, returning the Dutch term the clerks actually used (so *mace* resolves to *foelie* and *coffee* to *koffie*), an English label, and a sourced, confidence-rated definition. It serves as the bridge between a modern vocabulary and the words to search for in the historical transcriptions; some entries also list period spelling variants, and every result can return a link to the concept's page in the official GLOBALISE commodities thesaurus. N.B. more than half of the definitions are AI-generated and labelled as such.

**`globalise_lookup_measure`** — Looks up a historical VOC unit of weight, volume, length, or area — some 213 units drawn from a 1764–1771 reference work — and returns its category, its period spelling variants, and the conversion ratios recorded for it. It is deliberately not a conversion calculator: early-modern measures were unstable, so a *bahar* of pepper was not a *bahar* of cloves, and each ratio is tied to the particular place and commodity it was recorded for (given in a context note). Its value lies in recovering the spellings to search for and understanding what a unit meant in a given trade, rather than in converting to modern metric values.

**`globalise_view_document_ui`** — Opens a page in an interactive viewer that sets the zoomable, high-resolution scan of the original manuscript beside its line-numbered transcription, letting you check the machine reading against the original text. Search terms can be highlighted, and selecting a passage in the transcription is a natural way to ask the assistant for a modern rendering of the early-modern Dutch.

**`globalise_inspect_page_image`** — Fetches a page scan, or a region of it, as an image for the assistant itself to look at. In the viewer, press `i` (or the ☐ button) and drag a box over the scan: the assistant receives the coordinates, retrieves that crop of the original image, and can re-transcribe or describe exactly what you marked — a second opinion on the machine transcription for garbled names, numerals, marginalia, or non-Latin scripts. The assistant can also zoom into a page by itself when you ask about a specific detail.

**`globalise_navigate_viewer`** — Lets the assistant steer an open viewer: zoom it to a region to direct your attention to a detail. When you ask the assistant about a passage it inspects, the viewer auto-zooms to match. A companion internal tool, `globalise_poll_viewer_commands`, is the viewer's own polling channel that delivers those commands to the open page — it is not something you call directly.

## Resources

| URI | Description |
|-----|-------------|
| `ui://globalise/document-viewer.html` | MCP Apps document viewer (HTML, served to host iframes) |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRANSPORT` | `stdio` | `http` for Streamable HTTP mode |
| `PORT` | `3000` | HTTP port |
| `MCP_ALLOWED_ORIGINS` | claude.ai/claude.com/chatgpt.com | **Enforced** Origin guard: rejects non-allowlisted browser origins with HTTP 403 (spec MUST, DNS-rebinding mitigation). Exact origins or `*.domain` globs; `*` disables. |
| `ALLOWED_ORIGINS` | `*` | **Advisory** CORS allowlist — sets `Access-Control-Allow-Origin` response headers only; rejects nothing. Comma-separated; `*` allows all. This is a *separate* var from `MCP_ALLOWED_ORIGINS`: tightening the 403 guard does **not** tighten CORS headers, and vice versa. |
| `STRUCTURED_CONTENT` | `true` | Set `false` to strip `outputSchema`/`structuredContent` for clients that reject them (MSTY, Jan.ai) |

## Quick Start

**Hosted instance** (no setup required):
```
https://globalise-mcp-production.up.railway.app/mcp
```

**Local** (requires **Node 24** — the server uses the built-in `node:sqlite`):

stdio:
```bash
npm install && npm run build && node dist/index.js
```

HTTP:
```bash
TRANSPORT=http PORT=3000 node dist/index.js
```

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "globalise": {
      "command": "node",
      "args": ["/absolute/path/to/globalise-mcp-server/dist/index.js"]
    }
  }
}
```

## Development

```bash
npm run build       # Viewer UI + TypeScript + archival index DB
npm run dev         # tsc watch mode
npm run inspector   # Build + run against MCP Inspector
npm test            # Full offline suite (version-sync, FTS, SQLite tools, viewer, smoke, HTTP shutdown)
npm run test:live   # Opt-in: live integration tests for search/retrieve/navigate (network required)
```

## CLI

`scripts/cli.mjs` (`glob-mcp`) is a headless MCP **client** over this server's stateless tools. A CLI
query and an LLM query call the *same* `callTool()` on the *same* server, so results are identical — it
doubles as a `jq`-friendly pipe, an offline debug harness, and an agent bootstrap. JSON-first output:
list tools → JSONL, single-object tools → one compact JSON; counts/notes go to stderr. Four tools
(`globalise_view_document_ui`, `globalise_inspect_page_image`, `globalise_navigate_viewer`,
`globalise_poll_viewer_commands`) are excluded — the viewer and the two session tools need the MCP-App
iframe, and the image tool returns base64 bytes for the model, none of which is meaningful headless.
Exit codes: `0` ok · `1` tool/connection error · `2` usage error.

### Install (CLI-only, via `just`)

The CLI ships with a [`justfile`](justfile) of setup/run recipes. [`just`](https://github.com/casey/just)
is a small command runner — install it per OS:

**macOS**
```bash
brew install just
```

**Linux**
```bash
sudo apt install just      # Debian 13+ / Ubuntu 24.04+
sudo dnf install just      # Fedora
sudo pacman -S just        # Arch
# older distros / latest release → prebuilt binaries + cargo: https://github.com/casey/just#installation
```

**Windows** (PowerShell)
```powershell
winget install --id Casey.Just --exact   # or: scoop install just  /  choco install just
```

Then, from `globalise-mcp-server/`:
```bash
just            # list the recipes
just setup      # stdio (default): install deps + build (decompresses the local DBs) — run once
just deps       # http-only: install just the npm deps (the MCP SDK); skips the build + DBs
```

No `just`? The recipes are thin wrappers — `npm install` / `npm run build`, then `node scripts/cli.mjs …`
(or `npm run cli -- …`) work identically.

### Transports & requirements

The CLI defaults to **stdio** (spawns `node dist/index.js` locally). Pass `--http <url>` (or set
`GLOBALISE_MCP_HTTP`) to drive a running server instead — e.g. the hosted Railway instance, no local
build required.

| | **stdio** (default) | **http** (`--http <url>`) |
|---|---|---|
| Setup recipe | `just setup` | `just deps` |
| Node.js | 24.x | 24.x |
| Local build (`dist/`) | required | — |
| Local DBs (~115 MB) | required (build decompresses them) | — |
| Network | only `search` / `retrieve` / `navigate`; `find` / `commodity` / `measure` run offline | always (to the remote server) |
| Best for | fully local use, offline finding-aid + glossary lookups | quickest start, no 115 MB build |

### Usage

```bash
# stdio (after `just setup`): glob-mcp spawns node dist/index.js
just cli search "peper" --inventoryNumber 9966 --max 5 --fields id,document
just cli retrieve NL-HaNA_1.04.02_9966_0106 --json
just cli find "Amsterdam" --source gm --chamber Amsterdam --max 5 --table
just cli commodity "mace" --fields prefLabelNl,prefLabelEn
just cli navigate NL-HaNA_1.04.02_9966_0106 --direction next --fields targetDocument

# http (after `just deps`): point at a running server — instant, no local build
just http https://globalise-mcp-production.up.railway.app/mcp search "nootmuskaat" --max 3
GLOBALISE_MCP_HTTP=https://globalise-mcp-production.up.railway.app/mcp just cli find "Batavia"

# discovery / dry-run / batch
just cli --help                       # offline-safe usage + command list
just cli search --help                # schema-derived flags + a worked example
just cli tools --compact              # compact capability manifest (agent bootstrap)
just cli --show-call search "peper"   # resolve {tool, arguments} without calling
printf 'peper\nfoelie\n' | just cli commodity --stdin --max 2 --fields prefLabelNl
```

Flags pass straight through `just` to the CLI, and `just`'s command-echo goes to stderr, so `just cli`
stays pipe-safe (pure JSONL on stdout). `just test` (`npm run test:cli`) smoke-tests the CLI — out of the
default `npm test` chain, since it needs `dist/` + DBs + network.

## Project Structure

```
src/
├── index.ts                 # Entry point, tool + resource registration
├── tools/                   # Tool implementations (search, document, viewer, archival-index)
├── transports/http-server.ts  # Streamable HTTP transport
└── utils/                   # API client, cache, SQLite, IIIF, types
apps/
└── document-viewer/         # Interactive viewer (Vite SPA, bundled at build)
scripts/
└── cli.mjs                  # Headless MCP-client CLI (glob-mcp bin); test-cli.ts smoke-tests it
justfile                     # `just` recipes for the CLI: setup / deps / cli / http / test
```

## Authors

[Arno Bosse](https://orcid.org/0000-0003-3681-1289) — [RISE](https://rise.unibas.ch/), University of Basel, with [Claude Code](https://claude.com/product/claude-code), Anthropic.

The VOC transcriptions, finding aids, and vocabularies served by this software are produced by the [GLOBALISE project](https://globalise.huygens.knaw.nl/) at the Huygens Institute (KNAW) and made available under [CC0](https://creativecommons.org/publicdomain/zero/1.0/); the commodities and weights-&-measures glossaries are licensed CC-BY-SA-4.0 by their respective compilers.

## Citation

If you use the GLOBALISE MCP Server in your research, please cite it as follows (and cite the underlying GLOBALISE transcriptions separately — see the citation note in the [API documentation](../globalise-transcriptions-api/README.md#license--citation)):

**APA (7th ed.)**

> Bosse, A. (2026). *GLOBALISE MCP Server* (Version 2.10.6) [Software]. Research and Infrastructure Support (RISE), University of Basel. https://github.com/kintopp/globalise-mcp

**BibTeX**
```bibtex
@software{bosse_2026_globalise_mcp,
  author    = {Bosse, Arno},
  title     = {{GLOBALISE MCP Server}},
  year      = {2026},
  version   = {2.10.6},
  publisher = {Research and Infrastructure Support (RISE), University of Basel},
  url       = {https://github.com/kintopp/globalise-mcp},
  orcid     = {0000-0003-3681-1289},
  note      = {Developed with Claude Code (Anthropic, \url{https://www.anthropic.com})}
}
```

A machine-readable [`CITATION.cff`](CITATION.cff) is included in this directory.

## License

MIT
