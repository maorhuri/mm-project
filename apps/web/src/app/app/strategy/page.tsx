import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { BRIEF_KIND_LABELS, buildFactsPacket, listStrategyBriefs } from '@mm/core';
import type { BriefContent } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime } from '@/lib/format';
import { GenerateBriefForm } from './generate-brief-form';

export const metadata = { title: 'אסטרטגיית AI' };

const STATUS: Record<string, { label: string; variant: 'muted' | 'success' | 'secondary' }> = {
  DRAFT: { label: 'טיוטה', variant: 'muted' },
  ACCEPTED: { label: 'אומץ', variant: 'success' },
  ARCHIVED: { label: 'ארכיון', variant: 'secondary' },
};

export default async function StrategyPage() {
  const ctx = await requireBrandContext();
  const [briefs, packet] = await Promise.all([listStrategyBriefs(ctx), buildFactsPacket(ctx)]);
  const canEdit = ctx.brandRole !== 'VIEWER';
  const kinds = (Object.keys(BRIEF_KIND_LABELS) as (keyof typeof BRIEF_KIND_LABELS)[]).map((k) => ({ value: k, label: BRIEF_KIND_LABELS[k] }));

  return (
    <>
      <PageHeader title="אסטרטגיית AI" description={`${ctx.brand.name} · כל המלצה מצטטת את העובדות המאושרות שעליהן היא נשענת ומסומנת ברמת ביטחון. מה שחסר במידע — נרשם כפער, לא מומצא.`} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>בריף חדש</CardTitle>
            <CardDescription>
              הסוכן קורא {packet.facts.length} עובדות מאושרות ({packet.productCount} מוצרים, {packet.knowledgeCount} פריטי ידע).
              {packet.facts.length < 5 ? ' כדאי למלא את ה-Brand Kit לפני כן.' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>{canEdit ? <GenerateBriefForm kinds={kinds} /> : <p className="text-sm text-muted-foreground">צפייה בלבד.</p>}</CardContent>
        </Card>
        <div className="flex flex-col gap-3 lg:col-span-2">
          {packet.facts.length < 5 ? (
            <Alert variant="warning">
              <Sparkles />
              <AlertTitle>מעט מידע מאושר</AlertTitle>
              <AlertDescription>
                הסוכן עובד רק על עובדות מאושרות. הוסיפו מוצרים, קהלים, טענות מותרות וידע מאושר ב-<Link href={`/app/brands/${ctx.brandId}`} className="underline">Brand Kit</Link>.
              </AlertDescription>
            </Alert>
          ) : null}
          {briefs.length === 0 ? (
            <EmptyState icon={Sparkles} title="אין עדיין בריפים" description="צרו בריף יעדים, קהלים, הצעת קמפיינים או תוכנית תוכן." />
          ) : (
            <ul className="flex flex-col gap-3">
              {briefs.map((b) => {
                const content = b.content as unknown as BriefContent;
                const st = STATUS[b.status] ?? STATUS.DRAFT!;
                return (
                  <li key={b.id}>
                    <Link href={`/app/strategy/${b.id}`} className="block rounded-xl border bg-card p-4 transition-colors hover:border-primary">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{BRIEF_KIND_LABELS[b.kind]}</Badge>
                        <Badge variant={st.variant}>{st.label}</Badge>
                        {content.isMock ? <Badge variant="warning">MOCK</Badge> : null}
                        <span className="text-xs text-muted-foreground">{formatDateTime(b.createdAt)}</span>
                      </div>
                      <h3 className="mt-1 font-medium">{b.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{content.summary}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {content.items.length} פריטים · {content.dataGaps.length} פערי מידע · {content.model}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
