import { db } from '@mm/db';
import type {
  Brand,
  BrandAsset,
  BrandCompetitor,
  BrandKnowledge,
  BrandProduct,
  BrandSettings,
  KnowledgeStatus,
  MediaAsset,
  Prisma,
} from '@mm/db';
import { auditFromContext, recordAudit } from '../audit';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { getStorage } from '../storage';
import type { Actor, BrandContext } from '../tenancy/context';
import { assertBrandRole, isOrgAdmin, requireOrgAdmin } from '../tenancy/context';
import type {
  BrandAssetInput,
  BrandCreateInput,
  BrandSettingsInput,
  BrandUpdateInput,
  CompetitorInput,
  KnowledgeInput,
  ProductInput,
} from '../validation';
import { slugify } from '../validation';
import { requestApproval } from './approvals';

const emptyToNull = (v: string | null | undefined): string | null => (v ? v : null);
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

// ---------------------------------------------------------------------------
// Brand lifecycle (org-level)
// ---------------------------------------------------------------------------

export async function createBrand(actor: Actor, input: BrandCreateInput): Promise<Brand> {
  await requireOrgAdmin(actor, input.orgId);
  const slug = input.slug ?? slugify(input.name, 'brand');
  const exists = await db.brand.findUnique({ where: { orgId_slug: { orgId: input.orgId, slug } } });
  if (exists) throw new ConflictError('A brand with this slug already exists in the organization');

  const brand = await db.brand.create({
    data: {
      orgId: input.orgId,
      name: input.name,
      slug,
      industry: emptyToNull(input.industry),
      description: emptyToNull(input.description),
      websiteUrl: emptyToNull(input.websiteUrl),
      isDemo: input.isDemo ?? false,
      settings: { create: {} },
    },
  });
  await recordAudit(
    { orgId: brand.orgId, brandId: brand.id, actorUserId: actor.userId },
    { action: 'brand.create', entityType: 'brand', entityId: brand.id, after: brand },
  );
  return brand;
}

export async function updateBrand(ctx: BrandContext, input: BrandUpdateInput): Promise<Brand> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const before = await ctx.db.brand.findUnique({ where: { id: ctx.brandId } });
  if (!before) throw new NotFoundError('brand');
  const data: Prisma.BrandUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.status !== undefined) data.status = input.status;
  if (input.industry !== undefined) data.industry = emptyToNull(input.industry);
  if (input.description !== undefined) data.description = emptyToNull(input.description);
  if (input.websiteUrl !== undefined) data.websiteUrl = emptyToNull(input.websiteUrl);
  if (input.locale !== undefined) data.locale = input.locale;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.isDemo !== undefined) data.isDemo = input.isDemo;
  const after = await ctx.db.brand.update({ where: { id: ctx.brandId }, data });
  await auditFromContext(ctx, {
    action: 'brand.update',
    entityType: 'brand',
    entityId: ctx.brandId,
    before,
    after,
  });
  return after;
}

export async function getBrand(ctx: BrandContext): Promise<Brand> {
  const brand = await ctx.db.brand.findUnique({ where: { id: ctx.brandId } });
  if (!brand) throw new NotFoundError('brand');
  return brand;
}

/**
 * Permanently delete a brand and everything it owns (database cascade + object
 * storage). Only organization OWNER/ADMIN (or a super admin) may do this, and
 * the caller must repeat the brand slug. Archive (status) is the reversible option.
 */
export async function deleteBrand(ctx: BrandContext, confirmSlug: string): Promise<{ mediaObjectsDeleted: number }> {
  if (!ctx.actor.isSuperAdmin && !isOrgAdmin(ctx.orgRole)) {
    throw new ForbiddenError('Only organization admins can delete a brand');
  }
  const brand = await getBrand(ctx);
  if (confirmSlug.trim() !== brand.slug) {
    throw new ValidationError('Confirmation does not match', [{ path: 'confirm', message: 'יש להקליד את ה-slug של המותג בדיוק כפי שהוא' }]);
  }
  const [media, products, knowledge, approvals] = await Promise.all([
    ctx.db.mediaAsset.count(),
    ctx.db.brandProduct.count(),
    ctx.db.brandKnowledge.count(),
    ctx.db.approval.count(),
  ]);
  // Root client on purpose: the brand row itself is the tenant boundary; access was verified above.
  await db.brand.delete({ where: { id: brand.id } });
  let mediaObjectsDeleted = 0;
  try {
    mediaObjectsDeleted = await getStorage().deletePrefix(`brands/${brand.id}/`);
  } catch (err) {
    logger.error({ err, brandId: brand.id }, 'brand storage cleanup failed after delete');
  }
  await recordAudit(
    { orgId: brand.orgId, brandId: null, actorUserId: ctx.actor.userId, ipAddress: ctx.request?.ipAddress ?? null, userAgent: ctx.request?.userAgent ?? null },
    {
      action: 'brand.delete',
      entityType: 'brand',
      entityId: brand.id,
      before: { name: brand.name, slug: brand.slug, status: brand.status, counts: { media, products, knowledge, approvals } },
      metadata: { mediaObjectsDeleted },
    },
  );
  return { mediaObjectsDeleted };
}

