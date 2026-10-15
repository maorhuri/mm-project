import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { MFA_COOKIE, verifyMfaChallenge } from '@mm/core';
import { MfaForm } from './mfa-form';

export const metadata: Metadata = { title: 'אימות דו-שלבי' };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const challenge = verifyMfaChallenge((await cookies()).get(MFA_COOKIE)?.value);
  if (!challenge) redirect('/login');
  const { next } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">
            MM
          </span>
          <div>
            <h1 className="text-xl font-semibold leading-tight">אימות דו-שלבי</h1>
            <p className="text-sm text-muted-foreground">שלב שני בכניסה לחשבון</p>
          </div>
        </div>
        <MfaForm next={next ?? ''} />
      </div>
    </div>
  );
}
