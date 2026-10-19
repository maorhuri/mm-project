'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formKey, formValue, idleState } from '@/lib/action-state';
import { autoVideoAction } from './actions';
import { VOICES } from './create-video-dialog';

export function AutoVideoForm({ products, characters, hasVideoProvider, hasAvatarProvider }: { products: { id: string; name: string }[]; characters: { id: string; name: string }[]; hasVideoProvider: boolean; hasAvatarProvider: boolean }) {
  const [state, action] = useActionState(autoVideoAction, idleState);
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      const data = state.data as { id?: string; approvalRequired?: boolean } | undefined;
      (data?.approvalRequired ? toast.info : toast.success)(state.message, { duration: 12_000 });
      if (data?.id) router.push(`/app/video/${data.id}`);
    }
  }, [state, router]);
  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="size-5 text-primary" /> סרטון אוטומטי — מתיאור אחד לסרטון מוכן
        </CardTitle>
        <CardDescription>
          תארו את הסרטון. המערכת כותבת תסריט פרסומי על בסיס המידע המאושר של המותג, מייצרת כל סצנה
          {hasVideoProvider ? ' כווידאו AI עם תנועה אמיתית (Veo 3.1)' : ' כתמונת AI עם תנועת מצלמה (לאנימציה אמיתית חברו Google Gemini באינטגרציות)'}
          , מוסיפה קריינות, מוזיקה, מעברים וכתוביות — ומתחילה להפיק.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={formKey(state)} action={action} className="grid gap-3 md:grid-cols-4">
          <Field label="על מה הסרטון?" name="brief" error={fieldError(state, 'brief')} className="md:col-span-4">
            <Textarea id="brief" name="brief" rows={3} required minLength={8} defaultValue={formValue(state, 'brief', '')} placeholder="למשל: רילס שמציג מעבר אתר וורדפרס לשרתים שלנו בלי השבתה, טון אנרגטי, סיום בהצעה לייעוץ חינם" />
          </Field>
          <Field label="פורמט" name="aspect" error={fieldError(state, 'aspect')}>
            <Select id="aspect" name="aspect" defaultValue={formValue(state, 'aspect', 'R9X16')}>
              <option value="R9X16">רילס / סטורי 9:16</option>
              <option value="R4X5">פיד 4:5</option>
              <option value="R1X1">ריבוע 1:1</option>
              <option value="R16X9">רחב 16:9</option>
            </Select>
          </Field>
          <Field label="איכות" name="videoTier" error={fieldError(state, 'videoTier')}>
            <Select id="videoTier" name="videoTier" defaultValue={formValue(state, 'videoTier', 'flagship')}>
              <option value="flagship">פרימיום לפרסום (Veo 3.1)</option>
              <option value="balanced">מאוזן (Veo 3.1 Fast)</option>
              <option value="economy">חסכוני (Veo 3.1 Lite)</option>
            </Select>
          </Field>
          <Field label="אורך" name="targetSeconds" error={fieldError(state, 'targetSeconds')}>
            <Select id="targetSeconds" name="targetSeconds" defaultValue={formValue(state, 'targetSeconds', '30')}>
              <option value="15">15 שניות</option>
              <option value="30">30 שניות</option>
              <option value="45">45 שניות</option>
              <option value="60">60 שניות</option>
            </Select>
          </Field>
          <Field label="סצנות" name="sceneCount" error={fieldError(state, 'sceneCount')}>
            <Select id="sceneCount" name="sceneCount" defaultValue={formValue(state, 'sceneCount', '5')}>
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`דמות מציגה${hasAvatarProvider ? '' : ' (לסנכרון שפתיים חברו fal.ai)'}`} name="characterId" error={fieldError(state, 'characterId')}>
            <Select id="characterId" name="characterId" defaultValue={formValue(state, 'characterId', '')}>
              <option value="">— ללא —</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="מוצר / שירות" name="productId" error={fieldError(state, 'productId')}>
            <Select id="productId" name="productId" defaultValue={formValue(state, 'productId', '')}>
              <option value="">— המותג בכללותו —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="קריין" name="voice" error={fieldError(state, 'voice')}>
            <Select id="voice" name="voice" defaultValue={formValue(state, 'voice', 'onyx')}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <SubmitButton className="w-full" pendingText="כותב תסריט ומתחיל הפקה…">
              <Wand2 /> הפק סרטון
            </SubmitButton>
          </div>
          <div className="md:col-span-4">
            <FormMessage state={state} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
