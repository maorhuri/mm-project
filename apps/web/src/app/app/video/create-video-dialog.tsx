'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ASPECTS } from '@mm/core/creative';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formKey, formValue, idleState } from '@/lib/action-state';
import { createVideoProjectAction } from './actions';

export const VOICES: { id: string; label: string }[] = [
  { id: 'alloy', label: 'Alloy — ניטרלי' },
  { id: 'ash', label: 'Ash' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'coral', label: 'Coral — נשי חם' },
  { id: 'echo', label: 'Echo — גברי' },
  { id: 'fable', label: 'Fable' },
  { id: 'nova', label: 'Nova — נשי' },
  { id: 'onyx', label: 'Onyx — גברי עמוק' },
  { id: 'sage', label: 'Sage' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'verse', label: 'Verse' },
];

export function CreateVideoDialog({ products }: { products: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> סרטון חדש
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>פרויקט וידאו חדש</DialogTitle>
          <DialogDescription>תסריט מה-AI (מבוסס עובדות מאושרות) → קריינות בעברית → כרטיסיות ממותגות / תמונות → MP4 עם כתוביות.</DialogDescription>
        </DialogHeader>
        {open ? <CreateForm products={products} onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ products, onClose }: { products: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action] = useActionState(createVideoProjectAction, idleState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
      const id = (state.data as { id?: string } | undefined)?.id;
      router.push(id ? `/app/video/${id}` : '/app/video');
      router.refresh();
    }
  }, [state, router, onClose]);
  return (
    <form key={formKey(state)} action={action} className="flex flex-col gap-4">
      <Field label="שם הסרטון" name="title" error={fieldError(state, 'title')}>
        <Input id="title" name="title" required minLength={2} defaultValue={formValue(state, 'title', '')} autoFocus />
      </Field>
      <Field label="מטרה" name="goal" error={fieldError(state, 'goal')}>
        <Input id="goal" name="goal" placeholder="להציג את השירות / להניע לפנייה" defaultValue={formValue(state, 'goal', '')} />
      </Field>
      <Field label="מוצר / שירות" name="productId" error={fieldError(state, 'productId')}>
        <Select id="productId" name="productId" defaultValue={formValue(state, 'productId', '')}>
          <option value="">— המותג בכללותו —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="יחס מסך" name="aspect" error={fieldError(state, 'aspect')}>
          <Select id="aspect" name="aspect" defaultValue={formValue(state, 'aspect', 'R9X16')}>
            {(['R9X16', 'R1X1', 'R4X5', 'R16X9'] as const).map((k) => (
              <option key={k} value={k}>
                {ASPECTS[k].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="קול קריינות (OpenAI)" name="voice" error={fieldError(state, 'voice')}>
          <Select id="voice" name="voice" defaultValue={formValue(state, 'voice', 'alloy')}>
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <FormMessage state={state} />
      <DialogFooter>
        <SubmitButton pendingText="יוצר…">צור פרויקט</SubmitButton>
      </DialogFooter>
    </form>
  );
}
