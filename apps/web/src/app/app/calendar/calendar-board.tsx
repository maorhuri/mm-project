'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, ExternalLink, Facebook, Instagram, Pencil, Plus, RotateCcw, Send, Sparkles, Trash2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { mediaUrl } from '@/components/media-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { callAction, formKey, formValue, idleState } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import { captionAction, createPostAction, postCommandAction, updatePostAction } from './actions';

type Channel = 'FACEBOOK_PAGE' | 'INSTAGRAM';
type Status = 'DRAFT' | 'PENDING_APPROVAL' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';

export interface PostDto {
  id: string;
  channel: Channel;
  caption: string;
  mediaType: 'NONE' | 'IMAGE' | 'VIDEO';
  mediaId: string | null;
  scheduledAt: string;
  status: Status;
  permalink: string | null;
  error: string | null;
  publishedAt: string | null;
}

export interface SourceOption {
  key: string;
  label: string;
  mediaId: string;
  kind: 'IMAGE' | 'VIDEO';
  sourceType: string;
  sourceId: string;
}

const STATUS: Record<Status, { label: string; variant: 'muted' | 'warning' | 'default' | 'secondary' | 'success' | 'destructive' }> = {
  DRAFT: { label: 'טיוטה', variant: 'muted' },
  PENDING_APPROVAL: { label: 'ממתין לאישור', variant: 'warning' },
  SCHEDULED: { label: 'מתוזמן', variant: 'default' },
  PUBLISHING: { label: 'מתפרסם…', variant: 'warning' },
  PUBLISHED: { label: 'פורסם', variant: 'success' },
  FAILED: { label: 'נכשל', variant: 'destructive' },
  CANCELLED: { label: 'בוטל', variant: 'secondary' },
};

