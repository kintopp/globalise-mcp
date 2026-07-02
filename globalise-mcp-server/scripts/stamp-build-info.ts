/**
 * Bake build-time provenance into dist/ so the deployed server can report its
 * exact commit and release version at /health without a live git checkout.
 *
 * Writes (best-effort — a missing file just means the runtime resolver in
 * src/utils/build-info.ts falls back to live git, then package.json):
 *   dist/commit.txt  — short HEAD SHA        (git rev-parse / RAILWAY_GIT_COMMIT_SHA)
 *   dist/version.txt — nearest `v*` tag      (git describe --abbrev=0), i.e. the release
 *
 * Runs at the tail of `npm run build`, after `tsc` has produced dist/. On
 * Railway, RAILWAY_GIT_COMMIT_SHA covers the commit even when git is absent; the
 * tag has no such env var, so version.txt is only written when the build
 * checkout actually carries tags (otherwise /health reports package.json version).
 *
 * Usage: npm run build   (or standalone: npx tsx scripts/stamp-build-info.ts)
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

if (!fs.existsSync(DIST_DIR)) {
  // tsc hasn't produced dist/ yet (e.g. run standalone before a build); nothing
  // to stamp — the runtime resolver falls back to live git / package.json.
  console.error('[stamp] dist/ not found — skipping (run after tsc)');
  process.exit(0);
}

const commit = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) || git('rev-parse --short HEAD');
const version = git("describe --tags --abbrev=0 --match 'v*'");

if (commit) {
  fs.writeFileSync(join(DIST_DIR, 'commit.txt'), `${commit}\n`);
  console.error(`[stamp] commit ${commit}`);
} else {
  console.error('[stamp] no commit resolved (no git checkout, no RAILWAY_GIT_COMMIT_SHA)');
}

if (version) {
  fs.writeFileSync(join(DIST_DIR, 'version.txt'), `${version}\n`);
  console.error(`[stamp] version ${version}`);
} else {
  console.error('[stamp] no v* tag found — /health will report package.json version');
}
