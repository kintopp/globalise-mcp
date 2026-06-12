---
name: globalise-voc-research
description: >-
  Search and read Dutch East India Company (VOC) archives through the GLOBALISE
  MCP server — ~4.8M HTR-transcribed pages plus a 228K-entry finding-aids index,
  17th–18th-century early-modern Dutch. Use this whenever a task involves the
  GLOBALISE/VOC corpus or its tools: finding archival documents by
  place/year/inventory, full-text searching transcriptions, reading or paging
  through pages, resolving a trade good to its period spelling variants, or
  opening the interactive viewer. Reach for it even when the user names a VOC
  topic obliquely.
---

# Researching VOC archives with the GLOBALISE MCP server

GLOBALISE serves machine transcriptions (HTR) of ~4.8M pages of Dutch East India
Company (Verenigde Oostindische Compagnie, VOC) records from the Dutch National
Archives — mostly 17th–18th-century early-modern Dutch. 

Document IDs look like `NL-HaNA_1.04.02_7535_0011` = `{archive}_{inventory}_{scan}`.
Any page opens in the web viewer at
`https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:{id}`.

## The six tools

| Tool | Use it to… | Backed by |
|------|-----------|-----------|
| `globalise_find_archival_documents` | **Scope first.** Search a *local* index of 228K archival document descriptions (finding aids) by text + metadata, to narrow down inventories/places/years before touching transcriptions. | Local SQLite + FTS5 |
| `globalise_lookup_commodity` | **Resolve a term.** Turn a modern/English trade good into the Dutch word the corpus uses, with a sourced definition (and period spelling variants where the glossary has them — only ~10% do). | Local SQLite + FTS5 |
| `globalise_search_transcriptions` | Full-text search across the ~4.8M transcribed pages; filter by inventory and/or language. | Remote search API (Broccoli) |
| `globalise_retrieve_document` | Get one page by ID/URN: full line-by-line transcription, metadata (languages, dates, license), prev/next IDs, viewer + scan links. | Remote |
| `globalise_navigate` | Read sequentially — fetch the previous or next page relative to an ID. | Remote |
| `globalise_view_document_ui` | Open the interactive split-view widget (zoomable IIIF scan + transcription, optional highlight) for a human to look at. | MCP Apps widget |

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

**Vocabulary lookup** rides alongside step 2: `globalise_lookup_commodity` turns a
trade good into the Dutch term the corpus uses (plus period variants where the
glossary has them), which you then expand with fuzzy/wildcards for
`search_transcriptions` — see "Looking up commodities" below.

## The two data sources behind `find_archival_documents`

The `source` parameter selects between two indexes over the **same archive**
(1.04.02) — they carry **different fields**, so always be deliberate about which
you query (`obp` | `gm` | `all`). They are **not disjoint collections**: GM is a
*genre within* OBP — the Generale Missiven physically sit in OBP inventory
volumes, so the same missive is often catalogued in both (see the `source=all`
dedup note below):

- **OBP — Overgekomen Brieven en Papieren** (`source=obp`, ~227,526 entries).
  Digitized index entries / finding aids. Fields you can filter and read:
  `settlement`, `year_earliest`/`year_latest`, `folio`, `inventory_number`,
  `description`. **`settlement` is OBP-only** — and it's the VOC office the papers
  came *from* (origin), not the document's subject.
- **GM — Generale Missiven** (`source=gm`, ~950 entries). The official summary
  letters from Batavia to the Heren XVII. Fields: `chamber`, dates, RGP
  references (with `publishedEdition` links for the ~558 published letters), scan
  URLs, `htrAvailable`. **`chamber` and `htrAvailable` are
  GM-only.** Folio filters require an `inventoryNumber`.

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

`find_archival_documents.query` is passed straight to SQLite **FTS5** over the
`description` text. FTS5 is powerful but literal; the traps below are the #1
cause of false-empty results. The *other* search tool, `search_transcriptions`,
runs on a **different engine with opposite defaults** — don't carry these rules
over to it (see "Searching transcriptions" below).

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

