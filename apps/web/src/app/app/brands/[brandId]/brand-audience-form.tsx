'use client';

import { useActionState, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { BrandSettingsDto } from '@mm/core';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/action-state';
import { updateBrandAudienceAction } from '../actions';

interface Audience {
  name: string;
  description?: string;
}

const TARGETS: { key: string; label: string }[] = [
  { key: 'marketingPosts', label: 'פוסטים שיווקיים' },
  { key: 'professionalPosts', label: 'פוסטים מקצועיים' },
  { key: 'securityPosts', label: 'פוסטים אבטחה / גיבויים' },
  { key: 'reels', label: 'סרטוני Reels' },
];

export function BrandAudienceForm({ brandId, settings, disabled }: { brandId: string; settings: BrandSettingsDto; disabled: boolean }) {
  const [state, action] = useActionState(updateBrandAudienceAction.bind(null, brandId), idleState);
  const tone = (settings.tone ?? {}) as unknown as { voice?: string; style?: string; language?: string; doNots?: string[] };
  const targets = (settings.contentTargets ?? {}) as Record<string, number>;
  const [audiences, setAudiences] = useState<Audience[]>(
    Array.isArray(settings.audiences) ? (settings.audiences as unknown as Audience[]) : [],
  );

  const update = (i: number, patch: Partial<Audience>) =>
    setAudiences((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="audiencesJson" value={JSON.stringify(audiences.filter((a) => a.name.trim()))} />
      <fieldset disabled={disabled} className="contents">
        <Card>
          <CardHeader>
            <CardTitle>קהלי יעד</CardTitle>
            <CardDescription>לכל קהל שם ותיאור קצר. ישמש לבחירת מסרים, קריאייטיבים וקהלים בקמפיינים.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {audiences.length === 0 ? <p className="text-sm text-muted-foreground">לא הוגדרו קהלים.</p> : null}
            {audiences.map((a, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
                <Input value={a.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="שם הקהל" aria-label="שם הקהל" />
                <Input value={a.description ?? ''} onChange={(e) => update(i, { description: e.target.value })} placeholder="תיאור" aria-label="תיאור הקהל" />
                {!disabled ? (
                  <Button type="button" variant="ghost" size="icon" aria-label="הסרה" onClick={() => setAudiences((p) => p.filter((_, idx) => idx !== i))}>
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            ))}
            {!disabled ? (
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAudiences((p) => [...p, { name: '', description: '' }])}>
                <Plus /> הוספת קהל
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>טון וכללי כתיבה</CardTitle>
            <CardDescription>ה-AI יכתוב לפי ההנחיות האלה בלבד. טענות אסורות נחסמות בבקרת האיכות.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="קול המותג" name="tone_voice" error={fieldError(state, 'tone.voice')} className="sm:col-span-2">
              <Textarea id="tone_voice" name="tone_voice" rows={2} defaultValue={tone.voice ?? ''} />
            </Field>
            <Field label="סגנון כתיבה" name="tone_style" error={fieldError(state, 'tone.style')} className="sm:col-span-2">
              <Textarea id="tone_style" name="tone_style" rows={2} defaultValue={tone.style ?? ''} />
            </Field>
            <Field label="שפה" name="tone_language" error={fieldError(state, 'tone.language')}>
              <Input id="tone_language" name="tone_language" defaultValue={tone.language ?? 'he-IL'} dir="ltr" />
            </Field>
            <Field label="מצב פרסום" name="publishingMode" error={fieldError(state, 'publishingMode')}>
              <Select id="publishingMode" name="publishingMode" defaultValue={settings.publishingMode}>
                <option value="MANUAL">ידני — כל פוסט מחייב אישור</option>
                <option value="SEMI_AUTO">חצי-אוטומטי — אישור לוח חודשי (ברירת מחדל)</option>
                <option value="AUTO">אוטומטי — לפי מדיניות מאושרת</option>
              </Select>
            </Field>
            <ListField label="אסור (Do nots)" name="tone_doNots" values={tone.doNots ?? []} />
            <ListField label="טענות שיווקיות מותרות" name="allowedClaims" values={settings.allowedClaims} />
            <ListField label="טענות אסורות" name="forbiddenClaims" values={settings.forbiddenClaims} />
            <ListField label="מילות מפתח" name="keywords" values={settings.keywords} />
            <ListField label="Hashtags" name="hashtags" values={settings.hashtags} dir="ltr" />
            <ListField label="קריאות לפעולה (CTA)" name="ctaPresets" values={settings.ctaPresets} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>יעדי תוכן ותקציב</CardTitle>
            <CardDescription>יעדים חודשיים — ניתנים לשינוי בכל עת, בלי שינוי בקוד.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {TARGETS.map((t) => (
              <Field key={t.key} label={t.label} name={`target_${t.key}`}>
                <Input id={`target_${t.key}`} name={`target_${t.key}`} type="number" min={0} max={500} defaultValue={targets[t.key] ?? ''} />
              </Field>
            ))}
            <Field label="תקציב פרסום חודשי (₪)" name="monthlyAdBudgetIls" error={fieldError(state, 'monthlyAdBudgetIls')}>
              <Input id="monthlyAdBudgetIls" name="monthlyAdBudgetIls" type="number" min={0} step={50} defaultValue={settings.monthlyAdBudgetIls ?? ''} />
            </Field>
          </CardContent>
        </Card>
      </fieldset>
      <FormMessage state={state} />
      {!disabled ? <SubmitButton className="self-start" pendingText="שומר…">שמירה</SubmitButton> : null}
    </form>
  );
}

function ListField({ label, name, values, dir }: { label: string; name: string; values: string[]; dir?: 'ltr' | 'rtl' }) {
  return (
    <Field label={label} name={name} hint="פריט אחד בכל שורה">
      <Textarea id={name} name={name} rows={4} defaultValue={values.join('\n')} dir={dir} />
    </Field>
  );
}
