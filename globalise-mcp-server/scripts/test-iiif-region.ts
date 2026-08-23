/**
 * Unit tests for the IIIF helpers in src/utils/iiif.ts (plan 020). All pure
 * functions — no network, no committed DB.
 *
 * Run with: npm run test:iiif-region
 */

import {
  IIIF_REGION_RE,
  parsePctRegion,
  parseCropPixelsRegion,
  parsePixelRegion,
  parseAnyPixelRegion,
  cropPixelsToIiifPixels,
  checkRegionBounds,
  infoJsonUrlFromImageUrl,
  regionPixelDims,
  buildIiifRegionUrl,
} from '../src/utils/iiif.js';
import { VISION_FALLBACK_WIDTH } from '../src/utils/vision-sizing.js';
import { resolveDeliverySize } from '../src/tools/page-image.js';
import {
  projectToFullImage,
  computeDeliveryState,
  extractIiifImageUrl,
} from '../src/utils/iiif.js';
import type { DocumentResponse } from '../src/utils/types.js';
import { check, finish } from './test-utils.js';

// ---------------------------------------------------------------------------
// 1. IIIF_REGION_RE
// ---------------------------------------------------------------------------

console.log('1. IIIF_REGION_RE');

const acceptedRegions = [
  'full',
  'square',
  '1473,1041,589,416',
  'pct:31.2,18.4,22.0,6.1',
  'crop_pixels:1,2,3,4',
];
for (const region of acceptedRegions) {
  check(IIIF_REGION_RE.test(region), `accepts '${region}'`);
}

const rejectedRegions = ['pct:1,2,3', 'pct:a,b,c,d', '-5,0,10,10', ''];
for (const region of rejectedRegions) {
  check(!IIIF_REGION_RE.test(region), `rejects '${region}'`);
}

// ---------------------------------------------------------------------------
// 2. parsePctRegion / parseCropPixelsRegion / cropPixelsToIiifPixels
// ---------------------------------------------------------------------------

console.log('2. parsePctRegion / parseCropPixelsRegion / cropPixelsToIiifPixels');

{
  const p = parsePctRegion('pct:31.2,18.4,22.0,6.1');
  check(!!p && p[0] === 31.2 && p[1] === 18.4 && p[2] === 22.0 && p[3] === 6.1, 'parsePctRegion round-trips');
  check(parsePctRegion('full') === null, 'parsePctRegion(full) is null');
  check(parsePctRegion('1,2,3,4') === null, 'parsePctRegion(plain pixels) is null');
}

{
  const p = parseCropPixelsRegion('crop_pixels:1,2,3,4');
  check(!!p && p[0] === 1 && p[1] === 2 && p[2] === 3 && p[3] === 4, 'parseCropPixelsRegion round-trips');
  check(parseCropPixelsRegion('1,2,3,4') === null, 'parseCropPixelsRegion(plain pixels) is null');
  check(parseCropPixelsRegion('pct:1,2,3,4') === null, 'parseCropPixelsRegion(pct) is null');
}

{
  check(cropPixelsToIiifPixels('crop_pixels:1,2,3,4') === '1,2,3,4', 'cropPixelsToIiifPixels strips the prefix');
  check(cropPixelsToIiifPixels('1,2,3,4') === null, 'cropPixelsToIiifPixels(plain pixels) is null');
}

{
  // The bare x,y,w,h grammar has one parser, not a copy per caller — both
  // checkRegionBounds and regionPixelDims go through parseAnyPixelRegion.
  const p = parsePixelRegion('1,2,3,4');
  check(!!p && p[0] === 1 && p[3] === 4, 'parsePixelRegion round-trips');
  check(parsePixelRegion('crop_pixels:1,2,3,4') === null, 'parsePixelRegion(crop_pixels) is null');
  const a = parseAnyPixelRegion('crop_pixels:1,2,3,4');
  const b = parseAnyPixelRegion('1,2,3,4');
  check(!!a && !!b && a.join() === b.join(), 'parseAnyPixelRegion accepts both pixel forms identically');
  check(parseAnyPixelRegion('pct:1,2,3,4') === null, 'parseAnyPixelRegion(pct) is null');
}

// ---------------------------------------------------------------------------
// 3. checkRegionBounds
// ---------------------------------------------------------------------------

console.log('3. checkRegionBounds');

// full/square always in-bounds
check(checkRegionBounds('full') === null, 'full is always in-bounds');
check(checkRegionBounds('square', 100, 100) === null, 'square is always in-bounds');

