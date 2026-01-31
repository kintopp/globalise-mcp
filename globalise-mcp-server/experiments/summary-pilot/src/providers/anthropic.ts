/**
 * Anthropic provider implementation using official SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, CompletionRequest, CompletionResponse } from './types.js';
import { MODEL_PRICING } from '../config.js';

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const startTime = Date.now();

    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature ?? 0.3,
      system: request.systemPrompt,
      messages: [
        {
          role: 'user',
          content: request.userPrompt,
        },
      ],
    });

    const latencyMs = Date.now() - startTime;

    // Extract text content
    const textContent = response.content.find(block => block.type === 'text');
    const content = textContent?.type === 'text' ? textContent.text : '';

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs,
    };
  }

  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model as keyof typeof MODEL_PRICING];
    if (!pricing) {
      console.warn(`Unknown model pricing: ${model}, using Haiku rates`);
      return (inputTokens * 1.0 + outputTokens * 5.0) / 1_000_000;
    }

    return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  }

  supportsModel(model: string): boolean {
    return model.startsWith('claude-');
  }
}

/**
 * Create a default Anthropic provider
 */
export function createAnthropicProvider(): AnthropicProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }
  return new AnthropicProvider(apiKey);
}
