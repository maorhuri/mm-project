'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SESSION_COOKIE, invalidateSession, markNotificationsRead, recordAudit } from '@mm/core';
import { getSession, requestMeta, requireUser } from '@/lib/auth';
import { BRAND_COOKIE } from '@/lib/brand';

export async function switchBrandAction(brandId: string): Promise<void> {
  await requireUser();
  (await cookies()).set(BRAND_COOKIE, brandId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/app');
}

export async function logoutAction(): Promise<void> {
  const session = await getSession();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(token);
  jar.delete(SESSION_COOKIE);
  if (session) {
    const meta = await requestMeta();
    await recordAudit(
      { actorUserId: session.user.id, ...meta },
      { action: 'auth.logout', entityType: 'user', entityId: session.user.id },
    );
  }
  redirect('/login');
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const { user } = await requireUser();
  await markNotificationsRead(user.id);
  revalidatePath('/app', 'layout');
}
