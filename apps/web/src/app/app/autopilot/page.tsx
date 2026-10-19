import Link from 'next/link';
import { Bot } from 'lucide-react';
import { getAutopilot, listCharacters, resolveClipModel } from '@mm/core';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { CreativeStatusBadge, VideoStatusBadge } from '@/components/status-badges';
import { requireBrandContext } from '@/lib/brand';
import { formatDateTime } from '@/lib/format';
import { AutopilotForm } from './autopilot-form';

export const metadata = { title: 'טייס אוטומטי' };

export default async function AutopilotPage() {
  const ctx = await requireBrandContext();
  const [cfg, characters, videoModel, videos, creatives, pendingPosts] = await Promise.all([
    getAutopilot(ctx),
    listCharacters(ctx),
    resolveClipModel(ctx, 'video'),
    ctx.db.videoProject.findMany({ where: { origin: 'autopilot' }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ctx.db.creativeProject.findMany({ where: { origin: 'autopilot' }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ctx.db.scheduledPost.count({ where: { status: 'PENDING_APPROVAL' } }),
  ]);
  return (
    <>
      <PageHeader
        title="טייס אוטומטי"
        description={`${ctx.brand.name} · מנהל קריאייטיב AI שממציא בעצמו רעיונות מתוך המידע המאושר של המותג, מפיק סרטונים ופוסטים, כותב כיתובים, מתזמן בלוח התוכן ושולח לאישורך. כלום לא מתפרסם בלי אישור.`}
        badges={cfg.enabled ? <Badge variant="success">פעיל</Badge> : <Badge variant="muted">כבוי</Badge>}
      />
      {!videoModel || videoModel.isMock ? (
        <Alert variant="warning">
          <Bot />
          <AlertTitle>אין ספק וידאו מחובר</AlertTitle>
          <AlertDescription>
            בלי מפתח fal.ai הסרטונים ייצאו כתמונות עם תנועת מצלמה ולא כאנימציה. <Link href="/app/integrations" className="underline">לחיבור fal.ai</Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {pendingPosts > 0 ? (
        <Alert variant="info">
          <Bot />
          <AlertTitle>{pendingPosts} פוסטים ממתינים לאישורך</AlertTitle>
          <AlertDescription>
            <Link href="/app/approvals" className="underline">למרכז האישורים</Link> · <Link href="/app/calendar" className="underline">ללוח התוכן</Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>סרטונים שהטייס הפיק</CardTitle>
            </CardHeader>
            <CardContent>
              {videos.length === 0 ? (
                <p className="text-sm text-muted-foreground">עוד אין. הפעילו את הטייס או לחצו &quot;צור עכשיו&quot;.</p>
              ) : (
                <ul className="divide-y">
                  {videos.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/app/video/${v.id}`} className="min-w-0 truncate hover:underline">
                        {v.title}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {formatDateTime(v.createdAt)} <VideoStatusBadge status={v.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>פוסטי תמונה שהטייס הפיק</CardTitle>
            </CardHeader>
            <CardContent>
              {creatives.length === 0 ? (
                <p className="text-sm text-muted-foreground">עוד אין.</p>
              ) : (
                <ul className="divide-y">
                  {creatives.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/app/creative/${c.id}`} className="min-w-0 truncate hover:underline">
                        {c.title}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {formatDateTime(c.createdAt)} <CreativeStatusBadge status={c.status} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <AutopilotForm cfg={cfg} characters={characters.map((c) => ({ id: c.id, name: c.name }))} canAdmin={ctx.brandRole === 'BRAND_ADMIN'} canRun={ctx.brandRole !== 'VIEWER'} />
      </div>
    </>
  );
}
