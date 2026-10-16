import { Cpu, Wallet } from 'lucide-react';
import { PROVIDER_LABELS, getAiUsage, getConfig, listAiRuns, listIntegrationStatus } from '@mm/core';
import type { AiProviderId } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime } from '@/lib/format';
import { ProbeButtons } from './probe-buttons';

export const metadata = { title: 'מנוע AI ועלויות' };

const TASK_LABELS: Record<string, string> = {
  PROVIDER_PROBE: 'בדיקת חיבור',
  CREATIVE_IDEAS: 'רעיונות',
  CREATIVE_COPY: 'טקסטים',
  CREATIVE_BACKGROUND: 'תמונות רקע',
  QA_CLAIM_JUDGE: 'שיפוט QA',
  STRATEGY_BRIEF: 'בריף אסטרטגי',
  VIDEO_SCRIPT: 'תסריט וידאו',
  TTS: 'קריינות',
  OTHER: 'אחר',
  VIDEO_CLIP: 'קליפי וידאו AI',
  AVATAR_VIDEO: 'דמויות מדברות',
  CHARACTER_IMAGE: 'ציור דמויות',
};

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'destructive' | 'muted' }> = {
  SUCCEEDED: { label: 'הצליח', variant: 'success' },
  RUNNING: { label: 'רץ', variant: 'warning' },
  FAILED: { label: 'נכשל', variant: 'destructive' },
  BLOCKED: { label: 'נחסם', variant: 'muted' },
};

const ils = (n: number) => `${n.toFixed(n < 1 ? 4 : 2)} ₪`;

export default async function AiPage() {
  const ctx = await requireBrandContext();
  const cfg = getConfig();
  const [usage, runs, integrations] = await Promise.all([getAiUsage(ctx), listAiRuns(ctx, 60), listIntegrationStatus(ctx)]);
  const connected = integrations.filter((i) => i.acceptsApiKey && i.status === 'CONNECTED').map((i) => ({ id: i.provider, label: PROVIDER_LABELS[i.provider as AiProviderId] ?? i.provider }));

  return (
    <>
      <PageHeader
        title="מנוע AI ועלויות"
        description={`${ctx.brand.name} · כל קריאה למודל נרשמת כאן עם עלותה בשקלים. תקרה חודשית ${cfg.AI_MONTHLY_BUDGET_ILS} ₪ למותג; פעולה בודדת מעל ${cfg.AI_SINGLE_RUN_MAX_ILS} ₪ דורשת אישור.`}
      />

      {!cfg.AI_ENABLED ? (
        <Alert variant="destructive">
          <Cpu />
          <AlertTitle>מנוע ה-AI מושבת</AlertTitle>
          <AlertDescription>AI_ENABLED=false בהגדרות השרת. שום קריאה למודל לא תתבצע.</AlertDescription>
        </Alert>
      ) : connected.length === 0 ? (
        <Alert variant="warning">
          <Cpu />
          <AlertTitle>אין ספק AI מחובר</AlertTitle>
          <AlertDescription>הוסיפו מפתח OpenAI / Anthropic / Google בעמוד האינטגרציות. בלי מפתח, פעולות AI במותגים שאינם דמו ייכשלו (ולא יוצג תוכן מדומה).</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`הוצאה החודש (${usage.period})`} value={ils(usage.spentIls)} hint={`${usage.pct}% מהתקרה`} icon={Wallet} tone={usage.softHit ? 'warning' : 'default'} />
        <StatCard label="נותר בתקציב" value={ils(usage.remainingIls)} hint={usage.softHit ? 'מעל 80% — הניתוב עבר למודלים חסכוניים' : `תקרה ${usage.capIls} ₪`} icon={Wallet} />
        <StatCard label="קריאות החודש" value={usage.runs} icon={Cpu} />
        <StatCard label="ספקים מחוברים" value={connected.length} hint={connected.map((c) => c.label).join(', ') || '—'} icon={Cpu} href="/app/integrations" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>לפי ספק</CardTitle>
            <CardDescription>עלות החודש בשקלים, לפי המחירון המאומת בקטלוג המודלים</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(usage.byProvider).length === 0 ? (
              <p className="text-sm text-muted-foreground">אין עדיין קריאות החודש.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {Object.entries(usage.byProvider).map(([p, v]) => (
                  <li key={p} className="flex justify-between">
                    <span>{PROVIDER_LABELS[p as AiProviderId] ?? p}</span>
                    <span className="tabular-nums">{ils(v)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>לפי סוג משימה</CardTitle>
            <CardDescription>איפה הכסף הולך</CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(usage.byTask).length === 0 ? (
              <p className="text-sm text-muted-foreground">אין עדיין קריאות החודש.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {Object.entries(usage.byTask).map(([t, v]) => (
                  <li key={t} className="flex justify-between">
                    <span>{TASK_LABELS[t] ?? t}</span>
                    <span className="tabular-nums">{ils(v)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>בדיקה חיה</CardTitle>
          <CardDescription>שולח הנחיה זעירה דרך המנוע (router → ספק → יומן) ומחזיר את התשובה. נרשם כקריאה רגילה.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProbeButtons providers={connected} />
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <EmptyState icon={Cpu} title="אין עדיין קריאות AI" description="רעיונות, טקסטים, תמונות, בריפים וקריינות יופיעו כאן עם העלות של כל קריאה." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>מתי</TableHead>
                <TableHead>משימה</TableHead>
                <TableHead>ספק / מודל</TableHead>
                <TableHead>סטטוס</TableHead>
                <TableHead>טוקנים</TableHead>
                <TableHead>עלות</TableHead>
                <TableHead>זמן</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => {
                const meta = (r.metadata ?? {}) as { label?: string | null; mock?: boolean };
                const st = STATUS[r.status] ?? { label: r.status, variant: 'muted' as const };
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                    <TableCell>
                      {TASK_LABELS[r.task] ?? r.task}
                      {meta.label ? <div className="max-w-xs truncate text-xs text-muted-foreground">{meta.label}</div> : null}
                      {r.error ? (
                        <div className="max-w-xs truncate text-xs text-destructive" title={r.error} dir="ltr">
                          {r.error}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs" dir="ltr">
                      {r.provider} · {r.modelId}
                      {meta.mock ? <Badge variant="warning" className="ms-1">MOCK</Badge> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums" dir="ltr">
                      {r.inputTokens ?? '—'} / {r.outputTokens ?? '—'}
                      {r.images ? ` · ${r.images} img` : ''}
                      {r.characters ? ` · ${r.characters} chars` : ''}
                      {r.videoSeconds ? ` · ${r.videoSeconds}s video` : ''}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {ils(r.costIlsNumber)}
                      {r.estimated ? <span className="ms-1 text-xs text-muted-foreground">(משוער)</span> : null}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{r.latencyMs ? `${r.latencyMs}ms` : '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
