// Must be the first import: sets MM_SERVICE before @mm/core creates the logger
// (ESM/esbuild hoist imports above any statement in this file).
import './env';

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { db } from '@mm/db';
import {
  JOBS,
  QUEUES,
  closeQueues,
  deleteExpiredSessions,
  finishJobRecord,
  getConfig,
  getQueue,
  getRedisConnection,
  logger,
  startJobRecord,
} from '@mm/core';
import type { QueueName } from '@mm/core';

type Processor = (job: Job) => Promise<unknown>;

// ---------------------------------------------------------------------------
// System jobs
// ---------------------------------------------------------------------------

const systemProcessors: Record<string, Processor> = {
  [JOBS.heartbeat]: async () => ({ ok: true, at: new Date().toISOString() }),

  [JOBS.cleanupSessions]: async () => {
    const sessions = await deleteExpiredSessions();
    const cutoffJobs = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cutoffNotifications = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [jobs, notifications] = await Promise.all([
      db.backgroundJob.deleteMany({
        where: { createdAt: { lt: cutoffJobs }, status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
      }),
      db.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: cutoffNotifications } } }),
    ]);
    return { sessions, jobs: jobs.count, notifications: notifications.count };
  },
};

const processors: Record<QueueName, Record<string, Processor>> = {
  system: systemProcessors,
  media: {},
  content: {},
  publishing: {},
  ads: {},
  video: {},
  ai: {},
};

// ---------------------------------------------------------------------------
// Worker plumbing: every execution is recorded in background_jobs
// ---------------------------------------------------------------------------

function makeWorker(queue: QueueName): Worker {
  const worker = new Worker(
    queue,
    async (job) => {
      const processor = processors[queue][job.name];
      if (!processor) throw new Error(`No processor registered for ${queue}/${job.name}`);
      const data = (job.data ?? {}) as Record<string, unknown>;
      const record = await startJobRecord({
        queue,
        name: job.name,
        bullJobId: job.id ?? null,
        brandId: typeof data.brandId === 'string' ? data.brandId : null,
        idempotencyKey: typeof data.idempotencyKey === 'string' ? data.idempotencyKey : null,
        payload: data,
        attempts: job.attemptsMade + 1,
      });
      const log = logger.child({ queue, job: job.name, jobId: job.id });
      if (record.alreadyCompleted) {
        log.warn('job already completed under its idempotency key — skipping');
        return record.result;
      }
      log.info('job started');
      try {
        const result = await processor(job);
        await finishJobRecord(record.id, { status: 'COMPLETED', result });
        log.info({ result }, 'job completed');
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await finishJobRecord(record.id, { status: 'FAILED', error: message });
        log.error({ err }, 'job failed');
        throw err;
      }
    },
    { connection: getRedisConnection(), concurrency: queue === 'system' ? 2 : 1 },
  );
  worker.on('error', (err) => logger.error({ err, queue }, 'worker error'));
  return worker;
}

async function scheduleRecurringJobs(): Promise<void> {
  const system = getQueue(QUEUES.system);
  await system.upsertJobScheduler(JOBS.heartbeat, { every: 15 * 60 * 1000 }, { name: JOBS.heartbeat });
  await system.upsertJobScheduler(
    JOBS.cleanupSessions,
    { pattern: '0 4 * * *', tz: 'Asia/Jerusalem' },
    { name: JOBS.cleanupSessions },
  );
}

async function main(): Promise<void> {
  const cfg = getConfig();
  logger.info({ env: cfg.NODE_ENV, queues: Object.values(QUEUES) }, 'worker starting');

  await db.$queryRaw`SELECT 1`;
  const workers = (Object.values(QUEUES) as QueueName[]).map(makeWorker);
  await scheduleRecurringJobs();
  logger.info('worker ready');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'worker shutting down');
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await db.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
