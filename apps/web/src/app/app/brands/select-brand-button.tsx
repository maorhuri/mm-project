'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { switchBrandAction } from '@/app/app/shell-actions';

export function SelectBrandButton({ brandId }: { brandId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => startTransition(() => switchBrandAction(brandId))}>
      {pending ? 'עובר…' : 'בחר מותג'}
    </Button>
  );
}
