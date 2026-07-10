#!/bin/bash
# Безопасный деплой на прод: код из git, контент и секреты на сервере не трогаем.
set -euo pipefail

cd /var/www/navicert

BK="/var/backups/navicert-$(date -u +%Y%m%d-%H%M%S)"
PERSIST="/var/www/navicert-persist"
mkdir -p "$BK" "$PERSIST/content"

# Бэкап пользовательского контента (symlink или каталог)
if [ -L content ]; then
  mkdir -p "$BK/content"
  cp -a "$(readlink -f content)/." "$BK/content/"
elif [ -d content ]; then
  cp -a content "$BK/"
  rsync -a content/ "$PERSIST/content/"
fi
test -f data/leads.json && cp -a data/leads.json "$BK/" || true
test -d data && cp -a data "$BK/data-snapshot" || true
test -d public/images/uploads && cp -a public/images/uploads "$BK/" || true
cp -a .env.local "$BK/"
echo "backup: $BK"

python3 - <<'PY' > "$BK/counts.txt"
import json, pathlib
for name in ("services.json", "categories.json", "site.json"):
    p = pathlib.Path("content") / name
    if p.exists():
        data = json.loads(p.read_text(encoding="utf-8"))
        print(f"{name}\t{len(data) if isinstance(data, list) else 1}")
PY
cat "$BK/counts.txt"

rm -f scripts/prod-deploy.py src/lib/outreach/fsa-network.ts src/lib/outreach/fsa-proxy-shared.ts src/lib/outreach/smtp-transport.ts 2>/dev/null || true
rm -f scripts/outreach/fsa-proxy-shared.mjs scripts/outreach/test-fsa-access.ts scripts/outreach/test-fsa-access.mjs 2>/dev/null || true
git fetch origin main
git reset --hard origin/main
git pull --ff-only origin main

# content/ в git — после reset подменяем на пользовательские данные вне репозитория
rm -rf content
mkdir -p "$PERSIST/content"
cp -a "$BK/content/." "$PERSIST/content/"
ln -sfn "$PERSIST/content" content

cp -a "$BK/.env.local" .env.local
test -f "$BK/leads.json" && cp -a "$BK/leads.json" data/leads.json || true
if [ -d "$BK/data-snapshot" ]; then
  mkdir -p data
  for f in outreach-sent.json outreach-unsubscribed.json outreach-schedule.json fsa-token.json; do
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
        print(f"RESTORE_MISMATCH {name}", file=sys.stderr)
if not ok:
    sys.exit(1)
print("content restore OK")
PY

export NODE_OPTIONS=--max-old-space-size=1536
npm ci
npm run outreach:setup
npm run build

pm2 restart navicert --update-env
pm2 save

echo "OK: $(git log -1 --oneline)"