// pct in-bounds
check(checkRegionBounds('pct:0,0,100,100') === null, 'pct:0,0,100,100 in-bounds');
check(checkRegionBounds('pct:0,0,100.005,100') === null, 'pct:0,0,100.005,100 within the 100.01 epsilon');

// pct violations
{
  const oob = checkRegionBounds('pct:95,95,10,10');
  check(oob !== null, 'pct:95,95,10,10 flagged out-of-bounds');
  check(oob?.clampedTo === 'pct:95,95,5,5', `pct:95,95,10,10 clamps to pct:95,95,5,5 (got: ${oob?.clampedTo})`);
  check(oob?.requested === 'pct:95,95,10,10', 'requested echoes the exact input');
}
{
  // NB: a literal negative x (e.g. "pct:-5,0,10,10") can never reach this
  // branch — parsePctRegion's [0-9.]+ capture (matching the rijksmuseum
  // source it ports) rejects the '-' sign at the IIIF_REGION_RE/parse layer
  // before checkRegionBounds ever sees it. x>100 exercises the same
  // "outside 0-100" issue branch via a reachable input instead.
  const oob = checkRegionBounds('pct:150,0,10,10');
  check(oob !== null, 'x > 100 flagged out-of-bounds');
  check(oob?.issue.includes('outside 0–100'), 'x > 100 issue mentions the valid range');
  check(oob?.clampedTo === 'pct:100,0,0,10', `x > 100 clamps to pct:100,0,0,10 (got: ${oob?.clampedTo})`);
}
{
  const oob = checkRegionBounds('pct:10,10,0,10');
  check(oob !== null, 'zero w flagged out-of-bounds');
  check(oob?.issue.includes('w=0 must be > 0'), 'zero w issue message');
}

// px with dims
{
  const oob = checkRegionBounds('5000,4000,2000,1000', 5892, 4167);
  check(oob !== null, 'px region exceeding native dims flagged out-of-bounds');
  check(oob?.clampedTo === '5000,4000,892,167', `px region clamps to 5000,4000,892,167 (got: ${oob?.clampedTo})`);
}

// px without dims — only w>0/h>0 checked
check(checkRegionBounds('0,0,10,10') === null, 'px region without native dims: no issue when w,h > 0');
{
  const oob = checkRegionBounds('0,0,0,10');
  check(oob !== null, 'px region without native dims: w=0 still flagged');
  check(oob?.validRange.includes('dimensions unknown'), 'validRange notes dimensions are unknown');
}

// ---------------------------------------------------------------------------
// 4. regionPixelDims
//
// Replaces the width-only computeEffectiveSize. The width half preserves that
// function's tested behaviour exactly; the height half is what the vision
// clamp needs and what the old code never computed.
// ---------------------------------------------------------------------------

console.log('4. regionPixelDims');

{
  // pct width keeps the 3px IIIF rounding margin: floor(5892*.10) - 3 = 586.
  // The height deliberately does NOT: floor(4167*.10) = 416. Leaving height
  // unfudged biases the derived aspect ratio tall, which is the safe
  // direction for maxInspectWidth's ceil().
  const d = regionPixelDims('pct:25,25,10,10', 5892, 4167);
  check(d?.width === 586, `pct region width is 586 (got: ${d?.width})`);
  check(d?.height === 416, `pct region height is 416, unfudged (got: ${d?.height})`);
}
{
  const d = regionPixelDims('1473,1041,589,416', 5892, 4167);
  check(d?.width === 589 && d?.height === 416, `px region reports its own extent (got: ${d?.width}x${d?.height})`);
}
{
  // Accepts unnormalized input, so a caller can't get the strip-then-measure
  // order wrong.
  const d = regionPixelDims('crop_pixels:1473,1041,589,416');
  check(d?.width === 589 && d?.height === 416, `crop_pixels: measured without native dims (got: ${d?.width}x${d?.height})`);
}
{
  const d = regionPixelDims('full', 5892, 4167);
  check(d?.width === 5892 && d?.height === 4167, `full is the whole image (got: ${d?.width}x${d?.height})`);
}
{
  const d = regionPixelDims('square', 5892, 4167);
  check(d?.width === 4167 && d?.height === 4167, `square is min(w,h) on both axes (got: ${d?.width}x${d?.height})`);
}
{
  check(regionPixelDims('pct:25,25,10,10') === null, 'pct without native dims is unknowable → null');
  check(regionPixelDims('full') === null, 'full without native dims is unknowable → null');
}

// ---------------------------------------------------------------------------
// 4b. resolveDeliverySize — the shipped composition of the two ceilings
// ---------------------------------------------------------------------------

