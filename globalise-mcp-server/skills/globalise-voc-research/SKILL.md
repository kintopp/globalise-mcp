---
name: globalise-voc-research
description: >-
  Search and read the 17th–18th-century Dutch East India Company (VOC /
  Verenigde Oostindische Compagnie) archives — ~4.8M HTR-transcribed pages
  from the Dutch National Archives (Nationaal Archief, fonds 1.04.02) — via
  the GLOBALISE MCP server. Use it to find out what a VOC document says,
  trace a shipment or commodity, or pull letters about a place or person:
  find archival documents by place/year/inventory, full-text search
  transcriptions, read or page through scans, resolve a trade good to its
  period spellings and definition, look up a VOC weight/volume/length unit
  (type, variants, conversion ratios), or open the interactive scan viewer.
  Reach for it for a bare document ID like NL-HaNA_1.04.02_9966_0106, or
  topics like Batavia, Ceylon, Malabar, the Cape, the Generale Missiven,
  pepper, nutmeg, or coffee — even when the user never says "VOC" or
  "GLOBALISE".
---

# Researching VOC archives with the GLOBALISE MCP server

GLOBALISE serves machine transcriptions (HTR) of ~4.8M pages of Dutch East India
Company (Verenigde Oostindische Compagnie, VOC) records from the Dutch National
Archives (1618-1793). 

Document IDs look like `NL-HaNA_1.04.02_9966_0106` = `{archive}_{inventory}_{scan}`.
Any page opens in the web viewer at
`https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:{id}`.

## The ten tools

| Tool | Use it to… | Backed by |
|------|-----------|-----------|
| `globalise_find_archival_documents` | **Scope first.** Search a *local* index of 228K archival document descriptions (finding aids) by text + metadata, to narrow down inventories/places/years before touching transcriptions. | Local SQLite + FTS5 |
| `globalise_lookup_commodity` | **Resolve a term.** Turn a modern/English trade good into the Dutch word the corpus uses, with a sourced definition (and period spelling variants where the glossary has them — only ~10% do). | Local SQLite + FTS5 |
| `globalise_lookup_measure` | **Resolve a unit.** Look up a VOC weight/volume/length/area/quantity unit (~213): its type, period spelling variants, and the conversion ratios it appears in. Not a converter — ratios are period claims tagged by place/commodity. | Local SQLite + FTS5 |
| `globalise_search_transcriptions` | Full-text search across the ~4.8M transcribed pages; filter by inventory and/or language. | Remote search API (Broccoli) |
| `globalise_retrieve_document` | Get one page by ID/URN: line-by-line transcription, metadata (languages, dates, license), prev/next IDs, viewer + scan links. | Remote |
| `globalise_navigate` | Read sequentially — fetch the previous or next page relative to an ID. | Remote |
| `globalise_view_document_ui` | Open the interactive split-view widget (zoomable IIIF scan + transcription, optional highlight) for a human to look at. Its result carries a `viewUUID` — pass it to `globalise_navigate_viewer` to steer that open viewer. | MCP Apps widget |
| `globalise_inspect_page_image` | **Look at the page yourself.** Fetch a page scan or region as an image and read it — re-transcribe a user-highlighted passage (a "[Highlight: region pct:…]" message) as a second opinion on the HTR, or zoom into a detail on request. When a viewer is open for the page it also auto-zooms there. | Live IIIF image API |
| `globalise_navigate_viewer` | **Steer the open viewer.** Zoom it to a region, or draw labelled overlay boxes back onto the user's scan (and clear them). Needs the `viewUUID` from `globalise_view_document_ui`. Overlays are append-only and persist until cleared. | In-memory session queue |

> Internal: `globalise_poll_viewer_commands` is the viewer iframe's own command-polling channel (app-only, hidden from the agent tool list) — you never call it directly.

### The canonical workflow

Most research follows **scope → search → read**:

1. `globalise_find_archival_documents` to find *which* inventories/documents are
   relevant (the finding aids are richer and faster to filter than the raw page
   text). Inventory numbers in its results feed step 2.
2. `globalise_search_transcriptions` (often with the `inventoryNumber` filter
   from step 1) to find the actual transcribed pages.
3. `globalise_retrieve_document` / `globalise_navigate` to read pages, or
   `globalise_view_document_ui` to show one to the user.

For a known page ID, skip straight to `retrieve_document`. For statistics only
(e.g. the language breakdown of an inventory), call `search_transcriptions` with
`query="*"` and `size=1` and read the aggregations.

