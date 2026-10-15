import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { SESSION_COOKIE, toActor, validateSession } from '@mm/core';
import type { Actor, SessionUser, ValidatedSession } from '@mm/core';
import type { Session } from '@mm/db';

/** Validated session for the current request (deduplicated per render). */
export const getSession = cache(async (): Promise<ValidatedSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSession(token);
});

export interface CurrentUser {
  user: SessionUser;
  actor: Actor;
  session: Session;
}

/** For server components and actions: redirects to /login when not signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const validated = await getSession();
  if (!validated) redirect('/login');
  return { user: validated.user, actor: toActor(validated.user), session: validated.session };
}

/** Client IP / user agent for audit logs (behind Nginx + Cloudflare). */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ipAddress: h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? forwarded ?? null,
    userAgent: h.get('user-agent'),
  };
}
