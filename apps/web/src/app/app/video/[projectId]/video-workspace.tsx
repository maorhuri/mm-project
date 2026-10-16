'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clapperboard, Download, Film, Save, Send, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ASPECTS } from '@mm/core/creative';
import type { VideoCostEstimate } from '@mm/core';
import type { VideoProject, VideoScene } from '@mm/db';
import { MediaPicker, mediaUrl } from '@/components/media-picker';
import type { PickerImage } from '@/components/media-picker';
import { QaPanel } from '@/components/qa-panel';
import type { QaReportDto } from '@/components/qa-panel';
import { VideoStatusBadge } from '@/components/status-badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { callAction, formKey, formValue, idleState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';
import { deleteVideoProjectAction, generateScriptAction, requestVideoApprovalAction, startRenderAction, updateSceneAction } from '../actions';

type ProjectDto = Omit<VideoProject, 'costIls'> & { costIls: number };

interface Props {
  brandId: string;
  canEdit: boolean;
  project: ProjectDto;
  scenes: VideoScene[];
  product: { id: string; name: string } | null;
  estimate: VideoCostEstimate;
  images: PickerImage[];
}

const ils = (n: number) => `${n.toFixed(n < 1 ? 3 : 2)} ₪`;

export function VideoWorkspace({ brandId, canEdit, project, scenes, product, estimate, images }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const staleRender = project.status === 'RENDERING' && Date.now() - new Date(project.updatedAt).getTime() > 30 * 60_000;
  const rendering = project.status === 'RENDERING' && !staleRender;

  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [rendering, router]);

  const run = (promise: Promise<{ status: string; message?: string }>, after?: () => void) =>
    startTransition(async () => {
      const res = await callAction(promise as Promise<never>);
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        after?.();
        router.refresh();
      }
    });

  const qa = project.qa as unknown as QaReportDto | null;
  const canRender = canEdit && scenes.length > 0 && !rendering && qa?.status !== 'BLOCKED';
  const output = project.outputMediaId ? mediaUrl(brandId, project.outputMediaId) : null;
  const srtHref = project.subtitlesSrt ? `data:text/plain;charset=utf-8,${encodeURIComponent(project.subtitlesSrt)}` : null;

  return (
    <>
      <PageHeader
        title={project.title}
        description={`${ASPECTS[project.aspect].label} · קול ${project.voice}${product ? ` · ${product.name}` : ''}${project.goal ? ` · ${project.goal}` : ''}`}
        badges={<VideoStatusBadge status={project.status} />}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/app/video">לכל הסרטונים</Link>
            </Button>
            {canEdit && !rendering ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm('למחוק את פרויקט הווידאו?') && run(deleteVideoProjectAction(project.id), () => router.push('/app/video'))}>
                <Trash2 />
              </Button>
            ) : null}
          </div>
        }
      />

      {staleRender ? (
        <Alert variant="warning">
          <Film />
          <AlertTitle>הרינדור לא מדווח התקדמות כבר יותר מ-30 דקות</AlertTitle>
          <AlertDescription>ייתכן שה-worker הופסק. אפשר להפעיל רינדור מחדש.</AlertDescription>
        </Alert>
      ) : null}
      {rendering ? (
        <Alert variant="info">
          <Film className="animate-pulse" />
          <AlertTitle>
            מרנדר… {project.renderProgress}% — {project.renderStep}
          </AlertTitle>
          <AlertDescription>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${project.renderProgress}%` }} />
            </div>
          </AlertDescription>
        </Alert>
      ) : project.status === 'FAILED' && project.renderError ? (
        <Alert variant="destructive">
          <Film />
          <AlertTitle>הרינדור נכשל</AlertTitle>
          <AlertDescription dir="ltr" className="text-start">
            {project.renderError}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          {output ? (
            <Card>
              <CardHeader>
                <CardTitle>הסרטון</CardTitle>
                <CardDescription>
                  {project.durationMs ? `${(project.durationMs / 1000).toFixed(1)} שניות · ` : ''}עלות בפועל {ils(project.costIls)} · רונדר {formatDateTime(project.updatedAt)}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <video controls playsInline src={output} className="max-h-[70vh] w-full rounded-lg bg-black" style={{ aspectRatio: `${ASPECTS[project.aspect].width} / ${ASPECTS[project.aspect].height}` }} />
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <a href={output} download>
                      <Download /> MP4
                    </a>
                  </Button>
                  {srtHref ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={srtHref} download={`${project.title}.srt`}>
                        <Download /> כתוביות SRT
                      </a>
                    </Button>
                  ) : null}
                  {canEdit && project.status === 'READY' ? (
                    <Button size="sm" disabled={pending} onClick={() => run(requestVideoApprovalAction(project.id))}>
                      <Send /> שליחה לאישור
                    </Button>
                  ) : null}
                  {project.approvalId ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href="/app/approvals">למרכז האישורים</Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {canEdit && !rendering ? <ScriptForm projectId={project.id} hasScenes={scenes.length > 0} /> : null}

          {scenes.length === 0 ? (
            <EmptyState icon={Clapperboard} title="אין עדיין סצנות" description="בקשו תסריט מה-AI. כל סצנה = משפט קריינות + טקסט על המסך + ויז'ואל." />
          ) : (
            <ol className="flex flex-col gap-3">
              {scenes.map((s) => (
                <SceneCard key={s.id} brandId={brandId} projectId={project.id} scene={s} images={images} canEdit={canEdit && !rendering} />
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>עלות משוערת לרינדור</CardTitle>
              <CardDescription>לפי מחירון הקטלוג המאומת; העלות בפועל נרשמת ביומן ה-AI.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between">
                <span>קריינות ({estimate.characters} תווים)</span>
                <span className="tabular-nums">{ils(estimate.ttsIls)}</span>
              </div>
              <div className="flex justify-between">
                <span>תמונות AI ({estimate.aiImages})</span>
                <span className="tabular-nums">{ils(estimate.imagesIls)}</span>
              </div>
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>סה״כ</span>
                <span className="tabular-nums">{ils(estimate.totalIls)}</span>
              </div>
              <p className="text-xs text-muted-foreground">אורך משוער ≈ {estimate.estimatedSeconds} שניות. כרטיסיות ממותגות ורינדור Chromium/FFmpeg — ללא עלות ספק.</p>
              {canRender ? (
                <Button className="mt-2" disabled={pending} onClick={() => run(startRenderAction(project.id))}>
                  <Film /> {project.status === 'READY' || project.status === 'APPROVED' ? 'רינדור מחדש' : 'רינדור הסרטון'}
                </Button>
              ) : null}
              {qa?.status === 'BLOCKED' ? <p className="text-xs text-destructive">בקרת האיכות חסמה את התסריט — תקנו את הסצנות המסומנות.</p> : null}
            </CardContent>
          </Card>
          <QaPanel report={qa} />
          <Card>
            <CardHeader>
              <CardTitle>איך זה עובד</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              <ol className="list-decimal space-y-1 ps-4">
                <li>תסריט מה-AI על בסיס העובדות המאושרות בלבד, עם בקרת איכות.</li>
                <li>קריינות לכל סצנה (OpenAI TTS, קול לבחירה).</li>
                <li>ויז&apos;ואל: כרטיסייה ממותגת, תמונה מהספרייה או תמונת AI.</li>
                <li>הרכבה ב-FFmpeg עם כתוביות עבריות צרובות (SRT לצד הקובץ).</li>
                <li>צפייה, הורדה ושליחה לאישור.</li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function ScriptForm({ projectId, hasScenes }: { projectId: string; hasScenes: boolean }) {
  const [state, action] = useActionState(generateScriptAction.bind(null, projectId), idleState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
    }
  }, [state, router]);
  return (
    <form
      key={formKey(state)}
      action={action}
      className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[120px_140px_1fr_auto]"
      onSubmit={(e) => {
        if (hasScenes && !confirm('תסריט חדש יחליף את כל הסצנות הקיימות. להמשיך?')) e.preventDefault();
      }}
    >
      <Field label="סצנות" name="sceneCount" error={fieldError(state, 'sceneCount')}>
        <Select id="sceneCount" name="sceneCount" defaultValue={formValue(state, 'sceneCount', '5')}>
          {[2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="אורך יעד (שנ')" name="targetSeconds" error={fieldError(state, 'targetSeconds')}>
        <Input id="targetSeconds" name="targetSeconds" type="number" min={10} max={90} defaultValue={formValue(state, 'targetSeconds', '30')} />
      </Field>
      <Field label="הנחיות (אופציונלי)" name="extra" error={fieldError(state, 'extra')}>
        <Input id="extra" name="extra" defaultValue={formValue(state, 'extra', '')} placeholder="למשל: להתחיל בשאלה, להדגיש תמיכה 24/7 רק אם זו עובדה מאושרת" />
      </Field>
      <div className="flex items-end">
        <SubmitButton pendingText="כותב תסריט…">
          <Sparkles /> {hasScenes ? 'תסריט חדש' : 'תסריט מה-AI'}
        </SubmitButton>
      </div>
      <div className="md:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function SceneCard({ brandId, projectId, scene, images, canEdit }: { brandId: string; projectId: string; scene: VideoScene; images: PickerImage[]; canEdit: boolean }) {
  const [state, action] = useActionState(updateSceneAction.bind(null, projectId, scene.id), idleState);
  const [kind, setKind] = useState<string>(scene.visualKind);
  const [mediaId, setMediaId] = useState<string | null>(scene.mediaId);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
    }
  }, [state, router]);
  const frame = scene.renderedImageId ? mediaUrl(brandId, scene.renderedImageId) : null;
  return (
    <li className="rounded-xl border bg-card p-4">
      <form key={formKey(state)} action={action} className="grid gap-3 md:grid-cols-[160px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{scene.order}</span>
            {scene.durationMs ? <Badge variant="outline">{(scene.durationMs / 1000).toFixed(1)} שנ&apos;</Badge> : null}
          </div>
          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted/40">
            {frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame} alt={`סצנה ${scene.order}`} className="size-full object-contain" />
            ) : (
              <Clapperboard className="size-5 text-muted-foreground" />
            )}
          </div>
          {scene.audioMediaId ? <audio controls src={mediaUrl(brandId, scene.audioMediaId)} className="w-full" /> : null}
        </div>
        <fieldset disabled={!canEdit} className="flex flex-col gap-3">
          <Field label="קריינות" name="narration" error={fieldError(state, 'narration')}>
            <Textarea id={`narration-${scene.id}`} name="narration" rows={2} required maxLength={600} defaultValue={formValue(state, 'narration', scene.narration)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="טקסט על המסך" name="onScreenText" error={fieldError(state, 'onScreenText')}>
              <Input id={`ost-${scene.id}`} name="onScreenText" maxLength={120} defaultValue={formValue(state, 'onScreenText', scene.onScreenText ?? '')} />
            </Field>
            <Field label="ויז'ואל" name="visualKind" error={fieldError(state, 'visualKind')}>
              <Select id={`kind-${scene.id}`} name="visualKind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="CARD">כרטיסייה ממותגת (חינם)</option>
                <option value="MEDIA">תמונה מהספרייה</option>
                <option value="AI_IMAGE">תמונת AI (בתשלום)</option>
              </Select>
            </Field>
          </div>
          {kind === 'MEDIA' ? (
            <div>
              <input type="hidden" name="mediaId" value={mediaId ?? ''} />
              <MediaPicker brandId={brandId} images={images} value={mediaId} onChange={setMediaId} />
              {fieldError(state, 'mediaId') ? <p className="mt-1 text-xs text-destructive">{fieldError(state, 'mediaId')}</p> : null}
            </div>
          ) : null}
          {kind === 'AI_IMAGE' ? (
            <Field label="תיאור התמונה (אנגלית עדיף, בלי טקסט)" name="visualPrompt" error={fieldError(state, 'visualPrompt')}>
              <Input id={`vp-${scene.id}`} name="visualPrompt" maxLength={600} defaultValue={formValue(state, 'visualPrompt', scene.visualPrompt ?? '')} />
            </Field>
          ) : (
            <input type="hidden" name="visualPrompt" value={scene.visualPrompt ?? ''} />
          )}
          <FormMessage state={state} />
          {canEdit ? (
            <div>
              <SubmitButton size="sm" variant="outline" pendingText="שומר…">
                <Save /> שמירת סצנה
              </SubmitButton>
            </div>
          ) : null}
        </fieldset>
      </form>
    </li>
  );
}
