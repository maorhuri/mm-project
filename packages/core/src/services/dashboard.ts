import { db } from '@mm/db';
import type { BackgroundJob } from '@mm/db';
import type { BrandContext, BrandSummary } from '../tenancy/context';
import type { IntegrationStatus } from './integrations';
import { listIntegrationStatus } from './integrations';

export interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  createdAt: Date;
}

export interface BrandOverview {
  brand: BrandSummary;
  counts: {
    media: number;
    products: number;
    pendingApprovals: number;
    knowledgeApproved: number;
    knowledgePending: number;
    unreadNotifications: number;
  };
  integrations: IntegrationStatus[];
  recentActivity: ActivityItem[];
  recentJobs: BackgroundJob[];
  /** All numbers above are live database counts — never estimates. */
  dataSource: 'live';
  generatedAt: Date;
}

export async function getBrandOverview(ctx: BrandContext): Promise<BrandOverview> {
  const [
    media,
    products,
    pendingApprovals,
    knowledgeApproved,
    knowledgePending,
    unreadNotifications,
    integrations,
    audit,
    recentJobs,
  ] = await Promise.all([
    ctx.db.mediaAsset.count({ where: { deletedAt: null } }),
    ctx.db.brandProduct.count({ where: { isActive: true } }),
    ctx.db.approval.count({ where: { status: 'PENDING' } }),
    ctx.db.brandKnowledge.count({ where: { status: 'APPROVED' } }),
    ctx.db.brandKnowledge.count({ where: { status: 'PENDING' } }),
    db.notification.count({ where: { userId: ctx.actor.userId, readAt: null } }),
    listIntegrationStatus(ctx),
    db.auditLog.findMany({
      where: { brandId: ctx.brandId },
      include: { actor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    ctx.db.backgroundJob.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
  ]);

  return {
    brand: ctx.brand,
    counts: { media, products, pendingApprovals, knowledgeApproved, knowledgePending, unreadNotifications },
    integrations,
    recentActivity: audit.map((a) => ({
      id: a.id,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      actorName: a.actor?.name ?? null,
      createdAt: a.createdAt,
    })),
    recentJobs,
    dataSource: 'live',
    generatedAt: new Date(),
  };
}
