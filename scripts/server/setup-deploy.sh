#!/usr/bin/env bash
# MM Marketing OS — server deploy pipeline setup (idempotent). Run as root.
# Prereq: the GitHub deploy key was copied to /root/.ssh/mm_github_deploy
#
# Layout:
#   /opt/mm-marketing/repo       git checkout (polled every minute by mm-autodeploy.timer)
#   /opt/mm-marketing/releases/  one directory per deployed commit
#   /opt/mm-marketing/current    symlink -> active release (atomic switch)
#   /opt/mm-marketing/shared/    .env (secrets, generated once), deploy state
#   /opt/mm-marketing/dev        scratch working copy for development iterations
#   /opt/mm-marketing/logs/      deploy.log
set -euo pipefail
BASE=/opt/mm-marketing
REPO_URL="git@github.com:maorhuri/mm-project.git"
DOMAIN="mm-marketing.mymvn.app"
log() { echo -e "\n=== [$(date +%H:%M:%S)] $* ==="; }

log "Directories + app user"
mkdir -p "$BASE"/{releases,shared,logs,dev}
id -u mm >/dev/null 2>&1 || useradd --system --home-dir "$BASE" --shell /usr/sbin/nologin mm
chown mm:mm "$BASE/logs"

log "GitHub deploy key"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f /root/.ssh/mm_github_deploy ] || { echo "ERROR: /root/.ssh/mm_github_deploy missing"; exit 1; }
chmod 600 /root/.ssh/mm_github_deploy
if ! grep -q "^Host github.com" /root/.ssh/config 2>/dev/null; then
  cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/mm_github_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
fi
chmod 600 /root/.ssh/config
touch /root/.ssh/known_hosts
ssh-keyscan -t ed25519 github.com 2>/dev/null >> /root/.ssh/known_hosts
ssh -n -T git@github.com 2>&1 | head -1 || true

log "Clone repo"
if [ ! -d "$BASE/repo/.git" ]; then
  git clone -q "$REPO_URL" "$BASE/repo" 2>&1 | grep -v "empty repository" || true
fi
git -C "$BASE/repo" remote -v | head -1

log "Shared .env (generated once, never overwritten)"
if [ ! -f "$BASE/shared/.env" ]; then
  PG_PW=$(openssl rand -hex 16)
  S3_PW=$(openssl rand -hex 16)
  APP_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  ENC_KEY=$(openssl rand -base64 32 | tr -d '\n')
  ADMIN_PW="Mm-$(openssl rand -hex 5)"
  cat > "$BASE/shared/.env" <<EOF
# MM Marketing OS — production environment. Generated $(date -Is). Keep secret.
NODE_ENV=production
APP_NAME="MM Marketing OS"
APP_URL=https://${DOMAIN}
PORT=3000
TZ=Asia/Jerusalem
DEFAULT_LOCALE=he-IL
DEFAULT_CURRENCY=ILS
APP_SECRET=${APP_SECRET}
APP_ENCRYPTION_KEY=${ENC_KEY}
SESSION_TTL_DAYS=30

POSTGRES_USER=mm
POSTGRES_PASSWORD=${PG_PW}
POSTGRES_DB=mm_marketing
DATABASE_URL=postgresql://mm:${PG_PW}@127.0.0.1:5432/mm_marketing?schema=public
TEST_DATABASE_URL=postgresql://mm:${PG_PW}@127.0.0.1:5432/mm_marketing_test?schema=public

REDIS_URL=redis://127.0.0.1:6379

S3_ENDPOINT=http://127.0.0.1:9000
S3_REGION=us-east-1
S3_BUCKET=mm-media
S3_ACCESS_KEY=mm-storage
S3_SECRET_KEY=${S3_PW}
S3_FORCE_PATH_STYLE=true
MEDIA_PUBLIC_BASE_URL=
MEDIA_MAX_UPLOAD_MB=200

SEED_ADMIN_EMAIL=support@mvn.co.il
SEED_ADMIN_PASSWORD=${ADMIN_PW}
SEED_ADMIN_NAME=Maor

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_AI_API_KEY=
AI_MONTHLY_BUDGET_ILS=500
AI_SINGLE_RUN_MAX_ILS=25

