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
  documentLineTrim,
  navigateLineTrim,
  viewerTranscriptionTrim,
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

  const occurrences = (String(result.note).match(/fetched results \(dropped/g) || []).length;
  check(occurrences === 1, `row-drop cap message appears exactly once (got ${occurrences})`);
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

  const rowMsgs = (String(result.note).match(/fetched results \(dropped/g) || []).length;
  check(rowMsgs === 1, `search row-drop cap message appears exactly once (got ${rowMsgs})`);
  check(String(result.note).includes('snippets were shortened'), 'compact note preserved alongside row-drop note');
}

// ---------------------------------------------------------------------------
// Plan 006 cases: documentLineTrim + navigateLineTrim
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Case 7: retrieve over budget → text.lines trimmed, truncated/totalLines set
// ---------------------------------------------------------------------------
console.log('7. retrieve: documentLineTrim trims text.lines, sets truncated+totalLines');
{
  const lineCount = 1000;
  const result: Record<string, unknown> = {
    id: 'urn:globalise:NL-HaNA_1.04.02_9966_0106',
    document: 'NL-HaNA_1.04.02_9966_0106',
    inventoryNumber: '9966',
    scanNumber: '0106',
    text: {
      lines: Array.from({ length: lineCount }, (_, i) => `Line ${i}: ${'word '.repeat(20)}`),
    },
    metadata: {
      created: '2024-01-01',
      lastChange: '2024-01-01',
      layoutAnalysis: 'v1',
      languages: [{ code: 'nld', label: 'Dutch' }],
    },
  };

  const budget = 20_000;
  const originalLines = (result.text as { lines: unknown[] }).lines.slice();

  const report = fitResultToBudget(result, documentLineTrim, budget);
  check(report.trimmed === true, `trimmed:true (got ${report.trimmed})`);

  const text = result.text as { lines: unknown[]; truncated: boolean; totalLines: number };
  check(text.lines.length < lineCount, `lines.length (${text.lines.length}) < original (${lineCount})`);
  check(text.truncated === true, 'text.truncated===true');
  check(text.totalLines === lineCount, `text.totalLines===${lineCount} (got ${text.totalLines})`);
  check(report.bytes <= budget, `bytes (${report.bytes}) <= budget (${budget})`);

  // Kept lines are a prefix of the original
  const keptLines = text.lines as string[];
  check(
    keptLines.every((line, i) => line === (originalLines[i] as string)),
    'kept lines are a prefix of original',
  );

  // Still valid JSON
  let ok = false;
  try { JSON.parse(JSON.stringify(result)); ok = true; } catch { ok = false; }
  check(ok, 'result is still valid JSON after line trim');
}

// ---------------------------------------------------------------------------
// Case 8: navigate nested trim → targetDocument.text.lines trimmed
// ---------------------------------------------------------------------------
console.log('8. navigate: navigateLineTrim trims targetDocument.text.lines');
{
  const lineCount = 800;
  const result: Record<string, unknown> = {
    success: true,
    currentDocument: { id: 'urn:globalise:NL-HaNA_1.04.02_9966_0106', document: 'NL-HaNA_1.04.02_9966_0106', inventoryNumber: '9966', scanNumber: '0106' },
    targetDocument: {
      id: 'urn:globalise:NL-HaNA_1.04.02_9966_0107',
      document: 'NL-HaNA_1.04.02_9966_0107',
      inventoryNumber: '9966',
      scanNumber: '0107',
      text: {
        lines: Array.from({ length: lineCount }, (_, i) => `Line ${i}: ${'word '.repeat(20)}`),
      },
    },
    message: 'ok',
  };

  const budget = 15_000;
  fitResultToBudget(result, navigateLineTrim, budget);

  const targetDoc = result.targetDocument as { text: { lines: unknown[]; truncated: boolean; totalLines: number } };
  check(targetDoc.text.lines.length < lineCount, `targetDocument.text.lines trimmed (${targetDoc.text.lines.length} < ${lineCount})`);
  check(targetDoc.text.truncated === true, 'targetDocument.text.truncated===true');
  check(targetDoc.text.totalLines === lineCount, `targetDocument.text.totalLines===${lineCount}`);
}

// ---------------------------------------------------------------------------
// Case 9: navigate with no text → strategy returns null → irreducible
// ---------------------------------------------------------------------------
console.log('9. navigate with no text → null strategy → irreducible');
{
  // Under budget: nothing happens (and no error)
  const resultUnder: Record<string, unknown> = {
    success: true,
    currentDocument: { id: 'x', document: 'x', inventoryNumber: '1', scanNumber: '1' },
    targetDocument: { id: 'y', document: 'y', inventoryNumber: '1', scanNumber: '2' },
    message: 'ok',
  };
  const reportUnder = fitResultToBudget(resultUnder, navigateLineTrim, 1_000_000);
  check(!reportUnder.trimmed, 'under budget with no text: trimmed:false');
  // Note: when text is absent the strategy returns null; fitResultToBudget
  // returns overBudgetIrreducible only when bytes > budget. So the under-budget
  // case just returns {trimmed:false}.

  // Over budget with no text → overBudgetIrreducible
  const resultOver: Record<string, unknown> = {
    success: true,
    currentDocument: { id: 'x', document: 'x', inventoryNumber: '1', scanNumber: '1' },
    targetDocument: { id: 'y', document: 'y', inventoryNumber: '1', scanNumber: '2' },
    // Bloat without lines
    message: 'x'.repeat(100_000),
  };
  const reportOver = fitResultToBudget(resultOver, navigateLineTrim, 1_000);
  check(reportOver.overBudgetIrreducible === true, 'over budget with no text: overBudgetIrreducible:true');
  check(!reportOver.trimmed, 'over budget with no text: trimmed:false');
}

// ---------------------------------------------------------------------------
// Case 10: view_document_ui over budget → transcription tail trimmed
// (the app-tool handler now guards its budget too; audit finding #4)
// ---------------------------------------------------------------------------
console.log('10. viewer: viewerTranscriptionTrim drops tail lines of result.transcription');
{
  const lineCount = 2000;
  const result: Record<string, unknown> = {
    id: 'urn:globalise:NL-HaNA_1.04.02_9966_0106',
    iiifImageUrl: 'https://service.archief.nl/iip/x.jp2/full/max/0/default.jpg',
    transcription: Array.from({ length: lineCount }, (_, i) => `Line ${i}: ${'word '.repeat(20)}`),
    metadata: { inventory: '9966', scan: '0106', languages: [{ code: 'nld', label: 'Dutch' }] },
    navigation: { prev: null, next: null },
    urls: { viewer: 'https://transcriptions.globalise.huygens.knaw.nl/detail/x', archive: null },
    highlight: [],
  };
  const budget = 25_000;
  const originalLines = (result.transcription as unknown[]).slice();

  const report = fitResultToBudget(result, viewerTranscriptionTrim, budget);
  check(report.trimmed === true, `trimmed:true (got ${report.trimmed})`);

  const transcription = result.transcription as string[];
  check(transcription.length < lineCount, `transcription trimmed (${transcription.length} < ${lineCount})`);
  check(report.bytes <= budget, `bytes (${report.bytes}) <= budget (${budget})`);
  check(
    transcription.every((line, i) => line === (originalLines[i] as string)),
    'kept lines are a prefix of the original order',
  );

  let ok = false;
  try { JSON.parse(JSON.stringify(result)); ok = true; } catch { ok = false; }
  check(ok, 'viewer result is still valid JSON after transcription trim');
}

// ---------------------------------------------------------------------------
// Case 11: viewer under budget / no transcription → untouched / irreducible
// ---------------------------------------------------------------------------
console.log('11. viewer: under budget untouched; missing transcription → irreducible');
{
  const under: Record<string, unknown> = {
    id: 'x',
    iiifImageUrl: 'https://service.archief.nl/iip/x.jp2/full/max/0/default.jpg',
    transcription: ['a', 'b', 'c'],
    metadata: { inventory: '1', scan: '1', languages: [] },
    navigation: { prev: null, next: null },
    urls: { viewer: 'https://example/x', archive: null },
    highlight: [],
  };
  const reportUnder = fitResultToBudget(under, viewerTranscriptionTrim, 1_000_000);
  check(!reportUnder.trimmed, 'under budget → trimmed:false');
  check((under.transcription as unknown[]).length === 3, 'transcription untouched under budget');

  // No transcription array → strategy returns null → irreducible when over budget
  const noLines: Record<string, unknown> = { id: 'x', note: 'y'.repeat(100_000) };
  const reportNull = fitResultToBudget(noLines, viewerTranscriptionTrim, 1_000);
  check(reportNull.overBudgetIrreducible === true, 'no transcription array over budget → overBudgetIrreducible');
}

finish('Response-size guard');
