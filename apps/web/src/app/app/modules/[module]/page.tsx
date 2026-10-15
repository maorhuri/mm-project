import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Construction } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { MODULES } from '@/lib/nav';

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const info = MODULES[module];
  if (!info) notFound();

  return (
    <>
      <PageHeader title={info.title} badges={<Badge variant="outline">שלב {info.phase} במפת הדרכים</Badge>} />
      <Alert variant="warning">
        <Construction />
        <AlertTitle>המודול הזה עדיין לא נבנה</AlertTitle>
        <AlertDescription>
          לפי כללי הפרויקט לא מוצגים כאן מסכים מדומים או מספרים שלא הגיעו מ-API אמיתי. המודול ייפתח כשהשלב שלו יושלם
          וייבדק.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>מה ייבנה</CardTitle>
          <CardDescription>{info.summary}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {info.deliverables.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/app">חזרה לסקירה</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