There is **no `sortBy`/`sortOrder` parameter.** Ordering is fixed:

- **OBP:** `year_earliest`, then `inventory_number` (compared as **text**, so
  "10435" sorts before "2393"), then `folio_start`.
- **GM:** `date_numeric`, then `inventory_number`.

The OBP default *is* chronological-ish, but with a catch: it
sorts by `year_earliest` ascending, and the records with the **lowest** floors
are the **least date-precise** ones (wide inventory-level ranges). So an
unfiltered first page (`from=0`, no query) surfaces the most date-ambiguous
documents first — it is *not* a bug and *not* "sorted by internal id". To get a
meaningful chronological window, constrain with `yearFrom`/`yearTo` rather than
trusting page 1.

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

A `find_archival_documents` result hands you an **inventory number** and a
**folio** range. The inventory always crosses cleanly to the page layer; folios
and scans need care, and OBP vs GM behave oppositely:

- **The inventory number is the join.** Feed it into `search_transcriptions`'
  `inventoryNumber` filter (or `retrieve_document`). That's the reliable bridge.
- **OBP: folio ≠ scan number.** Foliation is the original archival numbering; scans
  add covers, blanks and section dividers, so folio 372 is *not* scan `_0372` (in
  inv 1068, scan 0372 is just a "No. 2." divider). Never construct a scan ID from
  an OBP folio — search the inventory and read the hits' real IDs.
- **GM is the exception — it carries scans directly.** A `source=gm` result
  includes `scanStart`/`scanEnd` and ready-made `scanUrlFirst`/`scanUrlLast`, so
  you *can* build the URN straight from the scan number
  (`NL-HaNA_1.04.02_{inv}_{scanStart padded to 4}`, e.g. inv 7545 / scan 27 →
  `…_7545_0027`). Caveat: a minority of GM letters were identified but never
  located in the archive and lack `scanStart` — confirm it's present first.
- **GM `rgpVolume`/`rgpPage`** (present for ~558 of the 950 letters) cite the
  *published* RGP edition and now also drive a **`publishedEdition`** link object on
  each GM result (page scans + plain text) — see "The RGP published edition links"
  just below. They mark the letter's *start* in the printed volume, not a
  page-by-page map to the manuscript.
- **No year filter on transcriptions.** `search_transcriptions` exposes only
  `inventoryNumber` and `languages` (both exact-match) — there is *no* date field.
  Do all year/place scoping in `find_archival_documents`, then carry the inventory
  numbers across.

## The RGP published edition links (GM only)

For the ~558 Generale Missiven carried in the published RGP edition, a `source=gm`
result includes a **`publishedEdition`** object; it is `null` for the ~392 not
published *in this form* (a different copy of the same missive may still appear in
RGP). The raw `rgpVolume`/`rgpPage` give the print citation; the object turns them
into three ready-made URLs — present them with **plain labels** ("page scan",
"plain text", "full volume"), not the raw URL fragments (e.g. `view=imagePane`):

- **`retroboekenUrl`** — Retroboeken viewer opened on the **page scan** of the
  printed RGP volume at the page where the letter begins. Best for **citing or
  verifying** against the published book. (The viewer can toggle to a text pane; the
  link just lands on the scan.) `null` when `rgpPage` is missing.
- **`githubPageUrl`** — raw plain text of the letter's **first page only**, *not* the
  whole letter; longer letters continue onto following pages, so use the volume file
  for the complete text. `null` when `rgpPage` is missing.
- **`githubVolumeUrl`** — raw plain text of the **entire RGP volume**. Always present
  when `publishedEdition` exists (it needs only the volume). Use it to read a whole
  letter (search within for the date / start page), or when the record has a volume
  but no page (the page-precise links are then `null`).

