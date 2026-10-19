'use client';

import { useRef, useState } from 'react';
import { Loader2, Play, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

export const VOICE_OPTIONS: { id: string; label: string }[] = [
  { id: 'alloy', label: 'Alloy — ניטרלי' },
  { id: 'ash', label: 'Ash — גברי' },
  { id: 'ballad', label: 'Ballad — גברי רך' },
  { id: 'coral', label: 'Coral — נשי חם' },
  { id: 'echo', label: 'Echo — גברי' },
  { id: 'fable', label: 'Fable — ניטרלי' },
  { id: 'nova', label: 'Nova — נשי' },
  { id: 'onyx', label: 'Onyx — גברי עמוק' },
  { id: 'sage', label: 'Sage — נשי רגוע' },
  { id: 'shimmer', label: 'Shimmer — נשי' },
  { id: 'verse', label: 'Verse — גברי' },
];

/** Voice dropdown with a ▶ button that plays a short Hebrew sample of the selected voice. */
export function VoiceSelect({ brandId, name, id, defaultValue }: { brandId: string; name: string; id?: string; defaultValue: string }) {
  const [voice, setVoice] = useState(defaultValue);
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  const toggle = () => {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    audio.current?.pause();
    const a = new Audio(`/api/v1/brands/${brandId}/voices/${voice}`);
    audio.current = a;
    setState('loading');
    a.oncanplay = () => setState('playing');
    a.onended = () => setState('idle');
    a.onerror = () => {
      setState('idle');
      toast.error('לא ניתן להשמיע את הדוגמה (בדקו שספק הקול מחובר)');
    };
    void a.play().catch(() => undefined);
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <Select id={id ?? name} name={name} value={voice} onChange={(e) => { audio.current?.pause(); setState('idle'); setVoice(e.target.value); }}>
          {VOICE_OPTIONS.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </Select>
      </div>
      <Button type="button" size="icon" variant="outline" aria-label="השמעת דוגמה" onClick={toggle}>
        {state === 'loading' ? <Loader2 className="animate-spin" /> : state === 'playing' ? <Square /> : <Play />}
      </Button>
    </div>
  );
}
