import type { Approval, ApprovalType, Prisma } from '@mm/db';
import { auditFromContext } from '../audit';
import { ConflictError, NotFoundError } from '../errors';
import { logger } from '../logger';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import type { ApprovalDecisionInput, ApprovalListQuery } from '../validation';
import { notifyBrandAdmins } from './notifications';

export interface RequestApprovalInput {
  type: ApprovalType;
  title: string;
  summary?: string | null;
  subjectType: string;
  subjectId: string;
  subjectVersion?: number;
  payload?: Record<string, unknown>;
  estimatedCostIls?: number | null;
}

/**
 * Side effects applied when an approval is decided. Modules register a handler
 * for their subject type (e.g. "scheduled_post") so the approval service never
 * has to import them.
 */
export type ApprovalHandler = (ctx: BrandContext, approval: Approval) => Promise<void>;
const handlers = new Map<string, ApprovalHandler>();

export function registerApprovalHandler(subjectType: string, handler: ApprovalHandler): void {
  handlers.set(subjectType, handler);
}

// Built-in: brand knowledge becomes usable by AI only once approved.
registerApprovalHandler('brand_knowledge', async (ctx, approval) => {
  const entry = await ctx.db.brandKnowledge.findUnique({ where: { id: approval.subjectId } });
  if (!entry) return;
  if (approval.status === 'APPROVED') {
    await ctx.db.brandKnowledge.update({
      where: { id: entry.id },
      data: { status: 'APPROVED', approvedById: ctx.actor.userId, approvedAt: new Date() },
    });
  } else if (approval.status === 'REJECTED') {
    await ctx.db.brandKnowledge.update({
      where: { id: entry.id },
      data: { status: 'REJECTED', approvedById: null, approvedAt: null },
    });
  }
});

/** Create a PENDING approval. Idempotent per (subjectType, subjectId, subjectVersion) while open. */
export async function requestApproval(ctx: BrandContext, input: RequestApprovalInput): Promise<Approval> {
  const subjectVersion = input.subjectVersion ?? 1;
  const existing = await ctx.db.approval.findFirst({
    where: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion,
      status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
    },
  });
  if (existing) return existing;

  // brandId is also stamped by the tenant client; passing it keeps Prisma's types honest.
  const approval = await ctx.db.approval.create({
    data: {
      brandId: ctx.brandId,
      type: input.type,
      title: input.title,
      summary: input.summary ?? null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectVersion,
      payload: (input.payload ?? {}) as Prisma.InputJsonObject,
      estimatedCostIls: input.estimatedCostIls ?? null,
      requestedById: ctx.actor.userId,
    },
  });
  await auditFromContext(ctx, {
    action: 'approval.request',
    entityType: 'approval',
    entityId: approval.id,
    after: { type: approval.type, subjectType: approval.subjectType, subjectId: approval.subjectId },
  });
  await notifyBrandAdmins(ctx, {
    level: 'INFO',
    title: `ממתין לאישור: ${approval.title}`,
    body: approval.summary,
    link: '/app/approvals',
  });
  return approval;
}

export interface ApprovalListItem extends Approval {
  requestedBy: { id: string; name: string } | null;
  decidedBy: { id: string; name: string } | null;
}

export async function listApprovals(
  ctx: BrandContext,
  query: ApprovalListQuery,
): Promise<{ items: ApprovalListItem[]; total: number; page: number; pageSize: number }> {
  const where: Prisma.ApprovalWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type as ApprovalType;
  const [items, total] = await Promise.all([
    ctx.db.approval.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    ctx.db.approval.count({ where }),
  ]);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getApproval(ctx: BrandContext, approvalId: string): Promise<Approval> {
  const approval = await ctx.db.approval.findUnique({ where: { id: approvalId } });
  if (!approval) throw new NotFoundError('approval');
  return approval;
}

export async function countPendingApprovals(ctx: BrandContext): Promise<number> {
  return ctx.db.approval.count({ where: { status: 'PENDING' } });
}

/** Approve / reject / request changes. Only BRAND_ADMIN may decide. */
export async function decideApproval(
  ctx: BrandContext,
  approvalId: string,
  input: ApprovalDecisionInput,
): Promise<Approval> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const approval = await getApproval(ctx, approvalId);
  if (approval.status !== 'PENDING' && approval.status !== 'CHANGES_REQUESTED') {
    throw new ConflictError(`Approval is already ${approval.status}`);
  }
  const updated = await ctx.db.approval.update({
    where: { id: approvalId },
    data: {
      status: input.decision,
      decidedById: ctx.actor.userId,
      decidedAt: new Date(),
      decisionNote: input.note ?? null,
    },
  });

  const handler = handlers.get(updated.subjectType);
  if (handler) {
    try {
      await handler(ctx, updated);
    } catch (err) {
      logger.error({ err, approvalId }, 'approval side effect failed');
      await ctx.db.approval.update({
        where: { id: approvalId },
        data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }

  await auditFromContext(ctx, {
    action: `approval.${input.decision.toLowerCase()}`,
    entityType: 'approval',
    entityId: approvalId,
    before: { status: approval.status },
    after: { status: updated.status, note: updated.decisionNote },
  });
  return updated;
}

export async function markApprovalScheduled(ctx: BrandContext, approvalId: string): Promise<Approval> {
  return transition(ctx, approvalId, ['APPROVED'], { status: 'SCHEDULED' });
}

export async function markApprovalExecuted(ctx: BrandContext, approvalId: string): Promise<Approval> {
  return transition(ctx, approvalId, ['APPROVED', 'SCHEDULED'], {
    status: 'EXECUTED',
    executedAt: new Date(),
  });
}

export async function markApprovalFailed(
  ctx: BrandContext,
  approvalId: string,
  errorMessage: string,
): Promise<Approval> {
  return transition(ctx, approvalId, ['APPROVED', 'SCHEDULED'], {
    status: 'FAILED',
    errorMessage: errorMessage.slice(0, 2000),
  });
}

async function transition(
  ctx: BrandContext,
  approvalId: string,
  allowedFrom: Approval['status'][],
  data: Prisma.ApprovalUpdateInput,
): Promise<Approval> {
  const approval = await getApproval(ctx, approvalId);
  if (!allowedFrom.includes(approval.status)) {
    throw new ConflictError(`Cannot transition approval from ${approval.status}`);
  }
  const updated = await ctx.db.approval.update({ where: { id: approvalId }, data });
  await auditFromContext(ctx, {
    action: `approval.${String(data.status).toLowerCase()}`,
    entityType: 'approval',
    entityId: approvalId,
    before: { status: approval.status },
    after: { status: updated.status },
  });
  return updated;
}
