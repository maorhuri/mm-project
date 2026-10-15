#!/usr/bin/env bash
# MM Marketing OS — production deploy: build an isolated release, gate it on
# migrations + typecheck + lint + build + tests, then switch `current` atomically
# and restart services. A failed step leaves the running release untouched.
#
#   scripts/deploy.sh [<git sha>]      (run as root on the server; invoked by mm-autodeploy)
set -euo pipefail

BASE=/opt/mm-marketing
REPO=$BASE/repo
SHARED=$BASE/shared
APP_USER=mm
SHA="${1:-$(git -C "$REPO" rev-parse HEAD)}"
SHORT=${SHA:0:8}
REL="$BASE/releases/$(date +%Y%m%d-%H%M%S)-$SHORT"

log() { echo "[deploy $(date +%H:%M:%S)] $*"; }
on_error() {
  log "FAILED (exit $1, line $2) — current release untouched"
  echo "$SHA" > "$SHARED/failed_sha"
  exit "$1"
}
trap 'on_error $? $LINENO' ERR

log "release $SHORT -> $REL"
mkdir -p "$REL"
git -C "$REPO" archive "$SHA" | tar -x -C "$REL"
for d in "" apps/web apps/worker packages/db; do
  ln -sfn "$SHARED/.env" "$REL/${d:+$d/}.env"
done
cd "$REL"

log "infra: postgres / redis / minio"
docker compose -f docker-compose.infra.yml up -d --remove-orphans >/dev/null 2>&1
PG_USER=$(grep '^POSTGRES_USER=' .env | cut -d= -f2)
for _ in $(seq 1 30); do
  docker exec mm-postgres pg_isready -q -U "$PG_USER" >/dev/null 2>&1 && break
  sleep 2
done

log "npm ci"
npm ci --no-audit --no-fund --loglevel=error

log "prisma generate + migrate deploy"
npm run -s db:generate
npm run -s db:migrate:deploy

log "typecheck + lint"
npm run -s typecheck
npm run -s lint

log "build"
npm run -s build

log "tests (unit + tenant isolation)"
npm run -s test

log "activate"
chown -R "$APP_USER:$APP_USER" "$REL"
ln -sfn "$REL" "$BASE/current.new"
mv -Tf "$BASE/current.new" "$BASE/current"
systemctl restart mm-web mm-worker
for _ in $(seq 1 20); do
  curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
echo "$SHA" > "$SHARED/deployed_sha"
rm -f "$SHARED/failed_sha"

log "prune old releases (keep 3)"
ls -1dt "$BASE"/releases/*/ | tail -n +4 | xargs -r rm -rf

log "OK $SHORT is live"
