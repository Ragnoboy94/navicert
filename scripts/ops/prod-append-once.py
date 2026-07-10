#!/usr/bin/env python3
"""Single append with 180s timeout."""
from __future__ import annotations

import os, sys
try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
PWD = os.environ.get("DEPLOY_PASSWORD", "")

script = r'''
import json, pathlib, urllib.request, re, os
APP = "/var/www/navicert"
qpath = pathlib.Path(APP, "data", "outreach-queue.json")
q = json.loads(qpath.read_text(encoding="utf-8"))
print("before page", q.get("nextApiPage"), "pv", q.get("paginationVersion"), "items", len(q.get("items",[])), "enrich", len(q.get("enrichQueue",[])))

req = urllib.request.Request("http://127.0.0.1:3000/api/admin/login",
    data=json.dumps({"password": os.environ["ADMIN_PASSWORD"]}).encode(),
    headers={"content-type": "application/json"}, method="POST")
with urllib.request.urlopen(req, timeout=30) as r:
    m = re.search(r"(navicert_admin=[^;]+)", r.headers.get("Set-Cookie",""))
    cookie = m.group(1)

req = urllib.request.Request(
    "http://127.0.0.1:3000/api/admin/outreach/scan",
    data=json.dumps({"mode":"append","maxItems":100,"pageSize":100}).encode(),
    headers={"content-type":"application/json","cookie":cookie}, method="POST")
with urllib.request.urlopen(req, timeout=300) as r:
    res = json.loads(r.read().decode())
    print("status", r.status, "loaded", res.get("loadedFromApi"), "addedNew", res.get("addedNew"),
          "eligible", res.get("eligible"), "label", res.get("cursorLabel"))

q2 = json.loads(qpath.read_text(encoding="utf-8"))
print("after page", q2.get("nextApiPage"), "pv", q2.get("paginationVersion"), "items", len(q2.get("items",[])), "enrich", len(q2.get("enrichQueue",[])))
'''

def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    cmd = f"bash -lc 'set -a; source {APP}/.env.local; set +a; python3 - <<\"PY\"\n{script}\nPY'"
    _, o, e = c.exec_command(cmd, timeout=240)
    o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()

if __name__ == "__main__":
    if not PWD:
        sys.exit("no password")
    main()
