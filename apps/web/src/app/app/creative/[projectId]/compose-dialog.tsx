'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { TEMPLATES } from '@mm/core/creative';
import type { ContentIdea } from '@mm/db';
import { MediaPicker } from '@/components/media-picker';
import type { PickerImage } from '@/components/media-picker';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formKey, formValue, idleState } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import { composeVersionAction, generateBackgroundAction } from '../actions';

type IdeaCopy = { headline?: string; subheadline?: string | null; body?: string | null; cta?: string | null; price?: string | null; badge?: string | null };

export function ComposeDialog({
  brandId,
  projectId,
  idea,
  images,
  onImageCreated,
  onClose,
  onComposed,
}: {
  brandId: string;
  projectId: string;
  idea: ContentIdea | null;
  images: PickerImage[];
  onImageCreated: (img: PickerImage) => void;
  onClose: () => void;
  onComposed: () => void;
}) {
  const copy = (idea?.copy ?? {}) as IdeaCopy;
  const [template, setTemplate] = useState<string>('bold');
  const [backgroundMediaId, setBackgroundMediaId] = useState<string | null>(null);
  const [state, action] = useActionState(composeVersionAction.bind(null, projectId), idleState);
  const [bgState, bgAction] = useActionState(generateBackgroundAction.bind(null, projectId), idleState);
  const router = useRouter();

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
      onComposed();
    }
  }, [state, router, onComposed]);

  useEffect(() => {
    if (bgState.status === 'success') {
      toast.success(bgState.message);
      const img = bgState.data as PickerImage | undefined;
      if (img?.id) {
        onImageCreated(img);
        setBackgroundMediaId(img.id);
        setTemplate('photo');
      }
    }
  }, [bgState, onImageCreated]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{idea ? `גרסה מהרעיון: ${idea.title}` : 'גרסה חדשה'}</DialogTitle>
          <DialogDescription>בחרו תבנית ממותגת וכתבו את הטקסטים. הצבעים, הפונטים והלוגו נלקחים מה-Brand Kit. אחרי היצירה אפשר לערוך כל שכבה.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <form key={formKey(state)} action={action} className="flex flex-col gap-3">
            {idea ? <input type="hidden" name="ideaId" value={idea.id} /> : null}
            <input type="hidden" name="template" value={template} />
            <input type="hidden" name="backgroundMediaId" value={backgroundMediaId ?? ''} />
            <div className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTemplate(t.id)}
                  className={cn('rounded-lg border p-2 text-start text-xs transition-colors hover:border-primary', template === t.id && 'border-primary ring-2 ring-primary/30')}
                >
                  <div className="font-medium">{t.label}</div>
                  <div className="text-muted-foreground">{t.description}</div>
                  {t.needsImage && !backgroundMediaId ? <Badge variant="muted" className="mt-1">דורש תמונה</Badge> : null}
                </button>
              ))}
            </div>
            <Field label="כותרת" name="headline" error={fieldError(state, 'copy.headline') ?? fieldError(state, 'headline')}>
              <Input id="headline" name="headline" required maxLength={120} defaultValue={formValue(state, 'headline', copy.headline ?? '')} autoFocus />
            </Field>
            <Field label="כותרת משנה" name="subheadline" error={fieldError(state, 'copy.subheadline')}>
              <Input id="subheadline" name="subheadline" maxLength={200} defaultValue={formValue(state, 'subheadline', copy.subheadline ?? '')} />
            </Field>
            <div className="grid grid-cols-3 gap-2">
              <Field label="קריאה לפעולה" name="cta" error={fieldError(state, 'copy.cta')}>
                <Input id="cta" name="cta" maxLength={40} defaultValue={formValue(state, 'cta', copy.cta ?? '')} />
              </Field>
              <Field label="מחיר (רק מאומת)" name="price" error={fieldError(state, 'copy.price')}>
                <Input id="price" name="price" maxLength={40} defaultValue={formValue(state, 'price', copy.price ?? '')} />
              </Field>
              <Field label="תג" name="badge" error={fieldError(state, 'copy.badge')}>
                <Input id="badge" name="badge" maxLength={30} defaultValue={formValue(state, 'badge', copy.badge ?? '')} />
              </Field>
            </div>
            <Field label="הערה לגרסה" name="note" error={fieldError(state, 'note')}>
              <Input id="note" name="note" maxLength={300} defaultValue={formValue(state, 'note', '')} />
            </Field>
            <FormMessage state={state} />
            <DialogFooter>
              <SubmitButton pendingText="יוצר גרסה…">צור גרסה ורנדר</SubmitButton>
            </DialogFooter>
          </form>

          <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
            <div>
              <div className="mb-1 text-sm font-medium">תמונת רקע</div>
              <MediaPicker brandId={brandId} images={images} value={backgroundMediaId} onChange={setBackgroundMediaId} />
            </div>
            <form key={formKey(bgState)} action={bgAction} className="flex flex-col gap-2 border-t pt-3">
              <div className="text-sm font-medium">או יצירה ב-AI</div>
              <Textarea
                name="prompt"
                rows={3}
                required
                minLength={3}
                placeholder="תיאור התמונה (ללא טקסט בתמונה)"
                defaultValue={formValue(bgState, 'prompt', idea?.visualDirection ?? '')}
                className="text-xs"
              />
              <Select name="quality" defaultValue={formValue(bgState, 'quality', 'medium')} className="h-8 text-xs">
                <option value="low">איכות נמוכה (זול)</option>
                <option value="medium">איכות בינונית</option>
                <option value="high">איכות גבוהה (יקר)</option>
              </Select>
              {fieldError(bgState, 'prompt') ? <p className="text-xs text-destructive">{fieldError(bgState, 'prompt')}</p> : null}
              <FormMessage state={bgState} />
              <SubmitButton size="sm" variant="outline" pendingText="מייצר תמונה… (עד דקה)">
                <Sparkles /> צור רקע
              </SubmitButton>
              <p className="text-[11px] text-muted-foreground">העלות נרשמת ביומן ה-AI. מעל התקרה לפעולה בודדת — יידרש אישור.</p>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
