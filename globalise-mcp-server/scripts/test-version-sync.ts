/**
 * Version source-of-truth guard (family parity: ub-sgbr test/version.test.js).
 *
 * A release is a `v*` tag, but Railway's build checkout carries no tags, so
 * production /health always reports package.json's version (the last step of
 * resolveVersion in src/utils/build-info.ts). The two must therefore agree:
 *
 *   package.json `version` must EQUAL the newest `v*` tag.
 *
 * Ahead: /health would advertise a release that was never tagged.
 * Behind: a tagged release would deploy still reporting the previous version.
 * Release order: bump package.json + skill, commit, tag, then run this.
 *
 * The skill frontmatter (skills/globalise-voc-research/SKILL.md `version:`) is
 * the one hand-maintained copy: claude.ai shows it as the installed skill's
 * version, and nothing stamps it, so it must equal package.json exactly.
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
let hasGit = true;
try {
  newestTag = execSync("git tag -l 'v*' --sort=-version:refname", {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split('\n')[0]
    .trim();
} catch {
  hasGit = false;
}

if (!hasGit) {
  console.log('  (no git checkout, e.g. an exported tree: tag-equality guard skipped)');
} else if (!newestTag) {
  // Releases exist since v0.9.0, so a tagless checkout means tags were not
  // fetched (actions/checkout needs fetch-depth: 0), not "no release yet".
  check(false, 'v* tags visible in this checkout — fetch them (git fetch --tags; in CI, actions/checkout fetch-depth: 0)');
} else {
  const tagVersion = newestTag.replace(/^v/, '');
  check(
    SEMVER_RE.test(tagVersion),
    `newest tag is plain vX.Y.Z (got: ${newestTag})`,
  );
  if (SEMVER_RE.test(tagVersion)) {
    check(
      compareSemver(pkgVersion, tagVersion) <= 0,
      `package.json (${pkgVersion}) <= newest release tag (${newestTag}) — else /health advertises an untagged release: tag it, or revert the bump`,
    );
    check(
      compareSemver(pkgVersion, tagVersion) >= 0,
      `package.json (${pkgVersion}) >= newest release tag (${newestTag}) — else production reports the old version:` +
        ` run \`npm version ${tagVersion} --no-git-tag-version\` and bump the skill frontmatter`,
    );
  }
}

const skillPath = join(ROOT, 'skills', 'globalise-voc-research', 'SKILL.md');
const skillMatch = fs.readFileSync(skillPath, 'utf-8').match(/^version:\s*(\S+)\s*$/m);
check(!!skillMatch, 'skills/globalise-voc-research/SKILL.md declares `version:` in its frontmatter');
if (skillMatch) {
  check(
    skillMatch[1] === pkgVersion,
    `skill frontmatter version (${skillMatch[1]}) matches package.json (${pkgVersion}) — bump both at release and repack the .skill`,
  );
}

finish('Version sync');
