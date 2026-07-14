#!/usr/bin/env python3
"""Upload outreach/deploy fixes to prod and rebuild (no git pull, preserves data)."""
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
    "src/lib/outreach/fsa-network.ts",
    "src/lib/outreach/fsa-proxy-shared.ts",
    "scripts/outreach/fsa-proxy.mjs",
    "scripts/outreach/fsa-proxy-shared.mjs",
    "scripts/outreach/test-fsa-access.ts",
    "scripts/prod-deploy.py",
    "scripts/safe-deploy.sh",
    "package.json",
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
        local = ROOT / rel.replace("/", os.sep)
        remote = f"{APP}/{rel}"
        sftp.put(str(local), remote)
        print(f"uploaded {rel}")
    try:
        sftp.remove(f"{APP}/scripts/outreach/test-fsa-access.mjs")
        print("removed scripts/outreach/test-fsa-access.mjs")
    except OSError:
        pass
    sftp.close()

    cmd = (
        f"cd {APP} && export NODE_OPTIONS=--max-old-space-size=1536 && "
        f"npm run build && pm2 restart navicert --update-env"
    )
    print("\n> build + restart")
    _, o, e = c.exec_command(cmd, timeout=600)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
