/**
 * Deterministic quality rules for marketing copy (runs before storage and
 * again in the editor). Blocks invented prices and forbidden claims, warns on
 * unverified numbers and superlatives. Pure: no DB, no network.
 */
import type { FactsPacket } from './facts';

export interface QaFinding {
  rule: string;
  severity: 'BLOCK' | 'WARN';
  field?: string;
  text: string;
  reason: string;
}

export interface QaReport {
  status: 'PASSED' | 'WARN' | 'BLOCKED';
  findings: QaFinding[];
  ranAt: string;
}

/** NFKC, strip nikud/cantillation, normalise final letters, collapse whitespace, lowercase. */
export function normalizeHebrew(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '')
    .replace(/ך/g, 'כ')
    .replace(/ם/g, 'מ')
    .replace(/ן/g, 'נ')
    .replace(/ף/g, 'פ')
    .replace(/ץ/g, 'צ')
    .replace(/["'“”׳״]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const PRICE_RE = /(\d[\d,.]*)\s*(?:₪|ש["״]ח|שח|שקל(?:ים)?|ils|nis)|(?:₪|ils|nis)\s*(\d[\d,.]*)/gi;
const PERCENT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/g;
const SUPERLATIVE_RE = /(הכי (?:טוב|זול|מהיר|מאובטח|גדול)|הטוב ביותר|הזול ביותר|המהיר ביותר|מספר 1|מס['׳] 1|100%|ללא תחרות|מובטח|מבטיחים|ערובה|הבטחה|אין שני לו|היחיד(?:ה)? בישראל)/g;
const BIG_NUMBER_RE = /(\d{1,3}(?:[,.]\d{3})+|\d{4,})\s*(לקוחות|אתרים|שרתים|משתמשים|עסקים|מנויים|ביקורות|שנים|שנות)/g;

type CopyFields = Record<string, string | null | undefined>;

export function runCopyQa(copy: CopyFields, packet: Pick<FactsPacket, 'forbiddenClaims' | 'allowedClaims' | 'verifiedPrices' | 'text'>): QaReport {
  const findings: QaFinding[] = [];
  const packetNorm = normalizeHebrew(packet.text);
  const allowedNorm = packet.allowedClaims.map(normalizeHebrew);
  const forbiddenNorm = packet.forbiddenClaims.map(normalizeHebrew).filter(Boolean);

  for (const [field, raw] of Object.entries(copy)) {
    if (!raw) continue;
    const text = String(raw);
    const norm = normalizeHebrew(text);

    for (const [i, f] of forbiddenNorm.entries()) {
      if (f && norm.includes(f)) {
        findings.push({ rule: 'forbidden_claim', severity: 'BLOCK', field, text: packet.forbiddenClaims[i]!, reason: 'טענה שהוגדרה כאסורה ב-Brand Kit' });
      }
    }

    for (const m of text.matchAll(PRICE_RE)) {
      const value = Number((m[1] ?? m[2] ?? '').replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      if (!packet.verifiedPrices.some((p) => Math.abs(p - value) < 0.005)) {
        findings.push({ rule: 'unverified_price', severity: 'BLOCK', field, text: m[0], reason: 'מחיר שאינו מופיע במוצרים המאומתים' });
      }
    }

    // A price field / layer carries a price even without a currency sign ("49", "49.90").
    if (/price|מחיר/i.test(field) && !new RegExp(PRICE_RE.source, 'i').test(text)) {
      for (const m of text.matchAll(/\d+(?:[.,]\d+)?/g)) {
        const value = Number(m[0].replace(',', '.'));
        if (!packet.verifiedPrices.some((p) => Math.abs(p - value) < 0.005)) {
          findings.push({ rule: 'unverified_price', severity: 'BLOCK', field, text: m[0], reason: 'מחיר שאינו מופיע במוצרים המאומתים' });
        }
      }
    }

    for (const m of text.matchAll(PERCENT_RE)) {
      if (!packetNorm.includes(`${m[1]}%`) && !packetNorm.includes(`${m[1]} %`)) {
        findings.push({ rule: 'unverified_percent', severity: 'WARN', field, text: m[0], reason: 'אחוז שאינו מופיע במידע המאושר' });
      }
    }

    for (const m of text.matchAll(SUPERLATIVE_RE)) {
      const phrase = normalizeHebrew(m[0]);
      if (allowedNorm.some((a) => a.includes(phrase) || phrase.includes(a))) continue;
      findings.push({ rule: 'superlative', severity: 'WARN', field, text: m[0], reason: 'סופרלטיב / הבטחה ללא ביסוס' });
    }

    for (const m of text.matchAll(BIG_NUMBER_RE)) {
      if (!packetNorm.includes(normalizeHebrew(m[1]!))) {
        findings.push({ rule: 'unverified_number', severity: 'WARN', field, text: m[0], reason: 'מספר שאינו מופיע במידע המאושר' });
      }
    }
  }

  const status = findings.some((f) => f.severity === 'BLOCK') ? 'BLOCKED' : findings.length ? 'WARN' : 'PASSED';
  return { status, findings, ranAt: new Date().toISOString() };
}
