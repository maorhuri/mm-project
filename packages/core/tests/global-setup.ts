/**
 * Runs once before the test suite: ensures the dedicated test database exists
 * and is migrated. Tests never touch the main database.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootEnv = path.resolve(here, '../../../.env');

export default async function globalSetup(): Promise<void> {
  loadDotenv({ path: rootEnv, override: false });
  const testUrl = process.env.TEST_DATABASE_URL;
  const mainUrl = process.env.DATABASE_URL;
  if (!testUrl || !mainUrl) {
    throw new Error('DATABASE_URL and TEST_DATABASE_URL must be set to run integration tests');
  }
  const testDbName = new URL(testUrl).pathname.replace(/^\//, '');
  const mainDbName = new URL(mainUrl).pathname.replace(/^\//, '');
  if (testDbName === mainDbName) {
    throw new Error('TEST_DATABASE_URL must point to a different database than DATABASE_URL');
  }

  const { PrismaClient } = await import('@prisma/client');
  const admin = new PrismaClient({ datasourceUrl: mainUrl });
  try {
    const rows = await admin.$queryRawUnsafe<{ exists: boolean }[]>(
      'SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
      testDbName,
    );
    if (!rows[0]?.exists) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${testDbName}"`);
      console.log(`[tests] created database ${testDbName}`);
    }
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy --schema ../db/prisma/schema.prisma', {
    cwd: path.resolve(here, '..'),
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
