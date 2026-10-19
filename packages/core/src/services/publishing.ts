/**
 * Phase 4 — content calendar and publishing to a Facebook Page and Instagram.
 * A post is published only after an approval bound to its exact content
 * (channel + caption + media) is APPROVED; the worker publishes due posts with
 * a claim (SCHEDULED → PUBLISHING) so a post can never go out twice.
 */
import { createHash } from 'node:crypto';
import { db } from '@mm/db';
import type { Prisma, ScheduledPost, SocialChannel } from '@mm/db';
import sharp from 'sharp';
import { runText } from '../ai/engine';
import { buildFactsPacket, groundingRules } from '../ai/facts';
import { runCopyQa } from '../ai/qa';
import type { QaReport } from '../ai/qa';
import { auditFromContext } from '../audit';
import { getConfig } from '../config';
import { decryptJson } from '../crypto';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { GraphClient, MetaApiError } from '../meta/graph';
import type { GraphFetcher } from '../meta/graph';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole, systemBrandContext } from '../tenancy/context';
import { markApprovalExecuted, markApprovalScheduled, registerApprovalHandler, requestApproval } from './approvals';
import { META_PROVIDER } from './meta';
import type { MetaConnectionMeta, MetaStoredCredentials } from './meta';
import { getMedia, readMediaBuffer, uploadMedia } from './media';
import { notifyBrandAdmins } from './notifications';
import { createPublicMediaUrl } from './public-media';

export const CHANNEL_NAMES: Record<SocialChannel, string> = { FACEBOOK_PAGE: 'עמוד פייסבוק', INSTAGRAM: 'אינסטגרם' };
const CAPTION_MAX: Record<SocialChannel, number> = { FACEBOOK_PAGE: 5000, INSTAGRAM: 2200 };
const MAX_ATTEMPTS = 3;
/** A post stuck in PUBLISHING longer than this is marked FAILED (never retried blindly — it may have gone out). */
const STUCK_PUBLISHING_MS = 30 * 60_000;

export function postContentHash(channel: SocialChannel, caption: string, mediaId: string | null): string {
  return createHash('sha256').update([channel, caption, mediaId ?? ''].join('\u0000')).digest('hex').slice(0, 24);
}

// ---------------------------------------------------------------------------
// Time helpers (the UI works in Asia/Jerusalem wall-clock time)
// ---------------------------------------------------------------------------

/** "2026-10-20T09:30" in Asia/Jerusalem → Date. */
export function fromJerusalemLocal(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) throw new ValidationError('תאריך לא תקין', [{ path: 'scheduledAt', message: 'תאריך לא תקין' }]);
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asJerusalem = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (asJerusalem - guess));
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface PostInput {
  channels: SocialChannel[];
  caption: string;
  mediaId: string | null;
  sourceType?: 'creative_version' | 'video_project' | 'media' | null;
  sourceId?: string | null;
  scheduledAt: Date;
}

async function resolveMedia(ctx: BrandContext, mediaId: string | null): Promise<'NONE' | 'IMAGE' | 'VIDEO'> {
  if (!mediaId) return 'NONE';
  const media = await getMedia(ctx, mediaId);
  if (media.kind === 'IMAGE' && media.mimeType !== 'image/svg+xml') return 'IMAGE';
  if (media.kind === 'VIDEO') return 'VIDEO';
  throw new ValidationError('אפשר לפרסם תמונה או וידאו בלבד', [{ path: 'mediaId', message: 'סוג קובץ לא נתמך' }]);
}

function validatePost(channel: SocialChannel, caption: string, mediaType: string, scheduledAt: Date): void {
  if (caption.length > CAPTION_MAX[channel]) throw new ValidationError(`הכיתוב ארוך מדי ל${CHANNEL_NAMES[channel]}`, [{ path: 'caption', message: `עד ${CAPTION_MAX[channel]} תווים` }]);
  if (channel === 'INSTAGRAM' && mediaType === 'NONE') throw new ValidationError('באינסטגרם חובה תמונה או וידאו', [{ path: 'mediaId', message: 'חובה לאינסטגרם' }]);
  if (channel === 'FACEBOOK_PAGE' && mediaType === 'NONE' && !caption.trim()) throw new ValidationError('פוסט ריק', [{ path: 'caption', message: 'חובה טקסט או מדיה' }]);
  if (scheduledAt.getTime() < Date.now() - 60_000) throw new ValidationError('מועד הפרסום עבר', [{ path: 'scheduledAt', message: 'בחרו מועד עתידי' }]);
  if (scheduledAt.getTime() > Date.now() + 180 * 86_400_000) throw new ValidationError('אפשר לתזמן עד חצי שנה קדימה', [{ path: 'scheduledAt', message: 'רחוק מדי' }]);
}

