/**
 * Unit tests for the FTS5 query escaper (src/utils/fts.ts).
 *
 * escapeFtsTerms is pure (string -> string), so these run without a database:
 * they pin down exactly how raw user input is rewritten into a valid FTS5 MATCH
 * expression. The end-to-end behaviour of sanitizeFtsQuery (raw -> per-term ->
 * whole-phrase fallback, against a live FTS index) is covered DB-side in
 * test-archival-index.ts section 3.
 *
 * Run with: npm run test:fts
 */

import { escapeFtsTerms } from '../src/utils/fts.js';
import { check, finish } from './test-utils.js';

/** Assert escapeFtsTerms(input) === expected. */
function eq(input: string, expected: string, label?: string): void {
  const got = escapeFtsTerms(input);
  check(got === expected, `${label ?? input}  ->  ${JSON.stringify(got)}${got === expected ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

console.log('1. single special-character terms get quoted');
eq('oost-indie', '"oost-indie"');
eq("'s-gravenhage", '"\'s-gravenhage"');
eq('suiker/koffie', '"suiker/koffie"');
eq("d'orville", '"d\'orville"');
eq('comp.', '"comp."');

console.log('2. boolean operators are preserved, not collapsed');
eq('peper OR oost-indie', 'peper OR "oost-indie"');
eq('kaneel AND oost-indie', 'kaneel AND "oost-indie"');
eq('oost-indie NOT ceylon', '"oost-indie" NOT ceylon');
eq('oost-indie OR west-indie', '"oost-indie" OR "west-indie"');
eq('NOT oost-indie', 'NOT "oost-indie"', 'leading NOT (rebuilt; FTS5 still rejects → caller whole-wraps)');

console.log('3. grouping parentheses stay structural');
// With an explicit operator this round-trips through FTS5 faithfully.
eq('compagnie AND (oost-indie OR ceylon)', 'compagnie AND ("oost-indie" OR ceylon)');
eq('(zuid-holland OR zuyd-beveland)', '("zuid-holland" OR "zuyd-beveland")');
// Pure transform is still correct here, but FTS5 rejects implicit-AND before a
// group (`a (b OR c)`), so sanitizeFtsQuery falls back to a whole-phrase wrap.
eq('compagnie (oost-indie OR ceylon)', 'compagnie ("oost-indie" OR ceylon)');

console.log('4. trailing prefix * is kept outside the quotes');
eq('oost-indie*', '"oost-indie"*');
eq('dag-register*', '"dag-register"*');
eq('handel*', 'handel*', 'legal bareword keeps a bare *');

console.log('5. existing "phrases" pass through untouched');
eq('"oost indie"', '"oost indie"');
eq('"oost indie" AND kaneel-handel', '"oost indie" AND "kaneel-handel"');
eq('"oost indie"*', '"oost indie"*', 'phrase-prefix marker preserved');

console.log('6. clean queries are returned unchanged (no needless rewriting)');
eq('kaneel', 'kaneel');
eq('koffij AND thee', 'koffij AND thee');
eq('peper OR kaneel OR nagelen', 'peper OR kaneel OR nagelen');
eq('1750', '1750', 'bare number is a legal bareword');

console.log('7. unicode letters count as legal barewords (not quoted)');
eq('café', 'café');
eq('açúcar', 'açúcar');

finish('FTS escaper tests');
