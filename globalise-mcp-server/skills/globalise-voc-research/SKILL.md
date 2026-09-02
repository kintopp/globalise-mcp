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
  period spellings and definition, look up a VOC weight/volume/length unit,
  or open the interactive scan viewer.
  Reach for it for a bare document ID like NL-HaNA_1.04.02_9966_0106, or
  topics like Batavia, Ceylon, Malabar, the Cape, the Generale Missiven,
  pepper, nutmeg, or coffee — even when the user never says "VOC" or
  "GLOBALISE". Scope is this one Dutch archive: don't reach for it for
  another country's archives, another trading company, or art and iconography 
  collections.
---

# Researching VOC archives with the GLOBALISE MCP server

GLOBALISE serves machine transcriptions (HTR) of ~4.8M pages of Dutch East India
Company (Verenigde Oostindische Compagnie, VOC) records from the Dutch National
Archives (1618-1793). 

Document IDs look like `NL-HaNA_1.04.02_9966_0106` = `{archive}_{inventory}_{scan}`.
Any page opens in the web viewer at
`https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:{id}`.

## The tools

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
| `globalise_navigate_viewer` | **Steer the open viewer.** Zoom/pan it to a region to direct the user's attention. Needs the `viewUUID` from `globalise_view_document_ui`. | In-memory session queue |

> Internal: `globalise_poll_viewer_commands` is the viewer iframe's own command-polling channel — you never call it directly. It is marked app-only, but whether a host hides it is up to the host, so it may appear alongside the tools in the table above.

### Loading the tools

Where these tools are **deferred**, load them **once, up front** in a single
tool search — not per task. Generic queries like `search transcriptions` return
other archive servers' tools instead, and the exact function name does not help:
tool search matches descriptions, not identifiers.

- Best: exact selection by name (`select:name1,name2`) with the names in the
  table above. No limit is needed — you are naming them.
- Only if that is unavailable: keyword search
  `GLOBALISE VOC Dutch East India Company transcriptions`, limit **15** — the
  usual default of 5 cannot return a whole server's tool set, and the extra
  slots are deliberate headroom for fuzzy ranking (expect other archive
  servers' tools to fill them; that is fine).

A search that misses a tool never means it is unavailable. Re-search it by its
distinctive terms (Generale Missiven, thesaurus, bahar, IIIF viewer), not by name.

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

**Text selection.** Selecting text in the viewer's transcription panel pushes a
`User selected text in document …: "…"` note into your context. Users who do this
usually want those words translated from period Dutch into modern English.

**Reverse channel (steer the viewer back).** The viewer runs a live session
identified by the `viewUUID` in the `globalise_view_document_ui` result. When
you `globalise_inspect_page_image` a non-full region and a viewer is open, it
**auto-zooms** to that region (no extra call). To move the user's view without
fetching bytes for your own analysis, call `globalise_navigate_viewer` with that
`viewUUID` and a `navigate` command — the viewer zooms/pans to the region within
a second or two. A `deliveryState` of `queued_waiting_for_viewer` is normal (the
viewer is offscreen) — not a failure.

**Vocabulary lookup** rides alongside step 2: `globalise_lookup_commodity` turns a
trade good into the Dutch term the corpus uses (plus period variants where the
glossary has them), which you then expand with fuzzy/wildcards for
`search_transcriptions` — see `references/glossaries.md`.

## Where the detail lives

This file carries what applies to every session. The per-tool detail sits in
`references/` — read the relevant one *before* your first call to that tool,
not after a query returns something surprising, because each file exists to
pre-empt a specific class of silent wrong answer.

| Read | Before | It covers |
|---|---|---|
| `references/archival-index.md` | any `find_archival_documents` call | OBP vs GM sources, FTS5 syntax, the period-spelling / auto-quoting / finding-aid traps, sorting, year fields, crossing to pages, RGP published editions |
| `references/transcription-search.md` | any non-trivial `search_transcriptions` query | Elasticsearch operators, `space = OR`, fuzzy matching, the tokenizer, totals, sorting, `fragmentSize` |
| `references/glossaries.md` | a trade good or a historical unit comes up | `lookup_commodity` recall workflow and definition provenance; `lookup_measure` and why it is not a converter |

The rest of this file: [the tools](#the-tools) · [loading them](#loading-the-tools) ·
[canonical workflow](#the-canonical-workflow) · [HTR caveats](#htr-transcription-caveats-data-quality) ·
[sensitive content](#colonial-era-language-and-sensitive-content) · [worked patterns](#worked-patterns) ·
[size-capped responses](#when-a-response-is-size-capped) · [operational notes](#operational-notes) ·
[quick do / don't](#quick-do--dont)

## HTR transcription caveats (data quality)

The HTR model was trained on **Latin script only** — which shapes what's trustworthy:

- **Non-Roman scripts transcribe as gibberish** — Persian, Bengali, Tamil, Sinhala,
  Chinese, Japanese, Gujarati, Buginese, Old Church Slavonic, Ancient Greek, Ancient
  Hebrew. For these, don't present the "transcription" as text; offer the National
  Archives **page-scan link** from the document metadata instead. Malay (`msa`) is a
  macrolanguage with no script metadata — offer scan links for it too.
- **Language metadata:** `"unknown"` means *not yet classified*, **not**
  unidentifiable — such a page's Latin-script transcription is often perfectly
  readable, so treat it normally. The code `"art"` ("Cipher") marks **encrypted
  Dutch**, not an artificial language: when you show a page flagged `"art"`, offer
  the National Archives **page-scan link** from the document metadata, since the
  transcription of enciphered text is unreadable without the key.
  - Codes are ISO 639-3 (`nld` dominates at ~754K pages; `por`, `fra`, `deu`,
    `lat`, `eng`, `spa` are fairly well represented).
  - The language aggregation only counts pages that carry transcribed text, so it
    can **sum to less than the page total** — blank pages (`tokenCount` 0) have no
    language at all. In inventory 9966: 495 pages, 468 `nld` + 4 `unknown` = 472,
    and the missing 23 are blank. That gap is blank pages, not a classification
    gap; `"unknown"` is its own, counted category.
- **A scan is often two pages.** Many inventories are photographed as **two-page
  openings** rather than single pages (9966 and 4293 are; 1543, 7535, 1189, 1352
  are not). Line order follows the layout analysis, so on an opening both halves
  and their marginal columns **interleave** — consecutive lines are not
  necessarily consecutive text. Use `inspect_page_image` or the viewer to
  establish reading order before quoting a passage as continuous.

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

## Worked patterns

- **"Cinnamon from Ceylon."** → `find_archival_documents(query="kaneel", settlement="Ceylon", includeAggregations=true)` — *not* `query="kaneel AND Ceylon"` (→ 0, period-spelling trap).
- **"Languages in inventory 7535?"** → `search_transcriptions(query="*", inventoryNumber="7535", size=1)`, read the language aggregation (it counts only pages with text, so it can sum below the page total — the remainder is blank pages).
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

- **Cold start (beta only):** the beta deployment sleeps when idle, so its *first*
  call after a pause can fail with a transient connection error. Retry once — it
  wakes and succeeds. Production is always on.
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
