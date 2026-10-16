/**
 * The AI engine: routes a task to a provider, enforces the monthly budget and
 * the high-cost approval gate, records every call in the `ai_runs` ledger with
 * its ILS cost, and falls back across providers on retryable failures.
 */
import { createHash } from 'node:crypto';
import type { AiRun, AiTaskType, Approval } from '@mm/db';
import { getConfig } from '../config';
import { AppError } from '../errors';
import { logger } from '../logger';
import { getApproval, markApprovalExecuted, requestApproval } from '../services/approvals';
import { notifyBrandAdmins } from '../services/notifications';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import { avatarAdapter, imageAdapter, textAdapter, ttsAdapter, videoAdapter } from './adapters';
import { estimateCostIls, snapDuration } from './catalog';
import type { AiModelKind, AiProviderId, AiTier, ModelSpec } from './catalog';
import { routeCandidates } from './router';
import type { RouteCandidate } from './router';
import { AiApprovalRequiredError, AiBudgetExceededError, AiOutputInvalidError, AiPausedError, AiProviderError } from './types';
import type { InlineImage, TalkingAvatarRequest, TextResult, TokenUsage, VideoClipRequest, VideoClipResult, VideoProgress } from './types';

/** Hebrew-heavy prompts: ≈2 characters per token on current tokenizers. */
const TOKENS_PER_CHAR = 0.5;

export interface AiUsage {
  period: string;
  capIls: number;
  spentIls: number;
  remainingIls: number;
  pct: number;
  runs: number;
  byProvider: Record<string, number>;
  byTask: Record<string, number>;
  /** ≥ 80 % used → router prefers economy models. */
  softHit: boolean;
}

export async function getAiUsage(ctx: BrandContext): Promise<AiUsage> {
  const cfg = getConfig();
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const rows = await ctx.db.aiRun.findMany({
    where: { createdAt: { gte: start }, status: { in: ['SUCCEEDED', 'RUNNING'] } },
    select: { provider: true, task: true, costIls: true },
  });
  const byProvider: Record<string, number> = {};
  const byTask: Record<string, number> = {};
  let spentIls = 0;
  for (const r of rows) {
    const c = Number(r.costIls);
    spentIls += c;
    byProvider[r.provider] = (byProvider[r.provider] ?? 0) + c;
    byTask[r.task] = (byTask[r.task] ?? 0) + c;
  }
  const capIls = cfg.AI_MONTHLY_BUDGET_ILS;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return {
    period: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
    capIls,
    spentIls: round(spentIls),
    remainingIls: round(Math.max(0, capIls - spentIls)),
    pct: capIls > 0 ? Math.round((spentIls / capIls) * 100) : 0,
    runs: rows.length,
    byProvider,
    byTask,
    softHit: capIls > 0 && spentIls / capIls >= 0.8,
  };
}

interface GateResult {
  usage: AiUsage;
  approval: Approval | null;
}

/** An approval is usable for one run of the same task, within this window, for a similar estimate. */
const APPROVAL_VOUCHER_HOURS = 24;

/**
 * Budget cap + high-cost approval gate. Throws before any provider is called.
 * Above the single-run cap the request is turned into an AI_HIGH_COST approval keyed by the
 * task + prompt hash (retrying the same request never creates a second pending approval). Once
 * approved, repeating the request consumes that approval (explicit `approvalId` or an automatic
 * lookup) and the run marks it EXECUTED, so one approval pays for exactly one run.
 */
