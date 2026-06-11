/**
 * Unit tests for the archival-index tool (R16):
 *   1. filter-combination matrix — incompatible combos throw structured
 *      errors instead of silently returning total: 0 (R7)
 *   2. one-sided filters on source "all" skip the other source with a note
 *   3. FTS5 hostile inputs (hyphens, unbalanced quotes) never surface raw
 *      SQLite syntax errors
 *   4. combined OBP→GM pagination across the source boundary
 *   5. unfiltered aggregations are cached per connection and stable (R14)
 *   6. RGP published-edition links — Retroboeken offset, GitHub per-page/full-volume
 *      URLs, multi-page and volume-only rows, null for unpublished missives
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
import { ToolError } from '../src/utils/errors.js';
import { check, finish } from './test-utils.js';

type GmResult = Extract<FindArchivalDocumentsOutput['results'][number], { type: 'gm' }>;
const isGm = (r: FindArchivalDocumentsOutput['results'][number]): r is GmResult => r.type === 'gm';

/** Parse args through the tool schema (applies defaults) and run the query. */
async function call(args: Record<string, unknown>): Promise<FindArchivalDocumentsOutput> {
  return findArchivalDocuments(findArchivalDocumentsInputSchema.parse(args));
}

/** GM rows for a given inventory number (source "gm" so the filter stays GM-only). */
async function gmRowsFor(inventoryNumber: string): Promise<GmResult[]> {
  const res = await call({ source: 'gm', inventoryNumber, size: 50, includeAggregations: false });
  return res.results.filter(isGm);
}

