/**
 * Unit tests for the archival-index tool (R16):
 *   1. filter-combination matrix — incompatible combos throw structured
 *      errors instead of silently returning total: 0 (R7)
 *   2. one-sided filters on source "all" skip the other source with a note
 *   3. FTS5 hostile inputs (hyphens, unbalanced quotes) never surface raw
 *      SQLite syntax errors
 *   4. combined OBP→GM pagination across the source boundary
 *   5. unfiltered aggregations are cached per connection and stable (R14)
 *
 * Plain Node script (no framework). Imports the tool directly from src via
 * tsx — no build needed, but the local SQLite database must exist.
 *
 * Run with: npm run test:archival
 */

import {
  findArchivalDocuments,
  findArchivalDocumentsInputSchema,
  FindArchivalDocumentsOutput,
} from '../src/tools/archival-index.js';
import { isDatabaseAvailable, closeDatabase, getDatabasePath } from '../src/utils/database.js';

let failures = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/** Parse args through the tool schema (applies defaults) and run the query. */
async function call(args: Record<string, unknown>): Promise<FindArchivalDocumentsOutput> {
  return findArchivalDocuments(findArchivalDocumentsInputSchema.parse(args));
}

async function expectStructuredError(args: Record<string, unknown>, label: string): Promise<void> {
  try {
    await call(args);
    check(false, `${label} (no error thrown)`);
  } catch (e) {
    const err = e as { error?: string; suggestion?: string };
    check(typeof err.error === 'string' && typeof err.suggestion === 'string', label);
  }
}

async function main() {
  if (!isDatabaseAvailable()) {
    console.error(`Archival DB missing at ${getDatabasePath()} — run npm run build:db first.`);
    process.exit(1);
  }

  console.log('1. incompatible filter combinations (R7)');
  await expectStructuredError(
    { source: 'all', settlement: 'Batavia', chamber: 'Amsterdam' },
    'settlement+chamber rejected with structured error',
  );
  await expectStructuredError({ source: 'obp', chamber: 'Amsterdam' }, 'obp+chamber rejected');
  await expectStructuredError({ source: 'obp', htrAvailable: true }, 'obp+htrAvailable rejected');
  await expectStructuredError({ source: 'gm', settlement: 'Batavia' }, 'gm+settlement rejected');

  console.log('2. one-sided filters on source "all" skip the other source with a note');
  const gmOnly = await call({ source: 'all', chamber: 'Amsterdam', size: 5 });
  check(gmOnly.results.length > 0 && gmOnly.results.every((r) => r.type === 'gm'), 'chamber on "all" → GM results only');
  check(Boolean(gmOnly.note?.includes('OBP')), 'chamber on "all" → note names the skipped OBP source');
  const obpOnly = await call({ source: 'all', settlement: 'Batavia', size: 5 });
  check(obpOnly.results.length > 0 && obpOnly.results.every((r) => r.type === 'obp'), 'settlement on "all" → OBP results only');
  check(Boolean(obpOnly.note?.includes('GM')), 'settlement on "all" → note names the skipped GM source');

  console.log('3. FTS5 hostile inputs (R7)');
  const hyphen = await call({ query: 'oost-indie', size: 3, includeAggregations: false });
  check(Boolean(hyphen.note?.includes('exact phrase')), 'hyphenated query is phrase-escaped, with a note');
  try {
    const unclosed = await call({ query: '"unclosed', size: 3, includeAggregations: false });
    check(typeof unclosed.total.value === 'number', 'unbalanced quote rescued by phrase-escape');
  } catch (e) {
    const err = e as { suggestion?: string };
    check(typeof err.suggestion === 'string', 'unbalanced quote → structured error with suggestion');
  }

  console.log('4. combined OBP→GM pagination boundary');
  const info = await call({ size: 1, includeAggregations: false });
  const { obpTotal, gmTotal } = info.databaseInfo;
  check(obpTotal > 0 && gmTotal > 0, `both tables populated (obp: ${obpTotal}, gm: ${gmTotal})`);
  check(info.total.value === obpTotal + gmTotal, 'unfiltered total = obp + gm');
  const straddle = await call({ from: obpTotal - 2, size: 4, includeAggregations: false });
  check(straddle.results.length === 4, 'page straddling the boundary returns a full page');
  check(
    straddle.results[0]?.type === 'obp' && straddle.results[1]?.type === 'obp',
    'first half of the straddling page is OBP',
  );
  check(
    straddle.results[2]?.type === 'gm' && straddle.results[3]?.type === 'gm',
    'second half of the straddling page is GM',
  );
  const afterBoundary = await call({ from: obpTotal, size: 3, includeAggregations: false });
  check(
    afterBoundary.results.length === 3 && afterBoundary.results.every((r) => r.type === 'gm'),
    'page starting exactly at the boundary is all GM',
  );

  console.log('5. unfiltered aggregations cached and stable (R14)');
  const agg1 = await call({ size: 1 });
  const agg2 = await call({ size: 1 });
  check(Boolean(agg1.aggregations?.settlements?.length), 'settlements aggregation present');
  check(Boolean(agg1.aggregations?.chambers?.length), 'chambers aggregation present');
  check(
    JSON.stringify(agg1.aggregations) === JSON.stringify(agg2.aggregations),
    'repeated unfiltered call returns identical aggregations',
  );

  closeDatabase();

  if (failures > 0) {
    console.error(`\nArchival-index tests FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nArchival-index tests passed.');
}

main().catch((error) => {
  console.error('Archival-index tests crashed:', error);
  process.exit(1);
});
