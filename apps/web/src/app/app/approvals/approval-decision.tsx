'use client';

import { useActionState, useEffect } from 'react';
import { Check, MessageSquareWarning, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { decideApprovalAction } from './actions';

export function ApprovalDecision({ brandId, approvalId }: { brandId: string; approvalId: string }) {
  const [state, action, pending] = useActionState(decideApprovalAction.bind(null, brandId, approvalId), idleState);
  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
    if (state.status === 'error') toast.error(state.message);
  }, [state]);

  return (
    <form action={action} className="flex w-full flex-col gap-2 sm:w-72">
      <Input name="note" placeholder="הערה (אופציונלי)" aria-label="הערה" disabled={pending} />
      <div className="grid grid-cols-3 gap-1">
        <Button type="submit" name="decision" value="APPROVED" size="sm" disabled={pending}>
          <Check /> אישור
        </Button>
        <Button type="submit" name="decision" value="CHANGES_REQUESTED" size="sm" variant="secondary" disabled={pending}>
          <MessageSquareWarning /> שינויים
        </Button>
        <Button type="submit" name="decision" value="REJECTED" size="sm" variant="destructive" disabled={pending}>
          <X /> דחייה
        </Button>
      </div>
    </form>
  );
}
