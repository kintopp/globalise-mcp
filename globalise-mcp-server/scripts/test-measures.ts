/**
 * Unit tests for the weights & measures lookup tool:
 *   1. FTS lookup resolves a unit, with definitions + conversions
 *   2. variant resolution finds a unit via its spelling-variant column
 *   3. bm25 ranking surfaces the exact-label unit for a distinctive term
 *   4. empty query pages all units alphabetically; total = measuresTotal
 *   5. FTS hostile input never surfaces a raw SQLite error (note or ToolError)
 *   6. conversions shape: every conversion carries a non-empty ratio
 *   7. a no-match query returns total 0, no results, hasMore false
 *   8. sparse-definition reality: a unit with no definition returns []
 *
 * Plain Node script (no framework). Imports the tool directly from src via
 * tsx — no build needed, but the local reference SQLite database must exist.
 *
 * Run with: npm run test:measures
 */

import {
  lookupMeasure,
  lookupMeasureInputSchema,
  LookupMeasureOutput,
} from '../src/tools/measures.js';
import { isReferenceDatabaseAvailable, closeDatabase, getReferenceDatabasePath } from '../src/utils/database.js';
import { ToolError } from '../src/utils/errors.js';
import { check, finish } from './test-utils.js';

/** Parse args through the tool schema (applies defaults) and run the lookup. */
async function call(args: Record<string, unknown>): Promise<LookupMeasureOutput> {
  return lookupMeasure(lookupMeasureInputSchema.parse(args));
}

async function main() {
  if (!isReferenceDatabaseAvailable()) {
    console.error(`Reference DB missing at ${getReferenceDatabasePath()} — run npm run build:db:commodities first.`);
    process.exit(1);
  }

  console.log('1. FTS lookup returns a unit with definitions and conversions');
  const bahar = await call({ query: 'bahar', size: 5 });
  check(bahar.total.value >= 1, 'bahar matches at least one unit');
  const baharHit = bahar.results.find((r) => r.label.toLowerCase() === 'bahar');
  check(Boolean(baharHit), 'the Bahar unit is in the results');
  check((baharHit?.definitions.length ?? 0) >= 1, `Bahar carries at least one definition (${baharHit?.definitions.length})`);
  check((baharHit?.conversions.length ?? 0) > 0, `Bahar carries conversion ratios (${baharHit?.conversions.length})`);
  check(typeof baharHit?.type === 'string' && baharHit.type.length > 0, `Bahar surfaces its type (${baharHit?.type})`);

  console.log('2. variant resolution finds a unit via its variants column');
  const aaz = await call({ query: 'aaz', size: 5 });
  const aasHit = aaz.results.find((r) => r.label === 'Aas');
  check(Boolean(aasHit), 'querying the variant "aaz" (stored "aaz.") finds the Aas unit');
  check((aasHit?.variants.length ?? 0) > 0, `Aas carries spelling variants (${JSON.stringify(aasHit?.variants)})`);

  console.log('3. bm25 ranking surfaces the exact-label unit for a distinctive term');
  const mutsje = await call({ query: 'mutsje', size: 3 });
  check((mutsje.results[0]?.label ?? '').toLowerCase() === 'mutsje', 'distinctive term ranks its own unit first');

  console.log('4. empty query pages all units alphabetically');
  const all = await call({ size: 5 });
  check(all.total.value === all.databaseInfo.measuresTotal, 'no-query total equals the full unit count');
  check(all.databaseInfo.measuresTotal === 213, `unit count is 213 (got ${all.databaseInfo.measuresTotal})`);
  const labels = all.results.map((r) => r.label.toLowerCase());
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  check(JSON.stringify(labels) === JSON.stringify(sorted), 'first page is in alphabetical label order');
  check(all.pagination.hasMore === true, 'hasMore true when the list exceeds one page');

  console.log('5. FTS hostile input is handled, never a raw SQLite error');
  try {
    const unclosed = await call({ query: '"unclosed', size: 1 });
    check(typeof unclosed.total.value === 'number', 'unbalanced quote rescued (whole-phrase wrap), possibly with a note');
  } catch (e) {
    check(e instanceof ToolError && typeof e.suggestion === 'string', 'unbalanced quote → structured error with suggestion');
  }

  console.log('6. conversions shape: every ratio is a non-empty string');
  const everyRatioOk = (baharHit?.conversions ?? []).every((c) => typeof c.ratio === 'string' && c.ratio.length > 0);
  check(everyRatioOk, 'every conversion on the Bahar unit has a non-empty ratio string');

  console.log('7. no-match query');
  const empty = await call({ query: 'xyzzyqwerty', size: 1 });
  check(empty.total.value === 0 && empty.results.length === 0 && empty.pagination.hasMore === false, 'no-match returns total 0, no results, hasMore false');

  console.log('8. sparse-definition reality: a unit with no definition returns []');
  const compagnies = await call({ query: 'Compagnies', size: 10 });
  const noDef = compagnies.results.find((r) => r.label === 'Compagnies Kan');
  check(Boolean(noDef), 'the Compagnies Kan unit is found');
  check(Array.isArray(noDef?.definitions) && noDef?.definitions.length === 0, 'a unit without a definition returns definitions: [] cleanly');

  closeDatabase();

  finish('Measures lookup');
}

main().catch((error) => {
  console.error('Measures tests crashed:', error);
  process.exit(1);
});
