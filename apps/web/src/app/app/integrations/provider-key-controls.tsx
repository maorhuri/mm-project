'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { KeyRound, PlugZap, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/action-state';
import { removeProviderKeyAction, saveProviderKeyAction, testProviderAction } from './actions';

const HELP: Record<string, { label: string; url: string; placeholder: string }> = {
  openai: { label: 'OpenAI', url: 'https://platform.openai.com/api-keys', placeholder: 'sk-…' },
  anthropic: { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', placeholder: 'sk-ant-…' },
  google: { label: 'Google AI Studio (נדרש חשבון בתשלום ל-Veo)', url: 'https://aistudio.google.com/apikey', placeholder: 'AIza…' },
  fal: { label: 'fal.ai', url: 'https://fal.ai/dashboard/keys', placeholder: 'key-id:key-secret' },
};

export function ProviderKeyControls({ provider, hasKey, keyHint, canManage }: { provider: string; hasKey: boolean; keyHint: string | null; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const help = HELP[provider];
  if (!help) return null;

  const test = () =>
    startTransition(async () => {
      const res = await testProviderAction(provider);
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  const remove = () => {
    if (!confirm(`להסיר את המפתח של ${help.label}?`)) return;
    startTransition(async () => {
      const res = await removeProviderKeyAction(provider);
      if (res.status === 'error') toast.error(res.message);
      else toast.success(res.message);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {hasKey ? (
        <>
          <span className="me-1 font-mono text-xs text-muted-foreground" dir="ltr">
            {keyHint}
          </span>
          {canManage ? (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={test}>
                <PlugZap /> בדוק חיבור
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(true)}>
                <KeyRound /> החלף
              </Button>
              <Button size="icon" variant="ghost" aria-label="הסרת מפתח" disabled={pending} onClick={remove}>
                <Trash2 />
              </Button>
            </>
          ) : null}
        </>
      ) : canManage ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          <KeyRound /> הגדרת מפתח API
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">מנהל ארגון יכול להגדיר מפתח</span>
      )}
      {open ? <KeyDialog provider={provider} help={help} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function KeyDialog({ provider, help, onClose }: { provider: string; help: { label: string; url: string; placeholder: string }; onClose: () => void }) {
  const [state, action] = useActionState(saveProviderKeyAction, idleState);
  useEffect(() => {
    if (state.status === 'success') {
      toast.success(state.message);
      onClose();
    }
  }, [state, onClose]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>מפתח API — {help.label}</DialogTitle>
          <DialogDescription>
            המפתח נשמר מוצפן (AES-256-GCM) בשרת שלכם ונבדק מיד מול ה-API. צרו מפתח ב-
            <a href={help.url} target="_blank" rel="noreferrer" className="underline" dir="ltr">
              {help.url.replace('https://', '')}
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="provider" value={provider} />
          <Field label="API key" name="apiKey" error={fieldError(state, 'apiKey')}>
            <Input id="apiKey" name="apiKey" type="password" autoComplete="off" dir="ltr" placeholder={help.placeholder} required minLength={10} autoFocus />
          </Field>
          <FormMessage state={state} />
          <DialogFooter>
            <SubmitButton pendingText="שומר ובודק…">שמירה ובדיקת חיבור</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
