import type {
  ApprovalStatus,
  ApprovalType,
  BrandStatus,
  ConnectionStatus,
  CreativeStatus,
  IdeaStatus,
  JobStatus,
  KnowledgeStatus,
  RenderStatus,
  VersionStatus,
  VideoStatus,
} from '@mm/db';
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

// ---------------------------------------------------------------------------
// Phase 2/3 — creatives, versions, renders, videos, QA
// ---------------------------------------------------------------------------

export function CreativeStatusBadge({ status }: { status: CreativeStatus }) {
  const map: Record<CreativeStatus, { label: string; variant: 'success' | 'muted' | 'destructive' | 'warning' | 'secondary' }> = {
    DRAFT: { label: 'טיוטה', variant: 'muted' },
    IN_REVIEW: { label: 'ממתין לאישור', variant: 'warning' },
    APPROVED: { label: 'אושר', variant: 'success' },
    REJECTED: { label: 'נדחה', variant: 'destructive' },
    ARCHIVED: { label: 'בארכיון', variant: 'secondary' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const map: Record<VersionStatus, { label: string; variant: 'success' | 'muted' | 'destructive' | 'secondary' | 'default' }> = {
    DRAFT: { label: 'טיוטה', variant: 'muted' },
    READY: { label: 'מוכן', variant: 'default' },
    APPROVED: { label: 'אושר', variant: 'success' },
    REJECTED: { label: 'נדחה', variant: 'destructive' },
    SUPERSEDED: { label: 'הוחלף', variant: 'secondary' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function RenderStatusBadge({ status }: { status: RenderStatus }) {
  const map: Record<RenderStatus, { label: string; variant: 'success' | 'muted' | 'destructive' | 'warning' }> = {
    PENDING: { label: 'בתור לרינדור', variant: 'muted' },
    RENDERING: { label: 'מרנדר…', variant: 'warning' },
    READY: { label: 'רונדר', variant: 'success' },
    FAILED: { label: 'רינדור נכשל', variant: 'destructive' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function VideoStatusBadge({ status }: { status: VideoStatus }) {
  const map: Record<VideoStatus, { label: string; variant: 'success' | 'muted' | 'destructive' | 'warning' | 'default' }> = {
    DRAFT: { label: 'טיוטה', variant: 'muted' },
    SCRIPTED: { label: 'יש תסריט', variant: 'default' },
    RENDERING: { label: 'מרנדר…', variant: 'warning' },
    READY: { label: 'מוכן לצפייה', variant: 'success' },
    FAILED: { label: 'נכשל', variant: 'destructive' },
    APPROVED: { label: 'אושר', variant: 'success' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function IdeaStatusBadge({ status }: { status: IdeaStatus }) {
  const map: Record<IdeaStatus, { label: string; variant: 'success' | 'muted' | 'secondary' | 'default' }> = {
    NEW: { label: 'חדש', variant: 'default' },
    SELECTED: { label: 'נבחר', variant: 'success' },
    USED: { label: 'בשימוש', variant: 'secondary' },
    DISCARDED: { label: 'נפסל', variant: 'muted' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export type QaStatus = 'PASSED' | 'WARN' | 'BLOCKED';

export function QaStatusBadge({ status }: { status: QaStatus | null | undefined }) {
  if (!status) return <Badge variant="muted">ללא QA</Badge>;
  const map: Record<QaStatus, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
    PASSED: { label: 'QA עבר', variant: 'success' },
    WARN: { label: 'QA: אזהרות', variant: 'warning' },
    BLOCKED: { label: 'QA חסם', variant: 'destructive' },
  };
  const m = map[status];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

export function ConfidenceBadge({ level }: { level: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  const map = {
    HIGH: { label: 'ביטחון גבוה', variant: 'success' as const },
    MEDIUM: { label: 'ביטחון בינוני', variant: 'warning' as const },
    LOW: { label: 'ביטחון נמוך', variant: 'muted' as const },
  };
  const m = map[level];
  return <Badge variant={m.variant}>{m.label}</Badge>;
}
