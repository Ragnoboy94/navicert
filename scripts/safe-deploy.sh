#!/bin/bash
# Безопасный деплой на прод: код из git, контент и секреты на сервере не трогаем.
set -euo pipefail

cd /var/www/navicert

BK="/var/backups/navicert-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp -a content/site.json content/services.json "$BK/" 2>/dev/null || true
test -f data/leads.json && cp -a data/leads.json "$BK/" || true
cp -a .env.local "$BK/"

git stash push -m "pre-deploy-$(date -u +%Y%m%d-%H%M%S)" -- \
  content/site.json content/services.json 2>/dev/null || true

git pull --ff-only origin main

git stash pop 2>/dev/null || true

export NODE_OPTIONS=--max-old-space-size=1536
npm run build

pm2 restart navicert --update-env
pm2 save

echo "OK: $(git log -1 --oneline)"
