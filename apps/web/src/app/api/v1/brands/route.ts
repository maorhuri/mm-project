import { brandCreateSchema, createBrand, listAccessibleBrands } from '@mm/core';
import { ok, parseJson, requireApiUser, withApi } from '@/lib/api';

/** GET /api/v1/brands — brands the caller may access. */
export const GET = withApi(async (req) => {
  const { actor } = await requireApiUser(req);
  return ok(await listAccessibleBrands(actor));
});

/** POST /api/v1/brands — create a brand (org OWNER/ADMIN). */
export const POST = withApi(async (req) => {
  const { actor } = await requireApiUser(req);
  const input = await parseJson(req, brandCreateSchema);
  const brand = await createBrand(actor, input);
  return ok(brand, { status: 201 });
});
