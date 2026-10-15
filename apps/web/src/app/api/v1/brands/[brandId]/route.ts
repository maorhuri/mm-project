import { brandUpdateSchema, getBrandKit, updateBrand } from '@mm/core';
import { ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/** GET /api/v1/brands/:brandId — full Brand Kit. */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  return ok({ ...(await getBrandKit(ctx)), role: ctx.brandRole });
});

/** PATCH /api/v1/brands/:brandId — update identity/status (BRAND_ADMIN). */
export const PATCH = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, brandUpdateSchema);
  return ok(await updateBrand(ctx, input));
});
