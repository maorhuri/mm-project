'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const ACCEPT = 'image/*,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/wav,audio/mp4,.ttf,.otf,.woff,.woff2,application/pdf';

export function MediaUploader({ brandId }: { brandId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let okCount = 0;
    for (const [i, file] of Array.from(files).entries()) {
      setBusy(`מעלה ${i + 1}/${files.length}: ${file.name}`);
      const form = new FormData();
      form.append('file', file);
      try {
        const res = await fetch(`/api/v1/brands/${brandId}/media`, { method: 'POST', body: form });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          toast.error(`${file.name}: ${body?.error?.message ?? `שגיאה ${res.status}`}`);
        } else {
          okCount += 1;
        }
      } catch {
        toast.error(`${file.name}: העלאה נכשלה`);
      }
    }
    setBusy(null);
    if (inputRef.current) inputRef.current.value = '';
    if (okCount > 0) {
      toast.success(okCount === 1 ? 'הקובץ הועלה' : `${okCount} קבצים הועלו`);
      router.refresh();
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => void upload(e.target.files)} />
      <Button onClick={() => inputRef.current?.click()} disabled={busy !== null}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {busy ? <span className="max-w-[14rem] truncate">{busy}</span> : 'העלאת קבצים'}
      </Button>
    </>
  );
}
