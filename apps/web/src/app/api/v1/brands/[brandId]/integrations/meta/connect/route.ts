import { NextResponse } from 'next/server';
import { META_STATE_COOKIE, META_STATE_TTL_SEC, buildMetaConnectUrl, getConfig } from '@mm/core';
import { requireApiBrand, withApi } from '@/lib/api';

type P = { brandId: string };

/** GET /api/v1/brands/:brandId/integrations/meta/connect — starts Facebook Login for Business (redirect). */
export const GET = withApi<P>(async (req, { params }) => {
  const ctx = await requireApiBrand(req, params.brandId);
  const returnTo = req.nextUrl.searchParams.get('returnTo') ?? '/app/integrations';
  const { url, nonce } = await buildMetaConnectUrl(ctx, { returnTo });
  const res = NextResponse.redirect(url, 302);
  res.cookies.set(META_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getConfig().APP_URL.startsWith('https://'),
    path: '/api/v1/integrations/meta',
    maxAge: META_STATE_TTL_SEC,
  });
  return res;
});
