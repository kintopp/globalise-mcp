/**
 * Viewer command-queue session (plan 021, src/utils/viewer-session.ts), tested
 * through the functions the view/poll handlers call. Failure modes pinned:
 *   - a remount that replaces the entry instead of updating it drops
 *     createdAt, lastPolledAt and commands queued before the page turn
 *   - a stale or absent UUID that is adopted instead of minting a fresh one
 *   - a drain that returns commands without emptying the queue (replayed zooms)
 *     or without stamping lastPolledAt
 *   - eviction that removes fresh entries, or keeps idle ones
 *   - implicit by-document discovery running when disallowed (cross-user steering
 *     over HTTP), or choosing by insertion order instead of recency
 *   - an explicit UUID for another document being honoured
 *   - the command queue or session map growing past its caps, or the session cap
 *     evicting by insertion order (dropping a polling viewer)
 *
 * Run with: npm run test:viewer-session
 */

import {
  viewerQueues, mintOrRemount, drainQueue, evictIdle, resolveActiveViewer,
  implicitViewerDiscoveryAllowed, enqueueCommands, MAX_PENDING_COMMANDS, MAX_VIEWER_SESSIONS,
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

// ---------------------------------------------------------------------------
// 5. resolveActiveViewer
// ---------------------------------------------------------------------------

console.log('5. resolveActiveViewer');

{
  viewerQueues.clear();
  const A2 = mintOrRemount(undefined, DOC_A);
  const A1 = mintOrRemount(undefined, DOC_A);
  const B1 = mintOrRemount(undefined, DOC_B);
  viewerQueues.get(A1)!.lastAccess = 1000;
  viewerQueues.get(A2)!.lastAccess = 2000;
  viewerQueues.get(B1)!.lastAccess = 1500;

  check(resolveActiveViewer(DOC_A, undefined, true) === A2, 'implicit discovery picks the most recently used viewer, not the last inserted');
  check(resolveActiveViewer(DOC_A, undefined, false) === undefined, 'implicit discovery is off when disallowed');
  check(resolveActiveViewer(DOC_A, A1, false) === A1, 'an explicit UUID still works when implicit discovery is disallowed');
  check(resolveActiveViewer(DOC_A, B1, true) === undefined, 'an explicit UUID for another document is refused');
  check(resolveActiveViewer(DOC_A, 'nope', true) === undefined, 'an unknown UUID is refused');
  viewerQueues.clear();
}

// ---------------------------------------------------------------------------
// 6. implicitViewerDiscoveryAllowed
// ---------------------------------------------------------------------------

console.log('6. implicitViewerDiscoveryAllowed');

{
  const original = process.env.TRANSPORT;
  process.env.TRANSPORT = 'http';
  check(implicitViewerDiscoveryAllowed() === false, 'disallowed over HTTP');
  delete process.env.TRANSPORT;
  check(implicitViewerDiscoveryAllowed() === true, 'allowed over stdio (default)');
  if (original === undefined) delete process.env.TRANSPORT;
  else process.env.TRANSPORT = original;
}

// ---------------------------------------------------------------------------
// 7. enqueueCommands cap
// ---------------------------------------------------------------------------

console.log('7. enqueueCommands');

{
  viewerQueues.clear();
  const q = viewerQueues.get(mintOrRemount(undefined, DOC_A))!;
  const total = MAX_PENDING_COMMANDS + 5;
  for (let i = 0; i < total; i++) enqueueCommands(q, { action: 'navigate', region: `pct:0,0,${i + 1},1` });
  check(q.commands.length === MAX_PENDING_COMMANDS, 'the queue is capped');
  check(q.commands[q.commands.length - 1].region === `pct:0,0,${total},1`, 'the newest command is kept');
  check(q.commands[0].region === 'pct:0,0,6,1', 'the oldest commands are dropped first');
  viewerQueues.clear();
}

// ---------------------------------------------------------------------------
// 8. Session cap
// ---------------------------------------------------------------------------

console.log('8. session cap');

{
  viewerQueues.clear();
  const uuids: string[] = [];
  for (let i = 0; i < MAX_VIEWER_SESSIONS; i++) {
    const u = mintOrRemount(undefined, DOC_A);
    viewerQueues.get(u)!.lastAccess = i;
    uuids.push(u);
  }
  viewerQueues.get(uuids[0])!.lastAccess = MAX_VIEWER_SESSIONS + 1;
  const extra = mintOrRemount(undefined, DOC_A);
  check(viewerQueues.size === MAX_VIEWER_SESSIONS, 'minting past the cap keeps the map at the cap');
  check(viewerQueues.has(extra), 'the new session is present');
  check(!viewerQueues.has(uuids[1]), 'the least recently used session is evicted');
  check(viewerQueues.has(uuids[0]), 'a recently used (polling) session survives despite being the oldest insertion');
  viewerQueues.clear();
}

finish('Viewer session tests');