// ---------------------------------------------------------------------------
// Brand Kit (settings, assets, products, knowledge, competitors)
// ---------------------------------------------------------------------------

export interface BrandAssetWithMedia extends BrandAsset {
  media: MediaAsset;
}

export interface ProductDto extends Omit<BrandProduct, 'priceFromIls'> {
  priceFromIls: number | null;
}

export interface BrandSettingsDto extends Omit<BrandSettings, 'monthlyAdBudgetIls'> {
  monthlyAdBudgetIls: number | null;
}

export interface BrandKit {
  brand: Brand;
  settings: BrandSettingsDto;
  assets: BrandAssetWithMedia[];
  products: ProductDto[];
  competitors: BrandCompetitor[];
  knowledge: { approved: number; pending: number; rejected: number };
}

export function toProductDto(p: BrandProduct): ProductDto {
  return { ...p, priceFromIls: p.priceFromIls === null ? null : Number(p.priceFromIls) };
}

export function toSettingsDto(s: BrandSettings): BrandSettingsDto {
  return { ...s, monthlyAdBudgetIls: s.monthlyAdBudgetIls === null ? null : Number(s.monthlyAdBudgetIls) };
}

export async function getBrandKit(ctx: BrandContext): Promise<BrandKit> {
  const brand = await getBrand(ctx);
  const [settings, assets, products, competitors, knowledgeGroups] = await Promise.all([
    ctx.db.brandSettings.upsert({ where: { brandId: ctx.brandId }, create: { brandId: ctx.brandId }, update: {} }),
    ctx.db.brandAsset.findMany({ include: { media: true }, orderBy: { createdAt: 'desc' } }),
    ctx.db.brandProduct.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ctx.db.brandCompetitor.findMany({ orderBy: { name: 'asc' } }),
    ctx.db.brandKnowledge.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  const count = (status: KnowledgeStatus) =>
    knowledgeGroups.find((g) => g.status === status)?._count._all ?? 0;
  return {
    brand,
    settings: toSettingsDto(settings),
    assets,
    products: products.map(toProductDto),
    competitors,
    knowledge: { approved: count('APPROVED'), pending: count('PENDING'), rejected: count('REJECTED') },
  };
}

export async function updateBrandSettings(
  ctx: BrandContext,
  input: BrandSettingsInput,
): Promise<BrandSettingsDto> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const before = await ctx.db.brandSettings.findUnique({ where: { brandId: ctx.brandId } });
  // Plain values only, so the same patch serves both the create and the update branch.
  const patch: Omit<Prisma.BrandSettingsUncheckedCreateInput, 'id' | 'brandId' | 'updatedAt'> = {};
  if (input.colors !== undefined) patch.colors = json(input.colors);
  if (input.fonts !== undefined) patch.fonts = json(input.fonts);
  if (input.tone !== undefined) patch.tone = json(input.tone);
  if (input.audiences !== undefined) patch.audiences = json(input.audiences);
  if (input.keywords !== undefined) patch.keywords = input.keywords;
  if (input.hashtags !== undefined) patch.hashtags = input.hashtags;
  if (input.ctaPresets !== undefined) patch.ctaPresets = input.ctaPresets;
  if (input.allowedClaims !== undefined) patch.allowedClaims = input.allowedClaims;
  if (input.forbiddenClaims !== undefined) patch.forbiddenClaims = input.forbiddenClaims;
  if (input.graphicStyle !== undefined) patch.graphicStyle = input.graphicStyle;
  if (input.publishingMode !== undefined) patch.publishingMode = input.publishingMode;
  if (input.contentTargets !== undefined) patch.contentTargets = json(input.contentTargets);
  if (input.monthlyAdBudgetIls !== undefined) patch.monthlyAdBudgetIls = input.monthlyAdBudgetIls;

  const after = await ctx.db.brandSettings.upsert({
    where: { brandId: ctx.brandId },
    create: { brandId: ctx.brandId, ...patch },
    update: patch,
  });
  await auditFromContext(ctx, {
    action: 'brand.settings.update',
    entityType: 'brand_settings',
    entityId: after.id,
    before,
    after,
  });
  return toSettingsDto(after);
}

const SINGLETON_ASSET_TYPES = new Set(['LOGO_PRIMARY', 'LOGO_SECONDARY', 'LOGO_ICON']);

export async function setBrandAsset(ctx: BrandContext, input: BrandAssetInput): Promise<BrandAssetWithMedia> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  // The tenant client guarantees the media belongs to this brand.
  const media = await ctx.db.mediaAsset.findUnique({ where: { id: input.mediaAssetId } });
  if (!media || media.deletedAt) throw new NotFoundError('media asset');
  if (SINGLETON_ASSET_TYPES.has(input.type)) {
    await ctx.db.brandAsset.deleteMany({ where: { type: input.type } });
  }
  const asset = await ctx.db.brandAsset.create({
    data: { brandId: ctx.brandId, type: input.type, mediaAssetId: media.id, label: input.label ?? null },
  });
  await auditFromContext(ctx, {
    action: 'brand.asset.set',
    entityType: 'brand_asset',
    entityId: asset.id,
    after: { type: asset.type, mediaAssetId: asset.mediaAssetId },
  });
  return { ...asset, media };
}

