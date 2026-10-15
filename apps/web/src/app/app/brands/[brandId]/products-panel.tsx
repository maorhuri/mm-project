'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDto } from '@mm/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { idleState } from '@/lib/actions';
import { formatIls } from '@/lib/format';
import { deleteProductAction, saveProductAction } from '../actions';

export function ProductsPanel({ brandId, products, canEdit }: { brandId: string; products: ProductDto[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<ProductDto | null | 'new'>(null);
  const [pending, startTransition] = useTransition();

  const remove = (p: ProductDto) => {
    if (!confirm(`למחוק את "${p.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteProductAction(brandId, p.id);
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          מוצרים ושירותים מאומתים בלבד. ה-AI לא ימציא תכונות, מחירים או הבטחות שאינם כתובים כאן.
        </p>
        {canEdit ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> מוצר חדש
          </Button>
        ) : null}
      </div>

      {products.length === 0 ? (
        <EmptyState icon={Package} title="אין מוצרים עדיין" description="הוסיפו את קווי המוצרים והשירותים של המותג." />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>שם</TableHead>
                <TableHead>קטגוריה</TableHead>
                <TableHead>מחיר החל מ-</TableHead>
                <TableHead>קהלים</TableHead>
                <TableHead>סטטוס</TableHead>
                {canEdit ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    {p.name}
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {p.slug}
                    </div>
                  </TableCell>
                  <TableCell>{p.category ?? '—'}</TableCell>
                  <TableCell>
                    {formatIls(p.priceFromIls)}
                    {p.pricingNote ? <div className="text-xs text-muted-foreground">{p.pricingNote}</div> : null}
                  </TableCell>
                  <TableCell className="max-w-xs text-xs text-muted-foreground">
                    {Array.isArray(p.audiences) ? (p.audiences as string[]).join(', ') : '—'}
                  </TableCell>
                  <TableCell>{p.isActive ? <Badge variant="success">פעיל</Badge> : <Badge variant="muted">לא פעיל</Badge>}</TableCell>
                  {canEdit ? (
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" aria-label="עריכה" onClick={() => setEditing(p)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="מחיקה" disabled={pending} onClick={() => remove(p)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editing ? (
        <ProductDialog brandId={brandId} product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function ProductDialog({ brandId, product, onClose }: { brandId: string; product: ProductDto | null; onClose: () => void }) {
  const [state, action] = useActionState(saveProductAction.bind(null, brandId, product?.id ?? null), idleState);
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);

  const features = Array.isArray(product?.features) ? (product!.features as string[]) : [];
  const audiences = Array.isArray(product?.audiences) ? (product!.audiences as string[]) : [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product ? 'עריכת מוצר' : 'מוצר / שירות חדש'}</DialogTitle>
          <DialogDescription>רק מידע מאומת. מחירים ותכונות שלא ברורים — להשאיר ריק.</DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <Field label="שם" name="name" error={fieldError(state, 'name')}>
            <Input id="name" name="name" defaultValue={product?.name ?? ''} required autoFocus />
          </Field>
          <Field label="Slug" name="slug" error={fieldError(state, 'slug')}>
            <Input id="slug" name="slug" dir="ltr" defaultValue={product?.slug ?? ''} />
          </Field>
          <Field label="קטגוריה" name="category" error={fieldError(state, 'category')}>
            <Input id="category" name="category" defaultValue={product?.category ?? ''} />
          </Field>
          <Field label="קישור" name="url" error={fieldError(state, 'url')}>
            <Input id="url" name="url" type="url" dir="ltr" defaultValue={product?.url ?? ''} />
          </Field>
          <Field label="תיאור" name="description" error={fieldError(state, 'description')} className="sm:col-span-2">
            <Textarea id="description" name="description" rows={3} defaultValue={product?.description ?? ''} />
          </Field>
          <Field label="תכונות מאומתות" name="features" hint="שורה לכל תכונה" error={fieldError(state, 'features')}>
            <Textarea id="features" name="features" rows={4} defaultValue={features.join('\n')} />
          </Field>
          <Field label="קהלי יעד" name="audiences" hint="שורה לכל קהל" error={fieldError(state, 'audiences')}>
            <Textarea id="audiences" name="audiences" rows={4} defaultValue={audiences.join('\n')} />
          </Field>
          <Field label="מחיר החל מ- (₪)" name="priceFromIls" error={fieldError(state, 'priceFromIls')}>
            <Input id="priceFromIls" name="priceFromIls" type="number" min={0} step="0.01" defaultValue={product?.priceFromIls ?? ''} />
          </Field>
          <Field label="הערת תמחור" name="pricingNote" error={fieldError(state, 'pricingNote')}>
            <Input id="pricingNote" name="pricingNote" defaultValue={product?.pricingNote ?? ''} />
          </Field>
          <Field label="סדר תצוגה" name="sortOrder">
            <Input id="sortOrder" name="sortOrder" type="number" defaultValue={product?.sortOrder ?? 0} />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="isActive" defaultChecked={product?.isActive ?? true} className="size-4 rounded border-input" />
            פעיל לשיווק
          </label>
          <div className="sm:col-span-2">
            <FormMessage state={state} />
          </div>
          <DialogFooter className="sm:col-span-2">
            <SubmitButton pendingText="שומר…">{product ? 'שמירה' : 'הוספה'}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
