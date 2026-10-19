/**
 * Model catalog — the ONLY place model identifiers and list prices live in code.
 * Every entry was verified against the provider's official documentation on
 * `verifiedAt`. The catalog seeds the `ai_models` configuration rows; the router
 * reads configuration, never these constants directly, so operators can change
 * models and prices without a deploy.
 */

export type AiProviderId = 'openai' | 'anthropic' | 'google' | 'fal';
export type AiModelKind = 'text' | 'image' | 'tts' | 'video' | 'avatar';
export type VideoAspect = '9:16' | '16:9' | '1:1';
export type AiTier = 'flagship' | 'balanced' | 'economy';

export interface ModelPricing {
  /** USD per 1M input tokens (text models; image models' text/image input). */
  inputUsdPerMTok?: number;
  /** USD per 1M output tokens. */
  outputUsdPerMTok?: number;
  /** USD per generated image (image models) — list price for the default size. */
  usdPerImage?: number;
  /** USD per 1M characters (TTS) — estimate when the provider bills by audio tokens. */
  usdPerMChars?: number;
  /** USD per generated second of video (video clips / talking avatars), without native audio. */
  usdPerSecond?: number;
  /** USD per second when native audio is generated (when the provider prices it differently). */
  usdPerSecondWithAudio?: number;
  /** True when the number is an estimate rather than a published per-unit price. */
  estimated?: boolean;
}

export interface ModelSpec {
  provider: AiProviderId;
  modelId: string;
  kind: AiModelKind;
  tier: AiTier;
  displayName: string;
  pricing: ModelPricing;
  capabilities: {
    json?: boolean;
    vision?: boolean;
    hebrew?: 'good' | 'ok';
    maxOutputTokens?: number;
    /** Video / avatar models: allowed clip durations in seconds (provider snaps to these). */
    durations?: number[];
    /** Video / avatar models: supported aspect ratios. */
    aspects?: VideoAspect[];
    resolutions?: string[];
    /** Accepts a start image (image-to-video). */
    imageInput?: boolean;
    /** Accepts reference images for subject consistency (count). */
    referenceImages?: number;
    /** Generates sound / dialogue natively. */
    nativeAudio?: boolean;
    /** Avatar: max seconds of driving audio. */
    maxAudioSeconds?: number;
    /** Video: a start image is mandatory (image-to-video endpoint). */
    requiresStartImage?: boolean;
    /** Video: reference images can be combined with a start image. */
    referenceWithStart?: boolean;
  };
  /** Routing hints: higher = preferred for quality-sensitive tasks. */
  qualityRank: number;
  verifiedAt: string;
  source: string;
  notes?: string;
}

export const USD_TO_ILS_DEFAULT = 3.7;

