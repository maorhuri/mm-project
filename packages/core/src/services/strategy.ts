/**
 * Strategy agent v1: goals, audiences, campaign proposals and a two-week
 * content plan — every item cites the approved facts it rests on and carries a
 * confidence level; gaps in the data are listed instead of being papered over.
 */
import type { BriefKind, BriefStatus, Prisma, StrategyBrief } from '@mm/db';
import { z } from 'zod';
import { runText } from '../ai/engine';
import type { RunTextResult } from '../ai/engine';
import { buildFactsPacket, groundingRules } from '../ai/facts';
import { AiOutputInvalidError } from '../ai/types';
import { auditFromContext } from '../audit';
import { NotFoundError } from '../errors';
import type { BrandContext } from '../tenancy/context';
import { assertBrandRole } from '../tenancy/context';
import type { BriefRequestInput } from '../validation';

export const BRIEF_KIND_LABELS: Record<BriefKind, string> = {
  GOALS: 'יעדים שיווקיים',
  AUDIENCES: 'קהלי יעד ומסרים',
  CAMPAIGN_PROPOSAL: 'הצעת קמפיינים',
  CONTENT_PLAN: 'תוכנית תוכן לשבועיים',
};

const KIND_INSTRUCTIONS: Record<BriefKind, string> = {
  GOALS: 'הגדר 3–5 יעדים שיווקיים מדידים לרבעון הקרוב. לכל יעד: מה מודדים (kpi), למה הוא נכון למותג הזה לפי העובדות, ומה חסר כדי לקבוע יעד מספרי (dataGap). אל תמציא מספרי בסיס — אם אין נתוני ביצועים בעובדות, ציין זאת ב-dataGap.',
  AUDIENCES: 'פרט 3–5 סגמנטים של קהל יעד. לכל סגמנט: מי הם, כאבים, המסר המרכזי שמתאים להם, ערוצים מומלצים (channel) ואילו עובדות תומכות. אם קהלי היעד ב-Brand Kit דלים, אמור זאת ב-dataGap.',
  CAMPAIGN_PROPOSAL: 'הצע 2–4 קמפיינים. לכל קמפיין: מטרה, ערוץ (channel), קהל, מסר מרכזי, כיוון קריאייטיב, ומסגרת זמן (when). תקציב (budgetIls) רק אם קיימת עובדת תקציב — אחרת null ו-dataGap. אין להבטיח תוצאות.',
  CONTENT_PLAN: 'בנה תוכנית תוכן ל-14 יום: 6–12 פריטים. לכל פריט: when (יום ושעה מוצעים), channel, פורמט (בשדה kpi כתוב את הפורמט: פוסט / רילס / סטורי / מאמר), נושא ו-detail עם הוק. שלב בין תוכן שיווקי, מקצועי ואמון. אם הוגדרו יעדי תוכן חודשיים בעובדות — כבד אותם.',
};

const BRIEF_FORMAT = `
## פורמט הפלט (JSON בלבד)
{"title":"כותרת הבריף","summary":"2–4 משפטים","items":[{"title":"...","detail":"...","basis":["S1","P2.F1"],"confidence":"HIGH|MEDIUM|LOW","dataGap":null,"kpi":null,"channel":null,"when":null,"budgetIls":null}],"dataGaps":["מה חסר כדי לדייק"]}
- basis: מזהי עובדות מחבילת המידע בלבד. פריט ללא ביסוס עובדתי → basis ריק ו-confidence LOW.
- confidence HIGH רק כשהפריט נשען ישירות על עובדות מאומתות.
- אל תמציא נתוני שוק, מספרים או מתחרים שלא בעובדות.`;

const briefOutputSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).default(''),
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        detail: z.string().max(2000).default(''),
        basis: z.array(z.string().max(24)).default([]),
        confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
        dataGap: z.string().max(500).nullish(),
        kpi: z.string().max(200).nullish(),
        channel: z.string().max(100).nullish(),
        when: z.string().max(120).nullish(),
        budgetIls: z.number().nullish(),
      }),
    )
    .default([]),
  dataGaps: z.array(z.string().max(300)).default([]),
});

export interface BriefItem {
  title: string;
  detail: string;
  basis: string[];
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  dataGap: string | null;
  kpi: string | null;
  channel: string | null;
  when: string | null;
  budgetIls: number | null;
}

export interface BriefContent {
  summary: string;
  items: BriefItem[];
  dataGaps: string[];
  model: string;
  provider: string;
  isMock: boolean;
  factsHash: string;
  factCount: number;
  generatedAt: string;
}

