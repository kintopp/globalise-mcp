/**
 * Unit tests for the viewer command-queue session semantics (plan 021,
 * src/utils/viewer-session.ts). Pure in-memory Map/array operations — no
 * network, no DB. These pin the behaviors the navigate/poll/view handlers
 * rely on: mint/read, drain (splice), the overlay cap, and remount.
 *
 * Run with: npm run test:viewer-session
 */

import { viewerQueues, ACTIVE_OVERLAYS_CAP, sweepTtlMap, type ViewerQueue } from '../src/utils/viewer-session.js';
import { check, finish } from './test-utils.js';

function makeQueue(documentId: string): ViewerQueue {
  return {
    commands: [],
    createdAt: Date.now(),
    lastAccess: Date.now(),
    documentId,
    imageWidth: 5892,
    imageHeight: 4167,
    activeOverlays: [],
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
  q.commands.push({ action: 'add_overlay', region: 'pct:10,10,5,5', label: 'a' });
  const drained = q.commands.splice(0);
  check(drained.length === 2, 'drain returns all queued commands');
  check(q.commands.length === 0, 'queue is empty after drain');
  check(q.commands.splice(0).length === 0, 'a second drain returns nothing');
}

// ---------------------------------------------------------------------------
// 3. ACTIVE_OVERLAYS_CAP slice behavior
// ---------------------------------------------------------------------------

console.log('3. ACTIVE_OVERLAYS_CAP slice');

{
  const q = makeQueue('doc');
  for (let i = 0; i < ACTIVE_OVERLAYS_CAP + 10; i++) {
    q.activeOverlays.push({ region: `pct:0,0,1,1`, label: `overlay-${i}` });
    if (q.activeOverlays.length > ACTIVE_OVERLAYS_CAP) {
      q.activeOverlays = q.activeOverlays.slice(-ACTIVE_OVERLAYS_CAP);
    }
  }
  check(q.activeOverlays.length === ACTIVE_OVERLAYS_CAP, `overlay list capped at ${ACTIVE_OVERLAYS_CAP}`);
  check(q.activeOverlays[0].label === `overlay-10`, 'cap keeps the newest overlays (slice from the tail)');
  check(q.activeOverlays[ACTIVE_OVERLAYS_CAP - 1].label === `overlay-${ACTIVE_OVERLAYS_CAP + 9}`, 'last entry is the most recent');
}

// ---------------------------------------------------------------------------
// 4. Remount semantics (same key overwrite clears overlays, keeps createdAt)
// ---------------------------------------------------------------------------

console.log('4. remount semantics');

{
  const uuid = 'test-uuid-remount';
  const original = makeQueue('urn:globalise:NL-HaNA_1.04.02_9966_0106');
  original.activeOverlays.push({ region: 'pct:0,0,5,5', label: 'old' });
  original.lastPolledAt = 123456;
  viewerQueues.set(uuid, original);
  const createdAt = original.createdAt;

  // Remount (as viewDocumentUi does): reuse the entry, swap content, clear
  // overlays, keep createdAt and lastPolledAt untouched.
  const existing = viewerQueues.get(uuid)!;
  existing.documentId = 'urn:globalise:NL-HaNA_1.04.02_9966_0107';
  existing.imageWidth = 4000;
  existing.imageHeight = 3000;
  existing.activeOverlays = [];
  existing.lastAccess = Date.now();

  const q = viewerQueues.get(uuid)!;
  check(q.documentId === 'urn:globalise:NL-HaNA_1.04.02_9966_0107', 'remount swaps documentId');
  check(q.activeOverlays.length === 0, 'remount clears overlays');
  check(q.createdAt === createdAt, 'remount preserves createdAt');
  check(q.lastPolledAt === 123456, 'remount leaves lastPolledAt untouched (iframe still polling)');
  viewerQueues.delete(uuid);
}

// ---------------------------------------------------------------------------
// 5. sweepTtlMap is exported and callable (interval is unref'd)
// ---------------------------------------------------------------------------

console.log('5. sweepTtlMap');

{
  const m = new Map<string, { lastAccess: number }>();
  m.set('k', { lastAccess: Date.now() });
  // Should not throw; the interval it starts is unref'd so it won't hang exit.
  sweepTtlMap(m, 1_000_000);
  check(m.has('k'), 'sweepTtlMap does not immediately evict a fresh entry');
}

finish('Viewer session tests');
