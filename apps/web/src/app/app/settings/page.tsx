import { db } from '@mm/db';
import { getConfig, getMfaStatus, isOrgAdmin, listOrgMembers, listUserOrganizations } from '@mm/core';
import { MfaCard } from './mfa-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { ChangePasswordForm, RevokeSessionsButton } from './settings-forms';

export const metadata = { title: 'הגדרות' };

const ROLE_LABELS: Record<string, string> = { OWNER: 'בעלים', ADMIN: 'מנהל', MEMBER: 'חבר', VIEWER: 'צופה' };

export default async function SettingsPage() {
  const { user, actor, session } = await requireUser();
  const [sessions, orgs, mfa] = await Promise.all([
    db.session.findMany({ where: { userId: user.id }, orderBy: { lastSeenAt: 'desc' }, take: 20 }),
    listUserOrganizations(actor),
    getMfaStatus(user.id),
  ]);
  const adminOrgs = orgs.filter((o) => actor.isSuperAdmin || isOrgAdmin(o.role));
  const mfaRequired = getConfig().MFA_REQUIRED_FOR_ADMINS && (actor.isSuperAdmin || adminOrgs.length > 0);
  const members = await Promise.all(adminOrgs.map(async (o) => ({ org: o, members: await listOrgMembers(actor, o.id) })));

  return (
    <>
      <PageHeader title="הגדרות" description="חשבון, אבטחה וחברי הארגון." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>החשבון שלי</CardTitle>
            <CardDescription>פרטי המשתמש המחובר</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <Row label="שם" value={user.name} />
            <Row label="אימייל" value={user.email} ltr />
            <Row label="הרשאות" value={user.isSuperAdmin ? 'Super admin' : 'משתמש'} />
            <Row label="אימות דו-שלבי" value={mfa.enabled ? 'מופעל' : 'כבוי'} />
            <Row label="נוצר" value={formatDateTime(user.createdAt)} />
          </CardContent>
        </Card>

        <ChangePasswordForm />
      </div>

      <MfaCard enabled={mfa.enabled} enrolledAt={mfa.enrolledAt} recoveryCodesLeft={mfa.recoveryCodesLeft} required={mfaRequired} />

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>חיבורים פעילים</CardTitle>
              <CardDescription>כל מכשיר שמחובר לחשבון. ניתן לנתק את כל החיבורים האחרים.</CardDescription>
            </div>
            <RevokeSessionsButton disabled={sessions.length <= 1} />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מכשיר</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>פעילות אחרונה</TableHead>
                <TableHead>נוצר</TableHead>
                <TableHead>פג תוקף</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-xs truncate text-xs" dir="ltr" title={s.userAgent ?? ''}>
                    {s.id === session.id ? <Badge variant="success" className="me-2">נוכחי</Badge> : null}
                    {s.userAgent ?? '—'}
                  </TableCell>
                  <TableCell dir="ltr" className="text-xs">
                    {s.ipAddress ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs">{formatDateTime(s.lastSeenAt)}</TableCell>
                  <TableCell className="text-xs">{formatDateTime(s.createdAt)}</TableCell>
                  <TableCell className="text-xs">{formatDateTime(s.expiresAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {members.map(({ org, members: rows }) => (
        <Card key={org.id}>
          <CardHeader>
            <CardTitle>חברי הארגון — {org.name}</CardTitle>
            <CardDescription>
              בעלים ומנהלים רואים את כל המותגים; חברים וצופים רק מותגים שהוענקה להם גישה אליהם. הזמנת משתמשים תתווסף
              בהמשך.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>שם</TableHead>
                  <TableHead>אימייל</TableHead>
                  <TableHead>תפקיד</TableHead>
                  <TableHead>סטטוס</TableHead>
                  <TableHead>הצטרף</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.membershipId}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {m.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{ROLE_LABELS[m.role] ?? m.role}</Badge>
                    </TableCell>
                    <TableCell>{m.isActive ? <Badge variant="success">פעיל</Badge> : <Badge variant="muted">מושבת</Badge>}</TableCell>
                    <TableCell className="text-xs">{formatDateTime(m.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

function Row({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium" dir={ltr ? 'ltr' : undefined}>
        {value}
      </span>
    </div>
  );
}
