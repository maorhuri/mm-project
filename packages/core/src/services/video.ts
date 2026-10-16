/**
 * Video Studio v1: AI script (grounded, QA'd) → per-scene TTS → brand cards /
 * images rendered with the creative templates → FFmpeg assembly with burnt-in
 * Hebrew subtitles. Rendering runs in the worker with progress updates.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Prisma, VideoProject, VideoScene, VideoStatus } from '@mm/db';
import { z } from 'zod';
import { catalogFor, estimateCostIls } from '../ai/catalog';
import { orderByTier } from '../ai/router';
import { runImage, runText, runTts } from '../ai/engine';
import type { RunTextResult } from '../ai/engine';
import { buildFactsPacket, groundingRules } from '../ai/facts';
import { runCopyQa } from '../ai/qa';
import type { QaFinding, QaReport } from '../ai/qa';
import { AiOutputInvalidError } from '../ai/types';
import { auditFromContext } from '../audit';
import { getConfig } from '../config';
import { ASPECTS } from '../creative/document';
import { fontsDir, renderFontSources } from '../creative/fonts';
import { documentToHtml } from '../creative/html';
import { buildDocument } from '../creative/templates';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { JOBS, QUEUES, getQueue } from '../jobs/queues';
import { logger } from '../logger';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import { slugify } from '../validation';
import type { VideoProjectInput, VideoSceneUpdateInput, VideoScriptRequestInput } from '../validation';
import { registerApprovalHandler, requestApproval } from './approvals';
import { loadComposeKit, loadImageDataUrls } from './creative';
import type { RenderBackend } from './creative';
import { getMedia, uploadMedia } from './media';

const execFileAsync = promisify(execFile);

export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
  DRAFT: 'טיוטה',
  SCRIPTED: 'יש תסריט',
  RENDERING: 'מרנדר',
  READY: 'מוכן',
  FAILED: 'נכשל',
  APPROVED: 'אושר',
};

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

export interface VideoProjectDetail {
  project: VideoProject;
  scenes: VideoScene[];
  product: { id: string; name: string } | null;
  estimate: VideoCostEstimate;
}

export async function getVideoProject(ctx: BrandContext, projectId: string): Promise<VideoProjectDetail> {
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  const [scenes, product] = await Promise.all([
    ctx.db.videoScene.findMany({ where: { projectId }, orderBy: { order: 'asc' } }),
    project.productId ? ctx.db.brandProduct.findUnique({ where: { id: project.productId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  return { project, scenes, product, estimate: estimateVideoCost(scenes) };
}

export async function deleteVideoProject(ctx: BrandContext, projectId: string): Promise<void> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const project = await ctx.db.videoProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('video project');
  if (project.status === 'RENDERING') throw new ConflictError('הסרטון מרונדר כעת');
  await ctx.db.videoProject.delete({ where: { id: projectId } });
  await auditFromContext(ctx, { action: 'video.project.delete', entityType: 'video_project', entityId: projectId, before: { title: project.title } });
}

export interface VideoCostEstimate {
  characters: number;
  aiImages: number;
  ttsIls: number;
  imagesIls: number;
  totalIls: number;
  estimatedSeconds: number;
}

/** Pre-render estimate from catalog prices (TTS by characters, AI images per scene). ~14 chars/s of Hebrew narration. */
export function estimateVideoCost(scenes: Pick<VideoScene, 'narration' | 'visualKind'>[]): VideoCostEstimate {
  const cfg = getConfig();
  const tts = orderByTier(catalogFor('openai', 'tts'), 'balanced')[0];
  const image = orderByTier(catalogFor('openai', 'image'), 'balanced')[0];
  const characters = scenes.reduce((n, s) => n + s.narration.length, 0);
  const aiImages = scenes.filter((s) => s.visualKind === 'AI_IMAGE').length;
  const ttsIls = tts ? estimateCostIls(tts, { characters }, cfg.USD_ILS_RATE) : 0;
  const imagesIls = image ? estimateCostIls(image, { images: aiImages }, cfg.USD_ILS_RATE) : 0;
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  return { characters, aiImages, ttsIls: round(ttsIls), imagesIls: round(imagesIls), totalIls: round(ttsIls + imagesIls), estimatedSeconds: Math.round(characters / 14) + scenes.length };
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
        claims: z.array(z.object({ text: z.string().max(400), factIds: z.array(z.string().max(24)).default([]) })).default([]),
      }),
    )
    .default([]),
});

