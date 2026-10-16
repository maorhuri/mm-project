/**
 * Creative Studio: ideas (grounded in approved facts), editable layer
 * documents built from the Brand Kit, Chromium renders (worker), versions and
 * the approval binding. Nothing here calls a model directly — all AI goes
 * through the engine (ledger, budget, approvals).
 */
import type { ContentIdea, CreativeProject, CreativeVersion, IdeaStatus, Prisma } from '@mm/db';
import sharp from 'sharp';
import { z } from 'zod';
import { buildFactsPacket, groundingRules } from '../ai/facts';
import type { FactsPacket } from '../ai/facts';
import { runImage, runText } from '../ai/engine';
import type { RunImageResult, RunTextResult } from '../ai/engine';
import { runCopyQa } from '../ai/qa';
import type { QaFinding, QaReport } from '../ai/qa';
import { AiOutputInvalidError } from '../ai/types';
import { auditFromContext } from '../audit';
import { ASPECTS, documentCopy, documentMediaIds, parseDocument } from '../creative/document';
import type { CreativeDocument } from '../creative/document';
import { renderFontSources } from '../creative/fonts';
import { documentToHtml } from '../creative/html';
import type { RenderWarning } from '../creative/html';
import { buildDocument } from '../creative/templates';
import type { ComposeKit } from '../creative/templates';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { JOBS, QUEUES, getQueue } from '../jobs/queues';
import { logger } from '../logger';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import { slugify } from '../validation';
import type { BackgroundRequestInput, ComposeCreativeInput, CreativeCopyInput, CreativeProjectInput, IdeaRequestInput, SaveVersionInput } from '../validation';
import { registerApprovalHandler, requestApproval } from './approvals';
import { getMedia, mediaFileUrl, openMediaObject, uploadMedia } from './media';

export const CHANNEL_LABELS: Record<CreativeProject['channel'], string> = {
  FACEBOOK: 'פייסבוק',
  INSTAGRAM: 'אינסטגרם',
  GOOGLE: 'גוגל',
  LINKEDIN: 'לינקדאין',
  GENERIC: 'כללי',
};

export const FORMAT_LABELS: Record<CreativeProject['format'], string> = {
  POST: 'פוסט',
  STORY: 'סטורי',
  BANNER: 'באנר',
  AD: 'מודעה',
};

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface CreativeProjectRow extends CreativeProject {
  currentVersion: CreativeVersion | null;
  versionCount: number;
}

export async function listCreativeProjects(ctx: BrandContext): Promise<CreativeProjectRow[]> {
  const projects = await ctx.db.creativeProject.findMany({
    where: { status: { not: 'ARCHIVED' } },
    orderBy: { updatedAt: 'desc' },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 }, _count: { select: { versions: true } } },
  });
  return projects.map(({ versions, _count, ...p }) => ({ ...p, currentVersion: versions[0] ?? null, versionCount: _count.versions }));
}

export async function createCreativeProject(ctx: BrandContext, input: CreativeProjectInput): Promise<CreativeProject> {
  assertBrandRole(ctx, 'EDITOR');
  if (input.productId) {
    const product = await ctx.db.brandProduct.findUnique({ where: { id: input.productId } });
    if (!product) throw new NotFoundError('product');
  }
  const project = await ctx.db.creativeProject.create({
    data: {
      brandId: ctx.brandId,
      title: input.title,
      channel: input.channel,
      format: input.format,
      aspect: input.aspect,
      productId: input.productId ?? null,
      goal: input.goal ?? null,
      audience: input.audience ?? null,
      style: input.style ?? null,
      createdById: ctx.actor.userId || null,
    },
  });
  await auditFromContext(ctx, { action: 'creative.project.create', entityType: 'creative_project', entityId: project.id, after: { title: project.title, aspect: project.aspect } });
  return project;
}

export interface CreativeProjectDetail {
  project: CreativeProject;
  versions: CreativeVersion[];
  current: CreativeVersion | null;
  ideas: ContentIdea[];
  product: { id: string; name: string } | null;
}

