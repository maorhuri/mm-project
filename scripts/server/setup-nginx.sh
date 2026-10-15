#!/usr/bin/env bash
# MM Marketing OS — Nginx reverse proxy + Let's Encrypt (idempotent). Run as root.
#   bash scripts/server/setup-nginx.sh <domain> <email>
# The domain is proxied by Cloudflare; HTTP-01 validation passes through the proxy.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
DOMAIN="${1:-mm-marketing.mymvn.app}"
EMAIL="${2:-support@mvn.co.il}"
log() { echo -e "\n=== [$(date +%H:%M:%S)] $* ==="; }

log "Install nginx + certbot"
apt-get update -qq
apt-get -y -qq install nginx certbot python3-certbot-nginx openssl

log "Firewall: allow 80/443"
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw status | sed -n '1,10p'

log "Temporary self-signed origin cert (443 must answer behind Cloudflare before Let's Encrypt)"
mkdir -p /etc/nginx/ssl
if [ ! -f /etc/nginx/ssl/selfsigned.crt ]; then
  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/selfsigned.key -out /etc/nginx/ssl/selfsigned.crt \
    -subj "/CN=${DOMAIN}" >/dev/null 2>&1
fi

log "Cloudflare real client IP"
{
  for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
    echo "set_real_ip_from $ip;"
  done
  echo "real_ip_header CF-Connecting-IP;"
} > /etc/nginx/conf.d/cloudflare-realip.conf

log "Nginx site for ${DOMAIN}"
cat > /etc/nginx/sites-available/mm-marketing <<EOF
# MM Marketing OS — reverse proxy to Next.js on 127.0.0.1:3000
# Managed by scripts/server/setup-nginx.sh (certbot edits the TLS lines).
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate     /etc/nginx/ssl/selfsigned.crt;
    ssl_certificate_key /etc/nginx/ssl/selfsigned.key;

    client_max_body_size 256m;
    proxy_read_timeout   300s;
    proxy_send_timeout   300s;

    location /.well-known/acme-challenge/ { root /var/www/html; }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \$host;
    }
}
EOF
ln -sfn /etc/nginx/sites-available/mm-marketing /etc/nginx/sites-enabled/mm-marketing
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx

log "Let's Encrypt (certbot --nginx, HTTP-01 via Cloudflare proxy)"
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --no-eff-email --redirect; then
  echo "CERTBOT_OK"
  certbot renew --dry-run >/dev/null 2>&1 && echo "auto-renew dry-run OK" || echo "auto-renew dry-run FAILED"
else
  echo "CERTBOT_FAILED — origin keeps the self-signed cert. Cloudflare SSL mode 'Full' still works;"
  echo "'Full (strict)' needs a Cloudflare Origin CA cert or DNS-01 validation (see docs/DEPLOYMENT.md)."
fi
nginx -t && systemctl reload nginx

log "Origin check"
curl -sk -o /dev/null -w "origin 443 -> HTTP %{http_code} (502 = app not running yet, expected)\n" https://127.0.0.1/ -H "Host: ${DOMAIN}" || true
log "NGINX SETUP COMPLETE"
