# Testing

## Layers

| Layer | Where | Runs against | Command |
| --- | --- | --- | --- |
| Pure unit | `packages/core/tests/tenant-scope.test.ts` (query rewriting), crypto round-trips | nothing external | `npm test` |
| Integration | `packages/core/tests/*.test.ts` — auth/sessions, MFA, approvals, media, brand kit, website import, provider credentials, **AI engine** (ledger, budget cap, approval gate, fallback, JSON repair — fake adapter behind a saved key), **Creative Studio** (templates, HTML, QA blocking, versions, approval handler, isolation), **Video Studio** (script, scene QA, estimate, render queue, SRT) | real PostgreSQL (`TEST_DATABASE_URL`), in-memory storage, no Redis (queue dispatch is stubbed via `set*RenderDispatcher`) | `npm test` |
| **Render pipeline** | `packages/core/tests/render.test.ts` — real Chromium render of Hebrew typography (size, overflow warnings) and a real FFmpeg assembly with mock TTS + burnt-in subtitles | Chromium (`PLAYWRIGHT_BROWSERS_PATH`) + ffmpeg/ffprobe | `RENDER_TESTS=1 npm test` (runs on the server; skipped in CI) |
| **Tenant isolation** | `packages/core/tests/tenant-isolation.test.ts` | real PostgreSQL | `npm run test:isolation` |
| Static | TypeScript strict, ESLint | — | `npm run typecheck`, `npm run lint` |
| Build | `next build`, `tsup` | — | `npm run build` |
| Smoke (deploy) | `scripts/deploy.sh` → `GET /api/health` after restart | production | automatic on deploy |

## Test database

`tests/global-setup.ts` creates the database named in `TEST_DATABASE_URL` if it
does not exist (using the main connection) and applies migrations with
`prisma migrate deploy`. It refuses to run when the test URL equals the main
URL. `tests/setup.ts` points `DATABASE_URL` at the test database, forces
`STORAGE_DRIVER=memory`, and truncates every table before each test. Test files
never run in parallel (`fileParallelism: false`).

## What the isolation suite proves

- A MEMBER with EDITOR on brand A cannot resolve a context for brand B
  (`ForbiddenError`); unknown brands are `NotFoundError`.
- Media uploaded to brand B is invisible to brand A through the service layer
  **and** through the tenant client (`findUnique` by id returns null, `count`
  excludes it, an explicit `where: { brandId: B }` is overridden), while the
  unscoped root client sees both rows — proving the filter lives in the tenant
  layer.
- Creates through brand A's client are stamped with brand A even when the
  caller passes brand B.
- Cross-brand update/delete via the wrong context fails and leaves the row
  untouched.
- Approvals are invisible and undecidable across brands.
- Super admins get `BRAND_ADMIN` on any brand.

Every new tenant-scoped table must be added to `TENANT_MODELS` and get at least
one assertion in this suite.

## Running locally

```bash
npm run infra:up                       # postgres/redis/s3 gateway
npm test                               # all suites
npm run test:isolation                 # only tenant isolation
npm run test --workspace=@mm/core -- --watch
```

## CI

`.github/workflows/ci.yml` provisions Postgres + Redis service containers and
runs generate → migrate → typecheck → lint → test → build on every push/PR.
The production deploy script runs the same gates on the server before
switching the release.

## Browser end-to-end (live site)

`/root/e2e-phase23.sh` on the server creates a throwaway org owner, drives the
live site with Playwright (login → strategy brief → creative project → AI ideas
→ compose → wait for the Chromium render → PNG download → editor preview →
video project → AI script → render → MP4 range request → AI ledger) and deletes
the user. It spends real provider credits (a few agorot) and leaves the
generated project in the brand as evidence; run it after deploys that touch
Phase 2/3.

## Not yet covered (tracked)

- Browser E2E in CI (today it runs on the server only, against production).
- Route-handler tests for the REST API (currently covered indirectly through
  the shared services; add supertest-style tests in Phase 2).
- Worker job tests with a Redis container.