export async function getCreativeProject(ctx: BrandContext, projectId: string): Promise<CreativeProjectDetail> {
  const project = await ctx.db.creativeProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('creative project');
  const [versions, ideas, product] = await Promise.all([
    ctx.db.creativeVersion.findMany({ where: { projectId }, orderBy: { version: 'desc' } }),
    ctx.db.contentIdea.findMany({ where: { brief: { path: ['projectId'], equals: projectId } }, orderBy: { createdAt: 'desc' } }),
    project.productId ? ctx.db.brandProduct.findUnique({ where: { id: project.productId }, select: { id: true, name: true } }) : Promise.resolve(null),
  ]);
  const current = versions.find((v) => v.id === project.currentVersionId) ?? versions[0] ?? null;
  return { project, versions, current, ideas, product };
}

export async function archiveCreativeProject(ctx: BrandContext, projectId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.creativeProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('creative project');
  await ctx.db.creativeProject.update({ where: { id: projectId }, data: { status: 'ARCHIVED' } });
  await auditFromContext(ctx, { action: 'creative.project.archive', entityType: 'creative_project', entityId: projectId, before: { status: project.status } });
}

export async function deleteCreativeProject(ctx: BrandContext, projectId: string): Promise<void> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const project = await ctx.db.creativeProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('creative project');
  await ctx.db.creativeProject.delete({ where: { id: projectId } });
  await auditFromContext(ctx, { action: 'creative.project.delete', entityType: 'creative_project', entityId: projectId, before: { title: project.title } });
}

// ---------------------------------------------------------------------------
// Ideas
// ---------------------------------------------------------------------------

const ideaOutputSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        hook: z.string().min(1).max(400),
        angle: z.string().max(400).nullish(),
        visualDirection: z.string().max(800).nullish(),
        copy: z.object({
          headline: z.string().min(1).max(200),
          subheadline: z.string().max(400).nullish(),
          body: z.string().max(800).nullish(),
          cta: z.string().max(80).nullish(),
          price: z.union([z.string(), z.number()]).nullish(),
          badge: z.string().max(60).nullish(),
        }),
        claims: z
          .array(z.object({ text: z.string().max(500), factIds: z.array(z.string().max(24)).default([]), kind: z.enum(['fact', 'creative_phrase']).default('fact') }))
          .default([]),
      }),
    )
    .default([]),
});

export type IdeaCopy = { headline: string; subheadline: string | null; body: string | null; cta: string | null; price: string | null; badge: string | null };
export type IdeaClaim = { text: string; factIds: string[]; kind: 'fact' | 'creative_phrase' };

const IDEAS_FORMAT = `
## פורמט הפלט (JSON בלבד)
{"ideas":[{"title":"שם הרעיון","hook":"הוק של משפט אחד","angle":"הזווית השיווקית","visualDirection":"English description of the background image: scene, mood, colours. No text, no logos.","copy":{"headline":"כותרת עד 40 תווים","subheadline":"משפט משנה עד 90 תווים","body":null,"cta":"קריאה לפעולה עד 20 תווים","price":null,"badge":null},"claims":[{"text":"משפט עובדתי מהטקסט","factIds":["P1.F2"],"kind":"fact"},{"text":"סלוגן","factIds":[],"kind":"creative_phrase"}]}]}
- headline קצרה וחדה; subheadline מוסיפה את התועלת; cta מתוך הקריאות המועדפות אם קיימות.
- price רק אם יש עובדת מחיר (מזהה שמסתיים ב-.$) וההצעה עוסקת במוצר הזה — אחרת null.
- badge: תג קצר (עד 3 מילים) או null.
- כל רעיון חייב להיות שונה מהאחרים בזווית.`;

function normalizeIdeaCopy(copy: z.infer<typeof ideaOutputSchema>['ideas'][number]['copy']): IdeaCopy {
  const text = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    return s ? s : null;
  };
  return {
    headline: text(copy.headline) ?? '',
    subheadline: text(copy.subheadline),
    body: text(copy.body),
    cta: text(copy.cta),
    price: typeof copy.price === 'number' ? `${copy.price} ₪` : text(copy.price),
    badge: text(copy.badge),
  };
}

