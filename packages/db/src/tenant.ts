/**
 * Tenant scoping for Prisma query arguments.
 *
 * Every brand-scoped model is listed in TENANT_MODELS. `scopeArgs` rewrites the
 * arguments of any Prisma operation so that reads are filtered by brand_id and
 * writes always carry the caller's brand_id — regardless of what the caller passed.
 * This is the server-side isolation layer the PRD requires; the UI is never trusted.
 *
 * Kept free of Prisma imports so it can be unit-tested in isolation.
 */

export const TENANT_MODELS = new Set([
  'BrandSettings',
  'BrandAsset',
  'BrandProduct',
  'BrandKnowledge',
  'BrandCompetitor',
  'MediaAsset',
  'Approval',
  'Notification',
  'BackgroundJob',
  'ProviderAccount',
  'AiRun',
  'ContentIdea',
  'CreativeProject',
  'CreativeVersion',
  'StrategyBrief',
  'VideoProject',
  'VideoScene',
]);

/** The Brand model itself is scoped by its primary key rather than a brand_id column. */
export const BRAND_MODEL = 'Brand';

type AnyArgs = Record<string, unknown>;

const READ_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
const WRITE_WHERE_OPS = new Set(['update', 'updateMany', 'delete', 'deleteMany', 'upsert']);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);

function withBrandWhere(where: unknown, key: string, brandId: string): AnyArgs {
  const base = (where ?? {}) as AnyArgs;
  // Overwrite rather than merge: a caller-supplied brandId must never widen the scope.
  return { ...base, [key]: brandId };
}

function withBrandData(data: unknown, brandId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => ({ ...(row as AnyArgs), brandId }));
  return { ...((data ?? {}) as AnyArgs), brandId };
}

function stripBrandFromData(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const { brandId: _ignored, brand: _ignoredRel, ...rest } = data as AnyArgs;
  return rest;
}

/**
 * Rewrite Prisma args for `model`/`operation` so they are confined to `brandId`.
 * Returns the args untouched for models that are not tenant-scoped.
 */
export function scopeArgs(
  model: string,
  operation: string,
  args: AnyArgs | undefined,
  brandId: string,
): AnyArgs {
  const a: AnyArgs = { ...(args ?? {}) };

  if (model === BRAND_MODEL) {
    // Brand: scope by id. Creating a brand is an org-level action, not tenant-scoped.
    if (READ_OPS.has(operation) || WRITE_WHERE_OPS.has(operation)) {
      a.where = withBrandWhere(a.where, 'id', brandId);
    }
    return a;
  }

  if (!TENANT_MODELS.has(model)) return a;

  if (READ_OPS.has(operation)) {
    a.where = withBrandWhere(a.where, 'brandId', brandId);
    return a;
  }

  if (operation === 'upsert') {
    a.where = withBrandWhere(a.where, 'brandId', brandId);
    a.create = withBrandData(a.create, brandId);
    a.update = stripBrandFromData(a.update);
    return a;
  }

  if (WRITE_WHERE_OPS.has(operation)) {
    a.where = withBrandWhere(a.where, 'brandId', brandId);
    if ('data' in a) a.data = stripBrandFromData(a.data);
    return a;
  }

  if (CREATE_OPS.has(operation)) {
    a.data = withBrandData(a.data, brandId);
    return a;
  }

  // Unknown/raw operations are not allowed through the tenant client.
  throw new Error(`Tenant client: operation "${operation}" on ${model} is not supported`);
}
