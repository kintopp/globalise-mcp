## Token and Cost Benchmarks

### Overview

Every question you put to Claude is paid for in *tokens*: the text the model reads (your question, its instructions, and everything its tools send back) and the text it writes. Connecting an MCP server adds a fixed entry cost, because Claude has to read the descriptions of all its tools before it can use any of them. It can also make research much cheaper, or possible at all: the GLOBALISE transcriptions sit behind a web application that ordinary web search does not index, so without the server Claude has no way into the 4.8 million transcribed pages.

These benchmarks ask Claude the same research questions three ways: with the GLOBALISE MCP server connected, with the server plus its [research skill](../skills/globalise-voc-research/SKILL.md), and with no MCP server at all, only web search. Each answer is checked for known facts (a document ID, an inventory number, a value), so a run that is cheap but wrong doesn't count as a win.

The scripts are adapted from the [rijksmuseum-mcp-plus benchmarks](https://github.com/kintopp/rijksmuseum-mcp-plus/blob/main/docs/benchmarks.md).

### What is measured

Each question runs in up to three set-ups, called *arms*:

| Arm | What Claude has | What it shows |
|---|---|---|
| **mcp** | the GLOBALISE server only | The cost of answering from the transcriptions, finding aids and glossaries |
| **mcp+skill** | the server and the research skill | Whether the skill's guidance saves steps on harder questions |
| **baseline** | web search and web fetch only, no server | What Claude would do without the server, for comparison |

For every run the benchmark reports:

- **tokens**: everything the model read and wrote across the whole conversation. Most of this is re-reading earlier context, which is cached and billed at a fraction of the normal price, so tokens alone overstate the real cost.
- **cost**: what the run would cost at the standard [Claude API prices](https://www.anthropic.com/pricing), including those cache discounts. (Runs made under a Claude subscription aren't billed per token; the figure shows what the same work would cost through the API.)
- **turns** and **tool calls**: how many steps Claude took to reach its answer.
- **time**: wall-clock seconds. Most server tools call the upstream GLOBALISE search service, so this measures its latency as much as the server's.
- **expect**: whether the answer contained the known fact(s) for that question.

### Running the benchmark

The benchmark drives [Claude Code](https://claude.com/claude-code) in headless mode (`claude -p`), so you need Claude Code installed and signed in, either with a Claude subscription or an API key. **Every run is a real Claude session**: it counts against your subscription's usage limits or is billed to your API account. The full set (7 questions × 3 arms × 3 runs) is 63 sessions.

Run from `globalise-mcp-server/`:

```bash
node scripts/bench/mcp-bench.mjs                        # mcp + baseline, Sonnet, 1 run each
node scripts/bench/mcp-bench.mjs --skill --runs 3       # add the mcp+skill arm, 3 runs each
node scripts/bench/mcp-bench.mjs --model opus           # or --model both
node scripts/bench/mcp-bench.mjs --only dodo-references,red-rail
node scripts/bench/mcp-bench.mjs --local                # test a local build over stdio (needs npm run build)
node scripts/bench/mcp-bench.mjs --dry-run              # print the sessions without running them
```

| Flag | Default | Meaning |
|---|---|---|
| `--model sonnet\|opus\|both` | `sonnet` | Uses the latest Sonnet and/or Opus model |
| `--effort <level>` | Sonnet `high`, Opus `medium` | Reasoning effort (defaults match each model's API default) |
| `--runs N` | `1` | Repetitions per question and arm. Use 3 or more before comparing results |
| `--arms mcp,baseline,mcp+skill` | `mcp,baseline` | Which arms to run; `--skill` is shorthand for adding `mcp+skill` |
| `--only id,id` | all | Restrict to questions by id (see below) |
| `--server <url>` / `--local` | production server | Target another `/mcp` endpoint, or spawn `dist/index.js` over stdio |
| `--concurrency N` | `1` | Sessions run in parallel |
| `--budget <usd>` | `3` | Per-session spending cap (at API list price) |
| `--timeout <s>` | `900` | Per-session wall-clock limit |
| `--cold` | off | Skip the cache warm-up (see below) |

**Cache warm-up.** Before the measured sessions, the benchmark sends one trivial question per arm ("Reply with just: ok"). This loads that arm's instructions and tool descriptions into Claude's cache, the way an earlier question would in normal use, so every measured session starts from the same state. The warm-up's cost is reported on its own line as the **entry cost**: what the first question of a session pays on top of the per-question figures.

Each session runs in an empty scratch directory with the user's own settings, hooks, plugins and MCP servers switched off, so the arms differ only in the tools they're given. No arm has sub-agents. Output goes to `scripts/bench/results/<timestamp>/` (gitignored): one JSON file per session (the full result, including the answer text and which tools were called) and a `summary.csv`.

### The questions

The questions live in [`scripts/bench/prompts.json`](../scripts/bench/prompts.json). They range from facts Claude may know from memory to open research tasks. Expected values were verified against the live server on 2026-10-04.

| Id | Tier | Question (abridged) | Answer check |
|---|---|---|---|
| `voc-archive-code` | simple | Nationaal Archief access number of the VOC archive | `1.04.02` |
| `bahar-pepper` | simple | Kilograms in a bahar of pepper | 170–189 kg |
| `foelie-kruidnagel` | simple | What *foelie* and *kruidnagel* denote | mace, clove |
| `gm-1700` | medium | Inventory and RGP volume of the Generale Missive of 1 December 1700 | inv. `1628`, volume 6 |
| `cipher-pages` | medium | How many pages are in cipher, and in which inventories | 8; `1232`, `1292` |
| `dodo-references` | complex | Every reference to the dodo, across spelling variants and languages | pages `1059_0277`, `1095_0922`, `1164_0738` or `1165_0143`, `4011_0411`; the split form "walg vogel" |
| `red-rail` | complex | Passages that describe the Mauritius red rail, which had no Dutch name of its own | page `4005_0603`, plus `1128_0360` or `1095_0922` (a *velthoenders* "field-hen" page) |

An answer check is a simple text match. It can tell whether the right facts came back, but not everything a good answer does: for the dodo question it doesn't score whether Claude tried the other languages and reported, correctly, that none of them contains the bird.

**The two complex questions.** The dodo's commonest names in the corpus are not the textbook *dodaers* but *dodeersen* and *dodersen*, and *walghvogel* survives only split across a line break ("walg vogels"), so the question tests whether Claude finds the spellings the scribes actually used. Eight pages mention the dodo, from 1615 to 1674. The red rail had no fixed name, so that question tests identification from description; its key page (`4005_0603`, Pretorius's report of c. 1669) calls the bird *dodaers*, which is why the dodo check deliberately does not require that page. The checks use document IDs rather than dates because the 1615 and 1638 finds are discussed in a public [blog post](https://resobscura.substack.com/p/using-opus-55-to-discover-a-new-eyewitness) the baseline could find; only the archive gives the page IDs.

### Results

**2026-10-04 · Claude Sonnet 5.5 (effort `high`) · server v0.10.0 · 3 runs per question and arm · cache warm-up on**

Average cost per question at API list price, with the average number of steps (turns) in brackets. *Passed* counts the runs whose answer contained the expected facts. Entry cost (the warm-up, paid once per session): mcp $0.056, mcp+skill $0.072, baseline $0.008.

| Question | Tier | mcp | mcp+skill | baseline | mcp vs baseline |
|---|---|---|---|---|---|
| `voc-archive-code` | simple | $0.006 (1) · 3/3 | $0.010 (1) · 3/3 | $0.004 (1) · 3/3 | 1.4× more |
| `bahar-pepper` | simple | $0.032 (2) · 3/3 | $0.038 (2) · 3/3 | $0.009 (1) · 3/3 | 3.8× more |
| `foelie-kruidnagel` | simple | $0.022 (2) · 3/3 | $0.027 (2) · 3/3 | $0.006 (1) · 3/3 | 3.4× more |
| `gm-1700` | medium | $0.030 (2) · 3/3 | $0.034 (2) · 3/3 | $1.520 (66) · 3/3 | 0.02× |
| `cipher-pages` | medium | $0.014 (2) · 3/3 | $0.020 (2) · 3/3 | $0.351 (13) · 2/3 | 0.04× |
| `dodo-references` | complex | $0.977 (38) · **1/3** | $0.981 (41) · 2/3 | $1.138 (39) · **0/3**¹ | 0.86× |
| `red-rail` | complex | $0.355 (19) · 2/3 | $0.447 (23) · **1/3** | $0.488 (16) · **0/3** | 0.73× |

¹ One baseline run was stopped at the 900 s session limit and counts as a failure; the cost and step averages cover the other two.

The whole set (63 sessions) came to $18.39 at the API list price. What the numbers show:

- **On what Claude already knows, the server costs a few cents more.** The archive code, the bahar and the commodity terms are answered from memory, so the baseline costs well under a cent; reading the server's tool descriptions costs more than that. The archive-code question needs no tool call at all with the server, because the answer is in the server's own instructions.
- **On archival questions, it is 25–50 times cheaper.** The baseline did answer the Generale Missive question, by working through the Nationaal Archief's online inventory and the published edition, but it took 66 steps and five minutes on average against two steps and five seconds. For the cipher pages it found GLOBALISE's own language-identification dataset on GitHub, which worked twice out of three.
- **The baseline cannot search the transcriptions at all.** The search API accepts only POST requests and Claude's web tools send only GET, so on the two complex questions the baseline failed every run. It found the published discussion of the 1615 dodo journal (and, in one trial run outside this set, that page's ID from the post's link), but never the other pages.
- **The complex questions are hard even with the server.** On the dodo question, two of the six server runs missed the 1647 Japan pages, which lie outside the Mauritius material, and one searched only the textbook spellings, found none of the dodeersen/dodersen pages, and concluded that only one page mentions the bird. On the red rail, half the server runs found Pretorius's description but not a *velthoenders* page.
- **The skill makes no clear difference yet.** Claude loaded it on every complex question and on no simple one, where it adds 15–60% for nothing. On the complex questions it cost about the same and passed 2/3 against 1/3 on the dodo but 1/3 against 2/3 on the red rail, which with three runs each is noise.

**Follow-up, same day.** A paragraph was added to the skill's search reference telling Claude to sweep spelling variants before concluding that a term is rare: read new spellings off the first hits, wildcard the vowels inside a stem, search split compounds as phrases, and search the whole corpus before narrowing by place. It names no dodo spellings. Three more mcp+skill runs of the dodo question passed 2/3 again at $0.91 on average; the failing run again stopped at the textbook spelling and reported a single page. The guidance did not change the outcome measurably.

### Server footprint

The benchmark above measures complete conversations, so its numbers include Claude Code's own instructions and habits. A second, much simpler measurement looks only at what the server itself adds, which is the same whichever app you use:

- **the tool catalogue**: how many tokens the full tool descriptions take, and how many the one-line summaries take on their own (apps such as claude.ai show the model only those summaries at first and load a full description when the tool is needed);
- **response sizes**: how much text each question's representative tool calls (`probes` in `prompts.json`) send back to the model;
- **the research skill**: its always-visible description, the main body loaded when the skill is used, and each reference file.

No model is involved, so it costs nothing to run. With an Anthropic API key in `ANTHROPIC_API_KEY` (or in a `.env` in `globalise-mcp-server/` or the repo root) the counts come from Anthropic's free token-counting endpoint; without one, the script prints an estimate.

```bash
node scripts/bench/footprint.mjs            # production server
node scripts/bench/footprint.mjs --local    # local build over stdio
node scripts/bench/footprint.mjs --json     # machine-readable output
```

**2026-10-04 · server v0.10.0 · Claude Sonnet 5.5 token counter**

| Part | Tokens | When a model reads it |
|---|---|---|
| Full tool descriptions (9 model-visible tools) | 10,851 | Up front, in apps that load all tools at once (such as Claude Code) |
| Tool names and one-line summaries | 325 | Up front, in apps that load tools on demand (such as claude.ai) |
| Largest single tool (`globalise_search_transcriptions`) | 2,341 | When the tool is first needed, in on-demand apps |
| Typical tool response | 416–2,761 | After each call (a 20-hit search ≈ 2,800; one page transcription ≈ 1,500–2,200) |
| Skill description | 428 | Always, once the skill is installed |
| Skill body | 6,308 | When Claude decides the skill is relevant |
| Skill reference files | 2,152–5,229 each | Only when a reference is opened |

### Caveats

- **Per-question costs assume a warm cache.** Claude caches what it has already read for up to an hour. The cache warm-up makes every measured session start warm, so the per-question figures describe an ongoing session; the first question of a new session also pays the entry cost. Running two benchmarks at the same time lets them share a cache, which makes the second one's entry cost look too low. With `--cold`, whichever session runs first in each arm pays the entry cost instead; compare averages over three or more runs.
- **The baseline knows general facts.** The archive code and the commodity terms are answerable from memory or the open web, so the baseline can win the simplest questions. That is a real effect, not a flaw in the benchmark.
- **The viewer tools are not exercised.** Headless sessions have no host to render the document viewer, so no question relies on `view_document_ui`, `navigate_viewer` or page images.
- **Upstream data can move.** Search counts and page IDs come from the live GLOBALISE index; a re-transcription or re-index upstream could change them. The glossary and finding-aid answers come from the server's own committed databases and are stable.
- **This measures Claude Code, not claude.ai.** Chat apps add their own instructions, and claude.ai loads full tool descriptions only when they're needed, so absolute numbers there will differ; the comparison between arms should hold. The [server footprint](#server-footprint) gives the app-independent part.
- **Results are a snapshot.** Model releases, tool-description changes and data updates all move the numbers, which is why each results table is dated and names the model and server version.
