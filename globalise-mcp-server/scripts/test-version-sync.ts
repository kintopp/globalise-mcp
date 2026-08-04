/**
 * Version source-of-truth guard (family parity: ub-sgbr test/version.test.js).
 *
 * This repo is TAGS-PRIMARY by decision (src/utils/build-info.ts: the displayed
 * version is the git tag of a published release; the hand-bumped package.json
 * ritual is retired — "history = commits + tags now"). package.json survives
 * only as the last-resort fallback when no tag reaches the build. That decision
 * has one enforceable invariant, which this script guards:
 *
 *   package.json `version` must NEVER be AHEAD of the newest `v*` tag.
 *
 * A package.json above every published tag means the retired hand-bump ritual
 * crept back in: /health would advertise a release that was never tagged. The
 * reverse (tag ahead of package.json) is legal under tags-primary — the
 * fallback is then merely stale, so it's reported as a warning with the
 * one-line fix (`npm version X.Y.Z --no-git-tag-version` folded into the
 * release), not a failure.
 *
 * manifest.json is deliberately NOT checked: its
 * version is stamped from package.json at pack time (scripts/build-mcpb.ts),
 * so the committed values are cosmetic and carry no sync obligation.
 *
 * Offline, no network. Run with: npm run test:version-sync
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish } from './test-utils.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(fs.readFileSync(join(ROOT, 'package.json'), 'utf-8')) as { version?: string };
const pkgVersion = pkg.version ?? '';

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
check(SEMVER_RE.test(pkgVersion), `package.json version is plain X.Y.Z semver (got: ${pkgVersion})`);

/** Compare two X.Y.Z strings: negative when a < b, 0 when equal, positive when a > b. */
function compareSemver(a: string, b: string): number {
  const pa = a.match(SEMVER_RE)!.slice(1).map(Number);
  const pb = b.match(SEMVER_RE)!.slice(1).map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

let newestTag = '';
try {
  newestTag = execSync("git tag -l 'v*' --sort=-version:refname", {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\n')[0]
    .trim();
} catch {
  // No git (e.g. an exported tree): nothing to compare against.
}

if (!newestTag) {
  console.log('  (no v* tag yet — pre-first-release state; the ahead-of-tag guard arms at the first release)');
} else {
  const tagVersion = newestTag.replace(/^v/, '');
  check(
    SEMVER_RE.test(tagVersion),
    `newest tag is plain vX.Y.Z (got: ${newestTag})`,
  );
  if (SEMVER_RE.test(tagVersion)) {
    check(
      compareSemver(pkgVersion, tagVersion) <= 0,
      `package.json (${pkgVersion}) is not ahead of the newest release tag (${newestTag}) — tags are primary; do not hand-bump package.json past a release`,
    );
    if (compareSemver(pkgVersion, tagVersion) < 0) {
      console.log(
        `  note: package.json (${pkgVersion}) lags ${newestTag} — legal, but the fallback shown when a build sees no tags is stale.` +
        ` Fold \`npm version ${tagVersion} --no-git-tag-version\` into the release to refresh it.`,
      );
    }
  }
}

finish('Version sync');
