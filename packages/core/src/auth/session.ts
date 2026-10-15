import { db } from '@mm/db';
import type { Session, User } from '@mm/db';
import { getConfig } from '../config';
import { randomToken, sha256Hex } from '../crypto';

export const SESSION_COOKIE = 'mm_session';

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export type SessionUser = Pick<
  User,
  'id' | 'email' | 'name' | 'isSuperAdmin' | 'isActive' | 'mfaEnabled' | 'createdAt'
>;

export interface ValidatedSession {
  session: Session;
  user: SessionUser;
  /** True when the expiry was extended; the caller should refresh the cookie. */
  refreshed: boolean;
}

const userSelect = {
  id: true,
  email: true,
  name: true,
  isSuperAdmin: true,
  isActive: true,
  mfaEnabled: true,
  createdAt: true,
} as const;

function ttlMs(): number {
  return getConfig().SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Create a session; returns the raw token (only ever sent to the client as a cookie). */
export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<{ token: string; session: Session }> {
  const token = randomToken(32);
  const session = await db.session.create({
    data: {
      tokenHash: sha256Hex(token),
      userId,
      expiresAt: new Date(Date.now() + ttlMs()),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });
  return { token, session };
}

/**
 * Validate a cookie token. Expired sessions are deleted. Sliding expiration:
 * when less than half the TTL remains the session is extended.
 */
export async function validateSession(token: string | undefined | null): Promise<ValidatedSession | null> {
  if (!token) return null;
  const tokenHash = sha256Hex(token);
  const found = await db.session.findUnique({
    where: { tokenHash },
    include: { user: { select: userSelect } },
  });
  if (!found) return null;

  const now = Date.now();
  if (found.expiresAt.getTime() <= now) {
    await db.session.delete({ where: { id: found.id } }).catch(() => undefined);
    return null;
  }
  if (!found.user.isActive) return null;

  let refreshed = false;
  const remaining = found.expiresAt.getTime() - now;
  const patch: { lastSeenAt?: Date; expiresAt?: Date } = {};
  if (remaining < ttlMs() / 2) {
    patch.expiresAt = new Date(now + ttlMs());
    refreshed = true;
  }
  // Throttle lastSeenAt writes to once per 5 minutes.
  if (now - found.lastSeenAt.getTime() > 5 * 60 * 1000) patch.lastSeenAt = new Date(now);
  const session = Object.keys(patch).length
    ? await db.session.update({ where: { id: found.id }, data: patch })
    : found;

  const { user: _user, ...rest } = found;
  return { session: { ...rest, ...session }, user: found.user, refreshed };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: sha256Hex(token) } });
}

export async function invalidateAllUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
  const res = await db.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
  return res.count;
}

export async function deleteExpiredSessions(): Promise<number> {
  const res = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return res.count;
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: getConfig().NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}
