#!/usr/bin/env python3
"""Restore content + rebuild site (no git, no data loss)."""
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
test -d "$BK/content" || {{ echo "no content in $BK"; exit 1; }}

SAF="/var/backups/navicert-pre-restore-$(date -u +%Y%m%d-%H%M%S)"
mkdir -p "$SAF" && cp -a "$APP/content" "$SAF/" && echo "safety $SAF"

cp -a "$BK/content/." "$APP/content/"
test -f "$BK/leads.json" && cp -a "$BK/leads.json" "$APP/data/leads.json" || true
test -d "$BK/uploads" && mkdir -p "$APP/public/images/uploads" && cp -a "$BK/uploads/." "$APP/public/images/uploads/" || true

python3 - <<'PY'
import json, pathlib
app = pathlib.Path("{APP}/content")
for name in ("services.json", "categories.json", "site.json"):
    p = app / name
    data = json.loads(p.read_text(encoding="utf-8"))
    print(name, len(data) if isinstance(data, list) else 1, p.stat().st_size)
PY

cd "$APP"
export NODE_OPTIONS=--max-old-space-size=1536
npm run build
pm2 restart navicert --update-env
echo RESTORE_REBUILD_OK
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
