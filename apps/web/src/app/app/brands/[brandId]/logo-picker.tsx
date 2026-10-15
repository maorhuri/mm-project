'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ImageIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BrandAssetWithMedia } from '@mm/core';
import type { BrandAssetType, MediaAsset } from '@mm/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { removeBrandAssetAction, setBrandAssetAction } from '../actions';

const SLOTS: { type: BrandAssetType; label: string }[] = [
  { type: 'LOGO_PRIMARY', label: 'לוגו ראשי' },
  { type: 'LOGO_SECONDARY', label: 'לוגו משני' },
  { type: 'LOGO_ICON', label: 'אייקון' },
];

function fileUrl(brandId: string, mediaId: string) {
  return `/api/v1/brands/${brandId}/media/${mediaId}/file`;
}

export function LogoPicker({
  brandId,
  assets,
  images,
  disabled,
}: {
  brandId: string;
  assets: BrandAssetWithMedia[];
  images: MediaAsset[];
  disabled: boolean;
}) {
  const [picking, setPicking] = useState<BrandAssetType | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (mediaId: string) => {
    if (!picking) return;
    const type = picking;
    setPicking(null);
    startTransition(async () => {
      const res = await setBrandAssetAction(brandId, type, mediaId);
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  };

  const remove = (assetId: string) => {
    startTransition(async () => {
      const res = await removeBrandAssetAction(brandId, assetId);
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>לוגואים</CardTitle>
        <CardDescription>נבחרים מתוך ספריית המדיה של המותג. מועדף SVG או PNG שקוף.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {SLOTS.map((slot) => {
          const asset = assets.find((a) => a.type === slot.type);
          return (
            <div key={slot.type} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]">
                {asset ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl(brandId, asset.mediaAssetId)} alt={slot.label} className="max-h-full max-w-full object-contain" />
                ) : (
                  <ImageIcon className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{slot.label}</div>
                <div className="truncate text-xs text-muted-foreground">{asset ? asset.media.originalName : 'לא הוגדר'}</div>
              </div>
              {!disabled ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => setPicking(slot.type)}>
                    בחירה
                  </Button>
                  {asset ? (
                    <Button size="icon" variant="ghost" aria-label="הסרה" disabled={pending} onClick={() => remove(asset.id)}>
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>

      <Dialog open={picking !== null} onOpenChange={(o) => !o && setPicking(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>בחירת תמונה מהספרייה</DialogTitle>
            <DialogDescription>
              {images.length === 0 ? (
                <>
                  אין תמונות בספריית המדיה של המותג.{' '}
                  <Link href="/app/media" className="underline">
                    העלו תמונות
                  </Link>
                </>
              ) : (
                'מוצגות תמונות של המותג הנוכחי בלבד.'
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
            {images.map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => choose(img.id)}
                className="group flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-muted/40 p-1 hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                title={img.title ?? img.originalName}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(brandId, img.id)} alt={img.altText ?? img.originalName} className="max-h-full max-w-full object-contain" loading="lazy" />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
