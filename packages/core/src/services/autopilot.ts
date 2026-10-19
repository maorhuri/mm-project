/**
 * Content autopilot: an AI creative director that, every day and on its own,
 * invents new concepts from the brand's approved facts (never repeating recent
 * work), produces videos and image posts, writes captions, schedules them into
 * free calendar slots and sends them for approval. Nothing is published without
 * approval; all AI spend goes through the engine (monthly budget, approvals).
 */
import { db } from '@mm/db';
import type { CreativeVersion, Prisma, SocialChannel, VideoProject } from '@mm/db';
import { z } from 'zod';
import { runText } from '../ai/engine';
import { buildFactsPacket, groundingRules } from '../ai/facts';
import { auditFromContext } from '../audit';
import { ValidationError } from '../errors';
import { logger } from '../logger';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import { composeCreativeVersion, createCreativeProject, generateCreativeBackground, generateIdeas } from './creative';
import { notifyBrandAdmins } from './notifications';
import { createPosts, generateCaption, requestPostApproval } from './publishing';
import { autoProduceVideo } from './video';

export const autopilotConfigSchema = z.object({
  enabled: z.boolean().default(false),
  videosPerWeek: z.coerce.number().int().min(0).max(14).default(3),
  imagePostsPerWeek: z.coerce.number().int().min(0).max(21).default(4),
  channels: z.array(z.enum(['FACEBOOK_PAGE', 'INSTAGRAM'])).default(['FACEBOOK_PAGE', 'INSTAGRAM']),
  tier: z.enum(['balanced', 'flagship']).default('flagship'),
  characterId: z.string().uuid().nullable().default(null),
  /** Preferred publishing hour (Israel time). */
  postHour: z.coerce.number().int().min(6).max(23).default(19),
  /** Stop each video before rendering for scene approval. */
  reviewBeforeRender: z.boolean().default(true),
});
export type AutopilotConfig = z.infer<typeof autopilotConfigSchema>;

export async function getAutopilot(ctx: BrandContext): Promise<AutopilotConfig> {
  const settings = await ctx.db.brandSettings.findUnique({ where: { brandId: ctx.brandId } });
  return autopilotConfigSchema.parse(settings?.autopilot ?? {});
}

export async function saveAutopilot(ctx: BrandContext, input: unknown): Promise<AutopilotConfig> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const cfg = autopilotConfigSchema.parse(input);
  if (cfg.characterId) {
    const c = await ctx.db.brandCharacter.findUnique({ where: { id: cfg.characterId } });
    if (!c || !c.isActive) throw new ValidationError('הדמות לא נמצאה', [{ path: 'characterId', message: 'לא נמצאה' }]);
  }
  await ctx.db.brandSettings.upsert({
    where: { brandId: ctx.brandId },
    create: { brandId: ctx.brandId, autopilot: cfg as unknown as Prisma.InputJsonObject },
    update: { autopilot: cfg as unknown as Prisma.InputJsonObject },
  });
  await auditFromContext(ctx, { action: 'autopilot.save', entityType: 'brand_settings', entityId: ctx.brandId, after: cfg });
  return cfg;
}

// ---------------------------------------------------------------------------
// Creative director
// ---------------------------------------------------------------------------

const ANGLES = [
  'כאב של הלקוח ← הפתרון',
  'טיפ מקצועי שימושי (ערך לפני מכירה)',
  'מאחורי הקלעים / איך זה עובד',
  'שבירת מיתוס נפוץ בתחום',
  'לפני / אחרי (תרחיש, בלי לקוחות מומצאים)',
  'הצעה ברורה עם מחיר מאומת בלבד',
  'סיפור קצר עם דמות המותג',
  'הומור חכם שמחובר לבעיה אמיתית',
  'שאלה מעוררת מחשבה + תשובה',
  'השוואת גישות (בלי לנקוב בשמות מתחרים)',
];

const conceptSchema = z.object({
  title: z.string().min(2).max(120),
  angle: z.string().max(200).default(''),
  hook: z.string().max(300).default(''),
  brief: z.string().min(10).max(1500),
  productName: z.string().max(200).nullish(),
});
export type Concept = z.infer<typeof conceptSchema> & { productId: string | null };