export async function createPosts(ctx: BrandContext, input: PostInput): Promise<ScheduledPost[]> {
  assertBrandRole(ctx, 'EDITOR');
  if (input.channels.length === 0) throw new ValidationError('בחרו לפחות ערוץ אחד', [{ path: 'channels', message: 'חובה' }]);
  const mediaType = await resolveMedia(ctx, input.mediaId);
  const caption = input.caption.trim();
  const posts: ScheduledPost[] = [];
  for (const channel of [...new Set(input.channels)]) {
    validatePost(channel, caption, mediaType, input.scheduledAt);
    posts.push(
      await ctx.db.scheduledPost.create({
        data: {
          brandId: ctx.brandId,
          channel,
          caption,
          mediaType,
          mediaId: input.mediaId,
          sourceType: input.sourceType ?? (input.mediaId ? 'media' : null),
          sourceId: input.sourceId ?? null,
          scheduledAt: input.scheduledAt,
          contentHash: postContentHash(channel, caption, input.mediaId),
          createdById: ctx.actor.userId || null,
        },
      }),
    );
  }
  await auditFromContext(ctx, { action: 'post.create', entityType: 'scheduled_post', entityId: posts[0]?.id ?? null, after: { channels: input.channels, scheduledAt: input.scheduledAt, mediaType } });
  return posts;
}

export async function getPost(ctx: BrandContext, postId: string): Promise<ScheduledPost> {
  const post = await ctx.db.scheduledPost.findUnique({ where: { id: postId } });
  if (!post) throw new NotFoundError('post');
  return post;
}

export async function listPosts(ctx: BrandContext, range: { from: Date; to: Date }): Promise<ScheduledPost[]> {
  return ctx.db.scheduledPost.findMany({ where: { scheduledAt: { gte: range.from, lt: range.to } }, orderBy: { scheduledAt: 'asc' } });
}

export async function updatePost(ctx: BrandContext, postId: string, input: { caption: string; mediaId: string | null; scheduledAt: Date }): Promise<ScheduledPost> {
  assertBrandRole(ctx, 'EDITOR');
  const post = await getPost(ctx, postId);
  if (post.status === 'PUBLISHING' || post.status === 'PUBLISHED') throw new ConflictError('הפוסט כבר פורסם');
  const mediaType = await resolveMedia(ctx, input.mediaId);
  const caption = input.caption.trim();
  validatePost(post.channel, caption, mediaType, input.scheduledAt);
  const contentHash = postContentHash(post.channel, caption, input.mediaId);
  const contentChanged = contentHash !== post.contentHash;
  const updated = await ctx.db.scheduledPost.update({
    where: { id: postId },
    data: {
      caption,
      mediaId: input.mediaId,
      mediaType,
      scheduledAt: input.scheduledAt,
      contentHash,
      // A content change invalidates the approval; a new time does not.
      ...(contentChanged ? { status: 'DRAFT', approvalId: null } : post.status === 'CANCELLED' || post.status === 'FAILED' ? { status: post.approvalId ? 'SCHEDULED' : 'DRAFT' } : {}),
      error: null,
    },
  });
  await auditFromContext(ctx, { action: 'post.update', entityType: 'scheduled_post', entityId: postId, before: { status: post.status, scheduledAt: post.scheduledAt }, after: { status: updated.status, scheduledAt: updated.scheduledAt, contentChanged } });
  return updated;
}

export async function requestPostApproval(ctx: BrandContext, postId: string): Promise<ScheduledPost> {
  assertBrandRole(ctx, 'EDITOR');
  const post = await getPost(ctx, postId);
  if (post.status !== 'DRAFT') throw new ConflictError('רק טיוטה נשלחת לאישור');
  const approval = await requestApproval(ctx, {
    type: 'CONTENT_POST',
    title: `${CHANNEL_NAMES[post.channel]} · ${post.scheduledAt.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}`,
    summary: post.caption.slice(0, 280),
    subjectType: 'scheduled_post',
    subjectId: `${post.id}:${post.contentHash}`,
    payload: { postId: post.id, channel: post.channel, mediaId: post.mediaId, mediaType: post.mediaType, scheduledAt: post.scheduledAt.toISOString() },
  });
  return ctx.db.scheduledPost.update({ where: { id: postId }, data: { status: 'PENDING_APPROVAL', approvalId: approval.id } });
}

