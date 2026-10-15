'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Download, KeyRound, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormMessage, SubmitButton, fieldError } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { idleState } from '@/lib/action-state';
import { formatDateTime } from '@/lib/format';
import { confirmMfaEnrollmentAction, disableMfaAction, regenerateRecoveryCodesAction, startMfaEnrollmentAction } from './actions';

interface Props {
  enabled: boolean;
  enrolledAt: Date | null;
  recoveryCodesLeft: number;
  required: boolean;
}

interface Enrollment {
  secretBase32: string;
  otpauthUri: string;
  qrDataUrl: string;
}

export function MfaCard({ enabled, enrolledAt, recoveryCodesLeft, required }: Props) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [showDisable, setShowDisable] = useState(false);
  const [showRegenerate, setShowRegenerate] = useState(false);
  const [starting, startStart] = useTransition();

  const begin = () =>
    startStart(async () => {
      const res = await startMfaEnrollmentAction();
      if (res.status === 'error') toast.error(res.message);
      else setEnrollment(res.data as Enrollment);
    });

  return (
    <Card className={required && !enabled ? 'border-warning' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {enabled ? <ShieldCheck className="size-5 text-success" /> : <ShieldOff className="size-5 text-muted-foreground" />}
          אימות דו-שלבי (2FA)
          {enabled ? <Badge variant="success">מופעל</Badge> : <Badge variant="muted">כבוי</Badge>}
        </CardTitle>
        <CardDescription>
          קוד חד-פעמי מאפליקציה כמו Google Authenticator בכל התחברות. תקן TOTP — עובד גם עם Authy, 1Password ו-Microsoft Authenticator.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {required && !enabled ? (
          <Alert variant="warning">
            <ShieldAlert />
            <AlertTitle>המערכת דורשת אימות דו-שלבי למנהלים</AlertTitle>
            <AlertDescription>עד להפעלה לא ניתן להשתמש בשאר המערכת.</AlertDescription>
          </Alert>
        ) : null}

        {enabled ? (
          <>
            <div className="text-sm text-muted-foreground">
              הופעל {formatDateTime(enrolledAt)} · קודי גיבוי שנותרו: <strong className="text-foreground">{recoveryCodesLeft}</strong>
              {recoveryCodesLeft <= 2 ? <span className="text-destructive"> — מומלץ ליצור חדשים</span> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setShowRegenerate(true)}>
                <KeyRound /> קודי גיבוי חדשים
              </Button>
              <Button variant="destructive" onClick={() => setShowDisable(true)}>
                <ShieldOff /> השבתה
              </Button>
            </div>
          </>
        ) : (
          <Button onClick={begin} disabled={starting} className="self-start">
            <ShieldCheck /> {starting ? 'מכין…' : 'הפעלת אימות דו-שלבי'}
          </Button>
        )}
      </CardContent>

      {enrollment ? (
        <EnrollDialog
          enrollment={enrollment}
          onClose={() => {
            setEnrollment(null);
            router.refresh();
          }}
        />
      ) : null}
      {showDisable ? (
        <DisableDialog
          onClose={() => {
            setShowDisable(false);
            router.refresh();
          }}
        />
      ) : null}
      {showRegenerate ? (
        <RegenerateDialog
          onClose={() => {
            setShowRegenerate(false);
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('הקודים הועתקו');
    } catch {
      toast.error('ההעתקה נכשלה — העתיקו ידנית');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`MM Marketing OS — recovery codes\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mm-marketing-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="warning">
        <ShieldAlert />
        <AlertTitle>שמרו את קודי הגיבוי עכשיו — הם מוצגים פעם אחת בלבד</AlertTitle>
        <AlertDescription>כל קוד מאפשר כניסה אחת אם אין גישה לאפליקציה.</AlertDescription>
      </Alert>
      <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 font-mono text-sm" dir="ltr">
        {codes.map((c) => (
          <div key={c} className="text-center">
            {c}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          <Copy /> העתקה
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <Download /> הורדה
        </Button>
      </div>
    </div>
  );
}

function EnrollDialog({ enrollment, onClose }: { enrollment: Enrollment; onClose: () => void }) {
  const [state, action] = useActionState(confirmMfaEnrollmentAction, idleState);
  const codes = state.status === 'success' ? ((state.data as { recoveryCodes?: string[] } | undefined)?.recoveryCodes ?? null) : null;
  useEffect(() => {
    if (state.status === 'success') toast.success(state.message);
  }, [state]);
  const grouped = enrollment.secretBase32.replace(/(.{4})/g, '$1 ').trim();

  return (
    <Dialog open onOpenChange={(o) => !o && codes && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{codes ? 'אימות דו-שלבי הופעל' : 'הפעלת אימות דו-שלבי'}</DialogTitle>
          <DialogDescription>
            {codes ? 'שמרו את קודי הגיבוי לפני שסוגרים.' : 'התקינו Google Authenticator, סרקו את הקוד והזינו את המספר שמופיע.'}
          </DialogDescription>
        </DialogHeader>
        {codes ? (
          <>
            <RecoveryCodes codes={codes} />
            <DialogFooter>
              <Button onClick={onClose}>שמרתי את הקודים</Button>
            </DialogFooter>
          </>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrollment.qrDataUrl} alt="QR להוספה לאפליקציית אימות" width={200} height={200} className="rounded-lg border bg-white p-1" />
              <ol className="list-decimal space-y-1 ps-5 text-sm">
                <li>התקינו Google Authenticator (iOS / Android).</li>
                <li>לחצו + → סריקת קוד QR.</li>
                <li>הזינו את הקוד בן 6 הספרות למטה.</li>
              </ol>
            </div>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">לא ניתן לסרוק? הזינו מפתח ידנית</summary>
              <code className="mt-1 block select-all rounded bg-muted p-2 font-mono" dir="ltr">
                {grouped}
              </code>
            </details>
            <Field label="קוד מהאפליקציה" name="code" error={fieldError(state, 'code')}>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="text-center font-mono text-lg tracking-[0.3em]" maxLength={8} required autoFocus />
            </Field>
            <FormMessage state={state} />
            <DialogFooter>
              <SubmitButton pendingText="מאמת…">הפעלה</SubmitButton>
              <Button type="button" variant="ghost" onClick={onClose}>
                ביטול
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const [state, action] = useActionState(disableMfaAction, idleState);
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
          <DialogTitle>השבתת אימות דו-שלבי</DialogTitle>
          <DialogDescription>לאישור נדרשים הסיסמה הנוכחית וקוד מהאפליקציה (או קוד גיבוי).</DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-4">
          <Field label="סיסמה" name="password" error={fieldError(state, 'password')}>
            <Input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required />
          </Field>
          <Field label="קוד אימות" name="code" error={fieldError(state, 'code')}>
            <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="font-mono" maxLength={16} required />
          </Field>
          <FormMessage state={state} />
          <DialogFooter>
            <SubmitButton variant="destructive" pendingText="משבית…">
              השבתה
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RegenerateDialog({ onClose }: { onClose: () => void }) {
  const [state, action] = useActionState(regenerateRecoveryCodesAction, idleState);
  const codes = state.status === 'success' ? ((state.data as { recoveryCodes?: string[] } | undefined)?.recoveryCodes ?? null) : null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>קודי גיבוי חדשים</DialogTitle>
          <DialogDescription>{codes ? 'הקודים הקודמים בוטלו.' : 'הזינו קוד מהאפליקציה כדי ליצור 8 קודים חדשים. הקודים הישנים יבוטלו.'}</DialogDescription>
        </DialogHeader>
        {codes ? (
          <>
            <RecoveryCodes codes={codes} />
            <DialogFooter>
              <Button onClick={onClose}>שמרתי את הקודים</Button>
            </DialogFooter>
          </>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <Field label="קוד מהאפליקציה" name="code" error={fieldError(state, 'code')}>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" className="font-mono" maxLength={8} required autoFocus />
            </Field>
            <FormMessage state={state} />
            <DialogFooter>
              <SubmitButton pendingText="יוצר…">יצירת קודים</SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
