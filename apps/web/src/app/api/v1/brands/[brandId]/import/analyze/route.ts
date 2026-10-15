import { ValidationError, analyzeBrandSite, websiteAnalyzeSchema } from '@mm/core';
import { ok, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/**
 * POST /api/v1/brands/:brandId/import/analyze — { url? } (defaults to the brand website).
 * Returns colour/font/logo suggestions derived from the site; nothing is saved.
 */
export const POST = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ValidationError('Request body must be valid JSON');
    }
  }
  const input = websiteAnalyzeSchema.parse(body);
  return ok(await analyzeBrandSite(ctx, input.url));
});
