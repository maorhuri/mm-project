import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  UnauthorizedError,
  authenticateUser,
  createSession,
  loginSchema,
  recordAudit,
  sessionCookieOptions,
} from '@mm/core';
import { parseJson, requestMetaFrom, withApi } from '@/lib/api';

/** POST /api/v1/auth/login — returns a session token (also set as cookie) for API clients. */
export const POST = withApi(async (req) => {
  const input = await parseJson(req, loginSchema);
  const meta = requestMetaFrom(req);
  const user = await authenticateUser(input.email, input.password);
  if (!user) {
    await recordAudit(meta, { action: 'auth.login_failed', entityType: 'user', metadata: { email: input.email, via: 'api' } });
    throw new UnauthorizedError('Invalid email or password');
  }
  const { token, session } = await createSession(user.id, meta);
  await recordAudit({ actorUserId: user.id, ...meta }, { action: 'auth.login', entityType: 'user', entityId: user.id, metadata: { via: 'api' } });
  const res = NextResponse.json({ data: { token, expiresAt: session.expiresAt, user } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
  return res;
});
