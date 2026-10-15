'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/action-state';
import { mfaVerifyAction } from '../actions';

export function MfaForm({ next }: { next: string }) {
  const [state, action] = useActionState(mfaVerifyAction, idleState);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" /> הזינו קוד מהאפליקציה
        </CardTitle>
        <CardDescription>פתחו את Google Authenticator והקלידו את הקוד בן 6 הספרות, או הזינו קוד גיבוי (xxxxx-xxxxx).</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />
          <Field label="קוד אימות" name="code" error={fieldError(state, 'code')}>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              className="text-center font-mono text-lg tracking-[0.3em]"
              maxLength={16}
              required
              autoFocus
            />
          </Field>
          <FormMessage state={state} />
          <SubmitButton className="w-full" pendingText="מאמת…">
            אישור
          </SubmitButton>
          <Link href="/login" className="text-center text-xs text-muted-foreground underline">
            חזרה להתחברות
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