**Highlight → inspect loop.** In `globalise_view_document_ui`, a user can press
`i` and drag a box over the scan; the viewer drops a `[Highlight: region
pct:…]` message into the chat with no image attached — just coordinates. Call
`globalise_inspect_page_image` with that same `documentId` and `region` to
fetch the actual crop and read it yourself, e.g. as a second opinion on a
garbled HTR passage. You can also call it proactively (region defaults to
`full`) to zoom into a detail the user asks about.

**Reverse channel (steer the viewer back).** The viewer runs a live session
identified by the `viewUUID` in the `globalise_view_document_ui` result. When
you `globalise_inspect_page_image` a non-full region and a viewer is open, it
**auto-zooms** to that region (no extra call). To draw on the scan, call
`globalise_navigate_viewer` with that `viewUUID` and commands (`navigate`,
`add_overlay` with a `label`, `clear_overlays`) — labelled orange boxes appear
in the user's viewer within a second or two. Overlays are **append-only** (to
reposition, `clear_overlays` then re-add all). To confirm a box landed where
you intended, re-inspect with `show_overlays: true` and the `verificationRegion`
the navigate response hands you — the returned crop then has your boxes drawn
on it. A `deliveryState` of `queued_waiting_for_viewer` is normal (the viewer is
offscreen) — not a failure.

**Vocabulary lookup** rides alongside step 2: `globalise_lookup_commodity` turns a
trade good into the Dutch term the corpus uses (plus period variants where the
glossary has them), which you then expand with fuzzy/wildcards for
`search_transcriptions` — see "Looking up commodities" below.

## The two data sources behind `find_archival_documents`

The `source` parameter selects between two indexes over the **same archive** (1.04.02)
— they carry **different fields**, so be deliberate about which you query (`obp` | `gm`
| `all`). They are **not disjoint**: GM is a *genre within* OBP — the Generale Missiven
physically sit in OBP inventory volumes, so the same missive is often catalogued in both
(see the `source=all` dedup note below):

- **OBP — Overgekomen Brieven en Papieren** (`source=obp`, ~227,526 entries).
  Digitized index entries / finding aids. Fields you can filter and read:
  `settlement`, `year_earliest`/`year_latest`, `folio`, `inventory_number`,
  `description`. **`settlement` is OBP-only** — and it's the VOC office the papers
  came *from* (origin), not the document's subject.
- **GM — Generale Missiven** (`source=gm`, ~950 entries). The official summary
  letters from Batavia to the Heren XVII. Fields: `chamber`, dates, RGP
  references (with `publishedEdition` links for the ~558 published letters), scan
  URLs, `htrAvailable`. **`chamber` and `htrAvailable` are GM-only**; `chamber`
  (`"Amsterdam"` / `"Zeeland"`) is also a usable **filter**. Folio filters require an
  `inventoryNumber`.

`includeAggregations: true` adds settlement / year / inventory breakdowns (OBP)
or chamber (GM) — cheap and useful for "what's in here?" questions.

> ⚠️ **`source=all` double-counts the Generale Missiven.** Because GM ⊂ OBP, a
> published-era missive is indexed **twice** — once as the richer GM row, once as a
> plain OBP finding-aid row carrying the *same* inventory, folio and description.
> When you list or **count** across `source=all`, dedup on `inventory_number` +
> `folio` and keep the **GM** row (it adds `chamber`, dates, scan URLs, RGP refs).
> Query a single `source` when you don't need both field sets.

> ⚠️ **OBP indexes only *some* inventories — an empty result isn't proof of
> absence.** It was built from TANAP + typoscript sources covering a
> non-contiguous set of inventories (roughly inv 1053–4454 and 7527–9179, plus a
> few high slivers), leaving large gaps (≈4455–7526, 9180–10405). Plenty of
> heavily-transcribed inventories have **zero** OBP rows — e.g. inv 9966 (0 OBP /
> **495** transcribed pages) and inv 9800 (0 / **274**). The entire late-period
> **Ceylon governor correspondence** (inv ~9735–10000) falls in a gap, so
> `settlement="Ceylon"` (24,758 rows) silently omits it. When OBP returns nothing
> for an inventory or place, check `search_transcriptions` before concluding the
> material doesn't exist.

