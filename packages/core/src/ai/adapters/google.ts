import { GoogleGenAI } from '@google/genai';
import { AiProviderError } from '../types';
import type { ImageAdapter, ImageRequest, ImageResult, TextAdapter, TextRequest, TextResult } from '../types';

function classify(err: unknown): AiProviderError {
  const status = (err as { status?: number; code?: number }).status ?? (err as { code?: number }).code;
  const message = err instanceof Error ? err.message : String(err);
  const retryable = status === 429 || status === 503 || (typeof status === 'number' && status >= 500);
  return new AiProviderError('google', `Google AI: ${message.slice(0, 300)}`, { status: status === 429 ? 429 : 502, retryable });
}

function aspectLabel(width: number, height: number): string {
  const r = width / height;
  const table: [string, number][] = [['1:1', 1], ['4:5', 0.8], ['9:16', 0.5625], ['16:9', 1.7778], ['3:4', 0.75], ['4:3', 1.3333], ['3:2', 1.5], ['2:3', 0.6667]];
  return table.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0]![0];
}

export class GoogleTextAdapter implements TextAdapter {
  readonly provider = 'google' as const;
  readonly isMock = false;
  private readonly client: GoogleGenAI;
  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(modelId: string, req: TextRequest, signal?: AbortSignal): Promise<TextResult> {
    const started = Date.now();
    try {
      const res = await this.client.models.generateContent({
        model: modelId,
        contents: [
          {
            role: 'user',
            parts: [
              ...(req.images ?? []).map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data.toString('base64') } })),
              { text: req.prompt },
            ],
          },
        ],
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxOutputTokens ?? 4096,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
          abortSignal: signal,
        },
      });
      const usage = res.usageMetadata;
      return {
        text: res.text ?? '',
        usage: usage ? { inputTokens: usage.promptTokenCount ?? 0, outputTokens: usage.candidatesTokenCount ?? 0 } : null,
        modelId,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw classify(err);
    }
  }
}

export class GoogleImageAdapter implements ImageAdapter {
  readonly provider = 'google' as const;
  readonly isMock = false;
  private readonly client: GoogleGenAI;
  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async generate(modelId: string, req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    const started = Date.now();
    try {
      const res = await this.client.models.generateContent({
        model: modelId,
        contents: req.prompt,
        config: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: aspectLabel(req.width, req.height) },
          abortSignal: signal,
        } as never,
      });
      const parts = res.candidates?.[0]?.content?.parts ?? [];
      const images = parts
        .filter((p) => p.inlineData?.data)
        .map((p) => ({ data: Buffer.from(p.inlineData!.data!, 'base64'), mimeType: p.inlineData!.mimeType ?? 'image/png' }));
      if (images.length === 0) throw new AiProviderError('google', 'Google AI returned no image data');
      const usage = res.usageMetadata;
      return {
        images,
        usage: { inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount, images: images.length },
        modelId,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw classify(err);
    }
  }
}
