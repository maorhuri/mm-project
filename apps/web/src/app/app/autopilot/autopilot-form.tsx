'use client';

import { useActionState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Rocket, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { AutopilotConfig } from '@mm/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { callAction, formKey, idleState } from '@/lib/action-state';
import { runAutopilotNowAction, saveAutopilotAction } from './actions';

export function AutopilotForm({ cfg, characters, canAdmin, canRun }: { cfg: AutopilotConfig; characters: { id: string; name: string }[]; canAdmin: boolean; canRun: boolean }) {
  const [state, action] = useActionState(saveAutopilotAction, idleState);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
    }
  }, [state, router]);
  return (
    <div className="flex flex-col gap-4">
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle>צור עכשיו</CardTitle>
          <CardDescription>מחזור אחד מיד: קונספט חדש, סרטון ופוסט תמונה, כיתוב, תזמון ושליחה לאישור.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            disabled={!canRun || pending}
            onClick={() =>
              startTransition(async () => {
                const res = await callAction(runAutopilotNowAction());
                if (res.status === 'error') toast.error(res.message);
                else toast.success(res.message, { duration: 10_000 });
              })
            }
          >
            <Rocket /> {pending ? 'מתחיל…' : 'צור תוכן עכשיו'}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>הגדרות</CardTitle>
          <CardDescription>כל בוקר ב-07:00 הטייס משלים את היעדים השבועיים בהדרגה. העלויות נספרות בתקציב ה-AI החודשי של המותג.</CardDescription>
        </CardHeader>
        <CardContent>
          <form key={formKey(state)} action={action} className="flex flex-col gap-3">
            <fieldset disabled={!canAdmin} className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} className="size-4" /> הטייס האוטומטי פעיל
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Field label="סרטונים בשבוע" name="videosPerWeek" error={fieldError(state, 'videosPerWeek')}>
                  <Select id="videosPerWeek" name="videosPerWeek" defaultValue={String(cfg.videosPerWeek)}>
                    {[0, 1, 2, 3, 4, 5, 7].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="פוסטי תמונה בשבוע" name="imagePostsPerWeek" error={fieldError(state, 'imagePostsPerWeek')}>
                  <Select id="imagePostsPerWeek" name="imagePostsPerWeek" defaultValue={String(cfg.imagePostsPerWeek)}>
                    {[0, 2, 3, 4, 5, 7, 10, 14].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name="channels" value="FACEBOOK_PAGE" defaultChecked={cfg.channels.includes('FACEBOOK_PAGE')} className="size-4" /> פייסבוק
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" name="channels" value="INSTAGRAM" defaultChecked={cfg.channels.includes('INSTAGRAM')} className="size-4" /> אינסטגרם
                </label>
              </div>
              <Field label="איכות וידאו" name="tier" error={fieldError(state, 'tier')}>
                <Select id="tier" name="tier" defaultValue={cfg.tier}>
                  <option value="flagship">פרימיום לפרסום (Kling 3.0 Pro)</option>
                  <option value="balanced">מאוזן (Kling 3.0 Standard)</option>
                </Select>
              </Field>
              <Field label="דמות מציגה (אופציונלי)" name="characterId" error={fieldError(state, 'characterId')}>
                <Select id="characterId" name="characterId" defaultValue={cfg.characterId ?? ''}>
                  <option value="">— ללא —</option>
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="reviewBeforeRender" defaultChecked={cfg.reviewBeforeRender} className="size-4" /> לעצור כל סרטון לפני רינדור לאישור הסצנות שלי
              </label>
              <Field label="שעת פרסום מועדפת" name="postHour" error={fieldError(state, 'postHour')}>
                <Select id="postHour" name="postHour" defaultValue={String(cfg.postHour)}>
                  {[8, 10, 12, 14, 17, 19, 20, 21].map((h) => (
                    <option key={h} value={h}>
                      {h}:00
                    </option>
                  ))}
                </Select>
              </Field>
            </fieldset>
            <FormMessage state={state} />
            {canAdmin ? (
              <SubmitButton pendingText="שומר…">
                <Save /> שמירה
              </SubmitButton>
            ) : (
              <p className="text-xs text-muted-foreground">רק מנהל מותג יכול לשנות הגדרות.</p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
