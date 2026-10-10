/**
 * Viewer command-queue session (plan 021, src/utils/viewer-session.ts), tested
 * through the functions the view/poll handlers call. Failure modes pinned:
 *   - a remount that replaces the entry instead of updating it drops
 *     createdAt, lastPolledAt and commands queued before the page turn
 *   - a stale or absent UUID that is adopted instead of minting a fresh one
 *   - a drain that returns commands without emptying the queue (replayed zooms)
 *     or without stamping lastPolledAt
 *   - eviction that removes fresh entries, or keeps idle ones
 *
 * Run with: npm run test:viewer-session
 */

import {
  viewerQueues, mintOrRemount, drainQueue, evictIdle,
} from '../src/utils/viewer-session.js';
import { check, finish } from './test-utils.js';

const DOC_A = 'urn:globalise:NL-HaNA_1.04.02_9966_0106';
const DOC_B = 'urn:globalise:NL-HaNA_1.04.02_9966_0107';

// ---------------------------------------------------------------------------
// 1. Mint
// ---------------------------------------------------------------------------

console.log('1. mint');

{
  const uuid = mintOrRemount(undefined, DOC_A, { width: 5892, height: 4167 });
  const q = viewerQueues.get(uuid);
  check(!!q, 'a minted session is retrievable by the returned UUID');
  check(q?.documentId === DOC_A && q?.imageWidth === 5892 && q?.imageHeight === 4167, 'document and dims stored');
  check(q?.commands.length === 0, 'a fresh session has no commands');

  const stale = mintOrRemount('evicted-uuid', DOC_A);
  check(stale !== 'evicted-uuid' && viewerQueues.has(stale), 'an unknown UUID mints a fresh session instead of adopting it');
  check(!viewerQueues.has('evicted-uuid'), 'the unknown UUID is not created');
  check(mintOrRemount(undefined, DOC_A) !== uuid, 'each mint gets its own UUID');
}

// ---------------------------------------------------------------------------
// 2. Remount (in-viewer page navigation)
// ---------------------------------------------------------------------------

console.log('2. remount');

{
  const uuid = mintOrRemount(undefined, DOC_A, { width: 5892, height: 4167 });
  const before = viewerQueues.get(uuid)!;
  const { createdAt } = before;
  before.lastPolledAt = 123456;
  before.lastAccess = 0;
  before.commands.push({ action: 'navigate', region: 'pct:0,0,50,50' });

  const again = mintOrRemount(uuid, DOC_B, { width: 4000, height: 3000 });
  const q = viewerQueues.get(uuid)!;
  check(again === uuid, 'a live UUID is kept');
  check(q.documentId === DOC_B, 'remount swaps the document');
  check(q.imageWidth === 4000 && q.imageHeight === 3000, 'remount swaps the dims');
  check(q.createdAt === createdAt, 'remount preserves createdAt');
  check(q.lastPolledAt === 123456, 'remount leaves lastPolledAt untouched (iframe still polling)');
  check(q.lastAccess > 0, 'remount refreshes lastAccess');
  check(q.commands.length === 1, 'remount keeps commands queued before the page turn');

  mintOrRemount(uuid, DOC_A);
  check(q.imageWidth === undefined && q.imageHeight === undefined,
    'remounting onto a page without dims clears the old dims rather than keeping the wrong ones');
}

// ---------------------------------------------------------------------------
// 3. Drain
// ---------------------------------------------------------------------------

console.log('3. drain');

{
  const uuid = mintOrRemount(undefined, DOC_A);
  const q = viewerQueues.get(uuid)!;
  q.commands.push({ action: 'navigate', region: 'pct:0,0,50,50' });
  q.commands.push({ action: 'navigate', region: 'pct:10,10,5,5' });

  const drained = drainQueue(uuid);
  check(drained.length === 2 && drained[0].region === 'pct:0,0,50,50', 'drain returns every queued command, in order');
  check(drainQueue(uuid).length === 0, 'a second drain returns nothing (no replayed zooms)');
  check(typeof q.lastPolledAt === 'number' && q.lastPolledAt > 0, 'drain stamps lastPolledAt');
  check(drainQueue('no-such-uuid').length === 0, 'an unknown UUID drains nothing');
  check(!viewerQueues.has('no-such-uuid'), 'draining an unknown UUID does not create a session');
}

// ---------------------------------------------------------------------------
// 4. Idle eviction
// ---------------------------------------------------------------------------

console.log('4. evictIdle');

{
  const now = 10_000_000;
  const m = new Map([
    ['fresh', { lastAccess: now - 1_000 }],
    ['boundary', { lastAccess: now - 60_000 }],
    ['idle', { lastAccess: now - 60_001 }],
  ]);
  evictIdle(m, 60_000, now);
  check(m.has('fresh'), 'a recently used entry survives');
  check(m.has('boundary'), 'an entry idle for exactly the TTL survives');
  check(!m.has('idle'), 'an entry idle past the TTL is evicted');
}

finish('Viewer session tests');
