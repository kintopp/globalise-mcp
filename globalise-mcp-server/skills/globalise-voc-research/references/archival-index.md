# Reference: `globalise_find_archival_documents`

The local finding-aid index (228K entries over archive 1.04.02). Read this before
your first `find_archival_documents` call in a session — its query engine (SQLite
FTS5) has defaults opposite to `search_transcriptions`, and the traps below are the
#1 cause of false-empty results.

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
>
> A few letters are also duplicated *within* `source=gm` (14 pairs share an
> `idTanap` but can disagree on scan range); when deduping on `idTanap`, keep
> the row that carries `publishedEdition` so the RGP links survive.

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
> and *all 876* Amsterdam letters are `false` — `htrAvailable=true` is really just
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
opposite defaults** — don't carry these rules over (see
`references/transcription-search.md`).

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
`search_transcriptions`, which does — see `references/transcription-search.md`). Its
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
