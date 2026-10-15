'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Plus, Swords, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BrandCompetitor } from '@mm/db';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { createCompetitorAction, deleteCompetitorAction } from '../actions';

export function CompetitorsPanel({ brandId, competitors, canEdit }: { brandId: string; competitors: BrandCompetitor[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, action] = useActionState(createCompetitorAction.bind(null, brandId), idleState);

  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      setOpen(false);
    }
  }, [state]);

  const remove = (c: BrandCompetitor) => {
    if (!confirm(`להסיר את "${c.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteCompetitorAction(brandId, c.id);
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">מתחרים לניתוח (שלב 2). המחקר יתבסס רק על מקורות זמינים ומותרים.</p>
        {canEdit ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus /> הוספת מתחרה
          </Button>
        ) : null}
      </div>
      {competitors.length === 0 ? (
        <EmptyState icon={Swords} title="לא הוגדרו מתחרים" />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {competitors.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="min-w-0">
                <div className="font-medium">{c.name}</div>
                {c.websiteUrl ? (
                  <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline" dir="ltr">
                    {c.websiteUrl}
                  </a>
                ) : null}
                {c.notes ? <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p> : null}
              </div>
              {canEdit ? (
                <Button variant="ghost" size="icon" aria-label="הסרה" disabled={pending} onClick={() => remove(c)}>
                  <Trash2 />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>הוספת מתחרה</DialogTitle>
            <DialogDescription>שם, אתר והערות.</DialogDescription>
          </DialogHeader>
          <form action={action} className="flex flex-col gap-4">
            <Field label="שם" name="name" error={fieldError(state, 'name')}>
              <Input id="name" name="name" required autoFocus />
            </Field>
            <Field label="אתר" name="websiteUrl" error={fieldError(state, 'websiteUrl')}>
              <Input id="websiteUrl" name="websiteUrl" type="url" dir="ltr" />
            </Field>
            <Field label="הערות" name="notes" error={fieldError(state, 'notes')}>
              <Textarea id="notes" name="notes" rows={3} />
            </Field>
            <FormMessage state={state} />
            <DialogFooter>
              <SubmitButton pendingText="שומר…">הוספה</SubmitButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
