# Research Scenarios

Each scenario below is a sample research question phrased as a literal prompt you can paste into a chat session. Their only aim is to demonstrate how well (or not..) an AI assistant with access to the MCP server and a skill can address different types of research questions. Most of the prompts start from a specific claim, document or puzzle in published work on the archive, much of it from the [GLOBALISE project's own blog posts and papers](https://globalise.huygens.knaw.nl/output/), and ask what the archive pages add to it, or whether they bear it out. The claim is stated as a premise in the prompt, and its source is cited underneath. The `/globalise-voc-research` at the end of each prompt asks the model to consult the server's [skill file](../skill/globalise-voc-research/SKILL.md) before answering. The final example is a command-line pipeline for technical users of the CLI client.

The results described under 'Why it matters' come from exploratory runs against the MCP server (October 2026) with Claude Sonnet 5.5. Quotations are machine transcriptions (HTR) unless marked as read from the scan. All document IDs share the prefix `NL-HaNA_1.04.02_`, so `1059_0277` stands for `NL-HaNA_1.04.02_1059_0277`. To open one, append the full ID to `https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:`.

Some scenarios add an optional follow-up that moves to another medium (e.g. reading the scan, drawing a timeline, or creating a Word document).

This is a colonial archive. Its descriptions of people are the Company's, some of them violent or demeaning, and they are quoted here as evidence of how the Company wrote.

- [Finding What the Obvious Word Misses](#finding-what-the-obvious-word-misses)
- [The Catalogue and the Page](#the-catalogue-and-the-page)
- [Quantities and Goods](#quantities-and-goods)
- [People in Company Paper](#people-in-company-paper)
- [Languages and Ciphers](#languages-and-ciphers)
- [From the Shell](#from-the-shell)

## Finding What the Obvious Word Misses

`globalise_search_transcriptions` searches about 4.8 million pages of machine transcription, with no normalised spelling. There is no single way to look for a person, an animal or an event, since clerks spelt as thought fit and the HTR adds errors of its own. 

### 1. Looking for the Dodo

*A previously unnoticed 1615 eyewitness to the dodo and a 1638 reference to the red rail have been found in these transcriptions with an embedding model. How far can you get by searching the corpus directly? Find the pages where Company writers refer to the dodo or to a bird that may be the dodo, under the names they actually used. For each, tell me whether it describes a living bird, lists it as food, or merely repeats a name, and where you doubt it means the dodo at all. What is the latest reference you would defend? /globalise-voc-research*

[Demo](https://claude.ai/share/d77766ab-8884-4172-a7ef-fc2016b8a4b3). Source: Benjamin Breen, ["Using Opus 5.5 to discover a new eyewitness record of the dodo"](https://resobscura.substack.com/p/using-opus-55-to-discover-a-new-eyewitness), *Res Obscura*, 1 October 2026.

**How the tools enable it:**
- `globalise_search_transcriptions` with the period forms: `dodeers dodaers dodersen dodeersen dodaersen` (a bare space means OR here) returns 8 pages, few enough to read every one. `dod*rsen OR dod*ers` returns 43, and `dodo OR dronte OR dodaars` returns 108, whose first hits are noise: *dodo* is often a clerk's "ditto".
- A second query goes after the other names: `"walg vogels"~1 OR "walg vogel"~1 OR walghvogel OR walgvogel`, and `velthoenderen OR velthoenders OR veldhoenderen OR veldhoenders`, the word in the published red rail reference.
- `globalise_retrieve_document` reads each hit in full. `globalise_inspect_page_image` settles a page whose columns the HTR has interleaved.

**Why it matters:** The 1615 eyewitness is one of the eight pages: in April 1615 men from the *Wapen van Amsterdam* catch "schilt padden dodeersen" as food on Mauritius (`1059_0277`). A list of spellings reaches it without an embedding index, provided you know the spellings, and the embedding method has the advantage of not needing them. 

**Optional follow-up:** *Put this into a Word document for a colleague: a one-page summary, then a table with date, place, page ID, the words used, what the writer says the bird did, and your confidence that it is the dodo. Add a crop of the scan for the 1647 invoice line and the 1674 passage, with a viewer link under each.*

Result: [Word document](https://raw.githubusercontent.com/kintopp/globalise-mcp/main/globalise-mcp-server/docs/dodo_names_globalise.docx).

### 2. [Shivaji](https://en.wikipedia.org/wiki/Shivaji), Sinasi and the Coronation at [Raigad](https://en.wikipedia.org/wiki/Raigad_Fort)

*The HTR often transcribes siuasi (Shivaji) as sinasi. How much does this matter in practice? Count the variants, and tell me how much a search on either spelling would miss. Then use this to find how VOC servants reported Shivaji's coronation at Raigad in 1674. Check the key passages and the n/u question on the scan. /globalise-voc-research*

[Demo](https://claude.ai/share/c03e2132-1eda-4a15-9ea4-742fd76c6231). Source: Nikhil Bellarykar, ["Guide to finding places in VOC documents with GLOBALISE"](https://globalise.huygens.knaw.nl/guide-to-finding-places-in-the-globalise-corpus-of-voc-documents/), GLOBALISE blog, 5 November 2025.

**How the tools enable it:**
- Counting spellings is a cheap series of `globalise_search_transcriptions` calls with `size: 1`: `siuasi`, `sinasi`, `siwasi`, `sivasi`, and the modern-looking `sevagi` and `sivagi`. Wildcards such as `si?asi*` catch one varying letter and the endings. Later forms such as `siwagie` need limiting to about 1660–1690, because they also match other, eighteenth-century men.
- The place name is the better route to the event: `rairi OR rairij OR rairy OR raijrij OR "raij rij" OR raijri` returns only 15 pages.
- `globalise_find_archival_documents` locates the Wingurla letters of 1674 in inventories 1302 and 1304. `globalise_inspect_page_image` compares letter shapes.
- For the follow-up, `globalise_view_document_ui` opens the page beside its transcription, and `globalise_navigate_viewer` zooms the open viewer to each occurrence. A reader can also drag a highlight there, and the assistant then reads that region with `globalise_inspect_page_image`.

**Why it matters:** The warning understates the problem. `sinasi` occurs on 74 pages and `siuasi` on 26, so the historically favoured spelling alone misses 67 of the 93 pages that the two find together. `sevagi` and `sivagi` find nothing. Neither of the two main spellings finds the fullest account, `1304_0908`–`0910`, where a single letter uses `siuarij`, `sinasij`, `sinasy`, `sunasij`, `sinatij` and more: about 11,000 "bramans en boots" gathered at "raij rij", a dispute over his caste, his weighing against gold, the throne on the 16th, the new name "siu raij 'tsitter pettij", and his mother's death twelve days later. The scan also complicates the warning itself. On `1266_1552` one hand writes the word three times with identical minims, and the HTR reads it as `sinasi`, `siuasi`, `sinasi`. 

**Optional follow-up:** *Open page 1266_1552 in the viewer and take me to each of the three occurrences in turn. Tell me whether you can see any difference in the letter forms.*

### 3. Deaf with Fever

*The surgeon Hendrick Leuseveld saw patients with hot fevers lose their hearing on the Karsenhof in 1738, and surgeons on other ships are reported to mention this too. Find those other surgeons' journals. Do they really report deafness with fever, how long did it last, and how did each explain it? Say where you could not establish a ship or a date. /globalise-voc-research*

[Demo](https://claude.ai/share/33642e3e-8cc1-4ef1-97b9-232289c988a2). Source: Linda Robertus, ["Cataplasma and Lienteria: Medical Terms in the VOC Archives"](https://globalise.huygens.knaw.nl/cataplasma-and-lienteria-medical-terms-in-the-voc-archives/), GLOBALISE blog, 27 March 2026.

**How the tools enable it:**
- `globalise_search_transcriptions`, with spellings taken from the pages rather than from a dictionary. Surgeons write `Coorsen` and `Koorsen`, so a query on `koorts*` misses Leuseveld's own passage. `(doof OR doofheijd OR doofigheijd) AND (ijlhoofdig* OR "heete koorsen" OR "brandende koorsen" OR "hitsige koorsen" OR delirium)` works. `gehoor` alone is a poor term, since it means an audience or obedience as often as hearing.
- `globalise_find_archival_documents` identifies a journal after the search, by inventory. Its catalogue word for the author is `opperchirurgijn`.
- Year filters would hide the evidence: several journals sit in inventories above 9000, which the finding aid largely does not date.

**Why it matters:** The claim holds up. Four separate texts report the symptom, with different explanations: nerve fluids lost to the fever (Leuseveld, `2431_0718`, with a second manuscript copy at `9866_0455` that can check the HTR of the first), infection of the nerves and brain (the *Gaasperdam*, `2493_0249`–`0250`), prior cold and rain with a quick recovery (`10493_0142`), and no theory at all from a surgeon who calls it "de bij ons in diergelijke siektens gangbaare doofheijd", the usual deafness in such illnesses, with one patient taking three weeks to recover (`9873_0158`). 

### 4. The Words for a Revolt

*In 1743 forty enslaved Buginese people rose on the VOC ship Delfland off Banda, in a story known through Sieree van Sorong, enslaved to the ship's bookkeeper. Find the trial papers. Whose testimony survives, particularly that of the enslaved? What do they say about how many people were bought, where Sieree came from, and who began it? Then test how well muiterij, oproer and opstand find this revolt compared with the words the clerks used, and whether those words find others. /globalise-voc-research*

[Demo](https://claude.ai/share/ed87bc01-188f-4b3b-afa4-47e6d36384d2). Source: Matthias van Rossum, ["Slavernij herbezien? De urgentie van het Aziatisch slavernijverleden"](https://symposiumnederlandsslavernijverledenindischeoceaan.nl/wp-content/uploads/2025/07/2025-06-04-Slavernij-herbezien-Openingslezing-Symposium-Slavernij-Indische-Oceaan.pdf), opening lecture, Symposium Nederlands Slavernijverleden Indische Oceaan, Utrecht, 4 June 2025.

**How the tools enable it:**
- `globalise_search_transcriptions` with the ship's spellings and the clerks' term: `(delfland OR delftland OR delfeland OR delflandt) AND (slaven OR slaaven) AND amok*` goes straight to inventory 9408. Filtering by `yearFrom`/`yearTo` would hide it, since that inventory is undated in the finding aid.
- `globalise_navigate` reads the interrogations in sequence. `globalise_inspect_page_image` corrects names, including the HTR's `Pieree` for Sieree.
- A comparison of terms: `(delfland OR delflandt OR delftland) AND (muijterij OR muiterij OR muijtinerie OR oproer OR opstand OR opstant)` returns one page, about something else (`2408_1729`). `(afgeloopen OR afgelopen OR afloopen OR aflopen) AND (slaven OR slaaven) AND (schip OR chialoup OR bodem OR vaartuijg) AND (amok OR amock OR moord* OR overheeden)` returns 52.

**Why it matters:** The Company did not file this as a mutiny, so modern words for resistance find almost none of it. The clerks wrote that a ship was *afgelopen* or that people played *amok*, and that query also reaches the *Sara Carolina* (`3552_0975`), the *Meermin* (`3214_0017`) and others. 

**Optional follow-up:** *Build a table of everyone who testifies in this dossier: name as written, status, owner, who questioned them, what they say about the number bought, and the page. Mark every name you could not confirm on the scan.*

Result: [Excel workbook](https://raw.githubusercontent.com/kintopp/globalise-mcp/main/globalise-mcp-server/docs/delfland_deponents.xlsx).

## The Catalogue and the Page

`globalise_find_archival_documents` searches 227,526 finding-aid entries and 950 Generale Missiven. It tells you what a cataloguer thought a document was, usually in one line.

### 5. Ten Letters Under One Heading

*The entry "Diverse copien van den Quinamschen coninck" (inv. 1120, fol. 481–490) is held to be ten letters by a non-European ruler catalogued as one document. Read the sequence from NL-HaNA_1.04.02_1120_0567. How many separate letters are there, to whom are they addressed, and what do they ask for? Compare the catalogue entry with the pages. Is collective cataloguing of rulers' letters actually more common than for Company officials? /globalise-voc-research*

[Demo](https://claude.ai/share/1670a77d-65b9-4a07-a01c-73d0d82035d2). Source: Renate Smit, ["Reusing traditional finding aids for the GLOBALISE infrastructure"](https://globalise.huygens.knaw.nl/from-abc-to-voc-volume-utilizing-traditional-finding-aids-for-the-globalise-infrastructure/), GLOBALISE blog, 20 June 2024.

**How the tools enable it:**
- `globalise_find_archival_documents` with `inventoryNumber: "1120"` and `query: "Quinam*"` gives the catalogue rows. `globalise_navigate` walks the scans.
- `globalise_inspect_page_image` separates the letters from the strip of a larger letter visible beside them, which the HTR mixes into the text.
- Pattern queries on the finding aid (`diverse AND (missiven OR brieven OR translaten) AND (coninck* OR koning* OR sulta*)`) give an order of magnitude for the second question. `documentType` cannot be searched, so this cannot be an exact count.

**Why it matters:** The found pages improve on the example. The ten blocks are five copies of the same two letters, with a sixth copy under its own entry at fol. 479. "Diverse copien" is literally accurate. What the catalogue really hides is the content. The letters are addressed to the "Hollantschen Coninck" and the "Nederlantschen Mandorijn" at Tayouan, not to the governors named in the heading. 

### 6. The Cannon of Kandy

This scenario also needs the [Rijksmuseum MCP server](https://github.com/kintopp/rijksmuseum-mcp-plus).

*Rijksmuseum record NG-NM-1015 is a silver- and gold-inlaid cannon said to have been captured at Kandy in 1765, returned to Sri Lanka in 2023. Find VOC Ceylon papers of 1765–66 that record the booty. Is the cannon on any list, how was it described and valued, and what happened to it next? How far do the museum record and the archive agree, and what would prove that they are describing the same object? /globalise-voc-research*

[Demo](https://claude.ai/share/eaf30c20-e3a4-4eea-ba59-b7f92c453bb8). Source: Rijksmuseum, [object NG-NM-1015](https://www.rijksmuseum.nl/en/collection/NG-NM-1015).

**How the tools enable it:**
- Rijksmuseum `search_artwork` with `type: "cannon"`, `productionPlace: "Sri Lanka"` finds the record, and `get_artwork_details` returns the catalogue text.
- `globalise_find_archival_documents` with `settlement: "Ceylon"`, `yearFrom: 1765`, `yearTo: 1766` and Kandy spellings lists the relevant inventories.
- `globalise_search_transcriptions` works better on the booty than on the gun: `buit` is more specific than `kanon`, which drowns in artillery lists. `(Candia OR Kandi*) AND (buijt OR buit) AND (kanon OR canon)` narrows it.

**Why it matters:** On 22 October 1765 goods "in Candia buit gemaekt" are assayed, including "1. kleen kanon stuk met zilver ingelegd weegt 90 lb: en gewardeert voor twintig rd:s" (`3143_1070`). The same list exposes gilt that had been taken for gold. This is only a plausible match, not proof. The page mentions no gold, rubies or lion, twenty rixdollars is low beside 120 for a gold-mounted dagger, and the museum gives no barrel weight to compare. The pages also complicate the museum's narrative of capture by troops: here the object is listed among goods found in the dead governor's estate (`3143_0949`), part of a disputed booty process. If this is the museum's cannon, its route to the Netherlands runs through a gift to the Duke, and no later trace has been found in the Ceylon papers. 

**Optional follow-up:** *Make a two-column Word table setting the museum's description beside the archival one, feature by feature, with the image of the cannon and a crop of the 1765 list.*

Result: [Word document](https://raw.githubusercontent.com/kintopp/globalise-mcp/main/globalise-mcp-server/docs/NG-NM-1015_museum_vs_archive.docx).

### 7. Ambon, February 1674

*The Ambon earthquake and sea wave of 1674 are usually known through Rumphius's printed account. What do the Ambon papers themselves record close to the event, about damage and deaths? Are there reports independent of Rumphius? How do the figures change between Ambon and the Generale Missive, and how long did the news take to reach Batavia and the Heren XVII? /globalise-voc-research*

[Demo](https://claude.ai/share/4e1e1a16-f883-4277-87ea-498860da8c7c). Source: [Georg Everhard Rumphius], [*Waerachtigh verhael, van de schrickelijcke aerdbevinge*](https://doi.org/10.1163/2214-8264_dutchpamphlets-kb1-kb13185) (1675), Dutch Pamphlets Online.

**How the tools enable it:**
- `globalise_find_archival_documents` with `settlement: "Ambon"`, `yearFrom: 1674`, `yearTo: 1674` lists the bundle in inventory 1300, including a dedicated narrative. `source: "gm"` gives the general letter with its `scanStart` and, for published letters, `publishedEdition`: links to the page scans of the printed RGP edition at the Huygens Institute and to its text.
- `globalise_search_transcriptions` with `inventoryNumber: "1300"` and spellings including `aerdbevinge`, `aardbeving`, `"aerd beving"`. A year window leaks other earthquakes and should not be counted.
- `globalise_inspect_page_image` checks numerals. The HTR reads "19 feb." on the narrative's heading where the scan has 17 (`1300_0087`).

**Why it matters:** Reports written within days survive in the day register, from named observers such as Jacob Bollard at Hitulama (`1300_0538`). The council letter of 14 April gives figures by place: 79 dead at the castle, about 2,250 on Hitu including 31 Europeans (`1300_0026`; the last digit of the larger figure is unclear). But Rumphius co-signs it (`1300_0030`), so "other than Rumphius" is less simple than it sounds. The RGP edition is a selection, so the manuscript still matters: the published text of this letter ([vol. 3, pp. 919–923](https://resources.huygens.knaw.nl/retroboeken/generalemissiven/#source=3&page=932&view=imagePane)) omits the earthquake passage altogether. The disaster enters the edition only with the letter of 17 November ([pp. 926–928](https://resources.huygens.knaw.nl/retroboeken/generalemissiven/#source=3&page=939&view=imagePane)), where an editors' note gives 2,322 dead and dates it 11 February, against "ongeveer 2400" and 17–18 February in the manuscript of the October letter. The relationship between the manuscript narrative and the printed account still needs a side-by-side reading.

## Quantities and Goods

`globalise_lookup_commodity` and `globalise_lookup_measure` are small reference works built from period sources. Neither settles a question by itself. Each tells you what to look for and what could be wrong.

### 8. The Same Cloth?

*Textile names did not have fixed meanings: cheaper imitations traded under the same name. VOC records use kannekijns and kannekije, and sell patola in both silk and cotton. Can you tell the two kanneki- goods apart from context alone? Does the price of patola vary with its material? Is the name on its own a reliable guide to what was shipped? /globalise-voc-research*

[Demo](https://claude.ai/share/9fbd7612-70fc-4a1c-97dd-ca7f79be2511). Source: Henrike Vellinga, ["Textile Taxonomies – GLOBALISE's efforts in defining traded textiles in the Indian Ocean Region"](https://globalise.huygens.knaw.nl/textile-taxonomies-globalises-efforts-in-defining-traded-textiles-in-the-indian-ocean-region/), GLOBALISE blog, 5 April 2023, updated 19 December 2023.

**How the tools enable it:**
- `globalise_lookup_commodity` draws on the project's commodity thesaurus. Query it with `kannekijn* OR kannekije OR cannekijn*` and `patola* OR patol*`. Weigh each definition by `definitionSource` and `confidence`. The `prefLabelEn` "patola" belongs to a weaker, LLM-defined entry, while the sourced concept has it only as an alternative label.
- `globalise_search_transcriptions` with exact forms plus context: `(kannekije OR cannekije OR kannekie OR cannekie) AND (zijde OR sijde OR persia* OR gamron OR ispahan)`. Fuzzy `kannekije~1` merges the two goods, which is exactly what this question has to avoid.
- `globalise_inspect_page_image` for every price.

**Why it matters:** The two kanneki- goods live in different accounting worlds. Silk *kannekije* comes by the bale in man and toman at Persian offices (`1084_0219`). Cloth *kannekijns* comes by the piece in corge and rupees at Surat. Context would separate them even without the glossary, and it also tests the glossary: the cloth defined as "fine, white" also appears as "grove" and "swarte" (`1109_0452`, `9054_0196`). At Surat in 1779, silk patola of 9 asta costs 335 rupees the corge and cotton of 6 asta 21 13/48 (`3549_0448`–`0449`), roughly tenfold per unit length. On one copy the HTR gives 35 for the silk, dropping a digit, while another copy reads 335 (`3549_0187`), so a second copy can catch what a single page hides.

### 9. How Much Is 77 Bharen?

*A VOC letter records "77 bharen peper" reaching Batavia from Sumatra's west coast. How much pepper is that? Start from the page, then compare the recorded value of the unit for that place and good. Do they agree? If not, what would you trust, and how far can you go towards a modern weight? /globalise-voc-research*

[Demo](https://claude.ai/share/b2c374af-6a10-42b9-a4d6-aae44d8726c8). Source: VOC letter, Nationaal Archief 1.04.02, [inv. 1297, scan 0635](https://transcriptions.globalise.huygens.knaw.nl/detail/urn:globalise:NL-HaNA_1.04.02_1297_0635).

**How the tools enable it:**
- `globalise_lookup_measure` draws on the server's list of VOC weights and measures. `query: "bahar"` returns the unit's variants (`baar`, `bhaar`), its definitions, and ratios tagged with place and commodity. The tool makes it clear that it is not a conversion calculator. 
- `globalise_search_transcriptions` finds pages that state their own unit: `(bhaaren OR bharen OR baharen OR "bhaar") AND (peper OR peeper) AND padang AND (ponden OR lb)`.
- Pages stating a total in both units give a cheap check on HTR digits, since the ratio should come out even.

**Why it matters:** The glossary gives 375 pounds for "peper, Padang", from a memorial of 1764–71. The letter itself says "77 bharen peper van 412½ lb p:r bhaar" (`1297_0635`), and a 1721 page repeats 412½ (`1961_0899`), a difference of about 9%. A 1773 letter gives 390 for the west coast (`3583_0193`). Bantam pages work out at exactly 375 from 1766 to 1786 (`7725_0181`, `7883_0664`), though the glossary has no Bantam entry. So a ratio holds only for its place, its commodity and its date. 

## People in Company Paper

Nothing in the corpus identifies a person across pages. Finding someone means following a name through every spelling, and then deciding whether it is one person. 

### 10. One Man, Three Labels

*The Melaka merchant Alexio Cardosa is sometimes called a "black" or "native" resident and sometimes a "Maardijker", which suggests that administrative terminology was not rigid. Build a dated sequence of his entries across all spellings and both copies of the series. Does the label change over time, between documents or between copyists? Do other men in the same register get the same treatment? Could there be two men of this name? /globalise-voc-research*

[Demo](https://claude.ai/share/1ed1df2b-e03b-4101-98e7-b8a993319fdd). Source: Marc Widmer, ["Closeness at a Distance? The Port Town Paradox"](https://globalise.huygens.knaw.nl/closeness-at-a-distance-the-port-town-paradox/), GLOBALISE blog, 25 October 2024.

**How the tools enable it:**
- `globalise_search_transcriptions`: exact phrases find 7 pages, while `(alexio~1 OR alesio~1 OR alepio) AND (cardos* OR cardoz*)` finds 30. The commonest form, *Aleixo*, is caught by the fuzzy term as a transposition.
- `inventoryRange` over both 17xx and 85xx treats the parallel series as a control on the copyist. It also means that 28 hits are only about 14 entries, so counting hits would double the man.
- `globalise_inspect_page_image` confirms the labels `swart` and `mardijker`.

**Why it matters:** About seventeen entries from 1705 to 1717 show that the label follows neither date, genre nor copyist. All come from one register genre. Where the copies were compared, the spelling of the name changes but the label does not. Within 1708 he is burger, inwoonder and swart inwoonder. On these pages he is also mostly a skipper, often of other people's boats, more than the merchant of the post. Anyone reading such labels as legal status should be cautious. 

**Optional follow-up:** *Lay the entries out as a timeline, one row per entry, coloured by label, with vessel owner and page ID. Mark which readings you checked on the scan.*

Result: [Timeline](https://claude.ai/artifact/3TSSgQ6WML6Coe8CGPYmNH).

### 11. Two Widows and a Chat Summary

*A chat summary of inventory 9221 reports that Neeltje Koek and Helena Kackelaar, sisters-in-law and widows in Batavia, were tried over smuggled opium, that both were exempted from banishment, and that both were fined 8,000 rijksdaalders. Check this against the pages across the whole corpus. What was charged, what was the sentence at first instance and on revision, how are the women described, and who else is in the case? What happened to each afterwards? /globalise-voc-research*

[Demo](https://claude.ai/share/364da2b6-cd8a-4c11-9f2e-02dade88ff3d). Source: Arlette Verdonk, ["Digging deeper in the VOC archives, without the right keywords"](https://globalise.huygens.knaw.nl/digging-deeper-in-the-voc-archives-without-the-right-keywords/), GLOBALISE blog, 4 February 2026.

**How the tools enable it:**
- `globalise_search_transcriptions` across the whole corpus with `"neeltje koek" OR "helena kackelaar" OR "neeltie koek" OR "helena kakelaar" OR "helena kackelaer"` returns 136 pages. Inventory 9221 has only 14 of them, and the fuller trial copies are in 1989, 2003 and 2006. Starting with an inventory filter would have hidden them.
- `globalise_navigate` follows the sentences. `globalise_inspect_page_image` resolves margin notes that the HTR runs into the text.

**Why it matters:** The revision exempts "Neeltje koekk alleen" from banishment and adds the fine for both women (`9221_0329`), so Helena is not spared by that text. She stays behind only because she is held to be leprous, placed "op het eijland purmerend" (`2006_0232`–`0233`). Half the fine goes to the prosecutor. The pages read give the name of her late husband as *de Radder*, and did not confirm the "English marks" on the chests or the sisters-in-law relationship. 

## Languages and Ciphers

Every page carries language tags from an automatic classifier, with non-Latin scripts and cipher listed by hand and a running list of manual corrections. The classifier assigns tags from a page's paragraph regions only, so marginalia, signatures and catch-words do not count. 

### 12. Who Wrote to the Company in Portuguese?

*Portuguese is tagged on only a few hundred of the VOC's 4.8 million pages. Which offices and periods do these pages come from, and who is writing to whom? Read a spread across the top inventories. Is this captured enemy paper, diplomacy, or something else, and does that change over time? Separate what the pages say from what the finding aid says. /globalise-voc-research*

[Demo](https://claude.ai/share/6a315c39-7537-4a4d-bd55-b6d97810b915). Source: Arno Bosse, ["The Languages of GLOBALISE"](https://globalise.huygens.knaw.nl/the-languages-of-globalise/), GLOBALISE blog, 11 December 2024. Data: [language-identification-data](https://github.com/globalise-huygens/language-identification-data).

**How the tools enable it:**
- `globalise_search_transcriptions` with `query: "*"`, `languages: ["por"]`, `size: 1` returns the total of 583 and the top inventories. Paging with `sortBy: "invNr"` shows the rest.
- Year windows give a rough curve, but they are blind to unindexed series. Inventory 9346 has the most Portuguese pages and no finding-aid entry at all.
- `globalise_find_archival_documents` with `inventoryNumber` and `source: "obp"` explains a page after the language filter has found it. Here the usual order of scoping first is the wrong way round.

**Why it matters:** Portuguese here is several things. Early on, the pages read skew towards paper taken from an enemy or disputed with one: a protest from Macau (`1076_0205`), post from Rio de Janeiro marked "waarschijnlijk onderschepte post" in the finding aid (`1125_0821`), a legal argument over Galle (`1144_0484`). But the Company also writes in Portuguese itself. Its draft treaty to Rajasingha of Kandy (`1129_0343`) uses that language to denounce "purtuqueses Cobisozos". Later it works as a contact language: an Isfahan court interpreter (`1818_1001`), a crew's petition after a seizure at Mergui (`3794_0779`), a gift letter on Timor (`2941_0513`). 

**Optional follow-up (language detection):** *The tags ignore short phrases by design. Search for Portuguese and Malay formulae and function words on pages not tagged with those languages. Read what you find, and separate correctly excluded quotations from real Portuguese or Malay text filed as Dutch. Report your sample size and do not claim an error rate. If a whole text is missing its tag, what might explain it?*

The threshold does what it should on short phrases: a quoted oath or address correctly stays Dutch (`3463_0801`, `1391_1107`). But a search for Malay function words, `(dengan OR dangan OR deng*an) AND (yang OR jang OR iang) AND (maka OR adapon OR adapun OR kapada OR kepada)`, also reaches long Malay texts tagged only as Dutch (`1301_1774`, `1515_1049`), including the page the languages post itself shows as a Dutch-Malay example (`1554_0601`), and tagging can change between neighbouring pages of a single document (`1515_1049`–`1050`). 

### 13. What Was Worth Enciphering?

*Only a handful of pages in the VOC archive are tagged as cipher. Find them, read around them, and tell me who wrote, to whom, when, and about what. Why would those passages be hidden when so much else in the same letters was not? How did the letters travel? Check the scans, since the HTR will not help. /globalise-voc-research*

[Demo](https://claude.ai/share/befb8930-434a-4a1b-ac96-c42ad8bd109f). Source: GLOBALISE, [list of non-Latin script and cipher pages](https://github.com/globalise-huygens/language-identification-data/blob/main/non-latin-script-pages/non-latin.scripts.tsv), language-identification-data.

**How the tools enable it:**
- `globalise_search_transcriptions` with `query: "*"`, `languages: ["art"]`, `sortBy: "document"` lists all 8 pages. Note that `art` marks encrypted Dutch, not an artificial language.
- `globalise_find_archival_documents` with `inventoryNumber` and a folio range places each page. A Generale Missive's scan range dates the first case with no guessing. Finding-aid entries in order name the bearer of the second.
- `globalise_navigate` reads the plain text on either side. `globalise_inspect_page_image` is decisive: nothing in the metadata reveals a decipherment or a key.
- Search cannot find cipher, since it has no vocabulary. The `unknown` pages next to tagged ones have to be checked by eye.

**Why it matters:** The eight pages resolve to two cases. In the general letter of 29 July 1661, Batavia discusses the war with Coxinga openly but enciphers one request: orders on what to do if the Japanese forbid attacks on the enemy in their waters (`1232_1618`). The second is a symbol cipher filed with Van Goens's letter of 10 February 1674, its key slip still in the volume (`1292_1221`). The letter's bearer can report things "die 't papier niet mogen werden vertrouwt" (`1292_1219`).

**Optional follow-up:** *Using the key on 1292_1221, try to decipher the first lines of the text, showing your work sign by sign and flagging anything uncertain. Then say whether the content bears out the finding aid's guess that it concerns Ramanacoil.*

Jörgen Dinnissen and Nils Kopal have decoded these pages ("Island Ramanacoil a Bridge too Far", [HistoCrypt 2021](https://doi.org/10.3384/ecp183156)). See also [this explainer](https://claude.ai/artifact/CWLuJtXvE4Xh1aDR31j4VV) for how the 1674 letter can be deciphered. 


## From the Shell

### 14. When Did Java Coffee Overtake Mocha, on Paper?

The CLI (`glob-mcp`, or `node scripts/cli.mjs` from a checkout) is a command-line client for the same MCP server. It writes the structured results an assistant receives as JSON to stdout, and counts and notes to stderr, so its output can go straight into a `jq` pipeline.

The Company's coffee moved from Mocha to Java in the eighteenth century. This asks when that shows in its paperwork, measured in two ways: pages naming coffee with either place anywhere on the page, and pages using a place as an adjective next to the coffee.

```bash
export GLOBALISE_MCP_HTTP=https://globalise-mcp-production.up.railway.app/mcp

n() { node scripts/cli.mjs search "$1" --inventoryRange 1053-4454 \
        --yearFrom "$2" --yearTo "$(($2 + 9))" --max 1 --json --quiet 2>/dev/null \
      | jq -r '.total.value'; }

C='(coffij OR koffij)'
M="$C AND (mocha* OR mocka OR mokka OR moka OR mocca*)"
J="$C AND (java OR javase OR javasche OR javaase OR cheribon OR preanger OR jaccatra OR jaccatrase)"
PM='"mochase coffij"~2 OR "mocha coffij"~2 OR "mokkase coffij"~2 OR "mokka coffij"~2 OR "moccase coffij"~2 OR "mocka coffij"~2 OR "mochasche coffij"~2'
PJ='"javase coffij"~2 OR "java coffij"~2 OR "javasche coffij"~2 OR "javaanse coffij"~2 OR "javaase coffij"~2 OR "jaccatrase coffij"~2 OR "jaccatrasche coffij"~2 OR "cheribonse coffij"~2'

printf 'decade\tcoffee\tmocha\tjava\tadj_mocha\tadj_java\n'
for d in 1700 1710 1720 1730 1740 1750 1760 1770 1780; do
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$d" "$(n "$C" $d)" "$(n "$M" $d)" "$(n "$J" $d)" "$(n "$PM" $d)" "$(n "$PJ" $d)"
done
```

```
decade  coffee  mocha  java  adj_mocha  adj_java
1700    773     133    48    12         7
1710    1429    498    104   29         19
1720    4968    1182   503   102        148
1730    5129    849    486   106        143
1740    2964    339    286   72         88
1750    2054    89     237   15         42
1760    2504    35     321   13         19
1770    2344    14     309   2          7
1780    2588    19     372   1          12
```

**Why it matters:** The two measures disagree by about thirty years. Pages naming coffee and either place cross in the 1750s, while the adjective phrases already favour Java in the 1720s. A possible reading is that "Java" as a kind of coffee arrived early, while Mocha kept appearing as a place of business. Because the CLI calls the same tools as the assistant, a figure reproduced at the shell is the figure the model would quote.

These are pages, not tons or prices, so they measure paperwork. `--inventoryRange 1053-4454` deliberately leaves out the Zeeland chamber series, since about a third of the corpus sits there and parts of it repeat this text, and it would count some letters twice. Year windows work on whole inventories, so one inventory can fall into two decades. And the place words on a page may have nothing to do with its coffee, which is why the sparse adjective count is shown beside the larger one. Spellings have to be tested first: `koffie` occurs on 119 pages in the corpus against `coffij`'s 25,124.
