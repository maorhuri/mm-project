import { db } from '@mm/db';
import type { BackgroundJob, Prisma } from '@mm/db';

export interface StartJobRecordInput {
  queue: string;
  name: string;
  bullJobId?: string | null;
  brandId?: string | null;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
  attempts?: number;
}

/** JSON-safe copy for a `Json` column; `undefined` leaves the column untouched (NULL). */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  return serialized === undefined ? undefined : (JSON.parse(serialized) as Prisma.InputJsonValue);
}

/**
 * Durable record of a job execution, written by workers (BullMQ state lives in Redis).
 * With an idempotency key the SAME row is reused across retries (the key is unique);
 * a key whose previous run already COMPLETED is reported so the caller can skip the side effect.
 */
export async function startJobRecord(input: StartJobRecordInput): Promise<BackgroundJob & { alreadyCompleted: boolean }> {
  if (input.idempotencyKey) {
    const existing = await db.backgroundJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.status === 'COMPLETED') return { ...existing, alreadyCompleted: true };
      const row = await db.backgroundJob.update({
        where: { id: existing.id },
        data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: new Date(), finishedAt: null, error: null, bullJobId: input.bullJobId ?? existing.bullJobId },
      });
      return { ...row, alreadyCompleted: false };
    }
  }
  const row = await db.backgroundJob.create({
    data: {
      queue: input.queue,
      name: input.name,
      bullJobId: input.bullJobId ?? null,
      brandId: input.brandId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      payload: toJson(input.payload ?? {}) ?? {},
      status: 'RUNNING',
      attempts: input.attempts ?? 1,
      startedAt: new Date(),
    },
  });
  return { ...row, alreadyCompleted: false };
}

export async function finishJobRecord(
  id: string,
  outcome: { status: 'COMPLETED'; result?: unknown } | { status: 'FAILED'; error: string },
): Promise<void> {
  await db.backgroundJob.update({
    where: { id },
    data: {
      status: outcome.status,
      finishedAt: new Date(),
      ...(outcome.status === 'COMPLETED' ? { result: toJson(outcome.result) } : { error: outcome.error.slice(0, 4000) }),
    },
  });
}

/** True if a job with this idempotency key already completed (prevents duplicate side effects). */
export async function hasCompletedJob(idempotencyKey: string): Promise<boolean> {
  const row = await db.backgroundJob.findUnique({ where: { idempotencyKey } });
  return row?.status === 'COMPLETED';
}
