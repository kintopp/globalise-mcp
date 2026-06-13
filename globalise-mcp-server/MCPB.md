# Packaging as an MCP Bundle (`.mcpb`)

This server can be distributed as an **MCP Bundle** (`.mcpb`, formerly "Desktop
Extension" / `.dxt`) — a single zip archive that Claude Desktop installs with
one click and runs **locally** over stdio. No Node toolchain, `npm install`, or
manual `claude_desktop_config.json` editing is required of the end user.

- Spec: <https://github.com/anthropics/mcpb> (`MANIFEST.md`, `README.md`, `examples/`)
- Manifest version targeted: **`0.3`**
- CLI used to validate/pack: **`@anthropic-ai/mcpb`** (run via `npx`)

## Two variants: full and thin

The same server code builds two bundles — pick by install size vs. first-run latency:

| | **Full** (`build:mcpb`) | **Thin** (`build:mcpb:thin`) |
|---|---|---|
| `.mcpb` download | ~31 MB | **~3.6 MB** |
| Finding-aid index | bundled, ready instantly | **downloaded on first use** of `globalise_find_archival_documents`, then cached |
| First archival query | instant | one-time ~26 MB fetch + decompress (~112 MB on disk) |
| Other 6 tools | unaffected | unaffected (public APIs / bundled glossaries) |
| Config required | none | a reachable download URL (defaults to a local test server) |

The thin variant adds a runtime download path in `src/utils/database.ts`
(`ensureDatabaseFile()`), triggered **lazily on first DB use** so startup and the
network-backed tools never wait. The full variant never triggers it (the DB is
present), so its behavior is byte-for-byte unchanged. Don't install both at once
— they register the same seven tool names.

## Why this server packages cleanly

A `.mcpb` runs on Claude Desktop's **bundled Node 24** runtime and must be a
self-contained, pure-JavaScript tree (the host won't compile native addons).
This project already meets every prerequisite — the bundle is a *packaging*
exercise, not a code change:

| Requirement | How it's met |
|---|---|
| Pure JS, no native modules | Five runtime deps (`@modelcontextprotocol/{sdk,ext-apps}`, `cors`, `express`, `zod`); SQLite is Node's built-in `node:sqlite` (`better-sqlite3` was removed in v2.5.0) |
| stdio transport | Default transport — `src/index.ts` runs `StdioServerTransport` when `TRANSPORT` is unset |
| Node 24 runtime | `engines.node` `>=24.15.0 <25`, matching Claude Desktop's runtime |
| Read-only, relocatable DB | `node:sqlite` opens with `{ readOnly: true }` (no WAL/SHM writes → works in a read-only install dir); path overridable via `ARCHIVAL_DB_PATH` |
| stdio-safe logging | All diagnostics go to **stderr** (`console.error`); stdout carries only JSON-RPC |
| No secrets | All upstream APIs are public — the manifest declares no required `user_config` |

## What ships in the bundle

The extension root the `.mcpb` unpacks to:

```
manifest.json                 MCPB 0.3 manifest (version stamped from package.json)
package.json                  trimmed: "type": "module" + metadata (server reads version)
dist/                         compiled server + dist/apps/index.html (inlined viewer)
data/archival-index.sqlite    ~112 MB finding-aid index, opened read-only (full only)
data/reference.sqlite         commodities + weights & measures glossaries (both variants)
node_modules/                 production deps only (npm ci --omit=dev)
LICENSE, README.md, .mcpbignore
```

`mcp_config` launches it as:

```json
"command": "node",
"args": ["${__dirname}/dist/index.js"],
"env": {
  "TRANSPORT": "stdio",
  "ARCHIVAL_DB_PATH": "${__dirname}/data/archival-index.sqlite"
}
```

`${__dirname}` is substituted by the host to the install directory, so the DB
path is pinned explicitly rather than relying on `__dirname`-relative
resolution.

### Bundle size

The finding-aid DB dominates: **~112 MB on disk**, but the `.mcpb` zip
recompresses it, so the **download is ~31 MB**. Shipping the DB *decompressed*
(rather than the 26 MB `.gz` + decompress-on-first-run) keeps startup instant
and avoids needing a writable runtime location — the right trade for a local
extension. `.mcpbignore` strips source maps, `.d.ts`, and the lockfile from the
pack (~1,300 files), so only runtime files are shipped.

## Build, validate, test, install

All commands run from `globalise-mcp-server/`.

```bash
# 1. Build + stage + validate + pack  (chains `npm run build` first)
npm run build:mcpb         # full → mcpb-build/globalise-voc-transcriptions-<version>.mcpb
npm run build:mcpb:thin    # thin → mcpb-build/globalise-voc-transcriptions-thin-<version>.mcpb
#    Each rewrites mcpb-build/stage/ (the unpacked tree, kept for inspection).

# 2. (optional) Validate just a manifest against the 0.3 schema
npm run validate:mcpb        # manifest.json
npm run validate:mcpb:thin   # manifest.thin.json

# 3. Smoke-test whichever variant is currently STAGED, over stdio, as Claude
#    Desktop runs it. Auto-detects full vs thin:
npm run test:mcpb
#    full → initialize handshake, served tools == manifest-declared tools,
#           viewer resource, and an offline DB query (bundled index).
#    thin → same, but it spins up a localhost server for the .gz and verifies
#           the FIRST-RUN DOWNLOAD materializes the index and answers the query.

# 4. Install: open the .mcpb file with Claude Desktop (macOS/Windows) and
#    confirm the install dialog. Inspect a built bundle with:
npx -y @anthropic-ai/mcpb info mcpb-build/globalise-voc-transcriptions-*.mcpb
```

### Testing the thin bundle's download in Claude Desktop

The thin manifest defaults its download URL to a **local test server**, so serve
the committed `.gz` while you test:

```bash
# from globalise-mcp-server/ — serve data/ on :8000 (default URL host:port)
python3 -m http.server 8000 --directory data
#   → http://127.0.0.1:8000/archival-index.sqlite.gz
```

Install the thin `.mcpb`, leave the default URL (or point it at your own HTTPS
host), and the first `globalise_find_archival_documents` call downloads the index
into the configured **Data directory** (default `~/.globalise-mcp`). For real
distribution, host `archival-index.sqlite.gz` on any HTTPS URL (e.g. a GitHub
release asset) and set that as the default.

`build:mcpb` is reproducible: it wipes `mcpb-build/`, re-stages, runs
`npm ci --omit=dev` for a clean production `node_modules`, stamps the manifest
`version` from `package.json` (single source of truth), and re-validates inside
`mcpb pack`.

> `mcpb-build/` is a generated artifact directory (the `.mcpb` plus the ~124 MB
> staged tree). It is not committed; add it to `.gitignore` if you keep builds
> around locally.

## Runtime behaviour & security posture

- **Local process, full network egress.** The Node server itself fetches
  transcription search, page retrieval, and IIIF images from the public
  GLOBALISE / Nationaal Archief endpoints at request time. Only the finding-aid
  index (`globalise_find_archival_documents`) is answered fully on-device.
- **Viewer CSP.** The document-viewer MCP App (an iframe) declares its allowed
  `resourceDomains` / `connectDomains` in `src/index.ts` (IIIF + the GLOBALISE
  APIs). This constrains the *iframe*, not the Node process.
- **Read-only data.** The bundled SQLite index is opened read-only; the
  extension writes nothing to its install directory.
- **No credentials.** Nothing in `user_config` is required or `sensitive`.

### Optional user configuration

Surfaced by Claude Desktop at install time, all optional:

| Key | Type | Default | Variant | Effect |
|---|---|---|---|---|
| `debug_logging` | boolean | `false` | both | Sets `DEBUG=true` → per-tool diagnostic lines on stderr (incl. download progress) |
| `structured_content` | boolean | `true` | both | Sets `STRUCTURED_CONTENT` → include machine-readable `structuredContent` (disable only for hosts that reject it) |
| `archival_db_url` | string | local test server | thin | Sets `ARCHIVAL_DB_URL` → where the index `.gz`/`.sqlite` is fetched on first use |
| `data_directory` | string | `~/.globalise-mcp` | thin | Sets `ARCHIVAL_DB_PATH` → writable folder the downloaded index is cached in |

## Relationship to the HTTP deployment

Same server, two transports. `createServer()` in `src/index.ts` is
transport-agnostic: stdio for this bundle, Streamable HTTP for the Railway
deployment (`TRANSPORT=http`). The `.mcpb` therefore tracks the same code and
version as production with no fork.

## Not yet done (polish)

- **Icon.** `manifest.json` declares no `icon`; add an `icon.png` and the field
  for a nicer install dialog.
- **Signing.** Bundles are unsigned (`mcpb info` warns). `mcpb sign` adds an
  X.509 signature so the host can show a verified (or self-signed) publisher;
  `--self-signed` proves integrity only, a CA cert proves identity. Optional —
  Claude Desktop installs unsigned bundles with an extra confirmation.
- **Thin-bundle hosting.** The thin variant works (downloads on first run), but
  its default URL targets a local test server. For real distribution, publish
  `archival-index.sqlite.gz` to a stable HTTPS URL (e.g. a GitHub release asset)
  and set it as the manifest default.
