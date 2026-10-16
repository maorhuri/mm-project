/**
 * Provider-agnostic contracts for the AI engine. Adapters implement these;
 * the engine (ledger, budget, approvals, QA) only ever talks to the contracts.
 */
import type { AiTaskType } from '@mm/db';
import { AppError } from '../errors';
import type { AiModelKind, AiProviderId, AiTier, ModelSpec } from './catalog';

export type { AiModelKind, AiProviderId, AiTier, ModelSpec };

export interface InlineImage {
  data: Buffer;
  mimeType: string;
}

export interface TextRequest {
  system: string;
  prompt: string;
  /** Ask the model for a single JSON object. */
  json?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  images?: InlineImage[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TextResult {
  text: string;
  usage: TokenUsage | null;
  modelId: string;
  latencyMs: number;
}

export interface TextAdapter {
  readonly provider: AiProviderId;
  readonly isMock: boolean;
  generate(modelId: string, req: TextRequest, signal?: AbortSignal): Promise<TextResult>;
}

export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  quality: 'low' | 'medium' | 'high';
  n?: number;
  transparent?: boolean;
}

export interface ImageResult {
  images: InlineImage[];
  usage: { inputTokens?: number; outputTokens?: number; images: number } | null;
  modelId: string;
  latencyMs: number;
}

export interface ImageAdapter {
  readonly provider: AiProviderId;
  readonly isMock: boolean;
  generate(modelId: string, req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
}

export interface TtsRequest {
  text: string;
  voice: string;
  format: 'mp3' | 'wav';
  speed?: number;
  /** Style guidance for models that support it (e.g. "warm Hebrew narrator"). */
  instructions?: string;
}

export interface TtsResult {
  audio: Buffer;
  mimeType: string;
  characters: number;
  modelId: string;
  latencyMs: number;
}

export interface TtsAdapter {
  readonly provider: AiProviderId;
  readonly isMock: boolean;
  synthesize(modelId: string, req: TtsRequest, signal?: AbortSignal): Promise<TtsResult>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AiProviderError extends AppError {
  readonly provider: AiProviderId;
  readonly retryable: boolean;
  constructor(provider: AiProviderId, message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(options.status ?? 502, 'ai_provider_error', message, { provider });
    this.provider = provider;
    this.retryable = options.retryable ?? false;
  }
}

export class AiNoProviderError extends AppError {
  constructor(kind: AiModelKind) {
    super(503, 'ai_no_provider', `לא מחובר ספק AI עבור ${kind === 'image' ? 'תמונות' : kind === 'tts' ? 'קריינות' : 'טקסט'} — הגדירו מפתח בעמוד האינטגרציות`);
  }
}

export class AiPausedError extends AppError {
  constructor() {
    super(503, 'ai_paused', 'מנוע ה-AI מושבת (AI_ENABLED=false)');
  }
}

export class AiBudgetExceededError extends AppError {
  constructor(details: { capIls: number; spentIls: number; estimateIls: number }) {
    super(409, 'ai_budget_exceeded', `חריגה מתקציב ה-AI החודשי (${details.spentIls.toFixed(2)} + ${details.estimateIls.toFixed(2)} > ${details.capIls} ₪)`, details);
  }
}

export class AiApprovalRequiredError extends AppError {
  readonly approvalId: string;
  constructor(approvalId: string, estimateIls: number) {
    super(409, 'ai_approval_required', `הפעולה יקרה (≈${estimateIls.toFixed(2)} ₪) ונדרש אישור במרכז האישורים`, { approvalId, estimateIls });
    this.approvalId = approvalId;
  }
}

export class AiOutputInvalidError extends AppError {
  constructor(message = 'המודל החזיר פלט לא תקין') {
    super(502, 'ai_output_invalid', message);
  }
}

export interface TaskDefaults {
  kind: AiModelKind;
  tier: AiTier;
  preferProviders: AiProviderId[];
}

/** Default routing per task (PRD §4 split: GPT for Hebrew copy, Claude for strategy/QA, Gemini for research). */
export const TASK_DEFAULTS: Record<AiTaskType, TaskDefaults> = {
  PROVIDER_PROBE: { kind: 'text', tier: 'economy', preferProviders: ['openai', 'anthropic', 'google'] },
  CREATIVE_IDEAS: { kind: 'text', tier: 'balanced', preferProviders: ['openai', 'anthropic', 'google'] },
  CREATIVE_COPY: { kind: 'text', tier: 'balanced', preferProviders: ['openai', 'anthropic', 'google'] },
  CREATIVE_BACKGROUND: { kind: 'image', tier: 'balanced', preferProviders: ['openai', 'google'] },
  QA_CLAIM_JUDGE: { kind: 'text', tier: 'economy', preferProviders: ['anthropic', 'google', 'openai'] },
  STRATEGY_BRIEF: { kind: 'text', tier: 'balanced', preferProviders: ['anthropic', 'openai', 'google'] },
  VIDEO_SCRIPT: { kind: 'text', tier: 'balanced', preferProviders: ['anthropic', 'openai', 'google'] },
  TTS: { kind: 'tts', tier: 'balanced', preferProviders: ['openai'] },
  OTHER: { kind: 'text', tier: 'balanced', preferProviders: ['openai', 'anthropic', 'google'] },
};
