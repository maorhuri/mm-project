/**
 * Video Studio: grounded AI script (QA'd) → per-scene narration (TTS, cached) →
 * scene visual — a branded card / library image / AI image (with Ken Burns
 * motion), a library video, an AI motion clip, or a brand character lip-synced
 * to the narration → FFmpeg composition with a static text/logo overlay →
 * burnt-in Hebrew subtitles. Rendering runs in the worker with progress
 * updates; expensive renders need an approval first.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type { BrandCharacter, MediaAsset, Prisma, SceneVisualKind, VideoProject, VideoScene, VideoStatus } from '@mm/db';
import { z } from 'zod';
import { catalogFor, estimateCostIls, snapDuration } from '../ai/catalog';
import type { AiTier, VideoAspect } from '../ai/catalog';
import { resolveClipModel, runAvatar, runImage, runText, runTts, runVideo } from '../ai/engine';
import type { RunTextResult } from '../ai/engine';
import { buildFactsPacket, groundingRules } from '../ai/facts';
import { runCopyQa } from '../ai/qa';
import type { QaFinding, QaReport } from '../ai/qa';
import { orderByTier } from '../ai/router';
import { AiApprovalRequiredError, AiOutputInvalidError } from '../ai/types';
import { auditFromContext } from '../audit';
import { getConfig } from '../config';
import { ASPECTS, documentMediaIds, splitForMotion } from '../creative/document';
import type { CreativeDocument } from '../creative/document';
import { fontsDir, renderFontSources } from '../creative/fonts';
import { documentToHtml } from '../creative/html';
import { buildDocument, buildReelOverlay, subtitleBand } from '../creative/templates';
import type { ComposeKit } from '../creative/templates';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { JOBS, QUEUES, getQueue } from '../jobs/queues';
import { logger } from '../logger';
import { assembleVideo, composeScene, effectiveDurations, extractFrame, ffprobeDurationMs, probeMedia } from '../media/ffmpeg';
import type { SceneBackground, StillMotion } from '../media/ffmpeg';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import { slugify } from '../validation';
import type { VideoProjectInput, VideoSceneUpdateInput, VideoScriptRequestInput, VideoSettingsInput } from '../validation';
import { markApprovalExecuted, registerApprovalHandler, requestApproval } from './approvals';
import { loadComposeKit, loadImageDataUrls } from './creative';
import type { RenderBackend } from './creative';
import { getMedia, openMediaObject, readMediaBuffer, uploadMedia } from './media';

export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
  DRAFT: 'טיוטה',
  SCRIPTED: 'יש תסריט',
  RENDERING: 'מרנדר',
  READY: 'מוכן',
  FAILED: 'נכשל',
  APPROVED: 'אושר',
};

export const SCENE_KIND_LABELS: Record<SceneVisualKind, string> = {
  CARD: 'כרטיסייה ממותגת',
  MEDIA: 'תמונה מהספרייה',
  AI_IMAGE: 'תמונת AI',
  MEDIA_VIDEO: 'וידאו מהספרייה',
  AI_VIDEO: 'וידאו AI (תנועה)',
  AVATAR: 'דמות מדברת',
};

/** Hebrew narration pace used for estimates before the audio exists. */
const CHARS_PER_SECOND = 14;
/** Silence after each scene's narration. */
const SCENE_TAIL_MS = 500;
const DEFAULT_NARRATOR = 'Warm, clear Hebrew narrator for a short marketing video. Natural pace.';
/** Cross-fade between scenes. */
const TRANSITION_MS = 350;
const CLIP_NEGATIVE = 'on-screen text, captions, subtitles, letters, words, logos, watermark, distorted faces, extra fingers, blurry';

// ---------------------------------------------------------------------------
// Projects & scenes
// ---------------------------------------------------------------------------

export interface VideoProjectRow extends VideoProject {
  sceneCount: number;
}

export async function listVideoProjects(ctx: BrandContext): Promise<VideoProjectRow[]> {
  const rows = await ctx.db.videoProject.findMany({ orderBy: { updatedAt: 'desc' }, include: { _count: { select: { scenes: true } } } });
  return rows.map(({ _count, ...p }) => ({ ...p, sceneCount: _count.scenes }));
}

export async function createVideoProject(ctx: BrandContext, input: VideoProjectInput): Promise<VideoProject> {
  assertBrandRole(ctx, 'EDITOR');
  if (input.productId) {
    const product = await ctx.db.brandProduct.findUnique({ where: { id: input.productId } });
    if (!product) throw new NotFoundError('product');
  }
  const project = await ctx.db.videoProject.create({
    data: { brandId: ctx.brandId, title: input.title, goal: input.goal ?? null, productId: input.productId ?? null, aspect: input.aspect, voice: input.voice, createdById: ctx.actor.userId || null },
  });
  await auditFromContext(ctx, { action: 'video.project.create', entityType: 'video_project', entityId: project.id, after: { title: project.title, aspect: project.aspect } });
  return project;
}

export async function updateVideoSettings(ctx: BrandContext, projectId: string, input: VideoSettingsInput): Promise<VideoProject> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  if (isActivelyRendering(project)) throw new ConflictError('הסרטון מרונדר כעת');
  if (input.musicMediaId) {
    const music = await getMedia(ctx, input.musicMediaId);
    if (music.kind !== 'AUDIO') throw new ValidationError('יש לבחור קובץ שמע', [{ path: 'musicMediaId', message: 'לא קובץ שמע' }]);
  }
  const updated = await ctx.db.videoProject.update({
    where: { id: projectId },
    data: {
      voice: input.voice,
      motionStills: input.motionStills,
      videoTier: input.videoTier,
      ambientAudio: input.ambientAudio,
      transitions: input.transitions,
      musicMediaId: input.musicMediaId ?? null,
      musicVolume: input.musicVolume,
    },
  });
  await auditFromContext(ctx, { action: 'video.settings', entityType: 'video_project', entityId: projectId, before: { voice: project.voice, motionStills: project.motionStills, videoTier: project.videoTier, ambientAudio: project.ambientAudio }, after: input });
  return updated;
}

export interface VideoProjectDetail {
  project: VideoProject;
  scenes: VideoScene[];
  product: { id: string; name: string } | null;
  characters: BrandCharacter[];
  estimate: VideoCostEstimate;
}

export async function getVideoProject(ctx: BrandContext, projectId: string): Promise<VideoProjectDetail> {
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  const [scenes, product, characters] = await Promise.all([
    ctx.db.videoScene.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
    project.productId ? ctx.db.brandProduct.findUnique({ where: { id: project.productId }, select: { id: true, name: true } }) : Promise.resolve(null),
    ctx.db.brandCharacter.findMany({ orderBy: { name: 'asc' } }),
  ]);
  const estimate = await estimateVideoProject(ctx, project, scenes, new Map(characters.map((c) => [c.id, c])));
  return { project, scenes, product, characters, estimate };
}

export async function deleteVideoProject(ctx: BrandContext, projectId: string): Promise<void> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  if (isActivelyRendering(project)) throw new ConflictError('הסרטון מרונדר כעת');
  await ctx.db.videoProject.delete({ where: { id: projectId } });
  await auditFromContext(ctx, { action: 'video.project.delete', entityType: 'video_project', entityId: projectId, before: { title: project.title } });
}

// ---------------------------------------------------------------------------
// Caches (narration, generated images, generated clips) — a re-render only pays for what changed
// ---------------------------------------------------------------------------

export interface SceneCache {
  ttsKey?: string;
  imageKey?: string;
  imageMediaId?: string;
  clipKey?: string;
  clipProvider?: string;
  clipModel?: string;
  clipSeconds?: number;
  clipCostIls?: number;
  clipMock?: boolean;
  clipHasAudio?: boolean;
}

export function sceneCache(scene: Pick<VideoScene, 'clipMeta'>): SceneCache {
  const meta = scene.clipMeta;
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as SceneCache) : {};
}

