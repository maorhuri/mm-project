import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'mm_session';

/**
 * Cheap gate: pages under /app require a session cookie. The cookie is fully
 * validated server-side in the app layout and in every action/route — this
 * only avoids rendering the shell for anonymous visitors.
 */
export function middleware(request: NextRequest) {
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/app') && !hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname !== '/app' ? `?next=${encodeURIComponent(pathname)}` : '';
    return NextResponse.redirect(url);
  }
  if (pathname === '/login' && hasCookie) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/login'],
};
