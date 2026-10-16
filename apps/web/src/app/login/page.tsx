import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'התחברות' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // A VALIDATED session goes straight in; a stale cookie simply shows the form
  // (the next successful login overwrites it).
  const session = await getSession();
  if (session) redirect(next?.startsWith('/app') ? next : '/app');

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
            MM
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">MM Marketing OS</h1>
            <p className="text-sm text-muted-foreground">מערכת הפעלה שיווקית רב-מותגית</p>
          </div>
        </div>
        <LoginForm next={next ?? ''} />
      </div>
    </div>
  );
}