> ⚠️ **`htrAvailable` is not a reliable "has transcriptions" flag.** It mirrors
> one sub-project (IJsberg), so empirically *all 70* Zeeland letters are `true`
> and *all 880* Amsterdam letters are `false` — `htrAvailable=true` is really just
> "chamber = Zeeland." Yet plenty of those `false` Amsterdam inventories *are*
> transcribed in GLOBALISE (inv 1056 → 550 pages, inv 1058 → 418). To find letters
> you can actually read, take the inventory number and probe
> `search_transcriptions(query="*", inventoryNumber=…, size=1)` — don't filter on
> `htrAvailable`. (Some GM records also carry an **empty inventory number**, so
> they can't be chained to transcriptions at all.)

## `find_archival_documents` query syntax (SQLite FTS5)

`find_archival_documents.query` goes straight to SQLite **FTS5** over the `description`
text. FTS5 is powerful but literal; the traps below are the #1 cause of false-empty
results. The *other* tool, `search_transcriptions`, runs on a **different engine with
opposite defaults** — don't carry these rules over (see "Searching transcriptions").

**Operators (all native, all work):**

| Want | Write | Note |
|------|-------|------|
| Single term | `kaneel` | case-insensitive, diacritic-folding |
| AND (explicit) | `kaneel AND balen` | |
| AND (implicit) | `kaneel balen` | **space = AND**, not OR — this is FTS5's default |
| OR | `kaneel OR peper` | |
| NOT | `kaneel NOT Ceijlon` | |
| Exact phrase | `"hooge regeringe"` | double quotes |
| Prefix | `Makass*` | star appended to the stem, no space |

There is **no stemming and no spelling normalization.** A token matches only its
literal forms (modulo case/diacritics). Two consequences dominate everything:

### Trap 1 — period Dutch spelling vs. modern toponyms

The free-text `description` is in 17th–18th-century Dutch orthography. The
`settlement` field is **normalized to a single canonical spelling per place** —
but *which* spelling is unpredictable, and it's almost never the description's
period form. They diverge sharply:

- `description` contains **"Ceijlon"** ~4,091 times; the modern **"Ceylon"** only
  ~208 times. The `settlement` field is the mirror image: **"Ceylon"** on ~24,758
  rows, **"Ceijlon"** on 0.
- The canonical form isn't reliably the modern exonym, either: `settlement="Malakka"`
  → **6,967**, but `settlement="Malacca"` → **0** — even though `Malacca` is the
  example value in the tool's own schema. Ceylon gets the English exonym; Malakka
  keeps the Dutch one. **Don't guess the spelling** — run once with
  `includeAggregations` and copy the exact settlement string from the breakdown.

So `query="kaneel AND Ceylon"` returns **0** — not because AND is broken, but
because almost no *description* pairs "kaneel" with the modern spelling "Ceylon".
The fix is to put the place in the **filter**, not the text query:

> **For place names, use the `settlement` filter; reserve `query` for content
> words.** e.g. `query="kaneel"`, `settlement="Ceylon"` — not
> `query="kaneel AND Ceylon"`.

If you must match a place in free text, use a prefix or the period spelling:
`Ceijlon*`, `Makass*` (catches `Makassar`, `Makassaren`, `Maccasser`, …).
Normalization is also imperfect (`Bengale`/`Bengalen` coexist), so for exhaustive
coverage combine the filter with a prefix query and check the aggregations.

### Trap 2 — special characters are auto-quoted

Hyphens (`oost-indie`), slashes, and apostrophes (`'s-gravenhage`) can't sit in an
FTS5 bareword, so the server quotes those terms for you and keeps your
`AND`/`OR`/`NOT` — `kaneel AND oost-indie` works as written.

Two inputs still can't be parsed and fall back to one literal phrase (operators
dropped); the response `note` flags it:

- **Unbalanced quotes or parentheses** — `"oost`, `(kaneel OR peper`.
- **A missing operator before a group** — write `compagnie AND (peper OR koffie)`,
  not `compagnie (peper OR koffie)`.

### Trap 3 — OBP is a finding aid, not a subject index

The OBP `description` is a one-line catalogue heading written in 18th-c. archival
practice, and is often generic: the word **"missive"** alone heads ~59,600 of the
227,526 entries, and just five document-type words (missive/register/rapport/brief/
extract) cover **~48%**. So topic-keyword search over `description` is
**serendipitous** — you only hit documents a cataloguer happened to describe with
that word, missing those filed generically as "Missive van den gouverneur…". The
**reliable** discovery axes are the structured fields: `settlement`, year,
`inventory_number`. Two consequences:

