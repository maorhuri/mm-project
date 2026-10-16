import { describe, expect, it } from 'vitest';
import { db } from '@mm/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../src/errors';
import type { GraphFetcher } from '../src/meta/graph';
import { GraphClient, MetaApiError, minorToMajor } from '../src/meta/graph';
import {
  buildMetaConnectUrl,
  completeMetaConnect,
  createMetaState,
  disconnectMeta,
  getAdsOverview,
  getMetaConnection,
  metaRedirectUri,
  saveMetaAppCredentials,
  selectMetaAssets,
  syncMetaAds,
  verifyMetaState,
} from '../src/services/meta';
import { ctxFor, twoBrandFixture } from './helpers';

/** Fake Graph API: answers by path, supports one paginated endpoint, records calls (never the secret). */
function fakeGraph(): { fetcher: GraphFetcher; calls: string[] } {
  const calls: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const fetcher: GraphFetcher = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + (u.searchParams.get('after') ? '?after' : ''));
    const token = u.searchParams.get('access_token');
    const reply = (body: unknown, status = 200) => ({ status, headers: { get: () => null }, text: async () => JSON.stringify(body) });
    if (u.pathname.endsWith('/oauth/access_token')) {
      if (u.searchParams.get('grant_type') === 'fb_exchange_token') return reply({ access_token: 'LONG-LIVED-TOKEN', token_type: 'bearer', expires_in: 5_184_000 });
      if (u.searchParams.get('code') !== 'good-code') return reply({ error: { message: 'Invalid verification code format.', type: 'OAuthException', code: 100 } }, 400);
      return reply({ access_token: 'SHORT-TOKEN', token_type: 'bearer', expires_in: 5000 });
    }
    if (u.pathname.endsWith('/debug_token')) return reply({ data: { app_id: '123456789', type: 'USER', expires_at: Math.floor(Date.now() / 1000) + 5_000_000, is_valid: true, scopes: ['ads_read', 'pages_show_list'], user_id: '777' } });
    if (token !== 'LONG-LIVED-TOKEN') return reply({ error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } }, 401);
    if (u.pathname.endsWith('/me')) return reply({ id: '777', name: 'מאור בדיקה' });
    if (u.pathname.endsWith('/me/adaccounts')) return reply({ data: [{ id: 'act_1', account_id: '1', name: 'MVN Ads', currency: 'ILS', timezone_name: 'Asia/Jerusalem', account_status: 1 }] });
    if (u.pathname.endsWith('/me/accounts')) return reply({ data: [{ id: 'page1', name: 'MVN Page', access_token: 'PAGE-TOKEN', instagram_business_account: { id: 'ig1', username: 'mvn' } }] });
    if (u.pathname.endsWith('/act_1/campaigns')) {
      if (u.searchParams.get('after') === 'c2') return reply({ data: [{ id: 'c2', name: 'קמפיין ב', objective: 'OUTCOME_LEADS', status: 'PAUSED', effective_status: 'PAUSED', lifetime_budget: '500000' }] });
      return reply({ data: [{ id: 'c1', name: 'קמפיין א', objective: 'OUTCOME_TRAFFIC', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '10000', start_time: '2026-10-01T00:00:00+0300' }], paging: { cursors: { after: 'c2' }, next: `${u.origin}${u.pathname}?after=c2&access_token=${token}` } });
    }
    if (u.pathname.endsWith('/act_1/adsets')) return reply({ data: [{ id: 's1', name: 'סט 1', campaign_id: 'c1', status: 'ACTIVE', effective_status: 'ACTIVE', daily_budget: '10000', optimization_goal: 'LINK_CLICKS', billing_event: 'IMPRESSIONS' }, { id: 's9', name: 'orphan', campaign_id: 'missing' }] });
    if (u.pathname.endsWith('/act_1/ads')) return reply({ data: [{ id: 'a1', name: 'מודעה 1', adset_id: 's1', status: 'ACTIVE', effective_status: 'ACTIVE', creative: { id: 'cr1', thumbnail_url: 'https://example.com/t.jpg' } }] });
    if (u.pathname.endsWith('/act_1/insights')) {
      const level = u.searchParams.get('level');
      if (level === 'account') return reply({ data: [{ date_start: today, date_stop: today, spend: '12.50', impressions: '1000', clicks: '40', reach: '800', cpc: '0.3125', cpm: '12.5', ctr: '4', account_currency: 'ILS', actions: [{ action_type: 'link_click', value: '40' }] }] });
      return reply({ data: [{ campaign_id: 'c1', campaign_name: 'קמפיין א', date_start: today, date_stop: today, spend: '12.50', impressions: '1000', clicks: '40', reach: '800', cpc: '0.3125', cpm: '12.5', ctr: '4' }] });
    }
    return reply({ error: { message: `unknown path ${u.pathname}`, code: 803 } }, 404);
  };
  return { fetcher, calls };
}

describe('Meta OAuth state', () => {
  it('signs and verifies a brand/user bound state with expiry', () => {
    const { state, nonce } = createMetaState('brand-1', 'user-1', '/app/integrations');
    const v = verifyMetaState(state);
    expect(v).toMatchObject({ brandId: 'brand-1', userId: 'user-1', nonce, returnTo: '/app/integrations' });
    expect(verifyMetaState(`${state}x`)).toBeNull();
    expect(verifyMetaState(state.replace(/^./, 'Z'))).toBeNull();
    const { state: evil } = createMetaState('b', 'u', 'https://evil.example');
    expect(verifyMetaState(evil)?.returnTo).toBeNull();
  });

  it('maps Graph errors and converts minor units', async () => {
    const client = new GraphClient(async () => ({ status: 400, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190, fbtrace_id: 'x' } }) }));
    await expect(client.get('me', {}, 'bad')).rejects.toMatchObject({ fbCode: 190, status: 401, isAuthError: true });
    expect(minorToMajor('10000')).toBe(100);
    expect(minorToMajor(null)).toBeNull();
    await expect(new GraphClient(async () => ({ status: 200, headers: { get: () => null }, text: async () => 'not json' })).get('me', {}, 't')).rejects.toBeInstanceOf(MetaApiError);
  });
});

