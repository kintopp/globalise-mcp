# Verification recipes

Because the format is undocumented in places and changes between minor releases,
every claim needs a check that could have failed. These are the checks.

## Order of operations

1. **Client version.** `codex --version`. Behaviour differs across minors;
   any finding you record is scoped to a version.
2. **Schema validity** of the standard manifests:
   `npx -y ajv-cli@5 validate --spec=draft2020 -s plugin.schema.json -d plugin.json`
   (fetch the schemas from the `$schema` URLs). This catches the
   `additionalProperties: false` violations, which are otherwise invisible.
3. **Endpoint reachability the way the client sends it** — for a remote server,
   POST an MCP `initialize` with **no `Origin` header** and
   `Accept: application/json, text/event-stream`. Confirms your origin guard
   admits absent origins before you blame the packaging.
4. **Install ladder** — discovery, install, cache contents, session presence.
   Each rung can fail independently; do not skip to the last.

## Install ladder

```bash
codex plugin marketplace add /path/to/repo
codex plugin list                       # rung 1: does it appear at all?
codex plugin add <plugin>@<marketplace> # rung 2: does it install?
find ~/.codex/plugins/cache/<marketplace>/<plugin>/<version> -type f  # rung 3: is the payload complete?
```

Rung 3 matters more than it looks: a plugin whose skill lost its `references/`
installs cleanly and reports success. Only the file listing shows the loss.

Rung 4 is a live session. Ask the client, without tool use, to list its
available skills. Presence of `<plugin>:<skill>` is the proof.

## The confound: shared observables prove nothing

The trap that invalidates naive checks: **a plugin's MCP server appears in the
client's server listing, and so does a manually configured one.** If a user
already declared the same server under the same key, the listing looks identical
whether or not the plugin contributed anything.

Rule: test something **only the plugin can supply**. The skill is usually that
thing, because skills have no separate configuration path. Where the skill is
also ambiguous, build a probe.

## The probe plugin

To determine *which* format a client reads — or to isolate any single
contribution — construct a minimal plugin containing **only** the variables
under test, with **unique names** so every observation is attributable.

```
probe-root/
├── .agents/plugins/marketplace.json      # name: probe-market
└── probe-plugin/
    ├── plugin.json                       # standard only — no .codex-plugin/
    ├── mcp.json                          # standard only — no .mcp.json
    └── skills/probe-skill/SKILL.md       # unique name + a unique marker string
```

Give it a distinct version (`0.0.1`), a distinct server key, a distinct skill
name, and a marker string in the skill body. Then:

- **Version reported on install** tells you which manifest was parsed — if the
  only manifest present is the standard one and the client reports its version,
  the standard manifest was read.
- **Skill appearing in-session, printing its marker** proves the standard
  `skills/` path is honoured.
- **The uniquely-keyed server appearing in the listing** proves the standard
  `mcp.json` is honoured, without the confound above.

Remove the probe afterwards (`plugin remove`, `marketplace remove`) and confirm
no residue remains in the client config.

This technique generalises: when two hypotheses predict the same observation
from existing state, build the smallest artifact only one hypothesis explains.
That is cheaper and more reliable than reasoning harder about ambiguous evidence.

## Inspecting a desktop client for capabilities

To answer "can a non-technical user install this without a terminal?", read the
shipped app rather than the documentation:

- **`Info.plist` → `CFBundleDocumentTypes` / `UTExportedTypeDeclarations`** lists
  the file types the app claims. This is what makes a file double-clickable, and
  its absence is conclusive: no registered type means no double-click install.
- **`Info.plist` → `CFBundleURLTypes`** lists URL schemes, i.e. whether
  "add to app" deep links are possible.
- **UI strings in the app's bundled JavaScript** reveal shipped user-facing
  flows. Search for `defaultMessage` / i18n descriptor strings. Localisation
  into many languages distinguishes shipped end-user UI from developer-only or
  half-built affordances.
- **Embedded binaries** in `Contents/Resources` reveal whether a GUI app is a
  front end over a CLI engine — run the embedded binary's `--version` and
  compare config paths.

Keep these greps narrow and anchored; broad regexes over a large bundle either
time out or exceed the regex engine's complexity limits.

## Recording findings

State the version and date with the claim. "Codex reads the standard layout" is
useless six weeks later; "Codex CLI 0.147.0 reads the standard layout, verified
2026-08-09 via a standard-only probe" survives.

Distinguish three grades explicitly, because they are treated differently later:

- **verified** — a check that could have failed, and did not
- **inferred** — consistent with strong evidence, not directly exercised
- **assumed** — taken from documentation, untested

Never silently promote the second or third to the first.
