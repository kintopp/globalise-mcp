/**
 * LLM Provider interface for abstracted model access
 */

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

export interface LLMProvider {
  /**
   * Provider name for identification
   */
  readonly name: string;

  /**
   * Execute a completion request
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Estimate cost in USD for a given token count
   */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number;

  /**
   * Check if this provider supports the given model
   */
  supportsModel(model: string): boolean;
}
