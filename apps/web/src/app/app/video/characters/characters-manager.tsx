'use client';

import { useActionState, useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Archive, Pencil, Plus, Sparkles, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { MediaPicker, mediaUrl } from '@/components/media-picker';
import type { PickerImage } from '@/components/media-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { callAction, formKey, formValue, idleState } from '@/lib/action-state';
import { VOICES } from '../create-video-dialog';
import { archiveCharacterAction, generateCharacterImageAction, saveCharacterAction } from './actions';

export interface CharacterDto {
  id: string;
  name: string;
  description: string | null;
  imageMediaId: string;
  voice: string;
  voiceInstructions: string | null;
}

export function CharactersManager({ brandId, canEdit, characters, images: initialImages }: { brandId: string; canEdit: boolean; characters: CharacterDto[]; images: PickerImage[] }) {
  const [editing, setEditing] = useState<CharacterDto | 'new' | null>(null);
  const [images, setImages] = useState(initialImages);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  useEffect(() => setImages(initialImages), [initialImages]);
  const onImageCreated = useCallback((img: PickerImage) => setImages((list) => [img, ...list.filter((i) => i.id !== img.id)]), []);

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? (
        <div>
          <Button onClick={() => setEditing('new')}>
            <Plus /> דמות חדשה
          </Button>
        </div>
      ) : null}
      {characters.length === 0 ? (
        <EmptyState icon={UserRound} title="אין עדיין דמויות" description="צרו מסקוט או פרזנטור למותג — מתמונה קיימת או ב-AI — ובחרו אותו בסצנות מסוג 'דמות מדברת'." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {characters.map((c) => (
            <div key={c.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
              <div className="aspect-[3/4] bg-muted/40">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={mediaUrl(brandId, c.imageMediaId)} alt={c.name} className="size-full object-cover" />
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{c.name}</h3>
                  <Badge variant="outline">קול {c.voice}</Badge>
                </div>
                {c.description ? <p className="line-clamp-3 text-xs text-muted-foreground">{c.description}</p> : null}
                {canEdit ? (
                  <div className="mt-auto flex gap-1 pt-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(c)}>
                      <Pencil /> עריכה
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        confirm(`להעביר את "${c.name}" לארכיון?`) &&
                        startTransition(async () => {
                          const res = await callAction(archiveCharacterAction(c.id));
                          if (res.status === 'error') toast.error(res.message);
                          else {
                            toast.success(res.message);
                            router.refresh();
                          }
                        })
                      }
                    >
                      <Archive />
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {editing ? <CharacterDialog brandId={brandId} character={editing === 'new' ? null : editing} images={images} onImageCreated={onImageCreated} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CharacterDialog({ brandId, character, images, onImageCreated, onClose }: { brandId: string; character: CharacterDto | null; images: PickerImage[]; onImageCreated: (img: PickerImage) => void; onClose: () => void }) {
  const [state, action] = useActionState(saveCharacterAction.bind(null, character?.id ?? null), idleState);
  const [genState, genAction] = useActionState(generateCharacterImageAction, idleState);
  const [imageId, setImageId] = useState<string | null>(character?.imageMediaId ?? null);
  const [description, setDescription] = useState(character?.description ?? '');
  const router = useRouter();
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);
  useEffect(() => {
    if (genState.status === 'success') {
      toast.success(genState.message);
      const img = genState.data as PickerImage | undefined;
      if (img?.id) {
        onImageCreated(img);
        setImageId(img.id);
      }
    }
  }, [genState, onImageCreated]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{character ? `עריכת ${character.name}` : 'דמות חדשה'}</DialogTitle>
          <DialogDescription>התמונה משמשת להנפשת הדמות (סנכרון שפתיים) ולשמירה על מראה עקבי בקליפים. הקול הוא קול ה-TTS שבו הדמות מדברת.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[1fr_260px]">
          <form key={formKey(state)} action={action} className="flex flex-col gap-3">
            <input type="hidden" name="imageMediaId" value={imageId ?? ''} />
            <Field label="שם" name="name" error={fieldError(state, 'name')}>
              <Input id="name" name="name" required maxLength={80} defaultValue={formValue(state, 'name', character?.name ?? '')} autoFocus />
            </Field>
            <Field label="תיאור מראה ואופי (אנגלית עדיף — משמש בפרומפטים לווידאו)" name="description" error={fieldError(state, 'description')}>
              <Textarea id="description" name="description" rows={5} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A friendly round blue robot mascot with big expressive eyes and a small antenna" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="קול" name="voice" error={fieldError(state, 'voice')}>
                <Select id="voice" name="voice" defaultValue={formValue(state, 'voice', character?.voice ?? 'alloy')}>
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="סגנון דיבור (אופציונלי)" name="voiceInstructions" error={fieldError(state, 'voiceInstructions')}>
                <Input id="voiceInstructions" name="voiceInstructions" maxLength={1000} defaultValue={formValue(state, 'voiceInstructions', character?.voiceInstructions ?? '')} placeholder="Energetic, cheerful, playful" />
              </Field>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">תמונת הדמות</div>
              <MediaPicker brandId={brandId} images={images} value={imageId} onChange={setImageId} allowClear={false} />
              {fieldError(state, 'imageMediaId') ? <p className="mt-1 text-xs text-destructive">{fieldError(state, 'imageMediaId')}</p> : null}
            </div>
            <FormMessage state={state} />
            <DialogFooter>
              <SubmitButton pendingText="שומר…" disabled={!imageId}>
                {character ? 'שמירה' : 'יצירת דמות'}
              </SubmitButton>
            </DialogFooter>
          </form>
          <form key={formKey(genState)} action={genAction} className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
            <div className="text-sm font-medium">או ציור הדמות ב-AI</div>
            <Textarea name="description" rows={6} required minLength={5} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} className="text-xs" placeholder="תיאור הדמות" />
            <Input name="style" maxLength={500} defaultValue={formValue(genState, 'style', '')} placeholder="סגנון: 3D Pixar-like / photoreal / flat illustration" className="text-xs" />
            {fieldError(genState, 'description') ? <p className="text-xs text-destructive">{fieldError(genState, 'description')}</p> : null}
            <FormMessage state={genState} />
            <SubmitButton size="sm" variant="outline" pendingText="מצייר… (עד דקה)">
              <Sparkles /> צייר דמות
            </SubmitButton>
            <p className="text-[11px] text-muted-foreground">נוצרת תמונת פורטרט קדמית (פה גלוי, רקע נקי) — מתאימה לסנכרון שפתיים. העלות נרשמת ביומן ה-AI.</p>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
