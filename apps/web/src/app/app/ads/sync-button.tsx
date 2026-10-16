'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-state';
import { syncAdsAction } from './actions';

export function SyncButton({ days }: { days: number }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await callAction(syncAdsAction(days));
          if (res.status === 'error') toast.error(res.message);
          else {
            toast.success(res.message);
            router.refresh();
          }
        })
      }
    >
      <RefreshCw className={pending ? 'animate-spin' : ''} /> {pending ? 'מסנכרן…' : 'סנכרון מ-Meta'}
    </Button>
  );
}
