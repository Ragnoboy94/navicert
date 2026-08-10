#!/usr/bin/env python3
"""Add nginx 301 redirect navicert-info.ru -> https://navicert.pro (does not touch navicert site)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

HOST = os.environ.get("DEPLOY_HOST", "89.22.238.194")
USER = os.environ.get("DEPLOY_USER", "root")

REMOTE = r"""
set -euo pipefail

echo "=== BEFORE ==="
ls -la /etc/nginx/sites-available/ /etc/nginx/sites-enabled/
echo "--- server_name lines ---"
grep -R "server_name" /etc/nginx/sites-enabled/ || true

# New file only — never overwrite /etc/nginx/sites-available/navicert
CONF=/etc/nginx/sites-available/navicert-info-redirect
cat > "$CONF" <<'EOF'
# Redirect mailing domain to main site. MX stays on Yandex — do not change mail DNS.
server {
    listen 80;
    listen [::]:80;
    server_name navicert-info.ru www.navicert-info.ru;

    # ACME http-01 (certbot) before permanent redirect
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/html;
        default_type "text/plain";
        allow all;
    }

    location / {
        return 301 https://navicert.pro$request_uri;
    }
}
EOF

ln -sfn "$CONF" /etc/nginx/sites-enabled/navicert-info-redirect

mkdir -p /var/www/html

nginx -t
systemctl reload nginx

echo "=== AFTER ==="
ls -la /etc/nginx/sites-enabled/
echo "--- curl Host navicert-info.ru ---"
curl -sI -H "Host: navicert-info.ru" http://127.0.0.1/ | head -20
echo "--- curl Host navicert.pro (sanity) ---"
curl -sI -H "Host: navicert.pro" http://127.0.0.1/ | head -15

# SSL only if public DNS already points here (do not use certbot --nginx: it rewrites configs)
A_IP=$(getent ahostsv4 navicert-info.ru 2>/dev/null | awk '{print $1; exit}' || true)
MY_IP=$(curl -4 -s --max-time 5 ifconfig.me || true)
echo "DNS A=$A_IP MY_IP=$MY_IP"

if [ -n "$A_IP" ] && [ -n "$MY_IP" ] && [ "$A_IP" = "$MY_IP" ]; then
  echo "DNS points here — requesting cert via webroot only..."
  if command -v certbot >/dev/null 2>&1; then
    certbot certonly --webroot -w /var/www/html \
      -d navicert-info.ru -d www.navicert-info.ru \
      --non-interactive --agree-tos --register-unsafely-without-email \
      --keep-until-expiring
    if [ -f /etc/letsencrypt/live/navicert-info.ru/fullchain.pem ] && ! grep -q 'listen 443' "$CONF"; then
      # Ensure ssl includes exist (from prior navicert.pro certbot)
      SSL_OPTS=/etc/letsencrypt/options-ssl-nginx.conf
      SSL_DH=/etc/letsencrypt/ssl-dhparams.pem
      if [ ! -f "$SSL_OPTS" ]; then SSL_OPTS=""; fi
      if [ ! -f "$SSL_DH" ]; then SSL_DH=""; fi
      {
        echo ""
        echo "server {"
        echo "    listen 443 ssl http2;"
        echo "    listen [::]:443 ssl http2;"
        echo "    server_name navicert-info.ru www.navicert-info.ru;"
        echo "    ssl_certificate     /etc/letsencrypt/live/navicert-info.ru/fullchain.pem;"
        echo "    ssl_certificate_key /etc/letsencrypt/live/navicert-info.ru/privkey.pem;"
        if [ -n "$SSL_OPTS" ]; then echo "    include $SSL_OPTS;"; fi
        if [ -n "$SSL_DH" ]; then echo "    ssl_dhparam $SSL_DH;"; fi
        echo "    return 301 https://navicert.pro\$request_uri;"
        echo "}"
      } >> "$CONF"
      nginx -t && systemctl reload nginx
      echo "HTTPS redirect block added"
    fi
  else
    echo "certbot not installed"
  fi
else
  echo "DNS not yet on this VPS — HTTP redirect ready; run certbot after A-record propagates"
fi

echo "SETUP_REDIRECT_OK"
"""


def load_password() -> str:
    pwd = os.environ.get("DEPLOY_PASSWORD", "").strip()
    if pwd:
        return pwd
    for name in (".env.local", ".env"):
        path = Path.cwd() / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DEPLOY_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""


def main() -> int:
    pwd = load_password()
    if not pwd:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=pwd, timeout=30)
    stdin, stdout, stderr = c.exec_command(REMOTE, timeout=180)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    sys.stdout.write(out)
    if err:
        sys.stderr.write(err)
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
