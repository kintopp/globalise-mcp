#!/usr/bin/env node

/**
 * Summary Pilot CLI
 *
 * Generate LLM summaries for VOC transcription pages and compare models/formats.
 *
 * Usage:
 *   npx tsx src/index.ts sample --count 50 --preview
 *   npx tsx src/index.ts run --experiment haiku-plaintext
 *   npx tsx src/index.ts run --all
 *   npx tsx src/index.ts report
 *   npx tsx src/index.ts single --page 0043 --experiment haiku-plaintext
 */

import { Command } from 'commander';
import { config } from 'dotenv';
import { existsSync } from 'fs';

import { parsePlaintextFile, getPageStats } from './input/plaintext.js';
import { selectSample, saveSample, loadSample, previewSample } from './sampler.js';
import { runExperiment, runAllExperiments, runSinglePage, saveResults } from './runner.js';
import { loadAllResults, generateReport, saveReport, printSummary } from './evaluator.js';
import { PLAINTEXT_FILE, SAMPLE_COUNT, EXPERIMENTS, DATA_DIR } from './config.js';

// Load environment variables from ~/.env
config({ path: `${process.env.HOME}/.env` });

const SAMPLES_FILE = new URL('../data/samples.json', import.meta.url).pathname;

const program = new Command();

program
  .name('summary-pilot')
  .description('LLM-generated summaries pilot for VOC transcriptions')
  .version('0.1.0');

/**
 * Sample command - select representative pages
 */
program
  .command('sample')
  .description('Select a stratified sample of pages')
  .option('-c, --count <number>', 'Number of pages to sample', String(SAMPLE_COUNT))
  .option('-p, --preview', 'Preview sample without saving')
  .option('-s, --seed <number>', 'Random seed for reproducibility')
  .action(async (options) => {
    console.log('Loading pages from:', PLAINTEXT_FILE);

    const pages = parsePlaintextFile(PLAINTEXT_FILE);
    const stats = getPageStats(pages);

    console.log(`\nLoaded ${stats.totalPages} pages`);
    console.log(`  Empty pages: ${stats.emptyPages}`);
    console.log(`  Word count range: ${stats.minWordCount}-${stats.maxWordCount}`);
    console.log(`  Average: ${stats.avgWordCount} words`);
    console.log(`  Distribution: short=${stats.distribution.short}, medium=${stats.distribution.medium}, long=${stats.distribution.long}`);

    const count = parseInt(options.count);
    const seed = options.seed ? parseInt(options.seed) : undefined;

    console.log(`\nSelecting ${count} pages (seed: ${seed || 'random'})...`);
    const sample = selectSample(pages, count, seed);

    if (options.preview) {
      previewSample(sample);
    } else {
      saveSample(sample, SAMPLES_FILE);
      console.log(`\nSample saved to ${SAMPLES_FILE}`);
    }
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
    if (!process.env.ANTHROPIC_API_KEY && !options.dryRun) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      console.error('Set it in ~/.env or export it directly');
      process.exit(1);
    }

    // Load sample
    if (!existsSync(SAMPLES_FILE)) {
      console.error('Error: No sample file found. Run `sample` command first.');
      process.exit(1);
    }

    const samples = loadSample(SAMPLES_FILE);
    console.log(`Loaded ${samples.length} sample pages`);

    if (options.all) {
      console.log(`\nRunning all ${EXPERIMENTS.length} experiments...`);
      const results = await runAllExperiments(samples, {
        verbose: options.verbose,
        dryRun: options.dryRun,
      });
      printSummary(results);
    } else if (options.experiment) {
      const results = await runExperiment(options.experiment, samples, {
        verbose: options.verbose,
        dryRun: options.dryRun,
      });
      saveResults(results);
    } else {
      console.error('Error: Specify --experiment <name> or --all');
      console.log('\nAvailable experiments:');
      for (const exp of EXPERIMENTS) {
        console.log(`  ${exp.name} - ${exp.model} / ${exp.inputFormat}`);
      }
      process.exit(1);
    }
  });

/**
 * Report command - generate comparison report
 */
program
  .command('report')
  .description('Generate a comparison report from experiment results')
  .option('-o, --output <path>', 'Output file path')
  .action(async (options) => {
    const results = loadAllResults();

    if (results.length === 0) {
      console.error('Error: No experiment results found. Run some experiments first.');
      process.exit(1);
    }

    console.log(`Found ${results.length} experiment results`);

    printSummary(results);

    const report = generateReport(results);
    const filepath = options.output || saveReport(report);

    console.log(`\nReport generated: ${filepath}`);
  });

/**
 * Single command - test a single page
 */
program
  .command('single')
  .description('Run a single page through an experiment')
  .requiredOption('-p, --page <id>', 'Page ID or scan number (e.g., 0043)')
  .option('-e, --experiment <name>', 'Experiment to use', 'haiku-plaintext')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (options) => {
    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('Error: ANTHROPIC_API_KEY environment variable is required');
      process.exit(1);
    }

    // Normalize page ID
    let pageId = options.page;
    if (!pageId.startsWith('NL-HaNA')) {
      // Assume it's just the scan number
      pageId = `NL-HaNA_1.04.02_10000_${pageId.padStart(4, '0')}`;
    }

    console.log(`Processing page: ${pageId}`);
    console.log(`Experiment: ${options.experiment}`);

    try {
      const result = await runSinglePage(pageId, options.experiment, {
        verbose: options.verbose,
      });

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
      console.log(`  Cost: $${result.metrics.cost.toFixed(6)}`);

    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });

/**
 * Info command - show configuration
 */
program
  .command('info')
  .description('Show configuration and available experiments')
  .action(() => {
    console.log('Summary Pilot Configuration');
    console.log('===========================\n');

    console.log('Data:');
    console.log(`  Data directory: ${DATA_DIR}`);
    console.log(`  Plaintext file: ${PLAINTEXT_FILE}`);
    console.log(`  Sample file: ${SAMPLES_FILE}`);
    console.log();

    console.log('Experiments:');
    for (const exp of EXPERIMENTS) {
      console.log(`  ${exp.name}:`);
      console.log(`    Model: ${exp.model} (${exp.modelId})`);
      console.log(`    Format: ${exp.inputFormat}`);
      console.log(`    Provider: ${exp.provider}`);
    }
    console.log();

    console.log('Environment:');
    console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'not set'}`);
    console.log(`  OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? 'set' : 'not set'}`);
  });

program.parse();
