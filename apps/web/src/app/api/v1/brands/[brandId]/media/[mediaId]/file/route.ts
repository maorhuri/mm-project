import { Readable } from 'node:stream';
import { openMediaObject } from '@mm/core';
import { requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string; mediaId: string };

/** GET /api/v1/brands/:brandId/media/:mediaId/file — streams the object with access control. */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const { asset, object } = await openMediaObject(ctx, params.mediaId);
  const headers = new Headers({
    'Content-Type': asset.mimeType,
    'Content-Length': String(asset.sizeBytes),
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    'X-Content-Type-Options': 'nosniff',
  });
  // SVG can carry scripts: never let it run in the app's origin.
  if (asset.mimeType === 'image/svg+xml') headers.set('Content-Security-Policy', "sandbox; script-src 'none'");
  const stream = Readable.toWeb(object.body) as unknown as ReadableStream;
  return new Response(stream, { headers });
});
