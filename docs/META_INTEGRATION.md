# Meta (Facebook / Instagram) integration — design notes

Facts below were verified against Meta's official documentation on **2026-10-16**
(sources at the bottom). Anything not listed here is to be verified before use —
never guessed (PRD §24 rule 18).

## Owner's Meta app

The owner created a **Business-type app** with the products *Facebook Login for
Business* and *Marketing API*. Goal: connect each brand's Facebook Page /
Instagram account / ad account via SSO, first read-only (campaigns, ad sets,
ads, insights), later managed writes (paused drafts, approvals), then publish
the app through App Review.

## Verified API facts

| Topic | Fact | Source |
| --- | --- | --- |
| Current Graph API version | **v26.0** (introduced 2026-07-29). v25.0 available until 2028-07-29, v24.0 until 2028-02-18; Marketing API v24.0 only until **2026-10-06** → use `v25.0` or `v26.0`. We default to `META_API_VERSION=v25.0`. | changelog |
| Login product | Facebook Login for Business: a **configuration** (`config_id`) defined in the App Dashboard sets token type, assets and permissions; it replaces `scope`. | FLB overview |
| Dialog URL | `https://www.facebook.com/v25.0/dialog/oauth?client_id=…&redirect_uri=…&state=…&config_id=…` (`response_type=code` default). `state` is required and must be checked on return (CSRF). | manual flow |
| Code → token | `GET https://graph.facebook.com/v25.0/oauth/access_token?client_id=…&redirect_uri=…&client_secret=…&code=…` → `{ access_token, token_type, expires_in }` (server-side only). | manual flow |
| Token types | **User access token** (short-lived; implicit or code grant) — exchange for a long-lived one (≈60 days) via `grant_type=fb_exchange_token&client_id&client_secret&fb_exchange_token`. **Business integration system user token (SUAT)** — delegated to the assets the client selected, tied to the business portfolio, code grant only, never expires by default (`set_token_expires_in_60_days=true` optional); intended for server-to-server automation. | FLB overview, long-lived tokens |
| Page tokens | `GET /{user-id}/accounts` with a long-lived user token returns each Page with its own `access_token`; long-lived Page tokens do not expire (invalidated on password change, role removal, etc.). | long-lived tokens |
| Token inspection | `GET /debug_token?input_token=…&access_token=<app token>` → `data.{app_id,type,expires_at,is_valid,scopes,user_id}` (server-side). | manual flow |
| Cancel/error | Redirect carries `error_reason=user_denied&error=access_denied&error_description=…`. | manual flow |
| Permissions | Ads: `ads_read`, `ads_management`, `business_management` (token-management endpoint requires `business_management`). Pages: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `pages_manage_ads`, `pages_manage_metadata`. `email`/`public_profile` auto-granted but at least one other permission must be requested; if any requested permission is refused the app receives none. | FLB overview |
| Access tiers | Marketing API **Limited access** (default, "development only"): unlimited ad accounts, heavy rate limits, app admins/developers may call on behalf of ad account admins. **Full access** via App Review "+Upgrade": needs ≥500 Marketing API calls in 15 days and <15% error rate. Platform permissions: **standard access** auto-approved for business apps (own ad accounts only); **advanced access** per permission via App Review (other people's ad accounts). *All calls, on any level, hit production data.* | authorization |
| Go-live | Business-type app required; Advanced Access + Ongoing Review to serve businesses you don't own; `public_profile` must have Advanced Access before the app goes live. SUAT logins are web-only and require the client to have a business portfolio; the app must belong to our own portfolio. | FLB overview |

## Implemented (2026-10-16, read-only)

| Piece | Where |
| --- | --- |
| Org-wide app credentials (App ID, App Secret, optional Login-for-Business `config_id`), encrypted in `provider_accounts` (`provider="meta_app"`, brand NULL) | `packages/core/src/services/meta.ts` → `saveMetaAppCredentials`; Integrations page (org admins) |
| Connect flow: `GET /api/v1/brands/:id/integrations/meta/connect` → HMAC-signed `state` (brand, user, nonce, 10 min) + `mm_meta_state` cookie → `https://www.facebook.com/{version}/dialog/oauth` with `config_id` (or `scope` when no config id) | `buildMetaConnectUrl`, route under `apps/web/src/app/api/v1/brands/[brandId]/integrations/meta/connect` |
| Callback `GET /api/v1/integrations/meta/callback`: verifies state + cookie nonce + same user, exchanges the code server-side, tries the long-lived exchange, `debug_token`, `/me`, `/me/adaccounts`, `/me/accounts` (+ Instagram business account, Page tokens); stores tokens encrypted (`provider="meta"`, per brand), mirrors ad accounts into `ad_accounts` | `completeMetaConnect` |
| Asset selection (ad account, Page/Instagram), disconnect, status | `selectMetaAssets`, `disconnectMeta`, `getMetaConnection`; Integrations page Meta card |
| Read-only sync: campaigns, ad sets, ads (with creative thumbnail), daily insights at account + campaign level for N days (budgets converted from minor units, spend as reported); every row keeps `synced_at`; `integration_syncs` log; auth errors mark the connection EXPIRED | `syncMetaAds`; `POST /api/v1/brands/:id/integrations/meta/sync`; nightly worker job `ads.sync-meta` 05:30 Asia/Jerusalem |
| Dashboard `/app/ads`: totals (spend, impressions, clicks, CTR, CPC), daily spend bars, campaigns table — labelled read-only with the last sync time | `getAdsOverview`; `apps/web/src/app/app/ads` |
| Tests with a fake Graph API: state signing, error mapping, code exchange, asset discovery, pagination, idempotent sync, overview maths, isolation, expired-token handling | `packages/core/tests/meta.test.ts` |

Not yet verified against a real Meta app: the owner has to enter the App ID / Secret (and the Login for Business configuration id) and add the redirect URI in the app settings; then connect a brand in dev mode. Writes to Meta do not exist in the code base yet.

## Planned next (after the live dev-mode test)

1. **Settings (org-wide)**: App ID + App Secret entered in the Integrations page
   (encrypted, like AI keys); `config_id` for the login configuration; the
   redirect URI shown to copy into the app: `https://mm-marketing.mymvn.app/api/v1/integrations/meta/callback`.
2. **Connect flow (per brand)**: `GET /api/v1/brands/:id/integrations/meta/connect`
   → stores a signed `state` (brand, user, nonce, 10 min) → redirects to the
   dialog with `config_id`. Callback verifies `state`, exchanges the code, then
   (user-token configs) exchanges for a long-lived token, calls `/me`,
   `/me/accounts` (Pages + page tokens), `/me/adaccounts` and `/{page}?fields=instagram_business_account`,
   stores everything encrypted in `provider_accounts` (`provider="meta"`, per brand)
   and lets the user pick the Page / Instagram / ad account for the brand.
3. **Read-only sync**: campaigns, ad sets, ads, insights into mirror tables
   (`ad_accounts`, `campaigns`, `ad_sets`, `advertisements`, `integration_syncs`),
   every metric with `source` + `syncedAt`; writes stay disabled
   (`META_ADS_WRITE_ENABLED=false`) until the approval flow is wired.
4. **Dev-mode testing**: the owner (app admin) connects their own business
   assets; Limited access is enough for that. Keep an eye on the 500-call /
   <15% error thresholds for the later upgrade.
5. **Token hygiene**: `debug_token` on connect and nightly; refresh long-lived
   user tokens before day 60; surface `EXPIRED`/`ERROR` on the Integrations page.

## Sources
- https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
- https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow
- https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- https://developers.facebook.com/docs/marketing-api/overview/authorization
- https://developers.facebook.com/docs/graph-api/changelog