**Two different texts — keep them distinct.** The RGP edition behind these links is a
**selective, edited scholarly edition** — summaries plus verbatim passages, partly
modernized — published in the *Rijks Geschiedkundige Publicatiën* (Grote Serie), 14
vols. spanning 1610–1767, begun by W. Ph. Coolhaas and continued by later editors.
(The GitHub plain text extracts the original-letter passages only — introductions,
footnotes, indices and the modern-Dutch summaries are stripped.) The **HTR
transcription** (via `search_transcriptions`/`retrieve_document`) is the *machine*
reading of the *manuscript original*. For a published GM the RGP text is the
authoritative edited version and the HTR is the full original — offer whichever fits
the need, and say which is which.

**Work from the material in hand.** When you describe the published edition, ground it
in what the record and this section actually provide — the `rgpVolume`/`rgpPage`
citation and the edition facts above. If a user wants more specific bibliography (the
editor of a particular volume, an ISBN, a related edition), point them to the RGP
series record or the GitHub repo, which carry it — the dataset surfaced here does not.

**Reference-only.** The server never fetches the RGP text, and clients generally
can't fetch these raw URLs inline either — hand the user the link to open rather than
promising to paste the text.

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

## Looking up commodities with `lookup_commodity`

`globalise_lookup_commodity` is a **local glossary** of ~3,500 VOC trade goods and
trade-related concepts. Its reliable value is **(1) bilingual label resolution** —
turn a modern or English term into the Dutch word the corpus actually uses
(coffee → *koffie*, mace → *foelie*) — and **(2) a sourced, confidence-rated
definition** per concept. Treat **period spelling variants (`altLabels`) as a
bonus, not the main event: only ~1 concept in 10 has any, and the big commodities
(pepper, coffee, nutmeg) have none.**

**Getting recall in the transcriptions — the usual goal.** The corpus is HTR'd
17th-c. Dutch with no spelling normalization, so one modern spelling finds almost
nothing (`koffie` → 119 pages; the period `coffij` → 25,124). So:

1. Look the term up → take the **Dutch `prefLabel`** and any `altLabels`.
2. If it *has* `altLabels` (silk, *zijde*, has 23), OR them into the search.
3. **If it has none (the usual case), reconstruct the period form yourself** — the
   corpus prefers *c-* over *k-* and *-ij* over *-ie* (`koffie`→`coffij`) — **and
   add fuzzy `~1` / wildcards** (`coffij~1`, `peper~1`) for spelling + HTR noise.
   Don't assume one spelling is enough just because it already returns hits.
4. Feed the forms into `search_transcriptions` (space = OR there) or OR them into
   the `find_archival_documents` FTS5 `query` (Trap 3).

It is a **flat term-lookup, not a category browser** (the source's classifications
were too unreliable to surface): search by term, or omit `query` to page
alphabetically. FTS5 operators / ranking are in the tool description.

