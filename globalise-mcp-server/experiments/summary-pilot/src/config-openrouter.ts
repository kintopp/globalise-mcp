/**
 * Configuration for OpenRouter free model experiments
 *
 * Selected models based on:
 * 1. Multilingual capability (for historical Dutch)
 * 2. Strong instruction following (for JSON output)
 * 3. Good availability on free tier
 */

import { ExperimentConfig } from './types.js';

// OpenRouter free models - pricing is $0.00 for both input and output
export const OPENROUTER_MODEL_PRICING = {
  'mistralai/mistral-small-3.1-24b-instruct:free': { input: 0, output: 0 },
  'deepseek/deepseek-r1-0528:free': { input: 0, output: 0 },
  'nousresearch/hermes-3-llama-3.1-405b:free': { input: 0, output: 0 },
  // Backup options
  'meta-llama/llama-3.3-70b-instruct:free': { input: 0, output: 0 },
  'google/gemma-3-27b-it:free': { input: 0, output: 0 },
  'qwen/qwen3-next-80b-a3b-instruct:free': { input: 0, output: 0 },
} as const;

// Paid model experiment configurations
export const OPENROUTER_EXPERIMENTS: ExperimentConfig[] = [
  {
    name: 'mistral-small-24b',
    model: 'Mistral Small 3.1 24B',
    modelId: 'mistralai/mistral-small-3.1-24b-instruct',
    inputFormat: 'plaintext',
    provider: 'openrouter',
  },
  {
    name: 'deepseek-r1-free',
    model: 'DeepSeek R1 0528',
    modelId: 'deepseek/deepseek-r1-0528:free',
    inputFormat: 'plaintext',
    provider: 'openrouter',
  },
  {
    name: 'hermes-3-405b-free',
    model: 'Hermes 3 405B',
    modelId: 'nousresearch/hermes-3-llama-3.1-405b:free',
    inputFormat: 'plaintext',
    provider: 'openrouter',
  },
];

// All experiments (Anthropic + OpenRouter)
export const ALL_FREE_EXPERIMENTS = OPENROUTER_EXPERIMENTS;
