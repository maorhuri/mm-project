'use client';

import { useActionState, useCallback, useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, Download, Lightbulb, Pencil, RefreshCw, Send, Sparkles, ThumbsDown } from 'lucide-react';
import { toast } from 'sonner';
import { ASPECTS, parseDocument } from '@mm/core/creative';
import type { CreativeDocument } from '@mm/core/creative';
import type { ContentIdea, CreativeProject, CreativeVersion } from '@mm/db';
import type { PickerImage } from '@/components/media-picker';
import { mediaUrl } from '@/components/media-picker';
import { QaPanel } from '@/components/qa-panel';
import type { QaReportDto } from '@/components/qa-panel';
import { CreativeStatusBadge, IdeaStatusBadge, QaStatusBadge, RenderStatusBadge, VersionStatusBadge } from '@/components/status-badges';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { callAction, formKey, formValue, idleState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';
import { archiveProjectAction, generateIdeasAction, requestApprovalAction, rerenderAction, setIdeaStatusAction } from '../actions';
import { ComposeDialog } from './compose-dialog';
import { CreativeEditor } from './creative-editor';

const CHANNEL: Record<string, string> = { FACEBOOK: 'פייסבוק', INSTAGRAM: 'אינסטגרם', GOOGLE: 'גוגל', LINKEDIN: 'לינקדאין', GENERIC: 'כללי' };
const FORMAT: Record<string, string> = { POST: 'פוסט', STORY: 'סטורי', BANNER: 'באנר', AD: 'מודעה' };

interface Props {
  brandId: string;
  canEdit: boolean;
  project: CreativeProject;
  versions: CreativeVersion[];
  ideas: ContentIdea[];
  product: { id: string; name: string } | null;
  kit: { colors: Record<string, string>; fonts: Record<string, string>; logoMediaId: string | null };
  images: PickerImage[];
}

function safeDoc(v: CreativeVersion | null | undefined): CreativeDocument | null {
  if (!v) return null;
  try {
    return parseDocument(v.document);
  } catch {
    return null;
  }
}

export function CreativeWorkspace({ brandId, canEdit, project, versions, ideas, product, kit, images: initialImages }: Props) {
  const current = versions.find((v) => v.id === project.currentVersionId) ?? versions[0] ?? null;
  const [tab, setTab] = useState<string>(current ? 'editor' : 'ideas');
  const [images, setImages] = useState<PickerImage[]>(initialImages);
  const [compose, setCompose] = useState<{ idea: ContentIdea | null } | null>(null);
  const [editorVersion, setEditorVersion] = useState<CreativeVersion | null>(current);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => setImages(initialImages), [initialImages]);
  useEffect(() => {
    // Keep the editor on the latest version once the server state changes (after a save).
    if (!editorVersion || !versions.some((v) => v.id === editorVersion.id)) setEditorVersion(current);
  }, [versions, current, editorVersion]);

  // Poll while a render is in flight so thumbnails and statuses appear without a manual refresh.
  const rendering = versions.some((v) => v.renderStatus === 'PENDING' || v.renderStatus === 'RENDERING');
  useEffect(() => {
    if (!rendering) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [rendering, router]);

  const onImageCreated = useCallback((img: PickerImage) => setImages((list) => [img, ...list.filter((i) => i.id !== img.id)]), []);
  const run = (promise: Promise<{ status: string; message?: string }>) =>
    startTransition(async () => {
      const res = await callAction(promise as Promise<never>);
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        router.refresh();
      }
    });

  const editorDoc = safeDoc(editorVersion);
  const aspect = ASPECTS[project.aspect];

  return (
    <>
      <PageHeader
        title={project.title}
        description={`${CHANNEL[project.channel]} · ${FORMAT[project.format]} · ${aspect.label}${product ? ` · ${product.name}` : ''}${project.goal ? ` · מטרה: ${project.goal}` : ''}`}
        badges={<CreativeStatusBadge status={project.status} />}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/app/creative">לכל הקריאייטיבים</Link>
            </Button>
            {canEdit ? (
              <Button size="sm" onClick={() => setCompose({ idea: null })}>
                <Pencil /> גרסה חדשה
              </Button>
            ) : null}
            {canEdit && project.status !== 'ARCHIVED' ? (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm('להעביר את הפרויקט לארכיון?') && run(archiveProjectAction(project.id))}>
                <Archive />
              </Button>
            ) : null}
          </div>
        }
      />

      {!kit.logoMediaId ? (
        <Alert variant="info">
          <Lightbulb />
          <AlertDescription>
            אין לוגו ראשי ב-Brand Kit — התבניות ירונדרו בלי לוגו. <Link href={`/app/brands/${brandId}?tab=design`} className="underline">להוספת לוגו</Link>
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="ideas">רעיונות ({ideas.length})</TabsTrigger>
          <TabsTrigger value="editor" disabled={!editorDoc}>
            עורך
          </TabsTrigger>
          <TabsTrigger value="versions">גרסאות ({versions.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="ideas" className="flex flex-col gap-4">
          {canEdit ? <IdeasForm projectId={project.id} project={project} /> : null}
          {ideas.length === 0 ? (
            <EmptyState icon={Sparkles} title="אין עדיין רעיונות" description="בקשו רעיונות מה-AI (מבוססי העובדות המאושרות של המותג) או צרו גרסה ידנית." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {ideas.map((idea) => {
                const copy = (idea.copy ?? {}) as Record<string, string | null>;
                const qa = idea.qa as unknown as QaReportDto | null;
                const claims = (Array.isArray(idea.claims) ? idea.claims : []) as { text: string; factIds: string[]; kind: string }[];
                return (
                  <li key={idea.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <IdeaStatusBadge status={idea.status} />
                      <QaStatusBadge status={qa?.status} />
                      {idea.source === 'mock' ? <Badge variant="warning">MOCK</Badge> : null}
                    </div>
                    <h3 className="font-medium">{idea.title}</h3>
                    <p className="text-sm text-muted-foreground">{idea.hook}</p>
                    <div className="rounded-lg bg-muted/40 p-3 text-sm">
                      <div className="font-semibold">{copy.headline}</div>
                      {copy.subheadline ? <div>{copy.subheadline}</div> : null}
                      <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                        {copy.cta ? <Badge variant="outline">{copy.cta}</Badge> : null}
                        {copy.price ? <Badge variant="secondary">{copy.price}</Badge> : null}
                        {copy.badge ? <Badge variant="secondary">{copy.badge}</Badge> : null}
                      </div>
                    </div>
                    {claims.length > 0 ? (
                      <ul className="text-xs text-muted-foreground">
                        {claims.map((c, i) => (
                          <li key={i}>
                            {c.kind === 'creative_phrase' ? '✦ ' : '• '}
                            {c.text}
                            {c.factIds.length ? <code className="ms-1 rounded bg-muted px-1" dir="ltr">{c.factIds.join(', ')}</code> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {qa && qa.findings.length > 0 ? <QaPanel report={qa} compact /> : null}
                    {canEdit ? (
                      <div className="mt-auto flex gap-2 pt-1">
                        <Button size="sm" onClick={() => setCompose({ idea })}>
                          <Pencil /> צור גרסה מהרעיון
                        </Button>
                        {idea.status !== 'DISCARDED' ? (
                          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(setIdeaStatusAction(project.id, idea.id, 'DISCARDED'))}>
                            <ThumbsDown /> פסילה
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="editor">
          {editorDoc && editorVersion ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">עורכים את גרסה {editorVersion.version}</span>
                <VersionStatusBadge status={editorVersion.status} />
                <RenderStatusBadge status={editorVersion.renderStatus} />
                <QaStatusBadge status={(editorVersion.qa as unknown as QaReportDto | null)?.status} />
              </div>
              <CreativeEditor key={editorVersion.id} brandId={brandId} projectId={project.id} initialDoc={editorDoc} images={images} canEdit={canEdit} onSaved={() => setTab('versions')} />
            </div>
          ) : (
            <EmptyState icon={Pencil} title="אין גרסה לעריכה" description="צרו גרסה ראשונה מרעיון או ידנית." />
          )}
        </TabsContent>

        <TabsContent value="versions" className="flex flex-col gap-3">
          {versions.length === 0 ? (
            <EmptyState icon={Pencil} title="אין עדיין גרסאות" />
          ) : (
            versions.map((v) => {
              const qa = v.qa as unknown as QaReportDto | null;
              const warnings = (v.renderWarnings as { warnings?: { kind: string; message: string; layer?: string }[] } | null)?.warnings ?? [];
              const png = v.renderedPngId ? mediaUrl(brandId, v.renderedPngId) : null;
              const canApprove = canEdit && v.renderStatus === 'READY' && v.status === 'READY' && qa?.status !== 'BLOCKED';
              return (
                <div key={v.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:flex-row">
                  <div className="flex w-full shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted/40 md:w-56" style={{ aspectRatio: `${aspect.width} / ${aspect.height}` }}>
                    {png ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={png} alt={`גרסה ${v.version}`} className="size-full object-contain" />
                    ) : (
                      <span className="text-xs text-muted-foreground">{v.renderStatus === 'FAILED' ? 'הרינדור נכשל' : 'ממתין לרינדור…'}</span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">גרסה {v.version}</span>
                      <VersionStatusBadge status={v.status} />
                      <RenderStatusBadge status={v.renderStatus} />
                      <QaStatusBadge status={qa?.status} />
                      {v.id === project.currentVersionId ? <Badge variant="outline">נוכחית</Badge> : null}
                      <span className="text-xs text-muted-foreground">{formatDateTime(v.createdAt)}</span>
                    </div>
                    {v.note ? <p className="text-sm text-muted-foreground">{v.note}</p> : null}
                    {v.renderError ? (
                      <p className="text-xs text-destructive" dir="ltr">
                        {v.renderError}
                      </p>
                    ) : null}
                    {warnings.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {warnings.map((w, i) => (
                          <Badge key={i} variant="warning">
                            {w.layer ? `${w.layer}: ` : ''}
                            {w.message}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    {qa && qa.findings.length > 0 ? <QaPanel report={qa} compact /> : null}
                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditorVersion(v);
                          setTab('editor');
                        }}
                      >
                        <Pencil /> פתיחה בעורך
                      </Button>
                      {v.renderedPngId ? (
                        <>
                          <Button asChild size="sm" variant="outline">
                            <a href={mediaUrl(brandId, v.renderedPngId)} download>
                              <Download /> PNG
                            </a>
                          </Button>
                          {v.renderedJpgId ? (
                            <Button asChild size="sm" variant="outline">
                              <a href={mediaUrl(brandId, v.renderedJpgId)} download>
                                JPG
                              </a>
                            </Button>
                          ) : null}
                          {v.renderedWebpId ? (
                            <Button asChild size="sm" variant="outline">
                              <a href={mediaUrl(brandId, v.renderedWebpId)} download>
                                WebP
                              </a>
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                      {canEdit && v.renderedJpgId ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/app/calendar?source=creative_version:${v.id}`}>תזמון לפרסום</Link>
                        </Button>
                      ) : null}
                      {canApprove ? (
                        <Button size="sm" disabled={pending} onClick={() => run(requestApprovalAction(project.id, v.id))}>
                          <Send /> שליחה לאישור
                        </Button>
                      ) : null}
                      {v.approvalId ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link href="/app/approvals">למרכז האישורים</Link>
                        </Button>
                      ) : null}
                      {canEdit && (v.renderStatus === 'FAILED' || v.renderStatus === 'READY' || Date.now() - new Date(v.createdAt).getTime() > 30 * 60_000) ? (
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(rerenderAction(project.id, v.id))}>
                          <RefreshCw /> רינדור מחדש
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </TabsContent>
      </Tabs>

      {compose ? (
        <ComposeDialog
          brandId={brandId}
          projectId={project.id}
          idea={compose.idea}
          images={images}
          onImageCreated={onImageCreated}
          onClose={() => setCompose(null)}
          onComposed={() => {
            setCompose(null);
            setTab('versions');
          }}
        />
      ) : null}
    </>
  );
}

function IdeasForm({ projectId, project }: { projectId: string; project: CreativeProject }) {
  const [state, action] = useActionState(generateIdeasAction.bind(null, projectId), idleState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
    }
  }, [state, router]);
  return (
    <form key={formKey(state)} action={action} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[120px_1fr_1fr_auto]">
      <Field label="כמה רעיונות" name="count" error={fieldError(state, 'count')}>
        <Select id="count" name="count" defaultValue={formValue(state, 'count', '4')}>
          {[2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="מטרה" name="goal" error={fieldError(state, 'goal')}>
        <Input id="goal" name="goal" defaultValue={formValue(state, 'goal', project.goal ?? '')} placeholder="לידים / מודעות / מבצע" />
      </Field>
      <Field label="קהל" name="audience" error={fieldError(state, 'audience')}>
        <Input id="audience" name="audience" defaultValue={formValue(state, 'audience', project.audience ?? '')} />
      </Field>
      <div className="flex items-end">
        <SubmitButton pendingText="המודל חושב…">
          <Sparkles /> רעיונות מה-AI
        </SubmitButton>
      </div>
      <Field label="הנחיות נוספות (אופציונלי)" name="extra" error={fieldError(state, 'extra')} className="md:col-span-4">
        <Textarea id="extra" name="extra" rows={2} defaultValue={formValue(state, 'extra', '')} placeholder="למשל: להדגיש תמיכה בעברית, בלי הומור" />
      </Field>
      <div className="md:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
