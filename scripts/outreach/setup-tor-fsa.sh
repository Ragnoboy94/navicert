#!/bin/bash
# Fallback: Tor с выходом в RU для доступа к pub.fsa.gov.ru с зарубежного VPS.
# Надёжнее для продакшена — Proxy6 IPv4 RU: npm run outreach:setup-proxy6
set -euo pipefail

ENV_FILE="${1:-/var/www/navicert/.env.local}"
TORRC=/etc/tor/torrc.d/navicert-fsa.conf

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tor curl

mkdir -p /etc/tor/torrc.d
cat > "$TORRC" <<'EOF'
SocksPort 9050
ExitNodes {ru}
StrictNodes 1
EOF

systemctl enable tor
systemctl restart tor
sleep 8

code=$(curl -s -o /dev/null -w '%{http_code}' --socks5-hostname 127.0.0.1:9050 --max-time 45 https://pub.fsa.gov.ru/ || echo 000)
echo "FSA via Tor: HTTP $code"

if [ "$code" != "200" ]; then
  echo "Tor exit не достучался до ФСА — используйте Proxy6 (outreach:setup-proxy6)" >&2
  exit 1
fi

touch "$ENV_FILE"
if grep -q '^OUTREACH_FSA_PROXY=' "$ENV_FILE"; then
  sed -i 's|^OUTREACH_FSA_PROXY=.*|OUTREACH_FSA_PROXY=socks5://127.0.0.1:9050|' "$ENV_FILE"
else
  echo 'OUTREACH_FSA_PROXY=socks5://127.0.0.1:9050' >> "$ENV_FILE"
fi

echo "OUTREACH_FSA_PROXY=socks5://127.0.0.1:9050 записан в $ENV_FILE"
