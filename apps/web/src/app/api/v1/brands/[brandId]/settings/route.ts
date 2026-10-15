import { brandSettingsSchema, updateBrandSettings } from '@mm/core';
import { ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/** PUT /api/v1/brands/:brandId/settings — partial update of Brand Kit settings (BRAND_ADMIN). */
export const PUT = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, brandSettingsSchema);
  return ok(await updateBrandSettings(ctx, input));
});
