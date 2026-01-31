#!/usr/bin/env node

/**
 * OpenRouter Free Models CLI
 *
 * Test free LLM models on VOC transcription summarization.
 *
 * Usage:
 *   npx tsx src/openrouter-cli.ts info
 *   npx tsx src/openrouter-cli.ts run --experiment llama-3.3-70b-free
 *   npx tsx src/openrouter-cli.ts run --all
 *   npx tsx src/openrouter-cli.ts single --page 0030 --experiment gemma-3-27b-free
 *   npx tsx src/openrouter-cli.ts report
 */

import { Command } from 'commander';
import { config } from 'dotenv';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';

import { parsePlaintextFile } from './input/plaintext.js';
import { loadSample } from './sampler.js';
import { loadPageInFormat } from './input/labeled.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { OPENROUTER_EXPERIMENTS } from './config-openrouter.js';
import { PLAINTEXT_FILE, MAX_TOKENS, TEMPERATURE } from './config.js';
import {
  ExperimentConfig,
  PageResult,
  SummaryOutput,
  ExperimentResults,
  SampleSelection,
} from './types.js';

// Load environment variables from ~/.env
config({ path: `${process.env.HOME}/.env` });

const SAMPLES_FILE = new URL('../data/samples.json', import.meta.url).pathname;
const RESULTS_DIR = new URL('../data/results', import.meta.url).pathname;
const PROMPTS_DIR = new URL('../prompts', import.meta.url).pathname;

const program = new Command();

