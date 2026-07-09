#!/bin/bash
# Безопасный деплой на прод: код из git, контент и секреты на сервере не трогаем.
set -euo pipefail

cd /var/www/navicert

BK="/var/backups/navicert-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$BK"
cp -a content "$BK/"
test -f data/leads.json && cp -a data/leads.json "$BK/" || true
test -d data && cp -a data "$BK/data-snapshot" || true
test -d public/images/uploads && cp -a public/images/uploads "$BK/" || true
cp -a .env.local "$BK/"
echo "backup: $BK"

# Снимок размеров до деплоя (для проверки после восстановления)
python3 - <<'PY' > "$BK/counts.txt"
import json, pathlib
for name in ("services.json", "categories.json"):
    p = pathlib.Path("content") / name
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        print(f"{name}\t{len(data)}")
PY
cat "$BK/counts.txt"

git checkout -- content/ 2>/dev/null || true
test -f data/leads.json && git checkout -- data/leads.json 2>/dev/null || true
git clean -fd scripts/outreach/ 2>/dev/null || true
rm -f scripts/prod-deploy.py src/lib/outreach/fsa-network.ts src/lib/outreach/smtp-transport.ts 2>/dev/null || true
git reset --hard HEAD

git pull --ff-only origin main

cp -a "$BK/content/." content/
test -f "$BK/leads.json" && cp -a "$BK/leads.json" data/leads.json || true
if [ -d "$BK/data-snapshot" ]; then
  mkdir -p data
  for f in outreach-queue.json outreach-sent.json outreach-unsubscribed.json outreach-schedule.json fsa-token.json; do
    test -f "$BK/data-snapshot/$f" && cp -a "$BK/data-snapshot/$f" "data/$f" || true
  done
fi
if [ -d "$BK/uploads" ]; then
  mkdir -p public/images/uploads
  cp -a "$BK/uploads/." public/images/uploads/
fi

echo "=== verify restore ==="
python3 - <<PY
import json, pathlib, sys
bk = pathlib.Path("$BK/counts.txt")
before = dict(line.split("\t") for line in bk.read_text().strip().splitlines())
ok = True
for name, count in before.items():
    p = pathlib.Path("content") / name
    now = len(json.loads(p.read_text(encoding="utf-8")))
    print(f"{name}: backup {count} -> now {now}")
    if str(now) != count:
        ok = False
        print(f"WARNING: count mismatch for {name}", file=sys.stderr)
sys.exit(0 if ok else 1)
PY

export NODE_OPTIONS=--max-old-space-size=1536
npm ci
npm run outreach:setup
# Опционально: PROXY6_API_KEY в .env.local → node scripts/outreach/setup-proxy6.mjs
npm run build

pm2 restart navicert --update-env
pm2 save

echo "OK: $(git log -1 --oneline)"
