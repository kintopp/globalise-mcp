/**
 * Experiment runner - executes experiments and records results
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { LLMProvider } from './providers/types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { loadPageInFormat } from './input/labeled.js';
import { parsePlaintextFile } from './input/plaintext.js';
import {
  ExperimentConfig,
  PageResult,
  SummaryOutput,
  ExperimentResults,
  SampleSelection,
  PageData,
} from './types.js';
import {
  EXPERIMENTS,
  PLAINTEXT_FILE,
  MAX_TOKENS,
  TEMPERATURE,
  DATA_DIR,
} from './config.js';

const PROMPTS_DIR = new URL('../prompts', import.meta.url).pathname;
const RESULTS_DIR = new URL('../data/results', import.meta.url).pathname;

/**
 * Load and prepare the prompt template
 */
function loadPromptTemplate(): string {
  const promptPath = `${PROMPTS_DIR}/summary-v1.txt`;
  return readFileSync(promptPath, 'utf-8');
}

/**
 * Build the full prompt for a page
 */
function buildPrompt(template: string, content: string, format: string): string {
  let formatInstructions = '';

  if (format === 'labeled') {
    formatInstructions = `
The content is formatted with region labels:
- [PARAGRAPH]: Main body text
- [MARGINALIA]: Notes in the margins
- [HEADER]: Section headings
- Confidence scores indicate HTR reliability (lower = more errors likely)`;
  } else if (format === 'contextual') {
    formatInstructions = `
Archival context is provided at the start. Use it to inform your summary.`;
  } else if (format === 'pagexml-full') {
    formatInstructions = `
The content is in PageXML format. Focus on the Unicode text elements.`;
  }

  return template
    .replace('{{FORMAT_INSTRUCTIONS}}', formatInstructions)
    .replace('{{CONTENT}}', content);
}

/**
 * Parse the LLM response as JSON
 */
function parseResponse(content: string): SummaryOutput | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (typeof parsed.title !== 'string' || typeof parsed.abstract !== 'string') {
      return null;
    }

    return {
      title: parsed.title,
      abstract: parsed.abstract,
    };
  } catch {
    return null;
  }
}

/**
 * Get the appropriate provider for an experiment
 */