export const MODEL_CATALOG: ModelSpec[] = [
  // --- Anthropic ------------------------------------------------------------
  {
    provider: 'anthropic',
    modelId: 'claude-opus-5-5',
    kind: 'text',
    tier: 'flagship',
    displayName: 'Claude Opus 5.5',
    pricing: { inputUsdPerMTok: 4, outputUsdPerMTok: 20 },
    capabilities: { json: true, vision: true, hebrew: 'good', maxOutputTokens: 128_000 },
    qualityRank: 95,
    verifiedAt: '2026-10-15',
    source: 'https://platform.claude.com/docs/en/models/overview',
    notes: 'Recommended default by Anthropic for most workloads.',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-sonnet-5-5',
    kind: 'text',
    tier: 'balanced',
    displayName: 'Claude Sonnet 5.5',
    pricing: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
    capabilities: { json: true, vision: true, hebrew: 'good', maxOutputTokens: 128_000 },
    qualityRank: 88,
    verifiedAt: '2026-10-15',
    source: 'https://platform.claude.com/docs/en/models/overview',
  },
  {
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    kind: 'text',
    tier: 'economy',
    displayName: 'Claude Haiku 5.5',
    pricing: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
    capabilities: { json: true, vision: true, hebrew: 'good', maxOutputTokens: 128_000 },
    qualityRank: 70,
    verifiedAt: '2026-10-15',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing',
    notes: 'Price for prompts up to 100K tokens.',
  },
  // --- OpenAI ---------------------------------------------------------------
  {
    provider: 'openai',
    modelId: 'gpt-6-astra',
    kind: 'text',
    tier: 'flagship',
    displayName: 'GPT-6 Astra',
    pricing: { inputUsdPerMTok: 10, outputUsdPerMTok: 50 },
    capabilities: { json: true, vision: true, hebrew: 'good' },
    qualityRank: 94,
    verifiedAt: '2026-10-15',
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    provider: 'openai',
    modelId: 'gpt-6.1-sol',
    kind: 'text',
    tier: 'balanced',
    displayName: 'GPT-6.1 Sol',
    pricing: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
    capabilities: { json: true, vision: true, hebrew: 'good' },
    qualityRank: 87,
    verifiedAt: '2026-10-15',
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    provider: 'openai',
    modelId: 'gpt-6-luna',
    kind: 'text',
    tier: 'economy',
    displayName: 'GPT-6 Luna',
    pricing: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
    capabilities: { json: true, vision: true, hebrew: 'ok' },
    qualityRank: 68,
    verifiedAt: '2026-10-15',
    source: 'https://developers.openai.com/api/docs/pricing',
  },
  {
    provider: 'openai',
    modelId: 'gpt-image-2.5-flare',
    kind: 'image',
    tier: 'balanced',
    displayName: 'GPT Image 2.5 Flare',
    pricing: { inputUsdPerMTok: 8, outputUsdPerMTok: 30, usdPerImage: 0.07, estimated: true },
    capabilities: {},
    qualityRank: 85,
    verifiedAt: '2026-10-15',
    source: 'https://developers.openai.com/api/docs/guides/image-generation',
    notes: 'Billed by image tokens (gpt-image-2 rates shown on the pricing page); per-image figure is an estimate for 1024x1024 medium quality. Actual cost is computed from the usage returned by the API.',
  },
  {
    provider: 'openai',
    modelId: 'gpt-image-2.5-sunburst',
    kind: 'image',
    tier: 'flagship',
    displayName: 'GPT Image 2.5 Sunburst',
    pricing: { inputUsdPerMTok: 8, outputUsdPerMTok: 30, usdPerImage: 0.12, estimated: true },
    capabilities: {},
    qualityRank: 92,
    verifiedAt: '2026-10-15',
    source: 'https://developers.openai.com/api/docs/guides/image-generation',
    notes: 'Best for editing precision; per-image figure is an estimate.',
  },
  {
    provider: 'openai',
    modelId: 'gpt-4o-mini-tts',
    kind: 'tts',
    tier: 'balanced',
    displayName: 'GPT-4o mini TTS',
    pricing: { usdPerMChars: 15, estimated: true },
    capabilities: { hebrew: 'ok' },
    qualityRank: 80,
    verifiedAt: '2026-10-15',
    source: 'https://developers.openai.com/api/docs/pricing',
    notes: 'Billed per audio token ($12/1M audio output tokens); per-character figure is an estimate (~$0.015 per 1K chars, same as tts-1).',
  },
  // --- Google -----------------------------------------------------------------
  {
    provider: 'google',
    modelId: 'gemini-4-argon',
    kind: 'text',
    tier: 'flagship',
    displayName: 'Gemini 4 Argon',
    pricing: { inputUsdPerMTok: 2, outputUsdPerMTok: 10 },
    capabilities: { json: true, vision: true, hebrew: 'good' },
    qualityRank: 90,
    verifiedAt: '2026-10-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Price rises to $4/$20 from Dec 1, 2026. Not on the free tier.',
  },
  {
    provider: 'google',
    modelId: 'gemini-3.8-flash',
    kind: 'text',
    tier: 'balanced',
    displayName: 'Gemini 3.8 Flash',
    pricing: { inputUsdPerMTok: 0.75, outputUsdPerMTok: 3.75 },
    capabilities: { json: true, vision: true, hebrew: 'good' },
    qualityRank: 82,
    verifiedAt: '2026-10-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: 'Price rises to $1.50/$7.50 from Jan 1, 2027.',
  },
  {
    provider: 'google',
    modelId: 'gemini-3.5-flash-lite',
    kind: 'text',
    tier: 'economy',
    displayName: 'Gemini 3.5 Flash-Lite',
    pricing: { inputUsdPerMTok: 0.3, outputUsdPerMTok: 2.5 },
    capabilities: { json: true, vision: true, hebrew: 'ok' },
    qualityRank: 66,
    verifiedAt: '2026-10-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    provider: 'google',
    modelId: 'gemini-nano-banana-2.1',
    kind: 'image',
    tier: 'balanced',
    displayName: 'Nano Banana 2.1',
    pricing: { inputUsdPerMTok: 1.5, outputUsdPerMTok: 30, usdPerImage: 0.0336 },
    capabilities: {},
    qualityRank: 84,
    verifiedAt: '2026-10-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: '$0.0336 per 1K image; $0.0504 (2K), $0.113 (4K).',
  },
  {
    provider: 'google',
    modelId: 'gemini-3-pro-image',
    kind: 'image',
    tier: 'flagship',
    displayName: 'Nano Banana Pro',
    pricing: { inputUsdPerMTok: 2, outputUsdPerMTok: 120, usdPerImage: 0.134 },
    capabilities: {},
    qualityRank: 91,
    verifiedAt: '2026-10-15',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  // --- Google Veo 3.1 (motion clips, native audio) — verified 2026-10-19 ---------------------
  // All clips are requested at 1080p, which Veo only renders as 8-second clips.
  {
    provider: 'google',
    modelId: 'veo-3.1-generate-preview',
    kind: 'video',
    tier: 'flagship',
    displayName: 'Veo 3.1',
    pricing: { usdPerSecond: 0.4, usdPerSecondWithAudio: 0.4 },
    capabilities: { durations: [8], aspects: ['9:16', '16:9'], resolutions: ['1080p'], imageInput: true, referenceImages: 3, nativeAudio: true },
    qualityRank: 97,
    verifiedAt: '2026-10-19',
    source: 'https://ai.google.dev/gemini-api/docs/veo',
    notes: '$0.40/s at 720p and 1080p, $0.60/s at 4K (pricing page). Audio is always generated.',
  },
  {
    provider: 'google',
    modelId: 'veo-3.1-fast-generate-preview',
    kind: 'video',
    tier: 'balanced',
    displayName: 'Veo 3.1 Fast',
    pricing: { usdPerSecond: 0.12, usdPerSecondWithAudio: 0.12 },
    capabilities: { durations: [8], aspects: ['9:16', '16:9'], resolutions: ['1080p'], imageInput: true, referenceImages: 3, nativeAudio: true },
    qualityRank: 90,
    verifiedAt: '2026-10-19',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: '$0.10/s at 720p, $0.12/s at 1080p, $0.30/s at 4K.',
  },
  {
    provider: 'google',
    modelId: 'veo-3.1-lite-generate-preview',
    kind: 'video',
    tier: 'economy',
    displayName: 'Veo 3.1 Lite',
    pricing: { usdPerSecond: 0.08, usdPerSecondWithAudio: 0.08 },
    capabilities: { durations: [8], aspects: ['9:16', '16:9'], resolutions: ['1080p'], imageInput: true, referenceImages: 0, nativeAudio: true },
    qualityRank: 80,
    verifiedAt: '2026-10-19',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    notes: '$0.05/s at 720p, $0.08/s at 1080p. No reference images.',
  },
  // --- fal.ai — Kling 3.0 image-to-video (motion clips) — verified 2026-10-19 ---------------
  {
    provider: 'fal',
    modelId: 'fal-ai/kling-video/v3/pro/image-to-video',
    kind: 'video',
    tier: 'flagship',
    displayName: 'Kling 3.0 Pro',
    pricing: { usdPerSecond: 0.112, usdPerSecondWithAudio: 0.168 },
    capabilities: { durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], aspects: ['9:16', '16:9', '1:1'], imageInput: true, requiresStartImage: true, referenceImages: 3, referenceWithStart: true, nativeAudio: true },
    qualityRank: 96,
    verifiedAt: '2026-10-19',
    source: 'https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video',
    notes: '$0.112/s audio off, $0.168/s audio on. Native voice is Chinese/English only — we keep our own Hebrew narration.',
  },
  {
    provider: 'fal',
    modelId: 'fal-ai/kling-video/v3/standard/image-to-video',
    kind: 'video',
    tier: 'balanced',
    displayName: 'Kling 3.0 Standard',
    pricing: { usdPerSecond: 0.084, usdPerSecondWithAudio: 0.126 },
    capabilities: { durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], aspects: ['9:16', '16:9', '1:1'], imageInput: true, requiresStartImage: true, referenceImages: 3, referenceWithStart: true, nativeAudio: true },
    qualityRank: 90,
    verifiedAt: '2026-10-19',
    source: 'https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video',
    notes: '$0.084/s audio off, $0.126/s audio on.',
  },
  // --- fal.ai — Kling AI Avatar v2 (image + our audio → lip-synced talking video) ----------
  {
    provider: 'fal',
    modelId: 'fal-ai/kling-video/ai-avatar/v2/pro',
    kind: 'avatar',
    tier: 'flagship',
    displayName: 'Kling AI Avatar v2 Pro',
    pricing: { usdPerSecond: 0.115 },
    capabilities: { aspects: ['9:16', '16:9', '1:1'], imageInput: true },
    qualityRank: 95,
    verifiedAt: '2026-10-19',
    source: 'https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/pro',
    notes: 'Output length follows the audio file. Lip-sync is driven by the audio, so any language works.',
  },
  {
    provider: 'fal',
    modelId: 'fal-ai/kling-video/ai-avatar/v2/standard',
    kind: 'avatar',
    tier: 'balanced',
    displayName: 'Kling AI Avatar v2 Standard',
    pricing: { usdPerSecond: 0.0562 },
    capabilities: { aspects: ['9:16', '16:9', '1:1'], imageInput: true },
    qualityRank: 88,
    verifiedAt: '2026-10-19',
    source: 'https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard',
  },
];

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI (Gemini)',
  fal: 'fal.ai',
};

