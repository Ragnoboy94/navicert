#!/bin/bash
# Безопасный деплой на прод: код из git, контент и секреты на сервере не трогаем.
set -euo pipefail

cd /var/www/navicert

BK="/var/backups/navicert-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp -a content "$BK/"
test -f data/leads.json && cp -a data/leads.json "$BK/" || true
cp -a .env.local "$BK/"
echo "backup: $BK"

# Сбрасываем локальные правки контента, чтобы pull прошёл без конфликтов
git checkout -- content/ 2>/dev/null || true
test -f data/leads.json && git checkout -- data/leads.json 2>/dev/null || true

git pull --ff-only origin main

# Возвращаем контент с сервера (правки из админки)
cp -a "$BK/content/." content/
test -f "$BK/leads.json" && cp -a "$BK/leads.json" data/leads.json || true

export NODE_OPTIONS=--max-old-space-size=1536
npm run build

pm2 restart navicert --update-env
pm2 save

echo "OK: $(git log -1 --oneline)"