META_APP_ID=
META_APP_SECRET=
META_API_VERSION=v21.0
META_WEBHOOK_VERIFY_TOKEN=
META_ADS_WRITE_ENABLED=false

GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
GOOGLE_ADS_WRITE_ENABLED=false

LOG_LEVEL=info
SENTRY_DSN=
EOF
  chown root:mm "$BASE/shared/.env"
  chmod 640 "$BASE/shared/.env"
  echo "GENERATED_ADMIN_PASSWORD=${ADMIN_PW}"
else
  echo "shared/.env already exists — keeping it"
fi

log "systemd units"
cat > /etc/systemd/system/mm-web.service <<'EOF'
[Unit]
Description=MM Marketing OS - web (Next.js)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=mm
Group=mm
WorkingDirectory=/opt/mm-marketing/current/apps/web
EnvironmentFile=/opt/mm-marketing/shared/.env
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/node /opt/mm-marketing/current/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=always
RestartSec=3
KillSignal=SIGINT
TimeoutStopSec=20
LimitNOFILE=65536
SyslogIdentifier=mm-web

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/mm-worker.service <<'EOF'
[Unit]
Description=MM Marketing OS - background worker (BullMQ)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=mm
Group=mm
WorkingDirectory=/opt/mm-marketing/current/apps/worker
EnvironmentFile=/opt/mm-marketing/shared/.env
Environment=NODE_ENV=production
ExecStart=/usr/local/bin/node /opt/mm-marketing/current/apps/worker/dist/index.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
SyslogIdentifier=mm-worker

[Install]
WantedBy=multi-user.target
EOF

log "Auto-deploy poller (git pull-based, every minute)"
cat > /usr/local/bin/mm-autodeploy <<'EOF'
#!/usr/bin/env bash
# Polls origin/main; deploys a new commit via scripts/deploy.sh from the repo.
# A commit whose deploy failed is not retried until a newer commit appears.
set -euo pipefail
BASE=/opt/mm-marketing
REPO=$BASE/repo
SHARED=$BASE/shared
BRANCH=main
exec 9>/var/lock/mm-autodeploy.lock
flock -n 9 || { echo "deploy already running"; exit 0; }
[ -f "$SHARED/autodeploy.enabled" ] || [ "${1:-}" = "--force" ] || exit 0
cd "$REPO"
git fetch -q origin "$BRANCH"
REMOTE=$(git rev-parse "origin/$BRANCH")
DEPLOYED=$(cat "$SHARED/deployed_sha" 2>/dev/null || echo none)
FAILED=$(cat "$SHARED/failed_sha" 2>/dev/null || echo none)
if [ "${1:-}" != "--force" ]; then
  [ "$REMOTE" = "$DEPLOYED" ] && exit 0
  [ "$REMOTE" = "$FAILED" ] && exit 0
fi
echo "[$(date -Is)] deploying $REMOTE (deployed: $DEPLOYED)" | tee -a "$BASE/logs/deploy.log"
git reset -q --hard "origin/$BRANCH"
set +e
bash scripts/deploy.sh "$REMOTE" 2>&1 | tee -a "$BASE/logs/deploy.log"
rc=${PIPESTATUS[0]}
set -e
echo "[$(date -Is)] deploy exit=$rc" | tee -a "$BASE/logs/deploy.log"
exit "$rc"
EOF
chmod +x /usr/local/bin/mm-autodeploy

cat > /etc/systemd/system/mm-autodeploy.service <<'EOF'
[Unit]
Description=MM Marketing OS - auto-deploy from GitHub main

[Service]
Type=oneshot
ExecStart=/usr/local/bin/mm-autodeploy
EOF

cat > /etc/systemd/system/mm-autodeploy.timer <<'EOF'
[Unit]
Description=Poll GitHub main every minute and deploy new commits

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable mm-web.service mm-worker.service >/dev/null 2>&1
systemctl enable --now mm-autodeploy.timer >/dev/null 2>&1
echo "timer: $(systemctl is-active mm-autodeploy.timer) (deploys only after shared/autodeploy.enabled exists)"

log "DEPLOY PIPELINE SETUP COMPLETE"