console.log('4b. resolveDeliverySize');

{
  // A small crop is bounded by its own pixels, not by the vision budget —
  // the "upscaling not supported" branch.
  const r = resolveDeliverySize('1473,1041,589,416', 1988, 5892, 4167);
  check(r.size === 589, `a 589px-wide crop clamps to its own width (got: ${r.size})`);
  check(!!r.note?.includes('upscaling not supported'), `note names the upscale reason (got: ${r.note})`);
}
{
  // A full portrait leaf is bounded by the vision budget, not its own pixels —
  // the case the old width-only clamp got wrong.
  const r = resolveDeliverySize('full', 1988, 3165, 4138);
  check(r.size < 1568, `a portrait leaf clamps below the default (got: ${r.size})`);
  check(!!r.note?.includes('downscaled before the model sees it'), `note names the vision reason (got: ${r.note})`);
}
{
  // A landscape opening can carry the full cap — the fix is not only a cut.
  const r = resolveDeliverySize('full', 1988, 7496, 4253);
  check(r.size === 1988, `a landscape opening keeps the full 1988 (got: ${r.size})`);
  check(r.note === undefined, 'nothing was denied, so no note');
}
{
  // An unspecified size is fitted to the page silently: nothing was denied,
  // and on ~70% of the corpus the default is above the deliverable ceiling, so
  // noting it every time would train the model to ignore notes.
  const r = resolveDeliverySize('full', undefined, 3165, 4138);
  check(r.size < 1568, `an omitted size is still fitted to the page (got: ${r.size})`);
  check(r.note === undefined, 'fitting an omitted size raises no note');
}
{
  // Degraded path: info.json failed, so the shape is unknown. Falling back to
  // the default would deliver the very size the corpus survey found breaches
  // the many-image limit on most pages.
  const r = resolveDeliverySize('full', undefined, undefined, undefined);
  check(r.size === VISION_FALLBACK_WIDTH, `unknown dims fall back to the any-shape width (got: ${r.size})`);
  check(r.size < 1568, 'the fallback is below the default, not equal to it');
}
{
  const r = resolveDeliverySize('full', 400, undefined, undefined);
  check(r.size === 400, `a smaller explicit size survives the fallback (got: ${r.size})`);
}

// ---------------------------------------------------------------------------
// 5. buildIiifRegionUrl
// ---------------------------------------------------------------------------

console.log('5. buildIiifRegionUrl');

const baseImageUrl = 'https://service.archief.nl/iip/aa/bb/x.jp2/full/max/0/default.jpg';

{
  const url = buildIiifRegionUrl(baseImageUrl, 'pct:25,25,10,10', 400, 0, 'default');
  check(
    url === 'https://service.archief.nl/iip/aa/bb/x.jp2/pct:25,25,10,10/400,/0/default.jpg',
    `builds the region URL (got: ${url})`,
  );
}
{
  const url = buildIiifRegionUrl(baseImageUrl, 'pct:25,25,10,10', 400, 90, 'gray');
  check(
    url === 'https://service.archief.nl/iip/aa/bb/x.jp2/pct:25,25,10,10/400,/90/gray.jpg',
    `builds the region URL with rotation + quality (got: ${url})`,
  );
}
{
  const infoUrl = 'https://service.archief.nl/iip/aa/bb/x.jp2/info.json';
  check(buildIiifRegionUrl(infoUrl, 'full', 400, 0, 'default') === null, 'non-matching URL shape returns null');
}

// ---------------------------------------------------------------------------
// 6. infoJsonUrlFromImageUrl
// ---------------------------------------------------------------------------

console.log('6. infoJsonUrlFromImageUrl');

{
  const infoUrl = infoJsonUrlFromImageUrl(baseImageUrl);
  check(infoUrl === 'https://service.archief.nl/iip/aa/bb/x.jp2/info.json', `derives info.json URL (got: ${infoUrl})`);
}
{
  check(infoJsonUrlFromImageUrl('https://service.archief.nl/iip/aa/bb/x.jp2/info.json') === null, 'already-info.json URL returns null');
  check(infoJsonUrlFromImageUrl('not-a-url') === null, 'unrelated string returns null');
}

// ---------------------------------------------------------------------------
// 7. projectToFullImage (reverse-channel geometry, plan 021)
// ---------------------------------------------------------------------------

console.log('7. projectToFullImage');

