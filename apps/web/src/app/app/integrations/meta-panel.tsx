'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Facebook, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import type { AdAccount } from '@mm/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { IntegrationStatusBadge } from '@/components/status-badges';
import { callAction, formKey, formValue, idleState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';
import { disconnectMetaAction, removeMetaAppAction, saveMetaAppAction, selectMetaAssetsAction, syncMetaAction } from './actions';

export interface MetaPanelProps {
  brandId: string;
  canManageOrg: boolean;
  canManageBrand: boolean;
  app: { configured: boolean; appId: string | null; configId: string | null; redirectUri: string; updatedAt: Date | null };
  connection: {
    connected: boolean;
    status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR' | 'EXPIRED';
    userName: string | null;
    tokenType: string | null;
    scopes: string[];
    expiresAt: Date | null;
    lastSyncAt: Date | null;
    lastError: string | null;
    adAccounts: AdAccount[];
    pages: { id: string; name: string; instagram: { id: string; username: string | null } | null }[];
    selected: { adAccountId?: string | null; pageId?: string | null; instagramId?: string | null };
  };
  notice: { kind: 'success' | 'error'; text: string } | null;
}

export function MetaPanel({ brandId, canManageOrg, canManageBrand, app, connection, notice }: MetaPanelProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (notice) (notice.kind === 'success' ? toast.success : toast.error)(notice.text);
  }, [notice]);
  const run = (promise: Promise<{ status: string; message?: string }>) =>
    startTransition(async () => {
      const res = await callAction(promise as Promise<never>);
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        router.refresh();
      }
    });
  const selectedAccount = connection.adAccounts.find((a) => a.isSelected) ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Facebook className="size-5" />
          <CardTitle>Meta — פייסבוק / אינסטגרם / מודעות</CardTitle>
          <IntegrationStatusBadge status={connection.status} />
          <Badge variant="outline">קריאה בלבד</Badge>
        </div>
        <CardDescription>
          התחברות ב-SSO (Facebook Login for Business) לחשבון הפייסבוק של המותג. בשלב זה המערכת רק קוראת: קמפיינים, סטים, מודעות וביצועים. שום שינוי או הוצאה לא מתבצעים.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">1. אפליקציית Meta (ארגוני)</h3>
          {canManageOrg ? <MetaAppForm app={app} /> : <p className="text-sm text-muted-foreground">{app.configured ? `מוגדר (App ID ${app.appId})` : 'לא הוגדר — רק מנהל ארגון יכול להזין.'}</p>}
          <div className="rounded-md bg-muted/40 p-3 text-xs">
            <div className="font-medium">הגדרות נדרשות באפליקציה (developers.facebook.com):</div>
            <ol className="mt-1 list-decimal space-y-1 ps-4 text-muted-foreground">
              <li>
                Facebook Login for Business → Settings → <b>Valid OAuth Redirect URIs</b>: <code dir="ltr" className="select-all rounded bg-background px-1">{app.redirectUri}</code>
              </li>
              <li>Facebook Login for Business → Configurations → צרו Configuration עם הרשאות ads_read, ads_management, business_management, pages_show_list, pages_read_engagement והעתיקו את ה-Configuration ID לכאן.</li>
              <li>במצב Development רק מנהלי/מפתחי האפליקציה יכולים להתחבר — זה מספיק לבדיקות עם הנכסים שלכם.</li>
            </ol>
          </div>
          {canManageOrg && app.configured ? (
            <Button variant="ghost" size="sm" className="w-fit" disabled={pending} onClick={() => confirm('להסיר את פרטי האפליקציה? חיבורי המותגים יפסיקו לעבוד.') && run(removeMetaAppAction())}>
              <Trash2 /> הסרת פרטי האפליקציה
            </Button>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">2. חיבור המותג הנוכחי</h3>
          {!connection.connected ? (
            <>
              <p className="text-sm text-muted-foreground">{app.configured ? 'התחברו עם חשבון הפייסבוק שמנהל את העמוד וחשבון המודעות של המותג.' : 'קודם יש להגדיר את אפליקציית Meta.'}</p>
              {canManageBrand ? (
                <Button asChild disabled={!app.configured}>
                  <a href={app.configured ? `/api/v1/brands/${brandId}/integrations/meta/connect?returnTo=/app/integrations` : '#'} aria-disabled={!app.configured}>
                    <Facebook /> התחברות עם פייסבוק
                  </a>
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <div className="text-sm">
                מחובר כ-<b>{connection.userName ?? '—'}</b>
                {connection.tokenType ? <span className="text-muted-foreground"> · טוקן {connection.tokenType}</span> : null}
                {connection.expiresAt ? <span className="text-muted-foreground"> · תוקף עד {formatDateTime(connection.expiresAt)}</span> : <span className="text-muted-foreground"> · ללא תפוגה</span>}
              </div>
              {connection.scopes.length ? (
                <div className="flex flex-wrap gap-1">
                  {connection.scopes.map((s) => (
                    <Badge key={s} variant="secondary" className="font-mono text-[10px]">
                      {s}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {connection.lastError ? (
                <p className="text-xs text-destructive" dir="ltr">
                  {connection.lastError}
                </p>
              ) : null}
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">חשבון מודעות ({connection.adAccounts.length})</span>
                <Select
                  value={selectedAccount?.id ?? ''}
                  disabled={!canManageBrand || pending}
                  onChange={(e) => e.target.value && run(selectMetaAssetsAction(e.target.value, null))}
                >
                  <option value="">— בחרו חשבון —</option>
                  {connection.adAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.externalId}
                      {a.currency ? `, ${a.currency}` : ''})
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-muted-foreground">עמוד פייסבוק / אינסטגרם ({connection.pages.length})</span>
                <Select value={connection.selected.pageId ?? ''} disabled={!canManageBrand || pending} onChange={(e) => run(selectMetaAssetsAction(null, e.target.value))}>
                  <option value="">— ללא —</option>
                  {connection.pages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.instagram ? ` · IG @${p.instagram.username ?? p.instagram.id}` : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={pending || !selectedAccount} onClick={() => run(syncMetaAction(30))}>
                  <RefreshCw /> סנכרון עכשיו (30 יום)
                </Button>
                {canManageBrand ? (
                  <Button asChild size="sm" variant="outline">
                    <a href={`/api/v1/brands/${brandId}/integrations/meta/connect?returnTo=/app/integrations`}>התחברות מחדש</a>
                  </Button>
                ) : null}
                {canManageBrand ? (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm('לנתק את החיבור ל-Meta?') && run(disconnectMetaAction())}>
                    <Unplug /> ניתוק
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">סנכרון אחרון: {formatDateTime(connection.lastSyncAt)} · סנכרון אוטומטי כל לילה ב-05:30.</p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MetaAppForm({ app }: { app: MetaPanelProps['app'] }) {
  const [state, action] = useActionState(saveMetaAppAction, idleState);
  const [show, setShow] = useState(!app.configured);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      setShow(false);
      router.refresh();
    }
  }, [state, router]);
  if (!show) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="success">מוגדר</Badge>
        <span dir="ltr">App ID {app.appId}</span>
        {app.configId ? <span dir="ltr">· Config {app.configId}</span> : <Badge variant="warning">ללא Configuration ID — יישלחו scopes</Badge>}
        <Button size="sm" variant="outline" onClick={() => setShow(true)}>
          עריכה
        </Button>
      </div>
    );
  }
  return (
    <form key={formKey(state)} action={action} className="grid gap-3 sm:grid-cols-2">
      <Field label="App ID" name="appId" error={fieldError(state, 'appId')}>
        <Input id="appId" name="appId" dir="ltr" inputMode="numeric" required defaultValue={formValue(state, 'appId', app.appId ?? '')} />
      </Field>
      <Field label="Configuration ID (Login for Business)" name="configId" error={fieldError(state, 'configId')} hint="אופציונלי אך מומלץ">
        <Input id="configId" name="configId" dir="ltr" inputMode="numeric" defaultValue={formValue(state, 'configId', app.configId ?? '')} />
      </Field>
      <Field label="App Secret" name="appSecret" error={fieldError(state, 'appSecret')} className="sm:col-span-2" hint={app.configured ? 'השאירו ריק כדי לשמור על הסוד הקיים' : 'נשמר מוצפן, לא מוצג שוב'}>
        <Input id="appSecret" name="appSecret" type="password" dir="ltr" autoComplete="off" required={!app.configured} />
      </Field>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <SubmitButton size="sm" pendingText="שומר…">
          שמירה
        </SubmitButton>
        {app.configured ? (
          <Button type="button" size="sm" variant="ghost" onClick={() => setShow(false)}>
            ביטול
          </Button>
        ) : null}
      </div>
    </form>
  );
}
