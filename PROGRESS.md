# Progress

Living status of what is **built and verified**, what is **built but not yet
verified**, and what is **pending**. Nothing is marked verified unless it was
exercised on the real server (https://mm-marketing.mymvn.app) or by automated
tests run there.

_Last updated: 2026-10-15 23:25 — Phase 1 live (commit `a743f3c`)._

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
| Delete brands (org admins, slug confirmation, cascade + storage cleanup, audited; UI + `DELETE /api/v1/brands/:id`) | 🟡 built — tests green on dev; live after next deploy |
| AI provider API keys in the Integrations page (encrypted, org-wide, brand override, real connection test) + verified model catalog | 🟡 built — live after next deploy |

## Known gaps / next steps
- Manual UI click-through of every screen (owner + Claude); fix anything found.
- User invitations and per-brand grant management UI.
- Rate limiting on uploads / website import (login + MFA are limited).
- Super-admin MFA reset flow.
- Automated off-box backups.
- Dockerized app images are untested (systemd deploy is the verified path).
- Prisma 6 warns that `package.json#prisma` config is deprecated → move to `prisma.config.ts` before Prisma 7.
- Phase 2 (AI engine + Creative Studio) then Phase 5 (Meta/Google Ads, read-only first) per the owner's priority.