const TZ = 'Asia/Jerusalem';
const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const timeOf = (iso: string) => new Intl.DateTimeFormat('he-IL', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
/** ISO → "YYYY-MM-DDTHH:mm" in Asia/Jerusalem for <input type="datetime-local">. */
function toLocalInput(iso: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
function nextSlot(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d.toISOString());
}

function ChannelIcon({ channel, className }: { channel: Channel; className?: string }) {
  return channel === 'INSTAGRAM' ? <Instagram className={className} /> : <Facebook className={className} />;
}

export function CalendarBoard({ brandId, month, canEdit, posts, sources, initialSource }: { brandId: string; month: string; canEdit: boolean; posts: PostDto[]; sources: SourceOption[]; initialSource: string | null }) {
  const [creating, setCreating] = useState<{ date?: string; source?: string } | null>(initialSource ? { source: initialSource } : null);
  const [editing, setEditing] = useState<PostDto | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [y, m] = month.split('-').map(Number) as [number, number];
  const shift = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const byDay = useMemo(() => {
    const map = new Map<string, PostDto[]>();
    for (const p of posts) {
      const k = dayKey(new Date(p.scheduledAt));
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [posts]);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = dayKey(new Date());
  const run = (p: Promise<{ status: string; message?: string }>) =>
    startTransition(async () => {
      const res = await callAction(p as Promise<never>);
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        router.refresh();
      }
    });
  const upcoming = posts.filter((p) => p.status !== 'CANCELLED').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button asChild size="icon" variant="outline" aria-label="חודש קודם">
            <Link href={`/app/calendar?m=${shift(-1)}`}>
              <ChevronRight />
            </Link>
          </Button>
          <span className="min-w-36 text-center font-medium">{new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)))}</span>
          <Button asChild size="icon" variant="outline" aria-label="חודש הבא">
            <Link href={`/app/calendar?m=${shift(1)}`}>
              <ChevronLeft />
            </Link>
          </Button>
        </div>
        {canEdit ? (
          <Button onClick={() => setCreating({})}>
            <Plus /> פוסט חדש
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border bg-border text-sm">
        {['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'].map((d) => (
          <div key={d} className="bg-muted px-2 py-1 text-center text-xs font-medium text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          const key = day ? `${month}-${String(day).padStart(2, '0')}` : `x${i}`;
          const items = day ? (byDay.get(key) ?? []) : [];
          return (
            <div key={key} className={cn('min-h-24 bg-card p-1.5', !day && 'bg-muted/40', key === today && 'ring-2 ring-inset ring-primary/50')}>
              {day ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{day}</span>
                    {canEdit ? (
                      <button type="button" className="text-muted-foreground/50 hover:text-foreground" aria-label="פוסט ביום זה" onClick={() => setCreating({ date: `${key}T10:00` })}>
                        <Plus className="size-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-col gap-1">
                    {items.map((p) => (
                      <button key={p.id} type="button" onClick={() => setEditing(p)} className={cn('flex items-center gap-1 truncate rounded px-1 py-0.5 text-start text-[11px]', p.status === 'PUBLISHED' ? 'bg-success/15' : p.status === 'FAILED' ? 'bg-destructive/15' : p.status === 'SCHEDULED' ? 'bg-primary/15' : 'bg-muted')}>
                        <ChannelIcon channel={p.channel} className="size-3 shrink-0" />
                        <span className="tabular-nums">{timeOf(p.scheduledAt)}</span>
                        <span className="truncate">{p.caption || '(ללא טקסט)'}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-2 text-sm font-medium">פוסטים בחודש ({upcoming.length})</div>
        {upcoming.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">אין פוסטים בחודש הזה. צרו פוסט מקריאייטיב, מסרטון או מקובץ בספרייה.</p>
        ) : (
          <ul className="divide-y">
            {upcoming.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  {p.mediaId && p.mediaType === 'IMAGE' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaUrl(brandId, p.mediaId)} alt="" className="size-full object-cover" />
                  ) : p.mediaId && p.mediaType === 'VIDEO' ? (
                    <video src={mediaUrl(brandId, p.mediaId)} muted preload="metadata" className="size-full object-cover" />
                  ) : (
                    <ChannelIcon channel={p.channel} className="size-5 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <ChannelIcon channel={p.channel} className="size-3.5" />
                    <span className="tabular-nums text-muted-foreground">{new Date(p.scheduledAt).toLocaleString('he-IL', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' })}</span>
                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-sm">{p.caption}</p>
                  {p.error ? <p className="text-xs text-destructive">{p.error}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.permalink ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={p.permalink} target="_blank" rel="noreferrer">
                        <ExternalLink /> לפוסט
                      </a>
                    </Button>
                  ) : null}
                  {canEdit && p.status === 'DRAFT' ? (
                    <Button size="sm" disabled={pending} onClick={() => run(postCommandAction(p.id, 'approve'))}>
                      <Send /> לאישור
                    </Button>
                  ) : null}
                  {canEdit && p.status === 'FAILED' ? (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(postCommandAction(p.id, 'retry'))}>
                      <RotateCcw /> נסו שוב
                    </Button>
                  ) : null}
                  {canEdit && p.status !== 'PUBLISHED' && p.status !== 'PUBLISHING' ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)} aria-label="עריכה">
                      <Pencil />
                    </Button>
                  ) : null}
                  {canEdit && (p.status === 'SCHEDULED' || p.status === 'PENDING_APPROVAL') ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm('לבטל את הפוסט?') && run(postCommandAction(p.id, 'cancel'))} aria-label="ביטול">
                      <XCircle />
                    </Button>
                  ) : null}
                  {canEdit && (p.status === 'DRAFT' || p.status === 'FAILED') ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm('למחוק?') && run(postCommandAction(p.id, 'delete'))} aria-label="מחיקה">
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {creating ? <NewPostDialog sources={sources} brandId={brandId} initial={creating} onClose={() => setCreating(null)} /> : null}
      {editing ? <EditPostDialog post={editing} sources={sources} brandId={brandId} canEdit={canEdit && editing.status !== 'PUBLISHED' && editing.status !== 'PUBLISHING'} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function SourcePreview({ brandId, source }: { brandId: string; source: SourceOption | null }) {
  if (!source) return null;
  return (
    <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg bg-muted">
      {source.kind === 'VIDEO' ? (
        <video src={mediaUrl(brandId, source.mediaId)} controls muted className="h-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={mediaUrl(brandId, source.mediaId)} alt="" className="h-full object-contain" />
      )}
    </div>
  );
}

function CaptionAssist({ channel, onCaption }: { channel: Channel; onCaption: (c: string) => void }) {
  const [brief, setBrief] = useState('');
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex gap-2">
      <Input value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="על מה הפוסט? (ה-AI יכתוב כיתוב מבוסס על המידע המאושר)" className="h-8 text-xs" />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || brief.trim().length < 3}
        onClick={() =>
          startTransition(async () => {
            const res = await callAction(captionAction(channel, brief));
            if (res.status === 'error') toast.error(res.message);
            else {
              const data = res.data as { caption: string };
              onCaption(data.caption);
              toast.success(res.message);
            }
          })
        }
      >
        <Sparkles /> {pending ? 'כותב…' : 'כתוב כיתוב'}
      </Button>
    </div>
  );
}

function NewPostDialog({ sources, brandId, initial, onClose }: { sources: SourceOption[]; brandId: string; initial: { date?: string; source?: string }; onClose: () => void }) {
  const [state, action] = useActionState(createPostAction, idleState);
  const [sourceKey, setSourceKey] = useState(initial.source ?? '');
  const [caption, setCaption] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['FACEBOOK_PAGE', 'INSTAGRAM']);
  const router = useRouter();
  const source = sources.find((s) => s.key === sourceKey) ?? null;
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);
  const toggle = (c: Channel) => setChannels((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>פוסט חדש</DialogTitle>
          <DialogDescription>פוסט נפרד ייווצר לכל ערוץ. הפרסום יתבצע אוטומטית במועד, אחרי אישור.</DialogDescription>
        </DialogHeader>
        <form key={formKey(state)} action={action} className="flex flex-col gap-3">
          <div className="flex gap-4 text-sm">
            {(['FACEBOOK_PAGE', 'INSTAGRAM'] as Channel[]).map((c) => (
              <label key={c} className="flex items-center gap-1.5">
                <input type="checkbox" name="channels" value={c} checked={channels.includes(c)} onChange={() => toggle(c)} className="size-4" />
                <ChannelIcon channel={c} className="size-4" /> {c === 'INSTAGRAM' ? 'אינסטגרם' : 'עמוד פייסבוק'}
              </label>
            ))}
          </div>
          {fieldError(state, 'channels') ? <p className="text-xs text-destructive">{fieldError(state, 'channels')}</p> : null}
          <Field label="מדיה" name="sourceKey" error={fieldError(state, 'mediaId')}>
            <Select id="sourceKey" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
              <option value="">— ללא מדיה (פייסבוק בלבד) —</option>
              {sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <input type="hidden" name="mediaId" value={source?.mediaId ?? ''} />
          <input type="hidden" name="sourceType" value={source?.sourceType ?? ''} />
          <input type="hidden" name="sourceId" value={source?.sourceId ?? ''} />
          <SourcePreview brandId={brandId} source={source} />
          <CaptionAssist channel={channels[0] ?? 'INSTAGRAM'} onCaption={setCaption} />
          <Field label="כיתוב" name="caption" error={fieldError(state, 'caption')}>
            <Textarea id="caption" name="caption" rows={6} maxLength={5000} value={caption} onChange={(e) => setCaption(e.target.value)} />
          </Field>
          <Field label="מועד פרסום (שעון ישראל)" name="scheduledAt" error={fieldError(state, 'scheduledAt')}>
            <Input id="scheduledAt" name="scheduledAt" type="datetime-local" required defaultValue={formValue(state, 'scheduledAt', initial.date ?? nextSlot())} dir="ltr" />
          </Field>
          <FormMessage state={state} />
          <DialogFooter className="gap-2">
            <SubmitButton name="intent" value="draft" variant="outline" pendingText="שומר…">
              שמור טיוטה
            </SubmitButton>
            <SubmitButton name="intent" value="approve" pendingText="שולח…">
              <Send /> שמור ושלח לאישור
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditPostDialog({ post, sources, brandId, canEdit, onClose }: { post: PostDto; sources: SourceOption[]; brandId: string; canEdit: boolean; onClose: () => void }) {
  const [state, action] = useActionState(updatePostAction.bind(null, post.id), idleState);
  const [caption, setCaption] = useState(post.caption);
  const [mediaId, setMediaId] = useState(post.mediaId ?? '');
  const router = useRouter();
  const options = sources.filter((s, i, arr) => arr.findIndex((x) => x.mediaId === s.mediaId) === i);
  const current = options.find((s) => s.mediaId === mediaId) ?? null;
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ChannelIcon channel={post.channel} className="size-4" /> {post.channel === 'INSTAGRAM' ? 'אינסטגרם' : 'עמוד פייסבוק'} · <Badge variant={STATUS[post.status].variant}>{STATUS[post.status].label}</Badge>
          </DialogTitle>
          <DialogDescription>שינוי בטקסט או במדיה מחזיר את הפוסט לטיוטה ודורש אישור מחדש. שינוי מועד בלבד — לא.</DialogDescription>
        </DialogHeader>
        <form key={formKey(state)} action={action} className="flex flex-col gap-3">
          <fieldset disabled={!canEdit} className="flex flex-col gap-3">
            <Field label="מדיה" name="mediaId" error={fieldError(state, 'mediaId')}>
              <Select id="mediaId" name="mediaId" value={mediaId} onChange={(e) => setMediaId(e.target.value)}>
                <option value="">— ללא —</option>
                {post.mediaId && !current ? <option value={post.mediaId}>המדיה הנוכחית</option> : null}
                {options.map((s) => (
                  <option key={s.key} value={s.mediaId}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            <SourcePreview brandId={brandId} source={current ?? (mediaId ? { key: 'cur', label: '', mediaId, kind: post.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE', sourceType: 'media', sourceId: mediaId } : null)} />
            {canEdit ? <CaptionAssist channel={post.channel} onCaption={setCaption} /> : null}
            <Field label="כיתוב" name="caption" error={fieldError(state, 'caption')}>
              <Textarea id="caption" name="caption" rows={6} maxLength={5000} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </Field>
            <Field label="מועד פרסום (שעון ישראל)" name="scheduledAt" error={fieldError(state, 'scheduledAt')}>
              <Input id="scheduledAt" name="scheduledAt" type="datetime-local" required defaultValue={formValue(state, 'scheduledAt', toLocalInput(post.scheduledAt))} dir="ltr" />
            </Field>
          </fieldset>
          {post.error ? <p className="text-xs text-destructive">{post.error}</p> : null}
          <FormMessage state={state} />
          {canEdit ? (
            <DialogFooter>
              <SubmitButton pendingText="שומר…">שמירה</SubmitButton>
            </DialogFooter>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
