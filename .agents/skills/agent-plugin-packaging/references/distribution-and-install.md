# Distribution and install routes

Client behaviour below was verified on **2026-08-09** against Codex CLI
**0.145.0** and **0.147.0**, and ChatGPT desktop **26.803.41515**. Re-check
before relying on it; this surface moves between minor releases.

## The desktop app and the CLI are one system

ChatGPT desktop embeds the Codex engine (`Contents/Resources/codex`, reporting
`codex-cli 0.147.0-alpha.6.5`) and reads the **same** `~/.codex/config.toml`.
Consequences:

- Installing a plugin from the CLI also installs it for the desktop app. They
  are not two loaders exercising the same files; they are one binary reading one
  config.
- The app ships its own bundled marketplace inside the bundle
  (`Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json`),
  staged into the shared config. That vendoring route is available to the
  vendor only — do not plan around it.

## The marketplace file

At the **repo root**, `.agents/plugins/marketplace.json`:

```json
{
  "name": "your-marketplace-name",
  "interface": { "displayName": "Human readable" },
  "plugins": [
    {
      "name": "your-plugin-name",
      "source": { "source": "local", "path": "./path/to/plugin-root" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Education & Research"
    }
  ]
}
```

- `path` resolves **relative to the repo root**, not to `.agents/plugins/`.
- `"source": "local"` means *vendored inside this marketplace*, not "on the
  user's machine". This is why one file serves both a local directory and a Git
  clone unchanged.
- The marketplace registers under its `name` field, not its directory name.
- A plugin's directory name need **not** match its plugin name. (OpenAI's own
  repo keeps them identical, so a mismatch is a reasonable first suspect when a
  plugin fails to appear — but it is not a requirement.)

## Route 1 — local path (development)

```bash
codex plugin marketplace add /path/to/repo    # registers by marketplace `name`
codex plugin list                             # discovery check
codex plugin add <plugin>@<marketplace>       # install
codex plugin remove <plugin>@<marketplace>
codex plugin marketplace remove <marketplace>
```

All are non-interactive and scriptable — an agent can drive an end-to-end
install without touching the interactive `/plugins` UI. `codex plugin list
--json --available` gives machine-readable output including uninstalled entries.

## Route 2 — Git repo as a marketplace (the main answer)

`codex plugin marketplace add` accepts **a local path, `owner/repo[@ref]`, an
HTTPS Git URL, or an SSH Git URL**, with `--ref` to pin and `--sparse` to limit
the checkout. So publishing means: commit the plugin tree and the marketplace
file to the default branch, and tell people the repo.

This is how the official catalog itself is distributed — `openai-curated` is
`github.com/openai/plugins`, carrying `.agents/plugins/marketplace.json` at its
root with exactly the shape above.

## Route 3 — in-app install (the no-terminal path)

ChatGPT desktop has a shipped Apps page with a "Browse plugins or skills"
toggle, an "Install plugin" action, and a dialog whose literal English copy is:

> **Add plugin marketplace**
> Add from a GitHub repo, Git URL, or local folder. *Learn more*

with a **Git ref** field (placeholder `main`), plus success / already-added /
failed states. It is localised into roughly forty languages, which is the signal
that it is end-user UI rather than a developer affordance.

**So the instruction for a non-technical user is:** open the desktop app → Apps
→ Add plugin marketplace → paste the GitHub repo URL → install the plugin. Two
dialogs, no terminal, and it delivers **both** the server and the skill.

Unlike a downloaded bundle, this is a live pointer: re-installs track the repo.

## Route 4 — publication

Submitting through the plugin submission portal lists the plugin in the
directory shared by the CLI and the app, so users install without adding any
marketplace. Broadest reach, but a review process — not something to do from an
experiment branch.

## Partial routes (each loses half the payload)

**`.skill` files are double-clickable.** The desktop app exports the UTI
`com.openai.codex.skill` (extension `.skill`, MIME
`application/vnd.openai.codex.skill`) and prompts **"Install this skill"**. This
is the closest thing to a double-click installer — but it carries **no MCP
configuration**. The user gets your research method with none of your tools.

**Web/mobile custom connectors.** Browser ChatGPT has no filesystem and cannot
see a local plugin, but reaches a remote server directly: Settings → Apps →
Advanced → Developer mode → Create, paste the endpoint URL, authentication as
appropriate. The user gets the tools and **not** the skill. Requires a paid
tier; workspace admins can disable it.

**There is no single double-clickable artifact carrying both.** When asked for a
`.mcpb` equivalent, say this plainly and offer route 3.

## The version cache

Installs land in `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/` and
are keyed by version.

- Editing the source tree does **not** update an existing install. Bump the
  version, or `plugin remove` then re-add. Otherwise you test a stale copy and
  conclude the wrong thing.
- Downstream, **users only receive updates when the version string changes.**
  If your repo treats the manifest version as a best-effort fallback (git tags
  primary), plugin consumers will be stranded on whatever was current at install
  time. Either derive the plugin version from the same resolver the server uses
  for its own reported version, or fold an explicit bump into the release.

## Client state written on install

`codex plugin add` writes only:

```toml
[marketplaces.<name>]
last_updated = "…"
source_type  = "local"        # or a git kind
source       = "/path/or/url"

[plugins."<plugin>@<marketplace>"]
enabled = true
```

It never writes an `mcp_servers` block — plugin-contributed servers are
**virtual**, materialised at session start. They nonetheless appear in the
client's server listing, which is what makes them indistinguishable from
manually configured ones. See `verification-recipes.md`.

In-session, skills are namespaced **`<plugin>:<skill>`**.
