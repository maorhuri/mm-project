'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  ValidationError,
  authenticateUser,
  createSession,
  loginSchema,
  recordAudit,
  sessionCookieOptions,
} from '@mm/core';
import { runAction, str } from '@/lib/actions';
import type { ActionState } from '@/lib/actions';
import { requestMeta } from '@/lib/auth';

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const input = loginSchema.parse({ email: str(formData, 'email'), password: str(formData, 'password') });
    const meta = await requestMeta();
    const user = await authenticateUser(input.email, input.password);
    if (!user) {
      await recordAudit({ ...meta }, { action: 'auth.login_failed', entityType: 'user', metadata: { email: input.email } });
      throw new ValidationError('אימייל או סיסמה שגויים');
    }
    const { token, session } = await createSession(user.id, meta);
    (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
    await recordAudit({ actorUserId: user.id, ...meta }, { action: 'auth.login', entityType: 'user', entityId: user.id });

    const next = str(formData, 'next');
    redirect(next.startsWith('/app') ? next : '/app');
  });
}
