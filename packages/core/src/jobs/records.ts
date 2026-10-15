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

/** Durable record of a job execution, written by workers (BullMQ state lives in Redis). */
export async function startJobRecord(input: StartJobRecordInput): Promise<BackgroundJob> {
  return db.backgroundJob.create({
    data: {
      queue: input.queue,
      name: input.name,
      bullJobId: input.bullJobId ?? null,
      brandId: input.brandId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      payload: (input.payload ?? {}) as Prisma.InputJsonObject,
      status: 'RUNNING',
      attempts: input.attempts ?? 1,
      startedAt: new Date(),
    },
  });
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
      ...(outcome.status === 'COMPLETED'
        ? { result: (outcome.result ?? null) as Prisma.InputJsonValue }
        : { error: outcome.error.slice(0, 4000) }),
    },
  });
}

/** True if a job with this idempotency key already completed (prevents duplicate side effects). */
export async function hasCompletedJob(idempotencyKey: string): Promise<boolean> {
  const row = await db.backgroundJob.findUnique({ where: { idempotencyKey } });
  return row?.status === 'COMPLETED';
}