async function gate(
  ctx: BrandContext,
  task: AiTaskType,
  label: string,
  estimateIls: number,
  approvalId: string | undefined,
  candidate: RouteCandidate,
  usage: AiUsage,
  requestHash: string,
  coveredByApprovalId?: string,
): Promise<GateResult> {
  const cfg = getConfig();
  if (!cfg.AI_ENABLED) throw new AiPausedError();
  let approval: Approval | null = null;
  let covered = false;
  if (!candidate.isMock && estimateIls > cfg.AI_SINGLE_RUN_MAX_ILS && coveredByApprovalId) {
    // A render-level approval (e.g. a whole video) covers the individual calls it pays for.
    const cover = await getApproval(ctx, coveredByApprovalId);
    if (cover.subjectType !== 'video_render' || cover.status !== 'APPROVED') throw new AiApprovalRequiredError(cover.id, estimateIls);
    covered = true;
  }
  if (!covered && !candidate.isMock && estimateIls > cfg.AI_SINGLE_RUN_MAX_ILS) {
    const subjectId = `${task}:${requestHash}`;
    if (approvalId) {
      approval = await getApproval(ctx, approvalId);
    } else {
      // Automatic voucher: an APPROVED (not yet executed) approval for this exact request.
      approval = await ctx.db.approval.findFirst({
        where: { subjectType: 'ai_task', subjectId, status: 'APPROVED', decidedAt: { gte: new Date(Date.now() - APPROVAL_VOUCHER_HOURS * 60 * 60 * 1000) } },
        orderBy: { decidedAt: 'desc' },
      });
    }
    if (approval && (approval.subjectType !== 'ai_task' || approval.status !== 'APPROVED')) {
      throw new AiApprovalRequiredError(approval.id, estimateIls);
    }
    if (!approval) {
      const created = await requestApproval(ctx, {
        type: 'AI_HIGH_COST',
        title: `פעולת AI יקרה: ${label}`,
        summary: `עלות משוערת ${estimateIls.toFixed(2)} ₪ (מעל התקרה לפעולה בודדת ${cfg.AI_SINGLE_RUN_MAX_ILS} ₪). אחרי האישור — הפעילו את אותה פעולה שוב.`,
        subjectType: 'ai_task',
        subjectId,
        estimatedCostIls: estimateIls,
        payload: { task, label, estimateIls, model: candidate.spec.modelId, provider: candidate.spec.provider },
      });
      throw new AiApprovalRequiredError(created.id, estimateIls);
    }
  }
  if (!candidate.isMock && usage.spentIls + estimateIls > usage.capIls) {
    await ctx.db.aiRun.create({
      data: {
        brandId: ctx.brandId,
        task,
        provider: candidate.spec.provider,
        modelId: candidate.spec.modelId,
        status: 'BLOCKED',
        costIls: 0,
        error: 'budget_exceeded',
        metadata: { estimateIls, capIls: usage.capIls, spentIls: usage.spentIls },
        requestedById: ctx.actor.userId || null,
      },
    });
    const recentBlock = await ctx.db.aiRun.count({ where: { status: 'BLOCKED', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (recentBlock <= 1) {
      await notifyBrandAdmins(ctx, { level: 'WARNING', title: `תקציב ה-AI החודשי של ${ctx.brand.name} מוצה`, body: `${usage.spentIls.toFixed(2)} מתוך ${usage.capIls} ₪`, link: '/app/ai' });
    }
    throw new AiBudgetExceededError({ capIls: usage.capIls, spentIls: usage.spentIls, estimateIls });
  }
  return { usage, approval };
}

function hashOf(...parts: string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

function sumUsage(a: TokenUsage | null, b: TokenUsage | null): TokenUsage | null {
  if (!a && !b) return null;
  return { inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0), outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0) };
}

/** Pull a JSON object/array out of a model reply (tolerates fences and prose around it). */
export function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const attempts = [cleaned];
  const firstObj = cleaned.indexOf('{');
  const lastObj = cleaned.lastIndexOf('}');
  if (firstObj !== -1 && lastObj > firstObj) attempts.push(cleaned.slice(firstObj, lastObj + 1));
  const firstArr = cleaned.indexOf('[');
  const lastArr = cleaned.lastIndexOf(']');
  if (firstArr !== -1 && lastArr > firstArr) attempts.push(cleaned.slice(firstArr, lastArr + 1));
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try next */
    }
  }
  return null;
}

export interface RunTextOptions {
  task: AiTaskType;
  /** Shown in approvals / run log. */
  label?: string;
  system: string;
  prompt: string;
  json?: boolean;
  tier?: AiTier;
  preferProviders?: AiProviderId[];
  maxOutputTokens?: number;
  temperature?: number;
  images?: InlineImage[];
  approvalId?: string;
  factsHash?: string;
  metadata?: Record<string, unknown>;
}

export interface RunTextResult {
  text: string;
  json: unknown | null;
  run: AiRun;
  isMock: boolean;
  modelId: string;
  provider: AiProviderId;
}

