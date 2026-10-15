import 'server-only';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import type { z } from 'zod';
import {
  SESSION_COOKIE,
  UnauthorizedError,
  ValidationError,
  isAppError,
  logger,
  resolveBrandContext,
  toActor,
  validateSession,
} from '@mm/core';
import type { Actor, BrandContext, SessionUser } from '@mm/core';

export type RouteContext<P extends Record<string, string> = Record<string, string>> = {
  params: Promise<P>;
};

type Handler<P extends Record<string, string>> = (
  req: NextRequest,
  ctx: { params: P },
) => Promise<Response>;

/** Wrap a route handler: resolves params, maps domain errors to JSON responses. */
export function withApi<P extends Record<string, string> = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      const params = await context.params;
      return await handler(req, { params });
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(ValidationError.fromZod(err).toJSON(), { status: 422 });
      }
      if (isAppError(err)) {
        return NextResponse.json(err.toJSON(), { status: err.status });
      }
      logger.error({ err, path: req.nextUrl.pathname }, 'unhandled API error');
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Internal server error', details: null } },
        { status: 500 },
      );
    }
  };
}

function bearerToken(req: NextRequest): string | undefined {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return undefined;
}

export function requestMetaFrom(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return {
    ipAddress: req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? forwarded ?? null,
    userAgent: req.headers.get('user-agent'),
  };
}

/** Authenticate via session cookie or `Authorization: Bearer <session token>`. */
export async function requireApiUser(req: NextRequest): Promise<{ user: SessionUser; actor: Actor; sessionId: string }> {
  const token = req.cookies.get(SESSION_COOKIE)?.value ?? bearerToken(req);
  const validated = await validateSession(token);
  if (!validated) throw new UnauthorizedError();
  return { user: validated.user, actor: toActor(validated.user), sessionId: validated.session.id };
}

export async function requireApiBrand(req: NextRequest, brandId: string): Promise<BrandContext> {
  const { actor } = await requireApiUser(req);
  return resolveBrandContext(actor, brandId, requestMetaFrom(req));
}

/** Parse the JSON body; returns the schema's OUTPUT type (defaults/coercions applied). */
export async function parseJson<S extends z.ZodTypeAny>(req: NextRequest, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  return schema.parse(body) as z.output<S>;
}

export function parseQuery<S extends z.ZodTypeAny>(req: NextRequest, schema: S): z.output<S> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries())) as z.output<S>;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}
