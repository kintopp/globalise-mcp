/**
 * Shared pass/fail accounting and stubs for the plain-Node test scripts.
 */

let failures = 0;

export function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ok: ${label}`);
  } else {
    failures++;
    console.error(`  FAIL: ${label}`);
  }
}

/** Assert `pred` holds for every item; an empty list fails, since `[].every()` is vacuously true. */
export function checkEvery<T>(items: readonly T[], pred: (item: T) => boolean, label: string): void {
  check(items.length > 0 && items.every(pred), items.length === 0 ? `${label} (no items)` : label);
}

/**
 * Run `fn` with `globalThis.fetch` replaced by `respond` (given the 0-based call
 * index; throwing simulates a network failure), then restore the real fetch.
 */
export async function withStubbedFetch<T>(
  respond: (call: number) => Response,
  fn: () => Promise<T>,
): Promise<{ calls: number; value?: T; error?: unknown }> {
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => respond(calls++)) as typeof fetch;
  try {
    const value = await fn();
    return { calls, value };
  } catch (error) {
    return { calls, error };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Assert that `fn` throws a ToolError-shaped error (message + suggestion). */
export function throwsToolError(fn: () => unknown, label: string): void {
  try {
    fn();
    check(false, `${label} (no error thrown)`);
  } catch (e) {
    const err = e as { name?: string; suggestion?: unknown };
    check(err?.name === 'ToolError' && typeof err.suggestion === 'string', label);
  }
}

/** Print the suite verdict and exit non-zero if any check failed. */
export function finish(suiteName: string): void {
  if (failures > 0) {
    console.error(`\n${suiteName} FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log(`\n${suiteName} passed.`);
}
