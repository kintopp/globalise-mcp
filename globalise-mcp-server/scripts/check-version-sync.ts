/**
 * Version-sync check: the version-bump ritual (CLAUDE.md "Version
 * Management") spans four files that must agree. This has silently drifted
 * before (package-lock.json sat at 2.4.0 through v2.5.3), so npm test now
 * enforces it.
 *
 * Run with: npm run test:version
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish } from './test-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'));
const lock = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package-lock.json'), 'utf-8'));
const claudeMd = fs.readFileSync(path.join(pkgRoot, '..', 'CLAUDE.md'), 'utf-8');
const changelog = fs.readFileSync(path.join(pkgRoot, 'CHANGELOG.md'), 'utf-8');

const claudeVersion = claudeMd.match(/^### Current Version: (\d+\.\d+\.\d+)/m)?.[1];
const changelogVersion = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1];

console.log(`package.json: ${pkg.version}`);
check(typeof pkg.version === 'string', 'package.json has a version');
check(lock.version === pkg.version, `package-lock.json root version matches (got: ${lock.version})`);
check(lock.packages?.['']?.version === pkg.version, `package-lock.json packages[""] version matches (got: ${lock.packages?.['']?.version})`);
check(claudeVersion === pkg.version, `CLAUDE.md Current Version matches (got: ${claudeVersion})`);
check(changelogVersion === pkg.version, `CHANGELOG.md newest entry matches (got: ${changelogVersion})`);

finish('Version sync');