export async function removeBrandAsset(ctx: BrandContext, assetId: string): Promise<void> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const asset = await ctx.db.brandAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw new NotFoundError('brand asset');
  await ctx.db.brandAsset.delete({ where: { id: assetId } });
  await auditFromContext(ctx, {
    action: 'brand.asset.remove',
    entityType: 'brand_asset',
    entityId: assetId,
    before: asset,
  });
}

// --- Products ---------------------------------------------------------------

export async function listProducts(ctx: BrandContext): Promise<ProductDto[]> {
  const rows = await ctx.db.brandProduct.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return rows.map(toProductDto);
}

export async function createProduct(ctx: BrandContext, input: ProductInput): Promise<ProductDto> {
  assertBrandRole(ctx, 'EDITOR');
  const slug = input.slug ?? slugify(input.name, 'product');
  if (await ctx.db.brandProduct.findFirst({ where: { slug } })) {
    throw new ConflictError('A product with this slug already exists');
  }
  const product = await ctx.db.brandProduct.create({
    data: {
      brandId: ctx.brandId,
      name: input.name,
      slug,
      category: input.category ?? null,
      description: input.description ?? null,
      features: json(input.features ?? []),
      audiences: json(input.audiences ?? []),
      priceFromIls: input.priceFromIls ?? null,
      pricingNote: input.pricingNote ?? null,
      url: emptyToNull(input.url),
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  await auditFromContext(ctx, {
    action: 'brand.product.create',
    entityType: 'brand_product',
    entityId: product.id,
    after: product,
  });
  return toProductDto(product);
}

export async function updateProduct(
  ctx: BrandContext,
  productId: string,
  input: ProductInput,
): Promise<ProductDto> {
  assertBrandRole(ctx, 'EDITOR');
  const before = await ctx.db.brandProduct.findUnique({ where: { id: productId } });
  if (!before) throw new NotFoundError('product');
  const data: Prisma.BrandProductUpdateInput = {
    name: input.name,
    category: input.category ?? null,
    description: input.description ?? null,
    pricingNote: input.pricingNote ?? null,
    url: emptyToNull(input.url),
  };
  if (input.slug !== undefined) data.slug = input.slug;
  if (input.features !== undefined) data.features = json(input.features);
  if (input.audiences !== undefined) data.audiences = json(input.audiences);
  if (input.priceFromIls !== undefined) data.priceFromIls = input.priceFromIls;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  const after = await ctx.db.brandProduct.update({ where: { id: productId }, data });
  await auditFromContext(ctx, {
    action: 'brand.product.update',
    entityType: 'brand_product',
    entityId: productId,
    before,
    after,
  });
  return toProductDto(after);
}

export async function deleteProduct(ctx: BrandContext, productId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  const before = await ctx.db.brandProduct.findUnique({ where: { id: productId } });
  if (!before) throw new NotFoundError('product');
  await ctx.db.brandProduct.delete({ where: { id: productId } });
  await auditFromContext(ctx, {
    action: 'brand.product.delete',
    entityType: 'brand_product',
    entityId: productId,
    before,
  });
}

// --- Knowledge base ---------------------------------------------------------

export async function listKnowledge(
  ctx: BrandContext,
  status?: KnowledgeStatus,
): Promise<BrandKnowledge[]> {
  return ctx.db.brandKnowledge.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Add knowledge. Entries start PENDING and go through the Approval Center; a
 * BRAND_ADMIN may approve immediately with `approveNow`. Only APPROVED entries
 * are ever exposed to AI agents.
 */
export async function createKnowledge(
  ctx: BrandContext,
  input: KnowledgeInput,
  options: { approveNow?: boolean } = {},
): Promise<BrandKnowledge> {
  assertBrandRole(ctx, 'EDITOR');
  const approveNow = options.approveNow === true && ctx.brandRole === 'BRAND_ADMIN';
  const entry = await ctx.db.brandKnowledge.create({
    data: {
      brandId: ctx.brandId,
      kind: input.kind,
      title: input.title,
      sourceUrl: emptyToNull(input.sourceUrl),
      content: input.content,
      status: approveNow ? 'APPROVED' : 'PENDING',
      approvedById: approveNow ? ctx.actor.userId : null,
      approvedAt: approveNow ? new Date() : null,
    },
  });
  await auditFromContext(ctx, {
    action: 'brand.knowledge.create',
    entityType: 'brand_knowledge',
    entityId: entry.id,
    after: { kind: entry.kind, title: entry.title, status: entry.status },
  });
  if (!approveNow) {
    await requestApproval(ctx, {
      type: 'BRAND_KNOWLEDGE',
      title: `אישור מידע למותג: ${entry.title}`,
      summary: entry.content.slice(0, 280),
      subjectType: 'brand_knowledge',
      subjectId: entry.id,
      payload: { kind: entry.kind, sourceUrl: entry.sourceUrl },
    });
  }
  return entry;
}

export async function updateKnowledge(
  ctx: BrandContext,
  knowledgeId: string,
  input: KnowledgeInput,
): Promise<BrandKnowledge> {
  assertBrandRole(ctx, 'EDITOR');
  const before = await ctx.db.brandKnowledge.findUnique({ where: { id: knowledgeId } });
  if (!before) throw new NotFoundError('knowledge entry');
  const contentChanged = before.content !== input.content || before.title !== input.title;
  // A material change invalidates the previous approval (PRD §19).
  const after = await ctx.db.brandKnowledge.update({
    where: { id: knowledgeId },
    data: {
      kind: input.kind,
      title: input.title,
      sourceUrl: emptyToNull(input.sourceUrl),
      content: input.content,
      ...(contentChanged && before.status === 'APPROVED'
        ? { status: 'PENDING', approvedById: null, approvedAt: null }
        : {}),
    },
  });
  if (contentChanged && before.status === 'APPROVED') {
    await requestApproval(ctx, {
      type: 'BRAND_KNOWLEDGE',
      title: `אישור מחדש של מידע למותג: ${after.title}`,
      summary: after.content.slice(0, 280),
      subjectType: 'brand_knowledge',
      subjectId: after.id,
      subjectVersion: 2,
      payload: { kind: after.kind, sourceUrl: after.sourceUrl, reason: 'content changed' },
    });
  }
  await auditFromContext(ctx, {
    action: 'brand.knowledge.update',
    entityType: 'brand_knowledge',
    entityId: knowledgeId,
    before: { title: before.title, status: before.status },
    after: { title: after.title, status: after.status },
  });
  return after;
}

export async function deleteKnowledge(ctx: BrandContext, knowledgeId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  const before = await ctx.db.brandKnowledge.findUnique({ where: { id: knowledgeId } });
  if (!before) throw new NotFoundError('knowledge entry');
  await ctx.db.brandKnowledge.delete({ where: { id: knowledgeId } });
  await auditFromContext(ctx, {
    action: 'brand.knowledge.delete',
    entityType: 'brand_knowledge',
    entityId: knowledgeId,
    before: { title: before.title, status: before.status },
  });
}

// --- Competitors ------------------------------------------------------------

export async function listCompetitors(ctx: BrandContext): Promise<BrandCompetitor[]> {
  return ctx.db.brandCompetitor.findMany({ orderBy: { name: 'asc' } });
}

export async function createCompetitor(ctx: BrandContext, input: CompetitorInput): Promise<BrandCompetitor> {
  assertBrandRole(ctx, 'EDITOR');
  const row = await ctx.db.brandCompetitor.create({
    data: {
      brandId: ctx.brandId,
      name: input.name,
      websiteUrl: emptyToNull(input.websiteUrl),
      notes: input.notes ?? null,
    },
  });
  await auditFromContext(ctx, {
    action: 'brand.competitor.create',
    entityType: 'brand_competitor',
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function deleteCompetitor(ctx: BrandContext, competitorId: string): Promise<void> {
  assertBrandRole(ctx, 'EDITOR');
  const before = await ctx.db.brandCompetitor.findUnique({ where: { id: competitorId } });
  if (!before) throw new NotFoundError('competitor');
  await ctx.db.brandCompetitor.delete({ where: { id: competitorId } });
  await auditFromContext(ctx, {
    action: 'brand.competitor.delete',
    entityType: 'brand_competitor',
    entityId: competitorId,
    before,
  });
}
