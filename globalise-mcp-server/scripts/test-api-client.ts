/**
 * Unit tests for api-client pure functions:
 *   parseRetryAfter, retryAfterExceedsCeiling, calculateRetryDelay
 *
 * Run with: npm run test:api-client
 */

import {
  parseRetryAfter,
  retryAfterExceedsCeiling,
  calculateRetryDelay,
  API_CONFIG,
} from '../src/utils/api-client.js';
import type { ApiError } from '../src/utils/api-client.js';
import { check, finish } from './test-utils.js';

// ---------------------------------------------------------------------------
// 1. parseRetryAfter
// ---------------------------------------------------------------------------

console.log('1. parseRetryAfter');

{
  const res5 = { headers: { get: () => '5' } } as unknown as Response;
  check(parseRetryAfter(res5) === 5000, "header '5' → 5000");
}

{
  const res0 = { headers: { get: () => '0' } } as unknown as Response;
  check(parseRetryAfter(res0) === 0, "header '0' → 0");
}

{
  const resAbsent = { headers: { get: () => null } } as unknown as Response;
  check(parseRetryAfter(resAbsent) === undefined, 'absent header → undefined');
}

{
  const resGarbage = { headers: { get: () => 'not-a-date-or-number' } } as unknown as Response;
  check(parseRetryAfter(resGarbage) === undefined, 'garbage string → undefined');
}

// ---------------------------------------------------------------------------
// 2. retryAfterExceedsCeiling
// ---------------------------------------------------------------------------

console.log('2. retryAfterExceedsCeiling');

{
  const huge = { retryAfterMs: 999_999_999 } as ApiError;
  check(retryAfterExceedsCeiling(huge) === true, 'huge retryAfterMs (999_999_999) → true');
}

{
  const over = { retryAfterMs: 300_000 } as ApiError;  // Retry-After: 300
  check(retryAfterExceedsCeiling(over) === true, 'retryAfterMs 300000 > ceiling → true');
}

{
  const small = { retryAfterMs: 2000 } as ApiError;
  check(retryAfterExceedsCeiling(small) === false, 'retryAfterMs 2000 ≤ ceiling → false');
}

{
  const none = {} as ApiError;
  check(retryAfterExceedsCeiling(none) === false, 'no retryAfterMs → false');
}

{
  check(retryAfterExceedsCeiling(undefined) === false, 'undefined error → false');
}

// ---------------------------------------------------------------------------
// 3. calculateRetryDelay
// ---------------------------------------------------------------------------

console.log('3. calculateRetryDelay');

// Retry-After branch: returned verbatim, NOT clamped
{
  const err2000 = { retryAfterMs: 2000 } as ApiError;
  check(calculateRetryDelay(0, err2000) === 2000, 'Retry-After 2000 returned verbatim');
}

{
  const errHuge = { retryAfterMs: 999_999_999 } as ApiError;
  check(
    calculateRetryDelay(0, errHuge) === 999_999_999,
    'Retry-After 999_999_999 returned verbatim (not clamped by calculateRetryDelay)',
  );
}

// Exponential backoff branch: clamped
{
  check(calculateRetryDelay(0) === 1000, 'attempt 0 → 1000 (base)');
}

{
  check(calculateRetryDelay(2) === 4000, 'attempt 2 → 4000 (1000 * 2^2)');
}

{
  const result = calculateRetryDelay(20);
  check(
    result === API_CONFIG.RETRY_MAX_DELAY_MS,
    `attempt 20 → ${API_CONFIG.RETRY_MAX_DELAY_MS} (clamped to RETRY_MAX_DELAY_MS, got ${result})`,
  );
}

finish('API-client unit tests');
