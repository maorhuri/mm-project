/**
 * Encrypted provider credentials (org-wide by default, optional per-brand
 * override) and a real connection test against each provider's models endpoint.
 */
import { db } from '@mm/db';
import type { ProviderAccount, ProviderKind } from '@mm/db';
import { recordAudit } from '../audit';
import { getConfig } from '../config';
import { decryptJson, encryptJson } from '../crypto';
import { NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import type { Actor } from '../tenancy/context';
import { requireOrgAdmin } from '../tenancy/context';
import type { AiProviderId } from '../ai/catalog';
import { PROVIDER_LABELS } from '../ai/catalog';

export interface ProviderSecret {
  apiKey: string;
}

const KIND_BY_PROVIDER: Record<AiProviderId, ProviderKind> = {
  openai: 'AI_TEXT',
  anthropic: 'AI_TEXT',
  google: 'AI_TEXT',
  fal: 'AI_VIDEO',
};

/** Resolve the API key for a provider: brand override → org-wide row → environment variable. */
export async function getProviderApiKey(orgId: string, provider: AiProviderId, brandId?: string | null): Promise<string | null> {
  const rows = await db.providerAccount.findMany({
    where: { orgId, provider, status: { not: 'DISCONNECTED' }, OR: [{ brandId: null }, ...(brandId ? [{ brandId }] : [])] },
  });
  // Brand-specific row first (Postgres would sort NULL brand ids first on DESC, so sort here).
  rows.sort((a, b) => Number(b.brandId !== null) - Number(a.brandId !== null));
  for (const row of rows) {
    if (row.credentialsEnc) {
      try {
        const secret = decryptJson<ProviderSecret>(row.credentialsEnc);
        if (secret.apiKey) return secret.apiKey;
      } catch (err) {
        logger.error({ err, provider, rowId: row.id }, 'provider credentials could not be decrypted');
      }
    }
  }
  const env = getConfig();
  const fromEnv: Record<AiProviderId, string | undefined> = {
    openai: process.env.OPENAI_API_KEY || undefined,
    anthropic: process.env.ANTHROPIC_API_KEY || undefined,
    google: process.env.GOOGLE_AI_API_KEY || undefined,
    fal: process.env.FAL_KEY || undefined,
  };
  void env;
  return fromEnv[provider] ?? null;
}

/** Store (or replace) a provider API key, encrypted. Org OWNER/ADMIN only. */
export async function saveProviderCredentials(
  actor: Actor,
  orgId: string,
  provider: AiProviderId,
  secret: ProviderSecret,
  brandId: string | null = null,
): Promise<ProviderAccount> {
  await requireOrgAdmin(actor, orgId);
  const apiKey = secret.apiKey.trim();
  if (apiKey.length < 10) throw new ValidationError('API key looks too short');
  const existing = await db.providerAccount.findFirst({ where: { orgId, provider, brandId } });
  const data = {
    orgId,
    brandId,
    provider,
    kind: KIND_BY_PROVIDER[provider],
    label: PROVIDER_LABELS[provider],
    status: 'CONNECTED' as const,
    credentialsEnc: encryptJson({ apiKey }),
    lastError: null,
    metadata: { keyHint: `…${apiKey.slice(-4)}`, savedBy: actor.userId },
  };
  const row = existing
    ? await db.providerAccount.update({ where: { id: existing.id }, data })
    : await db.providerAccount.create({ data });
  await recordAudit(
    { orgId, brandId, actorUserId: actor.userId },
    { action: 'integration.credentials.save', entityType: 'provider_account', entityId: row.id, metadata: { provider, keyHint: data.metadata.keyHint } },
  );
  return row;
}

export async function removeProviderCredentials(actor: Actor, orgId: string, provider: AiProviderId, brandId: string | null = null): Promise<void> {
  await requireOrgAdmin(actor, orgId);
  const existing = await db.providerAccount.findFirst({ where: { orgId, provider, brandId } });
  if (!existing) throw new NotFoundError('provider connection');
  await db.providerAccount.update({
    where: { id: existing.id },
    data: { status: 'DISCONNECTED', credentialsEnc: null, lastError: null, metadata: {} },
  });
  await recordAudit(
    { orgId, brandId, actorUserId: actor.userId },
    { action: 'integration.credentials.remove', entityType: 'provider_account', entityId: existing.id, metadata: { provider } },
  );
}

export interface ConnectionTestResult {
  ok: boolean;
  provider: AiProviderId;
  /** Model ids the account can see (first 40), when the provider lists them. */
  models: string[];
  error: string | null;
  latencyMs: number;
}

export type ConnectionFetcher = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number; json: () => Promise<unknown> }>;

