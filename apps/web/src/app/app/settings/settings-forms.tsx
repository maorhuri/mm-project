'use client';

import { useActionState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/action-state';
import { changePasswordAction, revokeOtherSessionsAction } from './actions';

export function ChangePasswordForm() {
  const [state, action] = useActionState(changePasswordAction, idleState);
  return (
    <Card>
      <CardHeader>
        <CardTitle>שינוי סיסמה</CardTitle>
        <CardDescription>לפחות 10 תווים. שינוי סיסמה מנתק את כל החיבורים האחרים.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-3">
          <Field label="סיסמה נוכחית" name="currentPassword" error={fieldError(state, 'currentPassword')}>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" dir="ltr" required />
          </Field>
          <Field label="סיסמה חדשה" name="newPassword" error={fieldError(state, 'newPassword')}>
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" dir="ltr" required minLength={10} />
          </Field>
          <Field label="אימות סיסמה חדשה" name="confirmPassword" error={fieldError(state, 'confirmPassword')}>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" dir="ltr" required minLength={10} />
          </Field>
          <FormMessage state={state} />
          <SubmitButton className="self-start" pendingText="מעדכן…">
            עדכון סיסמה
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}

export function RevokeSessionsButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const res = await revokeOtherSessionsAction();
          if (res.status === 'error') toast.error(res.message);
          else toast.success(res.message);
        })
      }
    >
      ניתוק חיבורים אחרים
    </Button>
  );
}
