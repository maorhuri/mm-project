import { db } from '@mm/db';
import type { User } from '@mm/db';
import { dummyHash, hashPassword, verifyPassword } from '../auth/password';
import type { SessionUser } from '../auth/session';
import { invalidateAllUserSessions } from '../auth/session';
import { ConflictError, NotFoundError, ValidationError } from '../errors';
import { recordAudit } from '../audit';
import type { Actor } from '../tenancy/context';

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  isSuperAdmin?: boolean;
}

const sessionUserSelect = {
  id: true,
  email: true,
  name: true,
  isSuperAdmin: true,
  isActive: true,
  mfaEnabled: true,
  createdAt: true,
} as const;

export async function createUser(input: CreateUserInput): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new ConflictError('A user with this email already exists');
  const user = await db.user.create({
    data: {
      email,
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      isSuperAdmin: input.isSuperAdmin ?? false,
    },
    select: sessionUserSelect,
  });
  await recordAudit(
    { actorUserId: user.id },
    { action: 'user.create', entityType: 'user', entityId: user.id, after: { email, name: user.name } },
  );
  return user;
}

/** Returns the user on success, null on bad credentials. Timing is kept constant. */
export async function authenticateUser(email: string, password: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    await verifyPassword(await dummyHash(), password);
    return null;
  }
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok || !user.isActive) return null;
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return pickSessionUser(user);
}

export async function getUserById(userId: string): Promise<SessionUser | null> {
  return db.user.findUnique({ where: { id: userId }, select: sessionUserSelect });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepSessionId?: string,
): Promise<{ revokedSessions: number }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('user');
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ValidationError('Current password is incorrect', [
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  }
  await db.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });
  const revokedSessions = await invalidateAllUserSessions(userId, keepSessionId);
  await recordAudit(
    { actorUserId: userId },
    { action: 'user.change_password', entityType: 'user', entityId: userId, metadata: { revokedSessions } },
  );
  return { revokedSessions };
}

export function pickSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isSuperAdmin: user.isSuperAdmin,
    isActive: user.isActive,
    mfaEnabled: user.mfaEnabled,
    createdAt: user.createdAt,
  };
}

export function toActor(user: SessionUser): Actor {
  return { userId: user.id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin };
}