- Descriptions name **specific goods**, not categories, so general terms score far
  lower here than in the page text — `specerijen` (spices): **234** OBP rows vs
  **51,701** transcribed pages; `koffie`: **6** vs **119**.
- A near-empty OBP result rarely means the topic is absent. Broaden with `OR` over
  specific commodities, or move to `search_transcriptions` for the actual text.

## Sorting and pagination

`find_archival_documents` has **no `sortBy`/`sortOrder` parameter** (unlike
`search_transcriptions`, which does — see "Searching transcriptions" below). Its
ordering is fixed:

- **OBP:** `year_earliest`, then `inventory_number` (compared as **text**, so
  "10435" sorts before "2393"), then `folio_start`.
- **GM:** `date_numeric`, then `inventory_number`.

The OBP default *is* chronological-ish, but with a catch: it sorts by `year_earliest`
ascending, and the records with the **lowest** floors are the **least date-precise**
ones (wide inventory-level ranges). So an unfiltered first page (`from=0`, no query)
surfaces the most date-ambiguous documents first — *not* a bug, *not* "sorted by
internal id". For a meaningful chronological window, constrain with `yearFrom`/`yearTo`
rather than trusting page 1.

**Deep pagination is cheap** — the sort is index-backed, so `from=200000` is as
fast as `from=0`. No cursor workaround is needed at current corpus size.

## Interpreting the year fields

`year_earliest` / `year_latest` are **not always a precise date.**

- ~86% of OBP rows are date-precise (`year_earliest == year_latest`).
- A small minority (~300 rows) carry **wide inventory-level ranges**, e.g.
  `1600–1741`. A low floor like **1600 is an imprecise bound, not a real date and
  not a null sentinel** (only ~8 rows are exactly 1600; there are no nulls).

Read a wide `earliest..latest` span as "somewhere in this range," and prefer the
**description** (which usually names the real date, e.g. "in dato 25 October
1672") for the actual event year.

## Crossing from archival hits to pages

A `find_archival_documents` result hands you an **inventory number** and a **folio**
range. The inventory crosses cleanly to the page layer; folios and scans need care,
and OBP vs GM behave oppositely:

- **The inventory number is the join.** Feed it into `search_transcriptions`'
  `inventoryNumber` filter (or `retrieve_document`) — the reliable bridge.
- **OBP: folio ≠ scan number.** Foliation is the original numbering; scans add covers,
  blanks and dividers, so folio 372 is *not* scan `_0372` (in inv 1068, scan 0372 is
  just a "No. 2." divider). Never build a scan ID from an OBP folio — search the
  inventory and read the hits' real IDs.
- **GM carries scans directly** (the exception). A `source=gm` result has
  `scanStart`/`scanEnd` + ready-made `scanUrlFirst`/`scanUrlLast`, so you *can* build
  the URN from the scan number (`NL-HaNA_1.04.02_{inv}_{scanStart→4 digits}`, e.g. inv
  7545 / scan 27 → `…_7545_0027`). Caveat: some GM letters were never located and lack
  `scanStart` — confirm it's present first.
- **GM `rgpVolume`/`rgpPage`** (~558 of 950 letters) cite the *published* RGP edition
  and drive a **`publishedEdition`** link object (see next section); they mark the
  letter's *start* in the printed volume, not a page-by-page manuscript map.
- **No year filter on transcriptions.** `search_transcriptions` exposes only
  `inventoryNumber` and `languages` (exact-match) — *no* date field. Do year/place
  scoping in `find_archival_documents`, then carry the inventory numbers across.

## The RGP published edition links (GM only)

For the ~558 Generale Missiven in the published RGP edition, a `source=gm` result
carries a **`publishedEdition`** object (`null` for the ~392 not published *in this
form* — a different copy of the same missive may still appear in RGP). It turns the
raw `rgpVolume`/`rgpPage` citation into three ready-made URLs — present them with
**plain labels** ("page scan", "plain text", "full volume"), not raw URL fragments
(e.g. `view=imagePane`):

- **`retroboekenUrl`** — Retroboeken viewer on the **page scan** of the printed
  volume where the letter begins; best for **citing/verifying** against the book.
  `null` when `rgpPage` is missing.
- **`githubPageUrl`** — raw plain text of the letter's **first page only** (longer
  letters spill onto following pages — use the volume file for the full text).
  `null` when `rgpPage` is missing.
- **`githubVolumeUrl`** — raw plain text of the **entire RGP volume**; always present
  when `publishedEdition` exists. Use it to read a whole letter (search within for the
  date / start page), or when there's a volume but no page (page links then `null`).

