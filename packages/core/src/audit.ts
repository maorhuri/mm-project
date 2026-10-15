import { db } from '@mm/db';
import type { Prisma } from '@mm/db';
import type { BrandContext } from './tenancy/context';
import { logger } from './logger';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

interface AuditScope {
  orgId?: string | null;
  brandId?: string | null;
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Append-only audit trail. Never throws — a failed audit write is logged, not fatal. */
export async function recordAudit(scope: AuditScope, entry: AuditEntry): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        orgId: scope.orgId ?? null,
        brandId: scope.brandId ?? null,
        actorUserId: scope.actorUserId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: toJson(entry.before),
        after: toJson(entry.after),
        metadata: toJson(entry.metadata),
        ipAddress: scope.ipAddress ?? null,
        userAgent: scope.userAgent?.slice(0, 512) ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: entry.action }, 'audit write failed');
  }
}

export function auditFromContext(ctx: BrandContext, entry: AuditEntry): Promise<void> {
  return recordAudit(
    {
      orgId: ctx.orgId,
      brandId: ctx.brandId,
      actorUserId: ctx.actor.userId,
      ipAddress: ctx.request?.ipAddress ?? null,
      userAgent: ctx.request?.userAgent ?? null,
    },
    entry,
  );
}
