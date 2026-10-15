import {
  countPendingApprovals,
  countUnreadNotifications,
  listNotifications,
  resolveBrandContext,
} from '@mm/core';
import { AppShell } from '@/components/shell/app-shell';
import { requireUser } from '@/lib/auth';
import { getBrandSelection } from '@/lib/brand';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await requireUser();
  const { brands, current } = await getBrandSelection();
  const [unreadCount, notifications, pendingApprovals] = await Promise.all([
    countUnreadNotifications(user.id),
    listNotifications(user.id, { limit: 8 }),
    current ? resolveBrandContext(actor, current.id).then(countPendingApprovals) : Promise.resolve(0),
  ]);

  return (
    <AppShell
      user={user}
      brands={brands}
      currentBrand={current}
      pendingApprovals={pendingApprovals}
      notifications={notifications}
      unreadCount={unreadCount}
    >
      {children}
    </AppShell>
  );
}