program
  .name('openrouter-pilot')
  .description('Test free OpenRouter models on VOC transcription summarization')
  .version('0.1.0');

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
function buildPrompt(template: string, content: string): string {
  return template
    .replace('{{FORMAT_INSTRUCTIONS}}', '')
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

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Run a single experiment on all sample pages
 */
async function runExperiment(
  experimentName: string,
  samples: SampleSelection[],
  options: { verbose?: boolean; dryRun?: boolean } = {}
): Promise<ExperimentResults> {
  const config = OPENROUTER_EXPERIMENTS.find(e => e.name === experimentName);
  if (!config) {
    throw new Error(`Unknown experiment: ${experimentName}. Available: ${OPENROUTER_EXPERIMENTS.map(e => e.name).join(', ')}`);
  }

  console.log(`\nRunning experiment: ${config.name}`);
  console.log(`  Model: ${config.model} (${config.modelId})`);
  console.log(`  Format: ${config.inputFormat}`);
  console.log(`  Samples: ${samples.length}`);
  console.log();

  const provider = new OpenRouterProvider();
  const template = loadPromptTemplate();
  const plaintextPages = parsePlaintextFile(PLAINTEXT_FILE);

  const results: PageResult[] = [];
  let totalCost = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    console.log(`  [${i + 1}/${samples.length}] Processing ${sample.pageId}...`);

    try {
      // Load page content
      const content = loadPageInFormat(sample.pageId, config.inputFormat, plaintextPages);
      const prompt = buildPrompt(template, content);

      if (options.dryRun) {
        console.log(`    [DRY RUN] Would send ${prompt.length} chars`);
        results.push({
          pageId: sample.pageId,
          experiment: config.name,
          input: {
            format: config.inputFormat,
            wordCount: sample.wordCount,
            tokenCount: Math.ceil(prompt.length / 4),
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
        error: output === null ? `Failed to parse JSON. Raw: ${response.content.substring(0, 200)}...` : undefined,
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

      const status = output ? '✓' : '✗';
      console.log(`    ${status} ${response.latencyMs}ms (FREE)`);

      // Delay to avoid rate limiting on free tier
      await new Promise(resolve => setTimeout(resolve, 500));

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

      // Longer delay on error
      await new Promise(resolve => setTimeout(resolve, 2000));
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
  console.log(`  Total cost: $${experimentResults.summary.totalCost.toFixed(4)} (FREE)`);

  return experimentResults;
}

/**
 * Save experiment results to file
 */
function saveResults(results: ExperimentResults): string {
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
 * Info command - show available experiments
 */
program
  .command('info')
  .description('Show available OpenRouter free models')
  .action(() => {
    console.log('OpenRouter Free Model Experiments');
    console.log('==================================\n');

    console.log('Available experiments:');
    for (const exp of OPENROUTER_EXPERIMENTS) {
      console.log(`  ${exp.name}:`);
      console.log(`    Model: ${exp.model}`);
      console.log(`    Model ID: ${exp.modelId}`);
      console.log(`    Format: ${exp.inputFormat}`);
      console.log(`    Cost: FREE`);
      console.log();
    }

    console.log('Environment:');
    console.log(`  OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? 'set' : 'NOT SET'}`);
  });

/**
 * Run command - execute experiments
 */
program
  .command('run')
  .description('Run experiments on sample pages')
  .option('-e, --experiment <name>', 'Run a specific experiment')
  .option('-a, --all', 'Run all experiments')
  .option('-v, --verbose', 'Show detailed output')
  .option('-d, --dry-run', 'Preview without calling API')
  .action(async (options) => {
    // Check for API key
    if (!process.env.OPENROUTER_API_KEY && !options.dryRun) {
      console.error('Error: OPENROUTER_API_KEY environment variable is required');
      console.error('Set it in ~/.env or export it directly');
      process.exit(1);
    }

    // Load sample
    if (!existsSync(SAMPLES_FILE)) {
      console.error('Error: No sample file found. Run `npx tsx src/index.ts sample` first.');
      process.exit(1);
    }

    const samples = loadSample(SAMPLES_FILE);
    console.log(`Loaded ${samples.length} sample pages`);

    if (options.all) {
      console.log(`\nRunning all ${OPENROUTER_EXPERIMENTS.length} OpenRouter experiments...`);

      for (const config of OPENROUTER_EXPERIMENTS) {
        try {
          const results = await runExperiment(config.name, samples, {
            verbose: options.verbose,
            dryRun: options.dryRun,
          });
          saveResults(results);
        } catch (error) {
          console.error(`Failed to run ${config.name}:`, error);
        }

        // Delay between experiments
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      console.log('\nAll experiments complete!');
    } else if (options.experiment) {
      const results = await runExperiment(options.experiment, samples, {
        verbose: options.verbose,
        dryRun: options.dryRun,
      });
      saveResults(results);
    } else {
      console.error('Error: Specify --experiment <name> or --all');
      console.log('\nAvailable experiments:');
      for (const exp of OPENROUTER_EXPERIMENTS) {
        console.log(`  ${exp.name} - ${exp.model}`);
      }
      process.exit(1);
    }
  });

/**
 * Single command - test a single page
 */
program
  .command('single')
  .description('Run a single page through an experiment')
  .requiredOption('-p, --page <id>', 'Page ID or scan number (e.g., 0030)')
  .option('-e, --experiment <name>', 'Experiment to use', 'llama-3.3-70b-free')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options) => {
    // Check for API key
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('Error: OPENROUTER_API_KEY environment variable is required');
      process.exit(1);
    }

    // Normalize page ID
    let pageId = options.page;
    if (!pageId.startsWith('NL-HaNA')) {
      pageId = `NL-HaNA_1.04.02_10000_${pageId.padStart(4, '0')}`;
    }

    console.log(`Processing page: ${pageId}`);
    console.log(`Experiment: ${options.experiment}`);

    const plaintextPages = parsePlaintextFile(PLAINTEXT_FILE);
    const page = plaintextPages.get(pageId);
    if (!page) {
      console.error(`Page not found: ${pageId}`);
      process.exit(1);
    }

    const samples: SampleSelection[] = [{
      pageId,
      wordCount: page.wordCount,
      stratum: 'medium',
    }];

    try {
      const results = await runExperiment(options.experiment, samples, {
        verbose: options.verbose,
      });

      const result = results.results[0];

      console.log('\n=== Result ===\n');

      if (result.output) {
        console.log(`Title: ${result.output.title}`);
        console.log(`\nAbstract: ${result.output.abstract}`);
      } else {
        console.log('Failed to generate summary');
        if (result.error) {
          console.log(`Error: ${result.error}`);
        }
      }

      console.log(`\nMetrics:`);
      console.log(`  Latency: ${result.metrics.latencyMs}ms`);
      console.log(`  Input tokens: ${result.metrics.inputTokens}`);
      console.log(`  Output tokens: ${result.metrics.outputTokens}`);
      console.log(`  Cost: FREE`);

    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

/**
 * Report command - generate comparison report
 */
program
  .command('report')
  .description('Generate comparison report for OpenRouter experiments')
  .action(() => {
    const allResults: ExperimentResults[] = [];

    for (const exp of OPENROUTER_EXPERIMENTS) {
      const filepath = `${RESULTS_DIR}/${exp.name}.json`;
      if (existsSync(filepath)) {
        const content = readFileSync(filepath, 'utf-8');
        allResults.push(JSON.parse(content));
      }
    }

    if (allResults.length === 0) {
      console.error('No OpenRouter experiment results found. Run some experiments first.');
      process.exit(1);
    }

    console.log('\n=== OPENROUTER FREE MODEL COMPARISON ===\n');
    console.log('| Experiment        | Avg Latency | Success Rate | Avg Title | Avg Abstract |');
    console.log('|-------------------|-------------|--------------|-----------|--------------|');

    for (const result of allResults) {
      const successRate = ((result.summary.successCount / result.summary.totalPages) * 100).toFixed(0);
      console.log(
        `| ${result.experiment.padEnd(17)} | ${String(result.summary.avgLatencyMs).padStart(7)}ms | ${successRate.padStart(10)}% | ${String(result.summary.avgTitleLength).padStart(5)} chars | ${String(result.summary.avgAbstractWords).padStart(8)} words |`
      );
    }

    console.log('\nAll models are FREE - $0.00 cost!\n');

    // Show sample outputs
    console.log('=== Sample Outputs ===\n');
    for (const result of allResults) {
      const sample = result.results.find(r => r.parseSuccess && r.output);
      if (sample && sample.output) {
        console.log(`${result.experiment}:`);
        console.log(`  Title: ${sample.output.title}`);
        console.log(`  Abstract: ${sample.output.abstract.substring(0, 150)}...`);
        console.log();
      }
    }
  });

program.parse();
