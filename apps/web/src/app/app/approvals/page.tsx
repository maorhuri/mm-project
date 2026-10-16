import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { z } from 'zod';
import { approvalStatusSchema, listApprovals } from '@mm/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { APPROVAL_TYPE_LABELS, ApprovalStatusBadge } from '@/components/status-badges';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime, formatIls } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ApprovalDecision } from './approval-decision';

export const metadata = { title: 'מרכז אישורים' };

const FILTERS: { value: string; label: string }[] = [
  { value: 'PENDING', label: 'ממתינים' },
  { value: 'APPROVED', label: 'אושרו' },
  { value: 'REJECTED', label: 'נדחו' },
  { value: 'CHANGES_REQUESTED', label: 'לשינויים' },
  { value: '', label: 'הכול' },
];

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireBrandContext();
  // Lenient URL parsing: a bad ?status= or ?page= falls back instead of crashing the page.
  const rawStatus = first(sp.status);
  const statusParam = rawStatus === undefined ? 'PENDING' : rawStatus;
  const status = approvalStatusSchema.optional().catch(undefined).parse(statusParam || undefined);
  const page = z.coerce.number().int().min(1).catch(1).parse(first(sp.page) ?? 1);
  const result = await listApprovals(ctx, { status, page, pageSize: 30 });
  const isAdmin = ctx.brandRole === 'BRAND_ADMIN';

  return (
    <>
      <PageHeader
        title="מרכז אישורים"
        description={`${ctx.brand.name} · שום פרסום, הוצאה או פעולת AI יקרה לא מתבצעים בלי אישור כאן.`}
      />

      {!isAdmin ? (
        <Alert variant="warning">
          <BadgeCheck />
          <AlertDescription>רק מנהלי מותג יכולים לאשר או לדחות. אתם רואים את הרשימה לצפייה בלבד.</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1 self-start">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            asChild
            size="sm"
            variant="ghost"
            className={cn('h-8', statusParam === f.value && 'bg-background shadow')}
          >
            <Link href={f.value ? `/app/approvals?status=${f.value}` : '/app/approvals?status='}>{f.label}</Link>
          </Button>
        ))}
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title={statusParam === 'PENDING' ? 'אין פריטים שממתינים לאישור' : 'אין פריטים'}
          description="פריטים ייכנסו לכאן ממאגר הידע, ובהמשך מלוח התוכן, מהסרטונים ומהקמפיינים."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {result.items.map((a) => (
            <li key={a.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{APPROVAL_TYPE_LABELS[a.type]}</Badge>
                    <ApprovalStatusBadge status={a.status} />
                    {a.estimatedCostIls !== null ? <Badge variant="secondary">עלות משוערת {formatIls(Number(a.estimatedCostIls))}</Badge> : null}
                    <span className="text-xs text-muted-foreground">גרסה {a.subjectVersion}</span>
                  </div>
                  <h3 className="mt-1 font-medium">{a.title}</h3>
                  {a.summary ? <p className="mt-1 text-sm text-muted-foreground">{a.summary}</p> : null}
                  <div className="mt-2 text-xs text-muted-foreground">
                    נוצר {formatDateTime(a.createdAt)}
                    {a.requestedBy ? ` · ביקש: ${a.requestedBy.name}` : ''}
                    {a.decidedBy ? ` · הוחלט על ידי ${a.decidedBy.name} ב-${formatDateTime(a.decidedAt)}` : ''}
                    {a.decisionNote ? ` · הערה: ${a.decisionNote}` : ''}
                    {a.errorMessage ? ` · שגיאה: ${a.errorMessage}` : ''}
                  </div>
                  {a.subjectType === 'brand_knowledge' ? (
                    <Link href={`/app/brands/${ctx.brandId}?tab=knowledge`} className="mt-1 inline-block text-xs text-primary underline">
                      למאגר הידע
                    </Link>
                  ) : null}
                </div>
                {isAdmin && (a.status === 'PENDING' || a.status === 'CHANGES_REQUESTED') ? (
                  <ApprovalDecision brandId={ctx.brandId} approvalId={a.id} />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {result.total > result.pageSize ? (
        <p className="text-xs text-muted-foreground">
          מוצגים {result.items.length} מתוך {result.total}
        </p>
      ) : null}
    </>
  );
}
