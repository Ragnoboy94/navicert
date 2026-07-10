#!/usr/bin/env python3
"""Compare key outreach files: local working tree vs production server.

Usage:
  DEPLOY_PASSWORD=... python scripts/ops/compare-prod.py

Exit code 0 = all tracked files match (ignoring CRLF). Non-zero = drift found.
"""
from __future__ import annotations

import hashlib
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
PASSWORD = os.environ.get("DEPLOY_PASSWORD", "")
APP = "/var/www/navicert"
ROOT = Path(__file__).resolve().parents[2]

TRACKED = [
    "src/lib/outreach/fsa-network.ts",
    "src/lib/outreach/fsa-proxy-shared.ts",
    "src/lib/outreach/fsa.ts",
    "src/lib/outreach/bearer.ts",
    "src/lib/outreach/bulk-load.ts",
    "src/lib/outreach/enrich-runner.ts",
    "src/lib/outreach/mailer.ts",
    "src/lib/outreach/smtp-transport.ts",
    "scripts/outreach/fsa-proxy.mjs",
    "scripts/outreach/fsa-proxy-shared.mjs",
    "scripts/outreach/get-fsa-token.mjs",
    "scripts/outreach/refresh-fsa-proxy.mjs",
    "scripts/outreach/test-fsa-access.ts",
    "scripts/prod-deploy.py",
    "scripts/safe-deploy.sh",
    "package.json",
]


def norm_hash(data: bytes) -> str:
    text = data.replace(b"\r\n", b"\n")
    return hashlib.md5(text).hexdigest()


def main() -> int:
    if not PASSWORD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=30)

    _, o, _ = client.exec_command(f"cd {APP} && git log -1 --oneline", timeout=20)
    o.channel.recv_exit_status()
    print(f"prod HEAD: {o.read().decode().strip()}")

    drift: list[str] = []
    missing_local: list[str] = []
    missing_prod: list[str] = []

    sftp = client.open_sftp()
    for rel in TRACKED:
        local = ROOT / rel.replace("/", os.sep)
        if not local.exists():
            missing_local.append(rel)
            continue
        remote = f"{APP}/{rel}"
        try:
            with sftp.file(remote, "r") as f:
                prod_bytes = f.read()
        except OSError:
            missing_prod.append(rel)
            continue
        loc_bytes = local.read_bytes()
        if norm_hash(loc_bytes) != norm_hash(prod_bytes):
            drift.append(rel)

    sftp.close()
    client.close()

    if missing_local:
        print("\nMissing locally:")
        for p in missing_local:
            print(f"  - {p}")
    if missing_prod:
        print("\nMissing on prod:")
        for p in missing_prod:
            print(f"  - {p}")
    if drift:
        print(f"\nDrift ({len(drift)} files) — deploy or pull from prod:")
        for p in drift:
            print(f"  - {p}")
        return 2

    print("\nOK: tracked outreach/deploy files match prod (normalized line endings).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
