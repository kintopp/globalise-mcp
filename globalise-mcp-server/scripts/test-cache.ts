/**
 * Unit tests for LRUCache: LRU eviction, TTL expiry, and the fused in-flight
 * dedup entry point (getOrFetch, plan 025).
 *
 * Run with: npm run test:cache
 *
 * No fake timers — the TTL cases use short real sleeps. Each case builds a
 * fresh cache instance (clear() is deliberately absent, CODE-REVIEW finding 18).
 */

import { LRUCache } from '../src/utils/cache.js';
import { check, finish } from './test-utils.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A promise whose resolve/reject are exposed, so a loader can be held open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// 1. LRU / TTL basics
// ---------------------------------------------------------------------------

console.log('1. LRU / TTL basics');

{
  const cache = new LRUCache<string>(10, 60000);
  check(cache.get('nope') === undefined, 'miss → undefined');
  cache.set('a', 'A');
  check(cache.get('a') === 'A', 'hit returns the stored value');
}

{
  const cache = new LRUCache<string>(10, 30);
  cache.set('a', 'A');
  check(cache.get('a') === 'A', 'ttl 30ms: fresh entry is a hit');
  await sleep(50);
  check(cache.get('a') === undefined, 'ttl 30ms: expired after 50ms sleep');
}

{
  // Size-2 cache: insert a, b; refresh a's recency; insert c → b is evicted.
  const cache = new LRUCache<string>(2, 60000);
  cache.set('a', 'A');
  cache.set('b', 'B');
  check(cache.get('a') === 'A', 'eviction: get(a) refreshes recency');
  cache.set('c', 'C');
  check(cache.get('b') === undefined, 'eviction: least-recently-used b evicted');
  check(cache.get('a') === 'A', 'eviction: refreshed a survives');
  check(cache.get('c') === 'C', 'eviction: newest c present');
}

{
  // Replacing an existing key must not evict anything else.
  const cache = new LRUCache<string>(2, 60000);
  cache.set('a', 'A');
  cache.set('b', 'B');
  cache.set('a', 'A2');
  check(cache.get('a') === 'A2', 'set on existing key replaces the value');
  check(cache.get('b') === 'B', 'set on existing key evicts nothing');
}

// ---------------------------------------------------------------------------
// 2. getOrFetch: concurrent misses share one load
// ---------------------------------------------------------------------------

console.log('2. getOrFetch dedup');

{
  const cache = new LRUCache<string>(10, 60000);
  const gate = deferred<string>();
  let calls = 0;
  const loader = () => {
    calls++;
    return gate.promise;
  };

  const p1 = cache.getOrFetch('k', loader);
  const p2 = cache.getOrFetch('k', loader);
  const p3 = cache.getOrFetch('k', loader);
  check(calls === 1, 'three concurrent misses invoke the loader exactly once');

  gate.resolve('V');
  const [v1, v2, v3] = await Promise.all([p1, p2, p3]);
  check(v1 === 'V' && v2 === 'V' && v3 === 'V', 'all three joiners resolve to the same value');

  const v4 = await cache.getOrFetch('k', loader);
  check(v4 === 'V', 'a later call is served from cache');
  check(calls === 1, 'the later call did not re-invoke the loader');
}

{
  const cache = new LRUCache<string>(10, 60000);
  let calls = 0;
  const gate = deferred<string>();
  const loader = () => {
    calls++;
    return gate.promise;
  };
  const pa = cache.getOrFetch('a', loader);
  const pb = cache.getOrFetch('b', loader);
  check(calls === 2, 'distinct keys do not share an in-flight load');
  gate.resolve('V');
  await Promise.all([pa, pb]);
}

// ---------------------------------------------------------------------------
// 3. Falsy cached values are hits (finding 13)
// ---------------------------------------------------------------------------

console.log('3. falsy values');

{
  const cache = new LRUCache<unknown>(10, 60000);
  let calls = 0;
  const loader = async () => {
    calls++;
    return 0;
  };
  const first = await cache.getOrFetch('zero', loader);
  check(first === 0, 'loader value 0 is returned');
  const second = await cache.getOrFetch('zero', loader);
  check(second === 0, 'cached 0 is returned again');
  check(calls === 1, 'cached 0 is a hit, not a miss (loader not re-invoked)');
}

// ---------------------------------------------------------------------------
// 4. Errors are not cached; the in-flight slot is cleared on settle
// ---------------------------------------------------------------------------

console.log('4. rejection handling');

{
  const cache = new LRUCache<string>(10, 60000);
  let calls = 0;
  const gate = deferred<string>();
  const failing = () => {
    calls++;
    return gate.promise;
  };

  const p1 = cache.getOrFetch('k', failing);
  const p2 = cache.getOrFetch('k', failing);
  check(calls === 1, 'concurrent joiners share the failing load too');

  gate.reject(new Error('boom'));
  const results = await Promise.allSettled([p1, p2]);
  check(
    results.every((r) => r.status === 'rejected' && (r.reason as Error).message === 'boom'),
    'every awaiting caller sees the rejection',
  );

  check(cache.get('k') === undefined, 'a failed load caches nothing');

  const retry = await cache.getOrFetch('k', async () => {
    calls++;
    return 'OK';
  });
  check(retry === 'OK', 'a subsequent call re-loads and can succeed');
  check(calls === 2, 'the in-flight slot was cleared on rejection (loader re-invoked)');
  check(cache.get('k') === 'OK', 'the successful retry is cached');
}

{
  // Resolve-side slot clearing, observed through TTL expiry: once the entry
  // expires the next call must re-invoke rather than join a stale slot.
  const cache = new LRUCache<string>(10, 30);
  let calls = 0;
  const loader = async () => {
    calls++;
    return `v${calls}`;
  };
  check((await cache.getOrFetch('k', loader)) === 'v1', 'first load resolves');
  await sleep(50);
  check((await cache.getOrFetch('k', loader)) === 'v2', 'after TTL expiry the loader runs again');
  check(calls === 2, 'the in-flight slot was cleared on resolve');
}

finish('Cache unit tests');