/** Labelled mocks: never in production unless AI_ALLOW_MOCK (or a demo brand); always available outside production. */
function mockAllowed(ctx: BrandContext): boolean {
  const cfg = getConfig();
  if (cfg.NODE_ENV !== 'production') return true;
  return cfg.AI_ALLOW_MOCK || ctx.brand.isDemo;
}

export async function runText(ctx: BrandContext, opts: RunTextOptions): Promise<RunTextResult> {
  assertBrandRole(ctx, 'EDITOR');
  const cfg = getConfig();
  const usage = await getAiUsage(ctx);
  const candidates = await routeCandidates(ctx.orgId, ctx.brandId, opts.task, {
    kind: 'text',
    tier: opts.tier,
    preferProviders: opts.preferProviders,
    softBudget: usage.softHit,
    allowMock: mockAllowed(ctx),
  });
  const primary = candidates[0]!;
  const inputTokens = Math.ceil((opts.system.length + opts.prompt.length) * TOKENS_PER_CHAR) + (opts.images?.length ?? 0) * 1500;
  const outputTokens = opts.maxOutputTokens ?? 2000;
  const estimateIls = primary.isMock ? 0 : estimateCostIls(primary.spec, { inputTokens, outputTokens }, cfg.USD_ILS_RATE);
  const requestHash = hashOf(opts.system, opts.prompt);
  const { approval } = await gate(ctx, opts.task, opts.label ?? opts.task, estimateIls, opts.approvalId, primary, usage, requestHash);

  const run = await ctx.db.aiRun.create({
    data: {
      brandId: ctx.brandId,
      task: opts.task,
      provider: primary.spec.provider,
      modelId: primary.spec.modelId,
      status: 'RUNNING',
      costIls: estimateIls,
      estimated: true,
      promptHash: requestHash,
      factsHash: opts.factsHash ?? null,
      requestedById: ctx.actor.userId || null,
      approvalId: approval?.id ?? null,
      metadata: { ...(opts.metadata ?? {}), label: opts.label ?? null, mock: primary.isMock, estimateIls },
    },
  });

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const adapter = textAdapter(candidate.spec.provider, candidate.apiKey);
    try {
      let result: TextResult = await adapter.generate(candidate.spec.modelId, {
        system: opts.system,
        prompt: opts.prompt,
        json: opts.json,
        maxOutputTokens: opts.maxOutputTokens,
        temperature: opts.temperature,
        images: opts.images,
      });
      let json: unknown = null;
      if (opts.json) {
        json = extractJson(result.text);
        if (json === null) {
          const repaired = await adapter.generate(candidate.spec.modelId, {
            system: 'Return ONLY a corrected, valid JSON document equivalent to the input. No prose, no fences.',
            prompt: result.text.slice(0, 20_000),
            json: true,
            maxOutputTokens: opts.maxOutputTokens,
          });
          result = { ...repaired, usage: sumUsage(result.usage, repaired.usage), latencyMs: result.latencyMs + repaired.latencyMs };
          json = extractJson(repaired.text);
          if (json === null) throw new AiOutputInvalidError();
        }
      }
      const costIls = candidate.isMock
        ? 0
        : result.usage
          ? estimateCostIls(candidate.spec, { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }, cfg.USD_ILS_RATE)
          : estimateIls;
      const updated = await ctx.db.aiRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          provider: candidate.spec.provider,
          modelId: result.modelId,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          costIls,
          costUsd: costIls / cfg.USD_ILS_RATE,
          estimated: !result.usage,
          latencyMs: result.latencyMs,
          metadata: { ...(opts.metadata ?? {}), label: opts.label ?? null, mock: candidate.isMock, estimateIls, outputChars: result.text.length },
        },
      });
      if (approval) await markApprovalExecuted(ctx, approval.id).catch(() => undefined);
      return { text: result.text, json, run: updated, isMock: candidate.isMock, modelId: result.modelId, provider: candidate.spec.provider };
    } catch (err) {
      lastError = err;
      if (err instanceof AiOutputInvalidError) break;
      logger.warn({ err, provider: candidate.spec.provider, model: candidate.spec.modelId, task: opts.task }, 'ai text candidate failed');
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await ctx.db.aiRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message.slice(0, 2000), costIls: 0 } }).catch(() => undefined);
  throw lastError instanceof AppError ? lastError : new AiProviderError(primary.spec.provider, message);
}

