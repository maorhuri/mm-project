# Deployment

Production: Ubuntu 26.04 LTS, 2 vCPU / 3.7 GB RAM (+4 GB swap) / 75 GB SSD,
behind Cloudflare at **https://mm-marketing.mymvn.app**.

## Server layout

```
/opt/mm-marketing/
├── repo/        git checkout of github.com/maorhuri/mm-project (polled by timer)
├── releases/    one directory per deployed commit (last 3 kept)
├── current  →   releases/<active>          (atomic symlink switch)
├── shared/      .env (generated once; secrets), deployed_sha, failed_sha, autodeploy.enabled
├── dev/         scratch working copy for development iterations (rsync target)
└── logs/        deploy.log
```

System services (systemd):

| Unit | What |
| --- | --- |
| `mm-web.service` | `next start -H 127.0.0.1 -p 3000` as user `mm`, `EnvironmentFile=shared/.env` |
| `mm-worker.service` | `node apps/worker/dist/index.js` as user `mm` |
| `mm-autodeploy.timer` → `.service` | every minute: `git fetch`; new commit on `main` → `scripts/deploy.sh` |
| `nginx` | TLS termination (Let's Encrypt, auto-renew), reverse proxy, 256 MB uploads |
| `docker` | `docker-compose.infra.yml`: postgres (`mm-postgres`), redis (`mm-redis`), Versity S3 Gateway (`mm-storage`, host port 9000 → 7070) — all on 127.0.0.1 |

## Auto-deploy flow

1. Push to `main` on GitHub.
2. Within ~60 s `mm-autodeploy` detects the new SHA (only when
   `shared/autodeploy.enabled` exists).
3. `scripts/deploy.sh <sha>`:
   - `git archive` the commit into `releases/<ts>-<sha>` (clean export)
   - symlink `shared/.env` into the release (root, apps, packages)
   - `docker compose -f docker-compose.infra.yml up -d` (idempotent)
   - `npm ci` → `prisma generate` → `prisma migrate deploy`
   - `typecheck` → `lint` → `build` (web + worker) → `test` (unit + tenant isolation)
   - `chown mm:mm`, switch `current`, `systemctl restart mm-web mm-worker`
   - health check `GET /api/health` (DB round-trip) → record `deployed_sha`
   - prune old releases
4. Any failure leaves `current` untouched, records `failed_sha`, and the same
   commit is not retried (push a fix).

Manual deploy of the current `main`: `mm-autodeploy --force`.
Logs: `tail -f /opt/mm-marketing/logs/deploy.log`, `journalctl -u mm-web -f`,
`journalctl -u mm-worker -f`.

GitHub Actions (`.github/workflows/ci.yml`) runs the same checks on every push
and pull request with throwaway services; it does not deploy.

## First-time setup (already executed; reproducible)

```bash
# on the server, as root
bash scripts/server/provision.sh          # (see scratch history) docker, node 22, swap, ufw, tz
scp ~/.ssh/<deploy-key> root@host:/root/.ssh/mm_github_deploy
bash scripts/server/setup-deploy.sh      # dirs, mm user, clone, shared/.env, systemd units, timer
bash scripts/server/setup-nginx.sh mm-marketing.mymvn.app support@mvn.co.il
touch /opt/mm-marketing/shared/autodeploy.enabled
```

`setup-deploy.sh` generates `shared/.env` with random `APP_SECRET`,
`APP_ENCRYPTION_KEY`, Postgres and MinIO passwords and a one-time admin password
(printed once). Re-running never overwrites it.

## Cloudflare

DNS for `mm-marketing.mymvn.app` is proxied (orange cloud). The origin has a
valid Let's Encrypt certificate, so SSL mode **Full (strict)** is safe. Upload
bodies above 100 MB are blocked by the Cloudflare free plan — large videos
will use direct-to-storage uploads in Phase 3.

## Database operations

```bash
cd /opt/mm-marketing/current
npm run db:migrate:deploy                 # apply migrations (deploy does this)
npm run db:seed                           # idempotent seed (admin, MVN, CONTINUO)
docker exec -t mm-postgres pg_dump -U mm mm_marketing | gzip > /root/backup-$(date +%F).sql.gz
```

Backups (to be automated, see SECURITY.md): nightly `pg_dump` + rsync of the
storage volume (`docker volume inspect mm-infra_storage_data`, a plain POSIX
directory tree — one folder per bucket) to off-box storage; test a restore
quarterly.

## Scaling notes

- Memory is the constraint (Next build + Postgres + Redis + MinIO on 3.7 GB).
  Phase 3 video rendering needs 8 GB+ or a separate worker host; the worker is
  already a separate process and can move to another machine with the same
  `.env` (Redis/Postgres reachable over a private network).
- Fully containerized app images (`docker/*.Dockerfile`, `docker-compose.yml`)
  exist for a later move to image-based deploys; they are **not yet tested**.
