import { NextResponse } from 'next/server';
import { SESSION_COOKIE, invalidateSession } from '@mm/core';
import { withApi } from '@/lib/api';

/** POST /api/v1/auth/logout — revokes the current session (cookie or bearer). */
export const POST = withApi(async (req) => {
  const auth = req.headers.get('authorization');
  const bearer = auth?.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : undefined;
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? bearer;
  if (token) await invalidateSession(token);
  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
