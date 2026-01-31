/**
 * OpenRouter provider stub for future expansion
 *
 * OpenRouter provides access to multiple models (Llama, GPT-4, Mistral, etc.)
 * through a unified API.
 */

import { LLMProvider, CompletionRequest, CompletionResponse } from './types.js';

// OpenRouter model pricing (per million tokens)
const OPENROUTER_PRICING: Record<string, { input: number; output: number }> = {
  // Paid models
  'meta-llama/llama-3.3-70b-instruct': { input: 0.40, output: 0.40 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'mistralai/mistral-large-latest': { input: 2.00, output: 6.00 },
  'google/gemini-pro-1.5': { input: 1.25, output: 5.00 },
  // Free models
  'meta-llama/llama-3.3-70b-instruct:free': { input: 0, output: 0 },
  'google/gemma-3-27b-it:free': { input: 0, output: 0 },
  'qwen/qwen3-next-80b-a3b-instruct:free': { input: 0, output: 0 },
  'mistralai/mistral-small-3.1-24b-instruct:free': { input: 0, output: 0 },
  'mistralai/mistral-small-3.1-24b-instruct': { input: 0.03, output: 0.11 },
  'deepseek/deepseek-r1-0528:free': { input: 0, output: 0 },
  'nousresearch/hermes-3-llama-3.1-405b:free': { input: 0, output: 0 },
};

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter';
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || '';
    if (!this.apiKey) {
      console.warn('OPENROUTER_API_KEY not set - OpenRouter provider will not work');
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const maxRetries = 5;
    const baseDelay = 5000; // 5 seconds base delay for rate limits

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const startTime = Date.now();

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://globalise.huygens.knaw.nl',
          'X-Title': 'GLOBALISE Summary Pilot',
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          temperature: request.temperature ?? 0.3,
          messages: [
            ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
            { role: 'user', content: request.userPrompt },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json() as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          error?: { message: string };
        };
        const latencyMs = Date.now() - startTime;

        // Check for error in response body
        if (data.error) {
          throw new Error(`OpenRouter error: ${data.error.message}`);
        }

        // Handle missing data gracefully
        const content = data.choices?.[0]?.message?.content || '';
        if (!content) {
          console.log(`    Warning: Empty response from model`);
        }

        return {
          content,
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          latencyMs,
        };
      }

      // Handle rate limiting with retry
      if (response.status === 429 && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        console.log(`    Rate limited. Waiting ${delay / 1000}s before retry ${attempt + 2}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Handle 404 (model unavailable) with retry
      if (response.status === 404 && attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(1.5, attempt);
        console.log(`    Model unavailable. Waiting ${delay / 1000}s before retry ${attempt + 2}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    throw new Error('Max retries exceeded');
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = OPENROUTER_PRICING[model];
    if (!pricing) {
      // Default to moderate pricing
      return (inputTokens * 1.0 + outputTokens * 3.0) / 1_000_000;
    }

    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }

  supportsModel(model: string): boolean {
    // OpenRouter supports many models - check for common prefixes
    return (
      model.startsWith('meta-llama/') ||
      model.startsWith('openai/') ||
      model.startsWith('mistralai/') ||
      model.startsWith('google/') ||
      model.startsWith('anthropic/') ||
      model.startsWith('qwen/') ||
      model.startsWith('deepseek/') ||
      model.startsWith('nousresearch/')
    );
  }
}

export function createOpenRouterProvider(): OpenRouterProvider {
  return new OpenRouterProvider();
}