/** Snap a wanted duration to the model's allowed durations (smallest ≥ wanted, else the longest). */
export function snapDuration(spec: Pick<ModelSpec, 'capabilities'>, wantedSec: number): number {
  const allowed = [...(spec.capabilities.durations ?? [])].sort((a, b) => a - b);
  if (allowed.length === 0) return Math.max(1, Math.ceil(wantedSec));
  return allowed.find((d) => d >= wantedSec) ?? allowed[allowed.length - 1]!;
}

export function catalogFor(provider: AiProviderId, kind?: AiModelKind): ModelSpec[] {
  return MODEL_CATALOG.filter((m) => m.provider === provider && (!kind || m.kind === kind));
}

export function findModel(provider: AiProviderId, modelId: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.modelId === modelId);
}

/** Estimate the ILS cost of a run from token / unit counts using catalog prices. */
export function estimateCostIls(
  spec: Pick<ModelSpec, 'pricing'>,
  usage: { inputTokens?: number; outputTokens?: number; images?: number; characters?: number; seconds?: number; withAudio?: boolean },
  usdToIls = USD_TO_ILS_DEFAULT,
): number {
  const p = spec.pricing;
  let usd = 0;
  if (usage.inputTokens && p.inputUsdPerMTok) usd += (usage.inputTokens / 1_000_000) * p.inputUsdPerMTok;
  if (usage.outputTokens && p.outputUsdPerMTok) usd += (usage.outputTokens / 1_000_000) * p.outputUsdPerMTok;
  if (usage.images && p.usdPerImage && !(usage.outputTokens && p.outputUsdPerMTok)) usd += usage.images * p.usdPerImage;
  if (usage.characters && p.usdPerMChars) usd += (usage.characters / 1_000_000) * p.usdPerMChars;
  if (usage.seconds) {
    const perSecond = usage.withAudio && p.usdPerSecondWithAudio !== undefined ? p.usdPerSecondWithAudio : p.usdPerSecond;
    if (perSecond) usd += usage.seconds * perSecond;
  }
  return Math.round(usd * usdToIls * 10_000) / 10_000;
}
