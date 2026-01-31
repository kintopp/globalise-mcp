/**
 * Stratified sampler for selecting representative pages
 *
 * Strategy:
 * 1. Filter out pages below minimum word threshold
 * 2. Stratify by word count (short/medium/long)
 * 3. Random sample within each stratum
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { PageData, SampleSelection } from './types.js';
import { STRATA, MIN_WORDS_THRESHOLD, SAMPLE_COUNT } from './config.js';

type Stratum = 'short' | 'medium' | 'long';

/**
 * Select a stratified random sample of pages
 */
export function selectSample(
  pages: Map<string, PageData>,
  count: number = SAMPLE_COUNT,
  seed?: number
): SampleSelection[] {
  // Filter pages meeting minimum threshold
  const eligible = Array.from(pages.values())
    .filter(p => p.wordCount >= MIN_WORDS_THRESHOLD);

  if (eligible.length < count) {
    console.warn(`Only ${eligible.length} eligible pages (need ${count})`);
  }

  // Classify by stratum
  const stratified: Record<Stratum, PageData[]> = {
    short: [],
    medium: [],
    long: [],
  };

  for (const page of eligible) {
    const stratum = classifyPage(page.wordCount);
    stratified[stratum].push(page);
  }

  // Report distribution
  console.log('Population distribution:');
  console.log(`  Short (${STRATA.short.min}-${STRATA.short.max} words): ${stratified.short.length} pages`);
  console.log(`  Medium (${STRATA.medium.min}-${STRATA.medium.max} words): ${stratified.medium.length} pages`);
  console.log(`  Long (${STRATA.long.min}+ words): ${stratified.long.length} pages`);

  // Sample from each stratum
  const rng = createSeededRandom(seed ?? Date.now());
  const sample: SampleSelection[] = [];

  for (const stratum of ['short', 'medium', 'long'] as Stratum[]) {
    const pool = stratified[stratum];
    const targetCount = STRATA[stratum].count;
    const actualCount = Math.min(targetCount, pool.length);

    // Shuffle and take
    const shuffled = shuffle(pool, rng);
    for (let i = 0; i < actualCount; i++) {
      sample.push({
        pageId: shuffled[i].pageId,
        wordCount: shuffled[i].wordCount,
        stratum,
      });
    }
  }

  // Sort by page ID for consistent ordering
  sample.sort((a, b) => a.pageId.localeCompare(b.pageId));

  return sample;
}

function classifyPage(wordCount: number): Stratum {
  if (wordCount <= STRATA.short.max) return 'short';
  if (wordCount <= STRATA.medium.max) return 'medium';
  return 'long';
}

/**
 * Simple seeded PRNG (mulberry32)
 */
function createSeededRandom(seed: number): () => number {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function shuffle<T>(array: T[], rng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Save sample selection to file
 */
export function saveSample(sample: SampleSelection[], filePath: string): void {
  const output = {
    generatedAt: new Date().toISOString(),
    count: sample.length,
    distribution: {
      short: sample.filter(s => s.stratum === 'short').length,
      medium: sample.filter(s => s.stratum === 'medium').length,
      long: sample.filter(s => s.stratum === 'long').length,
    },
    samples: sample,
  };

  writeFileSync(filePath, JSON.stringify(output, null, 2));
  console.log(`Sample saved to ${filePath}`);
}

/**
 * Load sample selection from file
 */
export function loadSample(filePath: string): SampleSelection[] {
  if (!existsSync(filePath)) {
    throw new Error(`Sample file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);
  return data.samples;
}

/**
 * Preview sample without saving
 */
export function previewSample(sample: SampleSelection[]): void {
  console.log('\nSample Preview:');
  console.log('===============\n');

  const byStratum: Record<Stratum, SampleSelection[]> = {
    short: [],
    medium: [],
    long: [],
  };

  for (const s of sample) {
    byStratum[s.stratum].push(s);
  }

  for (const stratum of ['short', 'medium', 'long'] as Stratum[]) {
    console.log(`${stratum.toUpperCase()} (${byStratum[stratum].length} pages):`);
    for (const s of byStratum[stratum]) {
      console.log(`  ${s.pageId} (${s.wordCount} words)`);
    }
    console.log();
  }

  console.log(`Total: ${sample.length} pages`);
}
