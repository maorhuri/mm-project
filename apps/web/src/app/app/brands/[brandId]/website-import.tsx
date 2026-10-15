'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { BrandSiteAnalysis, LogoCandidate } from '@mm/core';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { analyzeWebsiteAction, applyWebsiteImportAction } from '../actions';

type Role = 'primary' | 'secondary' | 'accent' | 'background' | 'foreground';
const ROLES: { value: Role; label: string }[] = [
  { value: 'primary', label: 'ראשי' },
  { value: 'secondary', label: 'משני' },
  { value: 'accent', label: 'הדגשה' },
  { value: 'background', label: 'רקע' },
  { value: 'foreground', label: 'טקסט' },
];
type LogoType = 'LOGO_PRIMARY' | 'LOGO_SECONDARY' | 'LOGO_ICON';
const LOGO_TYPES: { value: LogoType; label: string }[] = [
  { value: 'LOGO_PRIMARY', label: 'לוגו ראשי' },
  { value: 'LOGO_SECONDARY', label: 'לוגו משני' },
  { value: 'LOGO_ICON', label: 'אייקון' },
];
const LOGO_KIND_LABEL: Record<LogoCandidate['kind'], string> = {
  'apple-touch-icon': 'Apple touch icon',
  'og-image': 'תמונת שיתוף (og:image)',
  'img-logo': 'תמונת לוגו בעמוד',
  icon: 'Favicon',
};
const SOURCE_LABEL: Record<string, string> = {
  css: 'CSS',
  'css-variable': 'משתנה CSS',
  'theme-color': 'theme-color',
  'inline-style': 'style inline',
  logo: 'צבע דומיננטי בלוגו',
  'google-fonts': 'Google Fonts',
  'font-face': '@font-face',
};

interface Props {
  brandId: string;
  websiteUrl: string | null;
  hasDescription: boolean;
  disabled: boolean;
}