**Two different texts — keep them distinct.** The RGP edition is a **selective, edited
scholarly edition** — summaries plus verbatim passages, partly modernized; *Rijks
Geschiedkundige Publicatiën* (Grote Serie), 14 vols. 1610–1767, begun by W. Ph.
Coolhaas and continued by later editors (the GitHub text keeps the original-letter
passages only — intros, footnotes, indices, summaries stripped). The **HTR
transcription** (`search_transcriptions`/`retrieve_document`) is the *machine* reading
of the *manuscript original*. Offer whichever fits and say which is which. **Ground
claims in what's in hand** — the `rgpVolume`/`rgpPage` citation and the facts above;
for fuller bibliography (a volume's editor, ISBN, related editions) point users to the
RGP series record or GitHub repo. The server never fetches the RGP text and clients
usually can't fetch these raw URLs inline — hand over the link, don't promise the text.

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

**Sorting — this tool *does* have it** (unlike `find_archival_documents`). `sortBy`
takes `_score` (relevance, the default), `document` (page ID), or `invNr` (inventory);
`sortOrder` is `asc`/`desc` (default `desc`). Relevance order suits most queries — reach
for `sortBy="document"` or `"invNr"` with `sortOrder="asc"` when you want to walk an
inventory's pages in archival order instead of by score.

**`fragmentSize` trades snippet length for payload size.** Each hit's
`highlightedFragments` are capped at `fragmentSize` chars (20–500, **default 200**;
was a fixed 500). Lower it when scanning many hits (large `size`) to shrink the
response; raise it for more context per match. It multiplies by `size`, so it's the
cheapest search-payload lever — and the first thing to lower on a size-capped search
(see "When a response is size-capped").

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

## HTR transcription caveats (data quality)

The HTR model was trained on **Latin script only** — which shapes what's trustworthy:

- **Non-Roman scripts transcribe as gibberish** — Persian, Bengali, Tamil, Sinhala,
  Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic, Ancient Greek, Ancient
  Hebrew. For these, don't present the "transcription" as text; offer the National
  Archives **page-scan link** from the document metadata instead. Malay (`msa`) is a
  macrolanguage with no script metadata — offer scan links for it too.
- **Language metadata:** `"unknown"` means *not yet classified*, **not**
  unidentifiable. The code `"art"` ("Cipher") marks **encrypted Dutch**, not an
  artificial language. Codes are ISO 639-3 (`nld` dominates at ~754K pages; also
  `por`, `fra`, `deu`, `lat`, `eng`, `spa`).

## Colonial-era language and sensitive content

These 17th–18th-c. VOC records use period colonial language — terms and framings
offensive by modern standards (the dataset documentation flags this explicitly). The
records and the commodities glossary (which includes concepts for people trafficked as
commodities) document the VOC's trade in **enslaved people**, who appear commodified in
shipping lists and accounts. Surface such material with accurate historical framing:
quote sources faithfully rather than sanitizing them, but don't reproduce period slurs
in your own voice or present commodification as neutral. Coverage is also **uneven** —
European actors are named far more consistently than Asian individuals (whom GLOBALISE
addresses with separate remediation datasets), so name-/actor-based metadata searches
skew toward European subjects.

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

## Worked patterns

- **"Cinnamon from Ceylon."** → `find_archival_documents(query="kaneel", settlement="Ceylon", includeAggregations=true)` — *not* `query="kaneel AND Ceylon"` (→ 0, period-spelling trap).
- **"Languages in inventory 7535?"** → `search_transcriptions(query="*", inventoryNumber="7535", size=1)`, read the language aggregation.
- **"Amsterdam, tolerant of spelling/OCR noise."** → `search_transcriptions(query="amsterdam~1")` — fuzzy, which `find_archival_documents` (FTS5) has no operator for.
- **"Transcriptions for a trade good, catching period spellings."** → `lookup_commodity(query="<good>")` for the Dutch label (+ any `altLabels`); most goods have none, so reconstruct the period spelling and fuzz it → `search_transcriptions` (coffee: modern `koffie` 119 pages vs period form ~25,000).
- **"Show page NL-HaNA_1.04.02_9966_0106 with 'Batavia' highlighted."** → `view_document_ui(documentId="NL-HaNA_1.04.02_9966_0106", highlightTerms=["Batavia"])`.
- **"Letters from the Amsterdam chamber in the 1680s."** → `find_archival_documents(source="gm", chamber="Amsterdam", yearFrom=1680, yearTo=1689)` (`chamber` is a GM-only **filter** — `"Amsterdam"`/`"Zeeland"`).
- **"Read the next few pages after this one."** → `navigate(currentDocumentId=..., direction="next")`, repeat.

## When a response is size-capped

Responses are bounded to a byte budget (the ~150K-char host per-result limit, split
across the two wire channels — ≈60KB of *data* with defaults). Over budget, the
server **trims and flags it**; it never drops data silently:

- **List tools** (`search_transcriptions`, `find_archival_documents`,
  `lookup_commodity`, `lookup_measure`) drop **tail results**: fewer rows than `size`,
  `pagination.hasMore=true`, and a `note` reading *"Response size-capped: returned N of
  M…"*. **`total` stays true** — a short page is not a small corpus. (Search shortens
  oversized snippets first — keep 1/hit, ≤200 chars — before dropping hits.) **To get
  the rest:** higher `from`, narrower filters, or lower `size` / `fragmentSize`.
