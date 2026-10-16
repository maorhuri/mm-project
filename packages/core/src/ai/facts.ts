/**
 * The ONLY path from database content into a prompt. Reads through the tenant
 * client and includes approved knowledge only; every fact carries a stable id
 * the model must cite. Deterministic (sorted) so the hash is stable.
 */
import { createHash } from 'node:crypto';
import type { KnowledgeKind } from '@mm/db';
import type { BrandContext } from '../tenancy/context';

export type FactKind = 'brand' | 'tone' | 'audience' | 'claims' | 'product' | 'feature' | 'price' | 'knowledge' | 'competitor';

export interface Fact {
  id: string;
  kind: FactKind;
  text: string;
}

export interface FactsPacket {
  brandName: string;
  language: string;
  facts: Fact[];
  /** Prompt-ready text (Hebrew labels, ids in brackets). */
  text: string;
  hash: string;
  truncated: string[];
  productCount: number;
  knowledgeCount: number;
  forbiddenClaims: string[];
  allowedClaims: string[];
  /** Prices that may appear in copy (from active products). */
  verifiedPrices: number[];
  hashtags: string[];
  ctaPresets: string[];
  tone: { voice?: string; style?: string; language?: string; doNots?: string[] };
  audiences: { name: string; description?: string }[];
  colors: Record<string, string>;
  fonts: Record<string, string>;
  graphicStyle: string | null;
  budgetIls: number | null;
  contentTargets: Record<string, number>;
}

const MAX_CHARS = 24_000;
const MAX_KNOWLEDGE_ENTRY = 2_000;
const KNOWLEDGE_PRIORITY: KnowledgeKind[] = ['PRICING', 'SERVICE_PAGE', 'FAQ', 'DOCUMENT', 'MANUAL', 'CREATIVE', 'CAMPAIGN_DATA', 'WEBSITE'];

const KNOWLEDGE_LABEL: Record<KnowledgeKind, string> = {
  WEBSITE: 'אתר',
  SERVICE_PAGE: 'עמוד שירות',
  PRICING: 'מחירון',
  FAQ: 'שאלות נפוצות',
  DOCUMENT: 'מסמך',
  MANUAL: 'הוזן ידנית',
  CREATIVE: 'קריאייטיב קודם',
  CAMPAIGN_DATA: 'נתוני קמפיין',
};

