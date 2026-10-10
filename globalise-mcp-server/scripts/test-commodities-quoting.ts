/**
 * Regression test for the RFC-4180 decode of commodities.tsv (issue #418).
 *
 * Part A runs the build's own parser over the committed TSV, so reverting it to
 * quote:false fails here even though CI never rebuilds reference.sqlite (it
 * only decompresses the committed .gz). Part B checks the shipped DB holds
 * exactly what the parser produces, which catches a parser change whose .gz
 * was never regenerated.
 *
 * Run with: npm run test:commodities-quoting
 */
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getReferenceDatabasePath, isReferenceDatabaseAvailable } from '../src/utils/database.js';
import { parseCommoditiesTsv, type CommodityRow } from './commodities-tsv.js';
import { check, finish } from './test-utils.js';

const TSV = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sources', 'commodities.tsv');
const rows = await parseCommoditiesTsv(TSV);

const wrapped = (v: string | null): boolean => !!v && (v.startsWith('"') || v.endsWith('"'));
const doubled = (v: string | null): boolean => !!v && v.includes('""');
const byNl = (nl: string): CommodityRow | undefined => rows.find((r) => r.pref_nl === nl);

console.log('A1. parser yields the full glossary');
check(rows.length === 3508, `parsed 3508 commodity rows (got ${rows.length})`);

console.log('A2. no structural wrapping quotes remain');
check(rows.filter((r) => r.definition.startsWith('"')).length === 0, 'no definition starts with a stray quote');
check(rows.filter((r) => wrapped(r.pref_nl)).length === 0, 'no pref_nl is wrapped in quotes');
check(rows.filter((r) => wrapped(r.pref_en)).length === 0, 'no pref_en is wrapped in quotes');
check(rows.filter((r) => wrapped(r.definition_source_desc)).length === 0, 'no definition_source_desc is wrapped in quotes');

console.log('A3. no doubled quotes in labels / source-note (un-doubling complete)');
check(rows.filter((r) => [r.pref_nl, r.pref_en, r.alt_labels, r.definition_source_desc].some(doubled)).length === 0,
  'labels and definition_source_desc contain no doubled quotes');

console.log('A4. cited examples decoded correctly (issue #418)');
check(byNl('Zwavelaarde')?.definition === 'Zwavel bevattende aarde, niet geraffineerd',
  'Zwavelaarde definition is unwrapped exactly');
const ruinas = byNl('ruinaszaad');
check(!!ruinas && ruinas.definition.includes('"ruinas"') && !ruinas.definition.includes('""ruinas""'),
  'ruinaszaad keeps inner "ruinas" and is un-doubled');
check(!!ruinas?.definition_source_desc?.includes('"ruinas"') && !ruinas.definition_source_desc.includes('""ruinas""'),
  'ruinaszaad source-note keeps inner "ruinas", un-doubled and unwrapped');
const kroon = byNl('kroonrassen');
check(!!kroon && kroon.definition.includes('"crown"') && !kroon.definition.startsWith('"'),
  'kroonrassen keeps inner "crown", no wrapping quote');

console.log('A5. genuine inner quotes are PRESERVED (no over-stripping)');
// AAT-style cross-references genuinely end in a quoted term, e.g. use "colanders."
check(rows.filter((r) => r.definition.endsWith('"')).length >= 20,
  'definitions ending in a legitimate quoted term are preserved');

console.log('B. the shipped reference.sqlite matches the parser');
if (!isReferenceDatabaseAvailable()) {
  check(false, 'reference DB present (run npm run build first)');
} else {
  const db = new DatabaseSync(getReferenceDatabasePath(), { readOnly: true });
  const shipped = db.prepare('SELECT uuid, definition, pref_nl, pref_en, alt_labels, definition_source_desc FROM commodities')
    .all() as Array<Pick<CommodityRow, 'uuid' | 'definition' | 'pref_nl' | 'pref_en' | 'alt_labels' | 'definition_source_desc'>>;
  db.close();
  check(shipped.length === rows.length, `shipped row count (${shipped.length}) equals parsed (${rows.length})`);
  const parsed = new Map(rows.map((r) => [r.uuid, r]));
  const fields = ['definition', 'pref_nl', 'pref_en', 'alt_labels', 'definition_source_desc'] as const;
  const stale = shipped.filter((s) => {
    const p = parsed.get(s.uuid);
    return !p || fields.some((f) => p[f] !== s[f]);
  });
  check(stale.length === 0, stale.length === 0
    ? 'every shipped row equals its parsed row'
    : `${stale.length} shipped rows differ from the parser, e.g. ${stale[0].uuid}; rebuild with npm run build:db:commodities`);
}

finish('Commodities quoting tests');
