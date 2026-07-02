/**
 * Build/deploy provenance for /health and the MCP `version` field.
 *
 * The displayed version is derived from the **git tag of a published GitHub
 * release** (e.g. tag `v1.2.0` → `1.2.0`), not from a hand-bumped package.json —
 * globalise retired that ritual ("history = commits + tags now"). Since a
 * deployed container has no live git checkout, the tag and commit are baked
 * into `dist/` at build time by scripts/stamp-build-info.ts; the resolvers here
 * read those stamps first and fall back to live git (local dev) then
 * package.json, so the same code path works in prod, `railway up`, the built
 * `dist/`, and `tsx` dev.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Read a build-stamped sibling file (dist/version.txt, dist/commit.txt); null if absent/empty. */
function readStamp(moduleDir: string, file: string): string | null {
  try {
    const value = fs.readFileSync(path.join(moduleDir, file), 'utf-8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** Run a git command quietly; '' if git or the repo is unavailable (deployed container, tarball install). */
function git(args: string): string {
  try {
    return execSync(`git ${args}`, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/**
 * Resolve the display version. Precedence:
 *   1. dist/version.txt — baked from the nearest `v*` tag at build (the deployed truth)
 *   2. `git describe` on the nearest `v*` tag — local dev before/without a build
 *   3. package.json version — final fallback (frozen relic; the commit is reported separately)
 * The leading `v` is stripped so tag `v1.2.0` displays as `1.2.0`, matching the sibling servers.
 *
 * @param moduleDir the importing module's __dirname (dist/ when built, src/ under tsx)
 */
export function resolveVersion(moduleDir: string): string {
  const baked = readStamp(moduleDir, 'version.txt');
  if (baked) return baked.replace(/^v/, '');

  // --abbrev=0 gives the bare nearest tag (no `-N-gSHA` distance suffix); errors
  // out with no tags, which the git() wrapper turns into '' → fall through.
  const described = git("describe --tags --abbrev=0 --match 'v*'");
  if (described) return described.replace(/^v/, '');

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(moduleDir, '..', 'package.json'), 'utf-8')) as {
      version?: string;
    };
    if (pkg.version) return pkg.version;
  } catch {
    /* no package.json reachable */
  }
  return 'unknown';
}

/**
 * Resolve the deployed commit (short SHA). Precedence mirrors rijksmuseum-mcp-plus:
 *   1. RAILWAY_GIT_COMMIT_SHA — set on Railway webhook deploys
 *   2. dist/commit.txt — baked at build (`railway up` / CLI deploys, where the env var is absent)
 *   3. `git rev-parse` — local dev
 *   4. 'unknown'
 *
 * @param moduleDir the importing module's __dirname (dist/ when built, src/ under tsx)
 */
export function resolveCommit(moduleDir: string): string {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) {
    return process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7);
  }
  const baked = readStamp(moduleDir, 'commit.txt');
  if (baked) return baked;

  return git('rev-parse --short HEAD') || 'unknown';
}
