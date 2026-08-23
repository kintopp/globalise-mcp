/**
 * Unit tests for src/utils/vision-sizing.ts. All pure — no network, no DB.
 *
 * Run with: npm run test:vision-sizing
 */

import {
  VISION_PATCH,
  VISION_MAX_EDGE,
  VISION_MAX_TOKENS,
  padToPatch,
  visualTokens,
  maxInspectWidth,
} from '../src/utils/vision-sizing.js';
import { check, finish } from './test-utils.js';

// ---------------------------------------------------------------------------
// The contract, stated ONCE from the exported constants.
//
// Re-implementing this predicate per test invites the two copies to disagree
// about exactly the thing under test — padded vs unpadded dimensions is the
// distinction this whole module is about.
// ---------------------------------------------------------------------------

const fitsBudget = (w: number, regionW: number, regionH: number): boolean => {
  const h = Math.max(1, Math.ceil(w * regionH / regionW));
  return padToPatch(w) <= VISION_MAX_EDGE
    && padToPatch(h) <= VISION_MAX_EDGE
    && visualTokens(w, h) <= VISION_MAX_TOKENS;
};

// ---------------------------------------------------------------------------
// 1. Constants and patch arithmetic
// ---------------------------------------------------------------------------

console.log('1. constants and patch arithmetic');

check(VISION_PATCH === 28, 'patch grid is 28px');
check(VISION_MAX_EDGE === 1988, `edge cap is 1988 (got: ${VISION_MAX_EDGE})`);
check(VISION_MAX_EDGE % VISION_PATCH === 0, 'edge cap sits on the patch grid');
check(VISION_MAX_TOKENS === 4784, `token budget is 4784 (got: ${VISION_MAX_TOKENS})`);

// Regression guard, named so nobody "rounds up to the next patch boundary".
// 2016 (72 patches) is over the ~2000px many-image per-side limit; because the
// edge check runs on the PADDED width, nothing between 1989 and 2016 is
// reachable, so 1988 is not merely tidy — it is forced.
check(VISION_MAX_EDGE < 2000, 'edge cap stays under the ~2000px many-image limit');
check(VISION_MAX_EDGE !== 2016, 'edge cap is NOT 2016 — that is over the many-image limit');
check(padToPatch(1989) === 2016, 'a width of 1989 pads to 2016, hence unreachable');

check(padToPatch(28) === 28, 'padToPatch is exact on a grid multiple');
check(padToPatch(29) === 56, 'padToPatch rounds up off-grid');
check(visualTokens(28, 28) === 1, 'a single patch costs 1 token');
check(visualTokens(1568, 2130) === 56 * 77, `1568x2130 costs 56*77 tokens (got: ${visualTokens(1568, 2130)})`);

// ---------------------------------------------------------------------------
// 2. maxInspectWidth — maximality, not merely fit
//
// Asserting the result FITS passes trivially for any conservative
// implementation, including a broken one that returns 200. Asserting that
// width+1 does NOT fit is what pins the value.
// ---------------------------------------------------------------------------

console.log('2. maxInspectWidth is maximal for each shape');

const SHAPES: Array<[string, number, number]> = [
  // Real GLOBALISE scan shapes, from the 499-page corpus sample.
  ['single leaf (median 0.751)', 3165, 4138],
  ['narrowest leaf observed', 2600, 4220],
  ['two-page opening', 6296, 4179],
  ['widest opening observed', 7496, 4253],
  // Region crops, which is where the tool spends most of its calls.
  ['half-page column crop', 1500, 4100],
  ['single-line strip', 3000, 200],
  ['tiny marginalia crop', 300, 220],
  // Shape extremes.
  ['square', 4000, 4000],
  ['16:9', 1920, 1080],
];

for (const [label, w, h] of SHAPES) {
  const got = maxInspectWidth(w, h);
  check(fitsBudget(got, w, h), `${label}: ${got}px fits the budget`);
  check(!fitsBudget(got + 1, w, h), `${label}: ${got + 1}px does not — ${got} is the ceiling`);
}

// ---------------------------------------------------------------------------
// 3. The bug this replaces: width alone does not determine the answer
// ---------------------------------------------------------------------------

console.log('3. shape, not width, determines the ceiling');

{
  // Same region width, opposite shapes → different ceilings. A width-only
  // clamp cannot tell these apart, which is precisely how the old code
  // returned an over-budget size on portrait pages.
  const tall = maxInspectWidth(3000, 4200);
  const wide = maxInspectWidth(3000, 1700);
  check(tall !== wide, `same 3000px region width, different shapes → different ceilings (${tall} vs ${wide})`);
  check(wide > tall, 'the landscape shape supports a wider delivery than the portrait one');
}

{
  // A portrait leaf at the old 2016 cap: over budget on BOTH counts.
  const leafW = 3165, leafH = 4138;
  const oldH = Math.ceil(2016 * leafH / leafW);
  check(!fitsBudget(2016, leafW, leafH), `the retired 2016 cap does not fit a portrait leaf (would be 2016x${oldH})`);
  check(padToPatch(oldH) > 2000, `...and its padded height ${padToPatch(oldH)} breaches the ~2000px many-image limit`);
}

{
  // The default (1568) breaches the many-image limit on ~70% of the corpus —
  // the finding that made this a live bug rather than a latent one.
  const dh = Math.ceil(1568 * 4138 / 3165);
  check(padToPatch(dh) > 2000, `default 1568px on a median leaf pads to ${padToPatch(dh)} — over ~2000px`);
  check(maxInspectWidth(3165, 4138) < 1568, 'so the clamp must reduce the default on portrait leaves');
}

// ---------------------------------------------------------------------------
// 4. Degenerate input
// ---------------------------------------------------------------------------

console.log('4. degenerate input');

check(maxInspectWidth(0, 100) === VISION_MAX_EDGE, 'zero width falls back to the edge cap');
check(maxInspectWidth(100, 0) === VISION_MAX_EDGE, 'zero height falls back to the edge cap');
check(maxInspectWidth(NaN, 100) === VISION_MAX_EDGE, 'NaN falls back to the edge cap');
{
  // Taller than the edge cap even one pixel wide.
  const got = maxInspectWidth(1, 100000);
  check(got === 1, `an extremely tall sliver clamps to 1px (got: ${got})`);
}

// ---------------------------------------------------------------------------
// 5. Never exceeds the cap, for any shape
// ---------------------------------------------------------------------------

console.log('5. exhaustive sweep across aspect ratios');

{
  let violations = 0;
  let notMaximal = 0;
  for (let h = 100; h <= 8000; h += 37) {
    const w = 3000;
    const got = maxInspectWidth(w, h);
    if (got > VISION_MAX_EDGE || !fitsBudget(got, w, h)) violations++;
    if (fitsBudget(got + 1, w, h)) notMaximal++;
  }
  check(violations === 0, `no over-budget result across the ratio sweep (${violations} violations)`);
  check(notMaximal === 0, `every result is maximal across the ratio sweep (${notMaximal} non-maximal)`);
}

finish('vision sizing tests');