registerApprovalHandler('scheduled_post', async (ctx, approval) => {
  const [postId, hash] = approval.subjectId.split(':');
  const post = await ctx.db.scheduledPost.findUnique({ where: { id: postId ?? '' } });
  if (!post) return;
  if (approval.status === 'APPROVED') {
    if (post.contentHash !== hash) throw new ConflictError('הפוסט שונה אחרי בקשת האישור — יש לשלוח את הגרסה החדשה');
    if (post.status !== 'PENDING_APPROVAL') return;
    await ctx.db.scheduledPost.update({ where: { id: post.id }, data: { status: 'SCHEDULED', approvalId: approval.id } });
    await markApprovalScheduled(ctx, approval.id);
  } else if (approval.status === 'REJECTED' || approval.status === 'CHANGES_REQUESTED') {
    if (post.contentHash === hash && post.status === 'PENDING_APPROVAL') await ctx.db.scheduledPost.update({ where: { id: post.id }, data: { status: 'DRAFT', approvalId: null } });
  }
});

export async function cancelPost(ctx: BrandContext, postId: string): Promise<ScheduledPost> {
  assertBrandRole(ctx, 'EDITOR');
  const post = await getPost(ctx, postId);
  if (post.status === 'PUBLISHING' || post.status === 'PUBLISHED') throw new ConflictError('הפוסט כבר פורסם');
  const updated = await ctx.db.scheduledPost.update({ where: { id: postId }, data: { status: 'CANCELLED' } });
  await auditFromContext(ctx, { action: 'post.cancel', entityType: 'scheduled_post', entityId: postId });
  return updated;
}

export async function deletePost(ctx: BrandContext, postId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  const post = await getPost(ctx, postId);
  if (post.status === 'PUBLISHING' || post.status === 'PUBLISHED' || post.status === 'SCHEDULED') throw new ConflictError('אפשר למחוק טיוטה, פוסט מבוטל או פוסט שנכשל');
  await ctx.db.scheduledPost.delete({ where: { id: postId } });
  await auditFromContext(ctx, { action: 'post.delete', entityType: 'scheduled_post', entityId: postId });
}

/** Re-queue a failed post now (its approval still covers the unchanged content). */
export async function retryPost(ctx: BrandContext, postId: string): Promise<ScheduledPost> {
  assertBrandRole(ctx, 'EDITOR');
  const post = await getPost(ctx, postId);
  if (post.status !== 'FAILED') throw new ConflictError('רק פוסט שנכשל ניתן לנסות שוב');
  if (!post.approvalId) throw new ConflictError('הפוסט צריך אישור');
  return ctx.db.scheduledPost.update({ where: { id: postId }, data: { status: 'SCHEDULED', scheduledAt: new Date(), attempts: 0, error: null } });
}

// ---------------------------------------------------------------------------
// AI caption
// ---------------------------------------------------------------------------

export async function generateCaption(ctx: BrandContext, input: { channel: SocialChannel; brief: string }): Promise<{ caption: string; qa: QaReport; isMock: boolean }> {
  assertBrandRole(ctx, 'EDITOR');
  const packet = await buildFactsPacket(ctx);
  const run = await runText(ctx, {
    task: 'CREATIVE_COPY',
    label: `כיתוב ל${CHANNEL_NAMES[input.channel]}`,
    system: `${groundingRules(packet)}\n\nכתוב כיתוב לפוסט ב${CHANNEL_NAMES[input.channel]}: פתיח חזק בשורה הראשונה, 2–4 שורות קצרות, קריאה לפעולה ברורה${packet.hashtags.length ? `, ובסוף 3–6 האשטגים מתוך: ${packet.hashtags.join(' ')}` : ''}. ${input.channel === 'INSTAGRAM' ? 'עד 1,500 תווים.' : 'עד 1,000 תווים.'} החזר JSON: {"caption":"..."}`,
    prompt: `<user_request>${input.brief}</user_request>`,
    json: true,
    maxOutputTokens: 1200,
    factsHash: packet.hash,
  });
  const caption = String((run.json as { caption?: string } | null)?.caption ?? (run.isMock ? `[MOCK] ${input.brief}` : '')).trim();
  if (!caption) throw new ValidationError('המודל לא החזיר כיתוב — נסו שוב');
  return { caption, qa: runCopyQa({ caption }, packet), isMock: run.isMock };
}

// ---------------------------------------------------------------------------
// Publishing (worker)
// ---------------------------------------------------------------------------

interface Target {
  pageId: string;
  pageToken: string;
  instagramId: string | null;
}

