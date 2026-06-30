/**
 * Unit tests for the document-ID parser and normalizer (src/utils/document-id.ts).
 *
 * parseDocumentId and normalizeDocumentId are pure functions, so these run
 * without a database or network. They pin the ALLOWLIST regex tightened in
 * plan 015 and guard against regression.
 *
 * Run with: npm run test:document-id
 */

import { parseDocumentId, normalizeDocumentId } from '../src/utils/document-id.js';
import { ToolError } from '../src/utils/errors.js';
import { check, finish } from './test-utils.js';

// ---------------------------------------------------------------------------
// 1. parseDocumentId — valid IDs
// ---------------------------------------------------------------------------

console.log('1. parseDocumentId — valid IDs');

{
  const result = parseDocumentId('NL-HaNA_1.04.02_9966_0106');
  check(result.archive === '1.04.02', 'archive is 1.04.02');
  check(result.inventoryNumber === '9966', 'inventoryNumber is 9966');
  check(result.scanNumber === '0106', 'scanNumber is 0106');
}

// URN prefix stripped (lowercase)
{
  const result = parseDocumentId('urn:globalise:NL-HaNA_1.04.02_9966_0106');
  check(result.archive === '1.04.02', 'URN prefix stripped — archive');
  check(result.inventoryNumber === '9966', 'URN prefix stripped — inventoryNumber');
  check(result.scanNumber === '0106', 'URN prefix stripped — scanNumber');
}

// URN prefix stripped (uppercase, case-insensitive)
{
  const result = parseDocumentId('URN:GLOBALISE:NL-HaNA_1.04.02_9966_0106');
  check(result.inventoryNumber === '9966', 'UPPERCASE URN prefix stripped');
}

// Letter-suffixed inventory (1080A)
{
  const result = parseDocumentId('NL-HaNA_1.04.02_1080A_0106');
  check(result.inventoryNumber === '1080A', 'letter-suffixed inventory 1080A parses');
}

// ---------------------------------------------------------------------------
// 2. parseDocumentId — REJECTION of malicious/malformed IDs
// ---------------------------------------------------------------------------

console.log('2. parseDocumentId — rejected IDs (ToolError expected)');

const badIds: Array<[string, string]> = [
  ['NL-HaNA_1.04.02_9966_0106/../x',   'path traversal (/../)'],
  ['NL-HaNA_1.04.02_9966_0106?x=1',    'query string (?x=1)'],
  ['NL-HaNA_1.04.02_9966_0106#frag',   'fragment (#frag)'],
  ['NL-HaNA_1.04.02_9966_0106%2f',     'percent-encoded slash (%2f)'],
  ['NL-HaNA_1.04.02_9966_0106\\..\x5cx', 'backslash (\\)'],
  ['NL-HaNA_1.04.02_9966_0106:1',      'colon (:1)'],
  ['not-an-id',                          'completely wrong format'],
];

for (const [id, label] of badIds) {
  let threw = false;
  let isToolError = false;
  try {
    parseDocumentId(id);
  } catch (err) {
    threw = true;
    isToolError = err instanceof ToolError;
  }
  check(threw && isToolError, `${label} → throws ToolError`);
}

// ---------------------------------------------------------------------------
// 3. normalizeDocumentId
// ---------------------------------------------------------------------------

console.log('3. normalizeDocumentId');

{
  const result = normalizeDocumentId('NL-HaNA_1.04.02_9966_0106');
  check(result === 'urn:globalise:NL-HaNA_1.04.02_9966_0106', 'bare id → URN');
}

{
  const urn = 'urn:globalise:NL-HaNA_1.04.02_9966_0106';
  check(normalizeDocumentId(urn) === urn, 'already-URN returned unchanged (lowercase)');
}

{
  const urnUpper = 'URN:GLOBALISE:NL-HaNA_1.04.02_9966_0106';
  check(normalizeDocumentId(urnUpper) === urnUpper, 'already-URN returned unchanged (uppercase)');
}

finish('Document-ID tests');
