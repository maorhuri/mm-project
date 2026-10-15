import type { ApprovalStatus, ApprovalType, BrandStatus, ConnectionStatus, JobStatus, KnowledgeStatus } from '@mm/db';
import { Badge } from '@/components/ui/badge';

export function BrandStatusBadge({ status }: { status: BrandStatus }) {
  const map: Record<BrandStatus, { label: string; variant: 'success' | 'muted' | 'secondary' }> = {
    ACTIVE: { label: 'פעיל', variant: 'success' },
    PAUSED: { label: 'מושהה', variant: 'muted' },
    ARCHIVED: { label: 'בארכיון', variant: 'secondary' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function IntegrationStatusBadge({ status }: { status: ConnectionStatus }) {
  const map: Record<ConnectionStatus, { label: string; variant: 'success' | 'muted' | 'destructive' | 'warning' }> = {
    CONNECTED: { label: 'מחובר', variant: 'success' },
    DISCONNECTED: { label: 'לא מחובר', variant: 'muted' },
    ERROR: { label: 'שגיאה', variant: 'destructive' },
    EXPIRED: { label: 'פג תוקף', variant: 'warning' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; variant: 'success' | 'muted' | 'destructive' | 'warning' | 'secondary' }> = {
    QUEUED: { label: 'בתור', variant: 'muted' },
    RUNNING: { label: 'רץ', variant: 'warning' },
    COMPLETED: { label: 'הושלם', variant: 'success' },
    FAILED: { label: 'נכשל', variant: 'destructive' },
    CANCELLED: { label: 'בוטל', variant: 'secondary' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const map: Record<ApprovalStatus, { label: string; variant: 'success' | 'muted' | 'destructive' | 'warning' | 'secondary' | 'default' }> = {
    PENDING: { label: 'ממתין', variant: 'warning' },
    APPROVED: { label: 'אושר', variant: 'success' },
    REJECTED: { label: 'נדחה', variant: 'destructive' },
    CHANGES_REQUESTED: { label: 'נדרשים שינויים', variant: 'secondary' },
    SCHEDULED: { label: 'מתוזמן', variant: 'default' },
    EXECUTED: { label: 'בוצע', variant: 'success' },
    FAILED: { label: 'נכשל', variant: 'destructive' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  CONTENT_POST: 'פוסט',
  VIDEO: 'סרטון',
  CONTENT_PLAN: 'לוח תוכן',
  CAMPAIGN: 'קמפיין',
  BUDGET: 'תקציב',
  AD_CHANGE: 'שינוי מודעה',
  ACTIVATION: 'הפעלה / השהיה',
  AI_HIGH_COST: 'פעולת AI יקרה',
  BRAND_KNOWLEDGE: 'מידע למותג',
  OTHER: 'אחר',
};

export function KnowledgeStatusBadge({ status }: { status: KnowledgeStatus }) {
  const map: Record<KnowledgeStatus, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
    APPROVED: { label: 'מאושר', variant: 'success' },
    PENDING: { label: 'ממתין לאישור', variant: 'warning' },
    REJECTED: { label: 'נדחה', variant: 'destructive' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
