'use client';

import { useEffect } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>משהו השתבש</AlertTitle>
        <AlertDescription>
          {error.message || 'שגיאה בלתי צפויה.'}
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
