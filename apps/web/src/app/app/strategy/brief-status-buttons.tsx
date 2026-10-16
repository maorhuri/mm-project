'use client';

import { useTransition } from 'react';
import { Archive, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-state';
import { setBriefStatusAction } from './actions';

export function BriefStatusButtons({ briefId, status }: { briefId: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const set = (next: string) =>
    startTransition(async () => {
      const res = await callAction(setBriefStatusAction(briefId, next));
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        if (next === 'ARCHIVED') router.push('/app/strategy');
        router.refresh();
      }
    });
  return (
    <div className="flex gap-2">
      {status !== 'ACCEPTED' ? (
        <Button size="sm" disabled={pending} onClick={() => set('ACCEPTED')}>
          <CheckCircle2 /> אימוץ הבריף
        </Button>
      ) : null}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => set('ARCHIVED')}>
        <Archive /> לארכיון
      </Button>
    </div>
  );
}
