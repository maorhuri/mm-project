import { Plug } from 'lucide-react';
import { getMetaAppStatus, getMetaConnection, isOrgAdmin, listIntegrationStatus } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { IntegrationStatusBadge } from '@/components/status-badges';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime } from '@/lib/format';
import { MetaPanel } from './meta-panel';
import { ProviderKeyControls } from './provider-key-controls';

export const metadata = { title: 'אינטגרציות' };

const KIND_LABELS: Record<string, string> = {
  AI_TEXT: 'AI',
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

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireBrandContext();
  const [integrations, metaApp, metaConnection] = await Promise.all([listIntegrationStatus(ctx), getMetaAppStatus(ctx.orgId), getMetaConnection(ctx)]);
  const canManage = ctx.actor.isSuperAdmin || isOrgAdmin(ctx.orgRole);
  const metaNotice = first(sp.meta) === 'connected' ? { kind: 'success' as const, text: 'המותג חובר ל-Meta' } : first(sp.meta_error) ? { kind: 'error' as const, text: String(first(sp.meta_error)) } : null;

  return (
    <>
      <PageHeader title="אינטגרציות" description={`${ctx.brand.name} · מפתחות AI הם ארגוניים (משותפים לכל המותגים) ונשמרים מוצפנים. Meta ו-Google Ads יתחברו ב-OAuth בשלבים 4–5.`} />
      <Alert variant="info">
        <Plug />
        <AlertTitle>מפתח OpenAI אחד מספיק לכל שלב 2–3 (טקסט, תמונות וקריינות)</AlertTitle>
        <AlertDescription>
          Anthropic ו-Google הם אופציונליים — ה-router ישתמש בהם לפי יכולת, איכות ומחיר כשהם מחוברים. הסטטוס &quot;מחובר&quot; ניתן רק אחרי
          בדיקה אמיתית מול ה-API.
        </AlertDescription>
      </Alert>
      <MetaPanel
        brandId={ctx.brandId}
        canManageOrg={canManage}
        canManageBrand={ctx.brandRole === 'BRAND_ADMIN'}
        app={metaApp}
        connection={{ ...metaConnection, status: metaConnection.status }}
        notice={metaNotice}
      />
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ספק</TableHead>
              <TableHead>סוג</TableHead>
              <TableHead>שלב</TableHead>
              <TableHead>סטטוס</TableHead>
              <TableHead>בדיקה אחרונה</TableHead>
              <TableHead className="w-72">מפתח</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {integrations.filter((i) => i.provider !== 'meta').map((i) => (
              <TableRow key={i.provider}>
                <TableCell className="font-medium">
                  {i.label}
                  {i.lastError ? (
                    <div className="max-w-md truncate text-xs text-destructive" title={i.lastError} dir="ltr">
                      {i.lastError}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell>{KIND_LABELS[i.kind] ?? i.kind}</TableCell>
                <TableCell>
                  <Badge variant="outline">שלב {i.phase}</Badge>
                </TableCell>
                <TableCell>
                  <IntegrationStatusBadge status={i.status} />
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(i.lastSyncAt)}</TableCell>
                <TableCell>
                  {i.acceptsApiKey ? (
                    <ProviderKeyControls provider={i.provider} hasKey={i.status !== 'DISCONNECTED'} keyHint={i.keyHint} canManage={canManage} />
                  ) : (
                    <span className="text-xs text-muted-foreground">OAuth / ספק — בשלב {i.phase}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
