import Link from 'next/link';
import { Megaphone } from 'lucide-react';
import { z } from 'zod';
import { getAdsOverview, getMetaConnection } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SyncButton } from './sync-button';

export const metadata = { title: 'מנהל קמפיינים' };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function money(n: number | null | undefined, currency: string | null): string {
  if (n === null || n === undefined) return '—';
  try {
    return new Intl.NumberFormat('he-IL', { style: 'currency', currency: currency ?? 'ILS', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ''}`;
  }
}

const STATUS_VARIANT: Record<string, 'success' | 'muted' | 'warning' | 'destructive' | 'secondary'> = {
  ACTIVE: 'success',
  PAUSED: 'muted',
  CAMPAIGN_PAUSED: 'muted',
  ADSET_PAUSED: 'muted',
  IN_PROCESS: 'warning',
  WITH_ISSUES: 'destructive',
  DISAPPROVED: 'destructive',
  ARCHIVED: 'secondary',
  DELETED: 'secondary',
};

export default async function AdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireBrandContext();
  const days = z.coerce.number().int().min(1).max(90).catch(30).parse(first(sp.days) ?? 30);
  const [connection, overview] = await Promise.all([getMetaConnection(ctx), getAdsOverview(ctx, { days })]);
  const currency = overview.totals.currency ?? overview.account?.currency ?? null;
  const maxDaily = Math.max(1, ...overview.daily.map((d) => d.spend));

  return (
    <>
      <PageHeader
        title="מנהל קמפיינים"
        description={`${ctx.brand.name} · מראה של חשבון המודעות ב-Meta. כל מספר מגיע מה-API הרשמי עם זמן סנכרון; שום שינוי אינו נשלח ל-Meta בשלב זה.`}
        badges={<Badge variant="outline">קריאה בלבד</Badge>}
        actions={
          connection.connected && overview.account ? (
            <div className="flex items-center gap-2">
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {[7, 30, 90].map((d) => (
                  <Button key={d} asChild size="sm" variant="ghost" className={cn('h-8', days === d && 'bg-background shadow')}>
                    <Link href={`/app/ads?days=${d}`}>{d} יום</Link>
                  </Button>
                ))}
              </div>
              {ctx.brandRole !== 'VIEWER' ? <SyncButton days={days} /> : null}
            </div>
          ) : null
        }
      />

      {!connection.connected ? (
        <EmptyState
          icon={Megaphone}
          title="המותג לא מחובר ל-Meta"
          description="חברו את חשבון הפייסבוק של המותג בעמוד האינטגרציות כדי לראות קמפיינים וביצועים."
          action={
            <Button asChild>
              <Link href="/app/integrations">לעמוד האינטגרציות</Link>
            </Button>
          }
        />
      ) : !overview.account ? (
        <EmptyState icon={Megaphone} title="לא נבחר חשבון מודעות" description="בחרו חשבון מודעות בעמוד האינטגרציות ולחצו סנכרון." action={<Button asChild><Link href="/app/integrations">לעמוד האינטגרציות</Link></Button>} />
      ) : (
        <>
          {connection.lastError ? (
            <Alert variant="destructive">
              <Megaphone />
              <AlertTitle>הסנכרון האחרון נכשל</AlertTitle>
              <AlertDescription dir="ltr" className="text-start">
                {connection.lastError}
              </AlertDescription>
            </Alert>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label={`הוצאה (${days} יום)`} value={money(overview.totals.spend, currency)} hint={`${overview.account.name} · ${overview.account.externalId}`} />
            <StatCard label="חשיפות" value={formatNumber(overview.totals.impressions)} hint={`הגעה ${formatNumber(overview.totals.reach)}`} />
            <StatCard label="קליקים" value={formatNumber(overview.totals.clicks)} hint={overview.totals.ctr !== null ? `CTR ${overview.totals.ctr}%` : 'CTR —'} />
            <StatCard label="עלות לקליק" value={money(overview.totals.cpc, currency)} hint={`סנכרון אחרון ${formatDateTime(overview.lastSync?.finishedAt ?? overview.lastSync?.startedAt)}`} />
          </div>

          {overview.daily.length > 0 ? (
            <div className="rounded-xl border bg-card p-4">
              <div className="mb-2 text-sm font-medium">הוצאה יומית</div>
              <div className="flex h-32 items-end gap-px" dir="ltr">
                {overview.daily.map((d) => (
                  <div key={d.date} className="group relative flex-1" title={`${d.date}: ${money(d.spend, currency)} · ${formatNumber(d.impressions)} חשיפות · ${formatNumber(d.clicks)} קליקים`}>
                    <div className="w-full rounded-t bg-primary/70 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(2, (d.spend / maxDaily) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted-foreground" dir="ltr">
                <span>{overview.daily[0]?.date}</span>
                <span>{overview.daily[overview.daily.length - 1]?.date}</span>
              </div>
            </div>
          ) : (
            <Alert variant="info">
              <Megaphone />
              <AlertDescription>אין עדיין שורות ביצועים לתקופה. לחצו סנכרון — או שלחשבון לא הייתה פעילות.</AlertDescription>
            </Alert>
          )}

          {overview.campaigns.length === 0 ? (
            <EmptyState icon={Megaphone} title="אין קמפיינים בחשבון" description="אחרי סנכרון יופיעו כאן כל הקמפיינים של החשבון שנבחר." />
          ) : (
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>קמפיין</TableHead>
                    <TableHead>סטטוס</TableHead>
                    <TableHead>מטרה</TableHead>
                    <TableHead>תקציב</TableHead>
                    <TableHead>הוצאה ({days} יום)</TableHead>
                    <TableHead>חשיפות</TableHead>
                    <TableHead>קליקים</TableHead>
                    <TableHead>CTR</TableHead>
                    <TableHead>CPC</TableHead>
                    <TableHead>סטים</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.campaigns.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">
                        {c.name}
                        <div className="text-[11px] text-muted-foreground" dir="ltr">
                          {c.externalId}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[c.effectiveStatus ?? ''] ?? 'secondary'}>{c.effectiveStatus ?? c.status ?? '—'}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{c.objective ?? '—'}</TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {c.dailyBudget !== null ? `${money(c.dailyBudget, currency)} / יום` : c.lifetimeBudget !== null ? `${money(c.lifetimeBudget, currency)} כולל` : 'ברמת סט'}
                      </TableCell>
                      <TableCell className="tabular-nums">{money(c.spend, currency)}</TableCell>
                      <TableCell className="tabular-nums">{formatNumber(c.impressions)}</TableCell>
                      <TableCell className="tabular-nums">{formatNumber(c.clicks)}</TableCell>
                      <TableCell className="tabular-nums">{c.ctr !== null ? `${c.ctr}%` : '—'}</TableCell>
                      <TableCell className="tabular-nums">{money(c.cpc, currency)}</TableCell>
                      <TableCell className="tabular-nums">{c.adSetCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </>
  );
}
