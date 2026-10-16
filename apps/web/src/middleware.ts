import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'mm_session';
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_DAYS ?? 30) * 24 * 60 * 60;

/**
 * Cheap gate: pages under /app require a session cookie. The cookie is fully
 * validated server-side in the app layout and in every action/route — this
 * only avoids rendering the shell for anonymous visitors.
 *
 * It deliberately does NOT bounce /login to /app on cookie presence: a stale
 * cookie (session revoked elsewhere, password change, DB restore) would then
 * loop /app → /login → /app forever. /login validates the session itself.
 *
 * While the user is active the cookie's lifetime slides along with the
 * server-side session (see validateSession), so long-running sessions do not
 * log out on the original cookie expiry.
 */
export function middleware(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  const { pathname } = request.nextUrl;

  if (!cookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname !== '/app' ? `?next=${encodeURIComponent(pathname)}` : '';
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  response.cookies.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return response;
}

export const config = {
  matcher: ['/app/:path*'],
};
