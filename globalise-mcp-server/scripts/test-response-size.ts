/**
 * Tests for the byte-aware response-size guard (src/utils/response-size.ts).
 *
 * Imports the real strategies from the pure module — no inline copies to drift.
 * Does NOT import from index.ts (which boots the server on import).
 *
 * Run with: npm run test:response-size
 */

import {
  fitResultToBudget,
  recordListTrim,
  searchResultTrim,
} from '../src/utils/response-size.js';
import { check, finish } from './test-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal list-tool result shaped like find/commodity/measure. */
function makeListResult(n: number, itemSize = 200): Record<string, unknown> {
  return {
    total: { value: n, relation: 'eq' },
    results: Array.from({ length: n }, (_, i) => ({
      id: `item-${i}`,
      label: 'x'.repeat(itemSize),
    })),
    pagination: { from: 0, size: n, hasMore: false },
  };
}

/** Build a minimal search-shaped result with highlightedFragments. */
function makeSearchResult(n: number, fragCount = 3, fragLen = 400): Record<string, unknown> {
  return {
    total: { value: n, relation: 'eq' },
    results: Array.from({ length: n }, (_, i) => ({
      id: `doc-${i}`,
      document: `NL-HaNA_1.04.02_9966_0${String(i).padStart(3, '0')}`,
      inventoryNumber: '9966',
      highlightedFragments: Array.from({ length: fragCount }, (__, j) => `Fragment ${j}: ${'a'.repeat(fragLen)}`),
      tokenCount: 500,
      languages: [{ code: 'nld', label: 'Dutch' }],
    })),
    pagination: { from: 0, size: n, hasMore: false },
    aggregations: {},
  };
}

// ---------------------------------------------------------------------------
// Case 1: Under budget → untouched
// ---------------------------------------------------------------------------
console.log('1. under budget → untouched');
{
  const result = makeListResult(5, 50);
  const budget = 1_000_000;
  const report = fitResultToBudget(result, recordListTrim, budget);
  check(!report.trimmed, 'trimmed should be false when under budget');
  check((result.results as unknown[]).length === 5, 'array length unchanged');
  check(report.bytes > 0, 'bytes reported');
  check(report.bytes <= budget, 'bytes within budget');
}

// ---------------------------------------------------------------------------
// Case 2: Over budget → row-trimmed at element boundary
// ---------------------------------------------------------------------------
console.log('2. over budget → row-trimmed, kept < original, serialized fits budget');
{
  const n = 500;
  // Each item is ~1KB, so total ~500KB > 50KB budget
  const result = makeListResult(n, 1_000);
  const budget = 50_000;
  const originalItems = (result.results as unknown[]).slice(); // copy before trim

  const report = fitResultToBudget(result, recordListTrim, budget);
  check(report.trimmed === true, `trimmed:true (got ${report.trimmed})`);
  check(typeof report.kept === 'number' && report.kept < n, `kept(${report.kept}) < original(${n})`);
  check(report.bytes <= budget, `serialized (${report.bytes}) <= budget (${budget})`);

  // kept items are a PREFIX of original
  const keptItems = result.results as Array<{ id: string }>;
  check(
    keptItems.every((item, i) => item.id === (originalItems[i] as { id: string }).id),
    'kept items are a prefix of original order',
  );
}

// ---------------------------------------------------------------------------
// Case 3: Repair applied after trim
// ---------------------------------------------------------------------------
console.log('3. repair applied: pagination.hasMore=true, total unchanged, note non-empty with KB figure');
{
  const n = 500;
  const originalTotal = n;
  const result = makeListResult(n, 1_000);
  const budget = 50_000;

  fitResultToBudget(result, recordListTrim, budget);

  const pagination = result.pagination as Record<string, unknown>;
  check(pagination.hasMore === true, 'pagination.hasMore===true after trim');

  const total = result.total as { value: number };
  check(total.value === originalTotal, `total.value (${total.value}) unchanged from ${originalTotal}`);

  const note = result.note as string | undefined;
  check(typeof note === 'string' && note.length > 0, 'note is non-empty string');
  check(typeof note === 'string' && note.includes('KB'), 'note contains KB figure');
}