/** Deterministic QA for one idea: copy rules + claim citations. */
export function qaIdea(copy: IdeaCopy, claims: IdeaClaim[], packet: FactsPacket): QaReport {
  const base = runCopyQa(copy, packet);
  const known = new Set(packet.facts.map((f) => f.id));
  const findings: QaFinding[] = [...base.findings];
  for (const claim of claims) {
    if (claim.kind !== 'fact') continue;
    const unknown = claim.factIds.filter((id) => !known.has(id));
    if (claim.factIds.length === 0) {
      findings.push({ rule: 'uncited_claim', severity: 'WARN', field: 'claims', text: claim.text.slice(0, 120), reason: 'משפט עובדתי ללא מקור במידע המאושר' });
    } else if (unknown.length > 0) {
      findings.push({ rule: 'unknown_fact_ref', severity: 'WARN', field: 'claims', text: unknown.join(', '), reason: 'מזהה עובדה שאינו קיים בחבילת המידע' });
    }
  }
  const status = findings.some((f) => f.severity === 'BLOCK') ? 'BLOCKED' : findings.length ? 'WARN' : 'PASSED';
  return { status, findings, ranAt: new Date().toISOString() };
}

export async function generateIdeas(ctx: BrandContext, input: IdeaRequestInput): Promise<{ ideas: ContentIdea[]; run: RunTextResult }> {
  assertBrandRole(ctx, 'EDITOR');
  const project = input.projectId ? await ctx.db.creativeProject.findUnique({ where: { id: input.projectId } }) : null;
  if (input.projectId && !project) throw new NotFoundError('creative project');
  const productId = input.productId ?? project?.productId ?? null;
  const product = productId ? await ctx.db.brandProduct.findUnique({ where: { id: productId } }) : null;
  if (productId && !product) throw new NotFoundError('product');
  const packet = await buildFactsPacket(ctx);
  const goal = input.goal ?? project?.goal ?? null;
  const audience = input.audience ?? project?.audience ?? null;
  const prompt = [
    '<user_request>',
    `צור ${input.count} רעיונות לקריאייטיב ${project ? `${FORMAT_LABELS[project.format]} ל${CHANNEL_LABELS[project.channel]}` : 'לרשתות החברתיות'}.`,
    goal ? `מטרה: ${goal}` : '',
    audience ? `קהל יעד: ${audience}` : '',
    product ? `המוצר/השירות במוקד: ${product.name}` : 'בחר מוצר/שירות מתאים מהעובדות (או המותג בכללותו).',
    project?.style ? `סגנון: ${project.style}` : '',
    input.extra ?? '',
    '</user_request>',
  ]
    .filter(Boolean)
    .join('\n');

  const run = await runText(ctx, {
    task: 'CREATIVE_IDEAS',
    label: `רעיונות${project ? ` ל-${project.title}` : ''}`,
    system: `${groundingRules(packet)}\n${IDEAS_FORMAT}`,
    prompt,
    json: true,
    maxOutputTokens: 3500,
    factsHash: packet.hash,
    metadata: { projectId: project?.id ?? null, count: input.count },
  });

  const parsed = ideaOutputSchema.safeParse(run.json);
  if (!parsed.success) throw new AiOutputInvalidError('המודל החזיר רעיונות במבנה לא צפוי — נסו שוב');
  let ideas = parsed.data.ideas.slice(0, input.count);
  if (run.isMock && ideas.length === 0) {
    ideas = [
      {
        title: '[MOCK] רעיון לדוגמה',
        hook: '[MOCK] אין ספק AI מחובר — זהו רעיון דמה להדגמת הזרימה',
        angle: 'דמו',
        visualDirection: 'Abstract soft gradient background, no text',
        copy: { headline: `[MOCK] ${packet.brandName}`, subheadline: 'חברו מפתח AI בעמוד האינטגרציות כדי לקבל רעיונות אמיתיים', cta: packet.ctaPresets[0] ?? 'לפרטים', price: null, badge: 'MOCK', body: null },
        claims: [],
      },
    ];
  }
  if (ideas.length === 0) throw new AiOutputInvalidError('המודל לא החזיר רעיונות — נסו שוב או שנו את הבקשה');

  const rows: ContentIdea[] = [];
  for (const idea of ideas) {
    const copy = normalizeIdeaCopy(idea.copy);
    const claims: IdeaClaim[] = idea.claims.map((c) => ({ text: c.text, factIds: c.factIds, kind: c.kind }));
    const qa = qaIdea(copy, claims, packet);
    rows.push(
      await ctx.db.contentIdea.create({
        data: {
          brandId: ctx.brandId,
          productId,
          title: idea.title.trim(),
          hook: idea.hook.trim(),
          angle: idea.angle?.trim() || null,
          visualDirection: idea.visualDirection?.trim() || null,
          copy: copy as unknown as Prisma.InputJsonObject,
          claims: claims as unknown as Prisma.InputJsonArray,
          qa: qa as unknown as Prisma.InputJsonObject,
          status: 'NEW',
          source: run.isMock ? 'mock' : 'ai',
          aiRunId: run.run.id,
          factsHash: packet.hash,
          brief: { projectId: project?.id ?? null, goal, audience, channel: project?.channel ?? null, format: project?.format ?? null, model: run.modelId, provider: run.provider },
        },
      }),
    );
  }
  await auditFromContext(ctx, { action: 'creative.ideas.generate', entityType: 'creative_project', entityId: project?.id ?? null, after: { count: rows.length, model: run.modelId, mock: run.isMock } });
  return { ideas: rows, run };
}

