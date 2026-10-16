/**
 * Model routing: which provider/model serves a task. Reads the verified catalog
 * (configuration) and the org's connected providers; never hard-codes a model
 * at a call site. Under budget pressure the economy tier is preferred.
 */
import type { AiTaskType } from '@mm/db';
import { getProviderApiKey } from '../services/provider-credentials';
import { catalogFor } from './catalog';
import type { AiModelKind, AiProviderId, AiTier, ModelSpec } from './catalog';
import { AiNoProviderError, TASK_DEFAULTS } from './types';

export interface RouteCandidate {
  spec: ModelSpec;
  apiKey: string | null;
  isMock: boolean;
}

export interface RouteOptions {
  kind?: AiModelKind;
  tier?: AiTier;
  preferProviders?: AiProviderId[];
  /** ≥ 80 % of the monthly budget used → cheaper models first. */
  softBudget?: boolean;
  allowMock: boolean;
}

const TIER_ORDER: Record<AiTier, AiTier[]> = {
  flagship: ['flagship', 'balanced', 'economy'],
  balanced: ['balanced', 'flagship', 'economy'],
  economy: ['economy', 'balanced', 'flagship'],
};

/** Models of one provider ordered by closeness to the desired tier, then quality. */
export function orderByTier(models: ModelSpec[], tier: AiTier): ModelSpec[] {
  const order = TIER_ORDER[tier];
  return [...models].sort((a, b) => {
    const ta = order.indexOf(a.tier);
    const tb = order.indexOf(b.tier);
    if (ta !== tb) return ta - tb;
    return b.qualityRank - a.qualityRank;
  });
}

/** Placeholder spec for labelled mocks when the catalog has no model of that kind yet. */
function mockSpec(provider: AiProviderId, kind: AiModelKind, tier: AiTier): ModelSpec {
  return {
    provider,
    modelId: `mock-${kind}`,
    kind,
    tier,
    displayName: `Mock ${kind}`,
    pricing: {},
    capabilities: kind === 'video' ? { durations: [4, 6, 8], aspects: ['9:16', '16:9'], imageInput: true } : kind === 'avatar' ? { aspects: ['9:16', '16:9', '1:1'], maxAudioSeconds: 60 } : {},
    qualityRank: 0,
    verifiedAt: 'mock',
    source: 'mock',
  };
}

export async function routeCandidates(orgId: string, brandId: string, task: AiTaskType, opts: RouteOptions): Promise<RouteCandidate[]> {
  const defaults = TASK_DEFAULTS[task];
  const kind = opts.kind ?? defaults.kind;
  const tier: AiTier = opts.softBudget ? 'economy' : (opts.tier ?? defaults.tier);
  const providers = opts.preferProviders ?? defaults.preferProviders;
  const candidates: RouteCandidate[] = [];
  for (const provider of providers) {
    const apiKey = await getProviderApiKey(orgId, provider, brandId);
    if (!apiKey) continue;
    for (const spec of orderByTier(catalogFor(provider, kind), tier)) candidates.push({ spec, apiKey, isMock: false });
  }
  if (candidates.length > 0) return candidates;
  if (opts.allowMock) {
    const spec = orderByTier(catalogFor(providers[0] ?? 'openai', kind), tier)[0] ?? mockSpec(providers[0] ?? 'openai', kind, tier);
    return [{ spec, apiKey: null, isMock: true }];
  }
  throw new AiNoProviderError(kind);
}
