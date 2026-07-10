#!/usr/bin/env python3
"""Read-only prod snapshot (no secrets printed)."""
from __future__ import annotations

import json
import os
import re
import sys

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
HOST = os.environ.get("DEPLOY_HOST", "89.22.238.194")
PWD = os.environ.get("DEPLOY_PASSWORD", "")


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PWD, timeout=30)

    def run(cmd: str) -> str:
        _, o, _ = c.exec_command(cmd, timeout=90)
        o.channel.recv_exit_status()
        return o.read().decode("utf-8", errors="replace").strip()

    print("HEAD:", run(f"cd {APP} && git log -1 --oneline"))
    proxy = run(f"grep '^OUTREACH_FSA_PROXY=' {APP}/.env.local || true")
    if proxy:
        proxy = re.sub(r":([^:@]+)@", ":***@", proxy)
    print("PROXY:", proxy or "NOT SET")
    print("TEST_MODE:", run(f"grep '^OUTREACH_TEST_MODE=' {APP}/.env.local || echo missing"))

    for name in (
        "outreach-queue.json",
        "outreach-sent.json",
        "leads.json",
        "fsa-token.json",
    ):
        size = run(f"test -f {APP}/data/{name} && wc -c < {APP}/data/{name} || echo 0")
        print(f"DATA {name}: {size} bytes")

    stats = run(
        f"""python3 - <<'PY'
import json, pathlib
p = pathlib.Path("{APP}/data/outreach-queue.json")
if not p.exists():
    print("missing")
else:
    q = json.loads(p.read_text(encoding="utf-8"))
    items = q.get("items") or []
    with_email = sum(1 for i in items if (i.get("applicant") or {{}}).get("email"))
    print(
        "items", len(items),
        "with_email", with_email,
        "enrich", len(q.get("enrichQueue") or []),
        "rejected", len(q.get("rejected") or []),
        "page", q.get("nextApiPage"),
        "cursor", q.get("apiCursor"),
    )
    if items:
        sample = items[0]
        print("sample_id", sample.get("id"), "email", bool((sample.get("applicant") or {{}}).get("email")))
PY"""
    )
    print("QUEUE:", stats)
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
