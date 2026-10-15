'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { FileAudio, FileText, FileVideo, File as FileIcon, Type } from 'lucide-react';
import { toast } from 'sonner';
import type { MediaAsset, MediaKind } from '@mm/db';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { formatBytes, formatDateTime } from '@/lib/format';
import { deleteMediaAction, updateMediaAction } from './actions';

const KIND_ICON: Record<MediaKind, typeof FileIcon> = {
  IMAGE: FileIcon,
  VIDEO: FileVideo,
  AUDIO: FileAudio,
  FONT: Type,
  DOCUMENT: FileText,
  OTHER: FileIcon,
};

function fileUrl(brandId: string, id: string) {
  return `/api/v1/brands/${brandId}/media/${id}/file`;
}

export function MediaGrid({ brandId, items, canEdit }: { brandId: string; items: MediaAsset[]; canEdit: boolean }) {
  const [selected, setSelected] = useState<MediaAsset | null>(null);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {items.map((m) => {
          const Icon = KIND_ICON[m.kind];
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setSelected(m)}
              className="group flex flex-col overflow-hidden rounded-xl border bg-card text-start transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <div className="flex aspect-square items-center justify-center overflow-hidden bg-muted/40">
                {m.kind === 'IMAGE' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(brandId, m.id)} alt={m.altText ?? m.originalName} className="size-full object-cover" loading="lazy" />
                ) : (
                  <Icon className="size-8 text-muted-foreground" />
                )}
              </div>
              <div className="flex flex-col gap-0.5 p-2">
                <span className="truncate text-xs font-medium" title={m.originalName}>
                  {m.title ?? m.originalName}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatBytes(m.sizeBytes)}
                  {m.width && m.height ? ` · ${m.width}×${m.height}` : ''}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {selected ? <MediaDialog brandId={brandId} asset={selected} canEdit={canEdit} onClose={() => setSelected(null)} /> : null}
    </>
  );
}

function MediaDialog({ brandId, asset, canEdit, onClose }: { brandId: string; asset: MediaAsset; canEdit: boolean; onClose: () => void }) {
  const [state, action] = useActionState(updateMediaAction.bind(null, brandId, asset.id), idleState);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const remove = () => {
    if (!confirm(`למחוק את "${asset.originalName}"? הפעולה בלתי הפיכה.`)) return;
    startTransition(async () => {
      const res = await deleteMediaAction(brandId, asset.id);
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        onClose();
      }
    });
  };

  const url = fileUrl(brandId, asset.id);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{asset.originalName}</DialogTitle>
          <DialogDescription>
            {asset.mimeType} · {formatBytes(asset.sizeBytes)}
            {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''} · הועלה {formatDateTime(asset.createdAt)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
          <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
            {asset.kind === 'IMAGE' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={asset.altText ?? asset.originalName} className="max-h-80 max-w-full object-contain" />
            ) : asset.kind === 'VIDEO' ? (
              <video src={url} controls className="max-h-80 max-w-full" />
            ) : asset.kind === 'AUDIO' ? (
              <audio src={url} controls className="w-full px-4" />
            ) : (
              <a href={url} target="_blank" rel="noreferrer" className="text-sm text-primary underline">
                פתיחת הקובץ
              </a>
            )}
          </div>
          <form action={action} className="flex flex-col gap-3">
            <fieldset disabled={!canEdit} className="contents">
              <Field label="כותרת" name="title" error={fieldError(state, 'title')}>
                <Input id="title" name="title" defaultValue={asset.title ?? ''} />
              </Field>
              <Field label="טקסט חלופי (alt)" name="altText" error={fieldError(state, 'altText')}>
                <Input id="altText" name="altText" defaultValue={asset.altText ?? ''} />
              </Field>
              <Field label="תגיות" name="tags" hint="תגית בכל שורה או מופרדות בפסיק" error={fieldError(state, 'tags')}>
                <Textarea id="tags" name="tags" rows={3} defaultValue={asset.tags.join('\n')} />
              </Field>
            </fieldset>
            <div className="flex flex-wrap gap-1">
              {asset.tags.map((t) => (
                <Badge key={t} variant="secondary">
                  {t}
                </Badge>
              ))}
            </div>
            <div className="text-xs text-muted-foreground" dir="ltr">
              {asset.storageKey}
            </div>
            <FormMessage state={state} />
            {canEdit ? (
              <DialogFooter className="mt-auto justify-between">
                <SubmitButton pendingText="שומר…">שמירה</SubmitButton>
                <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
                  מחיקה
                </Button>
              </DialogFooter>
            ) : null}
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
