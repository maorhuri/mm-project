import { NextResponse } from 'next/server';
import { db } from '@mm/db';

export const dynamic = 'force-dynamic';

/** Liveness + database readiness. Used by the deploy script and the reverse proxy. */
export async function GET() {
  const startedAt = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      latencyMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { status: 'degraded', db: 'error', error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
