import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { MediaAsset, MediaKind, MediaSource, Prisma } from '@mm/db';
import sharp from 'sharp';
import { auditFromContext } from '../audit';
import { getConfig } from '../config';
import { sha256Hex } from '../crypto';
import { AppError, NotFoundError, PayloadTooLargeError, ValidationError } from '../errors';
import { getStorage } from '../storage';
import type { ByteRange, StoredObject } from '../storage';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import type { MediaListQuery, MediaUpdateInput } from '../validation';

interface MediaType {
  kind: MediaKind;
  ext: string;
  mime: string;
}

const BY_MIME: Record<string, MediaType> = {
  'image/jpeg': { kind: 'IMAGE', ext: '.jpg', mime: 'image/jpeg' },
  'image/png': { kind: 'IMAGE', ext: '.png', mime: 'image/png' },
  'image/webp': { kind: 'IMAGE', ext: '.webp', mime: 'image/webp' },
  'image/gif': { kind: 'IMAGE', ext: '.gif', mime: 'image/gif' },
  'image/svg+xml': { kind: 'IMAGE', ext: '.svg', mime: 'image/svg+xml' },
  'video/mp4': { kind: 'VIDEO', ext: '.mp4', mime: 'video/mp4' },
  'video/quicktime': { kind: 'VIDEO', ext: '.mov', mime: 'video/quicktime' },
  'video/webm': { kind: 'VIDEO', ext: '.webm', mime: 'video/webm' },
  'audio/mpeg': { kind: 'AUDIO', ext: '.mp3', mime: 'audio/mpeg' },
  'audio/wav': { kind: 'AUDIO', ext: '.wav', mime: 'audio/wav' },
  'audio/x-wav': { kind: 'AUDIO', ext: '.wav', mime: 'audio/wav' },
  'audio/mp4': { kind: 'AUDIO', ext: '.m4a', mime: 'audio/mp4' },
  'font/ttf': { kind: 'FONT', ext: '.ttf', mime: 'font/ttf' },
  'font/otf': { kind: 'FONT', ext: '.otf', mime: 'font/otf' },
  'font/woff': { kind: 'FONT', ext: '.woff', mime: 'font/woff' },
  'font/woff2': { kind: 'FONT', ext: '.woff2', mime: 'font/woff2' },
  'application/pdf': { kind: 'DOCUMENT', ext: '.pdf', mime: 'application/pdf' },
};

const BY_EXT: Record<string, MediaType> = {
  '.jpg': BY_MIME['image/jpeg']!,
  '.jpeg': BY_MIME['image/jpeg']!,
  '.png': BY_MIME['image/png']!,
  '.webp': BY_MIME['image/webp']!,
  '.gif': BY_MIME['image/gif']!,
  '.svg': BY_MIME['image/svg+xml']!,
  '.mp4': BY_MIME['video/mp4']!,
  '.mov': BY_MIME['video/quicktime']!,
  '.webm': BY_MIME['video/webm']!,
  '.mp3': BY_MIME['audio/mpeg']!,
  '.wav': BY_MIME['audio/wav']!,
  '.m4a': BY_MIME['audio/mp4']!,
  '.ttf': BY_MIME['font/ttf']!,
  '.otf': BY_MIME['font/otf']!,
  '.woff': BY_MIME['font/woff']!,
  '.woff2': BY_MIME['font/woff2']!,
  '.pdf': BY_MIME['application/pdf']!,
};

export const ACCEPTED_MIME_TYPES = Object.keys(BY_MIME);

/** Resolve the stored media type from the declared MIME type, falling back to the extension. */
export function resolveMediaType(mimeType: string | undefined, originalName: string): MediaType | null {
  const mime = (mimeType ?? '').toLowerCase().split(';')[0]?.trim() ?? '';
  if (mime && BY_MIME[mime]) return BY_MIME[mime]!;
  const ext = path.extname(originalName).toLowerCase();
  return BY_EXT[ext] ?? null;
}

export interface UploadMediaInput {
  data: Buffer;
  originalName: string;
  mimeType?: string;
  title?: string | null;
  altText?: string | null;
  tags?: string[];
  source?: MediaSource;
}