const key = (...parts: (string | number | boolean | null | undefined)[]) =>
  createHash('sha256')
    .update(parts.map((p) => String(p ?? '')).join('\u0000'))
    .digest('hex')
    .slice(0, 24);

type ProjectLike = Pick<VideoProject, 'aspect' | 'voice' | 'videoTier' | 'ambientAudio' | 'motionStills'>;
type SceneLike = Pick<VideoScene, 'narration' | 'visualKind' | 'visualPrompt' | 'motionPrompt' | 'mediaId' | 'characterId' | 'onScreenText'>;

export function narrationVoice(project: Pick<VideoProject, 'voice'>, scene: Pick<VideoScene, 'visualKind'>, character: BrandCharacter | null): { voice: string; instructions: string } {
  // A speaking character always uses its own voice; other scenes use the project narrator.
  if (character && scene.visualKind === 'AVATAR') return { voice: character.voice, instructions: character.voiceInstructions ?? DEFAULT_NARRATOR };
  return { voice: project.voice, instructions: DEFAULT_NARRATOR };
}

export function ttsCacheKey(narration: string, voice: string, instructions: string): string {
  return key('tts', narration, voice, instructions);
}

function imagePrompt(scene: SceneLike): string {
  return scene.visualPrompt ?? scene.onScreenText ?? scene.narration;
}

export function imageCacheKey(project: Pick<VideoProject, 'aspect'>, scene: SceneLike): string {
  return key('img', project.aspect, imagePrompt(scene));
}

export function clipCacheKey(project: ProjectLike, scene: SceneLike, character: BrandCharacter | null): string | null {
  if (scene.visualKind === 'AI_VIDEO') {
    return key('clip', project.aspect, project.videoTier, project.ambientAudio, scene.visualPrompt, scene.motionPrompt, scene.mediaId, character?.imageMediaId, character?.description, scene.mediaId ? '' : imageCacheKey(project, scene));
  }
  if (scene.visualKind === 'AVATAR') {
    const voice = narrationVoice(project, scene, character);
    return key('avatar', project.aspect, project.videoTier, character?.imageMediaId, voice.voice, voice.instructions, scene.narration, scene.motionPrompt);
  }
  return null;
}

/** Fingerprint of everything that changes the cost of a render (binds a render approval to a configuration). */
export function renderConfigHash(project: ProjectLike, scenes: (SceneLike & { id: string })[]): string {
  return key('render', project.aspect, project.voice, project.videoTier, project.ambientAudio, project.motionStills, ...scenes.flatMap((s) => [s.id, s.visualKind, s.narration, s.visualPrompt, s.motionPrompt, s.mediaId, s.characterId]));
}

export function projectVideoAspect(aspect: VideoProject['aspect']): VideoAspect {
  return aspect === 'R16X9' || aspect === 'R191X1' ? '16:9' : aspect === 'R1X1' ? '1:1' : '9:16';
}

function estimatedSceneSeconds(narration: string): number {
  return Math.max(2, Math.round((narration.length / CHARS_PER_SECOND) * 10) / 10) + SCENE_TAIL_MS / 1000;
}

// ---------------------------------------------------------------------------
// Cost estimate (before rendering)
// ---------------------------------------------------------------------------

export interface VideoCostEstimate {
  characters: number;
  ttsIls: number;
  aiImages: number;
  imagesIls: number;
  videoSeconds: number;
  videoIls: number;
  avatarSeconds: number;
  avatarIls: number;
  cachedClips: number;
  totalIls: number;
  estimatedSeconds: number;
  videoModel: string | null;
  avatarModel: string | null;
  /** AI_VIDEO / AVATAR scenes exist but no provider (and no mock) can serve them. */
  videoProviderMissing: boolean;
  avatarProviderMissing: boolean;
  /** Clips will be labelled mocks (non-production / demo brand). */
  mockClips: boolean;
  capIls: number;
  needsApproval: boolean;
}