async function expectStructuredError(args: Record<string, unknown>, label: string): Promise<void> {
  try {
    await call(args);
    check(false, `${label} (no error thrown)`);
  } catch (e) {
    check(e instanceof ToolError && typeof e.suggestion === 'string', label);
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
  const gmOnly = await call({ source: 'all', chamber: 'Amsterdam', size: 5, includeAggregations: false });
  check(gmOnly.results.length > 0 && gmOnly.results.every((r) => r.type === 'gm'), 'chamber on "all" → GM results only');
  check(Boolean(gmOnly.note?.includes('OBP')), 'chamber on "all" → note names the skipped OBP source');
  const obpOnly = await call({ source: 'all', settlement: 'Batavia', size: 5, includeAggregations: false });
  check(obpOnly.results.length > 0 && obpOnly.results.every((r) => r.type === 'obp'), 'settlement on "all" → OBP results only');
  check(Boolean(obpOnly.note?.includes('GM')), 'settlement on "all" → note names the skipped GM source');

  console.log('2b. folio is an OBP-only filter requiring an inventoryNumber (finding 2)');
  // A folio range without an inventoryNumber is rejected, not silently dropped
  // (the old bug: every matching doc returned as if folio-filtered).
  await expectStructuredError({ folioFrom: 100, folioTo: 200 }, 'folio range without inventoryNumber rejected');
  await expectStructuredError({ source: 'obp', folioTo: 50 }, 'lone folioTo without inventoryNumber rejected');
  // folio is OBP-only, so it cannot combine with GM-only filters or source "gm".
  await expectStructuredError(
    { inventoryNumber: '1543', folioFrom: 1, chamber: 'Amsterdam' },
    'folio + chamber rejected as incompatible',
  );
  await expectStructuredError(
    { source: 'gm', inventoryNumber: '1543', folioFrom: 1 },
    'folio on source "gm" rejected (OBP-only)',
  );
  // On source "all", a folio range routes like settlement: GM is skipped with a
  // note, so no unfiltered GM rows are mixed into a folio-filtered response.
  const folioInv = (
    await call({ source: 'obp', settlement: 'Batavia', size: 1, includeAggregations: false })
  ).results[0]?.inventoryNumber;
  check(typeof folioInv === 'string', 'found an OBP inventory to fold a folio range onto');
  const folioAll = await call({
    source: 'all',
    inventoryNumber: folioInv!,
    folioFrom: 1,
    folioTo: 1_000_000,
    size: 5,
    includeAggregations: false,
  });
  check(folioAll.results.every((r) => r.type === 'obp'), 'folio on "all" → OBP results only (GM skipped)');
  check(
    Boolean(folioAll.note?.includes('folio') && folioAll.note?.includes('GM')),
    'folio on "all" → note names folio and the skipped GM source',
  );

  console.log('3. FTS5 hostile inputs (R7)');
  // A lone hyphenated term is per-term quoted (not whole-phrase wrapped), and
  // the term still matches the index.
  const hyphen = await call({ query: 'oost-indie', size: 3, includeAggregations: false });
  check(Boolean(hyphen.note?.includes('quoted')), 'hyphenated term is per-term quoted, with a note');
  check(hyphen.total.value > 0, 'per-term quoted hyphenated term still matches the index');
  // Operators survive a hyphenated operand: `peper OR oost-indie` must NOT
  // collapse to the phrase "peper or oost indie" (which matched nothing) — the
  // OR is preserved, so it returns at least as many hits as "peper" alone.
  const peper = await call({ query: 'peper', size: 1, includeAggregations: false });
  const peperOrOost = await call({ query: 'peper OR oost-indie', size: 1, includeAggregations: false });
  check(Boolean(peperOrOost.note?.includes('operators preserved')), 'OR + hyphenated operand → note says operators preserved');
  check(peperOrOost.total.value >= peper.total.value && peper.total.value > 0, 'OR is preserved (>= the "peper"-only count), not dropped');
  // Explicit-operator grouping is reconstructed faithfully (quote the operand,
  // keep the parens and the OR) rather than collapsed to a phrase.
  const grouped = await call({ query: 'compagnie AND (oost-indie OR ceylon)', size: 1, includeAggregations: false });
  check(Boolean(grouped.note?.includes('operators preserved')), 'explicit-operator grouped query is rebuilt per-term, not collapsed to an exact phrase');
  // The implicit-AND-before-group form (`compagnie (…)`) is rejected by FTS5
  // itself even when correctly quoted, so it safely falls back — no raw crash.
  const implicitGroup = await call({ query: 'compagnie (oost-indie OR ceylon)', size: 1, includeAggregations: false });
  check(typeof implicitGroup.total.value === 'number', 'implicit-AND-before-group falls back safely (no raw FTS5 error)');
  // Genuinely unparseable input (unbalanced quote) still falls back safely:
  // whole-phrase wrap with a note, or a structured error — never a raw crash.
  try {
    const unclosed = await call({ query: '"unclosed', size: 3, includeAggregations: false });
    check(typeof unclosed.total.value === 'number', 'unbalanced quote rescued by whole-phrase wrap');
  } catch (e) {
    check(e instanceof ToolError && typeof e.suggestion === 'string', 'unbalanced quote → structured error with suggestion');
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

  console.log('6. RGP published-edition links');
  const RETRO = 'https://resources.huygens.knaw.nl/retroboeken/generalemissiven/';
  const GH = 'https://raw.githubusercontent.com/globalise-huygens/globalise-generale-missiven-rgp/main';

  // inv 1208 → vol 3, page 1: all three links; vol-3 offset 13 → website page 14; imagePane
  const v3p1 = (await gmRowsFor('1208')).find((r) => r.rgpVolume === '3' && r.rgpPage === '1');
  check(Boolean(v3p1?.publishedEdition), 'inv 1208 (vol 3, p1) has publishedEdition');
  check(
    v3p1?.publishedEdition?.retroboekenUrl === `${RETRO}#source=3&page=14&view=imagePane`,
    'retroboekenUrl applies the vol-3 offset (1+13=14) and lands on imagePane',
  );
  check(
    v3p1?.publishedEdition?.githubPageUrl === `${GH}/txt/GM3/3_1.txt`,
    'githubPageUrl keys directly off rgp_page (no offset)',
  );
  check(
    v3p1?.publishedEdition?.githubVolumeUrl === `${GH}/full_volumes/GM_3.txt`,
    'githubVolumeUrl points at the full volume (underscore form)',
  );

  // multi-page rgp_page "172;173" (inv 1085, vol 1) → first page 172; vol-1 offset 23 → page 195
  const multi = (await gmRowsFor('1085')).find((r) => r.rgpPage === '172;173');
  check(
    multi?.publishedEdition?.githubPageUrl === `${GH}/txt/GM1/1_172.txt`,
    'multi-page rgp_page takes the first page for the per-page link',
  );
  check(
    multi?.publishedEdition?.retroboekenUrl === `${RETRO}#source=1&page=195&view=imagePane`,
    'multi-page rgp_page takes the first page for the Retroboeken offset (172+23=195)',
  );

  // inv 3066 → vol 14, page null: full-volume link present, page-precise links null
  const volOnly = (await gmRowsFor('3066')).find((r) => r.rgpVolume === '14' && r.rgpPage === null);
  check(Boolean(volOnly?.publishedEdition), 'volume-only row (inv 3066) still has publishedEdition');
  check(
    volOnly?.publishedEdition?.githubVolumeUrl === `${GH}/full_volumes/GM_14.txt`,
    'volume-only row gets the full-volume link',
  );
  check(
    volOnly?.publishedEdition?.retroboekenUrl === null && volOnly?.publishedEdition?.githubPageUrl === null,
    'volume-only row has null page-precise links',
  );

  // a GM row not published in RGP → publishedEdition is null
  const allGm = await call({ source: 'gm', size: 500, includeAggregations: false });
  const unpublished = allGm.results.find((r): r is GmResult => r.type === 'gm' && r.rgpVolume === null);
  check(Boolean(unpublished), 'corpus has an unpublished GM row (rgpVolume null) to check');
  check(unpublished?.publishedEdition === null, 'unpublished GM row has publishedEdition === null');

  console.log('7. per-connection statement cache rebuilds after DB reopen (findings 6/15)');
  // A query primes the per-connection prepared-statement cache. After
  // closeDatabase() those statements belong to the old (closed) handle, so the
  // next call must rebuild state on the fresh handle rather than reuse stale
  // statements — the handle-keying invariant createConnectionState centralizes.
  const before = await call({ query: 'peper', size: 3, includeAggregations: true });
  closeDatabase();
  const after = await call({ query: 'peper', size: 3, includeAggregations: true });
  check(after.total.value === before.total.value && before.total.value > 0, 'same query returns the same total after closeDatabase + reopen');
  check(
    JSON.stringify(after.aggregations) === JSON.stringify(before.aggregations),
    'aggregations identical after reopen (state rebuilt on the fresh handle, not stale)',
  );

  closeDatabase();

  finish('Archival-index tests');
}

main().catch((error) => {
  console.error('Archival-index tests crashed:', error);
  process.exit(1);
});
