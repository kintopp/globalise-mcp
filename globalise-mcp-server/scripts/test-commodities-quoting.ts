/**
 * Regression test for the RFC-4180 decode of commodities.tsv (issue #418).
 * Asserts the rebuilt reference.sqlite carries NO structural quote artifacts in
 * commodity text, while preserving genuine inner quotes. If anyone reverts the
 * parser to quote:false, the "starts with a quote" / "doubled quotes" checks fail.
 *
 * Run with: npm run test:commodities-quoting
 */
import { DatabaseSync } from 'node:sqlite';
import { getReferenceDatabasePath, isReferenceDatabaseAvailable } from '../src/utils/database.js';
import { check, finish } from './test-utils.js';

if (!isReferenceDatabaseAvailable()) {
  console.error('Reference DB missing — run npm run build:db:commodities first.');
  process.exit(1);
}
const db = new DatabaseSync(getReferenceDatabasePath());
const count = (sql: string): number => (db.prepare(sql).get() as { c: number }).c;

console.log('1. row count unchanged');
check(count('SELECT COUNT(*) AS c FROM commodities') === 3508, 'commodities row count is 3508');

console.log('2. no structural wrapping quotes remain');
// No field STARTS with a stray quote (the wrapping artifact). Was ~2,937 before the fix.
check(count(`SELECT COUNT(*) AS c FROM commodities WHERE definition LIKE '"%'`) === 0,
  'no definition starts with a stray quote');
check(count(`SELECT COUNT(*) AS c FROM commodities WHERE pref_nl LIKE '"%' OR pref_nl LIKE '%"'`) === 0,
  'no pref_nl is wrapped in quotes');
check(count(`SELECT COUNT(*) AS c FROM commodities WHERE pref_en LIKE '"%' OR pref_en LIKE '%"'`) === 0,
  'no pref_en is wrapped in quotes');
check(count(`SELECT COUNT(*) AS c FROM commodities WHERE definition_source_desc LIKE '"%' OR definition_source_desc LIKE '%"'`) === 0,
  'no definition_source_desc is wrapped in quotes');

console.log('3. no doubled quotes in labels / source-note (un-doubling complete)');
check(count(`SELECT COUNT(*) AS c FROM commodities WHERE pref_nl LIKE '%""%' OR pref_en LIKE '%""%'
             OR alt_labels LIKE '%""%' OR definition_source_desc LIKE '%""%'`) === 0,
  'labels and definition_source_desc contain no doubled quotes');

console.log('4. cited examples decoded correctly (issue #418)');
const col = (name: string, nl: string): string =>
  (db.prepare(`SELECT ${name} AS d FROM commodities WHERE pref_nl = ?`).get(nl) as { d: string } | undefined)?.d ?? '';
const def = (nl: string): string => col('definition', nl);
check(def('Zwavelaarde') === 'Zwavel bevattende aarde, niet geraffineerd',
  'Zwavelaarde definition is unwrapped exactly');
check(def('ruinaszaad').includes('"ruinas"') && !def('ruinaszaad').includes('""ruinas""'),
  'ruinaszaad keeps inner "ruinas" and is un-doubled');
check(def('kroonrassen').includes('"crown"') && !def('kroonrassen').startsWith('"'),
  'kroonrassen keeps inner "crown", no wrapping quote');
// The same row's source-note was also RFC-quoted ("" → ", wrapping removed) — pin it too.
check(col('definition_source_desc', 'ruinaszaad').includes('"ruinas"')
      && !col('definition_source_desc', 'ruinaszaad').includes('""ruinas""'),
  'ruinaszaad source-note keeps inner "ruinas", un-doubled and unwrapped');

console.log('5. genuine inner quotes are PRESERVED (we did not over-strip)');
// AAT-style cross-references genuinely end in a quoted term, e.g. use "colanders."
check(count(`SELECT COUNT(*) AS c FROM commodities WHERE definition LIKE '%"'`) >= 20,
  'definitions ending in a legitimate quoted term are preserved');

db.close();
finish('Commodities quoting tests');
