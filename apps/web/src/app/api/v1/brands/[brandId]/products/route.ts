import { createProduct, listProducts, productSchema } from '@mm/core';
import { ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  return ok(await listProducts(ctx));
});

export const POST = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, productSchema);
  return ok(await createProduct(ctx, input), { status: 201 });
});
