#!/bin/bash
# VLESS-клиент → локальный SOCKS/HTTP 127.0.0.1:10808 для OUTREACH_FSA_PROXY
set -euo pipefail

ENV_FILE="${1:-/var/www/navicert/.env.local}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URI="${OUTREACH_VLESS_URI:-}"

if [ -z "$URI" ]; then
  echo "Задайте OUTREACH_VLESS_URI=vless://..." >&2
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  x86_64) SB_ARCH=amd64 ;;
  aarch64) SB_ARCH=arm64 ;;
  *) echo "unsupported arch $ARCH" >&2; exit 1 ;;
esac

VER="1.11.7"
INSTALL="/usr/local/sing-box"
mkdir -p "$INSTALL" /etc/sing-box

if [ ! -x "$INSTALL/sing-box" ]; then
  tmp=$(mktemp -d)
  curl -fsSL "https://github.com/SagerNet/sing-box/releases/download/v${VER}/sing-box-${VER}-linux-${SB_ARCH}.tar.gz" \
    | tar -xz -C "$tmp"
  install -m 755 "$tmp/sing-box-${VER}-linux-${SB_ARCH}/sing-box" "$INSTALL/sing-box"
  rm -rf "$tmp"
fi

OUTREACH_VLESS_URI="$URI" node "$ROOT/scripts/outreach/vless-uri-to-singbox.mjs" > /etc/sing-box/outreach.json
"$INSTALL/sing-box" check -c /etc/sing-box/outreach.json

cat > /etc/systemd/system/sing-box-outreach.service <<EOF
[Unit]
Description=sing-box VLESS client for FSA outreach
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL/sing-box run -c /etc/sing-box/outreach.json
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sing-box-outreach
systemctl restart sing-box-outreach
sleep 4

code=$(curl -s -o /dev/null -w '%{http_code}' --socks5-hostname 127.0.0.1:10808 --max-time 60 https://pub.fsa.gov.ru/ || echo 000)
echo "FSA via sing-box: HTTP $code"

if [ "$code" != "200" ]; then
  journalctl -u sing-box-outreach -n 15 --no-pager >&2 || true
  exit 1
fi

touch "$ENV_FILE"
if grep -q '^OUTREACH_FSA_PROXY=' "$ENV_FILE"; then
  sed -i 's|^OUTREACH_FSA_PROXY=.*|OUTREACH_FSA_PROXY=socks5://127.0.0.1:10808|' "$ENV_FILE"
else
  echo 'OUTREACH_FSA_PROXY=socks5://127.0.0.1:10808' >> "$ENV_FILE"
fi

pm2 restart navicert --update-env 2>/dev/null || true
echo "OK: OUTREACH_FSA_PROXY=socks5://127.0.0.1:10808"
