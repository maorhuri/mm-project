import Link from 'next/link';
import { BadgeCheck, BookOpenCheck, Images, Package, Palette, Plug } from 'lucide-react';
import { getBrandOverview } from '@mm/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { getBrandSelection, requireBrandContext } from '@/lib/brand';
import { formatDateTime, relativeTime } from '@/lib/format';
import { BrandStatusBadge, IntegrationStatusBadge, JobStatusBadge } from '@/components/status-badges';

export default async function OverviewPage() {
  const { current } = await getBrandSelection();
  if (!current) {
    return (
      <>
        <PageHeader title="סקירה" description="אין עדיין מותגים בחשבון הזה." />
        <EmptyState
          icon={Palette}
          title="צרו את המותג הראשון"
          description="כל מותג מקבל סביבת עבודה נפרדת: Brand Kit, ספריית מדיה, אישורים, קמפיינים ולידים."
          action={
            <Button asChild>
              <Link href="/app/brands">למסך המותגים</Link>
            </Button>
          }
        />
      </>
    );
  }

  const ctx = await requireBrandContext();
  const overview = await getBrandOverview(ctx);
  const { counts } = overview;

  return (
    <>
      <PageHeader
        title={overview.brand.name}
        description="סקירת מצב המותג הנבחר. כל המספרים הם ספירות חיות ממסד הנתונים."
        badges={
          <>
            <BrandStatusBadge status={overview.brand.status} />
            {overview.brand.isDemo ? <Badge variant="warning">מותג דמו</Badge> : null}
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/app/brands/${overview.brand.id}`}>Brand Kit</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="פריטי מדיה" value={counts.media} icon={Images} href="/app/media" />
        <StatCard label="מוצרים ושירותים פעילים" value={counts.products} icon={Package} href={`/app/brands/${overview.brand.id}?tab=products`} />
        <StatCard
          label="ממתינים לאישור"
          value={counts.pendingApprovals}
          icon={BadgeCheck}
          href="/app/approvals"
          tone={counts.pendingApprovals > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="מידע מאושר למותג"
          value={counts.knowledgeApproved}
          hint={counts.knowledgePending > 0 ? `${counts.knowledgePending} ממתינים לאישור` : 'רק מידע מאושר זמין ל-AI'}
          icon={BookOpenCheck}
          href={`/app/brands/${overview.brand.id}?tab=knowledge`}
        />
      </div>

      <Alert variant="info">
        <Plug />
        <AlertDescription>
          קמפיינים, פוסטים מתוזמנים, סרטונים בהפקה ולידים יופיעו כאן כשהמודולים שלהם ייבנו (שלבים 2–6). לא מוצגים
          כאן נתונים מדומים.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>מצב אינטגרציות</CardTitle>
            <CardDescription>ספקי AI, Meta ו-Google. חיבור אמיתי נדרש לפני שכל מודול יוכרז פעיל.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {overview.integrations.map((i) => (
              <div key={i.provider} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate font-medium">{i.label}</div>
                  <div className="text-xs text-muted-foreground">שלב {i.phase} · {i.scope === 'org' ? 'ארגוני' : 'לפי מותג'}</div>
                </div>
                <IntegrationStatusBadge status={i.status} />
              </div>
            ))}
            <div className="pt-3">
              <Button asChild variant="link" className="h-auto p-0">
                <Link href="/app/integrations">לכל האינטגרציות</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>פעילות אחרונה</CardTitle>
            <CardDescription>מתוך יומן הביקורת של המותג</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">עדיין אין פעילות מתועדת למותג.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {overview.recentActivity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-primary" dir="ltr">
                        {a.action}
                      </span>
                      <div className="truncate text-xs text-muted-foreground">
                        {a.actorName ?? 'מערכת'} · {a.entityType}
                      </div>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(a.createdAt)}>
                      {relativeTime(a.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>משימות רקע אחרונות</CardTitle>
          <CardDescription>ריצות ה-worker מתועדות במסד הנתונים (heartbeat, ניקוי, ובהמשך פרסום וסנכרון).</CardDescription>
        </CardHeader>
        <CardContent>
          {overview.recentJobs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              עדיין לא רצו משימות רקע עבור המותג הזה.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {overview.recentJobs.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="font-mono text-xs" dir="ltr">
                    {j.queue}/{j.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <JobStatusBadge status={j.status} />
                    <time className="text-xs text-muted-foreground">{formatDateTime(j.createdAt)}</time>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        מקור הנתונים: מסד הנתונים של המערכת (live) · נוצר {formatDateTime(overview.generatedAt)}
      </p>
    </>
  );
}
