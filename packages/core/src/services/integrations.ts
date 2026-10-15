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
  { provider: 'anthropic', kind: 'AI_TEXT', label: 'Anthropic Claude', phase: 2, scope: 'org' },
  { provider: 'openai', kind: 'AI_TEXT', label: 'OpenAI GPT', phase: 2, scope: 'org' },
  { provider: 'google_ai', kind: 'AI_TEXT', label: 'Google Gemini', phase: 2, scope: 'org' },
  { provider: 'image_gen', kind: 'AI_IMAGE', label: 'Image generation', phase: 2, scope: 'org' },
  { provider: 'video_gen', kind: 'AI_VIDEO', label: 'Video generation', phase: 3, scope: 'org' },
  { provider: 'tts', kind: 'AI_TTS', label: 'Text-to-speech (Hebrew)', phase: 3, scope: 'org' },
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
}

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
    return {
      ...entry,
      status: row?.status ?? 'DISCONNECTED',
      accountId: row?.id ?? null,
      externalAccountId: row?.externalAccountId ?? null,
      lastSyncAt: row?.lastSyncAt ?? null,
      lastError: row?.lastError ?? null,
    };
  });
}
