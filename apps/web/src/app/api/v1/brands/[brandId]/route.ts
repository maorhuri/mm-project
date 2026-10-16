import { z } from 'zod';
import { brandUpdateSchema, deleteBrand, getBrandKit, updateBrand } from '@mm/core';
import { noContent, ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

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

/** DELETE /api/v1/brands/:brandId — { confirm: "<slug>" }. Org OWNER/ADMIN only; permanent. */
export const DELETE = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const { confirm } = await parseJson(req, z.object({ confirm: z.string().min(1) }));
  await deleteBrand(ctx, confirm);
  return noContent();
});
