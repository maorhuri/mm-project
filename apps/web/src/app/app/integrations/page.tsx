import { Plug } from 'lucide-react';
import { listIntegrationStatus } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { IntegrationStatusBadge } from '@/components/status-badges';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'אינטגרציות' };

const KIND_LABELS: Record<string, string> = {
  AI_TEXT: 'AI — טקסט',
  AI_IMAGE: 'AI — תמונות',
  AI_VIDEO: 'AI — וידאו',
  AI_TTS: 'AI — קריינות',
  META: 'Meta',
  GOOGLE_ADS: 'Google Ads',
  LINKEDIN: 'LinkedIn',
  GOOGLE_BUSINESS: 'Google Business',
  STORAGE: 'אחסון',
  OTHER: 'אחר',
};

export default async function IntegrationsPage() {
  const ctx = await requireBrandContext();
  const integrations = await listIntegrationStatus(ctx);

  return (
    <>
      <PageHeader title="אינטגרציות" description={`${ctx.brand.name} · חיבורים לספקי AI, Meta ו-Google. מפתחות נשמרים מוצפנים (AES-256-GCM).`} />
      <Alert variant="info">
        <Plug />
        <AlertTitle>שום אינטגרציה לא מוכרזת כפעילה לפני שנבדקה מול ה-API האמיתי</AlertTitle>
        <AlertDescription>
          החיבורים ייפתחו לפי מפת הדרכים: ספקי AI בשלב 2, וידאו וקריינות בשלב 3, Meta בשלב 4, Google Ads בשלב 5. עד אז
          הסטטוס כאן הוא &quot;לא מחובר&quot; — לא נתוני דמו.
        </AlertDescription>
      </Alert>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ספק</TableHead>
              <TableHead>סוג</TableHead>
              <TableHead>היקף</TableHead>
              <TableHead>שלב</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>סנכרון אחרון</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {integrations.map((i) => (
              <TableRow key={i.provider}>
                <TableCell className="font-medium">
                  {i.label}
                  {i.lastError ? <div className="text-xs text-destructive">{i.lastError}</div> : null}
                </TableCell>
                <TableCell>{KIND_LABELS[i.kind] ?? i.kind}</TableCell>
                <TableCell>{i.scope === 'org' ? 'ארגוני' : 'לפי מותג'}</TableCell>
                <TableCell>
                  <Badge variant="outline">שלב {i.phase}</Badge>
                </TableCell>
                <TableCell>
                  <IntegrationStatusBadge status={i.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(i.lastSyncAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
