# Architecture

MM Marketing OS is a **modular monolith**: one TypeScript codebase, two runtime
processes (web + worker), one PostgreSQL database, one Redis, one object store.
Modules are separated by package and by domain service, not by network boundary.
Micro-services are deliberately avoided until a module's load justifies it.

## Runtime topology

```
                Cloudflare (proxy, TLS edge, DDoS)
                          │
                   Nginx (origin TLS, Let's Encrypt)
                          │  127.0.0.1:3000
          ┌───────────────┴───────────────┐
          │  apps/web  (Next.js, systemd) │   UI (RSC + server actions) + REST /api/v1
          └───────┬───────────────┬───────┘
                  │               │
     ┌────────────┴───┐    ┌──────┴────────┐    ┌──────────────────────┐
     │ PostgreSQL 16  │    │ Redis 7       │    │ versitygw (S3 API)   │
     │ (docker)       │    │ (docker)      │    │ (docker)             │
     └────────────┬───┘    └──────┬────────┘    └──────────┬───────────┘
                  │               │ BullMQ                 │
          ┌───────┴───────────────┴────────────────────────┴───────┐
          │  apps/worker  (Node, systemd) — queues, schedulers      │
          └────────────────────────────────────────────────────────┘
```

Both processes import the same domain layer (`@mm/core`) and the same database
client (`@mm/db`). The web process never performs long-running work inline; it
enqueues jobs. The worker never renders UI.

## Packages

| Package | Responsibility | May import |
| --- | --- | --- |
| `packages/db` (`@mm/db`) | Prisma schema, migrations, generated client, **tenant-scoped client** (`forBrand`) | `@prisma/client` only |
| `packages/core` (`@mm/core`) | Config, errors, crypto, auth (password/session/MFA), tenancy context + RBAC, audit, storage adapters, domain services (users, orgs, brands, media, approvals, notifications, integrations, dashboard, **creative, strategy, video**), **AI engine** (`src/ai`: catalog, adapters, router, facts packet, QA, ledger engine), **creative documents** (`src/creative`: schema, templates, HTML), queue definitions, seed | `@mm/db`, libraries |
| `@mm/core/creative` | Browser-safe subset (document schema, templates, HTML generation, font families) used by the editor's live preview | zod, nothing from Node |
| `@mm/core/render` | Chromium (Playwright) rendering of self-contained HTML + sharp variants. **Worker only** — never imported by `apps/web` | playwright, sharp |
| `apps/web` (`@mm/web`) | Next.js App Router: pages, server actions, REST route handlers, UI components | `@mm/core`, `@mm/db` (types + root client for identity-level reads) |
| `apps/worker` (`@mm/worker`) | BullMQ workers + job schedulers, writes `background_jobs` records | `@mm/core`, `@mm/db` |

Dependency direction is strictly downward: `web`/`worker` → `core` → `db`.
Future modules (AI router, Meta/Google adapters, video pipeline) are added as
folders inside `core` (or new packages) behind typed interfaces; the web and
worker only consume services.

## Request flows

### Page render (server component)
1. `middleware.ts` — cheap cookie-presence gate for `/app/*`.
2. `requireUser()` (`apps/web/src/lib/auth.ts`) validates the session cookie
   against `sessions` (hash lookup, sliding expiry) — cached per request.
3. `getBrandSelection()` lists brands the actor can access and picks the one
   stored in the `mm_brand` cookie.
4. `requireBrandContext()` → `resolveBrandContext(actor, brandId)` builds a
   `BrandContext` with the effective role and a **tenant-scoped DB client**.
5. The page calls domain services with that context; services never receive raw
   brand ids from the UI.

### Mutation (server action)
Action → `runAction()` → `brandContextFor(brandId)` → zod validation → domain
service → audit log → `revalidatePath`. Errors are translated into
`ActionState` for `useActionState` forms; `redirect()` passes through.

### REST (`/api/v1`)
Route handler → `withApi()` (error mapping) → `requireApiBrand()` (cookie or
`Authorization: Bearer <session token>`) → zod → same domain services. The UI
and the API cannot diverge because they share the service layer.

### Background job
Web/service enqueues on a BullMQ queue (`@mm/core/jobs/queues`) → worker
processor runs → every execution is recorded in `background_jobs`
(`startJobRecord`/`finishJobRecord`) with an optional **idempotency key** so a
retried job cannot repeat a side effect (publish, spend).

