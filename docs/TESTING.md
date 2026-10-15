# Testing

## Layers

| Layer | Where | Runs against | Command |
| --- | --- | --- | --- |
| Pure unit | `packages/core/tests/tenant-scope.test.ts` (query rewriting), crypto round-trips | nothing external | `npm test` |
| Integration | `packages/core/tests/*.test.ts` — auth/sessions, approvals, media, brand kit | real PostgreSQL (`TEST_DATABASE_URL`), in-memory storage | `npm test` |
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

## Not yet covered (tracked)

- End-to-end browser tests (login → create brand → upload → approve) —
  planned with Playwright once Phase 2 UI stabilizes.
- Route-handler tests for the REST API (currently covered indirectly through
  the shared services; add supertest-style tests in Phase 2).
- Worker job tests with a Redis container.
