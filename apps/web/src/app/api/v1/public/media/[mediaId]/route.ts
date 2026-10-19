import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { openPublicMedia, verifyPublicMediaLink } from '@mm/core';

/** GET /api/v1/public/media/:mediaId?b&e&s — signed, expiring link (platforms fetching media to publish). */
export async function GET(req: NextRequest, context: { params: Promise<{ mediaId: string }> }): Promise<Response> {
  const { mediaId } = await context.params;
  const q = req.nextUrl.searchParams;
  const brandId = q.get('b');
  if (!/^[0-9a-f-]{36}$/i.test(mediaId) || !verifyPublicMediaLink(mediaId, brandId, q.get('e'), q.get('s'))) {
    return new Response('Forbidden', { status: 403 });
  }
  const found = await openPublicMedia(mediaId, brandId!);
  if (!found) return new Response('Not found', { status: 404 });
  const headers = new Headers({
    'Content-Type': found.asset.mimeType,
    'Content-Length': String(found.asset.sizeBytes),
    'Cache-Control': 'private, max-age=600',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  });
  if (found.asset.mimeType === 'image/svg+xml') return new Response('Unsupported', { status: 415 });
  return new Response(Readable.toWeb(found.object.body) as unknown as ReadableStream, { headers });
}
