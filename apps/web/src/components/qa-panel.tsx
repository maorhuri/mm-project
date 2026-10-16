import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { QaStatusBadge } from '@/components/status-badges';
import type { QaStatus } from '@/components/status-badges';

export interface QaFindingDto {
  rule: string;
  severity: 'BLOCK' | 'WARN';
  field?: string;
  text: string;
  reason: string;
}

export interface QaReportDto {
  status: QaStatus;
  findings: QaFindingDto[];
  ranAt?: string;
}

const RULE_LABELS: Record<string, string> = {
  forbidden_claim: 'טענה אסורה',
  unverified_price: 'מחיר לא מאומת',
  unverified_percent: 'אחוז לא מאומת',
  superlative: 'סופרלטיב / הבטחה',
  unverified_number: 'מספר לא מאומת',
  uncited_claim: 'משפט עובדתי ללא מקור',
  unknown_fact_ref: 'מזהה עובדה לא קיים',
};

/** Deterministic QA findings for copy — the same rules run before storage and in the editor. */
export function QaPanel({ report, compact = false }: { report: QaReportDto | null | undefined; compact?: boolean }) {
  if (!report) return null;
  const Icon = report.status === 'PASSED' ? ShieldCheck : ShieldAlert;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">בקרת איכות</span>
        <QaStatusBadge status={report.status} />
        {!compact && report.status === 'PASSED' ? <span className="text-xs text-muted-foreground">לא נמצאו מחירים, טענות או מספרים שאינם במידע המאושר.</span> : null}
      </div>
      {report.findings.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {report.findings.map((f, i) => (
            <li key={`${f.rule}-${i}`} className="flex flex-wrap items-center gap-2">
              <Badge variant={f.severity === 'BLOCK' ? 'destructive' : 'warning'}>{f.severity === 'BLOCK' ? 'חוסם' : 'אזהרה'}</Badge>
              <span className="font-medium">{RULE_LABELS[f.rule] ?? f.rule}</span>
              {f.field ? <span className="text-xs text-muted-foreground">({f.field})</span> : null}
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{f.text}</span>
              <span className="text-xs text-muted-foreground">{f.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
