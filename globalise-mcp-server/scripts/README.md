# Scripts

## Build scripts

- **build-archival-db.ts** — Builds the archival index SQLite database (with FTS5) from CSV sources. Called by `npm run build:db`.

## Data preparation (weights & measures)

- **generate_resource_json.py** — Generates weights-measures.json from source TSV files (glossary + labels).
- **regenerate-weights-measures.js** — Regenerates weights-measures.json from source TSV files, including conversions data.
- **regenerate-lookup.js** — Regenerates just the lookup table in weights-measures.json from the Labels TSV, with disambiguation policy for ambiguous terms.
- **validate-weights-measures.js** — Validates weights-measures.json against the source TSV files (units, labels, types, definitions).
- **export-weights-measures-tsv.js** — Exports weights-measures.json back to TSV files for inspection.

## Data preparation (commodities)

- **parse-commodities.js** — Parses a commodities RDF/SKOS TriG file and converts it to JSON.
- **compact_thesaurus_ids.py** — Replaces UUIDs in thesaurus JSON files with compact namespaced short IDs.

## Data files

The `weights-measures-*.tsv` files are output from `export-weights-measures-tsv.js`.
