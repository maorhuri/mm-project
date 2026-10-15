import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { listAccessibleBrands, resolveBrandContext } from '@mm/core';
import type { BrandContext, BrandSummary } from '@mm/core';
import { requestMeta, requireUser } from './auth';

export const BRAND_COOKIE = 'mm_brand';

export interface BrandSelection {
  brands: BrandSummary[];
  current: BrandSummary | null;
}

/** Brands the signed-in user may open, and the one selected via cookie (or the first). */
export const getBrandSelection = cache(async (): Promise<BrandSelection> => {
  const { actor } = await requireUser();
  const brands = await listAccessibleBrands(actor);
  const wanted = (await cookies()).get(BRAND_COOKIE)?.value;
  const current = brands.find((b) => b.id === wanted) ?? brands.find((b) => b.status === 'ACTIVE') ?? brands[0] ?? null;
  return { brands, current };
});

/** Full tenant context for the selected brand; redirects to brand creation when the user has none. */
export async function requireBrandContext(): Promise<BrandContext> {
  const { actor } = await requireUser();
  const { current } = await getBrandSelection();
  if (!current) redirect('/app/brands?empty=1');
  return resolveBrandContext(actor, current.id, await requestMeta());
}

/** Tenant context for an explicit brand id (brand pages, actions). Throws Forbidden/NotFound. */
export async function brandContextFor(brandId: string): Promise<BrandContext> {
  const { actor } = await requireUser();
  return resolveBrandContext(actor, brandId, await requestMeta());
}
