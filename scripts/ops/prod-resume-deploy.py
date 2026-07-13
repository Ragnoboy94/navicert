#!/usr/bin/env python3
"""Resume failed prod deploy: pull, restore backup data, build, restart."""
from __future__ import annotations

import os
import sys

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
PWD = os.environ.get("DEPLOY_PASSWORD", "")
BK = os.environ.get("DEPLOY_BACKUP", "/var/backups/navicert-20260710-081159")


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    script = f"""
set -euo pipefail
cd {APP}
BK="{BK}"
test -d "$BK" || {{ echo "backup missing: $BK"; exit 1; }}

rm -f scripts/outreach/fsa-proxy-shared.mjs scripts/outreach/test-fsa-access.ts scripts/outreach/test-fsa-access.mjs 2>/dev/null || true
git fetch origin main
git reset --hard origin/main

cp -a "$BK/.env.local" .env.local
cp -a "$BK/content/." content/
test -f "$BK/leads.json" && cp -a "$BK/leads.json" data/leads.json || true
if [ -d "$BK/data-snapshot" ]; then
  mkdir -p data
  for f in outreach-sent.json outreach-unsubscribed.json outreach-schedule.json outreach-queue.json fsa-token.json; do
    test -f "$BK/data-snapshot/$f" && cp -a "$BK/data-snapshot/$f" "data/$f" || true
  done
fi
if [ -d "$BK/uploads" ]; then
  mkdir -p public/images/uploads
  cp -a "$BK/uploads/." public/images/uploads/
fi

export NODE_OPTIONS=--max-old-space-size=1536
npm ci
npm run outreach:setup
npm run build
pm2 restart navicert --update-env
pm2 save

echo "RESUME_OK $(git log -1 --oneline)"
grep -E '^OUTREACH_FSA_PROXY=.+' .env.local >/dev/null && echo 'FSA proxy: set' || echo 'WARNING: FSA proxy missing'
OUTREACH_ENV_FILE={APP}/.env.local node scripts/outreach/refresh-fsa-proxy.mjs || true
"""

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(script, timeout=900)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
