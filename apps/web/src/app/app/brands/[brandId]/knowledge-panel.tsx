'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { BookOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { BrandKnowledge, KnowledgeKind } from '@mm/db';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { KnowledgeStatusBadge } from '@/components/status-badges';
import { formChecked, formKey, formValue, idleState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';
import { deleteKnowledgeAction, saveKnowledgeAction } from '../actions';

const KIND_LABELS: Record<KnowledgeKind, string> = {
  WEBSITE: 'אתר החברה',
  SERVICE_PAGE: 'עמוד שירות',
  PRICING: 'מחירים',
  FAQ: 'שאלות נפוצות',
  DOCUMENT: 'מסמך מותג',
  MANUAL: 'הוזן ידנית',
  CREATIVE: 'קריאייטיב קודם',
  CAMPAIGN_DATA: 'נתוני קמפיין',
};

export function KnowledgePanel({
  brandId,
  entries,
  canEdit,
  isAdmin,
}: {
  brandId: string;
  entries: BrandKnowledge[];
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<BrandKnowledge | null | 'new'>(null);
  const [pending, startTransition] = useTransition();

  const remove = (k: BrandKnowledge) => {
    if (!confirm(`למחוק את "${k.title}"?`)) return;
    startTransition(async () => {
      const res = await deleteKnowledgeAction(brandId, k.id);
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">
        <BookOpen />
        <AlertDescription>
          המערכת לומדת רק ממידע <strong>מאושר</strong>. פריט חדש נכנס למרכז האישורים; שינוי מהותי בפריט מאושר מחייב אישור מחדש.
        </AlertDescription>
      </Alert>
      <div className="flex items-center justify-end">
        {canEdit ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> הוספת מידע
          </Button>
        ) : null}
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={BookOpen} title="מאגר הידע ריק" description="הוסיפו עמודי שירות, מחירון, שאלות נפוצות ומסמכי מותג." />
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((k) => (
            <li key={k.id} className="flex items-start justify-between gap-3 rounded-xl border bg-card p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{k.title}</span>
                  <Badge variant="outline">{KIND_LABELS[k.kind]}</Badge>
                  <KnowledgeStatusBadge status={k.status} />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{k.content}</p>
                <div className="mt-1 text-xs text-muted-foreground">
                  {k.sourceUrl ? (
                    <a href={k.sourceUrl} target="_blank" rel="noreferrer" className="underline" dir="ltr">
                      {k.sourceUrl}
                    </a>
                  ) : null}
                  {k.sourceUrl ? ' · ' : ''}
                  עודכן {formatDateTime(k.updatedAt)}
                </div>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label="עריכה" onClick={() => setEditing(k)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="מחיקה" disabled={pending} onClick={() => remove(k)}>
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <KnowledgeDialog brandId={brandId} entry={editing === 'new' ? null : editing} isAdmin={isAdmin} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function KnowledgeDialog({
  brandId,
  entry,
  isAdmin,
  onClose,
}: {
  brandId: string;
  entry: BrandKnowledge | null;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const [state, action] = useActionState(saveKnowledgeAction.bind(null, brandId, entry?.id ?? null), idleState);
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{entry ? 'עריכת מידע' : 'הוספת מידע למותג'}</DialogTitle>
          <DialogDescription>טקסט מאומת בלבד — עמודי אתר, מחירון, שאלות נפוצות, מסמכים.</DialogDescription>
        </DialogHeader>
        <form key={formKey(state)} action={action} className="grid gap-4 sm:grid-cols-2">
          <Field label="סוג" name="kind" error={fieldError(state, 'kind')}>
            <Select id="kind" name="kind" defaultValue={formValue(state, 'kind', entry?.kind ?? 'MANUAL')}>
              {(Object.keys(KIND_LABELS) as KnowledgeKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="כותרת" name="title" error={fieldError(state, 'title')}>
            <Input id="title" name="title" defaultValue={formValue(state, 'title', entry?.title)} required autoFocus />
          </Field>
          <Field label="מקור (URL)" name="sourceUrl" error={fieldError(state, 'sourceUrl')} className="sm:col-span-2">
            <Input id="sourceUrl" name="sourceUrl" type="url" dir="ltr" defaultValue={formValue(state, 'sourceUrl', entry?.sourceUrl)} />
          </Field>
          <Field label="תוכן" name="content" error={fieldError(state, 'content')} className="sm:col-span-2">
            <Textarea id="content" name="content" rows={10} defaultValue={formValue(state, 'content', entry?.content)} required />
          </Field>
          {!entry && isAdmin ? (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="approveNow" defaultChecked={formChecked(state, 'approveNow', false)} className="size-4 rounded border-input" />
              אשר מיד (מנהל מותג) — בלי לעבור דרך מרכז האישורים
            </label>
          ) : null}
          <div className="sm:col-span-2">
            <FormMessage state={state} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <SubmitButton pendingText="שומר…">{entry ? 'שמירה' : 'הוספה'}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
