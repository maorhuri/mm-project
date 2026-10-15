'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  MFA_COOKIE,
  SESSION_COOKIE,
  ValidationError,
  authenticateUser,
  createMfaChallenge,
  createSession,
  enforceRateLimit,
  loginSchema,
  mfaCookieOptions,
  mfaVerifySchema,
  recordAudit,
  sessionCookieOptions,
  verifyMfaChallenge,
  verifyMfaCode,
} from '@mm/core';
import { runAction, str } from '@/lib/actions';
import type { ActionState } from '@/lib/actions';
import { requestMeta } from '@/lib/auth';

const WINDOW_15M = 15 * 60;

function safeNext(value: string): string {
  return value.startsWith('/app') ? value : '';
}

async function establishSession(userId: string, meta: { ipAddress: string | null; userAgent: string | null }, method: string) {
  const { token, session } = await createSession(userId, meta);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
  await recordAudit({ actorUserId: userId, ...meta }, { action: 'auth.login', entityType: 'user', entityId: userId, metadata: { method } });
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = loginSchema.parse({ email: str(formData, 'email'), password: str(formData, 'password') });
    const meta = await requestMeta();
    await enforceRateLimit(`login:ip:${meta.ipAddress ?? 'unknown'}`, 30, WINDOW_15M, 'יותר מדי ניסיונות התחברות. נסו שוב בעוד כמה דקות.');
    await enforceRateLimit(`login:email:${input.email}`, 10, WINDOW_15M, 'יותר מדי ניסיונות התחברות לחשבון הזה. נסו שוב בעוד כמה דקות.');

    const user = await authenticateUser(input.email, input.password);
    if (!user) {
      await recordAudit({ ...meta }, { action: 'auth.login_failed', entityType: 'user', metadata: { email: input.email } });
      throw new ValidationError('אימייל או סיסמה שגויים');
    }
    const next = safeNext(str(formData, 'next'));

    if (user.mfaEnabled) {
      (await cookies()).set(MFA_COOKIE, createMfaChallenge(user.id), mfaCookieOptions());
      await recordAudit({ actorUserId: user.id, ...meta }, { action: 'auth.login_password_ok', entityType: 'user', entityId: user.id, metadata: { mfa: 'pending' } });
      redirect(`/login/mfa${next ? `?next=${encodeURIComponent(next)}` : ''}`);
    }

    await establishSession(user.id, meta, 'password');
    redirect(next || '/app');
  });
}

/** Second step: TOTP or recovery code against the signed challenge cookie. */
export async function mfaVerifyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const jar = await cookies();
    const challenge = verifyMfaChallenge(jar.get(MFA_COOKIE)?.value);
    if (!challenge) {
      jar.delete(MFA_COOKIE);
      throw new ValidationError('פג תוקף שלב האימות — התחברו מחדש');
    }
    const { code } = mfaVerifySchema.parse({ code: str(formData, 'code') });
    const meta = await requestMeta();
    await enforceRateLimit(`mfa:${challenge.nonce}`, 5, 10 * 60, 'יותר מדי ניסיונות עבור ההתחברות הזו. התחברו מחדש.');
    await enforceRateLimit(`mfa:ip:${meta.ipAddress ?? 'unknown'}`, 30, WINDOW_15M, 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.');

    const verified = await verifyMfaCode(challenge.userId, code);
    if (!verified.ok) {
      await recordAudit({ actorUserId: challenge.userId, ...meta }, { action: 'auth.mfa_failed', entityType: 'user', entityId: challenge.userId });
      throw new ValidationError('הקוד שגוי', [{ path: 'code', message: 'הקוד שגוי או שכבר נוצל — נסו את הקוד הנוכחי באפליקציה' }]);
    }
    jar.delete(MFA_COOKIE);
    await establishSession(challenge.userId, meta, verified.method);
    redirect(safeNext(str(formData, 'next')) || '/app');
  });
}
