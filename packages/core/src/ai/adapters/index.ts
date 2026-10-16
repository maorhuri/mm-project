import type { AiProviderId } from '../catalog';
import type { ImageAdapter, TextAdapter, TtsAdapter } from '../types';
import { AnthropicTextAdapter } from './anthropic';
import { GoogleImageAdapter, GoogleTextAdapter } from './google';
import { MockImageAdapter, MockTextAdapter, MockTtsAdapter } from './mock';
import { OpenAiImageAdapter, OpenAiTextAdapter, OpenAiTtsAdapter } from './openai';

interface AdapterOverrides {
  text?: TextAdapter;
  image?: ImageAdapter;
  tts?: TtsAdapter;
}
let overrides: AdapterOverrides = {};

/** Test hook: substitute adapters (so the engine's gates can be exercised without real providers). */
export function setAdapterOverridesForTests(next: AdapterOverrides | null): void {
  overrides = next ?? {};
}

export function textAdapter(provider: AiProviderId, apiKey: string | null): TextAdapter {
  if (overrides.text) return overrides.text;
  if (!apiKey) return new MockTextAdapter();
  switch (provider) {
    case 'anthropic':
      return new AnthropicTextAdapter(apiKey);
    case 'google':
      return new GoogleTextAdapter(apiKey);
    default:
      return new OpenAiTextAdapter(apiKey);
  }
}

export function imageAdapter(provider: AiProviderId, apiKey: string | null): ImageAdapter {
  if (overrides.image) return overrides.image;
  if (!apiKey) return new MockImageAdapter();
  return provider === 'google' ? new GoogleImageAdapter(apiKey) : new OpenAiImageAdapter(apiKey);
}

export function ttsAdapter(provider: AiProviderId, apiKey: string | null): TtsAdapter {
  if (overrides.tts) return overrides.tts;
  if (!apiKey) return new MockTtsAdapter();
  void provider;
  return new OpenAiTtsAdapter(apiKey);
}

export { AnthropicTextAdapter, GoogleImageAdapter, GoogleTextAdapter, MockImageAdapter, MockTextAdapter, MockTtsAdapter, OpenAiImageAdapter, OpenAiTextAdapter, OpenAiTtsAdapter };
