/**
 * Fixed-window rate limiter on Redis (shared by web and API). Fails open with
 * an error log if Redis is unreachable — Redis is local infrastructure and its
 * absence already breaks background jobs, so availability wins here.
 */
import { AppError } from '../errors';
import { getRedisConnection } from '../jobs/queues';
import { logger } from '../logger';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export class RateLimitedError extends AppError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, message = 'Too many attempts, please try again later') {
    super(429, 'rate_limited', message, { retryAfterSec });
    this.retryAfterSec = retryAfterSec;
  }
}

export async function rateLimit(key: string, max: number, windowSec: number): Promise<RateLimitResult> {
  try {
    const redis = getRedisConnection();
    const k = `rl:${key}`;
    const count = await redis.incr(k);
    if (count === 1) await redis.expire(k, windowSec);
    if (count <= max) return { allowed: true, remaining: max - count, retryAfterSec: 0 };
    const ttl = await redis.ttl(k);
    return { allowed: false, remaining: 0, retryAfterSec: ttl > 0 ? ttl : windowSec };
  } catch (err) {
    logger.error({ err, key }, 'rate limiter unavailable — allowing request');
    return { allowed: true, remaining: max, retryAfterSec: 0 };
  }
}

/** Throws RateLimitedError (HTTP 429) when the window is exhausted. */
export async function enforceRateLimit(key: string, max: number, windowSec: number, message?: string): Promise<void> {
  const res = await rateLimit(key, max, windowSec);
  if (!res.allowed) throw new RateLimitedError(res.retryAfterSec, message);
}

export async function resetRateLimit(key: string): Promise<void> {
  try {
    await getRedisConnection().del(`rl:${key}`);
  } catch {
    /* ignore */
  }
}
