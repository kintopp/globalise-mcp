/**
 * Viewer build check (R16, guarding R11): the built single-file viewer must
 * exist and carry no runtime CDN dependencies — a missing or blocked CDN
 * import fails silently as a blank iframe, so this is the only place the
 * regression is visible before production.
 *
 * Run with: npm run test:viewer-build (requires a prior npm run build:ui)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, finish } from './test-utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, '..', 'dist', 'apps', 'index.html');

const htmlExists = fs.existsSync(htmlPath);
check(htmlExists, 'dist/apps/index.html exists (run npm run build:ui first)');

if (htmlExists) {
  const html = fs.readFileSync(htmlPath, 'utf-8');
  check(!html.includes('unpkg.com'), 'no unpkg.com references (ext-apps SDK is bundled)');
  check(!html.includes('cdn.jsdelivr.net'), 'no cdn.jsdelivr.net references (OpenSeadragon is bundled)');
  check(html.includes('OpenSeadragon'), 'OpenSeadragon is inlined');
  check(html.length > 400_000, `bundle is self-contained (${html.length} bytes — a CDN-importing build is far smaller)`);
}

finish('Viewer build check');
