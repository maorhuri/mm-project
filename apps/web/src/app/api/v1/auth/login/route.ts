import { NextResponse } from 'next/server';
import {
  MFA_CHALLENGE_TTL_SEC,
  SESSION_COOKIE,
  UnauthorizedError,
  authenticateUser,
  createMfaChallenge,
  createSession,
  enforceRateLimit,
  loginSchema,
  recordAudit,
  sessionCookieOptions,
} from '@mm/core';
import { parseJson, requestMetaFrom, withApi } from '@/lib/api';

/**
 * POST /api/v1/auth/login — { email, password }.
 * Returns a session token (also set as cookie). When the user has two-factor
 * authentication enabled, responds 401 `mfa_required` with a short-lived
 * `challenge` to send to POST /api/v1/auth/mfa together with the code.
 */
export const POST = withApi(async (req) => {
  const input = await parseJson(req, loginSchema);
  const meta = requestMetaFrom(req);
  await enforceRateLimit(`login:ip:${meta.ipAddress ?? 'unknown'}`, 30, 15 * 60);
  await enforceRateLimit(`login:email:${input.email}`, 10, 15 * 60);

  const user = await authenticateUser(input.email, input.password);
  if (!user) {
    await recordAudit(meta, { action: 'auth.login_failed', entityType: 'user', metadata: { email: input.email, via: 'api' } });
    throw new UnauthorizedError('Invalid email or password');
  }
  if (user.mfaEnabled) {
    await recordAudit({ actorUserId: user.id, ...meta }, { action: 'auth.login_password_ok', entityType: 'user', entityId: user.id, metadata: { mfa: 'pending', via: 'api' } });
    return NextResponse.json(
      {
        error: {
          code: 'mfa_required',
          message: 'Two-factor code required',
          details: { challenge: createMfaChallenge(user.id), expiresInSec: MFA_CHALLENGE_TTL_SEC },
        },
      },
      { status: 401 },
    );
  }
  const { token, session } = await createSession(user.id, meta);
  await recordAudit({ actorUserId: user.id, ...meta }, { action: 'auth.login', entityType: 'user', entityId: user.id, metadata: { via: 'api', method: 'password' } });
  const res = NextResponse.json({ data: { token, expiresAt: session.expiresAt, user } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
  return res;
});
