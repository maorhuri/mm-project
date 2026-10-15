import {
  countPendingApprovals,
  countUnreadNotifications,
  getConfig,
  getMfaStatus,
  isOrgAdmin,
  listNotifications,
  listUserOrganizations,
  resolveBrandContext,
} from '@mm/core';
import { AppShell } from '@/components/shell/app-shell';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser } from '@/lib/auth';
import { getBrandSelection } from '@/lib/brand';
import { MfaCard } from './settings/mfa-card';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await requireUser();
  const { brands, current } = await getBrandSelection();
  const [unreadCount, notifications, pendingApprovals] = await Promise.all([
    countUnreadNotifications(user.id),
    listNotifications(user.id, { limit: 8 }),
    current ? resolveBrandContext(actor, current.id).then(countPendingApprovals) : Promise.resolve(0),
  ]);

  // Optional policy (PRD §20 "MFA for admins"): admins must enrol before using the app.
  let mustEnrolMfa = false;
  if (getConfig().MFA_REQUIRED_FOR_ADMINS && !user.mfaEnabled) {
    const orgs = await listUserOrganizations(actor);
    mustEnrolMfa = actor.isSuperAdmin || orgs.some((o) => isOrgAdmin(o.role));
  }

  return (
    <AppShell
      user={user}
      brands={brands}
      currentBrand={current}
      pendingApprovals={pendingApprovals}
      notifications={notifications}
      unreadCount={unreadCount}
    >
      {mustEnrolMfa ? <MfaGate userId={user.id} /> : children}
    </AppShell>
  );
}

async function MfaGate({ userId }: { userId: string }) {
  const mfa = await getMfaStatus(userId);
  return (
    <>
      <PageHeader title="נדרש אימות דו-שלבי" description="מדיניות המערכת מחייבת מנהלים להפעיל אימות דו-שלבי לפני השימוש." />
      <MfaCard enabled={mfa.enabled} enrolledAt={mfa.enrolledAt} recoveryCodesLeft={mfa.recoveryCodesLeft} required />
    </>
  );
}