export async function uploadMedia(ctx: BrandContext, input: UploadMediaInput): Promise<MediaAsset> {
  assertBrandRole(ctx, 'EDITOR');
  const cfg = getConfig();
  const maxBytes = cfg.MEDIA_MAX_UPLOAD_MB * 1024 * 1024;
  if (input.data.length === 0) throw new ValidationError('Empty file');
  if (input.data.length > maxBytes) {
    throw new PayloadTooLargeError(`File exceeds the ${cfg.MEDIA_MAX_UPLOAD_MB} MB limit`);
  }
  const type = resolveMediaType(input.mimeType, input.originalName);
  if (!type) throw new ValidationError('Unsupported file type', { accepted: ACCEPTED_MIME_TYPES });

  let width: number | null = null;
  let height: number | null = null;
  if (type.kind === 'IMAGE') {
    if (type.mime === 'image/svg+xml') {
      if (!input.data.subarray(0, 4096).toString('utf8').includes('<svg')) {
        throw new ValidationError('Invalid SVG file');
      }
    } else {
      try {
        const meta = await sharp(input.data, { failOn: 'error' }).metadata();
        width = meta.width ?? null;
        height = meta.height ?? null;
      } catch {
        throw new ValidationError('Invalid or corrupted image file');
      }
    }
  }

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const storageKey = `brands/${ctx.brandId}/${yyyy}/${mm}/${randomUUID()}${type.ext}`;

  await getStorage().put(storageKey, input.data, type.mime);

  const asset = await ctx.db.mediaAsset.create({
    data: {
      brandId: ctx.brandId,
      kind: type.kind,
      source: input.source ?? 'UPLOAD',
      storageKey,
      bucket: cfg.S3_BUCKET,
      mimeType: type.mime,
      sizeBytes: input.data.length,
      width,
      height,
      originalName: path.basename(input.originalName).slice(0, 255),
      title: input.title?.trim() || null,
      altText: input.altText?.trim() || null,
      tags: normalizeTags(input.tags),
      checksumSha256: sha256Hex(input.data),
      uploadedById: ctx.actor.userId,
    },
  });
  await auditFromContext(ctx, {
    action: 'media.upload',
    entityType: 'media_asset',
    entityId: asset.id,
    after: { kind: asset.kind, originalName: asset.originalName, sizeBytes: asset.sizeBytes },
  });
  return asset;
}

export interface MediaPage {
  items: MediaAsset[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listMedia(ctx: BrandContext, query: MediaListQuery): Promise<MediaPage> {
  const where: Prisma.MediaAssetWhereInput = { deletedAt: null };
  if (query.kind) where.kind = query.kind;
  if (query.tag) where.tags = { has: query.tag };
  if (query.search) {
    where.OR = [
      { originalName: { contains: query.search, mode: 'insensitive' } },
      { title: { contains: query.search, mode: 'insensitive' } },
      { altText: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  const [items, total] = await Promise.all([
    ctx.db.mediaAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    ctx.db.mediaAsset.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getMedia(ctx: BrandContext, mediaId: string): Promise<MediaAsset> {
  const asset = await ctx.db.mediaAsset.findUnique({ where: { id: mediaId } });
  if (!asset || asset.deletedAt) throw new NotFoundError('media asset');
  return asset;
}

export async function openMediaObject(
  ctx: BrandContext,
  mediaId: string,
  range?: ByteRange,
): Promise<{ asset: MediaAsset; object: StoredObject }> {
  const asset = await getMedia(ctx, mediaId);
  if (range && (range.start < 0 || range.start >= asset.sizeBytes || (range.end !== undefined && range.end < range.start))) {
    throw new AppError(416, 'range_not_satisfiable', 'Requested range not satisfiable');
  }
  const object = await getStorage().get(asset.storageKey, range);
  if (!object) throw new NotFoundError('media file');
  return { asset, object: { ...object, contentType: asset.mimeType } };
}

export async function updateMedia(
  ctx: BrandContext,
  mediaId: string,
  input: MediaUpdateInput,
): Promise<MediaAsset> {
  assertBrandRole(ctx, 'EDITOR');
  const before = await getMedia(ctx, mediaId);
  const after = await ctx.db.mediaAsset.update({
    where: { id: mediaId },
    data: {
      ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
      ...(input.altText !== undefined ? { altText: input.altText?.trim() || null } : {}),
      ...(input.tags !== undefined ? { tags: normalizeTags(input.tags) } : {}),
    },
  });
  await auditFromContext(ctx, {
    action: 'media.update',
    entityType: 'media_asset',
    entityId: mediaId,
    before: { title: before.title, altText: before.altText, tags: before.tags },
    after: { title: after.title, altText: after.altText, tags: after.tags },
  });
  return after;
}

/** Soft-delete the record and remove the object from storage. */
export async function deleteMedia(ctx: BrandContext, mediaId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  const asset = await getMedia(ctx, mediaId);
  await ctx.db.mediaAsset.update({ where: { id: mediaId }, data: { deletedAt: new Date() } });
  await getStorage()
    .delete(asset.storageKey)
    .catch(() => undefined);
  await auditFromContext(ctx, {
    action: 'media.delete',
    entityType: 'media_asset',
    entityId: mediaId,
    before: { originalName: asset.originalName, storageKey: asset.storageKey },
  });
}

/** App-served, access-controlled URL for a media file. */
export function mediaFileUrl(asset: Pick<MediaAsset, 'id' | 'brandId'>): string {
  return `/api/v1/brands/${asset.brandId}/media/${asset.id}/file`;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 30);
}
