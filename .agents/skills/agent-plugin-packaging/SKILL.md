---
name: agent-plugin-packaging
description: Package and distribute an MCP server together with an Agent Skill as an agent plugin for Codex CLI and the ChatGPT desktop app. Use when adding agent-plugins.org or Codex plugin packaging to an MCP server repo, choosing a distribution route (local path, Git marketplace, in-app install, published directory), working out how a non-technical user installs a server plus skill without a terminal, or debugging a plugin that installs but never appears.
---

# Agent plugin packaging (Codex / ChatGPT)

Package an existing MCP server and its Agent Skill so OpenAI clients can install
both together. This is a **repackaging exercise**, not a runtime change: the spec
asks nothing of your server, only of a directory tree.

**Scope:** the OpenAI ecosystem only — Codex CLI and the ChatGPT desktop app.
Claude Desktop `.mcpb` bundles and Claude `.skill` packages are a separate
distribution path and are out of scope here.

## Default stance

This format is young, partly undocumented, and moving between releases. Its
characteristic failure is **silent failure**: the plugin simply never appears and
nothing says why. An invalid enum, a path that resolves elsewhere, a reference
file left behind — each produces success output over a broken install.

So treat the installed client as the only authority. Check `--version` first,
because behaviour differs across minor releases, and record which version you
verified against — the answer expires.

## The two manifest formats

Codex historically read a near-variant of the agent-plugins.org standard: the
**shim**. It differs in paths and spelling, not structure.

| | agent-plugins.org 1.0.0 | shim (Codex-native) |
|---|---|---|
| manifest | `plugin.json` | `.codex-plugin/plugin.json` |
| MCP config | `mcp.json` | `.mcp.json` |
| remote transport | `"streamable-http"` | `"http"` |
| extra keys | forbidden (`additionalProperties: false`) | `skills`, `mcpServers`, `interface` |
| skills | `skills/<name>/SKILL.md` | identical |

Because the filenames differ, one directory satisfies both — so emit both pairs
over a single shared `skills/`. Codex CLI **0.147.0** reads the standard layout
(verified 2026-08-09), which is what makes the shim a shim: keep it until your
oldest supported client is past 0.147, then drop it.

Field detail: `references/manifest-formats.md`. The probe that established what
0.147 reads: `references/verification-recipes.md`.

## Generate the package

Adding a plugin means a third and fourth manifest describing one server
(alongside `package.json` and any `.mcpb` `manifest.json`). They differ in
*purpose* but overlap heavily in *content* — name, version, description, author,
repository, license, keywords.

Write one generator that derives everything and emits the whole tree:

- version from `package.json`; identity fields from your existing bundle
  manifest; `SKILL.md` copied byte-identical from its single hand-edited home
- **copy the skill recursively** — modern skills are `SKILL.md` *plus*
  `references/`, and a non-recursive copy ships dangling pointers that still
  install cleanly
- **verify by walking the source tree, not a hardcoded filename list.** A fixed
  list and a recursive copy disagree the moment the skill grows a directory, and
  the check then passes over an incomplete payload — **silent failure** again
- commit the generated output (unlike a build staging dir): a marketplace entry
  must point at a real `source.path` in the repo

## Distribution

The spec explicitly puts distribution, installation, and registries *outside*
the portable specification, so every route below is client-defined.

| Route | Who it suits | Skill? | Server? |
|---|---|---|---|
| Local path marketplace | you, while developing | yes | yes |
| **Git repo as marketplace** | **anyone; the main answer** | yes | yes |
| In-app "Add plugin marketplace" | non-technical users | yes | yes |
| Published directory | broadest reach; review process | yes | yes |
| `.skill` file, double-clicked | non-technical users | yes | **no** |
| Web/mobile custom connector | non-technical users | **no** | yes |

**The primary mechanism is a Git repo used as a marketplace**, carrying
`.agents/plugins/marketplace.json` at its root.

**There is no single double-clickable artifact carrying server + skill.** When
asked for a `.mcpb` equivalent, say so plainly, then offer the in-app dialog —
paste a GitHub URL, no terminal.

Routes, commands, the marketplace file shape, and the exact GUI copy:
`references/distribution-and-install.md`.

## Traps

- **The install cache is version-keyed.** Editing the source does not reach an
  existing install, and downstream users update only when the version string
  moves. Consequences and fix: `references/distribution-and-install.md`.
- **Double registration.** Where a user already declares the same server
  manually, two paths now reach it. Matching server keys appear to collapse;
  differing keys duplicate every tool. Choose the key deliberately and say so in
  the plugin README.
- **Marketplaces are registered explicitly.** Being inside the repo is not enough.
- **Plugin-contributed servers are virtual** — they appear in the client's server
  listing with no config entry behind them, which is exactly what makes them a
  **confound**.

## Hard rules

1. **State the client version with every behavioural claim.** "Codex reads X" is
   incomplete; "Codex CLI 0.147.0 reads X, verified <date>" is usable.
2. **Attribute every observation to something only the plugin can supply.** A
   pre-existing config entry that produces the same listing row is a
   **confound** — test the skill, or build a probe with unique names.
3. **Check the oldest client you support before collapsing the shim.** The
   duplication looks redundant and is not.
4. **Change generated output by fixing the generator and re-running.**
5. **Say which half a route delivers.** A web connector without the skill gives
   tools with no method; a `.skill` without the server gives method with no
   tools. Both are defensible; neither is "installed".

## Reference map

- `references/manifest-formats.md` — exact contents of all four manifests,
  schema constraints, field mapping from an existing bundle manifest, and what
  has no equivalent (user config, tool lists, compatibility).
- `references/distribution-and-install.md` — every install route with commands,
  the marketplace file shape, the in-app GUI flow and its literal copy, the
  `.skill` file type, and the version-keyed cache.
- `references/verification-recipes.md` — the commands that establish ground
  truth, the probe-plugin technique for isolating which format a client reads,
  and the **confound**s that make naive checks meaningless.