// ---------------------------------------------------------------------------
// Case 4: Still valid JSON after trim
// ---------------------------------------------------------------------------
console.log('4. still valid JSON after trim');
{
  const result = makeListResult(500, 1_000);
  fitResultToBudget(result, recordListTrim, 50_000);
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(result));
  } catch {
    parsed = null;
  }
  check(parsed !== null && typeof parsed === 'object', 'JSON.parse(JSON.stringify(result)) succeeds');
}

// ---------------------------------------------------------------------------
// Case 5a: No strategy → irreducible
// ---------------------------------------------------------------------------
console.log('5a. no strategy → overBudgetIrreducible');
{
  const result = makeListResult(500, 1_000);
  const report = fitResultToBudget(result, undefined, 50_000);
  check(report.overBudgetIrreducible === true, 'overBudgetIrreducible:true when no strategy');
  check(!report.trimmed, 'trimmed:false when no strategy');
}

// ---------------------------------------------------------------------------
// Case 5b: Empty results array → irreducible
// ---------------------------------------------------------------------------
console.log('5b. empty results array → overBudgetIrreducible');
{
  // Craft a result that is over budget but whose results array is empty.
  const result: Record<string, unknown> = {
    total: { value: 0, relation: 'eq' },
    results: [],
    pagination: { from: 0, size: 0, hasMore: false },
    // Bloat it with a big note so it exceeds the budget
    note: 'x'.repeat(200_000),
  };
  const report = fitResultToBudget(result, recordListTrim, 50_000);
  check(report.overBudgetIrreducible === true, 'overBudgetIrreducible:true when results is empty');
}

// ---------------------------------------------------------------------------
// Case 6a: searchResultTrim compaction first (budget fits after compact, no rows dropped)
// ---------------------------------------------------------------------------
console.log('6a. compact-before-row-drop: compaction alone satisfies budget');
{
  // 20 search results, each with 3 fragments of 400 chars → bulky.
  // Budget is set so full fragments exceed it but compacted fragments fit.
  const n = 20;
  const result = makeSearchResult(n, 3, 400) as Record<string, unknown>;
  const fullBytes = JSON.stringify(result).length;

  // Estimate post-compact size: 1 fragment of ≤200 chars per result
  // Budget: something that full fails but compact passes.
  // Full ≈ 20 results × 3 frags × ~410 chars ≈ 24,600 + overhead ~ 30KB
  // After compact: 20 results × 1 frag × ≤210 chars ≈ 4,200 + overhead ~ 12KB
  // Pick budget slightly below full but comfortably above compact.
  const budget = Math.floor(fullBytes * 0.55);

  const report = fitResultToBudget(result, searchResultTrim, budget);
  check(report.compacted === true, 'compacted:true when fragments were shortened');
  check(report.trimmed === false, `trimmed:false (no rows dropped) — got trimmed:${report.trimmed}`);
  check(report.bytes <= budget, `compacted bytes (${report.bytes}) <= budget (${budget})`);

  // Verify fragments were actually shortened
  const results = result.results as Array<{ highlightedFragments: string[] }>;
  const allSingle = results.every((r) => r.highlightedFragments.length === 1);
  check(allSingle, 'all results have exactly 1 fragment after compaction');
  const allShort = results.every((r) => r.highlightedFragments[0].length <= 201); // 200 + "…"
  check(allShort, 'all fragments are ≤201 chars after compaction');
}

// ---------------------------------------------------------------------------
// Case 6b: searchResultTrim: compaction + row-drop when budget is tighter
// ---------------------------------------------------------------------------
console.log('6b. compact + row-drop when budget requires both');
{
  const n = 200;
  const result = makeSearchResult(n, 3, 400) as Record<string, unknown>;
  // Very tight budget — compaction alone won't be enough
  const budget = 20_000;

  const report = fitResultToBudget(result, searchResultTrim, budget);
  check(report.compacted === true, 'compacted:true');
  check(report.trimmed === true, 'trimmed:true (rows also dropped)');
  check(typeof report.kept === 'number' && report.kept < n, `kept(${report.kept}) < original(${n})`);
  check(report.bytes <= budget, `final bytes (${report.bytes}) <= budget (${budget})`);
}

finish('Response-size guard');
