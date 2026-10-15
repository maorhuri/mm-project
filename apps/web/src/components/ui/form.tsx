'use client';

import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from './button';
import type { ButtonProps } from './button';
import { Label } from './label';
import type { ActionState } from '@/lib/actions';
import { cn } from '@/lib/utils';

export function SubmitButton({ children, pendingText, ...props }: ButtonProps & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </Button>
  );
}

interface FieldProps {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, name, error, hint, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={name}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === 'error') {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status === 'success' && state.message) {
    return (
      <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm" role="status">
        {state.message}
      </p>
    );
  }
  return null;
}

export function fieldError(state: ActionState, name: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors?.[name] : undefined;
}
