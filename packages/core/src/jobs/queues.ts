import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { getConfig } from '../config';

export const QUEUES = {
  system: 'system',
  media: 'media',
  content: 'content',
  publishing: 'publishing',
  ads: 'ads',
  video: 'video',
  ai: 'ai',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  heartbeat: 'system.heartbeat',
  cleanupSessions: 'system.cleanup-sessions',
  creativeRender: 'creative.render',
  videoRender: 'video.render',
  metaSync: 'ads.sync-meta',
  publishDue: 'publishing.dispatch-due',
} as const;

let connection: IORedis | undefined;

/** Shared Redis connection configured for BullMQ (maxRetriesPerRequest must be null). */
export function getRedisConnection(): IORedis {
  connection ??= new IORedis(getConfig().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  return connection;
}

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    });
    queues.set(name, queue);
  }
  return queue;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = undefined;
  }
}