export interface RunImageOptions {
  task?: AiTaskType;
  label?: string;
  prompt: string;
  width: number;
  height: number;
  quality: 'low' | 'medium' | 'high';
  n?: number;
  transparent?: boolean;
  preferProviders?: AiProviderId[];
  approvalId?: string;
  metadata?: Record<string, unknown>;
}

export interface RunImageResult {
  images: InlineImage[];
  run: AiRun;
  isMock: boolean;
  modelId: string;
  provider: AiProviderId;
}

export async function runImage(ctx: BrandContext, opts: RunImageOptions): Promise<RunImageResult> {
  assertBrandRole(ctx, 'EDITOR');
  const cfg = getConfig();
  const task = opts.task ?? 'CREATIVE_BACKGROUND';
  const usage = await getAiUsage(ctx);
  const candidates = await routeCandidates(ctx.orgId, ctx.brandId, task, { kind: 'image', preferProviders: opts.preferProviders, softBudget: usage.softHit, allowMock: mockAllowed(ctx) });
  const primary = candidates[0]!;
  const n = opts.n ?? 1;
  const qualityFactor = opts.quality === 'high' ? 2 : opts.quality === 'low' ? 0.5 : 1;
  const estimateIls = primary.isMock ? 0 : estimateCostIls(primary.spec, { images: n }, cfg.USD_ILS_RATE) * qualityFactor;
  const requestHash = hashOf(opts.prompt, `${opts.width}x${opts.height}`, opts.quality, String(n));
  const { approval } = await gate(ctx, task, opts.label ?? 'יצירת תמונה', estimateIls, opts.approvalId, primary, usage, requestHash);

  const run = await ctx.db.aiRun.create({
    data: {
      brandId: ctx.brandId,
      task,
      provider: primary.spec.provider,
      modelId: primary.spec.modelId,
      status: 'RUNNING',
      images: n,
      costIls: estimateIls,
      estimated: true,
      promptHash: requestHash,
      requestedById: ctx.actor.userId || null,
      approvalId: approval?.id ?? null,
      metadata: { ...(opts.metadata ?? {}), label: opts.label ?? null, mock: primary.isMock, estimateIls, size: `${opts.width}x${opts.height}`, quality: opts.quality },
    },
  });

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const adapter = imageAdapter(candidate.spec.provider, candidate.apiKey);
    try {
      const result = await adapter.generate(candidate.spec.modelId, { prompt: opts.prompt, width: opts.width, height: opts.height, quality: opts.quality, n, transparent: opts.transparent });
      let costIls = estimateIls;
      let estimated = true;
      if (!candidate.isMock && result.usage?.outputTokens && candidate.spec.pricing.outputUsdPerMTok) {
        costIls = estimateCostIls(candidate.spec, { inputTokens: result.usage.inputTokens ?? 0, outputTokens: result.usage.outputTokens }, cfg.USD_ILS_RATE);
        estimated = false;
      } else if (!candidate.isMock && candidate.spec.pricing.usdPerImage && !candidate.spec.pricing.estimated) {
        costIls = estimateCostIls(candidate.spec, { images: result.images.length }, cfg.USD_ILS_RATE);
        estimated = false;
      }
      if (candidate.isMock) costIls = 0;
      const updated = await ctx.db.aiRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          provider: candidate.spec.provider,
          modelId: result.modelId,
          images: result.images.length,
          inputTokens: result.usage?.inputTokens ?? null,
          outputTokens: result.usage?.outputTokens ?? null,
          costIls,
          costUsd: costIls / cfg.USD_ILS_RATE,
          estimated,
          latencyMs: result.latencyMs,
        },
      });
      if (approval) await markApprovalExecuted(ctx, approval.id).catch(() => undefined);
      return { images: result.images, run: updated, isMock: candidate.isMock, modelId: result.modelId, provider: candidate.spec.provider };
    } catch (err) {
      lastError = err;
      logger.warn({ err, provider: candidate.spec.provider, model: candidate.spec.modelId }, 'ai image candidate failed');
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await ctx.db.aiRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message.slice(0, 2000), costIls: 0 } }).catch(() => undefined);
  throw lastError instanceof AppError ? lastError : new AiProviderError(primary.spec.provider, message);
}