**Weight each definition by its source and confidence — over half are
machine-written.** Each result carries `definitionSource` and `confidence`; ~a
third are low/medium-low and many are LLM-generated (`llm`/`llm_sparse`; "no corpus
contexts" ≈ a guess).
- **Keep source + confidence visible — even in long lists**, and flag
  machine-generated / low-confidence entries as tentative.
- **Say only what the definition states.** Don't assert or quote beyond its text;
  mark your own inferences (e.g. "lower quality") as *yours*, not the source's.
  This matters most for sensitive entries (people trafficked as commodities).
- **`definitionSource`/`confidence` grade the *definition* only — never the
  labels.** `altLabels` carry no source or grade in the data; `prefLabelEn` has its
  own (unsurfaced) provenance. So never call a *variant* or *translation*
  "*WNT*-derived" or "*high*/*low* confidence" — that pairing holds only for the
  definition. ("Made by *Globalise*" = `definitionSource: PoolParty`.)
- **`prefLabelEn` is ~70% LLM-translated**, so often a mistranslation (`raapfoelie`
  is gathered mace, not "rapeseed oil") — prefer the Dutch `prefLabel`.
- **Expand source codes for the reader**: *WNT* = standard historical dictionary of
  Dutch (IVDNT); *AAT* = Getty Art & Architecture Thesaurus; *vocGlossarium* =
  Huygens VOC-Glossarium; *PoolParty* = the GLOBALISE project thesaurus. Some
  definitions embed raw citations ("Cited from… Classified on…") — give the
  substance, drop the boilerplate.

## HTR transcription caveats (data quality)

The HTR model was trained on **Latin script only**. This shapes what's
trustworthy:

- **Non-Roman scripts transcribe as gibberish** — Persian, Bengali,
  Tamil, Sinhala, Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic,
  Ancient Greek, Ancient Hebrew. For these, don't present the "transcription" as
  text; offer the National Archives **page-scan link** from the document metadata
  instead. Malay (`msa`) is a macrolanguage with no script metadata — offer scan
  links for it too.
- **Language metadata:** `"unknown"` means *not yet classified*, **not**
  unidentifiable. The code `"art"` ("Cipher") marks **encrypted Dutch**, not an
  artificial language. Codes are ISO 639-3 (`nld` dominates at ~754K pages; also
  `por`, `fra`, `deu`, `lat`, `eng`, `spa`).

## Colonial-era language and sensitive content

These are 17th–18th-c. VOC records. The OBP/GM `description` text and the
transcriptions use period colonial language — including terms and framings that are
offensive by modern standards (the dataset documentation flags this explicitly). The
records, and the commodities glossary (which includes concepts for people
trafficked as commodities), document the VOC's trade in **enslaved people**, who
appear commodified in shipping lists and accounts. Surface such material with accurate
historical framing: quote the sources faithfully rather than sanitizing them, but
don't reproduce period slurs in your own voice or present commodification as neutral.
Description is also **uneven**: European actors are named far more consistently than
Asian individuals (whom GLOBALISE addresses with separate remediation datasets), so
name- and actor-based searches over the metadata skew toward European subjects.

## Weights & measures (external reference, not a tool here)

GLOBALISE also publishes a **weights & measures glossary** (~213 units) that this
server does *not* expose as a tool, but it's worth knowing when you read a
quantity: early-modern units (`bahar`, `last`, `man`, `seer`, `maat`) are **not
stable** — a unit's value shifts by place, period, and even the commodity measured
(a *bahar* of pepper ≠ a *bahar* of cloves; a *maat* of rice ≠ a *maat* of
peanuts), and a unit name often doubles as the name of the measuring container.
When a transcription quotes a quantity, don't convert it to a modern equivalent
without that context.

## Worked patterns

**"Find documents about cinnamon from Ceylon."**
→ `find_archival_documents(query="kaneel", settlement="Ceylon", includeAggregations=true)`.
*Not* `query="kaneel AND Ceylon"` (→ 0, period-spelling trap).

**"What languages appear in inventory 7535?"**
→ `search_transcriptions(query="*", inventoryNumber="7535", size=1)` and read the
language aggregation.

**"Find pages mentioning Amsterdam, tolerant of spelling/OCR noise."**
→ `search_transcriptions(query="amsterdam~1")` — fuzzy matching, which
`find_archival_documents` (FTS5) has no operator for.

**"Find transcriptions for a trade good, catching period spellings."**
→ `lookup_commodity(query="<good>")` for the Dutch label (and any `altLabels`) —
most goods have none, so reconstruct the period spelling and fuzz it →
`search_transcriptions`. (Coffee: the modern `koffie` finds 119 pages; the period
form ~25,000.)

**"Show me page NL-HaNA_1.04.02_7535_0011 with 'Batavia' highlighted."**
→ `view_document_ui(documentId="NL-HaNA_1.04.02_7535_0011", highlightTerms=["Batavia"])`.

**"Letters from the Amsterdam chamber in the 1680s."**
→ `find_archival_documents(source="gm", query="...", yearFrom=1680, yearTo=1689)`
(chamber is a GM field; filter/read it from results).

**"Read the next few pages after this one."**
→ `navigate(documentId=..., direction="next")`, repeat.

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
- ✅ Check the response **`note`** when results look off (auto-quoted terms / phrase fallback / lower-bound totals).
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
