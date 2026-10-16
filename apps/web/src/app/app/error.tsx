'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // A deploy happened while this page was open: server-action ids changed. Reload once to pick up the new build.
    if (/Server Action .* was not found|failed-to-find-server-action/i.test(error.message)) {
      const key = 'mm:reloaded-for-action';
      if (sessionStorage.getItem(key) !== error.digest) {
        sessionStorage.setItem(key, error.digest ?? '1');
        window.location.reload();
      }
    }
  }, [error]);
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>משהו השתבש</AlertTitle>
        <AlertDescription>
          {/Server Action .* was not found/i.test(error.message) ? 'המערכת עודכנה בזמן שהדף היה פתוח — טוענים מחדש…' : error.message || 'שגיאה בלתי צפויה.'}
          {error.digest ? (
            <span className="block text-xs opacity-70" dir="ltr">
              ref: {error.digest}
            </span>
          ) : null}
        </AlertDescription>
      </Alert>
      <Button onClick={reset} className="self-start">
        ניסיון חוזר
      </Button>
    </div>
  );
}
