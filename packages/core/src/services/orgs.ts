import { db } from '@mm/db';
import type { Organization, OrgRole } from '@mm/db';
import { recordAudit } from '../audit';
import { ConflictError, NotFoundError } from '../errors';
import type { Actor } from '../tenancy/context';
import { requireOrgAdmin } from '../tenancy/context';
import { slugify } from '../validation';

export interface CreateOrganizationInput {
  name: string;
  slug?: string;
  ownerUserId: string;
}

export async function createOrganization(input: CreateOrganizationInput): Promise<Organization> {
  const slug = input.slug ?? slugify(input.name, 'org');
  if (await db.organization.findUnique({ where: { slug } })) {
    throw new ConflictError('An organization with this slug already exists');
  }
  const org = await db.$transaction(async (tx) => {
    const created = await tx.organization.create({ data: { name: input.name.trim(), slug } });
    await tx.membership.create({
      data: { orgId: created.id, userId: input.ownerUserId, role: 'OWNER' },
    });
    return created;
  });
  await recordAudit(
    { orgId: org.id, actorUserId: input.ownerUserId },
    { action: 'org.create', entityType: 'organization', entityId: org.id, after: org },
  );
  return org;
}

export interface OrgWithRole extends Organization {
  role: OrgRole | null;
}

export async function listUserOrganizations(actor: Actor): Promise<OrgWithRole[]> {
  if (actor.isSuperAdmin) {
    const orgs = await db.organization.findMany({ orderBy: { name: 'asc' } });
    const memberships = await db.membership.findMany({ where: { userId: actor.userId } });
    const roles = new Map(memberships.map((m) => [m.orgId, m.role]));
    return orgs.map((o) => ({ ...o, role: roles.get(o.id) ?? null }));
  }
  const memberships = await db.membership.findMany({
    where: { userId: actor.userId },
    include: { org: true },
    orderBy: { org: { name: 'asc' } },
  });
  return memberships.map((m) => ({ ...m.org, role: m.role }));
}

export interface OrgMember {
  membershipId: string;
  userId: string;
  email: string;
  name: string;
  role: OrgRole;
  isActive: boolean;
  createdAt: Date;
}

export async function listOrgMembers(actor: Actor, orgId: string): Promise<OrgMember[]> {
  await requireOrgAdmin(actor, orgId);
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) throw new NotFoundError('organization');
  const rows = await db.membership.findMany({
    where: { orgId },
    include: { user: { select: { id: true, email: true, name: true, isActive: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => ({
    membershipId: m.id,
    userId: m.user.id,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    isActive: m.user.isActive,
    createdAt: m.createdAt,
  }));
}