## Tenancy model

```
Organization ─┬─ Membership(user, role: OWNER|ADMIN|MEMBER|VIEWER)
              └─ Brand ─┬─ BrandAccess(user, role: BRAND_ADMIN|EDITOR|VIEWER)
                        ├─ BrandSettings, BrandAsset, BrandProduct, BrandKnowledge, BrandCompetitor
                        ├─ MediaAsset, Approval, Notification, BackgroundJob, ProviderAccount
                        └─ (future) campaigns, posts, leads, videos …
```

- Org OWNER/ADMIN and super admins implicitly hold `BRAND_ADMIN` on every brand of
  the org. MEMBER/VIEWER need an explicit `BrandAccess` grant.
- Isolation is enforced **below the service layer**: `forBrand(brandId)` is a
  Prisma client extension that rewrites every query on a tenant model —
  reads get `brand_id = ?` appended, creates are stamped, caller-supplied
  `brandId` values are overridden (never widened). See
  `packages/db/src/tenant.ts` and `tests/tenant-isolation.test.ts`.
- Object storage keys are prefixed `brands/<brandId>/…`; files are only served
  through an access-controlled route.
- Queue payloads carry `brandId`; job records are brand-scoped.

## Approval model

Every publish, spend or costly AI action creates an `Approval` bound to a
`(subjectType, subjectId, subjectVersion)`. Deciding an approval runs the
handler registered for its subject type (`registerApprovalHandler`), so modules
plug in without the approval service importing them. A material change to an
approved subject creates a new version and a new approval (PRD §19).

## Frontend

Next.js App Router, React 19, Tailwind v4, hand-written shadcn-style primitives
(`components/ui`) using logical CSS properties for RTL, Radix primitives wrapped
in `DirectionProvider dir="rtl"`, `next-themes` for dark/light, Heebo font.
Mutations go through server actions; uploads go through the REST API
(multipart). No client-side global state library is needed at this stage.

## Configuration

`packages/core/src/config.ts` validates `process.env` with zod on first use and
refuses placeholder secrets in production. Non-Next processes load `.env` by
walking up from the working directory; in production systemd injects
`/opt/mm-marketing/shared/.env`.

## AI engine (Phase 2)

`runText` / `runImage` / `runTts` in `packages/core/src/ai/engine.ts` are the
only way the app calls a model:

1. `routeCandidates()` orders catalog models of the org's connected providers
   by the task's tier (`TASK_DEFAULTS`), quality rank and budget pressure.
2. The gate: engine paused? single-run estimate above `AI_SINGLE_RUN_MAX_ILS`
   → an `AI_HIGH_COST` approval is created and the call refused until it is
   approved (then the run is tied to the approval and marks it EXECUTED);
   monthly cap exceeded → BLOCKED row + admins notified.
3. An `ai_runs` row is written RUNNING with the estimate, the adapter is
   called (fallback to the next candidate on failure), the row is settled with
   the provider's usage → ILS at catalog prices.
4. Prompts are built only from `buildFactsPacket()` (approved knowledge, active
   products, settings) + `groundingRules()`; user text is wrapped in
   `<user_request>`; outputs are QA'd by `runCopyQa()` before storage.

Mocks (`[MOCK]`-labelled) are used only when no key exists and
`NODE_ENV !== 'production'`, or `AI_ALLOW_MOCK=true`, or the brand is a demo.

## Rendering (Phase 2/3)

A creative is a `CreativeDocument` (JSON, percent-positioned layers, real text).
`documentToHtml()` produces one self-contained HTML document: the editor shows
it in an iframe (fonts from `/fonts`, images via the access-controlled media
route) and the worker renders the same HTML in headless Chromium (fonts and
images inlined as data: URIs, all network blocked). The page script auto-fits
text and reports overflow / missing-asset / font warnings, which are stored on
the version. Videos reuse the templates per scene; FFmpeg assembles the MP4 and
burns subtitles with libass using the bundled fonts.

## What is deliberately not here yet

- Social publishing (Phase 4), ads (Phase 5), CRM/attribution (Phase 6). Their
  tables are designed in [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) and added by
  migration per phase.
- Postgres row-level security as a second isolation layer (listed in
  [SECURITY.md](SECURITY.md) hardening).
