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

import { API_CONFIG, apiGet, ErrorType, type ApiError } from '../src/utils/api-client.js';
import { check, finish, withStubbedFetch } from './test-utils.js';

// The backoff base is read per call; shrink it so the suite does not sleep
// through real 1s steps. Section 3 relies on it staying well under 1s.
API_CONFIG.RETRY_BASE_DELAY_MS = 50;

const URL_ = 'https://gloccoli.example/projects/globalise/urn:globalise:NL-HaNA_1.04.02_9966_0106';

const rateLimited = (retryAfter: string) => () =>
  new Response('{}', { status: 429, headers: { 'Retry-After': retryAfter } });
const ok = () => Response.json({ ok: true });

/** Run apiGet against a scripted sequence of responses; report calls, time and outcome. */
async function run(responses: Array<() => Response>) {
  const t0 = Date.now();
  const r = await withStubbedFetch((i) => {
    if (!responses[i]) throw new Error('more requests than scripted');
    return responses[i]();
  }, () => apiGet<{ ok: boolean }>(URL_));
  return { ...r, ms: Date.now() - t0, error: r.error as ApiError | undefined };
}

console.log('1. Retry-After over the ceiling fails fast (delta-seconds)');
{
  const r = await run([rateLimited('300'), ok]);
  check(r.calls === 1, `not retried (got ${r.calls} calls)`);
  check(r.ms < 1000, `fails fast (${r.ms}ms)`);
  check(r.error?.type === ErrorType.RATE_LIMIT, `rate-limit error (got ${r.error?.type})`);
  check(r.error?.retryAfterMs === 300_000, `carries the server's wait (got ${r.error?.retryAfterMs})`);
  check(/300 seconds/.test(r.error?.suggestion ?? ''), `suggestion names the wait (got: ${r.error?.suggestion})`);
}

console.log('2. Retry-After over the ceiling fails fast (HTTP-date)');
{
  const r = await run([rateLimited(new Date(Date.now() + 600_000).toUTCString()), ok]);
  check(r.calls === 1 && r.error?.type === ErrorType.RATE_LIMIT, `not retried (got ${r.calls} calls, ${r.error?.type})`);
  const wait = r.error?.retryAfterMs ?? 0;
  check(wait > 590_000 && wait <= 600_000, `HTTP-date read as ~600s (got ${wait})`);
}

console.log('3. Retry-After under the ceiling is honoured');
{
  // The first backoff step is 50ms, so a ~1s wait proves the header won.
  const r = await run([rateLimited('1'), ok]);
  check(r.calls === 2 && r.value?.ok === true, `retried once and succeeded (got ${r.calls} calls)`);
  check(r.ms >= 900, `waited the server's 1s, not the 50ms backoff (${r.ms}ms)`);
}

console.log('4. a past or unparseable Retry-After falls back to backoff');
for (const header of [new Date(Date.now() - 60_000).toUTCString(), 'soon']) {
  const r = await run([rateLimited(header), ok]);
  check(r.calls === 2 && r.value?.ok === true, `"${header}": retried once and succeeded (got ${r.calls} calls)`);
  check(r.ms >= 45 && r.ms < 900, `"${header}": first backoff step of ~50ms (${r.ms}ms)`);
}

console.log('5. a 404 is not retried');
{
  const r = await run([() => new Response('', { status: 404 }), ok]);
  check(r.calls === 1 && r.error?.type === ErrorType.NOT_FOUND, `one call, NOT_FOUND (got ${r.calls}, ${r.error?.type})`);
}

finish('API-client tests');
