import { db } from '@mm/db';
import type { Notification, NotificationLevel } from '@mm/db';
import type { BrandContext } from '../tenancy/context';

export interface NotificationInput {
  level?: NotificationLevel;
  title: string;
  body?: string | null;
  link?: string | null;
}

export async function notifyUsers(
  userIds: string[],
  brandId: string | null,
  input: NotificationInput,
): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const res = await db.notification.createMany({
    data: unique.map((userId) => ({
      userId,
      brandId,
      level: input.level ?? 'INFO',
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
    })),
  });
  return res.count;
}

/** Users with an effective BRAND_ADMIN role on the brand (org admins + explicit grants), excluding the actor. */
export async function brandAdminUserIds(ctx: BrandContext): Promise<string[]> {
  const [orgAdmins, grants] = await Promise.all([
    db.membership.findMany({
      where: { orgId: ctx.orgId, role: { in: ['OWNER', 'ADMIN'] } },
      select: { userId: true },
    }),
    db.brandAccess.findMany({
      where: { brandId: ctx.brandId, role: 'BRAND_ADMIN', user: { memberships: { some: { orgId: ctx.orgId } } } },
      select: { userId: true },
    }),
  ]);
  return [...orgAdmins, ...grants].map((r) => r.userId).filter((id) => id !== ctx.actor.userId);
}

export async function notifyBrandAdmins(ctx: BrandContext, input: NotificationInput): Promise<number> {
  return notifyUsers(await brandAdminUserIds(ctx), ctx.brandId, input);
}

export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  return db.notification.findMany({
    where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 20,
  });
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const res = await db.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return res.count;
}