async function publishTarget(ctx: BrandContext): Promise<Target> {
  const row = await db.providerAccount.findFirst({ where: { orgId: ctx.orgId, brandId: ctx.brandId, provider: META_PROVIDER } });
  if (!row?.credentialsEnc || row.status === 'DISCONNECTED') throw new ConflictError('המותג אינו מחובר ל-Meta');
  const creds = decryptJson<MetaStoredCredentials>(row.credentialsEnc);
  const meta = (row.metadata ?? {}) as unknown as MetaConnectionMeta;
  const pageId = meta.selected?.pageId;
  const page = creds.pages.find((p) => p.id === pageId);
  if (!page?.accessToken) throw new ConflictError('לא נבחר עמוד פייסבוק לפרסום (אינטגרציות → Meta)');
  return { pageId: page.id, pageToken: page.accessToken, instagramId: meta.selected?.instagramId ?? page.instagram?.id ?? null };
}

async function ensureJpeg(ctx: BrandContext, post: ScheduledPost): Promise<{ id: string; brandId: string }> {
  const media = await getMedia(ctx, post.mediaId!);
  if (media.mimeType === 'image/jpeg') return media;
  const cached = (post.meta as { jpegMediaId?: string } | null)?.jpegMediaId;
  if (cached) {
    const ok = await getMedia(ctx, cached).then((m) => m, () => null);
    if (ok) return ok;
  }
  const { data } = await readMediaBuffer(ctx, media.id, 50 * 1024 * 1024);
  const jpeg = await sharp(data, { failOn: 'error' }).flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  const asset = await uploadMedia(ctx, { data: jpeg, originalName: `${media.originalName.replace(/\.[^.]+$/, '')}.jpg`, mimeType: 'image/jpeg', title: media.title, tags: ['publish', 'jpeg'], source: 'RENDERED' });
  await ctx.db.scheduledPost.update({ where: { id: post.id }, data: { meta: { ...((post.meta as Record<string, unknown>) ?? {}), jpegMediaId: asset.id } as Prisma.InputJsonObject } });
  return asset;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForContainer(client: GraphClient, containerId: string, token: string, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  for (;;) {
    const s = await client.get<{ status_code?: string; status?: string }>(containerId, { fields: 'status_code,status' }, token);
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new MetaApiError(`Instagram: עיבוד המדיה נכשל (${s.status ?? s.status_code})`, { status: 502 });
    if (Date.now() > deadline) throw new MetaApiError('Instagram: עיבוד המדיה לוקח יותר מדי זמן', { status: 504 });
    await sleep(8_000);
  }
}

/** Publish one post now. Returns the external id and permalink. */
export async function publishPost(ctx: BrandContext, post: ScheduledPost, fetcher?: GraphFetcher): Promise<{ externalId: string; permalink: string | null }> {
  const target = await publishTarget(ctx);
  const client = new GraphClient(fetcher);
  const token = target.pageToken;
  if (post.channel === 'FACEBOOK_PAGE') {
    if (post.mediaType === 'NONE') {
      const res = await client.post<{ id: string }>(`${target.pageId}/feed`, { message: post.caption }, token);
      const link = await client.get<{ permalink_url?: string }>(res.id, { fields: 'permalink_url' }, token).catch(() => ({}) as { permalink_url?: string });
      return { externalId: res.id, permalink: link.permalink_url ?? null };
    }
    const { asset, data } = await readMediaBuffer(ctx, post.mediaId!, 1024 * 1024 * 1024);
    const blob = new Blob([new Uint8Array(data)], { type: asset.mimeType });
    if (post.mediaType === 'IMAGE') {
      const res = await client.post<{ id: string; post_id?: string }>(`${target.pageId}/photos`, { source: blob, caption: post.caption, published: 'true' }, token);
      const id = res.post_id ?? res.id;
      const link = await client.get<{ permalink_url?: string }>(id, { fields: 'permalink_url' }, token).catch(() => ({}) as { permalink_url?: string });
      return { externalId: id, permalink: link.permalink_url ?? null };
    }
    const res = await client.post<{ id: string }>(`${target.pageId}/videos`, { source: blob, description: post.caption }, token, { host: 'graph-video.facebook.com', timeoutMs: 20 * 60_000 });
    const link = await client.get<{ permalink_url?: string }>(res.id, { fields: 'permalink_url' }, token).catch(() => ({}) as { permalink_url?: string });
    return { externalId: res.id, permalink: link.permalink_url ? `https://www.facebook.com${link.permalink_url.startsWith('/') ? link.permalink_url : `/${link.permalink_url}`}` : null };
  }

  // Instagram (via the Page token — Instagram API with Facebook Login)
  if (!target.instagramId) throw new ConflictError('לעמוד שנבחר אין חשבון אינסטגרם עסקי מקושר');
  const ig = target.instagramId;
  let containerId: string;
  if (post.mediaType === 'IMAGE') {
    const jpeg = await ensureJpeg(ctx, post);
    const res = await client.post<{ id: string }>(`${ig}/media`, { image_url: createPublicMediaUrl(jpeg, 3600), caption: post.caption }, token);
    containerId = res.id;
    await waitForContainer(client, containerId, token, 3 * 60_000);
  } else if (post.mediaType === 'VIDEO') {
    const { data } = await readMediaBuffer(ctx, post.mediaId!, 1024 * 1024 * 1024);
    const res = await client.post<{ id: string; uri?: string }>(`${ig}/media`, { media_type: 'REELS', upload_type: 'resumable', caption: post.caption }, token);
    containerId = res.id;
    const uploadUrl = res.uri ?? `https://rupload.facebook.com/ig-api-upload/${getConfig().META_API_VERSION}/${containerId}`;
    await client.postBinary(uploadUrl, new Uint8Array(data), { Authorization: `OAuth ${token}`, offset: '0', file_size: String(data.length) });
    await waitForContainer(client, containerId, token, 15 * 60_000);
  } else {
    throw new ValidationError('באינסטגרם חובה תמונה או וידאו');
  }
  const published = await client.post<{ id: string }>(`${ig}/media_publish`, { creation_id: containerId }, token);
  const link = await client.get<{ permalink?: string }>(published.id, { fields: 'permalink' }, token).catch(() => ({}) as { permalink?: string });
  return { externalId: published.id, permalink: link.permalink ?? null };
}

function retryable(err: unknown): boolean {
  if (err instanceof MetaApiError) return err.status === 429 || err.status === 502 || err.status === 504;
  return !(err instanceof ValidationError || err instanceof ConflictError);
}

/** Worker: publish every approved post that is due. Safe to run concurrently (claim by status). */
export async function publishDuePosts(now = new Date(), fetcher?: GraphFetcher): Promise<{ published: number; failed: number; retried: number }> {
  const stats = { published: 0, failed: 0, retried: 0 };
  // Anything left in PUBLISHING (worker crash) is surfaced, never re-sent blindly.
  const stuck = await db.scheduledPost.findMany({ where: { status: 'PUBLISHING', updatedAt: { lt: new Date(now.getTime() - STUCK_PUBLISHING_MS) } }, take: 50 });
  for (const p of stuck) {
    await db.scheduledPost.update({ where: { id: p.id }, data: { status: 'FAILED', error: 'הפרסום נקטע באמצע — בדקו בעמוד אם הפוסט עלה לפני ניסיון חוזר' } });
  }
  const due = await db.scheduledPost.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, orderBy: { scheduledAt: 'asc' }, take: 20 });
  for (const candidate of due) {
    const claim = await db.scheduledPost.updateMany({ where: { id: candidate.id, status: 'SCHEDULED' }, data: { status: 'PUBLISHING', attempts: { increment: 1 } } });
    if (claim.count !== 1) continue;
    const post = { ...candidate, attempts: candidate.attempts + 1 };
    const ctx = await systemBrandContext(post.brandId, post.createdById);
    try {
      const { externalId, permalink } = await publishPost(ctx, post, fetcher);
      await db.scheduledPost.update({ where: { id: post.id }, data: { status: 'PUBLISHED', externalId, permalink, publishedAt: new Date(), error: null } });
      if (post.approvalId) await markApprovalExecuted(ctx, post.approvalId).catch(() => undefined);
      await auditFromContext(ctx, { action: 'post.published', entityType: 'scheduled_post', entityId: post.id, after: { channel: post.channel, externalId, permalink } });
      stats.published += 1;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
      logger.warn({ err, postId: post.id }, 'publish failed');
      if (retryable(err) && post.attempts < MAX_ATTEMPTS) {
        await db.scheduledPost.update({ where: { id: post.id }, data: { status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 5 * 60_000 * post.attempts), error: message } });
        stats.retried += 1;
      } else {
        await db.scheduledPost.update({ where: { id: post.id }, data: { status: 'FAILED', error: message } });
        await notifyBrandAdmins({ ...ctx, actor: { ...ctx.actor, userId: '' } }, { level: 'ERROR', title: `פרסום נכשל ב${CHANNEL_NAMES[post.channel]}`, body: message, link: '/app/calendar' }).catch(() => undefined);
        stats.failed += 1;
      }
    }
  }
  return stats;
}
