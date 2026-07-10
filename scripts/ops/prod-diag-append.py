#!/usr/bin/env python3
"""Diagnose append scan failure on prod."""
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


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)

    script = r'''
import json, pathlib, urllib.request, re, os, traceback

APP = "/var/www/navicert"
qpath = pathlib.Path(APP, "data", "outreach-queue.json")

def section(title):
    print("\n=== " + title + " ===")

section("queue")
if qpath.exists():
    q = json.loads(qpath.read_text(encoding="utf-8"))
    print("paginationVersion", q.get("paginationVersion"))
    print("nextApiPage", q.get("nextApiPage"), "apiCursor", q.get("apiCursor"))
    print("hasMore", q.get("hasMore"), "range", q.get("range"))
    print("items", len(q.get("items",[])), "enrich", len(q.get("enrichQueue",[])), "rejected", len(q.get("rejected",[])))
else:
    print("missing queue")

section("proxy + token")
tp = pathlib.Path(APP, "data", "fsa-token.json")
if tp.exists():
    t = json.loads(tp.read_text())
    print("token expiresAt", t.get("expiresAt"))
else:
    print("no token file")

section("login")
try:
    req = urllib.request.Request(
        "http://127.0.0.1:3000/api/admin/login",
        data=json.dumps({"password": os.environ["ADMIN_PASSWORD"]}).encode(),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        m = re.search(r"(navicert_admin=[^;]+)", r.headers.get("Set-Cookie", ""))
        cookie = m.group(1) if m else ""
    print("login ok", bool(cookie))
except Exception as e:
    print("login fail", e)
    raise SystemExit(1)

section("append scan")
try:
    req = urllib.request.Request(
        "http://127.0.0.1:3000/api/admin/outreach/scan",
        data=json.dumps({"mode": "append", "maxItems": 100, "pageSize": 100}).encode(),
        headers={"content-type": "application/json", "cookie": cookie},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        body = r.read().decode()
        print("status", r.status)
        print("body", body[:1200])
except Exception as e:
    print("append fail type", type(e).__name__)
    if hasattr(e, "code"):
        print("http", e.code)
    if hasattr(e, "read"):
        print("body", e.read().decode()[:1200])
    else:
        print("err", e)

section("pm2 logs")
'''

    py = script
    cmd = (
        f"bash -lc 'set -a; source {APP}/.env.local; set +a; python3 - <<\"PY\"\n{py}\nPY\n"
        f"pm2 logs navicert --lines 40 --nostream 2>&1 | grep -iE \"scan|fsa|bulk|append|error|401|500|timeout|page\" | tail -25'"
    )
    _, o, e = c.exec_command(cmd, timeout=240)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
