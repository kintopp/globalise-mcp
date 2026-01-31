/**
 * Configuration for the summary pilot experiment
 */

import { ExperimentConfig } from './types.js';

// Data paths
export const DATA_DIR = process.env.PILOT_DATA_DIR || '/Users/bosse0000/Downloads/10000';
export const PLAINTEXT_FILE = `${DATA_DIR}/10000.txt`;

// Sampling configuration
export const SAMPLE_COUNT = 50;
export const MIN_WORDS_THRESHOLD = 50;  // Exclude pages with fewer words
export const STRATA = {
  short: { min: 50, max: 150, count: 10 },
  medium: { min: 151, max: 300, count: 25 },
  long: { min: 301, max: Infinity, count: 15 },
} as const;

// Model pricing (per million tokens)
export const MODEL_PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
  'claude-opus-4-5-20251101': { input: 5.00, output: 25.00 },
} as const;

// Experiment configurations
export const EXPERIMENTS: ExperimentConfig[] = [
  {
    name: 'haiku-plaintext',
    model: 'Haiku 4.5',
    modelId: 'claude-haiku-4-5-20251001',
    inputFormat: 'plaintext',
    provider: 'anthropic',
  },
  {
    name: 'haiku-labeled',
    model: 'Haiku 4.5',
    modelId: 'claude-haiku-4-5-20251001',
    inputFormat: 'labeled',
    provider: 'anthropic',
  },
  {
    name: 'sonnet-plaintext',
    model: 'Sonnet 4.5',
    modelId: 'claude-sonnet-4-5-20250929',
    inputFormat: 'plaintext',
    provider: 'anthropic',
  },
  {
    name: 'sonnet-labeled',
    model: 'Sonnet 4.5',
    modelId: 'claude-sonnet-4-5-20250929',
    inputFormat: 'labeled',
    provider: 'anthropic',
  },
  {
    name: 'opus-plaintext',
    model: 'Opus 4.5',
    modelId: 'claude-opus-4-5-20251101',
    inputFormat: 'plaintext',
    provider: 'anthropic',
  },
];

// Output constraints
export const MAX_TITLE_LENGTH = 80;
export const ABSTRACT_WORD_RANGE = { min: 50, max: 100 };

// API settings
export const MAX_TOKENS = 300;  // Enough for title + abstract
export const TEMPERATURE = 0.3;  // Low for consistency
