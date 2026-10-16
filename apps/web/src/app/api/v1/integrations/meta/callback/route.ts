import { NextResponse } from 'next/server';
import { META_STATE_COOKIE, completeMetaConnect, getConfig, isAppError, logger } from '@mm/core';
import { requireApiUser, withApi } from '@/lib/api';

/** GET /api/v1/integrations/meta/callback — Meta redirects here with ?code&state (or ?error). */
export const GET = withApi(async (req) => {
  const base = getConfig().APP_URL.replace(/\/$/, '');
  const q = req.nextUrl.searchParams;
  const fail = (message: string) => {
    const res = NextResponse.redirect(`${base}/app/integrations?meta_error=${encodeURIComponent(message.slice(0, 300))}`, 302);
    res.cookies.delete(META_STATE_COOKIE);
    return res;
  };
  if (q.get('error')) {
    return fail(q.get('error_description') ?? (q.get('error_reason') === 'user_denied' ? 'ההתחברות בוטלה בפייסבוק' : `Meta: ${q.get('error')}`));
  }
  const code = q.get('code');
  const state = q.get('state');
  if (!code || !state) return fail('חסרים פרמטרים בחזרה מפייסבוק');
  const { actor } = await requireApiUser(req);
  try {
    const result = await completeMetaConnect(actor, { code, state, cookieNonce: req.cookies.get(META_STATE_COOKIE)?.value });
    const target = result.returnTo ?? '/app/integrations';
    const res = NextResponse.redirect(`${base}${target}${target.includes('?') ? '&' : '?'}meta=connected`, 302);
    res.cookies.delete(META_STATE_COOKIE);
    return res;
  } catch (err) {
    if (isAppError(err)) return fail(err.message);
    logger.error({ err }, 'meta callback failed');
    return fail('ההתחברות ל-Meta נכשלה');
  }
});
