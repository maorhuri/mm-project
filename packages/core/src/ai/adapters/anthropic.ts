import Anthropic from '@anthropic-ai/sdk';
import { AiProviderError } from '../types';
import type { TextAdapter, TextRequest, TextResult } from '../types';

function classify(err: unknown): AiProviderError {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  const retryable = status === 429 || status === 529 || (status !== undefined && status >= 500);
  return new AiProviderError('anthropic', `Anthropic: ${message.slice(0, 300)}`, { status: status === 429 ? 429 : 502, retryable });
}

export class AnthropicTextAdapter implements TextAdapter {
  readonly provider = 'anthropic' as const;
  readonly isMock = false;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  async generate(modelId: string, req: TextRequest, signal?: AbortSignal): Promise<TextResult> {
    const started = Date.now();
    const content: Anthropic.MessageCreateParams['messages'][number]['content'] = [
      ...(req.images ?? []).map((img) => ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mimeType as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif', data: img.data.toString('base64') },
      })),
      { type: 'text' as const, text: req.prompt },
    ];
    const system = req.json ? `${req.system}\n\nRespond with a single valid JSON object and nothing else — no markdown fences, no prose.` : req.system;
    try {
      const res = await this.client.messages.create(
        {
          model: modelId,
          max_tokens: req.maxOutputTokens ?? 4096,
          system,
          messages: [{ role: 'user', content }],
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
        { signal },
      );
      const text = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return {
        text,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        modelId: res.model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw classify(err);
    }
  }
}