function getProvider(config: ExperimentConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'openrouter':
      return new OpenRouterProvider();
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

/**
 * Run a single experiment on all sample pages
 */
export async function runExperiment(
  experimentName: string,
  samples: SampleSelection[],
  options: { verbose?: boolean; dryRun?: boolean } = {}
): Promise<ExperimentResults> {
  const config = EXPERIMENTS.find(e => e.name === experimentName);
  if (!config) {
    throw new Error(`Unknown experiment: ${experimentName}`);
  }

  console.log(`\nRunning experiment: ${config.name}`);
  console.log(`  Model: ${config.model} (${config.modelId})`);
  console.log(`  Format: ${config.inputFormat}`);
  console.log(`  Samples: ${samples.length}`);
  console.log();

  const provider = getProvider(config);
  const template = loadPromptTemplate();
  const plaintextPages = parsePlaintextFile(PLAINTEXT_FILE);

  const results: PageResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    console.log(`  [${i + 1}/${samples.length}] Processing ${sample.pageId}...`);

    try {
      // Load page content in the specified format
      const content = loadPageInFormat(sample.pageId, config.inputFormat, plaintextPages);
      const prompt = buildPrompt(template, content, config.inputFormat);

      if (options.dryRun) {
        console.log(`    [DRY RUN] Would send ${prompt.length} chars`);
        results.push({
          pageId: sample.pageId,
          experiment: config.name,
          input: {
            format: config.inputFormat,
            wordCount: sample.wordCount,
            tokenCount: Math.ceil(prompt.length / 4), // Rough estimate
          },
          output: null,
          parseSuccess: true,
          metrics: {
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            cost: 0,
          },
        });
        continue;
      }

      // Call the LLM
      const response = await provider.complete({
        model: config.modelId,
        userPrompt: prompt,
        maxTokens: MAX_TOKENS,
        temperature: TEMPERATURE,
      });

      // Parse the response
      const output = parseResponse(response.content);
      const cost = provider.estimateCost(config.modelId, response.inputTokens, response.outputTokens);

      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;
      totalCost += cost;

      const result: PageResult = {
        pageId: sample.pageId,
        experiment: config.name,
        input: {
          format: config.inputFormat,
          wordCount: sample.wordCount,
          tokenCount: response.inputTokens,
        },
        output,
        parseSuccess: output !== null,
        error: output === null ? 'Failed to parse JSON response' : undefined,
        metrics: {
          latencyMs: response.latencyMs,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          cost,
        },
      };

      results.push(result);

      if (options.verbose && output) {
        console.log(`    Title: ${output.title}`);
        console.log(`    Abstract: ${output.abstract.substring(0, 100)}...`);
      }

      console.log(`    ${response.latencyMs}ms, $${cost.toFixed(6)}`);

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`    Error: ${error}`);
      results.push({
        pageId: sample.pageId,
        experiment: config.name,
        input: {
          format: config.inputFormat,
          wordCount: sample.wordCount,
          tokenCount: 0,
        },
        output: null,
        parseSuccess: false,
        error: String(error),
        metrics: {
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        },
      });
    }
  }

  // Calculate summary statistics
  const successfulResults = results.filter(r => r.parseSuccess && r.output);

  const experimentResults: ExperimentResults = {
    experiment: config.name,
    timestamp: new Date().toISOString(),
    config,
    results,
    summary: {
      totalPages: results.length,
      successCount: successfulResults.length,
      avgLatencyMs: results.length > 0
        ? Math.round(results.reduce((sum, r) => sum + r.metrics.latencyMs, 0) / results.length)
        : 0,
      totalCost,
      avgTitleLength: successfulResults.length > 0
        ? Math.round(successfulResults.reduce((sum, r) => sum + (r.output?.title.length || 0), 0) / successfulResults.length)
        : 0,
      avgAbstractWords: successfulResults.length > 0
        ? Math.round(successfulResults.reduce((sum, r) => sum + countWords(r.output?.abstract || ''), 0) / successfulResults.length)
        : 0,
    },
  };

  console.log(`\nExperiment complete:`);
  console.log(`  Success: ${experimentResults.summary.successCount}/${experimentResults.summary.totalPages}`);
  console.log(`  Avg latency: ${experimentResults.summary.avgLatencyMs}ms`);
  console.log(`  Total cost: $${experimentResults.summary.totalCost.toFixed(4)}`);

  return experimentResults;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Save experiment results to file
 */
export function saveResults(results: ExperimentResults): string {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const filename = `${results.experiment}.json`;
  const filepath = `${RESULTS_DIR}/${filename}`;

  writeFileSync(filepath, JSON.stringify(results, null, 2));
  console.log(`Results saved to ${filepath}`);

  return filepath;
}

/**
 * Load results from a previous experiment run
 */
export function loadResults(experimentName: string): ExperimentResults | null {
  const filepath = `${RESULTS_DIR}/${experimentName}.json`;

  if (!existsSync(filepath)) {
    return null;
  }

  const content = readFileSync(filepath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Run all experiments
 */
export async function runAllExperiments(
  samples: SampleSelection[],
  options: { verbose?: boolean; dryRun?: boolean } = {}
): Promise<ExperimentResults[]> {
  const allResults: ExperimentResults[] = [];

  for (const config of EXPERIMENTS) {
    const results = await runExperiment(config.name, samples, options);
    allResults.push(results);
    saveResults(results);

    // Delay between experiments
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return allResults;
}

/**
 * Run a single page through an experiment (for testing)
 */
export async function runSinglePage(
  pageId: string,
  experimentName: string,
  options: { verbose?: boolean } = {}
): Promise<PageResult> {
  const config = EXPERIMENTS.find(e => e.name === experimentName);
  if (!config) {
    throw new Error(`Unknown experiment: ${experimentName}`);
  }

  const plaintextPages = parsePlaintextFile(PLAINTEXT_FILE);
  const page = plaintextPages.get(pageId);
  if (!page) {
    throw new Error(`Page not found: ${pageId}`);
  }

  const samples: SampleSelection[] = [{
    pageId,
    wordCount: page.wordCount,
    stratum: 'medium',
  }];

  const results = await runExperiment(experimentName, samples, options);
  return results.results[0];
}
