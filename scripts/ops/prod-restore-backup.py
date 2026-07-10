#!/usr/bin/env python3
"""Restore user content from a specific backup (default: richest site.json backup)."""
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
BK = os.environ.get(
    "RESTORE_BACKUP", "/var/backups/navicert-20260709-144840"
)


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    script = f"""
set -euo pipefail
APP="{APP}"
BK="{BK}"
test -d "$BK" || {{ echo "backup missing: $BK"; exit 1; }}

echo "Restoring from $BK"

# Safety copy current state
SAF="/var/backups/navicert-pre-restore-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$SAF"
cp -a "$APP/content" "$SAF/"
cp -a "$APP/data/leads.json" "$SAF/" 2>/dev/null || true
test -f "$APP/data/outreach-schedule.json" && cp -a "$APP/data/outreach-schedule.json" "$SAF/" || true
echo "safety: $SAF"

# Restore friend-edited content
cp -a "$BK/content/." "$APP/content/"
test -f "$BK/leads.json" && cp -a "$BK/leads.json" "$APP/data/leads.json" || true
test -f "$BK/data-snapshot/outreach-schedule.json" && cp -a "$BK/data-snapshot/outreach-schedule.json" "$APP/data/outreach-schedule.json" || true

# Optional: restore outreach queue if RESTORE_QUEUE=1
if [ "${{RESTORE_QUEUE:-0}}" = "1" ] && [ -f "$BK/data-snapshot/outreach-queue.json" ]; then
  cp -a "$BK/data-snapshot/outreach-queue.json" "$APP/data/outreach-queue.json"
  echo "outreach-queue restored"
fi

python3 - <<'PY'
import json, pathlib
app = pathlib.Path("{APP}")
for name in ("services.json", "categories.json", "site.json"):
    p = app / "content" / name
    data = json.loads(p.read_text(encoding="utf-8"))
    n = len(data) if isinstance(data, list) else 1
    print(name, n, p.stat().st_size)
leads = app / "data" / "leads.json"
if leads.exists():
    L = json.loads(leads.read_text(encoding="utf-8"))
    print("leads", len(L) if isinstance(L, list) else "?")
PY

pm2 restart navicert --update-env
echo "RESTORE_OK from $BK"
"""

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(script, timeout=120)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