- **Single pages** (`retrieve_document`, `navigate`) drop **tail transcription lines**
  of an unusually dense page, setting `text.truncated:true` + `text.totalLines`. Rare.
  On `truncated`, open `view_document_ui` (**exempt** — always renders the full page)
  or fetch the scan.

A short result with `hasMore:true` and a size-cap `note` is **expected on a large
response, not a failed query** — read the `note` and paginate.

## Operational notes

- **Cold start:** the deployment sleeps when idle, so the *first* call after
  a pause can fail with a transient connection error. Retry once — it wakes and
  succeeds.
- **Endpoints:** production `https://globalise-mcp-production.up.railway.app/mcp`,
  beta `https://globalise-mcp-beta-production.up.railway.app/mcp`. `/health`
  returns the running version.

## Quick do / don't

- ✅ Scope with `find_archival_documents` before searching transcriptions.
- ✅ Put **places in the `settlement` filter**, content words in `query`.
- ✅ Read the exact **settlement spelling from the aggregation** (`includeAggregations`) — it's `Malakka`, not `Malacca`.
- ✅ Use **period spellings or prefixes** (`Ceijlon*`, `Makass*`) for free-text places.
- ✅ **Resolve commodity terms** with `lookup_commodity` — get the Dutch label, then (most have no `altLabels`) reconstruct period spellings + fuzzy `~1` rather than betting on the modern form.
- ✅ Check the response **`note`** when results look off (auto-quoted terms / phrase fallback / lower-bound totals / **size-capped results** — fewer rows than `size`, with `pagination.hasMore: true` and `total` still true).
- ✅ Offer **scan links** for non-Roman-script and Malay pages.
- ✅ For a **published GM**, offer the `publishedEdition` links and say whether you're giving the **edited RGP text** or the **HTR** original.
- ✅ In `search_transcriptions`, lean on **fuzzy `~1`** and period spellings for important terms (HTR/OCR noise).
- ❌ Don't carry FTS5 habits to `search_transcriptions`: there **space = OR** (use `AND`), and it adds `~N` / `?` / proximity.
- ❌ Don't AND a modern toponym into the text query — it returns spurious 0s.
- ❌ Don't trust GM **`htrAvailable`** as "has transcriptions" — it only marks Zeeland; probe the inventory instead.
- ❌ Don't call the per-page RGP link the whole letter (it's the **first page**), or go past the record/skill for RGP editors/dates/editions — point to the RGP series record for those.
- ❌ Don't read an **empty OBP result** as "not in GLOBALISE" — many transcribed inventories (9966 → 495 pages, 9800 → 274) have no OBP index; check `search_transcriptions`.
- ❌ Don't build a scan ID from an **OBP folio** (for **GM**, use the result's `scanStart` / scan URLs), or try to **filter transcriptions by year** (no date field).
- ❌ Don't trust the unfiltered first page as "earliest documents" — use `yearFrom`/`yearTo`.
- ❌ Don't read `year_earliest=1600` (or any wide range) as a precise date.
- ❌ Don't treat `language="unknown"` as unidentifiable, or `"art"` as a real language.
- ❌ Don't present a `lookup_commodity` **definition** as fact when it's low-confidence/LLM-sourced — or pin its **source/confidence onto a label** (those grade the definition only, and `prefLabelEn` is itself ~70% LLM-translated); the reliable payload is the **Dutch label**.
