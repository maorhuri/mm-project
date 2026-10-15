import { applyBrandImport, brandImportApplySchema } from '@mm/core';
import { ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/**
 * POST /api/v1/brands/:brandId/import/apply — { colors?, fonts?, description?, logo?: { url, type } }
 * Saves the selected suggestions into the Brand Kit (BRAND_ADMIN). Returns the updated kit.
 */
export const POST = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, brandImportApplySchema);
  return ok(await applyBrandImport(ctx, input));
});
