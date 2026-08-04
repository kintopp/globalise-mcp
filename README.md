# Globalise MCP

A Model Context Protocol (MCP) server and API documentation for accessing a corpus of approximately 4.8M machine-generated transcriptions of Dutch East India Company (VOC) historical documents hosted by the [GLOBALISE project](https://globalise.huygens.knaw.nl) at the Royal Netherlands Academy of Arts and Sciences (KNAW). Beyond offering natural language search and retrieval of the corpus, the Globalise MCP also draws on local archival finding aids and glossaries of VOC commodities and historical weights and measures to allow the AI-assistant to offer richer, more contextualised answers to user queries. In addition, users can view and interact with individual page scans and transcriptions from the corpus in their chat sessions.
### About GLOBALISE

The [GLOBALISE project](https://globalise.huygens.knaw.nl/) is digitizing and [making accessible](https://transcriptions.globalise.huygens.knaw.nl/) the archives of the Dutch East India Company (VOC). The Globalise corpus focuses on the [_Overgekomen Brieven en Papieren_](https://www.nationaalarchief.nl/onderzoeken/archief/1.04.02) which were sent from the company’s Asian headquarters in Batavia to the Dutch Republic in the seventeenth and eighteenth centuries and are now held by the [Dutch National Archives](https://www.nationaalarchief.nl). The transcriptions were machine-generated using an open-source [Handwritten Text Recognition (HTR) toolkit](https://github.com/knaw-huc/loghi) and are freely available under a Creative Commons [CC0 license](https://creativecommons.org/publicdomain/zero/1.0) together with their metadata and page scans.
### Installation

The easiest way to get started is with [Claude Desktop](https://claude.com/download) or [claude.ai](https://claude.ai) by adding the Gobalise MCP as a *hosted service* or [custom 'Connector'](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) with the URL below. This is currently free for one connector – additional connectors in Claude require a paid ('Pro') or higher [subscription](https://claude.com/pricing) from Anthropic.

```
https://globalise-mcp-production.up.railway.app/mcp
```

Go to _Customize_ → _Connectors_ → _Add custom connector_ → Name it as you like and paste the URL into the _Remote MCP Server URL_ field. You can ignore the Authentication section. Once the connector is configured, optionally set the permissions for its tools (e.g. 'Always allow'). See Anthropic's [instructions](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) for more detailed instructions. 

It is also possible to use a custom, hosted MCP server with other AI (web) applications, such as OpenAI's ChatGPT or Mistral's LeChat as well as a variety of open-source alternatives. Since the capabilitites, conditions of use, and installation instructions differ in each case please consult the documentation of the respective tool for more details.    

Alternatively, you can install the Globalise MCP server *locally* on your own computer. The simplest way to do this is via Claude Desktop [extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).  Download this project's c. 5MB `.mcpb` extension from this project's repository on GitHub, and then navigate to Settings > Extensions in Claude Desktop to add it. This will install the Globalise MCP extension and dowload a small ~110MB database with the associated finding aids and historical glossaries. [Claude Desktop](https://claude.com/download) is freely available for macOS, Windows, and Linux. Alternatively, you can also install it manually and use it with a wide variety of open source tools and AI models by drawing on [these instructions](./globalise-mcp-server/README.md). 
### GLOBALISE MCP Server

**Features:**
- Search transcriptions — full-text queries with inventory/language filters and aggregations
- Retrieve documents — metadata, annotations, and IIIF image URLs
- Navigate between pages within an inventory
- Search archival finding aids — 228K+ VOC document indexes
- Look up VOC commodities and weights & measures — Dutch labels, definitions, period spellings and conversions
- View a page interactively — scan alongside transcription
- SKILL file – provides the model with best practices for searching and retrieving data
- CLI client - a command-line interface to the MCP server's tools

#### MCP Server Tools

Most of the tools listed here are designed to reproduce the functionality provided by the [GLOBALISE Transcriptions Viewer](https://transcriptions.globalise.huygens.knaw.nl/). In response to a natural language query, the MCP server will automatically choose and combine the ten tools below (often chaining several together in sequence) to produce an answer. A few tools, such as `globalise_inspect_page_image`,  `globalise_navigate_viewer`, `globalise_lookup_commodity` and `globalise_lookup_measures` offer additional features not (yet) available in the GLOBALISE Transcriptions Viewer.

**`globalise_search_transcriptions`** — Searches the full text of approximately 4.78 million indexed transcription pages for a word or phrase, much like a regular keyword search, and returns the best-matching passages with the search terms highlighted. It can narrow by inventory number or language and combine terms with `AND`/`OR`/`NOT`, quoted phrases, wildcards, and fuzzy matching. This also helps address historical variants.

**`globalise_retrieve_document`** — Fetches a single page using its identifier (for example `NL-HaNA_1.04.02_9966_0106`) and returns the complete transcription line by line together with its metadata: languages, dates, and rights statement. It also reports the identifiers of the preceding and following pages and provides links to the GLOBALISE transcription viewer and the original scan held by the Dutch National Archives.

**`globalise_navigate`** — Moves one page forward or backward from a given page, so you can read through a volume in sequence instead of jumping between scattered search results. It returns the neighbouring page in full — transcription, metadata, and links — and tells you when you have reached the beginning or end of the run.

**`globalise_find_archival_documents`** — Searches a local TANAP index of more than 228,000 finding-aid entries (the catalogue level that sits above the page transcriptions) so the right inventories can be located before reading any pages. It covers two bodies of material: the OBP digitised indexes (some 227,000 entries recording, for each set of papers, the VOC settlement it came from, the year, and the inventory and folio) and the roughly 950 Generale Missiven, the governors-general's official dispatches from Batavia to the Dutch Republic, many of which link to their scholarly published edition (the RGP series) at the Huygens Institute. The inventory numbers it returns can be passed straight to a transcription search to reach the actual pages.

**`globalise_lookup_commodity`** — Looks up a trade good in a local glossary of about 3,500 VOC commodities, returning the historical term used (e.g. *mace* resolves to *foelie* and *coffee* to *koffie*), an English label, and a provenance and confidence-labelled definition. It serves as the bridge between a modern vocabulary and the words to search for in the historical transcriptions; some entries also list period spelling variants, and every result can return a link to the concept's page in the official GLOBALISE commodities thesaurus. This is important since more than half of the definitions in this glossary were AI-generated and labelled as such.

**`globalise_lookup_measure`** — Looks up a historical VOC unit of weight, volume, length, or area — some 213 units drawn from a 1764–1771 reference work — and returns its category, its period spelling variants, and the conversion ratios recorded for it. It is deliberately not a conversion calculator: early-modern measures were unstable, so a *bahar* of pepper was not a *bahar* of cloves, and each ratio is tied to the particular place and commodity it was recorded for (given in a context note). Its value lies in recovering the spellings to search for and understanding what a unit meant in a given trade, rather than in converting to modern metric values.

**`globalise_view_document_ui`** — Opens a page in an interactive viewer that sets the zoomable, high-resolution scan of the original manuscript beside its line-numbered transcription, letting you check the machine reading against the original text. Search terms can be highlighted, and selecting a passage in the transcription is a natural way to ask the assistant for a modern rendering of the early-modern Dutch.

**`globalise_inspect_page_image`** — Fetches a page scan, or a region of it, as an image for the AI assistant itself to look at. In the viewer, press `i` (or the ☐ button) and drag a box over the scan: the assistant receives the coordinates, retrieves that crop of the original image, and can re-transcribe or describe exactly what you marked. This can serve as a second opinion on the machine transcription for garbled names, numerals, marginalia, or non-Latin scripts. The assistant can also zoom into a page by itself when you ask about a specific detail.

**`globalise_navigate_viewer`** — Lets the AI assistant steer an open viewer: for example to zoom it to a region to direct your attention to a detail. When you ask the assistant about a passage it inspects, the viewer auto-zooms to match. A companion internal tool, `globalise_poll_viewer_commands`, is the viewer's own channel for passing the navigation commands to the open page.

### Supporting Datasets

#### Finding aids

The server includes a local database of more than 228,000 finding-aid entries derived from the TANAP descriptions of the VOC archive (the catalogue layer that sits above the page-level transcriptions). The bulk of it (some 227,000 entries) comes from the digitised indexes to the *Overgekomen brieven en papieren* (OBP), the papers sent home from Asia, each entry recording the VOC settlement it concerns, the year, and the inventory number and folio where the papers sit. Alongside these are roughly 950 entries for the *Generale Missiven*, the governors-general's periodic dispatches from Batavia to the Dutch Republic, many linked to their published scholarly edition in the RGP series at the Huygens Institute. Because the index is bundled with the server, these searches run locally even when the upstream transcription API is unreachable. It is the dataset behind the `globalise_find_archival_documents` tool.

Sources:
- [GLOBALISE — Digitized Indexes of the Dutch East India Company OBP (1602–1799)](https://hdl.handle.net/10622/LVOQTG) — IISG Dataverse
- [Overzicht van Generale Missiven in het archief van de VOC, 1.04.02](https://hdl.handle.net/10622/BHKMWE) — IISG Dataverse
- [VOC archive finding aid 1.04.02](https://www.nationaalarchief.nl/onderzoeken/archief/1.04.02) — Dutch National Archives
- [Generale Missiven RGP edition online](https://resources.huygens.knaw.nl/retroboeken/generalemissiven/) — Huygens Institute

#### Historical glossaries

Two reference vocabularies, in a small local database, help translate between modern vocabulary and the historical and regional terms found in the corpus. The commodities glossary covers about 3,500 trade goods, giving for each the period Dutch term, an English label, spelling variants, and a sourced, confidence-rated definition, with links to the official GLOBALISE commodities thesaurus. N.B. The commodities glossary was derived from the October 2023 (v1) release of the GLOBALISE commodities thesaurus and was subsequently extensively revised and enriched, including with the help of AI models (more than half of the definitions are AI-generated and labelled as such). For this reason, it is NOT an official dataset of the GLOBALISE project. The weights-and-measures glossary describes some 213 historical units of weight, volume, length, and area drawn from an eighteenth-century reference work (1764–1771), recording each unit's spelling variants and the place- and commodity-specific conversion ratios attested for it. This document was only lightly revised, but is also NOT an official dataset of the GLOBALISE project. Both glossaries retain their original CC-BY-SA-4.0 license, and power the `globalise_lookup_commodity` and `globalise_lookup_measure` tools.

Sources:
- [GLOBALISE Thesaurus — Commodities](https://hdl.handle.net/10622/YAWDOV) — IISG Dataverse
- [GLOBALISE — Weights and Measures in the 18th-Century Indian Ocean World](https://hdl.handle.net/10622/MDNVH5) — IISG Dataverse

### SKILL file

The project's skill is available as [`globalise-voc-research.skill`](./globalise-mcp-server/skills/globalise-voc-research.skill) (source: [`SKILL.md`](./globalise-mcp-server/skills/globalise-voc-research/SKILL.md)).

A skill file (SKILL.md, often combined with other resources into a zip archive with a  .skill suffix) gives an AI assistant detailed guidance in natural language on how to use an MCP server effectively: which tool to choose for a given question type, how to combine searches, important metadata distinctions, and known limitations. Making use of a skill file is optional but will usually improve the quality and efficiency of the AI assistant’s responses.

At present, the Globalise skill offers fairly generic guidance; adding specific collection and domain expertise would make it substantially better.

### Repository Contents

#### [`globalise-mcp-server/`](./globalise-mcp-server/)

```
src/
├── index.ts                 # Entry point, tool + resource registration
├── tools/                   # Tool implementations (search, document, viewer, archival-index)
├── transports/http-server.ts  # Streamable HTTP transport
└── utils/                   # API client, cache, SQLite, IIIF, types
apps/
└── document-viewer/         # Interactive viewer (Vite SPA, bundled at build)
scripts/
└── cli.mjs                  # Headless MCP-client CLI (glob-mcp bin); test-cli.ts smoke-tests it
```
#### [`globalise-transcriptions-api/`](./globalise-transcriptions-api/)

- [API Reference](./globalise-transcriptions-api/API_REFERENCE.md) - Endpoints, parameters, and examples
- [Query Syntax](./globalise-transcriptions-api/QUERY_SYNTAX.md) - Boolean operators, wildcards, fuzzy matching
- [Data Models](./globalise-transcriptions-api/DATA_MODELS.md) - Response structures and field definitions
- [OpenAPI Specification](./globalise-transcriptions-api/openapi.yaml) - Machine-readable API spec

### Authors

[Arno Bosse](https://orcid.org/0000-0003-3681-1289) — [RISE](https://rise.unibas.ch/), University of Basel, with [Claude Code](https://claude.com/product/claude-code), Anthropic.

N.B. The VOC transcriptions, finding aids, and vocabularies served by this software are produced by the [GLOBALISE project](https://globalise.huygens.knaw.nl/) at the Huygens Institute (KNAW) and made available under [CC0](https://creativecommons.org/publicdomain/zero/1.0/); the commodities and weights-&-measures glossaries are licensed CC-BY-SA-4.0 by their respective compilers.

### Citation

If you use the GLOBALISE MCP Server in your research, please cite it and the underlying GLOBALISE transcriptions separately:

#### Globalise VOC Transcriptions

When using the transcriptions, please cite:
> NL-HaNA, VOC, [inv.nr.], [scan nr.], transcription GLOBALISE project (https://globalise.huygens.knaw.nl/), March 2024

#### Globalise MCP Server

**APA (7th ed.)**

> Bosse, A. (2026). *GLOBALISE MCP Server* (Version 2.11.10) [Software]. Research and Infrastructure Support (RISE), University of Basel. https://github.com/kintopp/globalise-mcp

**BibTeX**
```bibtex
@software{bosse_2026_globalise_mcp,
  author    = {Bosse, Arno},
  title     = {{GLOBALISE MCP Server}},
  year      = {2026},
  version   = {2.11.10},
  publisher = {Research and Infrastructure Support (RISE), University of Basel},
  url       = {https://github.com/kintopp/globalise-mcp},
  orcid     = {0000-0003-3681-1289},
  note      = {Developed with Claude Code (Anthropic, \url{https://www.anthropic.com})}
}
```
A machine-readable [`CITATION.cff`](./CITATION.cff) for the GLOBALISE MCP server is included in the root of this repository.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

The GLOBALISE transcriptions themselves are licensed under [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (Creative Commons Zero).
