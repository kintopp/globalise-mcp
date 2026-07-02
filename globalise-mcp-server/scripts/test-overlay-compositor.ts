/**
 * Unit tests for the SVG overlay compositor (plan 021,
 * src/utils/overlay-compositor.ts). Pure projection/label cases plus a real
 * sharp composite round-trip — no network, no DB.
 *
 * Run with: npm run test:overlay-compositor
 */

import sharp from 'sharp';
import {
  computeCropRect,
  projectOverlayToCrop,
  truncateLabel,
  escapeXml,
  compositeOverlays,
} from '../src/utils/overlay-compositor.js';
import { check, finish } from './test-utils.js';

const W = 5892;
const H = 4167;

// ---------------------------------------------------------------------------
// 1. computeCropRect (full / square / pct / px)
// ---------------------------------------------------------------------------

console.log('1. computeCropRect');

{
  const full = computeCropRect('full', W, H);
  check(!!full && full.x === 0 && full.y === 0 && full.w === W && full.h === H, 'full → whole image rect');
}
{
  const sq = computeCropRect('square', W, H);
  const side = Math.min(W, H); // 4167
  check(!!sq && sq.w === side && sq.h === side, `square → side=${side}`);
  check(!!sq && sq.x === Math.floor((W - side) / 2) && sq.y === 0, 'square → centred horizontally');
}
{
  const pct = computeCropRect('pct:25,25,10,10', W, H);
  check(!!pct && Math.round(pct.x) === Math.round(0.25 * W) && Math.round(pct.w) === Math.round(0.1 * W), 'pct → scaled rect');
}
{
  const px = computeCropRect('1473,1041,589,416', W, H);
  check(!!px && px.x === 1473 && px.y === 1041 && px.w === 589 && px.h === 416, 'plain px → literal rect');
  check(computeCropRect('not-a-region', W, H) === null, 'unparseable → null');
}

// ---------------------------------------------------------------------------
// 2. projectOverlayToCrop (inside / partially-clipped kept / fully-outside null)
// ---------------------------------------------------------------------------

console.log('2. projectOverlayToCrop');

// Frame: the crop is the top-left quarter of the full image, rendered at 100x100.
const frame = { rect: { x: 0, y: 0, w: W / 2, h: H / 2 }, imageWidth: W, imageHeight: H };
const CROP_PX = 100;

{
  // Overlay fully inside the crop (pct:10,10,10,10 of full image = well within the top-left quarter).
  const local = projectOverlayToCrop('pct:10,10,10,10', frame, CROP_PX, CROP_PX);
  check(!!local && local.x > 0 && local.y > 0 && local.x < CROP_PX && local.y < CROP_PX, 'inside overlay projected within crop');
}
{
  // Overlay straddling the crop's right edge (starts at 45% of full = 90% of crop, width spills past).
  const local = projectOverlayToCrop('pct:45,10,20,10', frame, CROP_PX, CROP_PX);
  check(!!local, 'partially-clipped overlay is kept (SVG viewBox clips it)');
}
{
  // Overlay entirely in the bottom-right quarter — fully outside the top-left crop.
  const local = projectOverlayToCrop('pct:60,60,10,10', frame, CROP_PX, CROP_PX);
  check(local === null, 'fully-outside overlay → null');
}
{
  check(projectOverlayToCrop('pct:0,0,0,0', frame, CROP_PX, CROP_PX) === null, 'zero-area overlay → null');
}

// ---------------------------------------------------------------------------
// 3. truncateLabel (32-char boundary + ellipsis)
// ---------------------------------------------------------------------------

console.log('3. truncateLabel');

{
  const exactly32 = 'a'.repeat(32);
  check(truncateLabel(exactly32) === exactly32, '32-char label passes through unchanged');
  const long = 'a'.repeat(40);
  const t = truncateLabel(long);
  check(t.length === 32 && t.endsWith('…'), 'longer label truncated to 32 chars with ellipsis');
}

// ---------------------------------------------------------------------------
// 4. escapeXml (all five chars)
// ---------------------------------------------------------------------------

console.log('4. escapeXml');

{
  check(escapeXml('<') === '&lt;', 'escapes <');
  check(escapeXml('>') === '&gt;', 'escapes >');
  check(escapeXml('&') === '&amp;', 'escapes &');
  check(escapeXml('"') === '&quot;', 'escapes "');
  check(escapeXml("'") === '&apos;', "escapes '");
  check(escapeXml('a<b>&"\'c') === 'a&lt;b&gt;&amp;&quot;&apos;c', 'escapes a mixed string');
}

// ---------------------------------------------------------------------------
// 5. compositeOverlays — real sharp round-trip
// ---------------------------------------------------------------------------

console.log('5. compositeOverlays (sharp round-trip)');

const cropFrame = { rect: { x: 0, y: 0, w: 200, h: 160 }, imageWidth: 200, imageHeight: 160 };

{
  const jpeg = await sharp({ create: { width: 200, height: 160, channels: 3, background: '#888' } }).jpeg().toBuffer();
  const result = await compositeOverlays(jpeg, [{ region: 'pct:25,25,50,50', label: 'test' }], cropFrame);
  check(result.rendered === 1, `one overlay rendered (got: ${result.rendered})`);
  check(result.skipped === 0, `none skipped (got: ${result.skipped})`);
  check(result.width === 200 && result.height === 160, `dims preserved 200x160 (got: ${result.width}x${result.height})`);
  check(!result.buffer.equals(jpeg), 'composited buffer differs from the input');
}
{
  const jpeg = await sharp({ create: { width: 200, height: 160, channels: 3, background: '#888' } }).jpeg().toBuffer();
  const result = await compositeOverlays(jpeg, [], cropFrame);
  check(result.rendered === 0, 'empty overlays → rendered 0');
  check(result.buffer.equals(jpeg), 'empty overlays → buffer passes through byte-identical');
}

finish('Overlay compositor tests');
