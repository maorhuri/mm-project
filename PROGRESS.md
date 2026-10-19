# Progress

Living status of what is **built and verified**, what is **built but not yet
verified**, and what is **pending**. Nothing is marked verified unless it was
exercised on the real server (https://mm-marketing.mymvn.app) or by automated
tests run there.

_Last updated: 2026-10-19 — **Phase 4 (calendar + publishing) built**; Video Studio upgraded to real AI motion (Veo 3.1), talking characters (Kling AI Avatar via fal.ai), one-click production, music and transitions._

## Phase 1 — Foundation: LIVE

First production deploy went live at 23:20 (Asia/Jerusalem) after the gated
auto-deploy passed: `npm ci` → `prisma migrate deploy` → typecheck → lint →
build (web + worker) → **25/25 tests** → atomic switch → health check.

A smoke test run on the server against the live app (REST API, same service
layer as the UI) passed **21/21** checks and the test brand was removed afterwards.

### Acceptance criteria (PRD §23 — Foundation)
- [x] Login works on production (`POST /api/v1/auth/login` → token; wrong password → 401; logout revokes)
- [x] Create a brand on production (`POST /api/v1/brands` → 201)
- [x] Switch brand (cookie-based selector in the shell; API routes are brand-scoped per request)
- [x] No data leakage between brands — automated isolation suite (7 tests) green on the server; live probe: cross-brand product update → 404, cross-brand media → 404, foreign rows never listed
- [x] Infra runs via Docker (postgres/redis/S3 gateway); app via systemd. Containerized app images exist but are **untested**
- [x] Migrations pass (`prisma migrate deploy` on every deploy; initial migration `20261015200351_init`)

### Infrastructure & delivery
| Item | Status |
| --- | --- |
| Ubuntu 26.04 server (Docker 29, Compose 2.40, Node 22, 4 GB swap, ufw 22/80/443, tz Asia/Jerusalem) | ✅ verified |
| Nginx reverse proxy + Let's Encrypt (auto-renew dry-run OK), Cloudflare-proxied domain → 200 | ✅ verified |
| Postgres / Redis / Versity S3 Gateway v1.9.0 via `docker-compose.infra.yml` (127.0.0.1 only; MinIO images are no longer public) | ✅ verified (upload round-trip, bytes identical) |
| Release-based deploy with gates and atomic switch (`scripts/deploy.sh`) | ✅ verified (3 failed attempts left the previous state untouched; 4th went live) |
| Auto-deploy timer polling GitHub `main` every minute | ✅ verified |
| GitHub Actions CI (typecheck/lint/test/build with service containers) | 🟡 runs on every push; last run on the previous commit failed on the test later fixed — confirm green on `a743f3c`+ |
| Production `.env` with generated secrets (`/opt/mm-marketing/shared/.env`) | ✅ |

### Application
| Item | Status |
| --- | --- |
| Monorepo (npm workspaces): `apps/web`, `apps/worker`, `packages/db`, `packages/core` | ✅ |
| Prisma schema (18 tables) + initial migration | ✅ verified |
| Tenant-scoped Prisma client (`forBrand`) | ✅ verified (unit + integration + live probe) |
| Authentication: argon2id, server sessions, login/logout, change password, session revocation | ✅ verified (API); UI forms built, not yet clicked through |
| **Two-factor authentication (Google Authenticator / TOTP)**: QR enrolment with manual key, 8 one-time recovery codes, two-step login (UI `/login/mfa` + API `/auth/mfa`), replay protection, disable with password+code, regenerate codes, optional `MFA_REQUIRED_FOR_ADMINS` gate; login/MFA rate limiting on Redis | ✅ verified live 2026-10-15 23:50 (deploy `890a4b4`): 11/11 end-to-end checks — mfa_required on login, TOTP accepted once and replay rejected, recovery code consumed once, 6th attempt → 429, `/login/mfa` guard. RFC 6238 vectors in tests (40/40) |
| Logout from the user menu | ✅ fixed in `890a4b4` (Radix closed the menu before the nested form submitted; now invoked from `onSelect`) |
| Organizations, memberships, brand access, RBAC gate | ✅ verified (role=BRAND_ADMIN for owner; editor/viewer paths covered by tests) |
| Brand CRUD, brand switching (cookie), demo labelling | ✅ create verified live; switch UI built |
| Brand Kit: identity, logos, colors/fonts/style, audiences/tone/claims/keywords, content targets, budget, products, knowledge (with approval), competitors | 🟡 built; products + knowledge verified live via API; forms need a manual click-through |
| Brand Kit → **ייבוא מהאתר**: analyse the brand website (CSS variables, theme-color, @font-face, Google Fonts, logo candidates, meta description) → suggestions → apply on confirmation. SSRF-guarded fetcher, offline parser tests | ✅ live since `b5df2bb`; analysis verified on mvn.co.il from the server (primary `#007bff`, brand magenta `#d946a0`, Noto Sans Hebrew, `/img/logo.png` ranked first). "Apply" path covered by tests; adversarial review pending |
| Media Library: upload (multipart), list/search/filter, edit metadata, delete, access-controlled streaming, S3 storage | ✅ upload/download/auth/isolation verified live; UI grid built |
| Approval Center: list/filter, approve/reject/changes with notes, handler registry, knowledge side effect | ✅ verified live (PENDING → APPROVED → knowledge APPROVED) |
| Notifications (in-app), audit log, dashboard overview with live counts | 🟡 built; notification creation covered by tests |
| Integrations status page (catalog, all DISCONNECTED) | 🟡 built |
| Worker: BullMQ queues, heartbeat (15 min) + daily cleanup schedulers, job records | 🟡 service active; first heartbeat record expected within 15 min of start |
| REST API `/api/v1` (auth, brands, settings, products, knowledge, media, approvals) + `/api/health` | ✅ verified live |
| Hebrew RTL dashboard, dark/light, mobile sidebar | 🟡 renders (HTML `lang="he" dir="rtl"` confirmed); visual QA pending |
| Seed: super-admin, MVN org, MVN brand (7 products, targets, 3,000 ₪ budget), CONTINUO demo brand (paused) | ✅ verified |
| Docs: README, ARCHITECTURE, REQUIREMENTS, DATABASE_SCHEMA, ROADMAP, SECURITY, DEPLOYMENT, API_INTEGRATIONS, TESTING | ✅ |
| Tests: tenant scope (6), tenant isolation (7), auth/sessions/crypto (6), approvals/media/brand kit (6) | ✅ 25/25 on the server |

### Adversarial reviews (2026-10-16)
| Review | Result |
| --- | --- |
| Phase 1 codebase (53 agents, 5 lenses, 2 verifiers per finding) | 17 confirmed → all fixed: stale-cookie `/app`↔`/login` redirect loop, deploy rollback on failed health check, Json `null` writes, audit gaps, enum-validated approval filter, lenient page query parsing, `Object.prototype` key crash, worker log label, http(s)-only URLs, health-endpoint error leak, sliding session cookie, React 19 form reset (values echoed back on validation errors), stale dialog state |
| Website import (60 agents, 4 lenses) | 28 confirmed → all fixed: DNS-rebinding SSRF (socket-pinned lookup), exponential `var()` expansion, modern colour spaces, charset sniffing, per-call font state, logo validation order/atomicity, UI (font opt-out, analysis survives tab switch, clear errors, bare domains) |

### Owner requests (2026-10-16)
| Item | Status |
| --- | --- |
| Delete brands (org admins, slug confirmation, cascade + storage cleanup, audited; UI + `DELETE /api/v1/brands/:id`) | ✅ live in `310df24` (2026-10-16 09:02); isolation test covers cascade + storage |
| AI provider API keys in the Integrations page (encrypted, org-wide, brand override, real connection test) + verified model catalog | ✅ live in `310df24`; waiting for the owner's OpenAI key to verify a real connection |

## Phase 2 — AI engine, Creative Studio, strategy agent: BUILT (commit `e1c2477`)

Built in one pass on 2026-10-16 after a three-proposal design panel (ledger-first
engine won). Verified by **73/73 automated tests on the server** including a real
Chromium render and a real FFmpeg assembly; the live browser click-through
(`/root/e2e-phase23.sh`) status is recorded below.

### Acceptance criteria (PRD §23 — AI & Creative)
- [x] Model ids and prices live only in the verified catalog; every call recorded in `ai_runs` with ILS cost (unit-tested: cost from provider usage, estimate when usage is missing)
- [x] Monthly cap per brand (`AI_MONTHLY_BUDGET_ILS`, default 500 ₪) — a run that would exceed it is BLOCKED and admins notified; ≥ 80 % → economy models first
- [x] Single-run cap (`AI_SINGLE_RUN_MAX_ILS`, default 25 ₪) → `AI_HIGH_COST` approval; the run executes only after approval and marks it EXECUTED
- [x] Prompts are built only from approved facts (`buildFactsPacket`: settings, active products, APPROVED knowledge, competitors as names only) — knowledge pending approval never reaches a model
- [x] Deterministic Hebrew QA blocks forbidden claims and prices not in verified products, warns on unverified numbers / percentages / superlatives — runs on ideas, scripts and every creative version
- [x] Hebrew typography is real text in an editable layer document, never produced by an image model; rendered in Chromium with bundled OFL fonts (Heebo, Assistant, Rubik, Noto Sans Hebrew)
- [x] Render warnings (overflow after auto-fit, missing image/logo, font not loaded) are stored on the version and shown — never silently clipped
- [x] Export PNG / JPG / WebP; approval binds to a specific version; QA-blocked versions cannot be sent for approval
- [x] Strategy items cite fact ids + confidence; unknown ids are stripped and confidence lowered; budget suggestions removed when no budget fact exists
- [x] Mocks only outside production / demo brands / `AI_ALLOW_MOCK`, always labelled `[MOCK]`
- [x] Live browser verification (`/root/e2e-phase23.sh`, 2026-10-16 10:10): **17/18** — login, all new pages render, GOALS brief with 6 cited items from a real model, 2 ideas, version composed, Chromium render READY + PNG download (47 KB), editor live preview, video script. The only failure: the video render — **the owner's OpenAI account has no credits** (`429 You have no credits remaining`), so TTS (OpenAI-only) failed; text tasks fell back to Anthropic automatically (claude-sonnet-5-5, 0.06–0.12 ₪ per call recorded in the ledger)

### What exists
| Item | Status |
| --- | --- |
| `packages/core/src/ai`: catalog (verified 2026-10-15), adapters (OpenAI Responses/Images/Speech, Anthropic Messages, Google GenAI, mocks), router, facts packet, QA, engine (ledger/budget/approval/fallback/JSON repair), `getAiUsage`, `probeProvider` | ✅ 10 engine tests |
| Integrations page: provider ids fixed (`google`), one key per provider, real connection test | ✅ (bug found by the design panel: a saved Google key never showed CONNECTED) |
| **מנוע AI ועלויות** page (`/app/ai`): monthly spend vs cap, by provider / task, live probe per connected provider, ledger table with mock/estimate flags | ✅ renders live; ledger shows the real runs |
| **אסטרטגיית AI** (`/app/strategy`): 4 brief kinds, item list with fact citations (text of each cited fact shown), confidence badges, data gaps, accept/archive, stale-kit badge | ✅ live: GOALS brief generated by claude-sonnet-5-5 (6 items, 23 s, 0.12 ₪) |
| **סטודיו קריאייטיב** (`/app/creative`): projects (channel/format/aspect/product), AI ideas with claims + QA, compose from idea or manually (3 templates, AI or library background), **editor** (layer list, text/size/weight/color/alignment/pill background, image picker, shapes/gradients, percent boxes, document colours/fonts, live iframe preview with the same HTML as the renderer, layout warnings), versions tab (thumbnails, QA, warnings, PNG/JPG/WebP download, send for approval, re-render), archive | ✅ live: ideas (real model) → version 1 → Chromium render READY, QA PASSED, PNG downloaded; AI backgrounds need an image provider with credits |
| Worker: `creative.render` (content queue) and `video.render` (video queue) jobs via `systemBrandContext`; Chromium launched lazily, closed after idle; render smoke at boot | ✅ (server log shows `render smoke OK` after deploy) |
| Approval handlers `creative_version` and `video_project` (APPROVED → version/project APPROVED; REJECTED / CHANGES → back to draft) | ✅ tested |
| Media route: HTTP Range support (video seeking) | ✅ E2E checks a 206 |
| Tests: `ai-engine` (10), `creative` (7), `video` (4), `render` (2, `RENDER_TESTS=1`) | ✅ 73/73 on the server |

### Known gaps / next
- Budget reservation is check-then-write (two simultaneous runs can both pass near the cap) — row-locked reservation is designed, not built.
- No drag-and-drop in the editor (numeric position boxes); no per-format adaptations inside one document.
- Routing policy and model catalog are code (verified with a date), not editable from the UI.
- Knowledge ingestion from URLs/documents into chunks; QA judge on a second provider.

## Phase 3 — Video Studio: BUILT (commit `e1c2477`)

| Item | Status |
| --- | --- |
| **סטודיו וידאו** (`/app/video`): projects (aspect, OpenAI voice), AI script (scene count, target length) with QA, per-scene editing (narration, on-screen text, visual: branded card / library image / AI image + prompt), cost estimate before render (TTS characters × catalog price + AI images), render with progress (polls every 3 s), player with seeking, MP4 + SRT download, send for approval | 🟡 script generated live (real model); the render failed only because OpenAI TTS has no credits — the error is shown on the project. Pipeline itself verified on the server with mock TTS |
| Pipeline (`renderVideoProject`): TTS per scene (mp3) → ffprobe duration → scene frame via the creative templates in Chromium → ffmpeg per scene (libx264, aac) → concat → libass subtitles (bundled Heebo, size by aspect) → MP4 stored as media; per-scene audio/frames stored; cost settled from the ledger | ✅ real pipeline test on the server (mock TTS, ~3.4 s) |
| Not built: provider video-clip generation, storyboard previews before render, multi-aspect export from one project, AI-imagery disclosure overlay | ⏳ |

## Meta (Facebook / Instagram / Ads) — read-only integration: BUILT, awaiting app credentials

| Item | Status |
| --- | --- |
| Org-wide Meta app credentials (App ID / Secret / Login-for-Business configuration id) in the Integrations page, encrypted | ✅ built |
| SSO connect per brand (Facebook Login for Business, code grant, signed state + cookie nonce, long-lived token, `debug_token`), discovery of ad accounts / Pages / Instagram, selection, disconnect | ✅ built + tested with a fake Graph API (3 tests) |
| Read-only sync of campaigns / ad sets / ads / daily insights (account + campaign), nightly job 05:30 + manual sync, `integration_syncs` log, auth errors → EXPIRED | ✅ built + tested |
| **מנהל קמפיינים** (`/app/ads`): totals, daily spend bars, campaigns table, read-only label, 7/30/90-day ranges | ✅ renders (empty until a brand is connected) |
| Live test against the real Meta app (dev mode) | ⏳ needs the owner: App ID + App Secret (+ configuration id) in Integrations → add `https://mm-marketing.mymvn.app/api/v1/integrations/meta/callback` to Valid OAuth Redirect URIs → "התחברות עם פייסבוק" on the brand |
| Writes (paused drafts, budget changes) behind approvals; app review for public use | ⏳ next phase |

## Video Studio v2 — motion, characters, one-click (2026-10-16 → 10-19)

| Item | Status |
| --- | --- |
| **סרטון אוטומטי**: one brief → cinematic script (visual + camera prompts) → every scene real AI video → optional talking presenter → music, transitions, subtitles → render (approval above the single-run cap starts the render automatically) | ✅ live (`80e8199`); needs a Google key with billing for real motion |
| Scene types: card / library image / AI image (Ken Burns zoom), library video, **AI video (Veo 3.1, 1080p, 8 s, native audio)**, **talking character (Kling AI Avatar v2 via fal.ai, lip-sync driven by our Hebrew audio)** | ✅ built; Veo / fal adapters await the owner's keys |
| Brand characters (image + voice + description, AI portrait generation) | ✅ |
| Reels overlay layout (headline in the upper band, subtitles in the reserved lower band), cross-fades, ducked background music, narration/image/clip caching (re-render pays only for changes) | ✅ verified with a real Chromium + FFmpeg pipeline test |
| Sora API | ❌ shut down by OpenAI on 2026-09-24 (SDK notice) — not used |
| Review fixes: video approval bound to the rendered file, dead renders no longer lock edits, Meta EXPIRED only on code 190, QA catches bare prices | ✅ |

## Phase 4 — content calendar and publishing: BUILT (this commit)

| Item | Status |
| --- | --- |
| **לוח תוכן ופרסום** (`/app/calendar`): month grid, list, new/edit post, AI captions grounded in approved facts, sources = rendered creatives / videos / library media | ✅ |
| One post per channel (Facebook Page, Instagram); approval bound to the exact content (hash); content edits void the approval; time changes don't | ✅ tested |
| Worker `publishing.dispatch-due` every minute: claim SCHEDULED → PUBLISHING (never twice), Facebook text / photo (multipart) / video (graph-video), Instagram image (JPEG via signed 1-hour public link) and Reels (resumable binary upload), status polling, permalinks, 3 attempts with back-off, stuck posts surfaced as FAILED, admins notified | ✅ tested with a fake Graph API |
| Live publishing | ⏳ needs the Meta connection with `pages_manage_posts`, `publish_video`, `instagram_basic`, `instagram_content_publish` in the Login-for-Business configuration; Cloudflare must let Meta fetch `/api/v1/public/media/*` |
| Monthly auto-planner, automation rules | ⏳ next |

## Known gaps / next steps
- Manual UI click-through of every screen (owner + Claude); fix anything found.
- User invitations and per-brand grant management UI.
- Rate limiting on uploads / website import (login + MFA are limited).
- Super-admin MFA reset flow.
- Automated off-box backups.
- Dockerized app images are untested (systemd deploy is the verified path).
- Prisma 6 warns that `package.json#prisma` config is deprecated → move to `prisma.config.ts` before Prisma 7.
- Owner actions: add credits to the OpenAI account (TTS + image generation are OpenAI/Google only); enter the Meta app credentials and test the SSO in dev mode.
- Cloudflare now serves a managed challenge to non-browser clients on the public hostname (seen from the server's own IP) — REST clients and future Meta webhooks need a WAF skip rule for `/api/*`.
- Next: live Meta dev-mode test, then Google Ads read-only (Phase 5) per the owner's priority.
