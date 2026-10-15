# MM Marketing OS

Self-hosted, multi-brand AI marketing automation platform. One control center that
plans, creates (posts, creatives, video), publishes, advertises (Meta + Google),
tracks leads and reports — for any number of brands, under the owner's approval.

- **Language:** Hebrew RTL first (English optional) · **Currency:** ILS · **Timezone:** Asia/Jerusalem
- **First brand:** MVN (cloud hosting) · **Second:** CONTINUO Pilates (later)
- **Production:** https://mm-marketing.mymvn.app

> Status and what is actually verified working: see [PROGRESS.md](PROGRESS.md).

## Documentation

| Doc | What it covers |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Modular monolith, packages, request/job flows, tenancy model |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | Product requirements (condensed from the PRD) and acceptance criteria |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | PostgreSQL schema, tenancy keys, indexes, statuses |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases 1–7 with scope and exit criteria |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, RBAC, tenant isolation, secrets, audit, hardening list |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Server layout, auto-deploy, Nginx/TLS, backups, runbook |
| [docs/API_INTEGRATIONS.md](docs/API_INTEGRATIONS.md) | AI providers, Meta, Google, storage — adapters and what is mocked |
| [docs/TESTING.md](docs/TESTING.md) | Unit, integration and tenant-isolation tests |

## Stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS · shadcn/ui-style components ·
Node.js · PostgreSQL + Prisma · Redis + BullMQ · S3-compatible storage (MinIO) ·
Docker Compose · Nginx · Cloudflare · FFmpeg / Remotion (video phases).

## Repository layout

```
apps/
  web/        Next.js app: dashboard UI + REST API (/api/v1)
  worker/     BullMQ workers + scheduled jobs
packages/
  db/         Prisma schema, migrations, seed, tenant-guarded client
  core/       Domain services (auth, tenancy, brands, media, approvals, audit), config, crypto
docker/       Dockerfiles for the fully containerized stack
scripts/      deploy.sh (release-based deploy) and server setup scripts
docs/         Architecture and operations documentation
```

## Quick start (development)

Requirements: Node 22, Docker (for Postgres/Redis/MinIO).

```bash
cp .env.example .env            # fill in secrets (openssl rand -base64 48)
npm install
npm run infra:up                # postgres + redis + minio (127.0.0.1 only)
npm run db:migrate              # apply migrations (dev)
npm run db:seed                 # admin user + MVN / CONTINUO demo brands
npm run dev                     # web on http://localhost:3000
npm run dev:worker              # background worker
```

Quality gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Deployment

Push to `main` → the server polls GitHub every minute, builds a new release in an
isolated directory, runs migrations / typecheck / lint / build / tests, and only then
switches `current` and restarts `mm-web` + `mm-worker`. Details and runbook in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Ground rules (from the PRD)

- No integration is declared working until verified against the real API.
- Mock adapters are clearly labelled and used only where credentials are missing.
- Nothing is published and no money is spent without the configured approval.
- Secrets live in `.env` / the server's `shared/.env` — never in code or Git.
- Demo data is always labelled as demo.
