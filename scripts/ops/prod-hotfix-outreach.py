#!/usr/bin/env python3
"""Hotfix: upload outreach files, rebuild, restart (no env/data changes)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
PWD = os.environ.get("DEPLOY_PASSWORD", "")
ROOT = Path(__file__).resolve().parents[2]

FILES = [
    "src/lib/outreach/bulk-load.ts",
    "src/lib/outreach/fsa-pagination.ts",
    "src/app/api/admin/outreach/scan/route.ts",
]


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)

    sftp = c.open_sftp()
    for rel in FILES:
        sftp.put(str(ROOT / rel.replace("/", os.sep)), f"{APP}/{rel}")
        print(f"uploaded {rel}")
    sftp.close()

    cmd = (
        f"cd {APP} && export NODE_OPTIONS=--max-old-space-size=1536 && "
        f"npm run build && pm2 restart navicert --update-env && "
        f"OUTREACH_ENV_FILE={APP}/.env.local node scripts/outreach/refresh-fsa-proxy.mjs"
    )
    _, o, e = c.exec_command(cmd, timeout=600)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
