#!/usr/bin/env python3
"""Clear only new_registrations sent history on prod."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

HOST = os.environ.get("DEPLOY_HOST", "89.22.238.194")
USER = os.environ.get("DEPLOY_USER", "root")
APP = "/var/www/navicert"
SENT = f"{APP}/data/outreach-new-registrations-sent.json"


def load_password() -> str:
    pwd = os.environ.get("DEPLOY_PASSWORD", "").strip()
    if pwd:
        return pwd
    for name in (".env.local", ".env"):
        path = Path(name)
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("DEPLOY_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def main() -> int:
    password = load_password()
    if not password:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=30)

    def run(cmd: str) -> str:
        _, stdout, stderr = client.exec_command(cmd, timeout=60)
        code = stdout.channel.recv_exit_status()
        out = stdout.read().decode("utf-8", "replace")
        err = stderr.read().decode("utf-8", "replace")
        if out:
            print(out, end="" if out.endswith("\n") else "\n")
        if err.strip():
            print(err, end="" if err.endswith("\n") else "\n")
        if code != 0:
            raise RuntimeError(f"exit {code}: {cmd}")
        return out

    remote = f"""
set -euo pipefail
P='{SENT}'
if [ -f "$P" ]; then
  cp -a "$P" "$P.bak-$(date -u +%Y%m%d-%H%M%S)"
fi
python3 - <<'PY'
import json, pathlib
p = pathlib.Path("{SENT}")
print("before", len(json.loads(p.read_text(encoding="utf-8"))) if p.exists() else 0)
p.write_text("[]\\n", encoding="utf-8")
print("after", len(json.loads(p.read_text(encoding="utf-8"))))
print("path", p)
PY
"""
    run(remote)
    client.close()
    print("OK: cleared new_registrations sent only")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
