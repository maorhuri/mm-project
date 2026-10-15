import { deleteProduct, productSchema, updateProduct } from '@mm/core';
import { noContent, ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string; productId: string };

export const PATCH = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, productSchema);
  return ok(await updateProduct(ctx, params.productId, input));
});

export const DELETE = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  await deleteProduct(ctx, params.productId);
  return noContent();
});
