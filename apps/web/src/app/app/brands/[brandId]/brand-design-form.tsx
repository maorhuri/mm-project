'use client';

import { useActionState } from 'react';
import type { BrandSettingsDto } from '@mm/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { updateBrandDesignAction } from '../actions';

const COLOR_KEYS: { key: string; label: string }[] = [
  { key: 'primary', label: 'ראשי' },
  { key: 'secondary', label: 'משני' },
  { key: 'accent', label: 'הדגשה' },
  { key: 'background', label: 'רקע' },
  { key: 'foreground', label: 'טקסט' },
];

export function BrandDesignForm({ brandId, settings, disabled }: { brandId: string; settings: BrandSettingsDto; disabled: boolean }) {
  const [state, action] = useActionState(updateBrandDesignAction.bind(null, brandId), idleState);
  const colors = (settings.colors ?? {}) as Record<string, string>;
  const fonts = (settings.fonts ?? {}) as Record<string, string>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>צבעים, פונטים וסגנון גרפי</CardTitle>
        <CardDescription>
          ערכים אלה יזינו את תבניות המיתוג בסטודיו הקריאייטיב. פונטים חייבים להיות מורשים לשימוש מסחרי.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-6">
          <fieldset disabled={disabled} className="contents">
            <div>
              <h4 className="mb-3 text-sm font-medium">צבעי מותג</h4>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
                {COLOR_KEYS.map(({ key, label }) => (
                  <ColorField key={key} name={`color_${key}`} label={label} value={colors[key] ?? ''} error={fieldError(state, `colors.${key}`)} />
                ))}
              </div>
              {Object.keys(colors).length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">עדיין לא הוגדרו צבעים למותג.</p>
              ) : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="פונט כותרות" name="font_heading" error={fieldError(state, 'fonts.heading')}>
                <Input id="font_heading" name="font_heading" defaultValue={fonts.heading ?? ''} placeholder="למשל: Heebo" />
              </Field>
              <Field label="פונט טקסט" name="font_body" error={fieldError(state, 'fonts.body')}>
                <Input id="font_body" name="font_body" defaultValue={fonts.body ?? ''} placeholder="למשל: Assistant" />
              </Field>
            </div>
            <Field label="סגנון גרפי" name="graphicStyle" error={fieldError(state, 'graphicStyle')} hint="תיאור חופשי שינחה את יצירת הקריאייטיבים: מינימליסטי, טכנולוגי, חם, צילומי וכו'">
              <Textarea id="graphicStyle" name="graphicStyle" rows={4} defaultValue={settings.graphicStyle ?? ''} />
            </Field>
          </fieldset>
          <FormMessage state={state} />
          {!disabled ? <SubmitButton className="self-start" pendingText="שומר…">שמירה</SubmitButton> : null}
        </form>
      </CardContent>
    </Card>
  );
}

function ColorField({ name, label, value, error }: { name: string; label: string; value: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={name} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} — בחירת צבע`}
          defaultValue={value || '#000000'}
          className="size-9 cursor-pointer rounded-md border border-input bg-background p-0.5"
          onChange={(e) => {
            const text = e.currentTarget.form?.elements.namedItem(name) as HTMLInputElement | null;
            if (text) text.value = e.currentTarget.value;
          }}
        />
        <Input id={name} name={name} defaultValue={value} placeholder="#RRGGBB" dir="ltr" className="font-mono" maxLength={7} />
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
