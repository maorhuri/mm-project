'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { FONT_FAMILIES, documentMediaIds, documentToHtml } from '@mm/core/creative';
import type { CreativeDocument, CreativeLayer, ImageLayer, ShapeLayer, TextLayer } from '@mm/core/creative';
import { MediaPicker, mediaUrl } from '@/components/media-picker';
import type { PickerImage } from '@/components/media-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { callAction } from '@/lib/action-state';
import { cn } from '@/lib/utils';
import { saveVersionAction } from '../actions';

const ROLE_LABELS: Record<string, string> = {
  headline: 'כותרת',
  subheadline: 'כותרת משנה',
  body: 'טקסט',
  cta: 'קריאה לפעולה',
  price: 'מחיר',
  badge: 'תג',
  custom: 'טקסט חופשי',
  background: 'רקע',
  logo: 'לוגו',
  photo: 'תמונה',
  overlay: 'הכהיה',
  panel: 'פאנל',
  accent: 'אלמנט צבע',
  divider: 'קו',
};

interface PreviewWarning {
  layer?: string;
  kind: string;
  message: string;
}

function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input type="number" value={value} min={min} max={max} step={step} dir="ltr" className="h-8" onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-8 cursor-pointer rounded border bg-background p-0.5" />
        <Input value={value} dir="ltr" className="h-8 w-24 font-mono text-xs" onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && onChange(e.target.value)} />
      </span>
    </label>
  );
}

function BoxFields({ layer, onChange }: { layer: CreativeLayer; onChange: (patch: Partial<CreativeLayer['box']>) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      <Num label="X %" value={layer.box.x} min={-50} max={150} step={0.5} onChange={(x) => onChange({ x })} />
      <Num label="Y %" value={layer.box.y} min={-50} max={150} step={0.5} onChange={(y) => onChange({ y })} />
      <Num label="רוחב %" value={layer.box.w} min={0.5} max={200} step={0.5} onChange={(w) => onChange({ w })} />
      <Num label="גובה %" value={layer.box.h} min={0.5} max={200} step={0.5} onChange={(h) => onChange({ h })} />
    </div>
  );
}