const defaultFetcher: ConnectionFetcher = async (url, init) => {
  const res = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, json: () => res.json() };
};

/** Call the provider's models endpoint with the key — the only reliable "does this key work" check. */
export async function testProviderKey(provider: AiProviderId, apiKey: string, fetcher: ConnectionFetcher = defaultFetcher): Promise<ConnectionTestResult> {
  const started = Date.now();
  const done = (ok: boolean, models: string[], error: string | null): ConnectionTestResult => ({ ok, provider, models, error, latencyMs: Date.now() - started });
  try {
    let status: number;
    let body: unknown;
    if (provider === 'openai') {
      const res = await fetcher('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${apiKey}` } });
      status = res.status;
      body = status < 400 ? await res.json() : await res.json().catch(() => null);
      if (status >= 400) return done(false, [], errorMessage(body, status));
      const data = (body as { data?: { id: string }[] }).data ?? [];
      return done(true, data.map((m) => m.id).sort().slice(0, 40), null);
    }
    if (provider === 'anthropic') {
      const res = await fetcher('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } });
      status = res.status;
      body = await res.json().catch(() => null);
      if (status >= 400) return done(false, [], errorMessage(body, status));
      const data = (body as { data?: { id: string }[] }).data ?? [];
      return done(true, data.map((m) => m.id).slice(0, 40), null);
    }
    if (provider === 'fal') {
      // fal has no public model listing per key; the usage endpoint rejects invalid keys with 401.
      const res = await fetcher('https://api.fal.ai/v1/models/usage', { headers: { authorization: `Key ${apiKey}` } });
      status = res.status;
      body = await res.json().catch(() => null);
      if (status === 401) return done(false, [], errorMessage(body, status));
      if (status >= 500) return done(false, [], errorMessage(body, status));
      return done(true, ['fal-ai/kling-video/ai-avatar/v2/pro', 'fal-ai/kling-video/ai-avatar/v2/standard'], null);
    }
    const res = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(apiKey)}`, { headers: {} });
    status = res.status;
    body = await res.json().catch(() => null);
    if (status >= 400) return done(false, [], errorMessage(body, status));
    const models = (body as { models?: { name: string }[] }).models ?? [];
    return done(true, models.map((m) => m.name.replace(/^models\//, '')).slice(0, 40), null);
  } catch (err) {
    return done(false, [], err instanceof Error ? err.message : String(err));
  }
}

function errorMessage(body: unknown, status: number): string {
  const msg =
    (body as { error?: { message?: string } } | null)?.error?.message ??
    (typeof body === 'string' ? body : null) ??
    `HTTP ${status}`;
  return `HTTP ${status}: ${String(msg).slice(0, 300)}`;
}

/** Test the stored key for a provider and persist the outcome on the connection row. */
export async function testProviderConnection(actor: Actor, orgId: string, provider: AiProviderId, brandId: string | null = null): Promise<ConnectionTestResult> {
  await requireOrgAdmin(actor, orgId);
  const apiKey = await getProviderApiKey(orgId, provider, brandId);
  if (!apiKey) return { ok: false, provider, models: [], error: 'No API key configured', latencyMs: 0 };
  const result = await testProviderKey(provider, apiKey);
  const row = await db.providerAccount.findFirst({ where: { orgId, provider, brandId } });
  if (row) {
    await db.providerAccount.update({
      where: { id: row.id },
      data: {
        status: result.ok ? 'CONNECTED' : 'ERROR',
        lastSyncAt: new Date(),
        lastError: result.ok ? null : result.error,
        metadata: { ...((row.metadata as Record<string, unknown>) ?? {}), modelsSeen: result.models.length, testedAt: new Date().toISOString() },
      },
    });
  }
  await recordAudit(
    { orgId, brandId, actorUserId: actor.userId },
    { action: 'integration.test', entityType: 'provider_account', entityId: row?.id ?? null, metadata: { provider, ok: result.ok, error: result.error } },
  );
  return result;
}
