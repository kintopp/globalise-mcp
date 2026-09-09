/**
 * Shared pass/fail accounting for the plain-Node test scripts
 * (smoke-test, test-archival-index, test-viewer-build).
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
