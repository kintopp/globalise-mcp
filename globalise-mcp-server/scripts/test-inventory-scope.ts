/**
 * Unit tests for inventory-scope (the inventoryRange / year → invNr expansion
 * behind search_transcriptions): range parsing, clamping and validation, list
 * normalisation, union of explicit numbers with ranges, intersection with a
 * year-resolved set, and the empty-scope signal (an empty array, never an
 * empty upstream terms list).
 *
 * Run with: npm run test:inventory-scope
 */

import {
  parseInventoryRange,
  expandInventoryRanges,
  normalizeInventoryList,
  resolveInventoryScope,
  CORPUS_INVENTORY_MIN,
  CORPUS_INVENTORY_MAX,
} from '../src/utils/inventory-scope.js';
import { check, finish, throwsToolError } from './test-utils.js';

const range = (spec: string) => { const r = parseInventoryRange(spec); return [r.from, r.to]; };
const eq = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

console.log('1. parseInventoryRange');
check(eq(range('1053-4454'), [1053, 4454]), 'plain A-B');
check(eq(range(' 9966 - 9970 '), [9966, 9970]), 'whitespace tolerated');
check(eq(range('9966-9966'), [9966, 9966]), 'single-number span');
check(eq(range('1-20000'), [CORPUS_INVENTORY_MIN, CORPUS_INVENTORY_MAX]), 'over-wide span is clamped to the corpus');
throwsToolError(() => parseInventoryRange('4454-1053'), 'reversed bounds rejected');
throwsToolError(() => parseInventoryRange('9014A-9015'), 'lettered inventory rejected');
throwsToolError(() => parseInventoryRange('1053'), 'missing hyphen rejected');
throwsToolError(() => parseInventoryRange('1-1000'), 'range entirely below the corpus rejected');
throwsToolError(() => parseInventoryRange('20000-30000'), 'range entirely above the corpus rejected');

console.log('2. expandInventoryRanges');
check(expandInventoryRanges(['1053-1055']).join(',') === '1053,1054,1055', 'expands inclusively');
check(expandInventoryRanges(['1053-1055', '1054-1056']).join(',') === '1053,1054,1055,1056', 'overlapping ranges dedupe');
check(expandInventoryRanges(['1053-11024']).length === 9972, 'whole corpus span expands to 9972 numbers');

console.log('3. normalizeInventoryList');
check(normalizeInventoryList(undefined) === undefined, 'undefined passes through');
check(normalizeInventoryList('') === undefined && normalizeInventoryList([' ', '']) === undefined, 'blank input → undefined');
check(eq(normalizeInventoryList(' 9966 ')!, ['9966']), 'single string trimmed into an array');
check(eq(normalizeInventoryList(['9966', ' ', '4293 '])!, ['9966', '4293']), 'array trimmed, blanks dropped');

console.log('4. resolveInventoryScope');
check(resolveInventoryScope() === undefined, 'no inputs → no filter');
check(eq(resolveInventoryScope(['9966'], ['1053', '9966'])!, ['9966', '1053']), 'explicit ∪ ranges, deduped');
check(eq(resolveInventoryScope(undefined, undefined, ['1500', '1501'])!, ['1500', '1501']), 'years alone stand as the filter');
check(resolveInventoryScope(undefined, undefined, [])!.length === 0, 'years resolving to nothing → empty scope (not undefined)');
check(eq(resolveInventoryScope(undefined, ['1500', '1501', '1502'], ['1501', '1502', '1503'])!, ['1501', '1502']), 'ranges ∩ years');
check(resolveInventoryScope(['9966'], undefined, ['1501'])!.length === 0, 'disjoint explicit ∩ years → empty scope');

finish('Inventory-scope tests');
