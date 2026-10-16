import OpenAI from 'openai';
import { AiProviderError } from '../types';
import type { ImageAdapter, ImageRequest, ImageResult, TextAdapter, TextRequest, TextResult, TtsAdapter, TtsRequest, TtsResult } from '../types';

function classify(err: unknown): AiProviderError {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  const retryable = status === 429 || (status !== undefined && status >= 500);
  return new AiProviderError('openai', `OpenAI: ${message.slice(0, 300)}`, { status: status === 429 ? 429 : 502, retryable });
}

function makeClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 2, timeout: 180_000 });
}

export class OpenAiTextAdapter implements TextAdapter {
  readonly provider = 'openai' as const;
  readonly isMock = false;
  private readonly client: OpenAI;
  constructor(apiKey: string) {
    this.client = makeClient(apiKey);
  }

  async generate(modelId: string, req: TextRequest, signal?: AbortSignal): Promise<TextResult> {
    const started = Date.now();
    const content: OpenAI.Responses.ResponseInputContent[] = [
      ...(req.images ?? []).map((img) => ({
        type: 'input_image' as const,
        image_url: `data:${img.mimeType};base64,${img.data.toString('base64')}`,
        detail: 'auto' as const,
      })),
      { type: 'input_text' as const, text: req.prompt },
    ];
    try {
      const res = await this.client.responses.create(
        {
          model: modelId,
          instructions: req.system,
          input: [{ role: 'user', content }],
          max_output_tokens: req.maxOutputTokens ?? 4096,
          ...(req.json ? { text: { format: { type: 'json_object' as const } } } : {}),
        },
        { signal },
      );
      return {
        text: res.output_text,
        usage: res.usage ? { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens } : null,
        modelId: res.model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw classify(err);
    }
  }
}

export class OpenAiImageAdapter implements ImageAdapter {
  readonly provider = 'openai' as const;
  readonly isMock = false;
  private readonly client: OpenAI;
  constructor(apiKey: string) {
    this.client = makeClient(apiKey);
  }

  async generate(modelId: string, req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    const started = Date.now();
    try {
      const res = await this.client.images.generate(
        {
          model: modelId,
          prompt: req.prompt,
          n: req.n ?? 1,
          size: `${req.width}x${req.height}` as never,
          quality: req.quality as never,
          output_format: 'png',
          ...(req.transparent ? { background: 'transparent' as const } : {}),
        },
        { signal },
      );
      const images = (res.data ?? [])
        .filter((d) => d.b64_json)
        .map((d) => ({ data: Buffer.from(d.b64_json!, 'base64'), mimeType: 'image/png' }));
      if (images.length === 0) throw new AiProviderError('openai', 'OpenAI returned no image data');
      const usage = res.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      return {
        images,
        usage: { inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens, images: images.length },
        modelId,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw classify(err);
    }
  }
}

export class OpenAiTtsAdapter implements TtsAdapter {
  readonly provider = 'openai' as const;
  readonly isMock = false;
  private readonly client: OpenAI;
  constructor(apiKey: string) {
    this.client = makeClient(apiKey);
  }

  async synthesize(modelId: string, req: TtsRequest, signal?: AbortSignal): Promise<TtsResult> {
    const started = Date.now();
    try {
      const res = await this.client.audio.speech.create(
        {
          model: modelId,
          voice: req.voice as never,
          input: req.text,
          response_format: req.format,
          ...(req.speed ? { speed: req.speed } : {}),
          ...(req.instructions ? { instructions: req.instructions } : {}),
        },
        { signal },
      );
      const audio = Buffer.from(await res.arrayBuffer());
      return { audio, mimeType: req.format === 'wav' ? 'audio/wav' : 'audio/mpeg', characters: req.text.length, modelId, latencyMs: Date.now() - started };
    } catch (err) {
      throw classify(err);
    }
  }
}
