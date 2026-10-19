import { Readable } from 'node:stream';
import { openMediaObject, voiceSample } from '@mm/core';
import { requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string; voice: string };

/** GET /api/v1/brands/:brandId/voices/:voice — a cached Hebrew sample of the voice (created on first request). */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const asset = await voiceSample(ctx, params.voice);
  const { object } = await openMediaObject(ctx, asset.id);
  return new Response(Readable.toWeb(object.body) as unknown as ReadableStream, {
    headers: { 'Content-Type': asset.mimeType, 'Content-Length': String(asset.sizeBytes), 'Cache-Control': 'private, max-age=86400' },
  });
});
