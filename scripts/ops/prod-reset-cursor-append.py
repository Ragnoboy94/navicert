#!/usr/bin/env python3
"""Rotate FSA sort + reset page counter on prod, then test 2 append pages.
Does NOT touch content/, .env, or proxy."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
PWD = os.environ.get("DEPLOY_PASSWORD", "")
SORT_INDEX = int(os.environ.get("FSA_SORT_INDEX", "1"))  # 0=endDate, 1=registrationDate
APPEND_RUNS = int(os.environ.get("FSA_APPEND_RUNS", "2"))


REMOTE = r'''
import json, os, pathlib, re, urllib.request, urllib.error
from datetime import datetime, timezone

APP = "/var/www/navicert"
SORT_INDEX = __SORT_INDEX__
APPEND_RUNS = __APPEND_RUNS__
SORTS = ["endDate", "registrationDate", "number", "id"]

qpath = pathlib.Path(APP, "data", "outreach-queue.json")
q = json.loads(qpath.read_text(encoding="utf-8"))

# safety backup
bk_dir = pathlib.Path("/var/backups")
bk_dir.mkdir(parents=True, exist_ok=True)
stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
bk = bk_dir / f"outreach-queue-pre-cursor-{stamp}.json"
bk.write_text(json.dumps(q, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("backup", bk)

old = q.get("apiCursor") or {}
old_sort = old.get("sortIndex", 0)
old_page = old.get("page", q.get("nextApiPage", 0))
print("before cursor", old, "sort", SORTS[old_sort] if old_sort < 4 else "?", "page", old_page)
print("before items", len(q.get("items") or []), "enrich", len(q.get("enrichQueue") or []), "pv", q.get("paginationVersion"))

# rotate sort + reset page; enable v2 slice pagination
q["paginationVersion"] = 2
q["apiCursor"] = {"page": 0, "sortIndex": SORT_INDEX, "sliceIndex": 0}
q["nextApiPage"] = 0
q["hasMore"] = True
qpath.write_text(json.dumps(q, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("set cursor page=0 sort", SORTS[SORT_INDEX], "slice=0 paginationVersion=2")

# login
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
    m = re.search(r"(navicert_admin=[^;]+)", r.headers.get("Set-Cookie", ""))
    cookie = m.group(1) if m else ""

def append_once(n):
    req = urllib.request.Request(
        "http://127.0.0.1:3000/api/admin/outreach/scan",
        data=json.dumps({"mode": "append", "maxItems": 100, "pageSize": 100}).encode(),
        headers={"content-type": "application/json", "cookie": cookie},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            body = json.loads(r.read().decode())
            print(f"append_{n} OK", "loaded", body.get("loadedFromApi"), "addedNew", body.get("addedNew"),
                  "eligible", body.get("eligible"), "label", body.get("cursorLabel"))
            return True
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:400]
        print(f"append_{n} ERR", e.code, err)
        return False

for i in range(1, APPEND_RUNS + 1):
    if not append_once(i):
        break

q2 = json.loads(qpath.read_text(encoding="utf-8"))
c2 = q2.get("apiCursor") or {}
si = c2.get("sortIndex", 0)
print("after cursor", c2, "sort", SORTS[si] if si < 4 else "?", "items", len(q2.get("items") or []),
      "enrich", len(q2.get("enrichQueue") or []))

# proxy untouched check
proxy_line = [l for l in pathlib.Path(APP, ".env.local").read_text().splitlines() if l.startswith("OUTREACH_FSA_PROXY=")]
print("proxy", "set" if proxy_line and len(proxy_line[0]) > 20 else "MISSING")
'''


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    remote = REMOTE.replace("__SORT_INDEX__", str(SORT_INDEX)).replace(
        "__APPEND_RUNS__", str(APPEND_RUNS)
    )

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(f"python3 - <<'PY'\n{remote}\nPY", timeout=600)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
