'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formKey, formValue, idleState } from '@/lib/action-state';
import { generateBriefAction } from './actions';

export function GenerateBriefForm({ kinds, disabled }: { kinds: { value: string; label: string }[]; disabled?: boolean }) {
  const [state, action] = useActionState(generateBriefAction, idleState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      const id = (state.data as { id?: string } | undefined)?.id;
      if (id) router.push(`/app/strategy/${id}`);
      router.refresh();
    }
  }, [state, router]);
  return (
    <form key={formKey(state)} action={action} className="flex flex-col gap-3">
      <Field label="סוג הבריף" name="kind" error={fieldError(state, 'kind')}>
        <Select id="kind" name="kind" defaultValue={formValue(state, 'kind', kinds[0]?.value)} required>
          {kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="דגש (אופציונלי)" name="focus" error={fieldError(state, 'focus')} hint="למשל: להתמקד בלקוחות עסקיים קטנים, או בהשקת שירות חדש">
        <Textarea id="focus" name="focus" rows={2} defaultValue={formValue(state, 'focus', '')} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="המודל חושב… (עד דקה)" disabled={disabled}>
        <Sparkles /> צור בריף
      </SubmitButton>
    </form>
  );
}