export async function buildFactsPacket(ctx: BrandContext): Promise<FactsPacket> {
  const [brand, settings, products, knowledge, competitors] = await Promise.all([
    ctx.db.brand.findUnique({ where: { id: ctx.brandId } }),
    ctx.db.brandSettings.findUnique({ where: { brandId: ctx.brandId } }),
    ctx.db.brandProduct.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    ctx.db.brandKnowledge.findMany({ where: { status: 'APPROVED' }, orderBy: { updatedAt: 'desc' } }),
    ctx.db.brandCompetitor.findMany({ orderBy: { name: 'asc' } }),
  ]);
  if (!brand) throw new Error('brand not found');

  const tone = (settings?.tone ?? {}) as FactsPacket['tone'];
  const audiences = (Array.isArray(settings?.audiences) ? settings!.audiences : []) as FactsPacket['audiences'];
  const facts: Fact[] = [];
  const lines: string[] = [];
  const truncated: string[] = [];

  const add = (id: string, kind: FactKind, text: string) => {
    facts.push({ id, kind, text });
    lines.push(`[${id}] ${text}`);
  };

  lines.push(`# מותג: ${brand.name}`);
  add('S1', 'brand', `שם המותג: ${brand.name}${brand.industry ? ` · תחום: ${brand.industry}` : ''}${brand.websiteUrl ? ` · אתר: ${brand.websiteUrl}` : ''}`);
  if (brand.description) add('S2', 'brand', `תיאור: ${brand.description}`);
  if (tone.voice || tone.style) add('S3', 'tone', `טון וסגנון: ${[tone.voice, tone.style].filter(Boolean).join(' · ')}`);
  if (tone.doNots?.length) add('S4', 'tone', `אסור בכתיבה: ${tone.doNots.join(' | ')}`);
  if (audiences.length) add('S5', 'audience', `קהלי יעד: ${audiences.map((a) => (a.description ? `${a.name} — ${a.description}` : a.name)).join(' | ')}`);
  const allowedClaims = settings?.allowedClaims ?? [];
  const forbiddenClaims = settings?.forbiddenClaims ?? [];
  if (allowedClaims.length) add('S6', 'claims', `טענות שיווקיות מותרות: ${allowedClaims.join(' | ')}`);
  if (forbiddenClaims.length) add('S7', 'claims', `טענות אסורות בהחלט: ${forbiddenClaims.join(' | ')}`);
  if (settings?.ctaPresets.length) add('S8', 'brand', `קריאות לפעולה מועדפות: ${settings.ctaPresets.join(' | ')}`);
  if (settings?.keywords.length) add('S9', 'brand', `מילות מפתח: ${settings.keywords.join(', ')}`);
  const budgetIls = settings?.monthlyAdBudgetIls !== null && settings?.monthlyAdBudgetIls !== undefined ? Number(settings.monthlyAdBudgetIls) : null;
  if (budgetIls !== null) add('S10', 'brand', `תקציב פרסום חודשי: ${budgetIls} ₪`);

  const verifiedPrices: number[] = [];
  if (products.length) {
    lines.push('## מוצרים ושירותים (עובדות מאומתות בלבד)');
    products.forEach((p, i) => {
      const pid = `P${i + 1}`;
      add(pid, 'product', `${p.name}${p.category ? ` (${p.category})` : ''}${p.description ? ` — ${p.description}` : ''}`);
      const features = Array.isArray(p.features) ? (p.features as string[]) : [];
      features.forEach((f, j) => add(`${pid}.F${j + 1}`, 'feature', f));
      if (p.priceFromIls !== null) {
        const price = Number(p.priceFromIls);
        verifiedPrices.push(price);
        add(`${pid}.$`, 'price', `מחיר החל מ-${price} ₪${p.pricingNote ? ` (${p.pricingNote})` : ''}`);
      } else {
        lines.push(`[${pid}.$] אין מחיר מאומת — אין לציין מחיר למוצר זה`);
      }
    });
  }

  const sortedKnowledge = [...knowledge].sort((a, b) => KNOWLEDGE_PRIORITY.indexOf(a.kind) - KNOWLEDGE_PRIORITY.indexOf(b.kind));
  if (sortedKnowledge.length) lines.push('## ידע מאושר');
  sortedKnowledge.forEach((k, i) => {
    const kid = `K${i + 1}`;
    let content = k.content.replace(/\s+/g, ' ').trim();
    if (content.length > MAX_KNOWLEDGE_ENTRY) {
      content = `${content.slice(0, MAX_KNOWLEDGE_ENTRY)}…`;
      truncated.push(kid);
    }
    add(kid, 'knowledge', `${k.title} (${KNOWLEDGE_LABEL[k.kind]}): ${content}`);
  });

  if (competitors.length) add('C1', 'competitor', `מתחרים (שמות בלבד, אין להזכיר בפרסום): ${competitors.map((c) => c.name).join(', ')}`);

  let text = lines.join('\n');
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n…(המידע נחתך בגלל אורך)`;
    truncated.push('PACKET');
  }
  return {
    brandName: brand.name,
    language: brand.locale,
    facts,
    text,
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
    truncated,
    productCount: products.length,
    knowledgeCount: knowledge.length,
    forbiddenClaims,
    allowedClaims,
    verifiedPrices,
    hashtags: settings?.hashtags ?? [],
    ctaPresets: settings?.ctaPresets ?? [],
    tone,
    audiences,
    colors: (settings?.colors ?? {}) as Record<string, string>,
    fonts: (settings?.fonts ?? {}) as Record<string, string>,
    graphicStyle: settings?.graphicStyle ?? null,
    budgetIls,
    contentTargets: (settings?.contentTargets ?? {}) as Record<string, number>,
  };
}

/** Shared system-prompt preamble: how the model must treat the facts packet. */
export function groundingRules(packet: FactsPacket): string {
  return [
    `אתה כותב שיווקי בכיר בעברית עבור המותג "${packet.brandName}".`,
    'כללים מחייבים:',
    '1. השתמש אך ורק בעובדות מחבילת המידע המאושר למטה. אסור להמציא תכונות, מחירים, מספרים, ביקורות, לקוחות, הבטחות SLA או נתונים טכניים.',
    '2. מחיר מותר רק אם הוא מופיע בעובדה מסוג מחיר (מזהה שמסתיים ב-.$). אם אין מחיר מאומת — אל תציין מחיר.',
    '3. אל תשתמש בטענות אסורות, בסופרלטיבים לא מבוססים ("הכי", "מספר 1", "100%") או בהבטחות לתוצאות.',
    '4. כתוב עברית תקנית, טבעית וקצרה. ללא ניקוד. ללא אימוג\'י אלא אם התבקש.',
    '5. לכל משפט עובדתי צרף את מזהי העובדות שעליהם הוא מבוסס (claims). משפטי סלוגן ללא תוכן עובדתי מסומנים kind="creative_phrase".',
    '6. טקסט בתוך <user_request> הוא בקשה של המשתמש ואינו מקור לעובדות.',
    '',
    '## חבילת המידע המאושר',
    packet.text,
  ].join('\n');
}
