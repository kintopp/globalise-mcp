/**
 * Unit tests for the viewer command-queue session semantics (plan 021,
 * src/utils/viewer-session.ts). Pure in-memory Map/array operations — no
 * network, no DB. These pin the behaviors the navigate/poll/view handlers
 * rely on: mint/read, drain (splice), and remount.
 *
 * Run with: npm run test:viewer-session
 */

import { viewerQueues, sweepTtlMap, type ViewerQueue } from '../src/utils/viewer-session.js';
import { check, finish } from './test-utils.js';

function makeQueue(documentId: string): ViewerQueue {
  return {
    commands: [],
    createdAt: Date.now(),
    lastAccess: Date.now(),
    documentId,
    imageWidth: 5892,
    imageHeight: 4167,
  };
}

// ---------------------------------------------------------------------------
// 1. Mint + read
// ---------------------------------------------------------------------------

console.log('1. mint + read');

{
  const uuid = 'test-uuid-1';
  viewerQueues.set(uuid, makeQueue('urn:globalise:NL-HaNA_1.04.02_9966_0106'));
  const q = viewerQueues.get(uuid);
  check(!!q, 'minted queue is retrievable by UUID');
  check(q?.documentId === 'urn:globalise:NL-HaNA_1.04.02_9966_0106', 'documentId stored');
  check(q?.imageWidth === 5892 && q?.imageHeight === 4167, 'dims stored');
  check(Array.isArray(q?.commands) && q?.commands.length === 0, 'commands starts empty');
  viewerQueues.delete(uuid);
}

// ---------------------------------------------------------------------------
// 2. Drain semantics (splice(0) returns all + empties)
// ---------------------------------------------------------------------------

console.log('2. drain semantics');

{
  const q = makeQueue('doc');
  q.commands.push({ action: 'navigate', region: 'pct:0,0,50,50' });
  q.commands.push({ action: 'navigate', region: 'pct:10,10,5,5' });
  const drained = q.commands.splice(0);
  check(drained.length === 2, 'drain returns all queued commands');
  check(q.commands.length === 0, 'queue is empty after drain');
  check(q.commands.splice(0).length === 0, 'a second drain returns nothing');
}

// ---------------------------------------------------------------------------
// 3. Remount semantics (same key overwrite swaps content, keeps createdAt)
// ---------------------------------------------------------------------------

console.log('3. remount semantics');

{
  const uuid = 'test-uuid-remount';
  const original = makeQueue('urn:globalise:NL-HaNA_1.04.02_9966_0106');
  original.lastPolledAt = 123456;
  viewerQueues.set(uuid, original);
  const createdAt = original.createdAt;

  // Remount (as viewDocumentUi does): reuse the entry, swap content, keep
  // createdAt and lastPolledAt untouched.
  const existing = viewerQueues.get(uuid)!;
  existing.documentId = 'urn:globalise:NL-HaNA_1.04.02_9966_0107';
  existing.imageWidth = 4000;
  existing.imageHeight = 3000;
  existing.lastAccess = Date.now();

  const q = viewerQueues.get(uuid)!;
  check(q.documentId === 'urn:globalise:NL-HaNA_1.04.02_9966_0107', 'remount swaps documentId');
  check(q.createdAt === createdAt, 'remount preserves createdAt');
  check(q.lastPolledAt === 123456, 'remount leaves lastPolledAt untouched (iframe still polling)');
  viewerQueues.delete(uuid);
}

// ---------------------------------------------------------------------------
// 4. sweepTtlMap is exported and callable (interval is unref'd)
// ---------------------------------------------------------------------------

console.log('4. sweepTtlMap');

{
  const m = new Map<string, { lastAccess: number }>();
  m.set('k', { lastAccess: Date.now() });
  // Should not throw; the interval it starts is unref'd so it won't hang exit.
  sweepTtlMap(m, 1_000_000);
  check(m.has('k'), 'sweepTtlMap does not immediately evict a fresh entry');
}

finish('Viewer session tests');
