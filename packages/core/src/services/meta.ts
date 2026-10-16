/**
 * Meta (Facebook / Instagram / Ads) integration — read-only first.
 * Org-wide app credentials (App ID / Secret / login config), per-brand SSO
 * connection via Facebook Login for Business (code grant, server-side exchange,
 * long-lived token), asset discovery (ad accounts, Pages, Instagram), and a
 * read-only sync of campaigns / ad sets / ads / daily insights into mirror
 * tables. No write to Meta exists in this module (META_ADS_WRITE_ENABLED is
 * reserved for a later phase behind approvals).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from '@mm/db';
import type { AdAccount, Campaign, IntegrationSync, Prisma, ProviderAccount } from '@mm/db';
import { auditFromContext, recordAudit } from '../audit';
import { getConfig } from '../config';
import { decryptJson, encryptJson } from '../crypto';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors';
import { logger } from '../logger';
import { GraphClient, MetaApiError, minorToMajor, toNumber } from '../meta/graph';
import type { GraphFetcher } from '../meta/graph';
import type { Actor, BrandContext } from '../tenancy/context';
import { assertBrandRole, requireOrgAdmin, resolveBrandContext } from '../tenancy/context';
import type { MetaAppCredentialsInput, MetaSelectInput } from '../validation';

export const META_PROVIDER = 'meta';
export const META_APP_PROVIDER = 'meta_app';
export const META_STATE_COOKIE = 'mm_meta_state';
export const META_STATE_TTL_SEC = 600;
/** Requested only when no Facebook Login for Business configuration id is set. */
export const META_SCOPES = ['ads_read', 'ads_management', 'business_management', 'pages_show_list', 'pages_read_engagement'];

// ---------------------------------------------------------------------------
// App credentials (org-wide)
// ---------------------------------------------------------------------------

export interface MetaAppCredentials {
  appId: string;
  appSecret: string;
  configId: string | null;
}

export function metaRedirectUri(): string {
  return `${getConfig().APP_URL.replace(/\/$/, '')}/api/v1/integrations/meta/callback`;
}

export async function getMetaAppCredentials(orgId: string): Promise<MetaAppCredentials | null> {
  const row = await db.providerAccount.findFirst({ where: { orgId, brandId: null, provider: META_APP_PROVIDER } });
  if (!row?.credentialsEnc) return null;
  const c = decryptJson<MetaAppCredentials>(row.credentialsEnc);
  return { appId: c.appId, appSecret: c.appSecret, configId: c.configId ?? null };
}

export interface MetaAppStatus {
  configured: boolean;
  appId: string | null;
  configId: string | null;
  redirectUri: string;
  updatedAt: Date | null;
}

export async function getMetaAppStatus(orgId: string): Promise<MetaAppStatus> {
  const row = await db.providerAccount.findFirst({ where: { orgId, brandId: null, provider: META_APP_PROVIDER } });
  const meta = (row?.metadata ?? {}) as { appId?: string; configId?: string | null };
  return { configured: Boolean(row?.credentialsEnc), appId: meta.appId ?? null, configId: meta.configId ?? null, redirectUri: metaRedirectUri(), updatedAt: row?.updatedAt ?? null };
}

export async function saveMetaAppCredentials(actor: Actor, orgId: string, input: MetaAppCredentialsInput): Promise<MetaAppStatus> {
  await requireOrgAdmin(actor, orgId);
  const existing = await db.providerAccount.findFirst({ where: { orgId, brandId: null, provider: META_APP_PROVIDER } });
  const current = existing?.credentialsEnc ? decryptJson<MetaAppCredentials>(existing.credentialsEnc) : null;
  // An empty secret keeps the stored one (the form never echoes secrets).
  const appSecret = input.appSecret || current?.appSecret;
  if (!appSecret) throw new ValidationError('חסר App Secret', [{ path: 'appSecret', message: 'חובה' }]);
  const data = {
    orgId,
    brandId: null,
    provider: META_APP_PROVIDER,
    kind: 'META' as const,
    label: 'Meta App',
    status: 'CONNECTED' as const,
    credentialsEnc: encryptJson({ appId: input.appId, appSecret, configId: input.configId ?? null }),
    metadata: { appId: input.appId, configId: input.configId ?? null, secretHint: `…${appSecret.slice(-4)}` } as Prisma.InputJsonObject,
    lastError: null,
  };
  if (existing) await db.providerAccount.update({ where: { id: existing.id }, data });
  else await db.providerAccount.create({ data });
  await recordAudit({ orgId, actorUserId: actor.userId || null }, { action: 'meta.app.save', entityType: 'provider_account', after: { appId: input.appId, configId: input.configId ?? null } });
  return getMetaAppStatus(orgId);
}

