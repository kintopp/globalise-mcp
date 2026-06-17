# GLOBALISE MCP Server

An MCP server for searching and retrieving ~4.8M transcribed pages from the Dutch East India Company (VOC) archives, provided by the [GLOBALISE project](https://globalise.huygens.knaw.nl/).

## Tools

| Tool | Purpose |
|------|---------|
| `globalise_search_transcriptions` | Full-text search across all transcriptions, with inventory and language filters (incl. `matchAll` for bilingual documents) |
| `globalise_retrieve_document` | Retrieve a document by ID |
| `globalise_navigate` | Browse to next/previous page |
| `globalise_find_archival_documents` | Query 228K+ archival document indexes |
| `globalise_lookup_commodity` | Resolve a trade good to its Dutch label, definition, and period spelling variants |
| `globalise_lookup_measure` | Look up a VOC weight/measure unit — type, spelling variants, and period conversion ratios |
| `globalise_view_document_ui` | Interactive viewer with page scan and transcription |

## Resources

| URI | Description |
|-----|-------------|
| `ui://globalise/document-viewer.html` | MCP Apps document viewer (HTML, served to host iframes) |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRANSPORT` | `stdio` | `http` for Streamable HTTP mode |
| `PORT` | `3000` | HTTP port |
| `MCP_ALLOWED_ORIGINS` | claude.ai/claude.com/chatgpt.com | Origin allowlist for `/mcp` (exact origins or `*.domain` globs; `*` disables) |
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
list tools → JSONL, single-object tools → one compact JSON; counts/notes go to stderr. The viewer tool
(`globalise_view_document_ui`) is excluded — it needs the MCP-App iframe and isn't meaningful headless.
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

## License

MIT
