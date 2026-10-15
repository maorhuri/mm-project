import { db } from '@mm/db';
import type { BrandRole, OrgRole } from '@mm/db';
import sharp from 'sharp';
import { createUser } from '../src/services/users';
import type { Actor, BrandContext } from '../src/tenancy/context';
import { resolveBrandContext } from '../src/tenancy/context';

let counter = 0;

export async function makeUser(opts: { isSuperAdmin?: boolean } = {}): Promise<Actor> {
  counter += 1;
  const user = await createUser({
    email: `user${counter}-${Date.now()}@test.local`,
    name: `User ${counter}`,
    password: 'correct-horse-battery-staple',
    isSuperAdmin: opts.isSuperAdmin ?? false,
  });
  return { userId: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin };
}

export async function makeOrg(owner: Actor, slug = `org-${Date.now()}-${counter}`) {
  const org = await db.organization.create({ data: { name: slug, slug } });
  await db.membership.create({ data: { orgId: org.id, userId: owner.userId, role: 'OWNER' } });
  return org;
}

export async function addMember(orgId: string, actor: Actor, role: OrgRole) {
  return db.membership.create({ data: { orgId, userId: actor.userId, role } });
}

export async function grantBrand(brandId: string, actor: Actor, role: BrandRole) {
  return db.brandAccess.create({ data: { brandId, userId: actor.userId, role } });
}

export async function makeBrand(orgId: string, slug: string) {
  return db.brand.create({
    data: { orgId, slug, name: slug.toUpperCase(), settings: { create: {} } },
  });
}

export function ctxFor(actor: Actor, brandId: string): Promise<BrandContext> {
  return resolveBrandContext(actor, brandId);
}

/** Two-brand fixture: owner has both; `editor` is a MEMBER with EDITOR on brand A only. */
export async function twoBrandFixture() {
  const owner = await makeUser();
  const editor = await makeUser();
  const org = await makeOrg(owner);
  await addMember(org.id, editor, 'MEMBER');
  const brandA = await makeBrand(org.id, 'brand-a');
  const brandB = await makeBrand(org.id, 'brand-b');
  await grantBrand(brandA.id, editor, 'EDITOR');
  return { owner, editor, org, brandA, brandB };
}

export function pngBuffer(width = 64, height = 32): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#2563eb' } })
    .png()
    .toBuffer();
}
