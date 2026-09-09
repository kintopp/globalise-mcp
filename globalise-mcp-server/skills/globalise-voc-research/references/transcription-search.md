# Reference: `globalise_search_transcriptions`

Full-text search over the ~4.8M HTR pages. Read this before composing any non-trivial
transcription query — the engine is Elasticsearch, not FTS5, and carrying archival
habits across silently changes what you match.

## Searching transcriptions: a different query engine

`search_transcriptions` does **not** use FTS5 — it hits a remote Elasticsearch
index, and its query language differs from `find_archival_documents` in ways that
bite if you carry FTS5 habits over.

> ⚠️ **Opposite default for multiple terms.** In the archival FTS5, a space means
> AND. In `search_transcriptions`, a space means **OR** — `peper koffie` matches
> pages with *either* word. Write uppercase **`AND`** when you need both
> (`peper AND koffie`). Operators must be uppercase; `( … )` grouping works.

On top of `AND`/`OR`/`NOT` and `"exact phrase"`, it adds operators FTS5 lacks:

| Want | Write | Why it matters here |
|------|-------|--------------------|
| Wildcard (any position) | `schip*`, `*schip`, `*schip*` | leading wildcards allowed (FTS5 can't) |
| Single-char wildcard | `cop?e` | not available in FTS5 |
| Fuzzy (edit distance) | `amsterdam~1`, `voorschreven~2` | **the key tool for an HTR/OCR corpus** |
| Phrase proximity | `"schip lading"~10` | the two words within N positions, any order |
| Match everything | `*` | stats / browsing |

## Composing a query, then saying what you ran

Four habits that keep a search honest on this corpus. Apply them in order.

1. **Multi-term queries are `AND` by default.** Write `peper AND malabar`, never
   `peper malabar` — the bare form is OR, and one common word (`peper` alone →
   160K pages) swamps the result while `total` looks meaningful. Use plain OR only
   when you deliberately want alternatives, and then group them: `(gesant OR envoyé)`.
2. **Proximity and fuzz don't mix.** `"peper malabar"~10` (both words within ten
   positions) works; `"peper~1 malabar~1"~10` does **not** — the `~1` inside the
   quotes is not honoured and the phrase quietly matches almost nothing. So when
   spelling noise matters *and* the words must be close, spell the variants out as
   alternative phrases instead: `"peper malabar"~10 OR "peper malabaer"~10`
   (measured: 35 and 95 pages respectively — the second spelling is the commoner
   one). When proximity matters less than recall, fall back to `peper~1 AND malabar~1`.
3. **Inspect the first page, then revise.** A fuzzy or wildcard term can pull in an
   unrelated word (`wijnen~1` also matches `sijne`, `wijsen`). Before quoting totals,
   read the `highlightedFragments` of the first few hits; if one variant is
   polluting, re-issue with that term exact, a tighter wildcard, or `NOT thatword`.
   One extra call; it is the difference between a count and a guess.
4. **State the query you ran.** Before presenting hits, give one line with the
   query as sent (operators, per-term fuzz, any expansions or exclusions you added)
   and the `total` — e.g. *"Searched `peper~1 AND malabar~1` (fuzz 1 on both): 1,060
   pages."* The user cannot see the call, and a fuzzy expansion they did not ask
   for is only acceptable if it is visible.

**Fuzzy matching earns its keep.** The text is machine-transcribed 17th–18th-c.
handwriting, so a word appears in many spellings and with OCR slips (`n`/`u`,
`c`/`e`, `i`/`l`). Period orthography alone is decisive: the modern **`koffie`**
matches **119** pages, but the 17th-c. **`coffij`** matches **25,124** — the same
commodity, 200× the recall. For any important term, prefer `term~1` or wildcard
the varying part: `coffie~1` catches `cofije`; `batavi*` catches `Batavien`;
`kof?ie` catches `koffie`.

**Tokenizer (standard Elasticsearch).** Punctuation is stripped and `-`, `=`,
`:`, the line-break `„` split words — so `oost-indie` ≡ `oost indie`, and a VOC
abbreviation like `Comp=s` must be searched as `"comp s"` or `comp*`. Archive
numbers (`1.04.02`) lose their dots — filter by `inventoryNumber` rather than
querying them. There's no reliable way to match a literal `*` or `?`.

**Totals are usually exact, occasionally a floor.** `total.relation` is `"eq"`
(exact) or `"gte"` (at least). Counts are exact even when large (`peper` →
160,366, `"eq"`); the case that returns a floor is **`matchAll` across multiple
languages**, which post-filters a capped 500-hit candidate window and adds a
`note`. When you see `"gte"` or a note, treat the count as a lower bound.

**No `topInventoryNumbers` facet under an `inventoryNumber` filter.** When that
filter is active the response omits the `topInventoryNumbers` aggregation and
says so in its `note` — the upstream facet for a filtered field ignores its own
filter and would show unfiltered corpus counts. Expect only the `languages`
facet on filtered-inventory calls; the facet's absence is deliberate, not a gap.

## Scoping by inventory range and by year

Three filters narrow the corpus before the query runs; all three end up as one
inventory-number list upstream, so they compose predictably.

- **`inventoryNumber`** — explicit numbers, including lettered part-inventories
  (`"9014A"`).
- **`inventoryRange`** — `"A-B"`, inclusive, expanded server-side (one or several).
  Use it for a whole series: `"1053-4454"` is the Overgekomen Brieven en Papieren
  (chronological, 1607–1794), `"7527-11024"` the Zeeland chamber copies. Unions
  with `inventoryNumber`. A range never matches a lettered inventory.
- **`yearFrom` / `yearTo`** — either bound alone or both. Resolved through the
  local archival index to every inventory whose finding-aid dates overlap the
  window, then applied as an inventory filter that *intersects* any
  `inventoryNumber`/`inventoryRange`. Two limits, both stated in the response
  `note`: it is **approximate** (an inventory is a bound volume; most span 1–3
  years, but ~150 registers span decades — 10435 covers 1600–1721 — so a narrow
  window still admits pages from outside it), and it is
  **blind to unindexed inventories** — the index dates ~4,981 of the corpus's
  ~6,890, and the 9000–11024 Zeeland copies are almost entirely absent. For a
  Zeeland-only question, scope by `inventoryRange` instead of years.

Read the `note` and quote it: *"1700–1710 resolved to 421 inventories"* tells the
user what was actually searched. A window that resolves to nothing returns
`total: 0` without searching, and says so. The `topInventoryNumbers` facet is
omitted under any of these filters (see above); to learn *which* inventories in a
window mention a term, sort by `invNr` and page, or probe candidate inventories
from `find_archival_documents` one at a time.

**Sorting — this tool *does* have it** (unlike `find_archival_documents`). `sortBy`
takes `_score` (relevance, the default), `document` (page ID), or `invNr` (inventory);
`sortOrder` is `asc`/`desc` (default `desc`). Relevance order suits most queries — reach
for `sortBy="document"` or `"invNr"` with `sortOrder="asc"` when you want to walk an
inventory's pages in archival order instead of by score.

**`fragmentSize` trades snippet length for payload size.** Each hit's
`highlightedFragments` are capped at `fragmentSize` chars (20–500, **default 200**).
Lower it when scanning many hits (large `size`) to shrink the
response; raise it for more context per match. It multiplies by `size`, so it's the
cheapest search-payload lever — and the first thing to lower on a size-capped search
(see "When a response is size-capped" in SKILL.md).

