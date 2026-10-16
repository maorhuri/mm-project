'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formChecked, formKey, formValue, idleState } from '@/lib/action-state';
import { createBrandAction } from './actions';

export function CreateBrandDialog({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> מותג חדש
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>יצירת מותג</DialogTitle>
          <DialogDescription>המותג יקבל Brand Kit, ספריית מדיה ומרכז אישורים משלו.</DialogDescription>
        </DialogHeader>
        {/* The form owns its action state so a reopened dialog never shows a stale banner. */}
        {open ? <CreateBrandForm orgs={orgs} onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateBrandForm({ orgs, onClose }: { orgs: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action] = useActionState(createBrandAction, idleState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
      const id = (state.data as { id?: string } | undefined)?.id;
      router.push(id ? `/app/brands/${id}` : '/app/brands');
      router.refresh();
    }
  }, [state, router, onClose]);

  return (
    <form key={formKey(state)} action={action} className="flex flex-col gap-4">
      {orgs.length === 1 ? (
        <input type="hidden" name="orgId" value={orgs[0]!.id} />
      ) : (
        <Field label="ארגון" name="orgId" error={fieldError(state, 'orgId')}>
          <Select id="orgId" name="orgId" defaultValue={formValue(state, 'orgId', orgs[0]?.id)} required>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="שם המותג" name="name" error={fieldError(state, 'name')}>
        <Input id="name" name="name" defaultValue={formValue(state, 'name', '')} required minLength={2} autoFocus />
      </Field>
      <Field label="Slug (אופציונלי)" name="slug" error={fieldError(state, 'slug')} hint="אותיות לטיניות קטנות, ספרות ומקפים">
        <Input id="slug" name="slug" dir="ltr" pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={formValue(state, 'slug', '')} />
      </Field>
      <Field label="תחום" name="industry" error={fieldError(state, 'industry')}>
        <Input id="industry" name="industry" defaultValue={formValue(state, 'industry', '')} />
      </Field>
      <Field label="אתר" name="websiteUrl" error={fieldError(state, 'websiteUrl')}>
        <Input id="websiteUrl" name="websiteUrl" type="url" dir="ltr" placeholder="https://" defaultValue={formValue(state, 'websiteUrl', '')} />
      </Field>
      <Field label="תיאור" name="description" error={fieldError(state, 'description')}>
        <Textarea id="description" name="description" rows={3} defaultValue={formValue(state, 'description', '')} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isDemo" defaultChecked={formChecked(state, 'isDemo', false)} className="size-4 rounded border-input" />
        מותג דמו (יסומן כך בכל מקום)
      </label>
      <FormMessage state={state} />
      <DialogFooter>
        <SubmitButton pendingText="יוצר…">צור מותג</SubmitButton>
      </DialogFooter>
    </form>
  );
}
