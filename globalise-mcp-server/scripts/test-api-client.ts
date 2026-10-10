/**
 * Retry behaviour of the API client, driven through apiGet with a stubbed
 * fetch returning real Response objects. Failure modes pinned:
 *   - a Retry-After over the ceiling must fail fast with the rate-limit error,
 *     not sleep for minutes or retry earlier than the server allowed
 *   - a Retry-After under the ceiling must be honoured, not replaced by backoff
 *   - both header forms (delta-seconds, HTTP-date) must be read, under the
 *     header's real name
 *   - a past or unparseable Retry-After falls back to exponential backoff
 *   - a 404 is not retried
 *
 * Run with: npm run test:api-client
 */

import { apiGet, ErrorType, type ApiError } from '../src/utils/api-client.js';
import { check, finish } from './test-utils.js';

const URL_ = 'https://gloccoli.example/projects/globalise/urn:globalise:NL-HaNA_1.04.02_9966_0106';

const rateLimited = (retryAfter: string) => () =>
  new Response('{}', { status: 429, headers: { 'Retry-After': retryAfter } });
const ok = () => () => Response.json({ ok: true });

/** Run apiGet against a scripted sequence of responses; report calls, time and outcome. */
async function run(responses: Array<() => Response>) {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    const next = responses[calls++];
    if (!next) throw new Error('more requests than scripted');
    return next();
  }) as typeof fetch;
  const t0 = Date.now();
  try {
    const value = await apiGet<{ ok: boolean }>(URL_);
    return { calls, ms: Date.now() - t0, value, error: undefined as ApiError | undefined };
  } catch (e) {
    return { calls, ms: Date.now() - t0, value: undefined, error: e as ApiError };
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log('1. Retry-After over the ceiling fails fast (delta-seconds)');
{
  const r = await run([rateLimited('300'), ok()]);
  check(r.calls === 1, `not retried (got ${r.calls} calls)`);
  check(r.ms < 1000, `fails fast (${r.ms}ms)`);
  check(r.error?.type === ErrorType.RATE_LIMIT, `rate-limit error (got ${r.error?.type})`);
  check(r.error?.retryAfterMs === 300_000, `carries the server's wait (got ${r.error?.retryAfterMs})`);
  check(/300 seconds/.test(r.error?.suggestion ?? ''), `suggestion names the wait (got: ${r.error?.suggestion})`);
}

console.log('2. Retry-After over the ceiling fails fast (HTTP-date)');
{
  const r = await run([rateLimited(new Date(Date.now() + 600_000).toUTCString()), ok()]);
  check(r.calls === 1 && r.error?.type === ErrorType.RATE_LIMIT, `not retried (got ${r.calls} calls, ${r.error?.type})`);
  const wait = r.error?.retryAfterMs ?? 0;
  check(wait > 590_000 && wait <= 600_000, `HTTP-date read as ~600s (got ${wait})`);
}

console.log('3. Retry-After under the ceiling is honoured');
{
  // The first backoff step is 1s, so a 2s wait proves the header won.
  const r = await run([rateLimited('2'), ok()]);
  check(r.calls === 2 && r.value?.ok === true, `retried once and succeeded (got ${r.calls} calls)`);
  check(r.ms >= 1900, `waited the server's 2s, not the 1s backoff (${r.ms}ms)`);
}

console.log('4. a past or unparseable Retry-After falls back to backoff');
for (const header of [new Date(Date.now() - 60_000).toUTCString(), 'soon']) {
  const r = await run([rateLimited(header), ok()]);
  check(r.calls === 2 && r.value?.ok === true, `"${header}": retried once and succeeded (got ${r.calls} calls)`);
  check(r.ms >= 900 && r.ms < 1900, `"${header}": first backoff step of ~1s (${r.ms}ms)`);
}

console.log('5. a 404 is not retried');
{
  const r = await run([() => new Response('', { status: 404 }), ok()]);
  check(r.calls === 1 && r.error?.type === ErrorType.NOT_FOUND, `one call, NOT_FOUND (got ${r.calls}, ${r.error?.type})`);
}

finish('API-client tests');
