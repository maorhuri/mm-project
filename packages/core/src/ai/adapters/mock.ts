/**
 * Clearly-labelled MOCK adapters: used only when no provider key is configured
 * and mocks are allowed (never in production by default). Every output carries
 * a visible "[MOCK]" marker so it can never be mistaken for real AI output.
 */
import sharp from 'sharp';
import type { ImageAdapter, ImageRequest, ImageResult, TextAdapter, TextRequest, TextResult, TtsAdapter, TtsRequest, TtsResult } from '../types';

export class MockTextAdapter implements TextAdapter {
  readonly provider = 'openai' as const;
  readonly isMock = true;
  async generate(modelId: string, req: TextRequest): Promise<TextResult> {
    const text = req.json
      ? JSON.stringify({ mock: true, note: '[MOCK] no AI provider configured', ideas: [], scenes: [], sections: [] })
      : `[MOCK] no AI provider configured. Prompt was ${req.prompt.length} chars.`;
    return { text, usage: { inputTokens: Math.ceil(req.prompt.length / 2), outputTokens: 40 }, modelId: `${modelId} (mock)`, latencyMs: 5 };
  }
}

export class MockImageAdapter implements ImageAdapter {
  readonly provider = 'openai' as const;
  readonly isMock = true;
  async generate(modelId: string, req: ImageRequest): Promise<ImageResult> {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${req.width}" height="${req.height}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#9333ea"/></linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <text x="50%" y="50%" fill="white" font-size="${Math.round(req.width / 14)}" font-family="sans-serif" text-anchor="middle" opacity="0.7">[MOCK IMAGE]</text>
    </svg>`;
    const data = await sharp(Buffer.from(svg)).png().toBuffer();
    return { images: [{ data, mimeType: 'image/png' }], usage: { images: 1 }, modelId: `${modelId} (mock)`, latencyMs: 20 };
  }
}

export class MockTtsAdapter implements TtsAdapter {
  readonly provider = 'openai' as const;
  readonly isMock = true;
  async synthesize(modelId: string, req: TtsRequest): Promise<TtsResult> {
    // 1 second of silence per 12 characters, 16 kHz mono PCM WAV — enough to exercise the pipeline.
    const seconds = Math.max(1, Math.min(30, Math.ceil(req.text.length / 12)));
    const sampleRate = 16_000;
    const samples = seconds * sampleRate;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + samples * 2, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(samples * 2, 40);
    return { audio: Buffer.concat([header, Buffer.alloc(samples * 2)]), mimeType: 'audio/wav', characters: req.text.length, modelId: `${modelId} (mock)`, latencyMs: 5 };
  }
}
