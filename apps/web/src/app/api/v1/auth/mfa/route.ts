import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  SESSION_COOKIE,
  UnauthorizedError,
  createSession,
  enforceRateLimit,
  getUserById,
  mfaCodeSchema,
  recordAudit,
  sessionCookieOptions,
  verifyMfaChallenge,
  verifyMfaCode,
} from '@mm/core';
import { parseJson, requestMetaFrom, withApi } from '@/lib/api';

const bodySchema = z.object({ challenge: z.string().min(10).max(2000), code: mfaCodeSchema });

/** POST /api/v1/auth/mfa — { challenge, code } → session token. */
export const POST = withApi(async (req) => {
  const input = await parseJson(req, bodySchema);
  const meta = requestMetaFrom(req);
  const challenge = verifyMfaChallenge(input.challenge);
  if (!challenge) throw new UnauthorizedError('Challenge expired or invalid — log in again');
  await enforceRateLimit(`mfa:${challenge.nonce}`, 5, 10 * 60);
  await enforceRateLimit(`mfa:ip:${meta.ipAddress ?? 'unknown'}`, 30, 15 * 60);

  const verified = await verifyMfaCode(challenge.userId, input.code);
  if (!verified.ok) {
    await recordAudit({ actorUserId: challenge.userId, ...meta }, { action: 'auth.mfa_failed', entityType: 'user', entityId: challenge.userId, metadata: { via: 'api' } });
    throw new UnauthorizedError('Invalid or already used code');
  }
  const user = await getUserById(challenge.userId);
  if (!user) throw new UnauthorizedError();
  const { token, session } = await createSession(user.id, meta);
  await recordAudit({ actorUserId: user.id, ...meta }, { action: 'auth.login', entityType: 'user', entityId: user.id, metadata: { via: 'api', method: verified.method } });
  const res = NextResponse.json({ data: { token, expiresAt: session.expiresAt, user, recoveryCodesLeft: verified.recoveryCodesLeft } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
  return res;
});
