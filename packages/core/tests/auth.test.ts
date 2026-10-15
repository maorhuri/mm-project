import { describe, expect, it } from 'vitest';
import { db } from '@mm/db';
import {
  createSession,
  invalidateAllUserSessions,
  invalidateSession,
  validateSession,
} from '../src/auth/session';
import { decryptString, encryptJson, decryptJson, encryptString } from '../src/crypto';
import { ValidationError } from '../src/errors';
import { authenticateUser, changePassword, createUser } from '../src/services/users';

describe('users & sessions', () => {
  it('creates a user with a hashed password and authenticates', async () => {
    const user = await createUser({ email: 'Admin@Example.com', name: 'Admin', password: 'super-secret-pw' });
    expect(user.email).toBe('admin@example.com');
    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.passwordHash).not.toContain('super-secret-pw');
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);

    expect(await authenticateUser('admin@example.com', 'super-secret-pw')).toMatchObject({ id: user.id });
    expect(await authenticateUser('admin@example.com', 'wrong')).toBeNull();
    expect(await authenticateUser('nobody@example.com', 'wrong')).toBeNull();
  });

  it('rejects duplicate emails', async () => {
    await createUser({ email: 'a@b.c', name: 'A', password: 'password-1234' });
    await expect(createUser({ email: 'A@B.C', name: 'A2', password: 'password-1234' })).rejects.toThrow();
  });

  it('session tokens validate, expire and can be revoked', async () => {
    const user = await createUser({ email: 's@b.c', name: 'S', password: 'password-1234' });
    const { token, session } = await createSession(user.id, { ipAddress: '127.0.0.1' });
    expect(session.tokenHash).not.toBe(token);

    const valid = await validateSession(token);
    expect(valid?.user.id).toBe(user.id);
    expect(await validateSession('not-a-token')).toBeNull();

    await db.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSession(token)).toBeNull();
    expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();

    const second = await createSession(user.id);
    await invalidateSession(second.token);
    expect(await validateSession(second.token)).toBeNull();

    await createSession(user.id);
    await createSession(user.id);
    expect(await invalidateAllUserSessions(user.id)).toBe(2);
  });

  it('inactive users cannot authenticate or keep sessions', async () => {
    const user = await createUser({ email: 'i@b.c', name: 'I', password: 'password-1234' });
    const { token } = await createSession(user.id);
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect(await authenticateUser('i@b.c', 'password-1234')).toBeNull();
    expect(await validateSession(token)).toBeNull();
  });

  it('changes password and revokes other sessions', async () => {
    const user = await createUser({ email: 'c@b.c', name: 'C', password: 'old-password-1' });
    const keep = await createSession(user.id);
    await createSession(user.id);
    await expect(changePassword(user.id, 'wrong', 'new-password-12')).rejects.toBeInstanceOf(ValidationError);
    const res = await changePassword(user.id, 'old-password-1', 'new-password-12', keep.session.id);
    expect(res.revokedSessions).toBe(1);
    expect(await validateSession(keep.token)).not.toBeNull();
    expect(await authenticateUser('c@b.c', 'new-password-12')).not.toBeNull();
  });
});

describe('crypto', () => {
  it('round-trips encrypted strings and JSON', () => {
    const token = encryptString('secret-token-value');
    expect(token).not.toContain('secret-token-value');
    expect(decryptString(token)).toBe('secret-token-value');
    const enc = encryptJson({ access: 'a', refresh: 'r' });
    expect(decryptJson<{ access: string }>(enc).access).toBe('a');
    expect(() => decryptString('v1.bad.bad.bad')).toThrow();
  });
});