export interface RunTtsOptions {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav';
  instructions?: string;
  speed?: number;
  label?: string;
  approvalId?: string;
  metadata?: Record<string, unknown>;
}

export interface RunTtsResult {
  audio: Buffer;
  mimeType: string;
  run: AiRun;
  isMock: boolean;
  modelId: string;
}

export async function runTts(ctx: BrandContext, opts: RunTtsOptions): Promise<RunTtsResult> {
  assertBrandRole(ctx, 'EDITOR');
  const cfg = getConfig();
  const usage = await getAiUsage(ctx);
  const candidates = await routeCandidates(ctx.orgId, ctx.brandId, 'TTS', { kind: 'tts', softBudget: usage.softHit, allowMock: mockAllowed(ctx) });
  const primary = candidates[0]!;
  const estimateIls = primary.isMock ? 0 : estimateCostIls(primary.spec, { characters: opts.text.length }, cfg.USD_ILS_RATE);
  const requestHash = hashOf(opts.text, opts.voice ?? 'alloy');
  const { approval } = await gate(ctx, 'TTS', opts.label ?? 'קריינות', estimateIls, opts.approvalId, primary, usage, requestHash);
  const run = await ctx.db.aiRun.create({
    data: {
      brandId: ctx.brandId,
      task: 'TTS',
      provider: primary.spec.provider,
      modelId: primary.spec.modelId,
      status: 'RUNNING',
      characters: opts.text.length,
      costIls: estimateIls,
      estimated: true,
      promptHash: requestHash,
      requestedById: ctx.actor.userId || null,
      approvalId: approval?.id ?? null,
      metadata: { ...(opts.metadata ?? {}), label: opts.label ?? null, mock: primary.isMock, voice: opts.voice ?? 'alloy' },
    },
  });
  let lastError: unknown = null;
  for (const candidate of candidates) {
    const adapter = ttsAdapter(candidate.spec.provider, candidate.apiKey);
    try {
      const result = await adapter.synthesize(candidate.spec.modelId, { text: opts.text, voice: opts.voice ?? 'alloy', format: opts.format ?? 'mp3', instructions: opts.instructions, speed: opts.speed });
      const costIls = candidate.isMock ? 0 : estimateIls;
      const updated = await ctx.db.aiRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', provider: candidate.spec.provider, modelId: result.modelId, characters: result.characters, costIls, costUsd: costIls / cfg.USD_ILS_RATE, estimated: true, latencyMs: result.latencyMs },
      });
      if (approval) await markApprovalExecuted(ctx, approval.id).catch(() => undefined);
      return { audio: result.audio, mimeType: result.mimeType, run: updated, isMock: candidate.isMock, modelId: result.modelId };
    } catch (err) {
      lastError = err;
      logger.warn({ err, provider: candidate.spec.provider }, 'ai tts candidate failed');
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await ctx.db.aiRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message.slice(0, 2000), costIls: 0 } }).catch(() => undefined);
  throw lastError instanceof AppError ? lastError : new AiProviderError(primary.spec.provider, message);
}

/** Real end-to-end check of one provider: a tiny prompt, recorded like any run. */
export async function probeProvider(ctx: BrandContext, provider: AiProviderId): Promise<RunTextResult> {
  return runText(ctx, {
    task: 'PROVIDER_PROBE',
    label: `בדיקת חיבור ${provider}`,
    system: 'You are a connectivity probe. Reply with exactly one Hebrew word.',
    prompt: 'כתוב את המילה "מחובר" בלבד.',
    tier: 'economy',
    preferProviders: [provider],
    maxOutputTokens: 20,
  });
}

// ---------------------------------------------------------------------------
// Motion clips and talking avatars (async provider jobs, billed per second)
// ---------------------------------------------------------------------------

