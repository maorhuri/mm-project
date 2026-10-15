import { deleteMedia, getMedia, mediaFileUrl, mediaUpdateSchema, updateMedia } from '@mm/core';
import { noContent, ok, parseJson, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string; mediaId: string };

export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const asset = await getMedia(ctx, params.mediaId);
  return ok({ ...asset, url: mediaFileUrl(asset) });
});

export const PATCH = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const input = await parseJson(req, mediaUpdateSchema);
  const asset = await updateMedia(ctx, params.mediaId, input);
  return ok({ ...asset, url: mediaFileUrl(asset) });
});

export const DELETE = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  await deleteMedia(ctx, params.mediaId);
  return noContent();
});