export function CreativeEditor({
  brandId,
  projectId,
  initialDoc,
  images,
  canEdit,
  onSaved,
}: {
  brandId: string;
  projectId: string;
  initialDoc: CreativeDocument;
  images: PickerImage[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [doc, setDoc] = useState<CreativeDocument>(initialDoc);
  const [selectedId, setSelectedId] = useState<string | null>(initialDoc.layers.find((l) => l.type === 'text')?.id ?? null);
  const [note, setNote] = useState('');
  const [warnings, setWarnings] = useState<PreviewWarning[]>([]);
  const [scale, setScale] = useState(0.4);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  const dirty = useMemo(() => JSON.stringify(doc) !== JSON.stringify(initialDoc), [doc, initialDoc]);

  // Live preview: the same HTML the renderer uses, with app URLs for images and /fonts for fonts.
  const srcDoc = useMemo(() => {
    const imgs: Record<string, string> = {};
    for (const id of documentMediaIds(doc)) imgs[id] = mediaUrl(brandId, id);
    return documentToHtml(doc, { mode: 'preview', images: imgs });
  }, [doc, brandId]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; warnings?: PreviewWarning[] } | null;
      if (data?.type === 'mm-creative-preview') setWarnings(data.warnings ?? []);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      const maxH = Math.max(320, Math.min(720, window.innerHeight - 260));
      setScale(Math.min(w / doc.width, maxH / doc.height, 1));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc.width, doc.height]);

  const selected = doc.layers.find((l) => l.id === selectedId) ?? null;
  const update = (id: string, patch: Partial<CreativeLayer>) =>
    setDoc((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as CreativeLayer) : l)) }));
  const move = (id: string, dir: 1 | -1) =>
    setDoc((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.layers.length) return d;
      const layers = [...d.layers];
      const [item] = layers.splice(i, 1);
      layers.splice(j, 0, item!);
      return { ...d, layers };
    });
  const remove = (id: string) => {
    setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSelectedId(null);
  };
  const duplicate = (id: string) =>
    setDoc((d) => {
      const src = d.layers.find((l) => l.id === id);
      if (!src) return d;
      const copy = { ...src, id: `${src.id}-${Date.now().toString(36)}`.slice(0, 40), box: { ...src.box, x: Math.min(140, src.box.x + 3), y: Math.min(140, src.box.y + 3) } } as CreativeLayer;
      return { ...d, layers: [...d.layers, copy] };
    });
  const addText = () => {
    const id = `text-${Date.now().toString(36)}`;
    const base = doc.layers.find((l): l is TextLayer => l.type === 'text');
    const layer: TextLayer = {
      id,
      type: 'text',
      role: 'custom',
      text: 'טקסט חדש',
      box: { x: 10, y: 40, w: 80, h: 12 },
      font: 'body',
      size: Math.round(doc.width / 22),
      weight: 600,
      color: base?.color ?? '#111111',
      align: 'start',
      valign: 'top',
      lineHeight: 1.2,
      background: null,
      radius: 0,
      padding: 0,
      autofit: true,
      shadow: false,
      letterSpacing: 0,
      opacity: 1,
    };
    setDoc((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelectedId(id);
  };
  const addImage = () => {
    const id = `image-${Date.now().toString(36)}`;
    const layer: ImageLayer = { id, type: 'image', role: 'photo', mediaId: null, box: { x: 10, y: 10, w: 40, h: 30 }, fit: 'cover', opacity: 1, radius: 0 };
    setDoc((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelectedId(id);
  };

  const save = () =>
    startTransition(async () => {
      const res = await callAction(saveVersionAction(projectId, JSON.stringify(doc), note.trim() || null));
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        setNote('');
        router.refresh();
        onSaved();
      }
    });

  const stack = [...doc.layers].reverse();

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-3">
        <div ref={wrapRef} className="flex justify-center rounded-xl border bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:20px_20px] p-3">
          <div style={{ width: Math.round(doc.width * scale), height: Math.round(doc.height * scale) }} className="relative overflow-hidden shadow-lg">
            <iframe
              title="תצוגה מקדימה"
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin"
              style={{ width: doc.width, height: doc.height, transform: `scale(${scale})`, transformOrigin: 'top left', border: 0, position: 'absolute', top: 0, left: 0 }}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {doc.width}×{doc.height} · תצוגה חיה (אותו HTML שהרינדור משתמש בו)
          </span>
          {warnings.length === 0 ? (
            <Badge variant="success">אין אזהרות פריסה</Badge>
          ) : (
            warnings.map((w, i) => (
              <Badge key={i} variant={w.kind === 'overflow' || w.kind === 'missing_image' ? 'warning' : 'muted'}>
                {w.layer ? `${ROLE_LABELS[doc.layers.find((l) => l.id === w.layer)?.type === 'text' ? (doc.layers.find((l) => l.id === w.layer) as TextLayer).role : (doc.layers.find((l) => l.id === w.layer) as ImageLayer | ShapeLayer | undefined)?.role ?? ''] ?? w.layer}: ` : ''}
                {w.message}
              </Badge>
            ))
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-card p-3">
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs">
              <span className="text-muted-foreground">הערה לגרסה (אופציונלי)</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="מה שונה בגרסה הזו" className="h-8" />
            </label>
            <Button onClick={save} disabled={pending}>
              <Save /> {pending ? 'שומר…' : dirty ? 'שמור כגרסה חדשה ורנדר' : 'רנדר שוב כגרסה חדשה'}
            </Button>
            <Button variant="outline" onClick={() => setDoc(initialDoc)} disabled={!dirty || pending}>
              <RotateCcw /> שחזור
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">שכבות</span>
            {canEdit ? (
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={addText}>
                  <Plus /> טקסט
                </Button>
                <Button size="sm" variant="ghost" onClick={addImage}>
                  <Plus /> תמונה
                </Button>
              </div>
            ) : null}
          </div>
          <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {stack.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(l.id)}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent/60', selectedId === l.id && 'bg-accent', l.hidden && 'opacity-50')}
                >
                  <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{l.type === 'text' ? 'טקסט' : l.type === 'image' ? 'תמונה' : 'צורה'}</span>
                  <span className="min-w-0 flex-1 truncate">{l.type === 'text' ? `${ROLE_LABELS[l.role] ?? l.role}: ${l.text || '—'}` : ROLE_LABELS[l.role] ?? l.role}</span>
                  {l.hidden ? <EyeOff className="size-3.5 text-muted-foreground" /> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected ? (
          <div className="flex flex-col gap-3 rounded-xl border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{selected.type === 'text' ? ROLE_LABELS[selected.role] : ROLE_LABELS[selected.role] ?? selected.role}</span>
              {canEdit ? (
                <div className="flex gap-0.5">
                  <Button size="icon" variant="ghost" aria-label="קדימה" onClick={() => move(selected.id, 1)}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="אחורה" onClick={() => move(selected.id, -1)}>
                    <ArrowDown />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="הסתרה" onClick={() => update(selected.id, { hidden: !selected.hidden })}>
                    {selected.hidden ? <EyeOff /> : <Eye />}
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="שכפול" onClick={() => duplicate(selected.id)}>
                    <Copy />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="מחיקה" onClick={() => remove(selected.id)}>
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </div>
            <fieldset disabled={!canEdit} className="flex flex-col gap-3">
              {selected.type === 'text' ? (
                <>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-muted-foreground">טקסט</span>
                    <Textarea value={selected.text} rows={2} onChange={(e) => update(selected.id, { text: e.target.value.slice(0, 600) })} />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <Num label="גודל px" value={selected.size} min={10} max={400} onChange={(size) => update(selected.id, { size })} />
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">משקל</span>
                      <Select value={selected.weight} className="h-8" onChange={(e) => update(selected.id, { weight: Number(e.target.value) })}>
                        {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">פונט</span>
                      <Select value={selected.font} className="h-8" onChange={(e) => update(selected.id, { font: e.target.value as 'heading' | 'body' })}>
                        <option value="heading">כותרות ({doc.fonts.heading})</option>
                        <option value="body">גוף ({doc.fonts.body})</option>
                      </Select>
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Color label="צבע" value={selected.color} onChange={(color) => update(selected.id, { color })} />
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">יישור</span>
                      <Select value={selected.align} className="h-8" onChange={(e) => update(selected.id, { align: e.target.value as TextLayer['align'] })}>
                        <option value="start">ימין</option>
                        <option value="center">מרכז</option>
                        <option value="end">שמאל</option>
                      </Select>
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">אנכי</span>
                      <Select value={selected.valign} className="h-8" onChange={(e) => update(selected.id, { valign: e.target.value as TextLayer['valign'] })}>
                        <option value="top">למעלה</option>
                        <option value="middle">אמצע</option>
                        <option value="bottom">למטה</option>
                      </Select>
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Num label="גובה שורה" value={selected.lineHeight} min={0.8} max={2.2} step={0.05} onChange={(lineHeight) => update(selected.id, { lineHeight })} />
                    <Num label="ריווח" value={selected.padding} min={0} max={200} onChange={(padding) => update(selected.id, { padding })} />
                    <Num label="עיגול" value={selected.radius} min={0} max={2000} onChange={(radius) => update(selected.id, { radius })} />
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={selected.background !== null} onChange={(e) => update(selected.id, { background: e.target.checked ? '#ffffff' : null })} className="size-4 rounded border-input" />
                      רקע לטקסט
                    </label>
                    {selected.background ? <Color label="צבע רקע" value={selected.background} onChange={(background) => update(selected.id, { background })} /> : null}
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={selected.autofit} onChange={(e) => update(selected.id, { autofit: e.target.checked })} className="size-4 rounded border-input" />
                      התאמה אוטומטית לגודל
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="checkbox" checked={selected.shadow} onChange={(e) => update(selected.id, { shadow: e.target.checked })} className="size-4 rounded border-input" />
                      צל
                    </label>
                  </div>
                </>
              ) : selected.type === 'image' ? (
                <>
                  <MediaPicker brandId={brandId} images={images} value={selected.mediaId} onChange={(mediaId) => update(selected.id, { mediaId })} />
                  <div className="grid grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1 text-xs">
                      <span className="text-muted-foreground">התאמה</span>
                      <Select value={selected.fit} className="h-8" onChange={(e) => update(selected.id, { fit: e.target.value as ImageLayer['fit'] })}>
                        <option value="cover">מילוי (cover)</option>
                        <option value="contain">הכלה (contain)</option>
                      </Select>
                    </label>
                    <Num label="שקיפות" value={selected.opacity} min={0} max={1} step={0.05} onChange={(opacity) => update(selected.id, { opacity })} />
                    <Num label="עיגול" value={selected.radius} min={0} max={2000} onChange={(radius) => update(selected.id, { radius })} />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <Color label="צבע" value={selected.color} onChange={(color) => update(selected.id, { color })} />
                    <Num label="שקיפות" value={selected.opacity} min={0} max={1} step={0.05} onChange={(opacity) => update(selected.id, { opacity })} />
                    <Num label="עיגול" value={selected.radius} min={0} max={2000} onChange={(radius) => update(selected.id, { radius })} />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      checked={selected.gradient !== null}
                      onChange={(e) => update(selected.id, { gradient: e.target.checked ? { to: '#000000', angle: 180, fromOpacity: 0, toOpacity: 0.8 } : null })}
                      className="size-4 rounded border-input"
                    />
                    גרדיאנט
                  </label>
                  {selected.gradient ? (
                    <div className="grid grid-cols-4 gap-2">
                      <Color label="אל צבע" value={selected.gradient.to} onChange={(to) => update(selected.id, { gradient: { ...selected.gradient!, to } })} />
                      <Num label="זווית" value={selected.gradient.angle} min={0} max={360} onChange={(angle) => update(selected.id, { gradient: { ...selected.gradient!, angle } })} />
                      <Num label="שקיפות התחלה" value={selected.gradient.fromOpacity} min={0} max={1} step={0.05} onChange={(fromOpacity) => update(selected.id, { gradient: { ...selected.gradient!, fromOpacity } })} />
                      <Num label="שקיפות סוף" value={selected.gradient.toOpacity} min={0} max={1} step={0.05} onChange={(toOpacity) => update(selected.id, { gradient: { ...selected.gradient!, toOpacity } })} />
                    </div>
                  ) : null}
                </>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">מיקום וגודל (אחוזים מהקנבס)</Label>
                <div className="mt-1">
                  <BoxFields layer={selected} onChange={(patch) => update(selected.id, { box: { ...selected.box, ...patch } })} />
                </div>
              </div>
            </fieldset>
          </div>
        ) : null}

        <fieldset disabled={!canEdit} className="flex flex-col gap-3 rounded-xl border bg-card p-3">
          <span className="text-sm font-medium">מסמך</span>
          <div className="grid grid-cols-3 gap-2">
            <Color label="צבע רקע" value={doc.background} onChange={(background) => setDoc((d) => ({ ...d, background }))} />
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">פונט כותרות</span>
              <Select value={doc.fonts.heading} className="h-8" onChange={(e) => setDoc((d) => ({ ...d, fonts: { ...d.fonts, heading: e.target.value as CreativeDocument['fonts']['heading'] } }))}>
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">פונט גוף</span>
              <Select value={doc.fonts.body} className="h-8" onChange={(e) => setDoc((d) => ({ ...d, fonts: { ...d.fonts, body: e.target.value as CreativeDocument['fonts']['body'] } }))}>
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
