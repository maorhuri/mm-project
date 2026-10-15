/**
 * Per-file setup: point the app at the test database, use in-memory storage,
 * and truncate every table before each test.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { beforeEach } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../../../.env'), override: false });

if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'memory';
process.env.LOG_LEVEL = 'silent';
process.env.APP_SECRET ??= 'test-app-secret-at-least-32-characters-long';
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.MM_ENV_LOADED = '1';

beforeEach(async () => {
  const { db } = await import('@mm/db');
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
});