export async function removeMetaAppCredentials(actor: Actor, orgId: string): Promise<void> {
  await requireOrgAdmin(actor, orgId);
  await db.providerAccount.deleteMany({ where: { orgId, brandId: null, provider: META_APP_PROVIDER } });
  await recordAudit({ orgId, actorUserId: actor.userId || null }, { action: 'meta.app.remove', entityType: 'provider_account' });
}

// ---------------------------------------------------------------------------
// Signed OAuth state (CSRF): brand + user + nonce, 10 minutes
// ---------------------------------------------------------------------------

interface StatePayload {
  b: string;
  u: string;
  n: string;
  e: number;
  r?: string;
}

function sign(data: string): string {
  return createHmac('sha256', `${getConfig().APP_SECRET}:meta-oauth`).update(data).digest('base64url');
}

export function createMetaState(brandId: string, userId: string, returnTo?: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString('base64url');
  const payload: StatePayload = { b: brandId, u: userId, n: nonce, e: Math.floor(Date.now() / 1000) + META_STATE_TTL_SEC, ...(returnTo ? { r: returnTo } : {}) };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { state: `${data}.${sign(data)}`, nonce };
}

export function verifyMetaState(token: string | null | undefined): { brandId: string; userId: string; nonce: string; returnTo: string | null } | null {
  if (!token) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = Buffer.from(sign(data));
  const provided = Buffer.from(sig);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  try {
    const p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as StatePayload;
    if (typeof p.b !== 'string' || typeof p.u !== 'string' || typeof p.n !== 'string' || typeof p.e !== 'number') return null;
    if (p.e <= Math.floor(Date.now() / 1000)) return null;
    const returnTo = typeof p.r === 'string' && p.r.startsWith('/app') ? p.r : null;
    return { brandId: p.b, userId: p.u, nonce: p.n, returnTo };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Connect flow
// ---------------------------------------------------------------------------

export async function buildMetaConnectUrl(ctx: BrandContext, opts: { returnTo?: string } = {}): Promise<{ url: string; nonce: string }> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const creds = await getMetaAppCredentials(ctx.orgId);
  if (!creds) throw new ConflictError('יש להזין קודם App ID ו-App Secret של אפליקציית Meta בעמוד האינטגרציות');
  const { state, nonce } = createMetaState(ctx.brandId, ctx.actor.userId, opts.returnTo);
  const url = new URL(`https://www.facebook.com/${getConfig().META_API_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', creds.appId);
  url.searchParams.set('redirect_uri', metaRedirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (creds.configId) url.searchParams.set('config_id', creds.configId);
  else url.searchParams.set('scope', META_SCOPES.join(','));
  await auditFromContext(ctx, { action: 'meta.connect.start', entityType: 'provider_account', metadata: { configId: creds.configId ?? null } });
  return { url: url.toString(), nonce };
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface DebugToken {
  data?: { app_id?: string; type?: string; expires_at?: number; is_valid?: boolean; scopes?: string[]; user_id?: string; granular_scopes?: unknown };
}

interface AdAccountNode {
  id: string;
  account_id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

interface PageNode {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
}

export interface MetaStoredCredentials {
  accessToken: string;
  tokenType: string | null;
  expiresAt: string | null;
  pages: { id: string; name: string; accessToken: string | null; instagram: { id: string; username: string | null } | null }[];
}

export interface MetaConnectionMeta {
  userName: string | null;
  userId: string | null;
  tokenType: string | null;
  pages: { id: string; name: string; instagram: { id: string; username: string | null } | null }[];
  selected: { adAccountId?: string | null; pageId?: string | null; instagramId?: string | null };
}

export interface CompleteConnectInput {
  code: string;
  state: string;
  cookieNonce: string | null | undefined;
  fetcher?: GraphFetcher;
}

/** Callback handler: verifies state, exchanges the code, discovers assets, stores everything encrypted. */
export async function completeMetaConnect(actor: Actor, input: CompleteConnectInput): Promise<{ brandId: string; returnTo: string | null; account: ProviderAccount; adAccounts: AdAccount[] }> {
  const state = verifyMetaState(input.state);
  if (!state) throw new ValidationError('קישור ההתחברות פג תוקף או אינו תקין — נסו שוב');
  if (!input.cookieNonce || input.cookieNonce !== state.nonce) throw new ForbiddenError('אימות ההתחברות נכשל (state) — נסו שוב מאותו דפדפן');
  if (state.userId !== actor.userId) throw new ForbiddenError('ההתחברות החלה ממשתמש אחר');
  const ctx = await resolveBrandContext(actor, state.brandId);
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const creds = await getMetaAppCredentials(ctx.orgId);
  if (!creds) throw new ConflictError('פרטי אפליקציית Meta הוסרו בזמן ההתחברות');
  const client = new GraphClient(input.fetcher);
  const redirectUri = metaRedirectUri();

  const short = await client.get<TokenResponse>('oauth/access_token', { client_id: creds.appId, redirect_uri: redirectUri, client_secret: creds.appSecret, code: input.code }, null);
  let accessToken = short.access_token;
  let expiresAt: Date | null = short.expires_in ? new Date(Date.now() + short.expires_in * 1000) : null;
  // User tokens are short-lived: exchange for a ~60-day token. Business system-user tokens do not need it (the call fails harmlessly).
  try {
    const long = await client.get<TokenResponse>('oauth/access_token', { grant_type: 'fb_exchange_token', client_id: creds.appId, client_secret: creds.appSecret, fb_exchange_token: accessToken }, null);
    if (long.access_token) {
      accessToken = long.access_token;
      expiresAt = long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null;
    }
  } catch (err) {
    logger.info({ err: err instanceof Error ? err.message : err }, 'meta: long-lived exchange not applicable');
  }
  let debug: DebugToken['data'] | undefined;
  try {
    debug = (await client.get<DebugToken>('debug_token', { input_token: accessToken }, `${creds.appId}|${creds.appSecret}`)).data;
    if (debug?.expires_at && debug.expires_at > 0) expiresAt = new Date(debug.expires_at * 1000);
    if (debug?.is_valid === false) throw new MetaApiError('Meta החזירה טוקן לא תקף', { status: 401 });
  } catch (err) {
    if (err instanceof MetaApiError && err.status === 401) throw err;
    logger.warn({ err: err instanceof Error ? err.message : err }, 'meta: debug_token failed');
  }
  const me = await client.get<{ id: string; name?: string }>('me', { fields: 'id,name' }, accessToken);
  const [adAccounts, pages] = await Promise.all([
    client.getAll<AdAccountNode>('me/adaccounts', { fields: 'id,account_id,name,currency,timezone_name,account_status' }, accessToken, 200).catch((err: unknown) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'meta: adaccounts unavailable');
      return [] as AdAccountNode[];
    }),
    client.getAll<PageNode>('me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}' }, accessToken, 200).catch((err: unknown) => {
      logger.warn({ err: err instanceof Error ? err.message : err }, 'meta: pages unavailable');
      return [] as PageNode[];
    }),
  ]);

  const existing = await db.providerAccount.findFirst({ where: { orgId: ctx.orgId, brandId: ctx.brandId, provider: META_PROVIDER } });
  const prevMeta = (existing?.metadata ?? {}) as Partial<MetaConnectionMeta>;
  const stored: MetaStoredCredentials = {
    accessToken,
    tokenType: debug?.type ?? short.token_type ?? null,
    expiresAt: expiresAt?.toISOString() ?? null,
    pages: pages.map((p) => ({ id: p.id, name: p.name ?? p.id, accessToken: p.access_token ?? null, instagram: p.instagram_business_account ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null } : null })),
  };
  const metadata: MetaConnectionMeta = {
    userName: me.name ?? null,
    userId: me.id,
    tokenType: stored.tokenType,
    pages: stored.pages.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram })),
    selected: { ...(prevMeta.selected ?? {}) },
  };
  const data = {
    orgId: ctx.orgId,
    brandId: ctx.brandId,
    provider: META_PROVIDER,
    kind: 'META' as const,
    label: `Meta — ${me.name ?? me.id}`,
    status: 'CONNECTED' as const,
    externalAccountId: me.id,
    scopes: debug?.scopes ?? [],
    credentialsEnc: encryptJson(stored),
    metadata: metadata as unknown as Prisma.InputJsonObject,
    expiresAt,
    lastError: null,
  };
  const account = existing ? await db.providerAccount.update({ where: { id: existing.id }, data }) : await db.providerAccount.create({ data });

  const rows: AdAccount[] = [];
  for (const a of adAccounts) {
    rows.push(
      await ctx.db.adAccount.upsert({
        where: { brandId_provider_externalId: { brandId: ctx.brandId, provider: META_PROVIDER, externalId: a.id } },
        create: { brandId: ctx.brandId, provider: META_PROVIDER, externalId: a.id, name: a.name ?? a.id, currency: a.currency ?? null, timezone: a.timezone_name ?? null, accountStatus: a.account_status ?? null, providerAccountId: account.id },
        update: { name: a.name ?? a.id, currency: a.currency ?? null, timezone: a.timezone_name ?? null, accountStatus: a.account_status ?? null, providerAccountId: account.id },
      }),
    );
  }
  // Exactly one ad account → select it so the dashboard works immediately.
  if (rows.length === 1 && !rows.some((r) => r.isSelected)) {
    await ctx.db.adAccount.update({ where: { id: rows[0]!.id }, data: { isSelected: true } });
    rows[0] = { ...rows[0]!, isSelected: true };
  }
  if (!metadata.selected.pageId && stored.pages.length === 1) {
    metadata.selected.pageId = stored.pages[0]!.id;
    metadata.selected.instagramId = stored.pages[0]!.instagram?.id ?? null;
    await db.providerAccount.update({ where: { id: account.id }, data: { metadata: metadata as unknown as Prisma.InputJsonObject } });
  }
  await auditFromContext(ctx, { action: 'meta.connect.complete', entityType: 'provider_account', entityId: account.id, after: { user: me.id, adAccounts: rows.length, pages: stored.pages.length, scopes: debug?.scopes ?? [] } });
  return { brandId: ctx.brandId, returnTo: state.returnTo, account, adAccounts: rows };
}

// ---------------------------------------------------------------------------
// Status / selection / disconnect
// ---------------------------------------------------------------------------

export interface MetaConnectionStatus {
  appConfigured: boolean;
  connected: boolean;
  status: ProviderAccount['status'] | 'DISCONNECTED';
  userName: string | null;
  tokenType: string | null;
  scopes: string[];
  expiresAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  adAccounts: AdAccount[];
  pages: MetaConnectionMeta['pages'];
  selected: MetaConnectionMeta['selected'];
}

async function connectionRow(ctx: BrandContext): Promise<ProviderAccount | null> {
  return db.providerAccount.findFirst({ where: { orgId: ctx.orgId, brandId: ctx.brandId, provider: META_PROVIDER } });
}

export async function getMetaConnection(ctx: BrandContext): Promise<MetaConnectionStatus> {
  const [app, row, adAccounts] = await Promise.all([getMetaAppStatus(ctx.orgId), connectionRow(ctx), ctx.db.adAccount.findMany({ where: { provider: META_PROVIDER }, orderBy: { name: 'asc' } })]);
  const meta = (row?.metadata ?? {}) as Partial<MetaConnectionMeta>;
  return {
    appConfigured: app.configured,
    connected: Boolean(row && row.status !== 'DISCONNECTED'),
    status: row?.status ?? 'DISCONNECTED',
    userName: meta.userName ?? null,
    tokenType: meta.tokenType ?? null,
    scopes: row?.scopes ?? [],
    expiresAt: row?.expiresAt ?? null,
    lastSyncAt: row?.lastSyncAt ?? null,
    lastError: row?.lastError ?? null,
    adAccounts,
    pages: meta.pages ?? [],
    selected: meta.selected ?? {},
  };
}

export async function selectMetaAssets(ctx: BrandContext, input: MetaSelectInput): Promise<void> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const row = await connectionRow(ctx);
  if (!row) throw new NotFoundError('meta connection');
  const meta = (row.metadata ?? {}) as unknown as MetaConnectionMeta;
  if (input.adAccountId) {
    const target = await ctx.db.adAccount.findUnique({ where: { id: input.adAccountId } });
    if (!target || target.provider !== META_PROVIDER) throw new NotFoundError('ad account');
    await ctx.db.adAccount.updateMany({ where: { provider: META_PROVIDER }, data: { isSelected: false } });
    await ctx.db.adAccount.update({ where: { id: target.id }, data: { isSelected: true } });
    meta.selected = { ...(meta.selected ?? {}), adAccountId: target.externalId };
  }
  if (input.pageId !== undefined) {
    const page = (meta.pages ?? []).find((p) => p.id === input.pageId);
    if (input.pageId && !page) throw new NotFoundError('page');
    meta.selected = { ...(meta.selected ?? {}), pageId: input.pageId || null, instagramId: page?.instagram?.id ?? null };
  }
  await db.providerAccount.update({ where: { id: row.id }, data: { metadata: meta as unknown as Prisma.InputJsonObject } });
  await auditFromContext(ctx, { action: 'meta.select', entityType: 'provider_account', entityId: row.id, after: meta.selected });
}

export async function disconnectMeta(ctx: BrandContext): Promise<void> {
  assertBrandRole(ctx, 'BRAND_ADMIN');
  const row = await connectionRow(ctx);
  if (!row) return;
  await db.providerAccount.delete({ where: { id: row.id } });
  await auditFromContext(ctx, { action: 'meta.disconnect', entityType: 'provider_account', entityId: row.id });
}

// ---------------------------------------------------------------------------
// Read-only sync
// ---------------------------------------------------------------------------

interface CampaignNode {
  id: string;
  name?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
}
interface AdSetNode {
  id: string;
  name?: string;
  campaign_id?: string;
  status?: string;
  effective_status?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  optimization_goal?: string;
  billing_event?: string;
  start_time?: string;
  end_time?: string;
}
interface AdNode {
  id: string;
  name?: string;
  adset_id?: string;
  status?: string;
  effective_status?: string;
  creative?: { id?: string; thumbnail_url?: string };
}
interface InsightNode {
  date_start: string;
  date_stop: string;
  campaign_id?: string;
  campaign_name?: string;
  account_currency?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  actions?: { action_type: string; value: string }[];
}

const toDate = (s: string | undefined): Date | null => (s ? new Date(s) : null);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface SyncResult extends IntegrationSync {
  stats: Prisma.JsonValue;
}

export async function syncMetaAds(ctx: BrandContext, opts: { days?: number; fetcher?: GraphFetcher } = {}): Promise<IntegrationSync> {
  assertBrandRole(ctx, 'EDITOR');
  const row = await connectionRow(ctx);
  if (!row?.credentialsEnc) throw new ConflictError('המותג אינו מחובר ל-Meta');
  const account = await ctx.db.adAccount.findFirst({ where: { provider: META_PROVIDER, isSelected: true } });
  if (!account) throw new ConflictError('בחרו חשבון מודעות לסנכרון');
  const sync = await ctx.db.integrationSync.create({ data: { brandId: ctx.brandId, provider: META_PROVIDER, kind: 'ads_readonly', startedById: ctx.actor.userId || null } });
  const creds = decryptJson<MetaStoredCredentials>(row.credentialsEnc);
  const client = new GraphClient(opts.fetcher);
  const token = creds.accessToken;
  const act = account.externalId;
  const days = Math.min(Math.max(opts.days ?? 30, 1), 90);
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86_400_000);
  const timeRange = JSON.stringify({ since: isoDay(since), until: isoDay(until) });
  const stats = { campaigns: 0, adSets: 0, ads: 0, insights: 0 };
  try {
    const campaigns = await client.getAll<CampaignNode>(`${act}/campaigns`, { fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,start_time,stop_time' }, token);
    const campaignIds = new Map<string, string>();
    for (const c of campaigns) {
      const saved = await ctx.db.campaign.upsert({
        where: { adAccountId_externalId: { adAccountId: account.id, externalId: c.id } },
        create: { brandId: ctx.brandId, adAccountId: account.id, externalId: c.id, name: c.name ?? c.id, objective: c.objective ?? null, status: c.status ?? null, effectiveStatus: c.effective_status ?? null, dailyBudget: minorToMajor(c.daily_budget), lifetimeBudget: minorToMajor(c.lifetime_budget), startTime: toDate(c.start_time), stopTime: toDate(c.stop_time), raw: c as unknown as Prisma.InputJsonObject, syncedAt: new Date() },
        update: { name: c.name ?? c.id, objective: c.objective ?? null, status: c.status ?? null, effectiveStatus: c.effective_status ?? null, dailyBudget: minorToMajor(c.daily_budget), lifetimeBudget: minorToMajor(c.lifetime_budget), startTime: toDate(c.start_time), stopTime: toDate(c.stop_time), raw: c as unknown as Prisma.InputJsonObject, syncedAt: new Date() },
      });
      campaignIds.set(c.id, saved.id);
      stats.campaigns += 1;
    }
    const adSets = await client.getAll<AdSetNode>(`${act}/adsets`, { fields: 'id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,start_time,end_time' }, token);
    const adSetIds = new Map<string, string>();
    for (const s of adSets) {
      const campaignId = s.campaign_id ? campaignIds.get(s.campaign_id) : undefined;
      if (!campaignId) continue;
      const saved = await ctx.db.adSet.upsert({
        where: { campaignId_externalId: { campaignId, externalId: s.id } },
        create: { brandId: ctx.brandId, campaignId, externalId: s.id, name: s.name ?? s.id, status: s.status ?? null, effectiveStatus: s.effective_status ?? null, dailyBudget: minorToMajor(s.daily_budget), lifetimeBudget: minorToMajor(s.lifetime_budget), optimizationGoal: s.optimization_goal ?? null, billingEvent: s.billing_event ?? null, startTime: toDate(s.start_time), endTime: toDate(s.end_time), raw: s as unknown as Prisma.InputJsonObject, syncedAt: new Date() },
        update: { name: s.name ?? s.id, status: s.status ?? null, effectiveStatus: s.effective_status ?? null, dailyBudget: minorToMajor(s.daily_budget), lifetimeBudget: minorToMajor(s.lifetime_budget), optimizationGoal: s.optimization_goal ?? null, billingEvent: s.billing_event ?? null, startTime: toDate(s.start_time), endTime: toDate(s.end_time), raw: s as unknown as Prisma.InputJsonObject, syncedAt: new Date() },
      });
      adSetIds.set(s.id, saved.id);
      stats.adSets += 1;
    }
    const ads = await client.getAll<AdNode>(`${act}/ads`, { fields: 'id,name,adset_id,status,effective_status,creative{id,thumbnail_url}' }, token);
    for (const a of ads) {
      const adSetId = a.adset_id ? adSetIds.get(a.adset_id) : undefined;
      if (!adSetId) continue;
      await ctx.db.advertisement.upsert({
        where: { adSetId_externalId: { adSetId, externalId: a.id } },
        create: { brandId: ctx.brandId, adSetId, externalId: a.id, name: a.name ?? a.id, status: a.status ?? null, effectiveStatus: a.effective_status ?? null, creativeId: a.creative?.id ?? null, thumbnailUrl: a.creative?.thumbnail_url ?? null, raw: a as unknown as Prisma.InputJsonObject, syncedAt: new Date() },
        update: { name: a.name ?? a.id, status: a.status ?? null, effectiveStatus: a.effective_status ?? null, creativeId: a.creative?.id ?? null, thumbnailUrl: a.creative?.thumbnail_url ?? null, raw: a as unknown as Prisma.InputJsonObject, syncedAt: new Date() },
      });
      stats.ads += 1;
    }
    const insightFields = 'spend,impressions,clicks,reach,cpc,cpm,ctr,actions,date_start,date_stop,account_currency';
    const accountRows = await client.getAll<InsightNode>(`${act}/insights`, { level: 'account', time_increment: 1, time_range: timeRange, fields: insightFields }, token, 400);
    const campaignRows = await client.getAll<InsightNode>(`${act}/insights`, { level: 'campaign', time_increment: 1, time_range: timeRange, fields: `campaign_id,campaign_name,${insightFields}` }, token, 5000);
    const upsertInsight = async (level: 'account' | 'campaign', objectExternalId: string, objectName: string | null, r: InsightNode) => {
      const date = new Date(`${r.date_start}T00:00:00.000Z`);
      const data = {
        objectName,
        spend: toNumber(r.spend) ?? 0,
        currency: r.account_currency ?? account.currency ?? null,
        impressions: Math.round(toNumber(r.impressions) ?? 0),
        clicks: Math.round(toNumber(r.clicks) ?? 0),
        reach: Math.round(toNumber(r.reach) ?? 0),
        cpc: toNumber(r.cpc),
        cpm: toNumber(r.cpm),
        ctr: toNumber(r.ctr),
        actions: (r.actions ?? []) as unknown as Prisma.InputJsonArray,
        syncedAt: new Date(),
      };
      await ctx.db.adInsight.upsert({
        where: { brandId_provider_level_objectExternalId_date: { brandId: ctx.brandId, provider: META_PROVIDER, level, objectExternalId, date } },
        create: { brandId: ctx.brandId, provider: META_PROVIDER, level, objectExternalId, date, ...data },
        update: data,
      });
      stats.insights += 1;
    };
    for (const r of accountRows) await upsertInsight('account', act, account.name, r);
    for (const r of campaignRows) if (r.campaign_id) await upsertInsight('campaign', r.campaign_id, r.campaign_name ?? null, r);

    const finished = await ctx.db.integrationSync.update({ where: { id: sync.id }, data: { status: 'SUCCEEDED', finishedAt: new Date(), stats } });
    await ctx.db.adAccount.update({ where: { id: account.id }, data: { syncedAt: new Date() } });
    await db.providerAccount.update({ where: { id: row.id }, data: { lastSyncAt: new Date(), lastError: null, status: 'CONNECTED' } });
    await auditFromContext(ctx, { action: 'meta.sync', entityType: 'integration_sync', entityId: sync.id, after: stats });
    return finished;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.db.integrationSync.update({ where: { id: sync.id }, data: { status: 'FAILED', finishedAt: new Date(), stats, error: message.slice(0, 1000) } }).catch(() => undefined);
    const auth = err instanceof MetaApiError && err.isAuthError;
    await db.providerAccount.update({ where: { id: row.id }, data: { lastError: message.slice(0, 500), status: auth ? 'EXPIRED' : 'ERROR' } }).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Read model for the dashboard
// ---------------------------------------------------------------------------

export interface CampaignRow extends Omit<Campaign, 'dailyBudget' | 'lifetimeBudget'> {
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  cpc: number | null;
  adSetCount: number;
}

export interface AdsOverview {
  account: AdAccount | null;
  days: number;
  totals: { spend: number; impressions: number; clicks: number; reach: number; ctr: number | null; cpc: number | null; currency: string | null };
  daily: { date: string; spend: number; impressions: number; clicks: number }[];
  campaigns: CampaignRow[];
  lastSync: IntegrationSync | null;
}

export async function getAdsOverview(ctx: BrandContext, opts: { days?: number } = {}): Promise<AdsOverview> {
  const days = Math.min(Math.max(opts.days ?? 30, 1), 90);
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  const account = await ctx.db.adAccount.findFirst({ where: { provider: META_PROVIDER, isSelected: true } });
  const lastSync = await ctx.db.integrationSync.findFirst({ where: { provider: META_PROVIDER }, orderBy: { startedAt: 'desc' } });
  if (!account) return { account: null, days, totals: { spend: 0, impressions: 0, clicks: 0, reach: 0, ctr: null, cpc: null, currency: null }, daily: [], campaigns: [], lastSync };
  const [accountRows, campaignRows, campaigns, adSetCounts] = await Promise.all([
    ctx.db.adInsight.findMany({ where: { provider: META_PROVIDER, level: 'account', objectExternalId: account.externalId, date: { gte: since } }, orderBy: { date: 'asc' } }),
    ctx.db.adInsight.findMany({ where: { provider: META_PROVIDER, level: 'campaign', date: { gte: since } } }),
    ctx.db.campaign.findMany({ where: { adAccountId: account.id }, orderBy: [{ effectiveStatus: 'asc' }, { name: 'asc' }] }),
    ctx.db.adSet.groupBy({ by: ['campaignId'], _count: { _all: true } }),
  ]);
  const byCampaign = new Map<string, { spend: number; impressions: number; clicks: number }>();
  for (const r of campaignRows) {
    const cur = byCampaign.get(r.objectExternalId) ?? { spend: 0, impressions: 0, clicks: 0 };
    cur.spend += Number(r.spend);
    cur.impressions += r.impressions;
    cur.clicks += r.clicks;
    byCampaign.set(r.objectExternalId, cur);
  }
  const counts = new Map(adSetCounts.map((c) => [c.campaignId, c._count._all]));
  const totals = accountRows.reduce(
    (t, r) => ({ ...t, spend: t.spend + Number(r.spend), impressions: t.impressions + r.impressions, clicks: t.clicks + r.clicks, reach: t.reach + r.reach, currency: r.currency ?? t.currency }),
    { spend: 0, impressions: 0, clicks: 0, reach: 0, currency: account.currency },
  );
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    account,
    days,
    totals: { ...totals, spend: round(totals.spend), ctr: totals.impressions ? round((totals.clicks / totals.impressions) * 100) : null, cpc: totals.clicks ? round(totals.spend / totals.clicks) : null },
    daily: accountRows.map((r) => ({ date: isoDay(r.date), spend: round(Number(r.spend)), impressions: r.impressions, clicks: r.clicks })),
    campaigns: campaigns.map((c) => {
      const m = byCampaign.get(c.externalId) ?? { spend: 0, impressions: 0, clicks: 0 };
      return { ...c, dailyBudget: c.dailyBudget === null ? null : Number(c.dailyBudget), lifetimeBudget: c.lifetimeBudget === null ? null : Number(c.lifetimeBudget), spend: round(m.spend), impressions: m.impressions, clicks: m.clicks, ctr: m.impressions ? round((m.clicks / m.impressions) * 100) : null, cpc: m.clicks ? round(m.spend / m.clicks) : null, adSetCount: counts.get(c.id) ?? 0 };
    }),
    lastSync,
  };
}

export async function listMetaSyncs(ctx: BrandContext, limit = 10): Promise<IntegrationSync[]> {
  return ctx.db.integrationSync.findMany({ where: { provider: META_PROVIDER }, orderBy: { startedAt: 'desc' }, take: limit });
}

/** Brands with a live Meta connection and a selected ad account (for the nightly sync). */
export async function listMetaConnectedBrandIds(): Promise<{ brandId: string; orgId: string }[]> {
  const rows = await db.providerAccount.findMany({ where: { provider: META_PROVIDER, status: { in: ['CONNECTED', 'ERROR'] }, brandId: { not: null } }, select: { brandId: true, orgId: true } });
  return rows.flatMap((r) => (r.brandId ? [{ brandId: r.brandId, orgId: r.orgId }] : []));
}
