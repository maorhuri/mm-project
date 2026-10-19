'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Clapperboard, Download, Film, Save, Send, Settings2, Sparkles, Trash2, UserRound } from 'lucide-react';
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
import { callAction, formChecked, formKey, formValue, idleState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';
import { VOICES } from '../create-video-dialog';
import { deleteVideoProjectAction, generateScriptAction, requestVideoApprovalAction, startRenderAction, updateSceneAction, updateSettingsAction } from '../actions';

type ProjectDto = Omit<VideoProject, 'costIls' | 'estimateIls'> & { costIls: number; estimateIls: number | null };
export interface CharacterOption {
  id: string;
  name: string;
  imageMediaId: string;
  voice: string;
}

interface Props {
  brandId: string;
  canEdit: boolean;
  project: ProjectDto;
  scenes: VideoScene[];
  product: { id: string; name: string } | null;
  estimate: VideoCostEstimate;
  characters: CharacterOption[];
  images: PickerImage[];
  videos: PickerImage[];
  musicOptions: { id: string; title: string }[];
  singleRunCapIls: number;
}

const ils = (n: number) => `${n.toFixed(n < 1 ? 3 : 2)} ₪`;

const KIND_OPTIONS: { value: VideoScene['visualKind']; label: string }[] = [
  { value: 'CARD', label: 'כרטיסייה ממותגת (חינם)' },
  { value: 'MEDIA', label: 'תמונה מהספרייה' },
  { value: 'AI_IMAGE', label: 'תמונת AI (זול)' },
  { value: 'MEDIA_VIDEO', label: 'וידאו מהספרייה' },
  { value: 'AI_VIDEO', label: 'וידאו AI — תנועה אמיתית (בתשלום לפי שנייה)' },
  { value: 'AVATAR', label: 'דמות מדברת — סנכרון שפתיים (בתשלום לפי שנייה)' },
];

const TIERS = [
    { value: 'balanced', label: 'מאוזן — Kling 3.0 Standard' },
  { value: 'flagship', label: 'פרימיום לפרסום — Kling 3.0 Pro' },
];

export function VideoWorkspace({ brandId, canEdit, project, scenes, product, estimate, characters, images, videos, musicOptions, singleRunCapIls }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const staleRender = project.status === 'RENDERING' && Date.now() - new Date(project.updatedAt).getTime() > 30 * 60_000;
  const rendering = project.status === 'RENDERING' && !staleRender;

  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [rendering, router]);

  const run = (promise: Promise<{ status: string; message?: string; data?: unknown }>, after?: () => void) =>
    startTransition(async () => {
      const res = await callAction(promise as Promise<never>);
      if (res.status === 'error') toast.error(res.message);
      else {
        if ((res.data as { approvalRequired?: boolean } | undefined)?.approvalRequired) toast.info(res.message, { duration: 10_000 });
        else toast.success(res.message);
        after?.();
        router.refresh();
      }
    });

  const qa = project.qa as unknown as QaReportDto | null;
  const canRender = canEdit && scenes.length > 0 && !rendering && qa?.status !== 'BLOCKED' && !estimate.videoProviderMissing && !estimate.avatarProviderMissing;
  const output = project.outputMediaId ? mediaUrl(brandId, project.outputMediaId) : null;
  const srtHref = project.subtitlesSrt ? `data:text/plain;charset=utf-8,${encodeURIComponent(project.subtitlesSrt)}` : null;
  const ratio = `${ASPECTS[project.aspect].width} / ${ASPECTS[project.aspect].height}`;

  return (
    <>
      <PageHeader
        title={project.title}
        description={`${ASPECTS[project.aspect].label} · קריין ${project.voice}${product ? ` · ${product.name}` : ''}${project.goal ? ` · ${project.goal}` : ''}`}
        badges={<VideoStatusBadge status={project.status} />}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/app/video/characters">
                <UserRound /> דמויות המותג
              </Link>
            </Button>
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
            <p className="mt-2 text-xs text-muted-foreground">קליפים של וידאו AI ודמויות מדברות נוצרים אצל הספק ולוקחים בדרך כלל 1–5 דקות לכל סצנה. אפשר לעזוב את העמוד — הרינדור ממשיך ברקע.</p>
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
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
                <video controls playsInline src={output} className="mx-auto max-h-[75vh] rounded-lg bg-black" style={{ aspectRatio: ratio }} />
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
                  {canEdit ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/app/calendar?source=video_project:${project.id}`}>
                        <BadgeCheck /> תזמון לפרסום
                      </Link>
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
            <EmptyState icon={Clapperboard} title="אין עדיין סצנות" description="בקשו תסריט מה-AI. כל סצנה = משפט קריינות + טקסט על המסך + ויז'ואל: תמונה, וידאו AI או דמות מדברת." />
          ) : (
            <ol className="flex flex-col gap-3">
              {scenes.map((s) => (
                <SceneCard key={s.id} brandId={brandId} projectId={project.id} scene={s} images={images} videos={videos} characters={characters} canEdit={canEdit && !rendering} ratio={ratio} />
              ))}
            </ol>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>עלות משוערת לרינדור</CardTitle>
              <CardDescription>לפי המחירון המאומת בקטלוג; העלות בפועל נרשמת ביומן ה-AI. סצנות שלא השתנו לא משולמות שוב.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <Row label={`קריינות (${estimate.characters} תווים)`} value={ils(estimate.ttsIls)} />
              <Row label={`תמונות AI (${estimate.aiImages})`} value={ils(estimate.imagesIls)} />
              {estimate.videoSeconds > 0 || estimate.videoModel ? <Row label={`וידאו AI (${estimate.videoSeconds} שנ'${estimate.videoModel ? ` · ${estimate.videoModel}` : ''})`} value={ils(estimate.videoIls)} /> : null}
              {estimate.avatarSeconds > 0 || estimate.avatarModel ? <Row label={`דמות מדברת (${estimate.avatarSeconds} שנ'${estimate.avatarModel ? ` · ${estimate.avatarModel}` : ''})`} value={ils(estimate.avatarIls)} /> : null}
              {estimate.cachedClips > 0 ? <p className="text-xs text-muted-foreground">{estimate.cachedClips} קליפים קיימים ישמשו שוב ללא עלות.</p> : null}
              <div className="flex justify-between border-t pt-1 font-medium">
                <span>סה״כ</span>
                <span className="tabular-nums">{ils(estimate.totalIls)}</span>
              </div>
              <p className="text-xs text-muted-foreground">אורך משוער ≈ {estimate.estimatedSeconds} שניות.</p>
              {estimate.mockClips ? <Badge variant="warning" className="w-fit">קליפי AI יהיו מוק (אין ספק מחובר בסביבה הזו)</Badge> : null}
              {estimate.needsApproval ? (
                <p className="rounded-md bg-warning/15 px-2 py-1 text-xs">
                  <BadgeCheck className="inline size-3.5" /> מעל {singleRunCapIls} ₪ — לחיצה על רינדור תשלח בקשת אישור, והרינדור יתחיל אוטומטית עם האישור.
                </p>
              ) : null}
              {estimate.videoProviderMissing ? (
                <p className="text-xs text-destructive">
                  לסצנות &quot;וידאו AI&quot; נדרש מפתח fal.ai (Kling). <Link href="/app/integrations" className="underline">לאינטגרציות</Link>
                </p>
              ) : null}
              {estimate.avatarProviderMissing ? (
                <p className="text-xs text-destructive">
                  לסצנות &quot;דמות מדברת&quot; נדרש ספק lip-sync מחובר. <Link href="/app/integrations" className="underline">לאינטגרציות</Link>
                </p>
              ) : null}
              {canRender ? (
                <Button className="mt-2" disabled={pending} onClick={() => run(startRenderAction(project.id))}>
                  <Film /> {project.status === 'READY' || project.status === 'APPROVED' ? 'רינדור מחדש' : 'רינדור הסרטון'}
                </Button>
              ) : null}
              {qa?.status === 'BLOCKED' ? <p className="text-xs text-destructive">בקרת האיכות חסמה את התסריט — תקנו את הסצנות המסומנות.</p> : null}
            </CardContent>
          </Card>
          {canEdit && !rendering ? <SettingsForm brandId={brandId} project={project} musicOptions={musicOptions} /> : null}
          <QaPanel report={qa} />
          <Card>
            <CardHeader>
              <CardTitle>סוגי ויז&apos;ואל</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              <ul className="space-y-1.5">
                <li>
                  <b>כרטיסייה / תמונה / תמונת AI</b> — סטילס עם תנועת מצלמה עדינה (זום) והטקסט קבוע מעליה.
                </li>
                <li>
                  <b>וידאו מהספרייה</b> — קטע וידאו שהעליתם, נחתך ומותאם לאורך הקריינות.
                </li>
                <li>
                  <b>וידאו AI</b> — קליפ עם תנועה אמיתית שנוצר ע&quot;י מודל וידאו מתמונת הפתיחה של הסצנה (או מהדמות).
                </li>
                <li>
                  <b>דמות מדברת</b> — דמות המותג אומרת את הקריינות בעברית עם סנכרון שפתיים (הקול נוצר אצלנו, התנועה אצל הספק).
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="min-w-0 truncate" title={label}>
        {label}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function SettingsForm({ brandId, project, musicOptions }: { brandId: string; project: ProjectDto; musicOptions: { id: string; title: string }[] }) {
  const [state, action] = useActionState(updateSettingsAction.bind(null, project.id), idleState);
  const [music, setMusic] = useState<string>(project.musicMediaId ?? '');
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
    }
  }, [state, router]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="size-4" /> הגדרות הסרטון
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form key={formKey(state)} action={action} className="flex flex-col gap-3">
          <Field label="קול הקריין (סצנות של דמות מדברת משתמשות בקול של הדמות)" name="voice" error={fieldError(state, 'voice')}>
            <Select id="voice" name="voice" defaultValue={formValue(state, 'voice', project.voice)}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="איכות וידאו AI ודמויות" name="videoTier" error={fieldError(state, 'videoTier')}>
            <Select id="videoTier" name="videoTier" defaultValue={formValue(state, 'videoTier', project.videoTier)}>
              {TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="motionStills" defaultChecked={formChecked(state, 'motionStills', project.motionStills)} className="size-4 rounded border-input" />
            תנועת מצלמה עדינה על תמונות (זום)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="ambientAudio" defaultChecked={formChecked(state, 'ambientAudio', project.ambientAudio)} className="size-4 rounded border-input" />
            סאונד אווירה מקליפי הווידאו (מתחת לקריינות)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="transitions" defaultChecked={formChecked(state, 'transitions', project.transitions)} className="size-4 rounded border-input" />
            מעברים רכים בין סצנות
          </label>
          <Field label="מוזיקת רקע (מספריית המדיה — MP3 / WAV / M4A)" name="musicMediaId" error={fieldError(state, 'musicMediaId')}>
            <Select id="musicMediaId" name="musicMediaId" value={music} onChange={(e) => setMusic(e.target.value)}>
              <option value="">— ללא מוזיקה —</option>
              {musicOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          </Field>
          {music ? (
            <>
              <audio controls src={mediaUrl(brandId, music)} className="w-full" />
              <Field label="עוצמת המוזיקה (המוזיקה יורדת אוטומטית כשהקריין מדבר)" name="musicVolume" error={fieldError(state, 'musicVolume')}>
                <Select id="musicVolume" name="musicVolume" defaultValue={formValue(state, 'musicVolume', project.musicVolume)}>
                  {[8, 12, 18, 25, 35, 50].map((v) => (
                    <option key={v} value={v}>
                      {v}%
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : (
            <input type="hidden" name="musicVolume" value={project.musicVolume} />
          )}
          {musicOptions.length === 0 ? <p className="text-xs text-muted-foreground">אין קבצי מוזיקה בספרייה — העלו קובץ שמע (עם רישיון שימוש) בספריית המדיה.</p> : null}
          <FormMessage state={state} />
          <SubmitButton size="sm" variant="outline" pendingText="שומר…">
            <Save /> שמירת הגדרות
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
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
        <Input id="extra" name="extra" defaultValue={formValue(state, 'extra', '')} placeholder="למשל: להתחיל בשאלה, טון הומוריסטי, הרובוט של המותג מציג" />
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

function SceneCard({
  brandId,
  projectId,
  scene,
  images,
  videos,
  characters,
  canEdit,
  ratio,
}: {
  brandId: string;
  projectId: string;
  scene: VideoScene;
  images: PickerImage[];
  videos: PickerImage[];
  characters: CharacterOption[];
  canEdit: boolean;
  ratio: string;
}) {
  const [state, action] = useActionState(updateSceneAction.bind(null, projectId, scene.id), idleState);
  const [kind, setKind] = useState<string>(scene.visualKind);
  const [mediaId, setMediaId] = useState<string | null>(scene.mediaId);
  const [characterId, setCharacterId] = useState<string>(scene.characterId ?? '');
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
    }
  }, [state, router]);
  const meta = (scene.clipMeta ?? {}) as { clipMock?: boolean; clipModel?: string; clipCostIls?: number };
  const showClip = scene.clipMediaId && (scene.visualKind === 'AI_VIDEO' || scene.visualKind === 'AVATAR');
  const frame = scene.renderedImageId ? mediaUrl(brandId, scene.renderedImageId) : null;
  const character = characters.find((c) => c.id === characterId) ?? null;
  const changeKind = (next: string) => {
    setKind(next);
    // A library image is not a valid library video and vice versa.
    if ((next === 'MEDIA_VIDEO') !== (kind === 'MEDIA_VIDEO')) setMediaId(null);
  };

  return (
    <li className="rounded-xl border bg-card p-4">
      <form key={formKey(state)} action={action} className="grid gap-3 md:grid-cols-[170px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">{scene.order}</span>
            {scene.durationMs ? <Badge variant="outline">{(scene.durationMs / 1000).toFixed(1)} שנ&apos;</Badge> : null}
            {showClip && meta.clipMock ? <Badge variant="warning">MOCK</Badge> : null}
          </div>
          <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted/40" style={{ aspectRatio: ratio }}>
            {showClip ? (
              <video src={mediaUrl(brandId, scene.clipMediaId!)} muted loop playsInline controls preload="metadata" className="size-full object-cover" />
            ) : frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame} alt={`סצנה ${scene.order}`} className="size-full object-cover" />
            ) : (
              <Clapperboard className="size-5 text-muted-foreground" />
            )}
          </div>
          {showClip && meta.clipModel ? (
            <span className="text-[11px] text-muted-foreground" dir="ltr">
              {meta.clipModel}
              {typeof meta.clipCostIls === 'number' ? ` · ${meta.clipCostIls.toFixed(2)} ₪` : ''}
            </span>
          ) : null}
          {scene.audioMediaId && scene.durationMs ? <audio controls src={mediaUrl(brandId, scene.audioMediaId)} className="w-full" /> : null}
        </div>
        <fieldset disabled={!canEdit} className="flex flex-col gap-3">
          <Field label={kind === 'AVATAR' ? 'מה הדמות אומרת (קריינות)' : 'קריינות'} name="narration" error={fieldError(state, 'narration')}>
            <Textarea id={`narration-${scene.id}`} name="narration" rows={2} required maxLength={600} defaultValue={formValue(state, 'narration', scene.narration)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="טקסט על המסך" name="onScreenText" error={fieldError(state, 'onScreenText')}>
              <Input id={`ost-${scene.id}`} name="onScreenText" maxLength={120} defaultValue={formValue(state, 'onScreenText', scene.onScreenText ?? '')} />
            </Field>
            <Field label="ויז'ואל" name="visualKind" error={fieldError(state, 'visualKind')}>
              <Select id={`kind-${scene.id}`} name="visualKind" value={kind} onChange={(e) => changeKind(e.target.value)}>
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {kind === 'MEDIA' || kind === 'MEDIA_VIDEO' || kind === 'AI_VIDEO' ? (
            <div>
              <input type="hidden" name="mediaId" value={mediaId ?? ''} />
              <div className="mb-1 text-xs text-muted-foreground">{kind === 'MEDIA' ? 'תמונה' : kind === 'MEDIA_VIDEO' ? 'וידאו מהספרייה' : 'תמונת פתיחה (אופציונלי — בלי בחירה תיווצר תמונה מהתיאור, או תשמש תמונת הדמות)'}</div>
              <MediaPicker brandId={brandId} images={kind === 'MEDIA_VIDEO' ? videos : images} value={mediaId} onChange={setMediaId} kind={kind === 'MEDIA_VIDEO' ? 'VIDEO' : 'IMAGE'} label={kind === 'MEDIA_VIDEO' ? 'בחירת וידאו' : 'בחירת תמונה'} />
              {fieldError(state, 'mediaId') ? <p className="mt-1 text-xs text-destructive">{fieldError(state, 'mediaId')}</p> : null}
            </div>
          ) : (
            <input type="hidden" name="mediaId" value="" />
          )}

          {kind === 'AVATAR' || kind === 'AI_VIDEO' ? (
            <Field label={kind === 'AVATAR' ? 'הדמות המדברת' : 'דמות בסצנה (אופציונלי)'} name="characterId" error={fieldError(state, 'characterId')}>
              <div className="flex items-center gap-2">
                {character ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={mediaUrl(brandId, character.imageMediaId)} alt={character.name} className="size-10 shrink-0 rounded-full object-cover" />
                ) : null}
                <Select id={`char-${scene.id}`} name="characterId" value={characterId} onChange={(e) => setCharacterId(e.target.value)} required={kind === 'AVATAR'}>
                  <option value="">{kind === 'AVATAR' ? '— בחרו דמות —' : '— ללא דמות —'}</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (קול {c.voice})
                    </option>
                  ))}
                </Select>
              </div>
              {characters.length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  אין עדיין דמויות. <Link href="/app/video/characters" className="underline">צרו דמות מותג</Link> (מתמונה או ב-AI).
                </p>
              ) : null}
            </Field>
          ) : (
            <input type="hidden" name="characterId" value="" />
          )}

          {kind === 'AI_IMAGE' || kind === 'AI_VIDEO' ? (
            <Field label={kind === 'AI_VIDEO' ? 'מה רואים בסצנה (אנגלית עדיף)' : 'תיאור התמונה (אנגלית עדיף, בלי טקסט)'} name="visualPrompt" error={fieldError(state, 'visualPrompt')}>
              <Textarea id={`vp-${scene.id}`} name="visualPrompt" rows={2} maxLength={800} defaultValue={formValue(state, 'visualPrompt', scene.visualPrompt ?? '')} />
            </Field>
          ) : (
            <input type="hidden" name="visualPrompt" value={scene.visualPrompt ?? ''} />
          )}
          {kind === 'AI_VIDEO' || kind === 'AVATAR' ? (
            <Field label={kind === 'AI_VIDEO' ? 'תנועה ומצלמה (למשל: slow dolly-in, the robot waves and smiles)' : 'הבעה ותנועה (אופציונלי)'} name="motionPrompt" error={fieldError(state, 'motionPrompt')}>
              <Input id={`mp-${scene.id}`} name="motionPrompt" maxLength={500} defaultValue={formValue(state, 'motionPrompt', scene.motionPrompt ?? '')} />
            </Field>
          ) : (
            <input type="hidden" name="motionPrompt" value={scene.motionPrompt ?? ''} />
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
