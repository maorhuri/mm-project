'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lightbulb, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { callAction, formKey, formValue, idleState } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import { autoVideoAction, videoIdeasAction } from './actions';

interface Concept {
  title: string;
  angle: string;
  hook: string;
  brief: string;
  productId: string | null;
}
import { VOICES } from './create-video-dialog';

export function AutoVideoForm({ products, characters, hasVideoProvider, hasAvatarProvider }: { products: { id: string; name: string }[]; characters: { id: string; name: string }[]; hasVideoProvider: boolean; hasAvatarProvider: boolean }) {
  const [state, action] = useActionState(autoVideoAction, idleState);
  const router = useRouter();
  const [brief, setBrief] = useState(formValue(state, 'brief', ''));
  const [productId, setProductId] = useState(formValue(state, 'productId', ''));
  const [characterId, setCharacterId] = useState(formValue(state, 'characterId', ''));
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [thinking, startThinking] = useTransition();
  const getIdeas = () =>
    startThinking(async () => {
      const res = await callAction(videoIdeasAction());
      if (res.status === 'error') toast.error(res.message);
      else {
        setConcepts(res.data as Concept[]);
        setChosen(null);
      }
    });
  const choose = (i: number) => {
    const c = concepts[i]!;
    setChosen(i);
    setBrief(`${c.hook ? `${c.hook}\n` : ''}${c.brief}`);
    if (c.productId) setProductId(c.productId);
  };
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
          {hasVideoProvider ? ' כווידאו AI עם תנועה אמיתית (Kling 3.0)' : ' כתמונת AI עם תנועת מצלמה (לאנימציה אמיתית חברו fal.ai באינטגרציות)'}
          , מוסיפה קריינות, מוזיקה, מעברים וכתוביות — ומתחילה להפיק.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form key={formKey(state)} action={action} className="grid gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-2 md:col-span-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">רעיון לסרטון</span>
              <Button type="button" size="sm" variant="outline" disabled={thinking} onClick={getIdeas}>
                <Lightbulb /> {thinking ? 'מנהל הקריאייטיב חושב…' : concepts.length ? 'עוד 4 רעיונות' : 'תן לי 4 רעיונות'}
              </Button>
            </div>
            {concepts.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {concepts.map((c, i) => (
                  <button key={i} type="button" onClick={() => choose(i)} className={cn('rounded-lg border p-3 text-start transition-colors hover:border-primary', chosen === i && 'border-primary bg-primary/5 ring-2 ring-primary/30')}>
                    <div className="text-sm font-semibold">{c.title}</div>
                    {c.angle ? <div className="text-xs text-muted-foreground">{c.angle}</div> : null}
                    {c.hook ? <div className="mt-1 text-sm">״{c.hook}״</div> : null}
                    <div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.brief}</div>
                  </button>
                ))}
              </div>
            ) : null}
            <Textarea id="brief" name="brief" rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="בחרו אחד מהרעיונות, כתבו רעיון משלכם — או השאירו ריק והמערכת תמציא קונספט בעצמה." />
            {fieldError(state, 'brief') ? <p className="text-xs text-destructive">{fieldError(state, 'brief')}</p> : null}
          </div>
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
              <option value="flagship">פרימיום לפרסום (Kling 3.0 Pro)</option>
              <option value="balanced">מאוזן (Kling 3.0 Standard)</option>
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
            <Select id="characterId" name="characterId" value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">— ללא —</option>
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="מוצר / שירות" name="productId" error={fieldError(state, 'productId')}>
            <Select id="productId" name="productId" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— המותג בכללותו —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {characterId ? (
            <Field label="תפקיד הדמות" name="characterMode" error={fieldError(state, 'characterMode')}>
              <Select id="characterMode" name="characterMode" defaultValue={formValue(state, 'characterMode', 'presenter')}>
                <option value="presenter">מציגה: פותחת וסוגרת בדיבור, מופיעה בכל הסצנות</option>
                <option value="all">מופיעה בכל הסצנות (בתוך האקשן)</option>
                <option value="talking">מדברת למצלמה בכל הסצנות</option>
              </Select>
            </Field>
          ) : null}
          <Field label="קריין" name="voice" error={fieldError(state, 'voice')}>
            <Select id="voice" name="voice" defaultValue={formValue(state, 'voice', 'onyx')}>
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm md:col-span-4">
            <input type="checkbox" name="reviewFirst" defaultChecked className="size-4" /> לעצור לפני הרינדור כדי שאבדוק ואאשר כל סצנה (מומלץ)
          </label>
          <div className="flex items-end">
            <SubmitButton className="w-full" pendingText="כותב תסריט ומכין סצנות…">
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
