import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BRIEF_KIND_LABELS, buildFactsPacket, getStrategyBrief, isAppError } from '@mm/core';
import type { BriefContent } from '@mm/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ConfidenceBadge } from '@/components/status-badges';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime } from '@/lib/format';
import { BriefStatusButtons } from '../brief-status-buttons';

export const metadata = { title: 'בריף אסטרטגי' };

export default async function BriefPage({ params }: { params: Promise<{ briefId: string }> }) {
  const { briefId } = await params;
  const ctx = await requireBrandContext();
  let brief;
  try {
    brief = await getStrategyBrief(ctx, briefId);
  } catch (err) {
    if (isAppError(err) && err.status === 404) notFound();
    throw err;
  }
  const content = brief.content as unknown as BriefContent;
  const packet = await buildFactsPacket(ctx);
  const factText = new Map(packet.facts.map((f) => [f.id, f.text]));
  const stale = brief.factsHash !== packet.hash;
  const canEdit = ctx.brandRole !== 'VIEWER';

  return (
    <>
      <PageHeader
        title={brief.title}
        description={`${BRIEF_KIND_LABELS[brief.kind]} · נוצר ${formatDateTime(brief.createdAt)} · ${content.provider} / ${content.model}`}
        badges={
          <>
            <Badge variant={brief.status === 'ACCEPTED' ? 'success' : brief.status === 'ARCHIVED' ? 'secondary' : 'muted'}>{brief.status === 'ACCEPTED' ? 'אומץ' : brief.status === 'ARCHIVED' ? 'ארכיון' : 'טיוטה'}</Badge>
            {content.isMock ? <Badge variant="warning">MOCK — אין ספק AI</Badge> : null}
            {stale ? <Badge variant="warning">ה-Brand Kit השתנה מאז</Badge> : null}
          </>
        }
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/app/strategy">לכל הבריפים</Link>
            </Button>
            {canEdit && brief.status !== 'ARCHIVED' ? <BriefStatusButtons briefId={brief.id} status={brief.status} /> : null}
          </div>
        }
      />

      {content.summary ? (
        <Card>
          <CardContent className="pt-6 text-sm leading-relaxed">{content.summary}</CardContent>
        </Card>
      ) : null}

      <ol className="flex flex-col gap-3">
        {content.items.map((item, i) => (
          <li key={i} className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
              <h3 className="font-medium">{item.title}</h3>
              <ConfidenceBadge level={item.confidence} />
              {item.channel ? <Badge variant="outline">{item.channel}</Badge> : null}
              {item.when ? <Badge variant="outline">{item.when}</Badge> : null}
              {item.budgetIls !== null ? <Badge variant="secondary">{item.budgetIls.toLocaleString('he-IL')} ₪</Badge> : null}
            </div>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{item.detail}</p>
            {item.kpi ? <p className="mt-2 text-sm"><span className="text-muted-foreground">מדד / פורמט:</span> {item.kpi}</p> : null}
            <div className="mt-3 text-xs">
              <span className="text-muted-foreground">בסיס נתונים: </span>
              {item.basis.length === 0 ? (
                <span className="text-muted-foreground">ללא עובדות מאושרות — הערכה בלבד</span>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {item.basis.map((id) => (
                    <li key={id} className="flex gap-2">
                      <code className="shrink-0 rounded bg-muted px-1 py-0.5" dir="ltr">
                        {id}
                      </code>
                      <span className="text-muted-foreground">{factText.get(id) ?? 'עובדה שכבר לא קיימת ב-Brand Kit'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {item.dataGap ? <p className="mt-2 rounded-md bg-warning/15 px-2 py-1 text-xs">פער מידע: {item.dataGap}</p> : null}
          </li>
        ))}
      </ol>

      {content.dataGaps.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>מה חסר כדי לדייק</CardTitle>
            <CardDescription>הסוכן לא ממציא נתונים. השלימו את אלה ב-Brand Kit וצרו בריף מחדש.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 ps-5 text-sm">
              {content.dataGaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
