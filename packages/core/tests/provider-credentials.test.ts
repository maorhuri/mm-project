import { describe, expect, it } from 'vitest';
import { db } from '@mm/db';
import { MODEL_CATALOG, estimateCostIls, findModel } from '../src/ai/catalog';
import { ForbiddenError } from '../src/errors';
import { listIntegrationStatus } from '../src/services/integrations';
import {
  getProviderApiKey,
  removeProviderCredentials,
  saveProviderCredentials,
  testProviderKey,
} from '../src/services/provider-credentials';
import type { ConnectionFetcher } from '../src/services/provider-credentials';
import { ctxFor, twoBrandFixture } from './helpers';

describe('model catalog', () => {
  it('has unique ids, verified dates and sources', () => {
    const ids = MODEL_CATALOG.map((m) => `${m.provider}/${m.modelId}`);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODEL_CATALOG) {
      expect(m.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(m.source.startsWith('https://')).toBe(true);
    }
    expect(findModel('anthropic', 'claude-sonnet-5-5')?.pricing.inputUsdPerMTok).toBe(2);
  });

  it('estimates ILS cost from usage', () => {
    const sonnet = findModel('anthropic', 'claude-sonnet-5-5')!;
    // 1000 in + 500 out: (0.002 + 0.005) USD = 0.007 USD * 3.7
    expect(estimateCostIls(sonnet, { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.0259, 3);
    const banana = findModel('google', 'gemini-nano-banana-2.1')!;
    expect(estimateCostIls(banana, { images: 2 })).toBeCloseTo(0.0336 * 2 * 3.7, 3);
  });
});

describe('provider credentials', () => {
  it('stores keys encrypted, resolves them, and removes them', async () => {
    const { owner, editor, org, brandA } = await twoBrandFixture();
    await expect(saveProviderCredentials(editor, org.id, 'openai', { apiKey: 'sk-test-1234567890' })).rejects.toBeInstanceOf(ForbiddenError);

    const row = await saveProviderCredentials(owner, org.id, 'openai', { apiKey: 'sk-test-1234567890' });
    expect(row.status).toBe('CONNECTED');
    expect(row.credentialsEnc).not.toContain('sk-test');
    expect((row.metadata as { keyHint: string }).keyHint).toBe('…7890');
    expect(await getProviderApiKey(org.id, 'openai')).toBe('sk-test-1234567890');
    expect(await getProviderApiKey(org.id, 'anthropic')).toBeNull();

    // Brand-level override wins over the org-wide key.
    await saveProviderCredentials(owner, org.id, 'openai', { apiKey: 'sk-brand-0987654321' }, brandA.id);
    expect(await getProviderApiKey(org.id, 'openai', brandA.id)).toBe('sk-brand-0987654321');
    expect(await getProviderApiKey(org.id, 'openai')).toBe('sk-test-1234567890');

    const status = await listIntegrationStatus(await ctxFor(owner, brandA.id));
    const openai = status.find((s) => s.provider === 'openai')!;
    expect(openai.status).toBe('CONNECTED');
    expect(openai.keyHint).toMatch(/^…/);
    expect(openai.acceptsApiKey).toBe(true);

    await removeProviderCredentials(owner, org.id, 'openai');
    expect(await getProviderApiKey(org.id, 'openai')).toBeNull(); // org-wide key gone; brand keys never leak org-wide
    expect(await getProviderApiKey(org.id, 'openai', brandA.id)).toBe('sk-brand-0987654321'); // brand row still there
    await removeProviderCredentials(owner, org.id, 'openai', brandA.id);
    expect(await getProviderApiKey(org.id, 'openai', brandA.id)).toBeNull();
    expect(await db.providerAccount.count({ where: { orgId: org.id, status: 'CONNECTED' } })).toBe(0);
  });

  it('tests keys against the providers (mocked transport)', async () => {
    const fetcher: ConnectionFetcher = async (url, init) => {
      if (url.includes('api.openai.com')) {
        const ok = init.headers.authorization === 'Bearer good';
        return { status: ok ? 200 : 401, json: async () => (ok ? { data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }] } : { error: { message: 'Incorrect API key' } }) };
      }
      if (url.includes('api.anthropic.com')) {
        return { status: 200, json: async () => ({ data: [{ id: 'claude-sonnet-5-5' }] }) };
      }
      return { status: 400, json: async () => ({ error: { message: 'API key not valid' } }) };
    };
    const good = await testProviderKey('openai', 'good', fetcher);
    expect(good.ok).toBe(true);
    expect(good.models).toEqual(['gpt-6-luna', 'gpt-6.1-sol']); // sorted ('-' < '.')
    const bad = await testProviderKey('openai', 'bad', fetcher);
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain('401');
    expect((await testProviderKey('anthropic', 'x', fetcher)).models).toEqual(['claude-sonnet-5-5']);
    expect((await testProviderKey('google', 'x', fetcher)).error).toContain('API key not valid');
  });
});
