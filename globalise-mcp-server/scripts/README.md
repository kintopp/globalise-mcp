# Scripts

## Build / data
- **build-archival-db.ts** — builds `data/archival-index.sqlite` (FTS5) from CSV. `npm run build:db`.
- **build-commodities-db.ts** — builds the whole reference DB (commodities + measures) → `data/reference.sqlite`. `npm run build:db:commodities`.
- **ensure-archival-db.ts**, **ensure-reference-db.ts** — decompress/download the committed DBs at build time. `npm run ensure:db`.
- **db-build-utils.ts** — shared helpers for the build/ensure scripts.
- **commodities-tsv.ts** — the commodities TSV parser, shared by the reference-DB build and `test-commodities-quoting.ts`.
- **build-mcpb.ts** — packs the `.mcpb` bundle. `npm run build:mcpb`.

## Tests
Run by `npm test` (offline chain, order in package.json's `test` script):
every `test-*.ts` except the three listed below, then smoke-test.ts.
test-utils.ts holds the shared helpers. The chain also runs two
typecheck-only gates that have no script file: `test:viewer-typecheck`
(`tsc -p apps/document-viewer`) and `test:cli-typecheck`
(`tsc -p scripts/tsconfig.cli.json`).
Out of the default chain (network / built dist / bundle):
test-live-api.ts (`test:live`), test-cli.ts (`test:cli`),
test-mcpb-bundle.ts (`test:mcpb`).

## CLI
- **cli.mjs** — the `glob-mcp` headless MCP client. `npm run cli`. Typechecked via
  `tsconfig.cli.json` (`test:cli-typecheck`).

## Legacy data-prep (provenance only — not wired into any npm script)
- generate_resource_json.py, regenerate-weights-measures.js, regenerate-lookup.js,
  validate-weights-measures.js, export-weights-measures-tsv.js, parse-commodities.js,
  compact_thesaurus_ids.py — one-shot scripts used to produce the committed source
  data; kept for provenance. The `weights-measures-*.tsv` files are their outputs.