export async function estimateVideoProject(ctx: BrandContext, project: VideoProject, scenes: VideoScene[], characters: Map<string, BrandCharacter>): Promise<VideoCostEstimate> {
  const cfg = getConfig();
  const tier = project.videoTier as AiTier;
  const tts = orderByTier(catalogFor('openai', 'tts'), 'balanced')[0];
  const image = orderByTier(catalogFor('openai', 'image'), 'balanced')[0];
  let characters_ = 0;
  let aiImages = 0;
  let videoSeconds = 0;
  let videoIls = 0;
  let avatarSeconds = 0;
  let avatarIls = 0;
  let cachedClips = 0;
  const needVideo = scenes.some((s) => s.visualKind === 'AI_VIDEO');
  const needAvatar = scenes.some((s) => s.visualKind === 'AVATAR');
  const [videoModel, avatarModel] = await Promise.all([needVideo ? resolveClipModel(ctx, 'video', tier) : null, needAvatar ? resolveClipModel(ctx, 'avatar', tier) : null]);
  for (const s of scenes) {
    const character = s.characterId ? (characters.get(s.characterId) ?? null) : null;
    const cache = sceneCache(s);
    const voice = narrationVoice(project, s, character);
    if (!(cache.ttsKey === ttsCacheKey(s.narration, voice.voice, voice.instructions) && s.audioMediaId)) characters_ += s.narration.length;
    const seconds = estimatedSceneSeconds(s.narration);
    const imageCached = (cache.imageKey === imageCacheKey(project, s) && Boolean(cache.imageMediaId)) || (s.visualKind === 'AI_IMAGE' && Boolean(s.mediaId) && !cache.imageKey);
    if (s.visualKind === 'AI_IMAGE' && !imageCached) aiImages += 1;
    const clipKey = clipCacheKey(project, s, character);
    const clipCached = Boolean(clipKey && cache.clipKey === clipKey && s.clipMediaId);
    if (s.visualKind === 'AI_VIDEO') {
      if (clipCached) cachedClips += 1;
      else {
        if (!s.mediaId && !character && !imageCached) aiImages += 1;
        const secs = videoModel ? snapDuration(videoModel.spec, seconds) : Math.ceil(seconds);
        videoSeconds += secs;
        if (videoModel && !videoModel.isMock) videoIls += estimateCostIls(videoModel.spec, { seconds: secs, withAudio: project.ambientAudio }, cfg.USD_ILS_RATE);
      }
    }
    if (s.visualKind === 'AVATAR') {
      if (clipCached) cachedClips += 1;
      else {
        avatarSeconds += seconds;
        if (avatarModel && !avatarModel.isMock) avatarIls += estimateCostIls(avatarModel.spec, { seconds }, cfg.USD_ILS_RATE);
      }
    }
  }
  const ttsIls = tts ? estimateCostIls(tts, { characters: characters_ }, cfg.USD_ILS_RATE) : 0;
  const imagesIls = image ? estimateCostIls(image, { images: aiImages }, cfg.USD_ILS_RATE) : 0;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  const totalIls = round(ttsIls + imagesIls + videoIls + avatarIls);
  return {
    characters: characters_,
    ttsIls: round(ttsIls),
    aiImages,
    imagesIls: round(imagesIls),
    videoSeconds: round(videoSeconds),
    videoIls: round(videoIls),
    avatarSeconds: round(avatarSeconds),
    avatarIls: round(avatarIls),
    cachedClips,
    totalIls,
    estimatedSeconds: Math.round(scenes.reduce((n, s) => n + estimatedSceneSeconds(s.narration), 0)),
    videoModel: videoModel?.spec.modelId ?? null,
    avatarModel: avatarModel?.spec.modelId ?? null,
    videoProviderMissing: needVideo && !videoModel,
    avatarProviderMissing: needAvatar && !avatarModel,
    mockClips: Boolean(videoModel?.isMock || avatarModel?.isMock),
    capIls: cfg.AI_SINGLE_RUN_MAX_ILS,
    needsApproval: totalIls > cfg.AI_SINGLE_RUN_MAX_ILS,
  };
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

const scriptOutputSchema = z.object({
  title: z.string().max(200).default(''),
  scenes: z
    .array(
      z.object({
        narration: z.string().min(1).max(600),
        onScreenText: z.string().max(160).nullish(),
        visualPrompt: z.string().max(800).nullish(),
        motionPrompt: z.string().max(500).nullish(),
        claims: z.array(z.object({ text: z.string().max(400), factIds: z.array(z.string().max(24)).default([]) })).default([]),
      }),
    )
    .default([]),
});

const SCRIPT_FORMAT = `
## פורמט הפלט (JSON בלבד)
{"title":"שם הסרטון","scenes":[{"narration":"משפט קריינות טבעי בעברית, עד 20 מילים (כ-6 שניות)","onScreenText":"עד 6 מילים על המסך","visualPrompt":"English cinematic shot description for a premium ad: subject, setting, lighting, lens, colour grade. No text, no logos.","motionPrompt":"English camera move + action, e.g. 'slow dolly-in while the developer smiles and turns to camera'","claims":[{"text":"משפט עובדתי","factIds":["P1.F1"]}]}]}
- כל סצנה היא שוט פרסומי ברמה של סרט: ויז'ואל ספציפי ומרשים, לא קלישאות כלליות; התנועה ב-motionPrompt דינמית ומשרתת את המסר.
- הסצנה הראשונה היא הוק (3 שניות), האחרונה קריאה לפעולה.
- הקריינות נשמעת בקול רם: ללא סוגריים, ללא קיצורים, מספרים במילים כשזה טבעי.
- onScreenText קצר וחד, לא חוזר מילה במילה על הקריינות.`;

export function qaScript(scenes: { narration: string; onScreenText: string | null }[], packet: Parameters<typeof runCopyQa>[1]): QaReport {
  const findings: QaFinding[] = [];
  scenes.forEach((s, i) => {
    const report = runCopyQa({ narration: s.narration, onScreenText: s.onScreenText }, packet);
    for (const f of report.findings) findings.push({ ...f, field: `סצנה ${i + 1} · ${f.field === 'narration' ? 'קריינות' : 'טקסט על המסך'}` });
  });
  const status = findings.some((f) => f.severity === 'BLOCK') ? 'BLOCKED' : findings.length ? 'WARN' : 'PASSED';
  return { status, findings, ranAt: new Date().toISOString() };
}

export async function generateVideoScript(ctx: BrandContext, projectId: string, input: VideoScriptRequestInput): Promise<{ project: VideoProject; scenes: VideoScene[]; run: RunTextResult }> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  if (isActivelyRendering(project)) throw new ConflictError('הסרטון מרונדר כעת');
  const product = project.productId ? await ctx.db.brandProduct.findUnique({ where: { id: project.productId } }) : null;
  const packet = await buildFactsPacket(ctx);
  const prompt = [
    '<user_request>',
    `כתוב תסריט לסרטון קצר (${input.targetSeconds} שניות, ${input.sceneCount} סצנות) ביחס ${ASPECTS[project.aspect].ratio}.`,
    project.goal ? `מטרה: ${project.goal}` : '',
    product ? `המוצר/השירות במוקד: ${product.name}` : '',
    input.extra ?? '',
    '</user_request>',
  ]
    .filter(Boolean)
    .join('\n');
  const run = await runText(ctx, {
    task: 'VIDEO_SCRIPT',
    label: `תסריט ל-${project.title}`,
    system: `${groundingRules(packet)}\n\nאתה תסריטאי לסרטוני שיווק קצרים.${SCRIPT_FORMAT}`,
    prompt,
    json: true,
    maxOutputTokens: 3500,
    factsHash: packet.hash,
    metadata: { projectId },
  });
  const parsed = scriptOutputSchema.safeParse(run.json);
  if (!parsed.success) throw new AiOutputInvalidError('המודל החזיר תסריט במבנה לא צפוי — נסו שוב');
  let scenes = parsed.data.scenes.slice(0, input.sceneCount);
  if (run.isMock && scenes.length === 0) {
    scenes = [
      { narration: `[MOCK] ברוכים הבאים ל${packet.brandName}`, onScreenText: '[MOCK] סצנה 1', visualPrompt: null, claims: [] },
      { narration: '[MOCK] חברו מפתח AI כדי לקבל תסריט אמיתי', onScreenText: '[MOCK] סצנה 2', visualPrompt: null, claims: [] },
    ];
  }
  if (scenes.length === 0) throw new AiOutputInvalidError('המודל לא החזיר סצנות — נסו שוב');
  const qa = qaScript(
    scenes.map((s) => ({ narration: s.narration, onScreenText: s.onScreenText ?? null })),
    packet,
  );
  await ctx.db.videoScene.deleteMany({ where: { projectId } });
  const rows: VideoScene[] = [];
  for (const [i, s] of scenes.entries()) {
    rows.push(
      await ctx.db.videoScene.create({
        data: {
          brandId: ctx.brandId,
          projectId,
          order: i + 1,
          narration: s.narration.trim(),
          onScreenText: s.onScreenText?.trim() || null,
          visualKind: input.defaultKind ?? 'CARD',
          visualPrompt: s.visualPrompt?.trim() || null,
          motionPrompt: s.motionPrompt?.trim() || null,
        },
      }),
    );
  }
  const updated = await ctx.db.videoProject.update({
    where: { id: projectId },
    data: {
      status: 'SCRIPTED',
      title: project.title,
      qa: qa as unknown as Prisma.InputJsonObject,
      factsHash: packet.hash,
      outputMediaId: null,
      subtitlesSrt: null,
      durationMs: null,
      renderProgress: 0,
      renderStep: null,
      renderError: null,
      approvalId: null,
      renderApprovalId: null,
    },
  });
  await auditFromContext(ctx, { action: 'video.script.generate', entityType: 'video_project', entityId: projectId, after: { scenes: rows.length, model: run.modelId, mock: run.isMock, qa: qa.status } });
  return { project: updated, scenes: rows, run };
}

async function assertMediaKind(ctx: BrandContext, mediaId: string, kind: 'IMAGE' | 'VIDEO', field = 'mediaId'): Promise<MediaAsset> {
  const media = await getMedia(ctx, mediaId);
  if (media.kind !== kind || (kind === 'IMAGE' && media.mimeType === 'image/svg+xml')) {
    throw new ValidationError(kind === 'IMAGE' ? 'יש לבחור תמונה (PNG / JPG / WebP)' : 'יש לבחור קובץ וידאו', [{ path: field, message: 'סוג קובץ לא מתאים' }]);
  }
  return media;
}

