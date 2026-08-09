---
name: agent-plugin-packaging
description: Package and distribute an MCP server together with an Agent Skill as an agent plugin for Codex CLI and the ChatGPT desktop app. Use when adding agent-plugins.org or Codex plugin packaging to an MCP server repo, choosing a distribution route (local path, Git marketplace, in-app install, published directory), working out how a non-technical user installs a server plus skill without a terminal, or debugging a plugin that installs but never appears. Covers the two divergent manifest formats, the version-keyed install cache, double tool registration, and how to verify each claim against a live client instead of trusting docs.
---

# Agent plugin packaging (Codex / ChatGPT)

Package an existing MCP server and its Agent Skill so OpenAI clients can install
both together. This is a **repackaging exercise**, not a runtime change: the spec
asks nothing of your server, only of a directory tree.

**Scope:** the OpenAI ecosystem only — Codex CLI and the ChatGPT desktop app.
Claude Desktop `.mcpb` bundles and Claude `.skill` packages are a separate
distribution path and are out of scope here.

## Default stance

This format is young, partly undocumented, and moving between releases. Two
failure modes dominate, and both are silent:

- **An invalid enum or a wrong path produces no error** — the plugin simply
  never appears. Nothing tells you why.
- **Docs and reality diverge.** Published guidance has repeatedly described
  layouts the installed client does not read.

So: **verify against the client actually installed on the machine**, never from
memory or from a blog post. Check `--version` first; behaviour differs across
minor releases. Record which version you verified against, because the answer
expires.

## The two manifest formats

Codex historically read a near-variant of the agent-plugins.org standard. They
differ in *paths and spelling*, not structure:

| | agent-plugins.org 1.0.0 | Codex-native |
|---|---|---|
| manifest | `plugin.json` | `.codex-plugin/plugin.json` |
| MCP config | `mcp.json` | `.mcp.json` |
| remote transport | `"streamable-http"` | `"http"` |
| extra keys | forbidden (`additionalProperties: false`) | `skills`, `mcpServers`, `interface` |
| skills | `skills/<name>/SKILL.md` | identical |

**Because the filenames differ, one directory can satisfy both.** Emit both
pairs over a single shared `skills/` rather than choosing. That was load-bearing
when only the Codex-native pair worked; it is now a compatibility shim, since
Codex CLI **0.147.0** reads the standard layout (verified 2026-08-09 — see
`references/verification-recipes.md` for the probe that proves it). Keep both
until your oldest supported client is past 0.147, then drop the Codex pair.

Full field-by-field detail: `references/manifest-formats.md`.

## Generate the package; never hand-maintain it

Adding a plugin means a third and fourth manifest describing one server
(alongside `package.json` and any `.mcpb` `manifest.json`). They differ in
*purpose* but overlap heavily in *content* — name, version, description, author,
repository, license, keywords.

Write one generator script that derives everything and emits the whole tree:

- version from `package.json`; identity fields from your existing bundle
  manifest; `SKILL.md` copied byte-identical from its single hand-edited home
- **copy the skill recursively** — modern skills are `SKILL.md` *plus*
  `references/`, and a non-recursive copy ships dangling pointers that still
  install cleanly
- **verify by walking the source tree, not a hardcoded filename list.** A fixed
  list plus a recursive copy disagree the moment the skill grows a directory,
  and the check passes while the payload is incomplete
- commit the generated output (unlike a build staging dir): a marketplace entry
  must point at a real `source.path` in the repo

## Distribution

The spec explicitly puts distribution, installation, and registries *outside*
the portable specification, so every route below is client-defined.

| Route | Who it suits | Gets skill? | Gets server? |
|---|---|---|---|
| Local path marketplace | you, while developing | yes | yes |
| **Git repo as marketplace** | **anyone; the main answer** | yes | yes |
| In-app "Add plugin marketplace" | non-technical users | yes | yes |
| Published directory | broadest reach; review process | yes | yes |
| `.skill` file, double-clicked | non-technical users | yes | **no** |
| Web/mobile custom connector | non-technical users | **no** | yes |

**The primary mechanism is a Git repo used as a marketplace.** Put
`.agents/plugins/marketplace.json` at the repo root with entries whose
`source.source` is `"local"` and whose `path` is relative to the **repo root**.
`"local"` means "vendored inside this marketplace", not "on the user's disk" —
which is why the same file works whether the root arrived as a directory or a
clone.

**There is no single double-clickable artifact carrying server + skill.** If
asked for a `.mcpb` equivalent, say so plainly, then point at the in-app dialog
(paste a GitHub URL) as the no-terminal path. Routes, exact GUI copy, and the
`.skill` UTI: `references/distribution-and-install.md`.

## Traps that cost real time

- **Installs are cached by version**, at
  `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`. Editing the source
  tree does **not** propagate — you will silently test a stale copy. Bump the
  version, or remove and re-add. This also means **consumers only receive
  updates when the version string moves**, so a repo whose version is a
  best-effort fallback (tags primary, `package.json` stale) will strand every
  existing installer. Derive the plugin version from the same source the server
  reports, or add an explicit version bump to the release ritual.
- **Double registration.** If a user already declares the same server manually,
  they now have two paths to it. Where the server *key* matches, clients appear
  to collapse them; where it differs, expect every tool twice. Choose the key
  deliberately and say so in the plugin README.
- **Marketplaces are registered explicitly.** There is no auto-discovery from
  the working directory — being inside the repo is not enough.
- **Plugin-contributed MCP servers are virtual.** Installing writes marketplace
  and enable flags to the client config but never an `mcp_servers` block, yet
  the server still appears in the client's server listing. That makes it
  indistinguishable from a manually configured one.

## Hard rules

1. **State the client version with every behavioural claim.** "Codex reads X" is
   incomplete; "Codex CLI 0.147.0 reads X, verified <date>" is usable.
2. **Never infer that an install worked from a shared observable.** If a
   pre-existing config entry produces the same listing row as the plugin would,
   that row proves nothing. Test something only the plugin can supply — the
   skill — or build a probe with unique names.
3. **Do not collapse the dual manifests** without checking the oldest client you
   support. The duplication looks redundant and is not.
4. **Do not hand-edit generated package output.** Fix the generator, re-run.
5. **Flag, don't assume, when a route loses half the payload.** A web connector
   without the skill gives tools with no method; a `.skill` without the server
   gives method with no tools. Both are defensible; neither is "installed".

## Reference map

- `references/manifest-formats.md` — exact contents of all four manifests,
  schema constraints, field mapping from an existing bundle manifest, and what
  has no equivalent (user config, tool lists, compatibility).
- `references/distribution-and-install.md` — every install route with commands,
  the marketplace file shape, the in-app GUI flow and its literal copy, the
  `.skill` file type, and what a non-technical user actually does.
- `references/verification-recipes.md` — the commands that establish ground
  truth, the probe-plugin technique for isolating which format a client reads,
  and the confounds that make naive checks meaningless.
