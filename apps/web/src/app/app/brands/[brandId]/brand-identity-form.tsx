'use client';

import { useActionState } from 'react';
import type { Brand } from '@mm/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { updateBrandAction } from '../actions';

export function BrandIdentityForm({ brand, disabled }: { brand: Brand; disabled: boolean }) {
  const [state, action] = useActionState(updateBrandAction.bind(null, brand.id), idleState);
  return (
    <Card>
      <CardHeader>
        <CardTitle>זהות המותג</CardTitle>
        <CardDescription>שם, תחום, אתר וסטטוס. שינויים נרשמים ביומן הביקורת.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <fieldset disabled={disabled} className="contents">
            <Field label="שם" name="name" error={fieldError(state, 'name')}>
              <Input id="name" name="name" defaultValue={brand.name} required />
            </Field>
            <Field label="סטטוס" name="status" error={fieldError(state, 'status')}>
              <Select id="status" name="status" defaultValue={brand.status}>
                <option value="ACTIVE">פעיל</option>
                <option value="PAUSED">מושהה</option>
                <option value="ARCHIVED">בארכיון</option>
              </Select>
            </Field>
            <Field label="תחום" name="industry" error={fieldError(state, 'industry')}>
              <Input id="industry" name="industry" defaultValue={brand.industry ?? ''} />
            </Field>
            <Field label="אתר" name="websiteUrl" error={fieldError(state, 'websiteUrl')}>
              <Input id="websiteUrl" name="websiteUrl" type="url" dir="ltr" defaultValue={brand.websiteUrl ?? ''} />
            </Field>
            <Field label="תיאור" name="description" error={fieldError(state, 'description')} className="sm:col-span-2">
              <Textarea id="description" name="description" rows={4} defaultValue={brand.description ?? ''} />
            </Field>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" name="isDemo" defaultChecked={brand.isDemo} className="size-4 rounded border-input" />
              מותג דמו — נתוני המותג מסומנים כהדגמה בכל המערכת
            </label>
            <div className="text-xs text-muted-foreground sm:col-span-2" dir="ltr">
              slug: {brand.slug} · locale: {brand.locale} · tz: {brand.timezone} · currency: {brand.currency}
            </div>
          </fieldset>
          <div className="sm:col-span-2">
            <FormMessage state={state} />
          </div>
          {!disabled ? (
            <div className="sm:col-span-2">
              <SubmitButton pendingText="שומר…">שמירה</SubmitButton>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
