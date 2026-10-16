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
import { Textarea } from '@/components/ui/textarea';
import { formKey, formValue, idleState } from '@/lib/action-state';
import { createCreativeProjectAction } from './actions';

const CHANNELS = [
  ['INSTAGRAM', 'אינסטגרם'],
  ['FACEBOOK', 'פייסבוק'],
  ['GOOGLE', 'גוגל'],
  ['LINKEDIN', 'לינקדאין'],
  ['GENERIC', 'כללי'],
] as const;
const FORMATS = [
  ['POST', 'פוסט'],
  ['STORY', 'סטורי'],
  ['BANNER', 'באנר'],
  ['AD', 'מודעה'],
] as const;

export function CreateCreativeDialog({ products }: { products: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> קריאייטיב חדש
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>פרויקט קריאייטיב חדש</DialogTitle>
          <DialogDescription>הגדירו ערוץ, פורמט ויחס מסך. את הטקסטים והעיצוב תבנו בשלב הבא — ידנית או מרעיונות AI.</DialogDescription>
        </DialogHeader>
        {open ? <CreateForm products={products} onClose={() => setOpen(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ products, onClose }: { products: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action] = useActionState(createCreativeProjectAction, idleState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
      const id = (state.data as { id?: string } | undefined)?.id;
      router.push(id ? `/app/creative/${id}` : '/app/creative');
      router.refresh();
    }
  }, [state, router, onClose]);
  return (
    <form key={formKey(state)} action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="שם הפרויקט" name="title" error={fieldError(state, 'title')} className="sm:col-span-2">
        <Input id="title" name="title" defaultValue={formValue(state, 'title', '')} required minLength={2} autoFocus />
      </Field>
      <Field label="ערוץ" name="channel" error={fieldError(state, 'channel')}>
        <Select id="channel" name="channel" defaultValue={formValue(state, 'channel', 'INSTAGRAM')}>
          {CHANNELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="פורמט" name="format" error={fieldError(state, 'format')}>
        <Select id="format" name="format" defaultValue={formValue(state, 'format', 'POST')}>
          {FORMATS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="יחס מסך" name="aspect" error={fieldError(state, 'aspect')} className="sm:col-span-2">
        <Select id="aspect" name="aspect" defaultValue={formValue(state, 'aspect', 'R1X1')}>
          {(Object.keys(ASPECTS) as (keyof typeof ASPECTS)[]).map((k) => (
            <option key={k} value={k}>
              {ASPECTS[k].label} ({ASPECTS[k].width}×{ASPECTS[k].height})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="מוצר / שירות במוקד" name="productId" error={fieldError(state, 'productId')} className="sm:col-span-2">
        <Select id="productId" name="productId" defaultValue={formValue(state, 'productId', '')}>
          <option value="">— המותג בכללותו —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="מטרה" name="goal" error={fieldError(state, 'goal')}>
        <Input id="goal" name="goal" placeholder="לידים / מודעות למותג / מבצע" defaultValue={formValue(state, 'goal', '')} />
      </Field>
      <Field label="קהל יעד" name="audience" error={fieldError(state, 'audience')}>
        <Input id="audience" name="audience" placeholder="בעלי עסקים קטנים" defaultValue={formValue(state, 'audience', '')} />
      </Field>
      <Field label="סגנון (אופציונלי)" name="style" error={fieldError(state, 'style')} className="sm:col-span-2">
        <Textarea id="style" name="style" rows={2} placeholder="טון, אווירה, הפניות ויזואליות" defaultValue={formValue(state, 'style', '')} />
      </Field>
      <div className="sm:col-span-2">
        <FormMessage state={state} />
      </div>
      <DialogFooter className="sm:col-span-2">
        <SubmitButton pendingText="יוצר…">צור פרויקט</SubmitButton>
      </DialogFooter>
    </form>
  );
}
