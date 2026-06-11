/**
 * Unit tests for the commodities glossary lookup tool:
 *   1. FTS lookup resolves a concept and returns its spelling variants
 *      (the query-expansion contract)
 *   2. bm25 ranking surfaces the exact-label concept for a distinctive term
 *   3. empty query pages the whole glossary alphabetically
 *   4. FTS hostile inputs (hyphen, unbalanced quote) never surface raw SQLite
 *      errors — phrase-escape with a note, or a structured error
 *   5. definitionSource + confidence are surfaced on every result
 *   6. pagination hasMore; a no-match query returns total 0
 *
 * Plain Node script (no framework). Imports the tool directly from src via
 * tsx — no build needed, but the local reference SQLite database must exist.
 *
 * Run with: npm run test:commodities
 */

import {
  lookupCommodity,
  lookupCommodityInputSchema,
  LookupCommodityOutput,
} from '../src/tools/commodities.js';
import { isReferenceDatabaseAvailable, closeDatabase, getReferenceDatabasePath } from '../src/utils/database.js';
import { ToolError } from '../src/utils/errors.js';
import { check, finish } from './test-utils.js';

/** Parse args through the tool schema (applies defaults) and run the lookup. */
async function call(args: Record<string, unknown>): Promise<LookupCommodityOutput> {
  return lookupCommodity(lookupCommodityInputSchema.parse(args));
}

async function main() {
  if (!isReferenceDatabaseAvailable()) {
    console.error(`Reference DB missing at ${getReferenceDatabasePath()} — run npm run build:db:commodities first.`);
    process.exit(1);
  }

  console.log('1. FTS lookup returns a concept with spelling variants (query expansion)');
  const ropia = await call({ query: 'Ropia', size: 5 });
  check(ropia.total.value > 0, 'Ropia matches at least one concept');
  const ropiaHit = ropia.results.find((r) => (r.prefLabelNl ?? '').toLowerCase() === 'ropia');
  check(Boolean(ropiaHit), 'the Ropia concept is in the results');
  check((ropiaHit?.altLabels.length ?? 0) > 0, `Ropia carries spelling variants (${JSON.stringify(ropiaHit?.altLabels)})`);
  check(ropiaHit?.definitionSource === 'PoolParty', `PoolParty source is capitalized, not "poolparty" (got: ${ropiaHit?.definitionSource})`);

  console.log('2. bm25 ranking surfaces the exact-label concept for a distinctive term');
  const gouwerons = await call({ query: 'gouwerons', size: 3 });
  check(
    (gouwerons.results[0]?.prefLabelNl ?? '').toLowerCase() === 'gouwerons',
    'distinctive term ranks its own concept first',
  );

  console.log('3. empty query pages the whole glossary alphabetically');
  const all = await call({ size: 5 });
  check(all.total.value === all.databaseInfo.commoditiesTotal, 'no-query total equals the full glossary size');
  const labels = all.results.map((r) => (r.prefLabelEn ?? r.prefLabelNl ?? '').toLowerCase());
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  check(JSON.stringify(labels) === JSON.stringify(sorted), 'first page is in alphabetical label order');
  check(all.pagination.hasMore === true, 'hasMore true when the glossary exceeds one page');

  console.log('4. FTS hostile inputs');
  const hyphen = await call({ query: 'oost-indie', size: 1 });
  check(Boolean(hyphen.note?.includes('exact phrase')), 'hyphenated query phrase-escaped with a note');
  try {
    const unclosed = await call({ query: '"unclosed', size: 1 });
    check(typeof unclosed.total.value === 'number', 'unbalanced quote rescued by phrase-escape');
  } catch (e) {
    check(e instanceof ToolError && typeof e.suggestion === 'string', 'unbalanced quote → structured error with suggestion');
  }

  console.log('5. provenance + confidence surfaced');
  const anker = await call({ query: 'anker', size: 1 });
  const ankerHit = anker.results[0];
  check(typeof ankerHit?.definitionSource === 'string' && ankerHit.definitionSource.length > 0, 'definitionSource surfaced');
  check(typeof ankerHit?.confidence === 'string' && ankerHit.confidence.length > 0, 'confidence surfaced');

  console.log('6. no-match query');
  const empty = await call({ query: 'xyzzyqwerty', size: 1 });
  check(empty.total.value === 0 && empty.results.length === 0 && empty.pagination.hasMore === false, 'no-match returns total 0, no results, hasMore false');

  closeDatabase();

  finish('Commodities tests');
}

main().catch((error) => {
  console.error('Commodities tests crashed:', error);
  process.exit(1);
});
