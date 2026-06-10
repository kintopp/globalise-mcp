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

/** Print the suite verdict and exit non-zero if any check failed. */
export function finish(suiteName: string): void {
  if (failures > 0) {
    console.error(`\n${suiteName} FAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log(`\n${suiteName} passed.`);
}
