/**
 * Core types for the summary pilot experiment
 */

export interface PageData {
  pageId: string;          // e.g., "NL-HaNA_1.04.02_10000_0043"
  filename: string;        // e.g., "NL-HaNA_1.04.02_10000_0043.xml"
  text: string;            // Plain text content
  wordCount: number;
  regions?: PageRegion[];  // Structured regions from PageXML
}

export interface PageRegion {
  id: string;
  type: 'paragraph' | 'marginalia' | 'header' | 'unknown';
  text: string;
  confidence?: number;
  lines: LineData[];
}

export interface LineData {
  id: string;
  text: string;
  confidence?: number;
}

export type InputFormat = 'plaintext' | 'pagexml-full' | 'labeled' | 'contextual';

export interface ExperimentConfig {
  name: string;
  model: string;
  modelId: string;
  inputFormat: InputFormat;
  provider: 'anthropic' | 'openrouter';
}

export interface CompletionRequest {
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens: number;
  temperature?: number;
}

export interface CompletionResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface SummaryOutput {
  title: string;
  abstract: string;
}

export interface PageResult {
  pageId: string;
  experiment: string;
  input: {
    format: InputFormat;
    wordCount: number;
    tokenCount: number;
  };
  output: SummaryOutput | null;
  parseSuccess: boolean;
  error?: string;
  metrics: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
}

export interface ExperimentResults {
  experiment: string;
  timestamp: string;
  config: ExperimentConfig;
  results: PageResult[];
  summary: {
    totalPages: number;
    successCount: number;
    avgLatencyMs: number;
    totalCost: number;
    avgTitleLength: number;
    avgAbstractWords: number;
  };
}

export interface SampleSelection {
  pageId: string;
  wordCount: number;
  stratum: 'short' | 'medium' | 'long';
}