const SCRIPT_FORMAT = `
## פורמט הפלט (JSON בלבד)
{"title":"שם הסרטון","scenes":[{"narration":"משפט קריינות טבעי בעברית, עד 25 מילים","onScreenText":"עד 7 מילים על המסך","visualPrompt":"English visual description for a background image: scene, mood, colours. No text.","claims":[{"text":"משפט עובדתי","factIds":["P1.F1"]}]}]}
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
  if (project.status === 'RENDERING') throw new ConflictError('הסרטון מרונדר כעת');
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
          visualKind: 'CARD',
          visualPrompt: s.visualPrompt?.trim() || null,
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
    },
  });
  await auditFromContext(ctx, { action: 'video.script.generate', entityType: 'video_project', entityId: projectId, after: { scenes: rows.length, model: run.modelId, mock: run.isMock, qa: qa.status } });
  return { project: updated, scenes: rows, run };
}

export async function updateVideoScene(ctx: BrandContext, sceneId: string, input: VideoSceneUpdateInput): Promise<VideoScene> {
  assertBrandRole(ctx, 'EDITOR');
  const scene = await ctx.db.videoScene.findUnique({ where: { id: sceneId }, include: { project: true } });
  if (!scene) throw new NotFoundError('scene');
  if (scene.project.status === 'RENDERING') throw new ConflictError('הסרטון מרונדר כעת');
  if (input.visualKind === 'MEDIA') {
    if (!input.mediaId) throw new ValidationError('יש לבחור תמונה מהספרייה', [{ path: 'mediaId', message: 'חובה' }]);
    const media = await getMedia(ctx, input.mediaId);
    if (media.kind !== 'IMAGE') throw new ValidationError('יש לבחור תמונה', [{ path: 'mediaId', message: 'לא תמונה' }]);
  }
  const updated = await ctx.db.videoScene.update({
    where: { id: sceneId },
    data: {
      narration: input.narration,
      onScreenText: input.onScreenText ?? null,
      visualKind: input.visualKind,
      mediaId: input.visualKind === 'MEDIA' ? (input.mediaId ?? null) : null,
      visualPrompt: input.visualPrompt ?? null,
      audioMediaId: null,
      renderedImageId: null,
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
// Render (worker)
// ---------------------------------------------------------------------------

/** A render that has not reported progress for this long is considered dead (worker crash) and may be restarted. */
export const STALE_RENDER_MS = 30 * 60_000;

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

export async function startVideoRender(ctx: BrandContext, projectId: string): Promise<VideoProject> {
  assertBrandRole(ctx, 'EDITOR');
  const { project, scenes } = await getVideoProject(ctx, projectId);
  const stale = project.status === 'RENDERING' && project.updatedAt.getTime() < Date.now() - STALE_RENDER_MS;
  if (project.status === 'RENDERING' && !stale) throw new ConflictError('הסרטון כבר מרונדר');
  if (scenes.length === 0) throw new ConflictError('אין סצנות — צרו תסריט תחילה');
  const qa = project.qa as unknown as QaReport | null;
  if (qa?.status === 'BLOCKED') throw new ConflictError('בקרת האיכות חסמה את התסריט — תקנו את הסצנות המסומנות');
  for (const s of scenes) if (s.visualKind === 'MEDIA' && !s.mediaId) throw new ConflictError(`סצנה ${s.order}: לא נבחרה תמונה`);
  const updated = await ctx.db.videoProject.update({ where: { id: projectId }, data: { status: 'RENDERING', renderProgress: 0, renderStep: 'בתור', renderError: null, approvalId: null } });
  try {
    await dispatcher(ctx, projectId);
  } catch (err) {
    logger.error({ err, projectId }, 'video render could not be queued');
    return ctx.db.videoProject.update({ where: { id: projectId }, data: { status: 'FAILED', renderError: 'תור הרינדור אינו זמין — נסו שוב' } });
  }
  await auditFromContext(ctx, { action: 'video.render.start', entityType: 'video_project', entityId: projectId, after: { scenes: scenes.length } });
  return updated;
}

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

async function ffprobeDurationMs(file: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 60_000 });
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`ffprobe: could not read duration of ${path.basename(file)}`);
  return Math.round(seconds * 1000);
}

async function ffmpeg(args: string[], timeoutMs = 10 * 60_000): Promise<void> {
  try {
    await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: string };
    if (e.code === 'ENOENT') throw new Error('ffmpeg is not installed on the worker host');
    throw new Error(`ffmpeg failed: ${(e.stderr ?? e.message ?? '').toString().trim().slice(-800)}`);
  }
}

/** libass style for burnt-in Hebrew subtitles (FontSize is relative to libass PlayResY=288). */
function subtitleStyle(aspect: VideoProject['aspect']): string {
  const size = aspect === 'R9X16' ? 16 : aspect === 'R16X9' || aspect === 'R191X1' ? 13 : 15;
  const marginV = aspect === 'R9X16' ? 70 : 28;
  return `FontName=Heebo,FontSize=${size},Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H90000000,BackColour=&H90000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${marginV},MarginL=40,MarginR=40,WrapStyle=0`;
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

export type VideoRenderBackend = RenderBackend;

/** Worker entry: TTS → scene visuals → FFmpeg → MP4 + SRT. Updates progress on the project as it goes. */
export async function renderVideoProject(ctx: BrandContext, projectId: string, backend: VideoRenderBackend): Promise<VideoProject> {
  const { project, scenes } = await getVideoProject(ctx, projectId);
  if (scenes.length === 0) throw new ConflictError('no scenes');
  const { width, height } = ASPECTS[project.aspect];
  const progress = async (renderProgress: number, renderStep: string) => {
    await ctx.db.videoProject.update({ where: { id: projectId }, data: { renderProgress, renderStep, status: 'RENDERING' } });
  };
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mm-video-'));
  let costIls = 0;
  try {
    await progress(2, 'מתחיל');
    const kit = await loadComposeKit(ctx);
    const sceneFiles: { video: string; durationMs: number }[] = [];
    const srtScenes: { narration: string; durationMs: number }[] = [];

    for (const [i, scene] of scenes.entries()) {
      const base = Math.round((i / scenes.length) * 80) + 5;
      await progress(base, `סצנה ${scene.order}/${scenes.length}: קריינות`);
      const tts = await runTts(ctx, { text: scene.narration, voice: project.voice, format: 'mp3', label: `קריינות סצנה ${scene.order} — ${project.title}`, instructions: 'Warm, clear Hebrew narrator for a short marketing video. Natural pace.', metadata: { projectId, sceneId: scene.id } });
      costIls += Number(tts.run.costIls);
      const audioExt = tts.mimeType === 'audio/wav' ? 'wav' : 'mp3';
      const audioFile = path.join(dir, `scene-${scene.order}.${audioExt}`);
      await writeFile(audioFile, tts.audio);
      const audioMs = await ffprobeDurationMs(audioFile);
      const durationMs = audioMs + 500;
      const audioAsset = await uploadMedia(ctx, { data: tts.audio, originalName: `narration-${scene.order}.${audioExt}`, mimeType: tts.mimeType, title: `קריינות סצנה ${scene.order} — ${project.title}`, tags: ['video', 'narration', tts.isMock ? 'mock' : 'ai'], source: 'AI_GENERATED' });

      await progress(base + 4, `סצנה ${scene.order}/${scenes.length}: ויז'ואל`);
      let backgroundMediaId: string | null = scene.visualKind === 'MEDIA' ? scene.mediaId : null;
      if (scene.visualKind === 'AI_IMAGE') {
        const size = project.aspect === 'R1X1' ? { width: 1024, height: 1024 } : project.aspect === 'R16X9' || project.aspect === 'R191X1' ? { width: 1536, height: 1024 } : { width: 1024, height: 1536 };
        const img = await runImage(ctx, { task: 'CREATIVE_BACKGROUND', label: `תמונה לסצנה ${scene.order} — ${project.title}`, prompt: `${scene.visualPrompt ?? scene.onScreenText ?? scene.narration}. Cinematic, brand-safe, no text, no logos, no watermarks.`, ...size, quality: 'medium', metadata: { projectId, sceneId: scene.id } });
        costIls += Number(img.run.costIls);
        const first = img.images[0];
        if (!first) throw new AiOutputInvalidError('לא התקבלה תמונה לסצנה');
        const asset = await uploadMedia(ctx, { data: first.data, originalName: `scene-${scene.order}-ai.png`, mimeType: first.mimeType, title: `תמונה לסצנה ${scene.order} — ${project.title}`, tags: ['video', 'ai', img.isMock ? 'mock' : 'generated'], source: 'AI_GENERATED' });
        backgroundMediaId = asset.id;
      }
      const doc = buildDocument({ aspect: project.aspect, copy: { headline: scene.onScreenText ?? '' }, kit, template: backgroundMediaId ? 'photo' : 'bold', backgroundMediaId });
      // Captions are burnt in later; hide the headline when there is no on-screen text.
      if (!scene.onScreenText) doc.layers = doc.layers.filter((l) => l.id !== 'headline');
      const images = await loadImageDataUrls(ctx, doc.layers.flatMap((l) => (l.type === 'image' && l.mediaId ? [l.mediaId] : [])));
      const html = documentToHtml(doc, { mode: 'render', images, fontSrc: renderFontSources() });
      const { png } = await backend.renderHtml(html, { width, height });
      const frameFile = path.join(dir, `scene-${scene.order}.png`);
      await writeFile(frameFile, png);
      const frameAsset = await uploadMedia(ctx, { data: png, originalName: `scene-${scene.order}.png`, mimeType: 'image/png', title: `פריים סצנה ${scene.order} — ${project.title}`, tags: ['video', 'frame'], source: 'RENDERED' });

      await progress(base + 8, `סצנה ${scene.order}/${scenes.length}: קידוד`);
      const sceneVideo = path.join(dir, `scene-${scene.order}.mp4`);
      await ffmpeg([
        '-loop', '1', '-framerate', '25', '-i', frameFile,
        '-i', audioFile,
        '-af', 'apad=pad_dur=0.5',
        '-t', (durationMs / 1000).toFixed(3),
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '23', '-r', '25',
        '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-movflags', '+faststart',
        sceneVideo,
      ]);
      sceneFiles.push({ video: sceneVideo, durationMs });
      srtScenes.push({ narration: scene.narration, durationMs });
      await ctx.db.videoScene.update({ where: { id: scene.id }, data: { audioMediaId: audioAsset.id, renderedImageId: frameAsset.id, durationMs, ...(scene.visualKind === 'AI_IMAGE' ? { mediaId: backgroundMediaId } : {}) } });
    }

    await progress(88, 'מחבר סצנות');
    const listFile = path.join(dir, 'list.txt');
    await writeFile(listFile, sceneFiles.map((s) => `file '${s.video.replace(/'/g, "'\\''")}'`).join('\n'));
    const joined = path.join(dir, 'joined.mp4');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);

    await progress(92, 'כתוביות');
    const srt = buildSrt(srtScenes);
    const srtFile = path.join(dir, 'subs.srt');
    await writeFile(srtFile, srt, 'utf8');
    const fonts = fontsDir();
    const final = path.join(dir, 'final.mp4');
    const filter = `subtitles='${escapeFilterPath(srtFile)}'${fonts ? `:fontsdir='${escapeFilterPath(fonts)}'` : ''}:force_style='${subtitleStyle(project.aspect)}'`;
    await ffmpeg(['-i', joined, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', final]);
    const durationMs = await ffprobeDurationMs(final);

    await progress(97, 'שומר');
    const output = await readFile(final);
    const outputAsset = await uploadMedia(ctx, { data: output, originalName: `${slugify(project.title, 'video')}.mp4`, mimeType: 'video/mp4', title: project.title, tags: ['video', 'render'], source: 'RENDERED' });
    const updated = await ctx.db.videoProject.update({
      where: { id: projectId },
      data: { status: 'READY', renderProgress: 100, renderStep: 'הושלם', renderError: null, outputMediaId: outputAsset.id, subtitlesSrt: srt, durationMs, costIls: Math.round(costIls * 10_000) / 10_000 },
    });
    await auditFromContext(ctx, { action: 'video.render.complete', entityType: 'video_project', entityId: projectId, after: { durationMs, costIls, scenes: scenes.length } });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db.videoProject.update({ where: { id: projectId }, data: { status: 'FAILED', renderStep: 'נכשל', renderError: message.slice(0, 1000), costIls: Math.round(costIls * 10_000) / 10_000 } }).catch(() => undefined);
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
    subjectId: project.id,
    payload: { outputMediaId: project.outputMediaId, durationMs: project.durationMs, costIls: Number(project.costIls) },
    estimatedCostIls: Number(project.costIls),
  });
  return ctx.db.videoProject.update({ where: { id: projectId }, data: { approvalId: approval.id } });
}

registerApprovalHandler('video_project', async (ctx, approval) => {
  const project = await ctx.db.videoProject.findUnique({ where: { id: approval.subjectId } });
  if (!project) return;
  if (approval.status === 'APPROVED') {
    if (project.status !== 'READY' || !project.outputMediaId) throw new ConflictError('הסרטון אינו מוכן');
    await ctx.db.videoProject.update({ where: { id: project.id }, data: { status: 'APPROVED' } });
  } else if (approval.status === 'REJECTED' || approval.status === 'CHANGES_REQUESTED') {
    await ctx.db.videoProject.update({ where: { id: project.id }, data: { approvalId: null } });
  }
});