describe('Meta connection + read-only sync', () => {
  it('connects a brand via code exchange, discovers assets, syncs the ads mirror and isolates brands', async () => {
    const { owner, editor, org, brandA, brandB } = await twoBrandFixture();
    const ctx = await ctxFor(owner, brandA.id);
    const { fetcher, calls } = fakeGraph();

    await expect(buildMetaConnectUrl(ctx)).rejects.toBeInstanceOf(ConflictError);
    await saveMetaAppCredentials(owner, org.id, { appId: '123456789', appSecret: 'shhh-secret-value-16', configId: '555555555' });
    await expect(saveMetaAppCredentials(editor, org.id, { appId: '123456789', appSecret: 'x'.repeat(20), configId: null })).rejects.toBeInstanceOf(ForbiddenError);

    const { url, nonce } = await buildMetaConnectUrl(ctx, { returnTo: '/app/integrations' });
    const dialog = new URL(url);
    expect(dialog.hostname).toBe('www.facebook.com');
    expect(dialog.searchParams.get('client_id')).toBe('123456789');
    expect(dialog.searchParams.get('config_id')).toBe('555555555');
    expect(dialog.searchParams.get('redirect_uri')).toBe(metaRedirectUri());
    const state = dialog.searchParams.get('state')!;

    // CSRF: wrong cookie nonce or another user → refused.
    await expect(completeMetaConnect(owner, { code: 'good-code', state, cookieNonce: 'other', fetcher })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(completeMetaConnect(editor, { code: 'good-code', state, cookieNonce: nonce, fetcher })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(completeMetaConnect(owner, { code: 'bad-code', state, cookieNonce: nonce, fetcher })).rejects.toBeInstanceOf(MetaApiError);

    const result = await completeMetaConnect(owner, { code: 'good-code', state, cookieNonce: nonce, fetcher });
    expect(result.brandId).toBe(brandA.id);
    expect(result.returnTo).toBe('/app/integrations');
    expect(result.account.status).toBe('CONNECTED');
    expect(result.account.scopes).toEqual(['ads_read', 'pages_show_list']);
    expect(result.adAccounts).toHaveLength(1);
    expect(result.adAccounts[0]?.isSelected).toBe(true);
    // The token is stored encrypted only.
    expect(result.account.credentialsEnc).not.toContain('LONG-LIVED-TOKEN');
    expect(JSON.stringify(result.account.metadata)).not.toContain('TOKEN');

    const status = await getMetaConnection(ctx);
    expect(status.connected).toBe(true);
    expect(status.userName).toBe('מאור בדיקה');
    expect(status.pages[0]?.instagram?.username).toBe('mvn');
    expect(status.selected.pageId).toBe('page1');

    const sync = await syncMetaAds(ctx, { days: 7, fetcher });
    expect(sync.status).toBe('SUCCEEDED');
    expect(sync.stats).toMatchObject({ campaigns: 2, adSets: 1, ads: 1, insights: 2 });
    expect(calls.filter((c) => c.endsWith('/act_1/campaigns?after'))).toHaveLength(1);

    const overview = await getAdsOverview(ctx, { days: 7 });
    expect(overview.account?.externalId).toBe('act_1');
    expect(overview.totals).toMatchObject({ spend: 12.5, impressions: 1000, clicks: 40, ctr: 4, cpc: 0.31, currency: 'ILS' });
    expect(overview.campaigns.map((c) => [c.name, c.dailyBudget, c.lifetimeBudget, c.spend, c.adSetCount])).toEqual([
      ['קמפיין א', 100, null, 12.5, 1],
      ['קמפיין ב', null, 5000, 0, 0],
    ]);
    expect(overview.daily).toHaveLength(1);

    // Re-sync is idempotent (upserts).
    const again = await syncMetaAds(ctx, { days: 7, fetcher });
    expect(again.stats).toMatchObject({ campaigns: 2 });
    expect(await ctx.db.campaign.count()).toBe(2);
    expect(await ctx.db.adInsight.count()).toBe(2);

    // Isolation: brand B sees no connection, no ads.
    const ctxB = await ctxFor(owner, brandB.id);
    expect((await getMetaConnection(ctxB)).connected).toBe(false);
    expect((await getAdsOverview(ctxB)).campaigns).toEqual([]);
    await expect(syncMetaAds(ctxB, { fetcher })).rejects.toBeInstanceOf(ConflictError);
    await expect(selectMetaAssets(ctxB, { adAccountId: result.adAccounts[0]!.id })).rejects.toBeInstanceOf(NotFoundError);

    // Expired token → connection marked EXPIRED with the error, sync FAILED.
    await db.providerAccount.updateMany({ where: { brandId: brandA.id, provider: 'meta' }, data: { credentialsEnc: (await import('../src/crypto')).encryptJson({ accessToken: 'STALE', tokenType: null, expiresAt: null, pages: [] }) } });
    await expect(syncMetaAds(ctx, { fetcher })).rejects.toBeInstanceOf(MetaApiError);
    expect((await getMetaConnection(ctx)).status).toBe('EXPIRED');
    const syncs = await ctx.db.integrationSync.findMany({ orderBy: { startedAt: 'desc' } });
    expect(syncs[0]?.status).toBe('FAILED');

    await disconnectMeta(ctx);
    expect((await getMetaConnection(ctx)).connected).toBe(false);
  });
});
