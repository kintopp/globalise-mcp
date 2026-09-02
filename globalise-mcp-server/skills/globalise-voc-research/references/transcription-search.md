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

