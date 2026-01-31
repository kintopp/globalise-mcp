/**
 * Evaluator - calculates metrics and generates comparison reports
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { ExperimentResults, PageResult } from './types.js';
import { MAX_TITLE_LENGTH, ABSTRACT_WORD_RANGE } from './config.js';

const RESULTS_DIR = new URL('../data/results', import.meta.url).pathname;

interface ExperimentMetrics {
  name: string;
  model: string;
  format: string;
  totalPages: number;
  successRate: number;
  avgLatencyMs: number;
  totalCost: number;
  costPerPage: number;
  titleMetrics: {
    avgLength: number;
    inRangePercent: number;
  };
  abstractMetrics: {
    avgWords: number;
    inRangePercent: number;
  };
}

/**
 * Load all experiment results from the results directory
 */
export function loadAllResults(): ExperimentResults[] {
  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json'));
  const results: ExperimentResults[] = [];

  for (const file of files) {
    const content = readFileSync(`${RESULTS_DIR}/${file}`, 'utf-8');
    results.push(JSON.parse(content));
  }

  return results;
}

/**
 * Calculate detailed metrics for an experiment
 */
export function calculateMetrics(results: ExperimentResults): ExperimentMetrics {
  const successfulResults = results.results.filter(r => r.parseSuccess && r.output);

  // Title metrics
  const titleLengths = successfulResults.map(r => r.output?.title.length || 0);
  const titlesInRange = titleLengths.filter(l => l >= 20 && l <= MAX_TITLE_LENGTH).length;

  // Abstract metrics
  const abstractWordCounts = successfulResults.map(r =>
    countWords(r.output?.abstract || '')
  );
  const abstractsInRange = abstractWordCounts.filter(
    w => w >= ABSTRACT_WORD_RANGE.min && w <= ABSTRACT_WORD_RANGE.max
  ).length;

  return {
    name: results.experiment,
    model: results.config.model,
    format: results.config.inputFormat,
    totalPages: results.results.length,
    successRate: results.results.length > 0
      ? (successfulResults.length / results.results.length) * 100
      : 0,
    avgLatencyMs: results.summary.avgLatencyMs,
    totalCost: results.summary.totalCost,
    costPerPage: results.results.length > 0
      ? results.summary.totalCost / results.results.length
      : 0,
    titleMetrics: {
      avgLength: results.summary.avgTitleLength,
      inRangePercent: successfulResults.length > 0
        ? (titlesInRange / successfulResults.length) * 100
        : 0,
    },
    abstractMetrics: {
      avgWords: results.summary.avgAbstractWords,
      inRangePercent: successfulResults.length > 0
        ? (abstractsInRange / successfulResults.length) * 100
        : 0,
    },
  };
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Generate a markdown comparison report
 */
export function generateReport(allResults: ExperimentResults[]): string {
  const metrics = allResults.map(calculateMetrics);

  const lines: string[] = [
    '# Summary Pilot Experiment Results',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Overview',
    '',
    '| Experiment | Model | Format | Success | Avg Latency | Total Cost | Cost/Page |',
    '|------------|-------|--------|---------|-------------|------------|-----------|',
  ];

  for (const m of metrics) {
    lines.push(
      `| ${m.name} | ${m.model} | ${m.format} | ${m.successRate.toFixed(0)}% | ${m.avgLatencyMs}ms | $${m.totalCost.toFixed(4)} | $${m.costPerPage.toFixed(6)} |`
    );
  }

  lines.push('');
  lines.push('## Quality Metrics');
  lines.push('');
  lines.push('| Experiment | Avg Title Len | Titles in Range | Avg Abstract Words | Abstracts in Range |');
  lines.push('|------------|---------------|-----------------|--------------------|--------------------|');

  for (const m of metrics) {
    lines.push(
      `| ${m.name} | ${m.titleMetrics.avgLength} chars | ${m.titleMetrics.inRangePercent.toFixed(0)}% | ${m.abstractMetrics.avgWords} words | ${m.abstractMetrics.inRangePercent.toFixed(0)}% |`
    );
  }

  // Cost comparison
  lines.push('');
  lines.push('## Cost Analysis');
  lines.push('');

  const sortedByCost = [...metrics].sort((a, b) => a.costPerPage - b.costPerPage);
  const cheapest = sortedByCost[0];
  const mostExpensive = sortedByCost[sortedByCost.length - 1];

  lines.push(`- **Cheapest**: ${cheapest.name} at $${cheapest.costPerPage.toFixed(6)}/page`);
  lines.push(`- **Most expensive**: ${mostExpensive.name} at $${mostExpensive.costPerPage.toFixed(6)}/page`);
  lines.push(`- **Cost ratio**: ${(mostExpensive.costPerPage / cheapest.costPerPage).toFixed(1)}x`);

  // Scaling estimates
  lines.push('');
  lines.push('## Scaling Estimates (265 pages = full inventory)');
  lines.push('');
  lines.push('| Experiment | Est. Cost (265 pages) | Est. Cost (4.8M pages) |');
  lines.push('|------------|------------------------|------------------------|');

  for (const m of metrics) {
    const cost265 = m.costPerPage * 265;
    const cost4_8M = m.costPerPage * 4_800_000;
    lines.push(
      `| ${m.name} | $${cost265.toFixed(2)} | $${cost4_8M.toFixed(0)} |`
    );
  }

  // Sample outputs
  lines.push('');
  lines.push('## Sample Outputs');
  lines.push('');

  for (const result of allResults) {
    const samples = result.results
      .filter(r => r.parseSuccess && r.output)
      .slice(0, 3);

    if (samples.length === 0) continue;

    lines.push(`### ${result.experiment}`);
    lines.push('');

    for (const sample of samples) {
      lines.push(`**${sample.pageId}**`);
      lines.push(`- Title: ${sample.output?.title}`);
      lines.push(`- Abstract: ${sample.output?.abstract}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Print a summary to console
 */
export function printSummary(allResults: ExperimentResults[]): void {
  console.log('\n=== EXPERIMENT COMPARISON ===\n');

  const metrics = allResults.map(calculateMetrics);

  console.log('| Experiment        | Avg Latency | Total Cost | Parse Success |');
  console.log('|-------------------|-------------|------------|---------------|');

  for (const m of metrics) {
    console.log(
      `| ${m.name.padEnd(17)} | ${String(m.avgLatencyMs).padStart(7)}ms | $${m.totalCost.toFixed(4).padStart(8)} | ${m.totalPages}/${m.totalPages} (${m.successRate.toFixed(0)}%) |`
    );
  }

  console.log();
}

/**
 * Save the report to a file
 */
export function saveReport(report: string): string {
  const filepath = `${RESULTS_DIR}/../report.md`;
  writeFileSync(filepath, report);
  console.log(`Report saved to ${filepath}`);
  return filepath;
}

/**
 * Compare two specific experiments
 */
export function compareExperiments(
  result1: ExperimentResults,
  result2: ExperimentResults
): void {
  const m1 = calculateMetrics(result1);
  const m2 = calculateMetrics(result2);

  console.log(`\nComparing ${m1.name} vs ${m2.name}:`);
  console.log(`  Cost: ${m1.name} is ${(m2.costPerPage / m1.costPerPage).toFixed(1)}x ${m1.costPerPage < m2.costPerPage ? 'cheaper' : 'more expensive'}`);
  console.log(`  Latency: ${m1.name} is ${(m2.avgLatencyMs / m1.avgLatencyMs).toFixed(1)}x ${m1.avgLatencyMs < m2.avgLatencyMs ? 'faster' : 'slower'}`);
  console.log(`  Success: ${m1.successRate.toFixed(0)}% vs ${m2.successRate.toFixed(0)}%`);
}