interface ClipRunCommon {
  label?: string;
  tier?: AiTier;
  preferProviders?: AiProviderId[];
  approvalId?: string;
  /** A render-level approval (subjectType "video_render") that covers this call. */
  coveredByApprovalId?: string;
  onProgress?: VideoProgress;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface RunVideoOptions extends ClipRunCommon {
  request: VideoClipRequest;
}

export interface RunAvatarOptions extends ClipRunCommon {
  request: TalkingAvatarRequest;
}

export interface RunClipResult {
  clip: VideoClipResult;
  run: AiRun;
  isMock: boolean;
  modelId: string;
  provider: AiProviderId;
  spec: ModelSpec;
}

function clipSeconds(kind: 'video' | 'avatar', spec: ModelSpec, opts: RunVideoOptions | RunAvatarOptions): number {
  if (kind === 'avatar') return Math.max(1, Math.round(((opts as RunAvatarOptions).request.audio.durationMs / 1000) * 10) / 10);
  return snapDuration(spec, (opts as RunVideoOptions).request.seconds);
}

async function runClip(ctx: BrandContext, kind: 'video' | 'avatar', opts: RunVideoOptions | RunAvatarOptions): Promise<RunClipResult> {
  assertBrandRole(ctx, 'EDITOR');
  const cfg = getConfig();
  const task: AiTaskType = kind === 'video' ? 'VIDEO_CLIP' : 'AVATAR_VIDEO';
  const usage = await getAiUsage(ctx);
  const all = await routeCandidates(ctx.orgId, ctx.brandId, task, { kind: kind as AiModelKind, tier: opts.tier, preferProviders: opts.preferProviders, softBudget: usage.softHit, allowMock: mockAllowed(ctx) });
  const wantsImage = kind === 'video' && Boolean((opts as RunVideoOptions).request.image);
  const candidates = all.filter((c) => c.isMock || !wantsImage || c.spec.capabilities.imageInput !== false);
  if (candidates.length === 0) throw new AiProviderError(all[0]!.spec.provider, 'אף מודל וידאו מחובר אינו תומך בתמונת פתיחה');
  const primary = candidates[0]!;
  const withAudio = kind === 'video' ? Boolean((opts as RunVideoOptions).request.audio) : false;
  const seconds = clipSeconds(kind, primary.spec, opts);
  const estimateIls = primary.isMock ? 0 : estimateCostIls(primary.spec, { seconds, withAudio }, cfg.USD_ILS_RATE);
  const req = opts.request;
  const fingerprint =
    kind === 'video'
      ? hashOf('video', (req as VideoClipRequest).prompt, (req as VideoClipRequest).aspect, String(seconds), String(withAudio), (req as VideoClipRequest).image ? createHash('sha256').update((req as VideoClipRequest).image!.data).digest('hex') : '')
      : hashOf('avatar', (req as TalkingAvatarRequest).aspect, createHash('sha256').update((req as TalkingAvatarRequest).image.data).digest('hex'), createHash('sha256').update((req as TalkingAvatarRequest).audio.data).digest('hex'));
  const label = opts.label ?? (kind === 'video' ? 'קליפ וידאו' : 'דמות מדברת');
  const { approval } = await gate(ctx, task, label, estimateIls, opts.approvalId, primary, usage, fingerprint, opts.coveredByApprovalId);

  const run = await ctx.db.aiRun.create({
    data: {
      brandId: ctx.brandId,
      task,
      provider: primary.spec.provider,
      modelId: primary.spec.modelId,
      status: 'RUNNING',
      videoSeconds: seconds,
      costIls: estimateIls,
      estimated: true,
      promptHash: fingerprint,
      requestedById: ctx.actor.userId || null,
      approvalId: approval?.id ?? opts.coveredByApprovalId ?? null,
      metadata: { ...(opts.metadata ?? {}), label, mock: primary.isMock, estimateIls, seconds, withAudio },
    },
  });

  // Never fall back to a model that costs noticeably more than what was estimated / approved.
  const primaryRate = primary.isMock ? 0 : estimateCostIls(primary.spec, { seconds: 1, withAudio }, cfg.USD_ILS_RATE);
  let lastError: unknown = null;
  for (const candidate of candidates) {
    if (candidate !== primary && !candidate.isMock && estimateCostIls(candidate.spec, { seconds: 1, withAudio }, cfg.USD_ILS_RATE) > primaryRate * 1.2) continue;
    try {
      const clip =
        kind === 'video'
          ? await videoAdapter(candidate.spec.provider, candidate.apiKey).generate(candidate.spec, (opts as RunVideoOptions).request, { onProgress: opts.onProgress, timeoutMs: opts.timeoutMs })
          : await avatarAdapter(candidate.spec.provider, candidate.apiKey).generate(candidate.spec, (opts as RunAvatarOptions).request, { onProgress: opts.onProgress, timeoutMs: opts.timeoutMs });
      const costIls = candidate.isMock ? 0 : estimateCostIls(candidate.spec, { seconds: clip.seconds, withAudio }, cfg.USD_ILS_RATE);
      const updated = await ctx.db.aiRun.update({
        where: { id: run.id },
        data: {
          status: 'SUCCEEDED',
          provider: candidate.spec.provider,
          modelId: clip.modelId,
          videoSeconds: clip.seconds,
          costIls,
          costUsd: costIls / cfg.USD_ILS_RATE,
          estimated: Boolean(candidate.spec.pricing.estimated),
          latencyMs: clip.latencyMs,
          metadata: { ...(opts.metadata ?? {}), label, mock: candidate.isMock, estimateIls, seconds: clip.seconds, withAudio, jobId: clip.jobId },
        },
      });
      if (approval) await markApprovalExecuted(ctx, approval.id).catch(() => undefined);
      return { clip, run: updated, isMock: candidate.isMock, modelId: clip.modelId, provider: candidate.spec.provider, spec: candidate.spec };
    } catch (err) {
      lastError = err;
      logger.warn({ err, provider: candidate.spec.provider, model: candidate.spec.modelId, kind }, 'ai clip candidate failed');
      // Content-policy / validation failures are not retried on another model.
      if (!(err instanceof AiProviderError) || !err.retryable) break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  await ctx.db.aiRun.update({ where: { id: run.id }, data: { status: 'FAILED', error: message.slice(0, 2000), costIls: 0 } }).catch(() => undefined);
  throw lastError instanceof AppError ? lastError : new AiProviderError(primary.spec.provider, message);
}

/** Motion clip (text-to-video or image-to-video), recorded in the ledger at its per-second price. */
export function runVideo(ctx: BrandContext, opts: RunVideoOptions): Promise<RunClipResult> {
  return runClip(ctx, 'video', opts);
}

/** Talking character lip-synced to the given narration audio. */
export function runAvatar(ctx: BrandContext, opts: RunAvatarOptions): Promise<RunClipResult> {
  return runClip(ctx, 'avatar', opts);
}

/** The model the router would use first for a clip kind (null when no provider and mocks are not allowed). */
export async function resolveClipModel(ctx: BrandContext, kind: 'video' | 'avatar', tier?: AiTier): Promise<{ spec: ModelSpec; isMock: boolean } | null> {
  try {
    const candidates = await routeCandidates(ctx.orgId, ctx.brandId, kind === 'video' ? 'VIDEO_CLIP' : 'AVATAR_VIDEO', { kind, tier, allowMock: mockAllowed(ctx) });
    const first = candidates[0];
    return first ? { spec: first.spec, isMock: first.isMock } : null;
  } catch {
    return null;
  }
}

/** Price of `seconds` of video on the model the router would pick first (0 for mocks / no provider). */
export async function estimateClipCost(ctx: BrandContext, kind: 'video' | 'avatar', seconds: number, opts: { tier?: AiTier; withAudio?: boolean } = {}): Promise<{ ils: number; modelId: string | null; provider: AiProviderId | null; isMock: boolean }> {
  const cfg = getConfig();
  try {
    const candidates = await routeCandidates(ctx.orgId, ctx.brandId, kind === 'video' ? 'VIDEO_CLIP' : 'AVATAR_VIDEO', { kind, tier: opts.tier, allowMock: mockAllowed(ctx) });
    const first = candidates[0]!;
    const secs = kind === 'video' ? snapDuration(first.spec, seconds) : seconds;
    return { ils: first.isMock ? 0 : estimateCostIls(first.spec, { seconds: secs, withAudio: opts.withAudio }, cfg.USD_ILS_RATE), modelId: first.spec.modelId, provider: first.spec.provider, isMock: first.isMock };
  } catch {
    return { ils: 0, modelId: null, provider: null, isMock: false };
  }
}

export interface AiRunRow extends AiRun {
  costIlsNumber: number;
}

export async function listAiRuns(ctx: BrandContext, limit = 50): Promise<AiRunRow[]> {
  const rows = await ctx.db.aiRun.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map((r) => ({ ...r, costIlsNumber: Number(r.costIls) }));
}

export type { ModelSpec };
