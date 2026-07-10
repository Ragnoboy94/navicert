#!/usr/bin/env python3
"""Test consecutive FSA append loads on prod."""
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

REMOTE = r'''
import json, pathlib, urllib.request, re

APP = "/var/www/navicert"
qpath = pathlib.Path(APP, "data", "outreach-queue.json")

def load_ids(q):
    ids = set()
    for key in ("items", "rejected", "enrichQueue"):
        for it in q.get(key) or []:
            if it.get("id") is not None:
                ids.add(it["id"])
    return ids

q = json.loads(qpath.read_text(encoding="utf-8"))
ids0 = load_ids(q)
print("QUEUE_SUMMARY")
print("items", len(q.get("items") or []))
print("rejected", len(q.get("rejected") or []))
print("enrich", len(q.get("enrichQueue") or []))
print("unique_ids", len(ids0))
print("nextApiPage", q.get("nextApiPage"))
print("apiCursor", json.dumps(q.get("apiCursor"), ensure_ascii=False))
print("paginationVersion", q.get("paginationVersion"))
print("hasMore", q.get("hasMore"))

env = {}
for line in pathlib.Path(APP, ".env.local").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"')

req = urllib.request.Request(
    "http://127.0.0.1:3000/api/admin/login",
    data=json.dumps({"password": env.get("ADMIN_PASSWORD", "")}).encode(),
    headers={"content-type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
    sc = r.headers.get("Set-Cookie", "")
m = re.search(r"navicert_admin=([^;]+)", sc)
cookie = f"navicert_admin={m.group(1)}" if m else ""

def scan(max_items=100):
    req = urllib.request.Request(
        "http://127.0.0.1:3000/api/admin/outreach/scan",
        data=json.dumps({"mode": "append", "maxItems": max_items, "pageSize": 100}).encode(),
        headers={"content-type": "application/json", "cookie": cookie},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

prev_ids = ids0
for i in range(1, 4):
    print(f"\nAPPEND_{i}")
    status, body = scan(100)
    keys = ("loadedFromApi", "addedNew", "hasMore", "nextApiPage", "apiCursor", "cursorLabel", "error")
    print("status", status)
    print(json.dumps({k: body.get(k) for k in keys}, ensure_ascii=False))
    q = json.loads(qpath.read_text(encoding="utf-8"))
    ids = load_ids(q)
    print("unique_ids", len(ids), "delta", len(ids) - len(prev_ids))
    prev_ids = ids
'''


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(f"python3 - <<'PY'\n{REMOTE}\nPY", timeout=420)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