{
  // A crop-local pct box within a full-image pct crop → full-image pct.
  // relativeTo = pct:20,20,40,40; local = pct:50,50,10,10 →
  //   fx = 20 + 0.5*40 = 40; fy = 20 + 0.5*40 = 40; fw = 0.1*40 = 4; fh = 4
  const p = projectToFullImage('pct:50,50,10,10', 'pct:20,20,40,40');
  check(p === 'pct:40,40,4,4', `crop-local pct projects to pct:40,40,4,4 (got: ${p})`);
}
{
  // crop_pixels with localSize: 100px within a 200px-wide crop = 50% →
  //   relativeTo pct:0,0,50,50 → fx = 0 + 0.5*50 = 25; fw = 0.5*50 = 25
  const p = projectToFullImage('crop_pixels:100,0,100,80', 'pct:0,0,50,50', { width: 200, height: 160 });
  check(p === 'pct:25,0,25,25', `crop_pixels with localSize projects (got: ${p})`);
}
{
  check(projectToFullImage('crop_pixels:1,2,3,4', 'pct:0,0,50,50') === null, 'crop_pixels without localSize is null');
  check(projectToFullImage('pct:1,2,3,4', 'full') === null, 'non-pct relativeTo is null');
}

// ---------------------------------------------------------------------------
// 8. computeDeliveryState
// ---------------------------------------------------------------------------

console.log('8. computeDeliveryState');

{
  const now = 1_000_000;
  check(computeDeliveryState(undefined, now) === 'no_live_viewer_seen', 'never polled → no_live_viewer_seen');
  check(computeDeliveryState(now - 3000, now) === 'delivered_recently', '3s ago → delivered_recently');
  check(computeDeliveryState(now - 10000, now) === 'queued_waiting_for_viewer', '10s ago → queued_waiting_for_viewer');
}

// ---------------------------------------------------------------------------
// 9. extractIiifImageUrl — target selection by type, not position
// ---------------------------------------------------------------------------

console.log('9. extractIiifImageUrl');

{
  const IMG = 'https://service.archief.nl/iip/aa/bb/x.jp2/full/max/0/default.jpg';
  // The Text/LogicalText targets are credentialed TextRepo URLs (Basic-auth
  // 401 as of 2026-08). Selecting a target positionally would hand one of
  // these to the viewer / globalise_inspect_page_image on any upstream
  // reorder, and the `typeof source === 'string'` guard cannot tell it apart
  // from an image URL — hence the by-type selection these cases pin down.
  const TXT = 'https://globalise.tt.di.huc.knaw.nl/textrepo/rest/versions/v1/contents';

  const target = (type: string, source: unknown) => ({ type, source });
  // Cast: extractIiifImageUrl only reads anno[0].target, so a full
  // DocumentResponse (profile/request/views) would be noise here.
  const resp = (t: unknown[]) => ({ anno: [{ target: t }] }) as unknown as DocumentResponse;

  // The ordering upstream actually serves, verified across 5 inventories
  // (2026-08-03): [Image, Canvas, Text, Text, LogicalText, LogicalText].
  const live = resp([
    target('Image', IMG),
    target('Canvas', 'https://data.globalise.huygens.knaw.nl/manifests/inventories/9966.json/canvas/p106'),
    target('Text', TXT),
    target('Text', TXT),
    target('LogicalText', TXT),
    target('LogicalText', TXT),
  ]);
  check(extractIiifImageUrl(live) === IMG, 'picks the Image target from the live upstream ordering');

  // Regression guards: these returned the TextRepo URL under positional [0].
  check(
    extractIiifImageUrl(resp([target('Text', TXT), target('Canvas', 'c'), target('Image', IMG)])) === IMG,
    'Text target first still yields the Image URL',
  );
  check(
    extractIiifImageUrl(resp([target('LogicalText', TXT), target('Image', IMG)])) === IMG,
    'LogicalText target first still yields the Image URL',
  );

  // Fallback: a payload without `type` degrades to the historic [0] behaviour.
  check(
    extractIiifImageUrl(resp([{ source: IMG }, { source: TXT }])) === IMG,
    'untyped targets fall back to target[0]',
  );
  check(
    extractIiifImageUrl(resp([target('Canvas', 'c'), target('Text', TXT)])) === 'c',
    'no Image target falls back to target[0]',
  );

  // Pre-existing guards must survive the change.
  check(
    extractIiifImageUrl(resp([target('Image', { id: 'x', type: 'Image' })])) === undefined,
    'object-shaped source returns undefined rather than "[object Object]"',
  );
  check(extractIiifImageUrl(resp([])) === undefined, 'empty target array returns undefined');
  check(extractIiifImageUrl({} as unknown as DocumentResponse) === undefined, 'missing anno returns undefined');
}

finish('IIIF tests');
