import { ValidationError, listMedia, mediaFileUrl, mediaListQuerySchema, uploadMedia } from '@mm/core';
import { ok, parseQuery, requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/** GET /api/v1/brands/:brandId/media?kind=&search=&tag=&page=&pageSize= */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const query = parseQuery(req, mediaListQuerySchema);
  const page = await listMedia(ctx, query);
  return ok({ ...page, items: page.items.map((m) => ({ ...m, url: mediaFileUrl(m) })) });
});

/**
 * POST /api/v1/brands/:brandId/media — multipart/form-data upload.
 * Fields: file (one or more), tags (comma separated, optional), title (optional, single file).
 */
export const POST = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError('Expected multipart/form-data with a "file" field');
  }
  const files = form.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) throw new ValidationError('No file provided');
  const tagsRaw = form.get('tags');
  const tags = typeof tagsRaw === 'string' ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const titleRaw = form.get('title');
  const title = typeof titleRaw === 'string' && files.length === 1 ? titleRaw : null;

  const items = [];
  for (const file of files) {
    const asset = await uploadMedia(ctx, {
      data: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
      mimeType: file.type,
      tags,
      title,
    });
    items.push({ ...asset, url: mediaFileUrl(asset) });
  }
  return ok({ items }, { status: 201 });
});
