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
 *   9. homonyms: a label like "roede" returns multiple rows distinguished by type
 *  10. conversions: every ratio carries a non-empty context; a unit spans many
 *      contexts (commodity/place-varying); ratios are retrieved from BOTH sides
 *      of the relationship (the `from_unit OR to_unit` arm)
 *  11. editorial: self-referential "1 X = 1 X" rows are kept, not filtered
 *  12. contract: every result validates against lookupMeasureOutputSchema, and
 *      definitions carry only nl/en keys (an English-bearing def exists)
 *
 * Plain Node script (no framework). Imports the tool directly from src via
 * tsx — no build needed, but the local reference SQLite database must exist.
 *
 * Run with: npm run test:measures
 */

import {
  lookupMeasure,
  lookupMeasureInputSchema,
  lookupMeasureOutputSchema,
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

  console.log('9. homonyms: one label resolves to several units distinguished by type');
  const roede = await call({ query: 'roede', size: 10 });
  const roedeExact = roede.results.filter((r) => r.label === 'Roede');
  check(roedeExact.length >= 2, `the label "Roede" returns ≥2 units (got ${roedeExact.length})`);
  const roedeTypes = new Set(roedeExact.map((r) => r.type));
  check(roedeTypes.size >= 2, `those Roede units carry distinct types (${JSON.stringify([...roedeTypes])})`);

  console.log('10. conversions: context is populated, varies, and is retrieved from both sides');
  const allConversions = bahar.results.flatMap((r) => r.conversions);
  check(
    allConversions.length > 0 && allConversions.every((c) => typeof c.context === 'string' && c.context.length > 0),
    `every conversion in the bahar result set carries a non-empty context (${allConversions.length} ratios)`,
  );
  const baharContexts = new Set((baharHit?.conversions ?? []).map((c) => c.context));
  check(baharContexts.size >= 2, `Bahar's ratios span multiple contexts — commodity/place-varying (${baharContexts.size} distinct)`);
  // Frasila appears as the RHS of "1 Bahar = 15 Frasila" and the LHS of
  // "1 Frasila = 27 Pond" — retrieving both proves the `from_unit OR to_unit` arm.
  const frasila = await call({ query: 'frasila', size: 5 });
  const frasilaHit = frasila.results.find((r) => r.label === 'Frasila');
  const lhs = (ratio: string) => ratio.split('=')[0] ?? '';
  const rhs = (ratio: string) => ratio.split('=')[1] ?? '';
  check(
    (frasilaHit?.conversions ?? []).some((c) => rhs(c.ratio).includes('Frasila')),
    'a conversion is retrieved where Frasila is the right-hand unit (the to_unit arm)',
  );
  check(
    (frasilaHit?.conversions ?? []).some((c) => lhs(c.ratio).includes('Frasila')),
    'a conversion is retrieved where Frasila is the left-hand unit (the from_unit arm)',
  );

  console.log('11. editorial: self-referential "1 X = 1 X" rows are kept, not filtered');
  const mutsjeSelf = mutsje.results.find((r) => r.label === 'Mutsje');
  const selfRef = (mutsjeSelf?.conversions ?? []).find((c) => {
    const [a, b] = c.ratio.split('=');
    return a && b && a.includes('Mutsje') && b.includes('Mutsje');
  });
  check(Boolean(selfRef), `Mutsje retains a self-referential ratio (${selfRef?.ratio ?? 'none found'})`);

  console.log('12. contract: results validate against the output schema; definitions are nl/en only');
  for (const [name, out] of [['bahar', bahar], ['all', all], ['empty', empty]] as const) {
    check(lookupMeasureOutputSchema.safeParse(out).success, `${name} result conforms to lookupMeasureOutputSchema`);
  }
  const allDefs = [...bahar.results, ...all.results].flatMap((r) => r.definitions);
  check(
    allDefs.every((d) => Object.keys(d).every((k) => k === 'nl' || k === 'en')),
    'every definition object carries only nl/en keys (parseDefinitions strips the rest)',
  );
  check(allDefs.some((d) => typeof d.en === 'string' && d.en.length > 0), 'an English-bearing definition is present in the result set');

  closeDatabase();

  finish('Measures lookup');
}

main().catch((error) => {
  console.error('Measures tests crashed:', error);
  process.exit(1);
});