export async function updateVideoScene(ctx: BrandContext, sceneId: string, input: VideoSceneUpdateInput): Promise<VideoScene> {
  assertBrandRole(ctx, 'EDITOR');
  const scene = await ctx.db.videoScene.findUnique({ where: { id: sceneId }, include: { project: true } });
  if (!scene) throw new NotFoundError('scene');
  if (isActivelyRendering(scene.project)) throw new ConflictError('הסרטון מרונדר כעת');
  const kind = input.visualKind;
  let mediaId: string | null = null;
  if (kind === 'MEDIA') {
    if (!input.mediaId) throw new ValidationError('יש לבחור תמונה מהספרייה', [{ path: 'mediaId', message: 'חובה' }]);
    mediaId = (await assertMediaKind(ctx, input.mediaId, 'IMAGE')).id;
  } else if (kind === 'MEDIA_VIDEO') {
    if (!input.mediaId) throw new ValidationError('יש לבחור וידאו מהספרייה', [{ path: 'mediaId', message: 'חובה' }]);
    mediaId = (await assertMediaKind(ctx, input.mediaId, 'VIDEO')).id;
  } else if (kind === 'AI_VIDEO' && input.mediaId) {
    // Optional start frame for the motion clip.
    mediaId = (await assertMediaKind(ctx, input.mediaId, 'IMAGE')).id;
  } else if (kind === 'AI_IMAGE' && scene.visualKind === 'AI_IMAGE' && (input.visualPrompt ?? null) === scene.visualPrompt) {
    // Image generated by an earlier render for the same prompt.
    mediaId = scene.mediaId;
  }
  let characterId: string | null = null;
  if (kind === 'AVATAR' || (kind === 'AI_VIDEO' && input.characterId)) {
    if (!input.characterId) throw new ValidationError('יש לבחור דמות', [{ path: 'characterId', message: 'חובה' }]);
    const character = await ctx.db.brandCharacter.findUnique({ where: { id: input.characterId } });
    if (!character || !character.isActive) throw new ValidationError('הדמות לא נמצאה', [{ path: 'characterId', message: 'לא נמצאה' }]);
    characterId = character.id;
  }
  const updated = await ctx.db.videoScene.update({
    where: { id: sceneId },
    data: {
      narration: input.narration,
      onScreenText: input.onScreenText ?? null,
      visualKind: kind,
      mediaId,
      visualPrompt: input.visualPrompt ?? null,
      motionPrompt: input.motionPrompt ?? null,
      characterId,
      // The last render no longer reflects this scene; caches (narration / image / clip) are kept and re-validated by key.
      renderedImageId: null,
      approved: false,
      durationMs: null,
    },
  });
  const scenes = await ctx.db.videoScene.findMany({ where: { projectId: scene.projectId }, orderBy: { order: 'asc' } });
  const packet = await buildFactsPacket(ctx);
  const qa = qaScript(scenes, packet);
  await ctx.db.videoProject.update({
    where: { id: scene.projectId },
    data: { qa: qa as unknown as Prisma.InputJsonObject, status: scene.project.status === 'READY' || scene.project.status === 'APPROVED' || scene.project.status === 'FAILED' ? 'SCRIPTED' : scene.project.status, approvalId: null },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Render (start → worker)
// ---------------------------------------------------------------------------

/** A render that has not reported progress for this long is considered dead (worker crash) and may be restarted. */
export const STALE_RENDER_MS = 30 * 60_000;

/** RENDERING that still reports progress; a silent render (worker died) no longer locks the project. */
export function isActivelyRendering(project: Pick<VideoProject, 'status' | 'updatedAt'>): boolean {
  return project.status === 'RENDERING' && project.updatedAt.getTime() >= Date.now() - STALE_RENDER_MS;
}

type RenderDispatcher = (ctx: BrandContext, projectId: string) => Promise<void>;
const defaultDispatcher: RenderDispatcher = async (ctx, projectId) => {
  await getQueue(QUEUES.video).add(
    JOBS.videoRender,
    { brandId: ctx.brandId, projectId, actorUserId: ctx.actor.userId || null, idempotencyKey: `video.render:${projectId}:${Date.now()}` },
    { attempts: 1 },
  );
};
let dispatcher: RenderDispatcher = defaultDispatcher;
export function setVideoRenderDispatcher(fn: RenderDispatcher | null): void {
  dispatcher = fn ?? defaultDispatcher;
}

async function dispatchRender(ctx: BrandContext, projectId: string, renderApprovalId: string | null, estimateIls: number): Promise<VideoProject> {
  const updated = await ctx.db.videoProject.update({
    where: { id: projectId },
    data: { status: 'RENDERING', renderProgress: 0, renderStep: 'בתור', renderError: null, approvalId: null, renderApprovalId, estimateIls, cancelRequested: false },
  });
  try {
    await dispatcher(ctx, projectId);
  } catch (err) {
    logger.error({ err, projectId }, 'video render could not be queued');
    return ctx.db.videoProject.update({ where: { id: projectId }, data: { status: 'FAILED', renderError: 'תור הרינדור אינו זמין — נסו שוב' } });
  }
  await auditFromContext(ctx, { action: 'video.render.start', entityType: 'video_project', entityId: projectId, after: { estimateIls, renderApprovalId } });
  return updated;
}

export async function startVideoRender(ctx: BrandContext, projectId: string): Promise<VideoProject> {
  assertBrandRole(ctx, 'EDITOR');
  const { project, scenes, estimate, characters } = await getVideoProject(ctx, projectId);
  if (isActivelyRendering(project)) throw new ConflictError('הסרטון כבר מרונדר');
  if (scenes.length === 0) throw new ConflictError('אין סצנות — צרו תסריט תחילה');
  const qa = project.qa as unknown as QaReport | null;
  if (qa?.status === 'BLOCKED') throw new ConflictError('בקרת האיכות חסמה את התסריט — תקנו את הסצנות המסומנות');
  if (project.reviewRequired) {
    const pendingScenes = scenes.filter((s) => !s.approved).map((s) => s.order);
    if (pendingScenes.length) throw new ConflictError(`יש לאשר את כל הסצנות לפני הרינדור (ממתינות: ${pendingScenes.join(', ')})`);
  }
  const activeCharacters = new Set(characters.filter((c) => c.isActive).map((c) => c.id));
  for (const s of scenes) {
    if (s.visualKind === 'MEDIA' && !s.mediaId) throw new ConflictError(`סצנה ${s.order}: לא נבחרה תמונה`);
    if (s.visualKind === 'MEDIA_VIDEO' && !s.mediaId) throw new ConflictError(`סצנה ${s.order}: לא נבחר וידאו`);
    if (s.visualKind === 'AVATAR' && (!s.characterId || !activeCharacters.has(s.characterId))) throw new ConflictError(`סצנה ${s.order}: יש לבחור דמות פעילה`);
  }
  if (estimate.videoProviderMissing) throw new ConflictError('לסצנות "וידאו AI" נדרש ספק וידאו מחובר — הוסיפו מפתח fal.ai (Kling) בעמוד האינטגרציות');
  if (estimate.avatarProviderMissing) throw new ConflictError('לסצנות "דמות מדברת" נדרש ספק lip-sync מחובר — הוסיפו מפתח בעמוד האינטגרציות');

  let renderApprovalId: string | null = null;
  if (estimate.needsApproval && !estimate.mockClips) {
    const subjectId = `${projectId}:${renderConfigHash(project, scenes)}`;
    const voucher = await ctx.db.approval.findFirst({ where: { subjectType: 'video_render', subjectId, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } });
    if (!voucher) {
      const pending = await requestApproval(ctx, {
        type: 'AI_HIGH_COST',
        title: `רינדור סרטון: ${project.title}`,
        summary: `עלות משוערת ${estimate.totalIls.toFixed(2)} ₪ — ${estimate.videoSeconds ? `${estimate.videoSeconds} שנ' וידאו AI` : ''}${estimate.avatarSeconds ? ` · ${estimate.avatarSeconds} שנ' דמות מדברת` : ''}. הרינדור יתחיל אוטומטית עם האישור.`,
        subjectType: 'video_render',
        subjectId,
        estimatedCostIls: estimate.totalIls,
        payload: { projectId, estimate: { ...estimate } },
      });
      await ctx.db.videoProject.update({ where: { id: projectId }, data: { estimateIls: estimate.totalIls } });
      throw new AiApprovalRequiredError(pending.id, estimate.totalIls);
    }
    renderApprovalId = voucher.id;
  }
  return dispatchRender(ctx, projectId, renderApprovalId, estimate.totalIls);
}

// An approved render starts by itself — unless the project changed since the approval was requested.
registerApprovalHandler('video_render', async (ctx, approval) => {
  if (approval.status !== 'APPROVED') return;
  const projectId = approval.subjectId.split(':')[0] ?? '';
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project || isActivelyRendering(project)) return;
  const scenes = await ctx.db.videoScene.findMany({ where: { projectId }, orderBy: { order: 'asc' } });
  if (approval.subjectId !== `${projectId}:${renderConfigHash(project, scenes)}`) return;
  await dispatchRender(ctx, projectId, approval.id, Number(approval.estimatedCostIls ?? 0));
});

// ---------------------------------------------------------------------------
// Subtitles
// ---------------------------------------------------------------------------

export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(milli).padStart(3, '0')}`;
}

/** Split narration into caption chunks of ≤ `maxChars`, breaking on punctuation first, then spaces. */
export function splitCaption(text: string, maxChars = 42): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?،,;:])\s+/);
  const chunks: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    for (const word of sentence.split(' ')) {
      if ((current + ' ' + word).trim().length > maxChars) push();
      current = `${current} ${word}`.trim();
    }
    if (current.length > maxChars * 0.6) push();
  }
  push();
  return chunks;
}

/** SRT with one or more cues per scene, timed proportionally to character counts. */
export function buildSrt(scenes: { narration: string; durationMs: number }[]): string {
  const cues: string[] = [];
  let cursor = 0;
  let index = 1;
  for (const scene of scenes) {
    const chunks = splitCaption(scene.narration);
    const totalChars = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let start = cursor;
    for (const [i, chunk] of chunks.entries()) {
      const share = i === chunks.length - 1 ? cursor + scene.durationMs - start : Math.round((chunk.length / totalChars) * scene.durationMs);
      const end = Math.min(cursor + scene.durationMs, start + share);
      cues.push(`${index}\n${formatSrtTime(start)} --> ${formatSrtTime(Math.max(end - 40, start + 300))}\n${chunk}\n`);
      index += 1;
      start = end;
    }
    cursor += scene.durationMs;
  }
  return cues.join('\n');
}

/**
 * libass style for burnt-in Hebrew subtitles (sizes and margins are relative to libass PlayResY=288).
 * The bottom margin puts the captions inside the subtitle band reserved by the Reels overlay — above
 * the area the platforms' own UI covers at the bottom of vertical videos.
 */
export function subtitleStyle(aspect: VideoProject['aspect']): string {
  const size = aspect === 'R9X16' ? 15 : aspect === 'R16X9' || aspect === 'R191X1' ? 13 : 14;
  const marginV = Math.round(((100 - subtitleBand(aspect).bottom) / 100) * 288);
  return `FontName=Heebo,FontSize=${size},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BackColour=&H90000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${marginV},MarginL=40,MarginR=40,WrapStyle=0`;
}

// ---------------------------------------------------------------------------
// Render (worker)
// ---------------------------------------------------------------------------

export type VideoRenderBackend = RenderBackend;

class RenderCancelledError extends Error {
  constructor() {
    super('render cancelled');
  }
}

/** Ask the worker to stop this render at its next step (a clip already being generated finishes and is kept). */
export async function cancelVideoRender(ctx: BrandContext, projectId: string): Promise<VideoProject> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  if (project.status !== 'RENDERING') throw new ConflictError('הסרטון לא מרונדר כעת');
  // A render that stopped reporting (worker died) is released immediately.
  if (!isActivelyRendering(project)) return ctx.db.videoProject.update({ where: { id: projectId }, data: { status: 'SCRIPTED', renderStep: 'הרינדור נעצר', renderProgress: 0, cancelRequested: false } });
  const updated = await ctx.db.videoProject.update({ where: { id: projectId }, data: { cancelRequested: true, renderStep: 'עוצר…' } });
  await auditFromContext(ctx, { action: 'video.render.cancel', entityType: 'video_project', entityId: projectId });
  return updated;
}

/** Approve (or un-approve) scenes for rendering. */
export async function setScenesApproved(ctx: BrandContext, projectId: string, sceneIds: string[] | 'all', approved: boolean): Promise<number> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  if (isActivelyRendering(project)) throw new ConflictError('הסרטון מרונדר כעת');
  const res = await ctx.db.videoScene.updateMany({ where: { projectId, ...(sceneIds === 'all' ? {} : { id: { in: sceneIds } }) }, data: { approved } });
  await auditFromContext(ctx, { action: approved ? 'video.scenes.approve' : 'video.scenes.unapprove', entityType: 'video_project', entityId: projectId, after: { count: res.count } });
  return res.count;
}

/** Stream a media object to `<base>.<ext>` (extension from its MIME type); returns the file path. */
async function downloadMedia(ctx: BrandContext, mediaId: string, base: string): Promise<{ asset: MediaAsset; file: string }> {
  const { asset, object } = await openMediaObject(ctx, mediaId);
  const file = `${base}.${extOf(asset.mimeType)}`;
  await streamPipeline(object.body, createWriteStream(file));
  return { asset, file };
}

function imageSize(aspect: VideoProject['aspect']): { width: number; height: number } {
  return aspect === 'R1X1' ? { width: 1024, height: 1024 } : aspect === 'R16X9' || aspect === 'R191X1' ? { width: 1536, height: 1024 } : { width: 1024, height: 1536 };
}

function extOf(mime: string): string {
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('quicktime')) return 'mov';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

interface SceneRenderContext {
  ctx: BrandContext;
  project: VideoProject;
  backend: VideoRenderBackend;
  dir: string;
  kit: ComposeKit;
  fonts: ReturnType<typeof renderFontSources>;
  width: number;
  height: number;
  costIls: number;
  progress: (pct: number, step: string) => Promise<void>;
}

async function renderLayer(rc: SceneRenderContext, doc: CreativeDocument, transparent: boolean, file: string): Promise<void> {
  const images = await loadImageDataUrls(rc.ctx, documentMediaIds(doc));
  const html = documentToHtml(doc, { mode: 'render', images, fontSrc: rc.fonts, transparent });
  const { png } = await rc.backend.renderHtml(html, { width: doc.width, height: doc.height, transparent });
  await writeFile(file, png);
}

/** AI still for a scene (AI_IMAGE background or the start frame of an AI_VIDEO clip), cached by prompt. */
async function ensureSceneImage(rc: SceneRenderContext, scene: VideoScene, cache: SceneCache): Promise<string> {
  const k = imageCacheKey(rc.project, scene);
  if (cache.imageKey === k && cache.imageMediaId) {
    const ok = await getMedia(rc.ctx, cache.imageMediaId).then(() => true, () => false);
    if (ok) return cache.imageMediaId;
  }
  if (scene.visualKind === 'AI_IMAGE' && scene.mediaId && !cache.imageKey) return scene.mediaId; // generated by an earlier render
  const img = await runImage(rc.ctx, {
    task: 'CREATIVE_BACKGROUND',
    label: `תמונה לסצנה ${scene.order} — ${rc.project.title}`,
    prompt: `${imagePrompt(scene)}. Cinematic, brand-safe, no text, no logos, no watermarks.`,
    ...imageSize(rc.project.aspect),
    quality: 'medium',
    metadata: { projectId: rc.project.id, sceneId: scene.id },
  });
  rc.costIls += Number(img.run.costIls);
  const first = img.images[0];
  if (!first) throw new AiOutputInvalidError('לא התקבלה תמונה לסצנה');
  const asset = await uploadMedia(rc.ctx, { data: first.data, originalName: `scene-${scene.order}-ai.png`, mimeType: first.mimeType, title: `תמונה לסצנה ${scene.order} — ${rc.project.title}`, tags: ['video', 'ai', img.isMock ? 'mock' : 'generated'], source: 'AI_GENERATED' });
  cache.imageKey = k;
  cache.imageMediaId = asset.id;
  return asset.id;
}

/** Re-use a cached clip when its key still matches; returns the local file or null. */
async function cachedClip(rc: SceneRenderContext, scene: VideoScene, cache: SceneCache, clipKey: string, base: string): Promise<string | null> {
  if (cache.clipKey !== clipKey || !scene.clipMediaId) return null;
  try {
    return (await downloadMedia(rc.ctx, scene.clipMediaId, base)).file;
  } catch {
    return null;
  }
}

async function storeClip(rc: SceneRenderContext, scene: VideoScene, data: Buffer, mimeType: string, kind: 'ai' | 'avatar', mock: boolean): Promise<MediaAsset> {
  return uploadMedia(rc.ctx, {
    data,
    originalName: `scene-${scene.order}-${kind === 'ai' ? 'clip' : 'avatar'}.mp4`,
    mimeType: mimeType.includes('mp4') ? 'video/mp4' : mimeType,
    title: `${kind === 'ai' ? 'קליפ AI' : 'דמות מדברת'} — סצנה ${scene.order} — ${rc.project.title}`,
    tags: ['video', kind === 'ai' ? 'ai-clip' : 'avatar', mock ? 'mock' : 'generated'],
    source: 'AI_GENERATED',
  });
}

/** Worker entry: narration → visuals (stills with motion, library/AI clips, talking characters) → FFmpeg → MP4 + SRT. */
export async function renderVideoProject(ctx: BrandContext, projectId: string, backend: VideoRenderBackend): Promise<VideoProject> {
  const { project, scenes, characters } = await getVideoProject(ctx, projectId);
  if (scenes.length === 0) throw new ConflictError('no scenes');
  const charactersById = new Map(characters.map((c) => [c.id, c]));
  const { width, height } = ASPECTS[project.aspect];
  const aspect = projectVideoAspect(project.aspect);
  const tier = project.videoTier as AiTier;
  const coveredBy = project.renderApprovalId ?? undefined;
  const progress = async (renderProgress: number, renderStep: string) => {
    const current = await ctx.db.videoProject.findUnique({ where: { id: projectId }, select: { cancelRequested: true } });
    if (current?.cancelRequested) throw new RenderCancelledError();
    await ctx.db.videoProject.update({ where: { id: projectId }, data: { renderProgress, renderStep, status: 'RENDERING' } });
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mm-video-'));
  const rc: SceneRenderContext = { ctx, project, backend, dir, kit: await loadComposeKit(ctx), fonts: renderFontSources(), width, height, costIls: 0, progress };
  try {
    await progress(2, 'מתחיל');
    const sceneFiles: { video: string; durationMs: number }[] = [];
    const srtScenes: { narration: string; durationMs: number }[] = [];

    for (const [i, scene] of scenes.entries()) {
      const slice = (fraction: number) => Math.round(5 + ((i + fraction) / scenes.length) * 80);
      const label = `סצנה ${scene.order}/${scenes.length}`;
      const character = scene.characterId ? (charactersById.get(scene.characterId) ?? null) : null;
      const cache: SceneCache = { ...sceneCache(scene) };

      // 1. Narration (cached by text + voice).
      await progress(slice(0), `${label}: קריינות`);
      const voice = narrationVoice(project, scene, character);
      const tKey = ttsCacheKey(scene.narration, voice.voice, voice.instructions);
      let audioFile: string | null = null;
      let audioMediaId: string | null = null;
      if (cache.ttsKey === tKey && scene.audioMediaId) {
        try {
          const cached = await downloadMedia(ctx, scene.audioMediaId, path.join(dir, `scene-${scene.order}-narration`));
          audioFile = cached.file;
          audioMediaId = cached.asset.id;
        } catch {
          audioFile = null;
        }
      }
      if (!audioFile) {
        const tts = await runTts(ctx, { text: scene.narration, voice: voice.voice, format: 'mp3', label: `קריינות ${label} — ${project.title}`, instructions: voice.instructions, metadata: { projectId, sceneId: scene.id } });
        rc.costIls += Number(tts.run.costIls);
        audioFile = path.join(dir, `scene-${scene.order}.${extOf(tts.mimeType)}`);
        await writeFile(audioFile, tts.audio);
        const asset = await uploadMedia(ctx, { data: tts.audio, originalName: `narration-${scene.order}.${extOf(tts.mimeType)}`, mimeType: tts.mimeType, title: `קריינות סצנה ${scene.order} — ${project.title}`, tags: ['video', 'narration', tts.isMock ? 'mock' : 'ai'], source: 'AI_GENERATED' });
        audioMediaId = asset.id;
        cache.ttsKey = tKey;
      }
      const audioMs = await ffprobeDurationMs(audioFile);
      const durationMs = audioMs + SCENE_TAIL_MS;

      // 2. Visual.
      await progress(slice(0.2), `${label}: ${SCENE_KIND_LABELS[scene.visualKind]}`);
      let background: SceneBackground;
      let overlay: CreativeDocument | null;
      let clipMediaId: string | null = scene.clipMediaId;
      const motion: StillMotion = project.motionStills ? (i % 2 === 0 ? 'zoom-in' : 'zoom-out') : 'none';
      const headline = scene.onScreenText ?? '';
      const reelOverlay = () => buildReelOverlay({ aspect: project.aspect, headline: scene.onScreenText, kit: rc.kit });

      if (scene.visualKind === 'CARD' || scene.visualKind === 'MEDIA' || scene.visualKind === 'AI_IMAGE') {
        const imageId = scene.visualKind === 'MEDIA' ? scene.mediaId : scene.visualKind === 'AI_IMAGE' ? await ensureSceneImage(rc, scene, cache) : null;
        const doc = buildDocument({ aspect: project.aspect, copy: { headline }, kit: rc.kit, template: imageId ? 'photo' : 'bold', backgroundMediaId: imageId });
        const { background: bgDoc, foreground } = splitForMotion(doc);
        const bgFile = path.join(dir, `scene-${scene.order}-bg.png`);
        await renderLayer(rc, bgDoc, false, bgFile);
        background = { kind: 'still', file: bgFile, motion };
        // Branded cards keep their own typography; photos get the Reels overlay so text never collides with subtitles.
        overlay = imageId ? reelOverlay() : foreground;
      } else if (scene.visualKind === 'MEDIA_VIDEO') {
        if (!scene.mediaId) throw new ConflictError(`סצנה ${scene.order}: לא נבחר וידאו`);
        const { file } = await downloadMedia(ctx, scene.mediaId, path.join(dir, `scene-${scene.order}-library`));
        const info = await probeMedia(file);
        if (!info.hasVideo) throw new ConflictError(`סצנה ${scene.order}: קובץ הווידאו אינו קריא`);
        background = { kind: 'clip', file, clipMs: info.durationMs, hasAudio: info.hasAudio, audio: project.ambientAudio ? 'mix' : 'narration' };
        overlay = reelOverlay();
      } else if (scene.visualKind === 'AI_VIDEO') {
        const ck = clipCacheKey(project, scene, character)!;
        let clipFile = await cachedClip(rc, scene, cache, ck, path.join(dir, `scene-${scene.order}-cached-clip`));
        let hasAudio = Boolean(cache.clipHasAudio);
        if (!clipFile) {
          clipFile = path.join(dir, `scene-${scene.order}-clip.mp4`);
          const model = await resolveClipModel(ctx, 'video', tier);
          const caps = model?.spec.capabilities ?? {};
          // Kling: start frame AND character reference together. Veo: one or the other.
          const useReference = Boolean(character && (caps.referenceImages ?? 0) > 0 && (caps.referenceWithStart || !scene.mediaId));
          const needStart = caps.requiresStartImage || caps.referenceWithStart || !useReference;
          // With a character, the clip opens on the character itself so it is visible from the first frame.
          const startImageId = scene.mediaId ?? (needStart ? (character ? character.imageMediaId : await ensureSceneImage(rc, scene, cache)) : null);
          const start = startImageId ? await readMediaBuffer(ctx, startImageId, 25 * 1024 * 1024) : null;
          const reference = useReference && character ? await readMediaBuffer(ctx, character.imageMediaId, 25 * 1024 * 1024) : null;
          const subject = imagePrompt(scene);
          const prompt = [
            `${subject}.`,
            character?.description ? `Main character: ${character.description.slice(0, 600)}.` : '',
            scene.motionPrompt ? `${scene.motionPrompt}.` : 'Smooth cinematic camera movement with natural, lively motion.',
            'Premium brand marketing shot. No on-screen text, captions or logos.',
          ]
            .filter(Boolean)
            .join(' ');
          const res = await runVideo(ctx, {
            label: `קליפ AI ${label} — ${project.title}`,
            tier,
            coveredByApprovalId: coveredBy,
            request: {
              prompt,
              negativePrompt: CLIP_NEGATIVE,
              ...(start ? { image: { data: start.data, mimeType: start.asset.mimeType } } : {}),
              ...(reference ? { referenceImages: [{ data: reference.data, mimeType: reference.asset.mimeType }] } : {}),
              aspect,
              seconds: durationMs / 1000,
              audio: project.ambientAudio,
            },
            onProgress: (pct) => void progress(slice(0.25 + (0.5 * pct) / 100), `${label}: מייצר וידאו AI (${pct}%)`).catch(() => undefined),
            metadata: { projectId, sceneId: scene.id },
          });
          rc.costIls += Number(res.run.costIls);
          await writeFile(clipFile, res.clip.video);
          const asset = await storeClip(rc, scene, res.clip.video, res.clip.mimeType, 'ai', res.isMock);
          clipMediaId = asset.id;
          hasAudio = res.clip.hasAudio;
          Object.assign(cache, { clipKey: ck, clipProvider: res.provider, clipModel: res.modelId, clipSeconds: res.clip.seconds, clipCostIls: Number(res.run.costIls), clipMock: res.isMock, clipHasAudio: res.clip.hasAudio });
        }
        const info = await probeMedia(clipFile);
        background = { kind: 'clip', file: clipFile, clipMs: info.durationMs, hasAudio: hasAudio && info.hasAudio, audio: project.ambientAudio ? 'mix' : 'narration' };
        overlay = reelOverlay();
      } else {
        // AVATAR — the character speaks the narration (audio-driven lip-sync).
        if (!character) throw new ConflictError(`סצנה ${scene.order}: יש לבחור דמות`);
        const ck = clipCacheKey(project, scene, character)!;
        let clipFile = await cachedClip(rc, scene, cache, ck, path.join(dir, `scene-${scene.order}-cached-avatar`));
        if (!clipFile) {
          clipFile = path.join(dir, `scene-${scene.order}-avatar.mp4`);
          const face = await readMediaBuffer(ctx, character.imageMediaId, 25 * 1024 * 1024);
          const res = await runAvatar(ctx, {
            label: `דמות מדברת ${label} — ${project.title}`,
            tier,
            coveredByApprovalId: coveredBy,
            request: {
              image: { data: face.data, mimeType: face.asset.mimeType },
              audio: { data: await readFile(audioFile), mimeType: audioFile.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg', durationMs: audioMs },
              prompt: scene.motionPrompt ?? 'Natural, expressive talking presenter; subtle head movement and gestures; steady camera.',
              aspect,
            },
            onProgress: (pct) => void progress(slice(0.25 + (0.5 * pct) / 100), `${label}: מנפיש דמות (${pct}%)`).catch(() => undefined),
            metadata: { projectId, sceneId: scene.id, characterId: character.id },
          });
          rc.costIls += Number(res.run.costIls);
          await writeFile(clipFile, res.clip.video);
          const asset = await storeClip(rc, scene, res.clip.video, res.clip.mimeType, 'avatar', res.isMock);
          clipMediaId = asset.id;
          Object.assign(cache, { clipKey: ck, clipProvider: res.provider, clipModel: res.modelId, clipSeconds: res.clip.seconds, clipCostIls: Number(res.run.costIls), clipMock: res.isMock, clipHasAudio: res.clip.hasAudio });
        }
        const info = await probeMedia(clipFile);
        // The lip-synced clip carries the narration itself — use its audio so lips and voice stay in sync.
        background = { kind: 'clip', file: clipFile, clipMs: info.durationMs, hasAudio: info.hasAudio, audio: info.hasAudio ? 'clip' : 'narration' };
        overlay = reelOverlay();
      }

      // 3. Overlay (text / logo / legibility gradient) on a transparent canvas.
      if (!scene.onScreenText) overlay = { ...overlay, layers: overlay.layers.filter((l) => l.id !== 'headline') };
      let overlayFile: string | null = null;
      if (overlay.layers.length > 0) {
        overlayFile = path.join(dir, `scene-${scene.order}-overlay.png`);
        await renderLayer(rc, overlay, true, overlayFile);
      }

      // 4. Compose.
      await progress(slice(0.85), `${label}: קידוד`);
      const sceneVideo = path.join(dir, `scene-${scene.order}.mp4`);
      await composeScene({ width, height, durationMs, background, overlayFile, narrationFile: audioFile, output: sceneVideo });
      const thumb = path.join(dir, `scene-${scene.order}-thumb.jpg`);
      await extractFrame(sceneVideo, Math.min(1.5, durationMs / 2000), thumb);
      const frameAsset = await uploadMedia(ctx, { data: await readFile(thumb), originalName: `scene-${scene.order}.jpg`, mimeType: 'image/jpeg', title: `פריים סצנה ${scene.order} — ${project.title}`, tags: ['video', 'frame'], source: 'RENDERED' });

      sceneFiles.push({ video: sceneVideo, durationMs });
      srtScenes.push({ narration: scene.narration, durationMs });
      await ctx.db.videoScene.update({
        where: { id: scene.id },
        data: { audioMediaId, renderedImageId: frameAsset.id, durationMs, clipMediaId, clipMeta: cache as unknown as Prisma.InputJsonObject },
      });
    }

    await progress(88, 'מחבר סצנות, מעברים, כתוביות ומוזיקה');
    const transitionMs = project.transitions ? TRANSITION_MS : 0;
    const effective = effectiveDurations(sceneFiles.map((s) => s.durationMs), sceneFiles.length > 1 ? transitionMs : 0);
    const srt = buildSrt(srtScenes.map((s, k) => ({ narration: s.narration, durationMs: effective[k]! })));
    const srtFile = path.join(dir, 'subs.srt');
    await writeFile(srtFile, srt, 'utf8');
    let music: { file: string; volume: number } | null = null;
    if (project.musicMediaId && project.musicVolume > 0) {
      try {
        const { file } = await downloadMedia(ctx, project.musicMediaId, path.join(dir, 'music'));
        music = { file, volume: project.musicVolume };
      } catch (err) {
        logger.warn({ err, projectId }, 'background music unavailable — rendering without it');
      }
    }
    const final = path.join(dir, 'final.mp4');
    await assembleVideo({
      scenes: sceneFiles.map((s) => ({ file: s.video, durationMs: s.durationMs })),
      transitionMs,
      subtitles: { file: srtFile, fontsDir: fontsDir(), style: subtitleStyle(project.aspect) },
      music,
      output: final,
    });
    const durationMs = await ffprobeDurationMs(final);

    await progress(97, 'שומר');
    const output = await readFile(final);
    const outputAsset = await uploadMedia(ctx, { data: output, originalName: `${slugify(project.title, 'video')}.mp4`, mimeType: 'video/mp4', title: project.title, tags: ['video', 'render'], source: 'RENDERED' });
    const costIls = Math.round(rc.costIls * 10_000) / 10_000;
    const updated = await ctx.db.videoProject.update({
      where: { id: projectId },
      data: { status: 'READY', renderProgress: 100, renderStep: 'הושלם', renderError: null, outputMediaId: outputAsset.id, subtitlesSrt: srt, durationMs, costIls },
    });
    if (project.renderApprovalId) await markApprovalExecuted(ctx, project.renderApprovalId).catch(() => undefined);
    await auditFromContext(ctx, { action: 'video.render.complete', entityType: 'video_project', entityId: projectId, after: { durationMs, costIls, scenes: scenes.length } });
    return updated;
  } catch (err) {
    if (err instanceof RenderCancelledError) {
      // Clips already paid for stay cached on their scenes; the next render re-uses them.
      const stopped = await ctx.db.videoProject.update({ where: { id: projectId }, data: { status: 'SCRIPTED', renderStep: 'הרינדור נעצר', renderProgress: 0, renderError: null, cancelRequested: false, costIls: Math.round(rc.costIls * 10_000) / 10_000 } });
      await auditFromContext(ctx, { action: 'video.render.cancelled', entityType: 'video_project', entityId: projectId, after: { costIls: rc.costIls } });
      return stopped;
    }
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db.videoProject.update({ where: { id: projectId }, data: { status: 'FAILED', renderStep: 'נכשל', renderError: message.slice(0, 1000), costIls: Math.round(rc.costIls * 10_000) / 10_000 } }).catch(() => undefined);
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function requestVideoApproval(ctx: BrandContext, projectId: string): Promise<VideoProject> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  if (project.status !== 'READY' || !project.outputMediaId) throw new ConflictError('הסרטון עדיין לא מוכן');
  const approval = await requestApproval(ctx, {
    type: 'VIDEO',
    title: `סרטון: ${project.title}`,
    summary: project.goal,
    subjectType: 'video_project',
    // Bound to the rendered file: a new render is a new subject and needs its own approval.
    subjectId: `${project.id}:${project.outputMediaId}`,
    payload: { projectId: project.id, outputMediaId: project.outputMediaId, durationMs: project.durationMs, costIls: Number(project.costIls) },
    estimatedCostIls: Number(project.costIls),
  });
  return ctx.db.videoProject.update({ where: { id: projectId }, data: { approvalId: approval.id } });
}

registerApprovalHandler('video_project', async (ctx, approval) => {
  const [projectId, outputMediaId] = approval.subjectId.split(':');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId ?? '' } });
  if (!project) return;
  if (approval.status === 'APPROVED') {
    if (project.status !== 'READY' || !project.outputMediaId) throw new ConflictError('הסרטון אינו מוכן');
    if (outputMediaId !== project.outputMediaId) throw new ConflictError('הסרטון רונדר מחדש אחרי בקשת האישור — יש לשלוח את הגרסה החדשה לאישור');
    await ctx.db.videoProject.update({ where: { id: project.id }, data: { status: 'APPROVED' } });
  } else if (approval.status === 'REJECTED' || approval.status === 'CHANGES_REQUESTED') {
    await ctx.db.videoProject.update({ where: { id: project.id }, data: { approvalId: null } });
  }
});

// ---------------------------------------------------------------------------
// One-click production: brief → script → AI motion scenes → render
// ---------------------------------------------------------------------------

export interface AutoProduceInput {
  /** Stop before rendering so every scene can be reviewed and approved. */
  reviewFirst?: boolean;
  /** presenter: talks in the opening and the close, appears in the rest · all: in every scene · talking: talks in every scene */
  characterMode?: 'presenter' | 'all' | 'talking';
  brief: string;
  title?: string;
  aspect: VideoProject['aspect'];
  productId?: string | null;
  characterId?: string | null;
  sceneCount: number;
  targetSeconds: number;
  videoTier: 'economy' | 'balanced' | 'flagship';
  voice?: string;
}

/**
 * The fast path: everything from one brief. Scenes are real AI video when a video provider is
 * connected (AI images with camera motion otherwise); with a character, it presents the opening
 * and the call to action as a talking presenter. The render starts (or asks for approval) at once.
 */
export async function autoProduceVideo(ctx: BrandContext, input: AutoProduceInput): Promise<{ project: VideoProject; approvalRequired: boolean; message: string }> {
  assertBrandRole(ctx, 'EDITOR');
  const character = input.characterId ? await ctx.db.brandCharacter.findUnique({ where: { id: input.characterId } }) : null;
  if (input.characterId && (!character || !character.isActive)) throw new ValidationError('הדמות לא נמצאה', [{ path: 'characterId', message: 'לא נמצאה' }]);
  if (!input.brief.trim()) {
    const { generateConcept } = await import('./autopilot');
    const concept = await generateConcept(ctx, 'video');
    input = { ...input, brief: `${concept.hook ? `${concept.hook}\n` : ''}${concept.brief}`, productId: input.productId ?? concept.productId };
    input.title = concept.title;
  }
  const title = (input.title ?? input.brief.replace(/\s+/g, ' ').trim()).slice(0, 60) || 'סרטון';
  const project = await createVideoProject(ctx, { title, goal: input.brief.slice(0, 500), productId: input.productId ?? null, aspect: input.aspect, voice: (input.voice ?? 'alloy') as VideoProjectInput['voice'] });
  await ctx.db.videoProject.update({ where: { id: project.id }, data: { videoTier: input.videoTier, motionStills: true, transitions: true } });
  const tier = input.videoTier as AiTier;
  const [videoModel, avatarModel] = await Promise.all([resolveClipModel(ctx, 'video', tier), character ? resolveClipModel(ctx, 'avatar', tier) : null]);
  const motion = videoModel ? 'AI_VIDEO' : 'AI_IMAGE';
  const { scenes } = await generateVideoScript(ctx, project.id, {
    sceneCount: input.sceneCount,
    targetSeconds: input.targetSeconds,
    extra: [
      input.brief,
      character
        ? `הדמות "${character.name}" (${(character.description ?? '').slice(0, 600)}) ${input.characterMode === 'talking' ? 'מדברת ישירות למצלמה בכל הסצנות' : input.characterMode === 'all' ? 'מופיעה בכל סצנה בתוך האקשן' : 'פותחת את הסרטון וסוגרת אותו בפנייה ישירה למצלמה, ומופיעה גם בשאר הסצנות'}.`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    defaultKind: motion,
  });
  if (character) {
    const mode = input.characterMode ?? 'presenter';
    const speaking = avatarModel ? 'AVATAR' : motion;
    const ids = mode === 'talking' ? scenes.map((s) => s.id) : mode === 'all' ? [] : [scenes[0]?.id, scenes.length > 1 ? scenes[scenes.length - 1]?.id : undefined].filter((x): x is string => Boolean(x));
    if (ids.length) await ctx.db.videoScene.updateMany({ where: { id: { in: ids } }, data: { visualKind: speaking, characterId: character.id } });
    // The character is in every other scene too (as the subject of the motion clip).
    await ctx.db.videoScene.updateMany({ where: { projectId: project.id, id: { notIn: ids } }, data: { characterId: character.id, ...(motion === 'AI_VIDEO' ? {} : { visualKind: 'AI_VIDEO' as const }) } });
  }
  const notes: string[] = [];
  if (input.reviewFirst) {
    await ctx.db.videoProject.update({ where: { id: project.id }, data: { reviewRequired: true } });
    return { project, approvalRequired: false, message: 'התסריט והסצנות מוכנים — עברו על כל סצנה, שנו מה שצריך (כולל בחירת דמות), אשרו ולחצו רינדור' };
  }
  if (!videoModel) notes.push('אין ספק וידאו מחובר — הסצנות נוצרו כתמונות AI עם תנועת מצלמה. חברו fal.ai (Kling 3.0) לאנימציה אמיתית');
  if (character && !avatarModel) notes.push('אין ספק דמויות מדברות — חברו fal.ai לסנכרון שפתיים');
  try {
    await startVideoRender(ctx, project.id);
    return { project, approvalRequired: false, message: ['הסרטון בהפקה', ...notes].join('. ') };
  } catch (err) {
    if (err instanceof AiApprovalRequiredError) return { project, approvalRequired: true, message: [`${err.message}. ההפקה תתחיל אוטומטית עם האישור`, ...notes].join('. ') };
    if (err instanceof ConflictError) return { project, approvalRequired: false, message: [`התסריט מוכן אך הרינדור לא התחיל: ${err.message}`, ...notes].join('. ') };
    throw err;
  }
}