export async function listIdeas(ctx: BrandContext, options: { projectId?: string; status?: IdeaStatus; limit?: number } = {}): Promise<ContentIdea[]> {
  return ctx.db.contentIdea.findMany({
    where: {
      ...(options.status ? { status: options.status } : {}),
      ...(options.projectId ? { brief: { path: ['projectId'], equals: options.projectId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
  });
}

export async function setIdeaStatus(ctx: BrandContext, ideaId: string, status: IdeaStatus): Promise<ContentIdea> {
  assertBrandRole(ctx, 'EDITOR');
  const idea = await ctx.db.contentIdea.findUnique({ where: { id: ideaId } });
  if (!idea) throw new NotFoundError('idea');
  return ctx.db.contentIdea.update({ where: { id: ideaId }, data: { status } });
}

// ---------------------------------------------------------------------------
// Versions (compose / edit / render / approve)
// ---------------------------------------------------------------------------

export async function loadComposeKit(ctx: BrandContext): Promise<ComposeKit> {
  const [settings, logo] = await Promise.all([
    ctx.db.brandSettings.findUnique({ where: { brandId: ctx.brandId } }),
    ctx.db.brandAsset.findFirst({ where: { type: 'LOGO_PRIMARY' }, orderBy: { createdAt: 'desc' }, include: { media: true } }),
  ]);
  return {
    colors: (settings?.colors ?? {}) as Record<string, string>,
    fonts: (settings?.fonts ?? {}) as Record<string, string>,
    logoMediaId: logo && !logo.media.deletedAt ? logo.mediaAssetId : null,
  };
}

type RenderDispatcher = (ctx: BrandContext, versionId: string) => Promise<void>;

const defaultDispatcher: RenderDispatcher = async (ctx, versionId) => {
  await getQueue(QUEUES.content).add(
    JOBS.creativeRender,
    { brandId: ctx.brandId, versionId, actorUserId: ctx.actor.userId || null, idempotencyKey: `creative.render:${versionId}:${Date.now()}` },
    { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
  );
};
let dispatcher: RenderDispatcher = defaultDispatcher;

/** Test hook: replace the queue dispatch (no Redis needed). */
export function setCreativeRenderDispatcher(fn: RenderDispatcher | null): void {
  dispatcher = fn ?? defaultDispatcher;
}

export async function enqueueCreativeRender(ctx: BrandContext, versionId: string): Promise<void> {
  await ctx.db.creativeVersion.update({ where: { id: versionId }, data: { renderStatus: 'PENDING', renderError: null } });
  try {
    await dispatcher(ctx, versionId);
  } catch (err) {
    logger.error({ err, versionId }, 'creative render could not be queued');
    await ctx.db.creativeVersion.update({ where: { id: versionId }, data: { renderStatus: 'FAILED', renderError: 'תור הרינדור אינו זמין — נסו שוב' } });
  }
}

async function createVersion(ctx: BrandContext, project: CreativeProject, doc: CreativeDocument, note: string | null, ideaId?: string | null): Promise<CreativeVersion> {
  const packet = await buildFactsPacket(ctx);
  const copy = documentCopy(doc);
  const qa = runCopyQa(copy, packet);
  const last = await ctx.db.creativeVersion.findFirst({ where: { projectId: project.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = await ctx.db.creativeVersion.create({
    data: {
      brandId: ctx.brandId,
      projectId: project.id,
      version: (last?.version ?? 0) + 1,
      document: doc as unknown as Prisma.InputJsonObject,
      copy: copy as Prisma.InputJsonObject,
      qa: qa as unknown as Prisma.InputJsonObject,
      status: 'DRAFT',
      factsHash: packet.hash,
      note,
      createdById: ctx.actor.userId || null,
    },
  });
  await ctx.db.creativeVersion.updateMany({ where: { projectId: project.id, id: { not: version.id }, status: { in: ['DRAFT', 'READY'] } }, data: { status: 'SUPERSEDED' } });
  await ctx.db.creativeProject.update({
    where: { id: project.id },
    data: { currentVersionId: version.id, status: project.status === 'ARCHIVED' ? 'ARCHIVED' : 'DRAFT', ...(ideaId ? { ideaId } : {}) },
  });
  if (ideaId) await ctx.db.contentIdea.update({ where: { id: ideaId }, data: { status: 'USED' } }).catch(() => undefined);
  await auditFromContext(ctx, { action: 'creative.version.create', entityType: 'creative_version', entityId: version.id, after: { projectId: project.id, version: version.version, qa: qa.status } });
  await enqueueCreativeRender(ctx, version.id);
  return version;
}

/** Build a version from copy + template + Brand Kit (first version or a fresh layout). */
export async function composeCreativeVersion(ctx: BrandContext, projectId: string, input: ComposeCreativeInput): Promise<CreativeVersion> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.creativeProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('creative project');
  if (input.backgroundMediaId) await getMedia(ctx, input.backgroundMediaId);
  if (input.ideaId) {
    const idea = await ctx.db.contentIdea.findUnique({ where: { id: input.ideaId } });
    if (!idea) throw new NotFoundError('idea');
  }
  const kit = await loadComposeKit(ctx);
  const doc = buildDocument({ aspect: project.aspect, copy: input.copy, kit, template: input.template, backgroundMediaId: input.backgroundMediaId ?? null });
  return createVersion(ctx, project, doc, input.note ?? null, input.ideaId ?? null);
}

/** Save an edited document as a new version (versions are immutable once created). */
export async function saveCreativeVersion(ctx: BrandContext, projectId: string, input: SaveVersionInput): Promise<CreativeVersion> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.creativeProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('creative project');
  let doc: CreativeDocument;
  try {
    doc = parseDocument(input.document);
  } catch (err) {
    if (err instanceof z.ZodError) throw ValidationError.fromZod(err);
    throw err;
  }
  if (doc.aspect !== project.aspect) throw new ValidationError('יחס המסך של המסמך אינו תואם לפרויקט');
  const { width, height } = ASPECTS[project.aspect];
  if (doc.width !== width || doc.height !== height) throw new ValidationError('גודל הקנבס אינו תואם ליחס המסך');
  for (const mediaId of documentMediaIds(doc)) await getMedia(ctx, mediaId);
  return createVersion(ctx, project, doc, input.note ?? null);
}

export async function getCreativeVersion(ctx: BrandContext, versionId: string): Promise<CreativeVersion & { project: CreativeProject }> {
  const version = await ctx.db.creativeVersion.findUnique({ where: { id: versionId }, include: { project: true } });
  if (!version) throw new NotFoundError('creative version');
  return version;
}

/** HTML for the in-app live preview (iframe srcdoc): fonts and images via app URLs. */
export function previewHtml(ctx: BrandContext, doc: CreativeDocument): string {
  const images: Record<string, string> = {};
  for (const id of documentMediaIds(doc)) images[id] = mediaFileUrl({ id, brandId: ctx.brandId });
  return documentToHtml(doc, { mode: 'preview', images });
}

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2600;

async function readAll(stream: NodeJS.ReadableStream, cap: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > cap) throw new ValidationError('Image too large to render');
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/** Inline every referenced image as a data: URI (downscaled when huge) so the render needs no network. */
export async function loadImageDataUrls(ctx: BrandContext, mediaIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of mediaIds) {
    const { asset, object } = await openMediaObject(ctx, id);
    let data = await readAll(object.body, MAX_IMAGE_BYTES);
    let mime = asset.mimeType;
    if (mime !== 'image/svg+xml' && ((asset.width ?? 0) > MAX_IMAGE_SIDE || (asset.height ?? 0) > MAX_IMAGE_SIDE)) {
      data = await sharp(data, { failOn: 'error' }).resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
      mime = 'image/png';
    }
    out[id] = `data:${mime};base64,${data.toString('base64')}`;
  }
  return out;
}

export interface RenderBackend {
  renderHtml(html: string, opts: { width: number; height: number }): Promise<{ png: Buffer; warnings: RenderWarning[]; fitted: Record<string, number>; durationMs: number }>;
  encodeVariants(png: Buffer): Promise<{ jpg: Buffer; webp: Buffer }>;
}

/** Worker entry: render one version to PNG/JPG/WebP media assets. */
export async function renderCreativeVersion(ctx: BrandContext, versionId: string, backend: RenderBackend): Promise<CreativeVersion> {
  const version = await getCreativeVersion(ctx, versionId);
  await ctx.db.creativeVersion.update({ where: { id: versionId }, data: { renderStatus: 'RENDERING', renderError: null } });
  try {
    const doc = parseDocument(version.document);
    const images = await loadImageDataUrls(ctx, documentMediaIds(doc));
    const html = documentToHtml(doc, { mode: 'render', images, fontSrc: renderFontSources() });
    const result = await backend.renderHtml(html, { width: doc.width, height: doc.height });
    const { jpg, webp } = await backend.encodeVariants(result.png);
    const base = `${slugify(version.project.title, 'creative')}-v${version.version}`;
    const title = `${version.project.title} — גרסה ${version.version}`;
    const png = await uploadMedia(ctx, { data: result.png, originalName: `${base}.png`, mimeType: 'image/png', title, tags: ['creative', 'render'], source: 'RENDERED' });
    const jpgAsset = await uploadMedia(ctx, { data: jpg, originalName: `${base}.jpg`, mimeType: 'image/jpeg', title, tags: ['creative', 'render'], source: 'RENDERED' });
    const webpAsset = await uploadMedia(ctx, { data: webp, originalName: `${base}.webp`, mimeType: 'image/webp', title, tags: ['creative', 'render'], source: 'RENDERED' });
    const updated = await ctx.db.creativeVersion.update({
      where: { id: versionId },
      data: {
        renderStatus: 'READY',
        renderError: null,
        renderWarnings: { warnings: result.warnings, fitted: result.fitted, durationMs: result.durationMs } as unknown as Prisma.InputJsonObject,
        renderedPngId: png.id,
        renderedJpgId: jpgAsset.id,
        renderedWebpId: webpAsset.id,
        status: version.status === 'DRAFT' ? 'READY' : version.status,
      },
    });
    await auditFromContext(ctx, { action: 'creative.version.render', entityType: 'creative_version', entityId: versionId, after: { warnings: result.warnings.length, durationMs: result.durationMs } });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db.creativeVersion.update({ where: { id: versionId }, data: { renderStatus: 'FAILED', renderError: message.slice(0, 1000) } }).catch(() => undefined);
    throw err;
  }
}

export async function generateCreativeBackground(ctx: BrandContext, projectId: string, input: BackgroundRequestInput): Promise<{ asset: Awaited<ReturnType<typeof uploadMedia>>; run: RunImageResult }> {
  assertBrandRole(ctx, 'EDITOR');
  const project = await ctx.db.creativeProject.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('creative project');
  const settings = await ctx.db.brandSettings.findUnique({ where: { brandId: ctx.brandId } });
  const colors = Object.entries((settings?.colors ?? {}) as Record<string, string>)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  // Provider-supported generation sizes; the layout scales the result to the canvas.
  const size = project.aspect === 'R1X1' ? { width: 1024, height: 1024 } : project.aspect === 'R16X9' || project.aspect === 'R191X1' ? { width: 1536, height: 1024 } : { width: 1024, height: 1536 };
  const prompt = [
    input.prompt,
    `Style: ${settings?.graphicStyle ?? 'clean, modern, premium marketing photography'}.`,
    colors ? `Brand colour palette to harmonise with: ${colors}.` : '',
    'Absolutely no text, letters, numbers, logos or watermarks. Leave calm negative space for a headline. Photorealistic unless the style says otherwise.',
  ]
    .filter(Boolean)
    .join(' ');
  const run = await runImage(ctx, { task: 'CREATIVE_BACKGROUND', label: `רקע ל-${project.title}`, prompt, ...size, quality: input.quality, metadata: { projectId } });
  const image = run.images[0];
  if (!image) throw new AiOutputInvalidError('לא התקבלה תמונה');
  const asset = await uploadMedia(ctx, {
    data: image.data,
    originalName: `ai-background-${Date.now()}.png`,
    mimeType: image.mimeType,
    title: `רקע AI — ${project.title}`,
    altText: input.prompt.slice(0, 250),
    tags: ['ai', 'background', run.isMock ? 'mock' : 'generated'],
    source: 'AI_GENERATED',
  });
  return { asset, run };
}

/** Queue a fresh render of an existing version (after a failure, or to pick up a new logo). */
export async function rerenderCreativeVersion(ctx: BrandContext, versionId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  const version = await getCreativeVersion(ctx, versionId);
  if (version.renderStatus === 'RENDERING') throw new ConflictError('הגרסה מרונדרת כעת');
  await enqueueCreativeRender(ctx, versionId);
}

export async function requestCreativeApproval(ctx: BrandContext, versionId: string): Promise<CreativeVersion> {
  assertBrandRole(ctx, 'EDITOR');
  const version = await getCreativeVersion(ctx, versionId);
  if (version.renderStatus !== 'READY') throw new ConflictError('הגרסה עדיין לא רונדרה');
  const qa = version.qa as unknown as QaReport | null;
  if (qa?.status === 'BLOCKED') throw new ConflictError('בקרת האיכות חסמה את הגרסה — תקנו את הטקסט לפני שליחה לאישור');
  if (version.status === 'APPROVED') throw new ConflictError('הגרסה כבר אושרה');
  const copy = (version.copy ?? {}) as Record<string, string>;
  const approval = await requestApproval(ctx, {
    type: 'CONTENT_POST',
    title: `קריאייטיב: ${version.project.title} (גרסה ${version.version})`,
    summary: copy.headline ?? null,
    subjectType: 'creative_version',
    subjectId: version.id,
    payload: { projectId: version.projectId, versionId: version.id, renderedPngId: version.renderedPngId, qa: qa?.status ?? null },
  });
  const updated = await ctx.db.creativeVersion.update({ where: { id: versionId }, data: { approvalId: approval.id } });
  await ctx.db.creativeProject.update({ where: { id: version.projectId }, data: { status: 'IN_REVIEW' } });
  return updated;
}

registerApprovalHandler('creative_version', async (ctx, approval) => {
  const version = await ctx.db.creativeVersion.findUnique({ where: { id: approval.subjectId } });
  if (!version) return;
  if (approval.status === 'APPROVED') {
    if (version.renderStatus !== 'READY') throw new ConflictError('הגרסה אינה מרונדרת');
    await ctx.db.creativeVersion.update({ where: { id: version.id }, data: { status: 'APPROVED' } });
    await ctx.db.creativeProject.update({ where: { id: version.projectId }, data: { status: 'APPROVED', currentVersionId: version.id } });
  } else if (approval.status === 'REJECTED') {
    await ctx.db.creativeVersion.update({ where: { id: version.id }, data: { status: 'REJECTED' } });
    await ctx.db.creativeProject.update({ where: { id: version.projectId }, data: { status: 'REJECTED' } });
  } else if (approval.status === 'CHANGES_REQUESTED') {
    await ctx.db.creativeProject.update({ where: { id: version.projectId }, data: { status: 'DRAFT' } });
  }
});

export type { CreativeCopyInput };
