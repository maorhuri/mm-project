import { PrismaClient } from '@prisma/client';
import { scopeArgs } from './tenant';

export * from '@prisma/client';
export { scopeArgs, TENANT_MODELS } from './tenant';

const globalForPrisma = globalThis as unknown as { __mmPrisma?: PrismaClient };

function createClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }]
        : [{ level: 'error', emit: 'stdout' }],
  });
}

/**
 * Root (unscoped) client. Use ONLY for identity/org-level operations
 * (users, sessions, memberships, listing a user's brands). Brand data must go
 * through `forBrand()`.
 */
export const db: PrismaClient = globalForPrisma.__mmPrisma ?? createClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__mmPrisma = db;

/**
 * Tenant-scoped client: every query on a brand-scoped model is confined to
 * `brandId` server-side, and every create is stamped with it.
 */
export function forBrand(brandId: string) {
  if (!brandId) throw new Error('forBrand(): brandId is required');
  return db.$extends({
    name: `tenant:${brandId}`,
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          return query(
            scopeArgs(model, operation, args as Record<string, unknown>, brandId) as typeof args,
          );
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forBrand>;

export async function disconnectDb(): Promise<void> {
  await db.$disconnect();
}
