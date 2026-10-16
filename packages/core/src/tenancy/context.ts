import { db, forBrand } from '@mm/db';
import type { BrandRole, BrandStatus, OrgRole, TenantDb } from '@mm/db';
import { ForbiddenError, NotFoundError } from '../errors';

/** The authenticated principal performing an action. */
export interface Actor {
  userId: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
}

export interface BrandSummary {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  status: BrandStatus;
  isDemo: boolean;
}

/**
 * Everything a domain service needs to act inside one brand: who is acting,
 * their effective role, and a database client that cannot leave the brand.
 */
export interface BrandContext {
  actor: Actor;
  orgId: string;
  brandId: string;
  brand: BrandSummary;
  orgRole: OrgRole | null;
  brandRole: BrandRole;
  db: TenantDb;
  request?: { ipAddress?: string | null; userAgent?: string | null };
}

export const BRAND_ROLE_RANK: Record<BrandRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  BRAND_ADMIN: 2,
};

export function hasBrandRole(ctx: BrandContext, min: BrandRole): boolean {
  return BRAND_ROLE_RANK[ctx.brandRole] >= BRAND_ROLE_RANK[min];
}

export function assertBrandRole(ctx: BrandContext, min: BrandRole): void {
  if (!hasBrandRole(ctx, min)) {
    throw new ForbiddenError(`This action requires the ${min} role on the brand`);
  }
}

export function isOrgAdmin(role: OrgRole | null | undefined): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** Brands the actor may open: all brands of orgs they administer, plus explicit grants. */
export async function listAccessibleBrands(actor: Actor): Promise<BrandSummary[]> {
  const select = { id: true, orgId: true, name: true, slug: true, status: true, isDemo: true } as const;
  if (actor.isSuperAdmin) {
    return db.brand.findMany({ select, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  }
  const memberships = await db.membership.findMany({ where: { userId: actor.userId } });
  const adminOrgIds = memberships.filter((m) => isOrgAdmin(m.role)).map((m) => m.orgId);
  const memberOrgIds = memberships.map((m) => m.orgId);
  // Explicit grants only count while the user is still a member of the brand's org —
  // the same rule resolveBrandContext enforces, so the list never shows a brand it would refuse.
  return db.brand.findMany({
    where: {
      OR: [
        { orgId: { in: adminOrgIds } },
        { orgId: { in: memberOrgIds }, access: { some: { userId: actor.userId } } },
      ],
    },
    select,
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
}

/**
 * Resolve the actor's access to a brand. Throws NotFound if the brand does not
 * exist and Forbidden if the actor has no role on it. This is the single gate
 * every brand-scoped operation passes through.
 */
export async function resolveBrandContext(
  actor: Actor,
  brandId: string,
  request?: BrandContext['request'],
): Promise<BrandContext> {
  const brand = await db.brand.findUnique({
    where: { id: brandId },
    select: { id: true, orgId: true, name: true, slug: true, status: true, isDemo: true },
  });
  if (!brand) throw new NotFoundError('brand');

  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId: actor.userId, orgId: brand.orgId } },
  });
  const orgRole = membership?.role ?? null;

  let brandRole: BrandRole | null = null;
  if (actor.isSuperAdmin || isOrgAdmin(orgRole)) {
    brandRole = 'BRAND_ADMIN';
  } else if (membership) {
    const access = await db.brandAccess.findUnique({
      where: { userId_brandId: { userId: actor.userId, brandId } },
    });
    brandRole = access?.role ?? null;
  }
  if (!brandRole) throw new ForbiddenError('No access to this brand');

  return {
    actor,
    orgId: brand.orgId,
    brandId,
    brand,
    orgRole,
    brandRole,
    db: forBrand(brandId),
    ...(request ? { request } : {}),
  };
}

/** Placeholder principal for background jobs that run without a user (audit rows get actor NULL). */
export const SYSTEM_ACTOR: Actor = { userId: '', email: 'system@mm.local', name: 'המערכת', isSuperAdmin: false };

/**
 * Context for background jobs: acts as BRAND_ADMIN inside one brand on behalf
 * of the user who queued the job (when still present), else as the system.
 */
export async function systemBrandContext(brandId: string, actorUserId?: string | null): Promise<BrandContext> {
  const brand = await db.brand.findUnique({
    where: { id: brandId },
    select: { id: true, orgId: true, name: true, slug: true, status: true, isDemo: true },
  });
  if (!brand) throw new NotFoundError('brand');
  const user = actorUserId ? await db.user.findUnique({ where: { id: actorUserId } }) : null;
  const actor: Actor = user ? { userId: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin } : SYSTEM_ACTOR;
  return { actor, orgId: brand.orgId, brandId, brand, orgRole: null, brandRole: 'BRAND_ADMIN', db: forBrand(brandId) };
}

/** Org-level role check used by org-scoped operations (create brand, manage members). */
export async function requireOrgAdmin(actor: Actor, orgId: string): Promise<OrgRole | null> {
  if (actor.isSuperAdmin) return null;
  const membership = await db.membership.findUnique({
    where: { userId_orgId: { userId: actor.userId, orgId } },
  });
  if (!membership || !isOrgAdmin(membership.role)) {
    throw new ForbiddenError('Organization admin role required');
  }
  return membership.role;
}
