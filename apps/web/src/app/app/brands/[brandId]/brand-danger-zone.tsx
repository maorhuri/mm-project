'use client';

import { useActionState, useState } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { formKey, idleState } from '@/lib/action-state';
import { deleteBrandAction } from '../actions';

export function BrandDangerZone({ brandId, slug, name }: { brandId: string; slug: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">אזור מסוכן</CardTitle>
        <CardDescription>להשהיה הפיכה השתמשו בסטטוס &quot;מושהה&quot; או &quot;בארכיון&quot;. מחיקה היא סופית.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 /> מחיקת המותג
        </Button>
        {open ? <DeleteDialog brandId={brandId} slug={slug} name={name} onClose={() => setOpen(false)} /> : null}
      </CardContent>
    </Card>
  );
}

function DeleteDialog({ brandId, slug, name, onClose }: { brandId: string; slug: string; name: string; onClose: () => void }) {
  const [state, action] = useActionState(deleteBrandAction.bind(null, brandId), idleState);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>למחוק את &quot;{name}&quot;?</DialogTitle>
          <DialogDescription>כל נתוני המותג יימחקו לצמיתות: Brand Kit, מוצרים, מאגר ידע, ספריית המדיה והקבצים באחסון, אישורים והתראות.</DialogDescription>
        </DialogHeader>
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>הפעולה אינה הפיכה. יומן הביקורת נשמר.</AlertDescription>
        </Alert>
        <form key={formKey(state)} action={action} className="flex flex-col gap-4">
          <Field label={`לאישור, הקלידו: ${slug}`} name="confirm" error={fieldError(state, 'confirm')}>
            <Input id="confirm" name="confirm" dir="ltr" autoComplete="off" placeholder={slug} required autoFocus />
          </Field>
          <FormMessage state={state} />
          <DialogFooter>
            <SubmitButton variant="destructive" pendingText="מוחק…">
              מחיקה לצמיתות
            </SubmitButton>
            <Button type="button" variant="ghost" onClick={onClose}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
