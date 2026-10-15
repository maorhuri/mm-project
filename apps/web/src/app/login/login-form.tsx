'use client';

import { useActionState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/actions';
import { loginAction } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, idleState);
  return (
    <Card>
      <CardHeader>
        <CardTitle>התחברות</CardTitle>
        <CardDescription>הזינו את פרטי החשבון שלכם</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Field label="אימייל" name="email" error={fieldError(state, 'email')}>
            <Input id="email" name="email" type="email" autoComplete="email" dir="ltr" required autoFocus />
          </Field>
          <Field label="סיסמה" name="password" error={fieldError(state, 'password')}>
            <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
          </Field>
          <FormMessage state={state} />
          <SubmitButton className="w-full" pendingText="מתחבר…">
            כניסה
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
