'use client';

import { useTransition } from 'react';
import { Activity } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { callAction } from '@/lib/action-state';
import { probeProviderAction } from './actions';

export function ProbeButtons({ providers }: { providers: { id: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  const probe = (id: string) =>
    startTransition(async () => {
      const res = await callAction(probeProviderAction(id));
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  if (providers.length === 0) return <p className="text-sm text-muted-foreground">אין ספקים מחוברים — הוסיפו מפתח בעמוד האינטגרציות.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {providers.map((p) => (
        <Button key={p.id} size="sm" variant="outline" disabled={pending} onClick={() => probe(p.id)}>
          <Activity /> בדיקה חיה: {p.label}
        </Button>
      ))}
    </div>
  );
}