/** Invent a fresh concept from the approved facts, steering away from what was produced recently. */
export async function generateConcept(ctx: BrandContext, kind: 'video' | 'image'): Promise<Concept> {
  const packet = await buildFactsPacket(ctx);
  const [videos, creatives, products] = await Promise.all([
    ctx.db.videoProject.findMany({ orderBy: { createdAt: 'desc' }, take: 15, select: { title: true, goal: true } }),
    ctx.db.creativeProject.findMany({ orderBy: { createdAt: 'desc' }, take: 15, select: { title: true, goal: true } }),
    ctx.db.brandProduct.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const recent = [...videos, ...creatives].map((r) => `- ${r.title}`).join('\n') || '(אין עדיין)';
  const angle = ANGLES[(videos.length + creatives.length) % ANGLES.length]!;
  const run = await runText(ctx, {
    task: 'CREATIVE_IDEAS',
    label: `קונספט אוטומטי (${kind === 'video' ? 'וידאו' : 'פוסט תמונה'})`,
    system: `${groundingRules(packet)}

אתה מנהל קריאייטיב בכיר בסוכנות פרסום מובילה. תפקידך להמציא בעצמך קונספט ${kind === 'video' ? 'לסרטון רילס פרסומי (30 שניות)' : 'לפוסט תמונה פרסומי'} שמנצח בפיד: הוק בשנייה הראשונה, רעיון אחד חד, ויז'ואל קולנועי ומפתיע, קריאה לפעולה ברורה.
- אל תחזור על קונספטים קודמים (רשימה למטה) — זווית, מוצר ותסריט שונים.
- זווית מומלצת הפעם: ${angle}.
- רק עובדות מחבילת המידע; אין להמציא מחירים, לקוחות, ביקורות או נתונים.
החזר JSON: {"title":"שם קצר","angle":"הזווית","hook":"משפט ההוק","brief":"תיאור מלא לבמאי: מה רואים בכל רגע, הטון, הדמויות, התנועה, המסר והקריאה לפעולה","productName":"שם מוצר מתוך העובדות או null"}`,
    prompt: `<user_request>קונספטים אחרונים שכבר הופקו (לא לחזור עליהם):\n${recent}</user_request>`,
    json: true,
    temperature: 0.9,
    maxOutputTokens: 1500,
    factsHash: packet.hash,
    metadata: { autopilot: true, kind },
  });
  const parsed = conceptSchema.safeParse(run.json);
  const concept = parsed.success
    ? parsed.data
    : { title: `${packet.brandName} — ${angle}`, angle, hook: '', brief: `${angle}: סרטון/פוסט על ${packet.brandName} המבוסס על העובדות המאושרות של המותג`, productName: null };
  const product = concept.productName ? (products.find((p) => p.name === concept.productName || concept.productName!.includes(p.name)) ?? null) : null;
  return { ...concept, productId: product?.id ?? null };
}

/** Several distinct concepts at once (for "give me ideas"). */
export async function generateConcepts(ctx: BrandContext, kind: 'video' | 'image', count = 4): Promise<Concept[]> {
  const packet = await buildFactsPacket(ctx);
  const [videos, products] = await Promise.all([
    ctx.db.videoProject.findMany({ orderBy: { createdAt: 'desc' }, take: 15, select: { title: true } }),
    ctx.db.brandProduct.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const recent = videos.map((r) => `- ${r.title}`).join('\n') || '(אין עדיין)';
  const run = await runText(ctx, {
    task: 'CREATIVE_IDEAS',
    label: `${count} קונספטים ל${kind === 'video' ? 'סרטון' : 'פוסט'}`,
    system: `${groundingRules(packet)}

אתה מנהל קריאייטיב בכיר. הצע ${count} קונספטים שונים מאוד זה מזה ${kind === 'video' ? 'לסרטון רילס פרסומי של 30 שניות' : 'לפוסט תמונה פרסומי'} — כל אחד בזווית אחרת (למשל: ${ANGLES.slice(0, 6).join(' / ')}). לכל קונספט: הוק חזק לשנייה הראשונה, רעיון חד, ויז'ואל קולנועי, קריאה לפעולה. רק עובדות מהחבילה. אל תחזור על קונספטים קודמים.
החזר JSON: {"concepts":[{"title":"שם קצר","angle":"הזווית","hook":"משפט ההוק","brief":"תיאור מלא לבמאי","productName":"שם מוצר או null"}]}`,
    prompt: `<user_request>קונספטים קודמים:\n${recent}</user_request>`,
    json: true,
    temperature: 0.95,
    maxOutputTokens: 3000,
    factsHash: packet.hash,
  });
  const parsed = z.object({ concepts: z.array(conceptSchema).default([]) }).safeParse(run.json);
  const list = parsed.success ? parsed.data.concepts : [];
  const concepts = list.length
    ? list
    : ANGLES.slice(0, count).map((angle) => ({ title: `${packet.brandName} — ${angle}`, angle, hook: '', brief: `${angle}: על ${packet.brandName} לפי העובדות המאושרות`, productName: null }));
  return concepts.slice(0, count).map((c) => {
    const product = c.productName ? (products.find((p) => p.name === c.productName || c.productName!.includes(p.name)) ?? null) : null;
    return { ...c, productId: product?.id ?? null };
  });
}

// ---------------------------------------------------------------------------
// Daily cycle
// ---------------------------------------------------------------------------

function weekStart(now: Date): Date {
  // Week starts Sunday 00:00 Israel time (≈ Saturday 21:00–22:00 UTC).
  const local = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const diffDays = local.getDay();
  const start = new Date(now.getTime() - diffDays * 86_400_000 - (local.getHours() * 3600 + local.getMinutes() * 60) * 1000);
  return start;
}

export interface CycleResult {
  videos: { projectId: string; title: string; message: string }[];
  images: { projectId: string; title: string }[];
  skipped: string[];
}

export async function runAutopilotCycle(ctx: BrandContext, opts: { force?: boolean; now?: Date } = {}): Promise<CycleResult> {
  assertBrandRole(ctx, 'EDITOR');
  const cfg = await getAutopilot(ctx);
  const result: CycleResult = { videos: [], images: [], skipped: [] };
  if (!cfg.enabled && !opts.force) {
    result.skipped.push('הטייס האוטומטי כבוי');
    return result;
  }
  const now = opts.now ?? new Date();
  const since = weekStart(now);
  const dayIndex = Math.min(7, Math.floor((now.getTime() - since.getTime()) / 86_400_000) + 1);
  const [videosThisWeek, imagesThisWeek] = await Promise.all([
    ctx.db.videoProject.count({ where: { origin: 'autopilot', createdAt: { gte: since } } }),
    ctx.db.creativeProject.count({ where: { origin: 'autopilot', createdAt: { gte: since } } }),
  ]);
  const wantVideos = opts.force ? Math.min(1, cfg.videosPerWeek || 1) : Math.max(0, Math.ceil((cfg.videosPerWeek * dayIndex) / 7) - videosThisWeek);
  const wantImages = opts.force ? Math.min(1, cfg.imagePostsPerWeek || 1) : Math.max(0, Math.ceil((cfg.imagePostsPerWeek * dayIndex) / 7) - imagesThisWeek);

  for (let i = 0; i < Math.min(wantVideos, 2); i++) {
    try {
      const concept = await generateConcept(ctx, 'video');
      const res = await autoProduceVideo(ctx, { brief: `${concept.hook ? `${concept.hook}\n` : ''}${concept.brief}`, aspect: 'R9X16', productId: concept.productId, characterId: cfg.characterId, sceneCount: 5, targetSeconds: 30, videoTier: cfg.tier, voice: 'onyx', reviewFirst: cfg.reviewBeforeRender });
      if (cfg.reviewBeforeRender) await notifyBrandAdmins({ ...ctx, actor: { ...ctx.actor, userId: '' } }, { level: 'INFO', title: `סרטון חדש ממתין לאישור סצנות: ${concept.title}`, body: 'אשרו את הסצנות והרינדור יתחיל', link: `/app/video/${res.project.id}` }).catch(() => undefined);
      await ctx.db.videoProject.update({ where: { id: res.project.id }, data: { origin: 'autopilot', title: concept.title.slice(0, 120) } });
      result.videos.push({ projectId: res.project.id, title: concept.title, message: res.message });
    } catch (err) {
      result.skipped.push(`וידאו: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
      break;
    }
  }
  for (let i = 0; i < Math.min(wantImages, 3); i++) {
    try {
      const concept = await generateConcept(ctx, 'image');
      const project = await createCreativeProject(ctx, { title: concept.title.slice(0, 120), channel: 'INSTAGRAM', format: 'POST', aspect: 'R4X5', productId: concept.productId, goal: concept.brief.slice(0, 500) });
      await ctx.db.creativeProject.update({ where: { id: project.id }, data: { origin: 'autopilot' } });
      const { ideas } = await generateIdeas(ctx, { projectId: project.id, count: 1, extra: `${concept.hook}\n${concept.brief}` });
      const idea = ideas[0]!;
      const copy = (idea.copy ?? {}) as { headline?: string; subheadline?: string | null; cta?: string | null; price?: string | null; badge?: string | null };
      const bg = await generateCreativeBackground(ctx, project.id, { prompt: idea.visualDirection ?? concept.brief.slice(0, 600), quality: 'high' });
      await composeCreativeVersion(ctx, project.id, {
        ideaId: idea.id,
        template: 'photo',
        backgroundMediaId: bg.asset.id,
        copy: { headline: copy.headline || concept.title.slice(0, 120), subheadline: copy.subheadline ?? null, cta: copy.cta ?? null, price: copy.price ?? null, badge: copy.badge ?? null },
        note: 'טייס אוטומטי',
      });
      result.images.push({ projectId: project.id, title: concept.title });
    } catch (err) {
      result.skipped.push(`פוסט תמונה: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
      break;
    }
  }
  if (result.videos.length || result.images.length) {
    await auditFromContext(ctx, { action: 'autopilot.cycle', entityType: 'brand', entityId: ctx.brandId, after: { videos: result.videos.length, images: result.images.length } });
  }
  return result;
}

// ---------------------------------------------------------------------------
// After a render: caption → free slot → approval
// ---------------------------------------------------------------------------

/** First day from tomorrow (Israel time) with no post on these channels at the preferred hour. */
async function nextFreeSlot(ctx: BrandContext, channels: SocialChannel[], hour: number): Promise<Date> {
  const { fromJerusalemLocal } = await import('./publishing');
  for (let d = 1; d <= 30; d++) {
    const day = new Date(Date.now() + d * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
    const at = fromJerusalemLocal(`${day}T${String(hour).padStart(2, '0')}:00`);
    const taken = await ctx.db.scheduledPost.count({ where: { channel: { in: channels }, status: { notIn: ['CANCELLED', 'FAILED'] }, scheduledAt: { gte: new Date(at.getTime() - 3 * 3600_000), lt: new Date(at.getTime() + 3 * 3600_000) } } });
    if (taken === 0) return at;
  }
  return new Date(Date.now() + 86_400_000);
}

async function schedule(ctx: BrandContext, cfg: AutopilotConfig, mediaId: string, sourceType: 'video_project' | 'creative_version', sourceId: string, brief: string, title: string): Promise<number> {
  const channels = cfg.channels as SocialChannel[];
  if (channels.length === 0) return 0;
  const already = await ctx.db.scheduledPost.count({ where: { sourceType, sourceId } });
  if (already > 0) return 0;
  const caption = await generateCaption(ctx, { channel: channels.includes('INSTAGRAM') ? 'INSTAGRAM' : 'FACEBOOK_PAGE', brief: `${title}\n${brief}`.slice(0, 1400) });
  const at = await nextFreeSlot(ctx, channels, cfg.postHour);
  const posts = await createPosts(ctx, { channels, caption: caption.caption, mediaId, sourceType, sourceId, scheduledAt: at });
  for (const p of posts) await requestPostApproval(ctx, p.id);
  await notifyBrandAdmins({ ...ctx, actor: { ...ctx.actor, userId: '' } }, { level: 'SUCCESS', title: `תוכן חדש מהטייס האוטומטי: ${title}`, body: 'מוכן ומתוזמן — ממתין לאישורך', link: '/app/approvals' }).catch(() => undefined);
  return posts.length;
}

export async function autopilotAfterVideo(ctx: BrandContext, project: VideoProject): Promise<number> {
  if (project.origin !== 'autopilot' || project.status !== 'READY' || !project.outputMediaId) return 0;
  const cfg = await getAutopilot(ctx);
  try {
    return await schedule(ctx, cfg, project.outputMediaId, 'video_project', project.id, project.goal ?? project.title, project.title);
  } catch (err) {
    logger.warn({ err, projectId: project.id }, 'autopilot scheduling failed');
    return 0;
  }
}

export async function autopilotAfterCreative(ctx: BrandContext, version: CreativeVersion): Promise<number> {
  if (version.renderStatus !== 'READY' || !version.renderedJpgId) return 0;
  const project = await ctx.db.creativeProject.findUnique({ where: { id: version.projectId } });
  if (!project || project.origin !== 'autopilot') return 0;
  const qa = version.qa as { status?: string } | null;
  if (qa?.status === 'BLOCKED') return 0;
  const cfg = await getAutopilot(ctx);
  try {
    return await schedule(ctx, cfg, version.renderedJpgId, 'creative_version', version.id, project.goal ?? project.title, project.title);
  } catch (err) {
    logger.warn({ err, versionId: version.id }, 'autopilot scheduling failed');
    return 0;
  }
}

/** Brands whose autopilot is on (for the daily worker job). */
export async function listAutopilotBrandIds(): Promise<string[]> {
  const rows = await db.brandSettings.findMany({ select: { brandId: true, autopilot: true } });
  return rows.filter((r) => (r.autopilot as { enabled?: boolean } | null)?.enabled === true).map((r) => r.brandId);
}
