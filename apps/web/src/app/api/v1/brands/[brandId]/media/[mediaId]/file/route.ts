import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getMedia, openMediaObject } from '@mm/core';
import type { ByteRange } from '@mm/core';
import { requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string; mediaId: string };

function parseRange(header: string | null, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return 'invalid';
  const [, a, b] = m;
  if (a === '' && b === '') return 'invalid';
  if (a === '') {
    // Suffix range: last N bytes.
    const n = Math.min(Number(b), size);
    return n > 0 ? { start: size - n, end: size - 1 } : 'invalid';
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (!Number.isFinite(start) || start >= size || end < start) return 'invalid';
  return { start, end };
}

/** GET /api/v1/brands/:brandId/media/:mediaId/file — streams the object with access control (Range supported for video/audio seeking). */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const meta = await getMedia(ctx, params.mediaId);
  const range = parseRange(req.headers.get('range'), meta.sizeBytes);
  if (range === 'invalid') {
    return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${meta.sizeBytes}` } });
  }
  const { asset, object } = await openMediaObject(ctx, params.mediaId, range ?? undefined);
  const headers = new Headers({
    'Content-Type': asset.mimeType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
    'X-Content-Type-Options': 'nosniff',
  });
  // SVG can carry scripts: never let it run in the app's origin.
  if (asset.mimeType === 'image/svg+xml') headers.set('Content-Security-Policy', "sandbox; script-src 'none'");
  let status = 200;
  if (range && object.range) {
    status = 206;
    headers.set('Content-Range', `bytes ${object.range.start}-${object.range.end}/${object.range.total}`);
    headers.set('Content-Length', String(object.range.end - object.range.start + 1));
  } else {
    headers.set('Content-Length', String(asset.sizeBytes));
  }
  const stream = Readable.toWeb(object.body) as unknown as ReadableStream;
  return new Response(stream, { status, headers });
});
