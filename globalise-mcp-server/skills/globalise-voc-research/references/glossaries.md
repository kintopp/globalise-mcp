# Reference: the local glossaries

`globalise_lookup_commodity` (trade goods) and `globalise_lookup_measure` (units).
Read the relevant half when a trade good or a historical unit enters the question —
both exist to get you from a modern word to what the corpus actually writes.

## Looking up commodities with `lookup_commodity`

`globalise_lookup_commodity` is a **local glossary** of ~3,500 VOC trade goods and
trade-related concepts. Its reliable value is **(1) bilingual label resolution** —
turn a modern/English term into the Dutch word the corpus uses (coffee → *koffie*,
mace → *foelie*) — and **(2) a sourced, confidence-rated definition** per concept.
Treat **period spelling variants (`altLabels`) as a bonus: only ~1 concept in 10 has
any, and the big commodities (pepper, coffee, nutmeg) have none.**

**Getting recall in the transcriptions — the usual goal.** The corpus is HTR'd
17th-c. Dutch with no spelling normalization, so one modern spelling finds almost
nothing (`koffie` → 119 pages; the period `coffij` → 25,124). So:

1. Look the term up → take the **Dutch `prefLabel`** and any `altLabels`.
2. If it *has* `altLabels` (silk, *zijde*, has 23), OR them into the search.
3. **If it has none (usual), reconstruct the period form** — the corpus prefers *c-*
   over *k-* and *-ij* over *-ie* (`koffie`→`coffij`) — **and add fuzzy `~1` / wildcards**
   (`coffij~1`, `peper~1`) for spelling + HTR noise. Don't assume one spelling suffices.
4. Feed the forms into `search_transcriptions` (space = OR there) or OR them into
   the `find_archival_documents` FTS5 `query` (Trap 3).

It is a **flat term-lookup, not a category browser** (the source's classifications
were too unreliable to surface): search by term, or omit `query` to page
alphabetically. FTS5 operators / ranking are in the tool description.

**Weight each definition by its source and confidence — over half are
machine-written.** Each result carries `definitionSource` and `confidence`; ~a
third are low/medium-low and many are LLM-generated (`llm`/`llm_sparse`; "no corpus
contexts" ≈ a guess).
- **Keep source + confidence visible — even in long lists**; flag machine-generated /
  low-confidence entries as tentative, and **say only what the definition states**
  (mark your own inferences, e.g. "lower quality", as *yours*). This matters most for
  sensitive entries (people trafficked as commodities).
- **`definitionSource`/`confidence` grade the *definition* only, never the labels.**
  `altLabels` carry no source/grade; `prefLabelEn` has its own (unsurfaced) provenance
  — so never tag a *variant* or *translation* "*WNT*-derived" or "*high*/*low*
  confidence". (`definitionSource: PoolParty` = "made by *Globalise*".)
- **`prefLabelEn` is ~70% LLM-translated**, so often a mistranslation (`raapfoelie`
  is gathered mace, not "rapeseed oil") — prefer the Dutch `prefLabel`.
- **Expand source codes**: *WNT* = historical dictionary of Dutch (IVDNT); *AAT* =
  Getty Art & Architecture Thesaurus; *vocGlossarium* = Huygens VOC-Glossarium;
  *PoolParty* = the GLOBALISE thesaurus. Some definitions embed raw citations ("Cited
  from… Classified on…") — give the substance, drop the boilerplate.
- **Offer `thesaurusUrl`** — a stable handle permalink into the public GLOBALISE
  Commodities thesaurus (Skosmos), carrying the SKOS hierarchy (broader/narrower) and
  cited source (often a Zotero record) this flat tool omits. Hand it to a user who
  wants to place a good in its trade hierarchy or follow a source.

## Looking up weights & measures with `lookup_measure`

`globalise_lookup_measure` is a **local glossary** of ~213 historical VOC units of
weight, volume, length, area, and quantity (from the 1764–1771 *Memoriën van Munten,
Maaten, en Gewigten*). Each result reliably carries the unit **label**, its **type**,
period **spelling variants**, and the **conversion ratios** it appears in (731 in the
dataset); definitions are sparse (~22% of units, mostly Dutch) — a bonus, not the
core. Search by term, or omit `query` to page alphabetically.

**It is NOT a unit converter — that caveat is the whole framing.** Early-modern units
(`bahar`, `last`, `man`, `seer`, `maat`) are **not stable**: a value shifts by place,
period, and even the commodity measured (a *bahar* of pepper ≠ of cloves; a *maat* of
rice ≠ of peanuts), and a unit name often doubles as its measuring container. So:
- **Each ratio is a period claim tagged with its `context`** — the settlement and/or
  commodity it was recorded for (`"rijst, Batavia"`, `"goud, zilver, Mokka"`). The context
  routinely names the **commodity**, and the ratio differs by good, so the commodity-specific
  value lives in the `context`, not the (sparse) definition. Read each ratio against its
  context; never give a modern equivalent without it. A self-referential ratio ("1 X = 1 X")
  attests use without a recorded local equivalence — incomplete, not an error.
- **`type` is load-bearing**: a few labels (`roede`, `voet`, `ammonam`) are homonyms split
  only by type (a *roede* of length vs of area).
- **Variants → search recall** (as for commodities): search is spelling-blind, so feed a
  unit's `variants` into `search_transcriptions` (or OR them into a `find_archival_documents`
  FTS5 `query`) to catch mentions a modern spelling misses.
