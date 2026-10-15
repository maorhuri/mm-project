/**
 * Short-lived, HMAC-signed "password verified, MFA pending" token. A real
 * session is only created after the second factor succeeds, so an attacker
 * holding this token still cannot reach the app.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig } from '../config';

export const MFA_COOKIE = 'mm_mfa';
export const MFA_CHALLENGE_TTL_SEC = 300;

interface Payload {
  u: string; // user id
  e: number; // expiry (unix seconds)
  n: string; // nonce (rate-limit key)
}

function sign(data: string): string {
  return createHmac('sha256', getConfig().APP_SECRET).update(data).digest('base64url');
}

export function createMfaChallenge(userId: string, ttlSec = MFA_CHALLENGE_TTL_SEC): string {
  const payload: Payload = { u: userId, e: Math.floor(Date.now() / 1000) + ttlSec, n: randomBytes(12).toString('base64url') };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${sign(data)}`;
}

export function verifyMfaChallenge(token: string | undefined | null): { userId: string; nonce: string } | null {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Payload;
    if (typeof payload.u !== 'string' || typeof payload.e !== 'number' || typeof payload.n !== 'string') return null;
    if (payload.e <= Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.u, nonce: payload.n };
  } catch {
    return null;
  }
}

export function mfaCookieOptions() {
  return {
    httpOnly: true,
    secure: getConfig().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MFA_CHALLENGE_TTL_SEC,
  };
}
