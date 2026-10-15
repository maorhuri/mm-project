import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-6xl font-bold text-primary">404</p>
      <h1 className="text-xl font-semibold">העמוד לא נמצא</h1>
      <p className="text-sm text-muted-foreground">הכתובת שגויה או שאין לכם גישה לפריט המבוקש.</p>
      <Button asChild>
        <Link href="/app">חזרה לסקירה</Link>
      </Button>
    </div>
  );
}
