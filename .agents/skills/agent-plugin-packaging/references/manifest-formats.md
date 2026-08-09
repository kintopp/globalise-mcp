# Manifest formats

Four files, two formats, one shared `skills/` directory. Verified against the
published agent-plugins.org 1.0.0 schemas and `openai/plugins` on 2026-08-06.

## Package layout

```
<plugin-root>/
├── plugin.json                  # agent-plugins.org: identity
├── mcp.json                     # agent-plugins.org: runtime wiring
├── .codex-plugin/plugin.json    # Codex-native: identity + UI
├── .mcp.json                    # Codex-native: runtime wiring
├── skills/<skill-name>/
│   ├── SKILL.md
│   └── references/*.md          # copy recursively
├── LICENSE
└── README.md
```

The two formats never collide because every filename differs. A client reads
only the pair it recognises and ignores the other.

## Why identity and wiring are separate files

This split is the spec's, not a stylistic choice, and it earns its keep:

- **Absence is the signal.** A skills-only plugin has no `mcp.json`; an
  MCP-only plugin has no `skills/`. No null fields to interpret.
- **Independent failure.** Each file declares its own `$schema`; a version
  mismatch on `mcp.json` invalidates only the MCP configuration, leaving the
  skill loadable.
- **Different readers, different trust.** Identity is parsed at discovery time
  to render a list. Wiring is parsed by the component that opens network
  connections and spawns processes. A client can enumerate every installed
  plugin without touching process-spawning config.

## `plugin.json` — agent-plugins.org

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "your-plugin-name",
  "version": "0.1.0",
  "description": "One line.",
  "author": { "name": "…" },
  "homepage": "https://…",
  "repository": "https://github.com/owner/repo",
  "license": "MIT",
  "keywords": ["…"]
}
```

Constraints that bite:

- **`additionalProperties: false`.** Only `name`, `version`, `description`,
  `author`, `homepage`, `repository`, `license`, `keywords`, `extensions` are
  permitted. Anything else fails validation.
- **`name` must match `^[a-z0-9][a-z0-9.-]*[a-z0-9]$`** with no `--` or `..`.
- **`repository` is a *string*.** If you are mapping from an `.mcpb`
  `manifest.json`, that models it as an object — map `repository.url`.
- Vendor-specific data goes under `extensions["com.vendor.key"]`, not at top level.

## `mcp.json` — agent-plugins.org

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "your-server": {
      "type": "streamable-http",
      "url": "https://your-endpoint.example/mcp"
    }
  }
}
```

Transports: `stdio`, `streamable-http`, `sse`.

**Do not declare both a stdio and a remote entry in one file.** `mcpServers` is
a map and a client will start every entry, duplicating your whole tool surface.

**Prefer `streamable-http` for v1.** Zero install, no build step, works on any
conformant client. The costs are real but bounded: all traffic lands on your
deployment and you own the uptime.

**stdio is legal but usually blocked.** `command` must be a single executable
token, so `npx -y your-server` requires the package to actually be published.
The alternative — `node ${PLUGIN_ROOT}/dist/index.js` — means shipping a
prebuilt tree, and the spec defines no build hook, so you would be re-solving
whatever your existing bundle packaging already solves.

## `.codex-plugin/plugin.json` — Codex-native

Same identity fields (no `$schema`), plus three keys the standard forbids:

```json
{
  "name": "your-plugin-name",
  "version": "0.1.0",
  "…": "…identity fields as above…",
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "category": "Education & Research",
    "longDescription": "…",
    "capabilities": ["…"],
    "samplePrompts": ["…"]
  }
}
```

`interface` is the only hand-authored content in the package — category,
capabilities, sample prompts have no source elsewhere. **`category` is drawn
from a fixed set.** An invalid value does not error; the plugin silently never
appears. Confirm the exact string against a real marketplace
(`openai/plugins` at `.agents/plugins/marketplace.json`) rather than guessing a
plausible one.

## `.mcp.json` — Codex-native

```json
{ "mcpServers": { "your-server": { "type": "http", "url": "https://…/mcp" } } }
```

Note `"http"`, not `"streamable-http"`, for the same transport.

## What has no equivalent

Mapping from a richer bundle manifest, these drop or move:

- **User configuration has no slot at all.** Typed user options (data
  directories, debug flags) cannot be expressed. For stdio plugins
  `${PLUGIN_DATA}` covers a data directory; everything else becomes a hardcoded
  env value. For a remote server the question is moot — configuration is
  server-side.
- **No `display_name`, `long_description`, `tools[]`, `compatibility`
  (platforms/runtime versions), or privacy policy links.** Push them into
  `extensions[…]`, the Codex `interface` block, or the README.

## Origin / CORS

A remote server behind an origin allowlist needs checking, not assuming.
Non-browser clients send **no** `Origin` header; confirm your guard admits an
absent origin rather than rejecting it. Browser-based clients on a new domain
will 403 until that domain is allowlisted.
