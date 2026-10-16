'use client';

import { useState } from 'react';
import { Film, ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export interface PickerImage {
  id: string;
  title: string | null;
  originalName: string;
  width: number | null;
  height: number | null;
  tags: string[];
  /** IMAGE (default) or VIDEO — videos are previewed with a muted <video>. */
  kind?: 'IMAGE' | 'VIDEO';
}

export function mediaUrl(brandId: string, id: string): string {
  return `/api/v1/brands/${brandId}/media/${id}/file`;
}

/** Choose an image from the brand's media library (the list is passed in by the server page). */
export function MediaPicker({
  brandId,
  images,
  value,
  onChange,
  label = 'בחירת תמונה',
  allowClear = true,
  kind = 'IMAGE',
}: {
  brandId: string;
  images: PickerImage[];
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  allowClear?: boolean;
  kind?: 'IMAGE' | 'VIDEO';
}) {
  const [open, setOpen] = useState(false);
  const current = images.find((i) => i.id === value) ?? null;
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
        {value && kind === 'VIDEO' ? (
          <video src={mediaUrl(brandId, value)} muted playsInline preload="metadata" className="size-full object-cover" />
        ) : value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(brandId, value)} alt="" className="size-full object-cover" />
        ) : kind === 'VIDEO' ? (
          <Film className="size-5 text-muted-foreground" />
        ) : (
          <ImageIcon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="truncate text-xs text-muted-foreground">{current ? (current.title ?? current.originalName) : value ? (kind === 'VIDEO' ? 'וידאו נבחר' : 'תמונה נבחרה') : kind === 'VIDEO' ? 'לא נבחר וידאו' : 'לא נבחרה תמונה'}</span>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
            {label}
          </Button>
          {allowClear && value ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
              הסרה
            </Button>
          ) : null}
        </div>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>ספריית המדיה</DialogTitle>
            <DialogDescription>{kind === 'VIDEO' ? 'סרטונים' : 'תמונות'} של המותג הנוכחי בלבד. להעלאה — ספריית מדיה.</DialogDescription>
          </DialogHeader>
          {images.length === 0 ? (
            <EmptyState icon={kind === 'VIDEO' ? Film : ImageIcon} title={kind === 'VIDEO' ? 'אין סרטונים בספרייה' : 'אין תמונות בספרייה'} description={kind === 'VIDEO' ? 'העלו קטעי וידאו (MP4 / MOV / WebM) בספריית המדיה.' : 'העלו תמונות בספריית המדיה או צרו רקע ב-AI.'} />
          ) : (
            <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => {
                    onChange(img.id);
                    setOpen(false);
                  }}
                  className={cn('flex flex-col overflow-hidden rounded-lg border text-start transition-colors hover:border-primary', value === img.id && 'border-primary ring-2 ring-primary/40')}
                >
                  <div className="aspect-square bg-muted/40">
                    {kind === 'VIDEO' ? (
                      <video src={mediaUrl(brandId, img.id)} muted playsInline preload="metadata" className="size-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaUrl(brandId, img.id)} alt={img.title ?? img.originalName} className="size-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <span className="truncate px-1.5 py-1 text-[11px]">{img.title ?? img.originalName}</span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