export function WebsiteImport({ brandId, websiteUrl, hasDescription, disabled }: Props) {
  const router = useRouter();
  const [url, setUrl] = useState(websiteUrl ?? '');
  const [analysis, setAnalysis] = useState<BrandSiteAnalysis | null>(null);
  const [roles, setRoles] = useState<Record<string, Role | ''>>({});
  const [fonts, setFonts] = useState<{ heading: string; body: string }>({ heading: '', body: '' });
  const [logo, setLogo] = useState<{ url: string; type: LogoType } | null>(null);
  const [useDescription, setUseDescription] = useState(false);
  const [analyzing, startAnalyze] = useTransition();
  const [applying, startApply] = useTransition();

  const analyze = () => {
    startAnalyze(async () => {
      const res = await analyzeWebsiteAction(brandId, url);
      if (res.status === 'error') {
        toast.error(res.message);
        return;
      }
      const a = res.data as BrandSiteAnalysis;
      setAnalysis(a);
      const initial: Record<string, Role | ''> = {};
      for (const [role, hex] of Object.entries(a.suggestions.colors)) {
        if (hex && a.colors.some((c) => c.hex === hex)) initial[hex] = role as Role;
      }
      setRoles(initial);
      setFonts({ heading: a.suggestions.fonts.heading ?? '', body: a.suggestions.fonts.body ?? '' });
      const firstLogo = a.logos.find((l) => l.importable);
      setLogo(firstLogo ? { url: firstLogo.url, type: firstLogo.kind === 'icon' ? 'LOGO_ICON' : 'LOGO_PRIMARY' } : null);
      setUseDescription(Boolean(a.description) && !hasDescription);
      toast.success(res.message);
    });
  };

  const setRole = (hex: string, role: Role | '') => {
    setRoles((prev) => {
      const next: Record<string, Role | ''> = {};
      for (const [h, r] of Object.entries(prev)) next[h] = r === role && role !== '' ? '' : r;
      next[hex] = role;
      return next;
    });
  };

  const apply = () => {
    if (!analysis) return;
    const colors: Partial<Record<Role, string>> = {};
    for (const [hex, role] of Object.entries(roles)) if (role) colors[role] = hex;
    const payload = {
      colors: Object.keys(colors).length ? colors : undefined,
      fonts: fonts.heading || fonts.body ? { heading: fonts.heading || undefined, body: fonts.body || undefined } : undefined,
      description: useDescription && analysis.description ? analysis.description : undefined,
      logo: logo ?? undefined,
      sourceUrl: analysis.finalUrl,
    };
    startApply(async () => {
      const res = await applyWebsiteImportAction(brandId, payload);
      if (res.status === 'error') toast.error(res.message);
      else {
        toast.success(res.message);
        setAnalysis(null);
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> ייבוא מהאתר
        </CardTitle>
        <CardDescription>
          המערכת קוראת את ה-CSS והמטא-דאטה של האתר ומציעה צבעים, פונטים, לוגו ותיאור. שום דבר לא נשמר עד שתלחצו
          &quot;החל&quot;.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Globe className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.example.co.il"
              dir="ltr"
              className="ps-9"
              disabled={disabled || analyzing}
              aria-label="כתובת האתר"
            />
          </div>
          <Button onClick={analyze} disabled={disabled || analyzing || !url.trim()}>
            {analyzing ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {analyzing ? 'מנתח את האתר…' : 'נתח את האתר'}
          </Button>
        </div>

        {analysis ? (
          <>
            <div className="text-xs text-muted-foreground" dir="ltr">
              {analysis.finalUrl} · {analysis.stats.stylesheets} stylesheets · {Math.round(analysis.stats.cssBytes / 1024)} KB CSS
              {analysis.title ? ` · "${analysis.title}"` : ''}
            </div>
            {analysis.warnings.length > 0 ? (
              <Alert variant="warning">
                <TriangleAlert />
                <AlertDescription>
                  <ul className="list-disc ps-4">
                    {analysis.warnings.map((w) => (
                      <li key={w} dir="ltr" className="text-start">
                        {w}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Logos */}
            <section className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">לוגו ({analysis.logos.length} מועמדים)</h4>
              {analysis.logos.length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו מועמדים ללוגו.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {analysis.logos.map((l) => {
                    const selected = logo?.url === l.url;
                    return (
                      <button
                        key={l.url}
                        type="button"
                        disabled={!l.importable}
                        onClick={() => setLogo(selected ? null : { url: l.url, type: l.kind === 'icon' ? 'LOGO_ICON' : 'LOGO_PRIMARY' })}
                        className={cn(
                          'flex w-36 flex-col items-center gap-1 rounded-lg border p-2 text-center text-xs transition-colors',
                          selected ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/50',
                          !l.importable && 'cursor-not-allowed opacity-50',
                        )}
                        title={l.url}
                      >
                        <span className="flex h-20 w-full items-center justify-center overflow-hidden rounded bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={l.url} alt={LOGO_KIND_LABEL[l.kind]} className="max-h-full max-w-full object-contain" loading="lazy" />
                        </span>
                        <span className="truncate text-muted-foreground">{LOGO_KIND_LABEL[l.kind]}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {l.width && l.height ? `${l.width}×${l.height}` : l.mimeType ?? ''}
                          {!l.importable ? ' · לא נתמך' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {logo ? (
                <div className="flex items-center gap-2 text-sm">
                  <span>לשמור כ:</span>
                  <div className="w-40">
                    <Select value={logo.type} onChange={(e) => setLogo({ ...logo, type: e.target.value as LogoType })} aria-label="סוג לוגו">
                      {LOGO_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              ) : null}
            </section>

            {/* Colours */}
            <section className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">צבעים ({analysis.colors.length})</h4>
              {analysis.colors.length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו צבעים ב-CSS של האתר.</p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {analysis.colors.map((c) => (
                    <div key={c.hex} className="flex items-center gap-3 rounded-lg border p-2">
                      <span className="size-10 shrink-0 rounded-md border" style={{ backgroundColor: c.hex }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-mono text-sm" dir="ltr">
                          {c.hex}
                          {c.neutral ? <Badge variant="muted">ניטרלי</Badge> : null}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground" title={c.variables.join(', ')}>
                          ציון {c.score} · {c.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')}
                          {c.variables.length ? ` · ${c.variables.slice(0, 2).join(' ')}` : ''}
                        </div>
                      </div>
                      <div className="w-28 shrink-0">
                        <Select value={roles[c.hex] ?? ''} onChange={(e) => setRole(c.hex, e.target.value as Role | '')} aria-label={`תפקיד עבור ${c.hex}`}>
                          <option value="">—</option>
                          {ROLES.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Fonts */}
            <section className="flex flex-col gap-2">
              <h4 className="text-sm font-medium">פונטים ({analysis.fonts.length})</h4>
              {analysis.fonts.length === 0 ? (
                <p className="text-sm text-muted-foreground">לא נמצאו פונטים ב-CSS של האתר.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-start font-medium">משפחה</th>
                        <th className="px-3 py-2 text-start font-medium">מקור</th>
                        <th className="px-3 py-2 text-center font-medium">כותרות</th>
                        <th className="px-3 py-2 text-center font-medium">טקסט</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.fonts.map((f) => (
                        <tr key={f.family} className="border-t">
                          <td className="px-3 py-2" dir="ltr">
                            <span className="text-start">{f.family}</span>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{f.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ')} · ציון {f.score}</td>
                          <td className="px-3 py-2 text-center">
                            <input type="radio" name="font-heading" checked={fonts.heading === f.family} onChange={() => setFonts((p) => ({ ...p, heading: f.family }))} aria-label={`${f.family} לכותרות`} />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input type="radio" name="font-body" checked={fonts.body === f.family} onChange={() => setFonts((p) => ({ ...p, body: f.family }))} aria-label={`${f.family} לטקסט`} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">ודאו שהפונטים מורשים לשימוש מסחרי לפני שימוש בקריאייטיבים.</p>
            </section>

            {analysis.description ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4 rounded border-input" checked={useDescription} onChange={(e) => setUseDescription(e.target.checked)} />
                <span>
                  עדכן את תיאור המותג מה-meta description של האתר:
                  <span className="block text-muted-foreground">&quot;{analysis.description}&quot;</span>
                </span>
              </label>
            ) : null}

            <div className="flex items-center gap-3">
              <Button onClick={apply} disabled={applying || disabled}>
                {applying ? <Loader2 className="animate-spin" /> : null}
                {applying ? 'מחיל…' : 'החל על ה-Brand Kit'}
              </Button>
              <Button variant="ghost" onClick={() => setAnalysis(null)} disabled={applying}>
                ביטול
              </Button>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
