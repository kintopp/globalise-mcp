# Packaging as an MCP Bundle (`.mcpb`)

This server can be distributed as an **MCP Bundle** (`.mcpb`, formerly "Desktop
Extension" / `.dxt`) — a single zip archive that Claude Desktop installs with
one click and runs **locally** over stdio. No Node toolchain, `npm install`, or
manual `claude_desktop_config.json` editing is required of the end user.

- Spec: <https://github.com/anthropics/mcpb> (`MANIFEST.md`, `README.md`, `examples/`)
- Manifest version targeted: **`0.3`**
- CLI used to validate/pack: **`@anthropic-ai/mcpb`** (run via `npx`)

## One bundle: the index is fetched on first use

There is a **single** `.mcpb`. The ~112 MB archival finding-aid index is *not*
baked in — the server downloads it once, lazily, and caches it on-device:

| | |
|---|---|
| `.mcpb` download | **~3.6 MB** |
| Finding-aid index | **downloaded on first use** of `globalise_find_archival_documents`, then cached |
| First archival query | one-time ~26 MB fetch + decompress (~112 MB on disk) |
| Commodities + measures glossaries | bundled, queried on-device |
| Every other tool | unaffected — public APIs, no wait on the download |
| Config required | none (the download URL defaults to the project's hosted server) |

The download path lives in `src/utils/database.ts` (`ensureDatabaseFile()`) and
is triggered **lazily on first DB use**, so startup and the network-backed tools
never wait on it.

> **History.** Until 2026-08-04 this built two bundles: a "full" one that baked
> the index in (~31 MB download) and a "thin" one that didn't, from
> `manifest.json` and `manifest.thin.json` respectively. The full variant was
> retired, `manifest.thin.json` became `manifest.json`, and `build:mcpb:thin` /
> `validate:mcpb:thin` were removed. `scripts/build-mcpb.ts` takes no variant
> argument any more.

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
data/reference.sqlite         commodities + weights & measures glossaries, read-only
node_modules/                 production deps only (npm ci --omit=dev)
LICENSE, README.md, .mcpbignore
```

The archival index is absent by design; it lands in the user's **data
directory** on first use, not in the install tree.

`mcp_config` launches it as:

```json
"command": "node",
"args": ["${__dirname}/dist/index.js"],
"env": {
  "TRANSPORT": "stdio",
  "ARCHIVAL_DB_PATH": "${user_config.data_directory}/archival-index.sqlite",
  "ARCHIVAL_DB_URL": "${user_config.archival_db_url}",
  "ARCHIVAL_DB_TOKEN": "${user_config.archival_db_token}",
  "STRUCTURED_CONTENT": "${user_config.structured_content}",
  "DEBUG": "${user_config.debug_logging}"
}
```

`${__dirname}` is substituted by the host to the install directory. Note the DB
path points at the **user_config data directory**, not `${__dirname}` — the
install tree may be read-only, and the downloaded index needs somewhere
writable.

### Bundle size

With the index out of the tree, `node_modules/` and the compiled server
dominate: the **download is ~3.6 MB**. `.mcpbignore` strips source maps,
`.d.ts`, and the lockfile from the pack (~1,300 files), so only runtime files
ship. The trade is a one-time ~26 MB fetch the first time archival search is
used; every other tool is unaffected, and `node:sqlite` opens the cached index
read-only.

## Build, validate, test, install

All commands run from `globalise-mcp-server/`.

```bash
# 1. Build + stage + validate + pack  (chains `npm run build` first)
npm run build:mcpb    # → mcpb-build/globalise-voc-transcriptions-<version>.mcpb
#    Rewrites mcpb-build/stage/ (the unpacked tree, kept for inspection).

# 2. (optional) Validate the manifest against the 0.3 schema
npm run validate:mcpb        # manifest.json

# 3. Smoke-test the STAGED bundle over stdio, as Claude Desktop runs it:
npm run test:mcpb
#    initialize handshake, served tools == manifest-declared tools, the viewer
#    resource, and — because the index is not bundled — it spins up a localhost
#    server for the .gz and verifies the FIRST-RUN DOWNLOAD materializes the
#    index and answers the query.

# 4. Install: open the .mcpb file with Claude Desktop (macOS/Windows) and
#    confirm the install dialog. Inspect a built bundle with:
npx -y @anthropic-ai/mcpb info mcpb-build/globalise-voc-transcriptions-*.mcpb
```

### Testing the first-run download in Claude Desktop

The manifest's download URL defaults to the project's Railway deployment
(`https://globalise-mcp-production.up.railway.app/archival-index.sqlite.gz`,
served by `src/transports/http-server.ts`), so a fresh install works with no
setup. To test against a local copy instead, serve the committed `.gz` and
override the URL at install time:

```bash
# from globalise-mcp-server/ — serve data/ on :8000
python3 -m http.server 8000 --directory data
#   → http://127.0.0.1:8000/archival-index.sqlite.gz
```

Install the `.mcpb` and the first `globalise_find_archival_documents` call
downloads the index into the configured **Data directory** (default
`~/.globalise-mcp`). Both a gzipped `.gz` and a raw `.sqlite` are accepted —
gzip is auto-detected.

`build:mcpb` is reproducible: it wipes `mcpb-build/`, re-stages, runs
`npm ci --omit=dev` for a clean production `node_modules`, stamps the manifest
`version` from `package.json` (single source of truth), and re-validates inside
`mcpb pack`.

> `mcpb-build/` is a generated artifact directory (the `.mcpb` plus the staged
> tree). It is gitignored, not committed.

## Runtime behaviour & security posture

- **Local process, full network egress.** The Node server itself fetches
  transcription search, page retrieval, and IIIF images from the public
  GLOBALISE / Nationaal Archief endpoints at request time. The finding-aid index
  and the two glossaries are answered fully on-device — the index after its
  one-time download, the glossaries from the bundled `data/reference.sqlite`.
- **Viewer CSP.** The document-viewer MCP App (an iframe) declares its allowed
  `resourceDomains` / `connectDomains` in `src/index.ts` (IIIF + the GLOBALISE
  APIs). This constrains the *iframe*, not the Node process.
- **Read-only data.** The bundled SQLite index is opened read-only; the
  extension writes nothing to its install directory.
- **No credentials.** Nothing in `user_config` is required or `sensitive`.

### Optional user configuration

Surfaced by Claude Desktop at install time, all optional:

| Key | Type | Default | Effect |
|---|---|---|---|
| `debug_logging` | boolean | `false` | Sets `DEBUG=true` → per-tool diagnostic lines on stderr (incl. download progress) |
| `structured_content` | boolean | `true` | Sets `STRUCTURED_CONTENT` → include machine-readable `structuredContent` (disable only for hosts that reject it) |
| `archival_db_url` | string | the Railway deployment's `/archival-index.sqlite.gz` | Sets `ARCHIVAL_DB_URL` → where the index `.gz`/`.sqlite` is fetched on first use |
| `archival_db_token` | string | *(empty)* | Sets `ARCHIVAL_DB_TOKEN` → optional Bearer token, only needed if the download URL requires auth |
| `data_directory` | string | `~/.globalise-mcp` | Sets `ARCHIVAL_DB_PATH` → writable folder the downloaded index is cached in |

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
- **Index hosting.** The default download URL is the project's Railway
  deployment, which serves `data/archival-index.sqlite.gz` straight from the
  deployed tree — so the hosted index tracks whatever is on `main`, with no
  version pinning or checksum on the wire. A dedicated, versioned artifact host
  would be more robust for wide distribution.
