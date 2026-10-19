import { db } from '@mm/db';
import type { ConnectionStatus, ProviderKind } from '@mm/db';
import type { BrandContext } from '../tenancy/context';

export interface IntegrationCatalogEntry {
  provider: string;
  kind: ProviderKind;
  label: string;
  /** Roadmap phase in which the real adapter is built. */
  phase: number;
  scope: 'org' | 'brand';
}

/** Integrations the platform is designed for. Status comes from provider_accounts. */
export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  { provider: 'openai', kind: 'AI_TEXT', label: 'OpenAI — טקסט, תמונות וקריינות', phase: 2, scope: 'org' },
  { provider: 'anthropic', kind: 'AI_TEXT', label: 'Anthropic Claude — טקסט, QA ואסטרטגיה', phase: 2, scope: 'org' },
  { provider: 'google', kind: 'AI_TEXT', label: 'Google Gemini — טקסט, תמונות ווידאו (Veo 3.1)', phase: 2, scope: 'org' },
  { provider: 'fal', kind: 'AI_VIDEO', label: 'fal.ai — דמויות מדברות (Kling AI Avatar)', phase: 3, scope: 'org' },
  { provider: 'meta', kind: 'META', label: 'Meta — Facebook Page / Instagram / Ads', phase: 4, scope: 'brand' },
  { provider: 'google_ads', kind: 'GOOGLE_ADS', label: 'Google Ads', phase: 5, scope: 'brand' },
  { provider: 'linkedin', kind: 'LINKEDIN', label: 'LinkedIn Pages', phase: 6, scope: 'brand' },
  { provider: 'google_business', kind: 'GOOGLE_BUSINESS', label: 'Google Business Profile', phase: 6, scope: 'brand' },
];

export interface IntegrationStatus extends IntegrationCatalogEntry {
  status: ConnectionStatus;
  accountId: string | null;
  externalAccountId: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  /** Masked hint of the stored key (e.g. "…ab12"), never the key itself. */
  keyHint: string | null;
  /** True when an API key can be entered for this provider in the UI. */
  acceptsApiKey: boolean;
}

const API_KEY_PROVIDERS = new Set(['openai', 'anthropic', 'google', 'fal']);

/**
 * Catalog merged with real connection rows. Org-wide rows (brandId null) and
 * this brand's rows are both visible; other brands' rows never are.
 */
export async function listIntegrationStatus(ctx: BrandContext): Promise<IntegrationStatus[]> {
  const rows = await db.providerAccount.findMany({
    where: { orgId: ctx.orgId, OR: [{ brandId: null }, { brandId: ctx.brandId }] },
    orderBy: { updatedAt: 'desc' },
  });
  return INTEGRATION_CATALOG.map((entry) => {
    const row = rows.find((r) => r.provider === entry.provider);
    const meta = (row?.metadata as { keyHint?: string } | null) ?? null;
    return {
      ...entry,
      status: row?.status ?? 'DISCONNECTED',
      accountId: row?.id ?? null,
      externalAccountId: row?.externalAccountId ?? null,
      lastSyncAt: row?.lastSyncAt ?? null,
      lastError: row?.lastError ?? null,
      keyHint: row?.status !== 'DISCONNECTED' ? (meta?.keyHint ?? null) : null,
      acceptsApiKey: API_KEY_PROVIDERS.has(entry.provider),
    };
  });
}