export async function generateStrategyBrief(ctx: BrandContext, input: BriefRequestInput): Promise<{ brief: StrategyBrief; run: RunTextResult }> {
  assertBrandRole(ctx, 'EDITOR');
  const packet = await buildFactsPacket(ctx);
  const prompt = ['<user_request>', KIND_INSTRUCTIONS[input.kind], input.focus ? `דגש מהמשתמש: ${input.focus}` : '', '</user_request>'].filter(Boolean).join('\n');
  const run = await runText(ctx, {
    task: 'STRATEGY_BRIEF',
    label: BRIEF_KIND_LABELS[input.kind],
    system: `${groundingRules(packet)}\n\nאתה אסטרטג שיווק בכיר. ${BRIEF_FORMAT}`,
    prompt,
    json: true,
    maxOutputTokens: 4500,
    factsHash: packet.hash,
    metadata: { kind: input.kind },
  });
  const parsed = briefOutputSchema.safeParse(run.json);
  if (!parsed.success) throw new AiOutputInvalidError('המודל החזיר בריף במבנה לא צפוי — נסו שוב');
  const known = new Set(packet.facts.map((f) => f.id));
  let items: BriefItem[] = parsed.data.items.map((it) => {
    const basis = it.basis.filter((id) => known.has(id));
    const dropped = it.basis.length - basis.length;
    let confidence = it.confidence;
    let dataGap = it.dataGap?.trim() || null;
    if (dropped > 0) {
      confidence = 'LOW';
      dataGap = [dataGap, 'המודל ציטט מזהי עובדות שאינם קיימים — הוסרו'].filter(Boolean).join(' · ');
    }
    if (basis.length === 0 && confidence === 'HIGH') confidence = 'MEDIUM';
    let budgetIls = typeof it.budgetIls === 'number' && Number.isFinite(it.budgetIls) ? it.budgetIls : null;
    if (budgetIls !== null && packet.budgetIls === null) {
      budgetIls = null;
      dataGap = [dataGap, 'לא הוגדר תקציב פרסום ב-Brand Kit — הצעת התקציב הוסרה'].filter(Boolean).join(' · ');
    }
    return { title: it.title.trim(), detail: it.detail.trim(), basis, confidence, dataGap, kpi: it.kpi?.trim() || null, channel: it.channel?.trim() || null, when: it.when?.trim() || null, budgetIls };
  });
  if (run.isMock && items.length === 0) {
    items = [{ title: '[MOCK] אין ספק AI מחובר', detail: 'חברו מפתח API בעמוד האינטגרציות כדי לקבל בריף אמיתי המבוסס על העובדות המאושרות של המותג.', basis: [], confidence: 'LOW', dataGap: 'אין ספק AI', kpi: null, channel: null, when: null, budgetIls: null }];
  }
  if (items.length === 0) throw new AiOutputInvalidError('המודל לא החזיר פריטים — נסו שוב');
  const content: BriefContent = {
    summary: parsed.data.summary.trim(),
    items,
    dataGaps: [...new Set(parsed.data.dataGaps.map((g) => g.trim()).filter(Boolean))],
    model: run.modelId,
    provider: run.provider,
    isMock: run.isMock,
    factsHash: packet.hash,
    factCount: packet.facts.length,
    generatedAt: new Date().toISOString(),
  };
  const brief = await ctx.db.strategyBrief.create({
    data: {
      brandId: ctx.brandId,
      kind: input.kind,
      title: (run.isMock ? '[MOCK] ' : '') + parsed.data.title.trim(),
      content: content as unknown as Prisma.InputJsonObject,
      factsHash: packet.hash,
      aiRunId: run.run.id,
      status: 'DRAFT',
      createdById: ctx.actor.userId || null,
    },
  });
  await auditFromContext(ctx, { action: 'strategy.brief.generate', entityType: 'strategy_brief', entityId: brief.id, after: { kind: brief.kind, items: items.length, model: run.modelId, mock: run.isMock } });
  return { brief, run };
}

export async function listStrategyBriefs(ctx: BrandContext, kind?: BriefKind): Promise<StrategyBrief[]> {
  return ctx.db.strategyBrief.findMany({ where: { ...(kind ? { kind } : {}), status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' }, take: 50 });
}

export async function getStrategyBrief(ctx: BrandContext, briefId: string): Promise<StrategyBrief> {
  const brief = await ctx.db.strategyBrief.findUnique({ where: { id: briefId } });
  if (!brief) throw new NotFoundError('strategy brief');
  return brief;
}

export async function setStrategyBriefStatus(ctx: BrandContext, briefId: string, status: BriefStatus): Promise<StrategyBrief> {
  assertBrandRole(ctx, 'EDITOR');
  await getStrategyBrief(ctx, briefId);
  const updated = await ctx.db.strategyBrief.update({ where: { id: briefId }, data: { status } });
  await auditFromContext(ctx, { action: 'strategy.brief.status', entityType: 'strategy_brief', entityId: briefId, after: { status } });
  return updated;
}
