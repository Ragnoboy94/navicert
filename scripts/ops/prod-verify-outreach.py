#!/usr/bin/env python3
"""Post-deploy: FSA append scan + one manual send via admin API."""
from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
HOST = os.environ.get("DEPLOY_HOST", "89.22.238.194")
PWD = os.environ.get("DEPLOY_PASSWORD", "")
SITE = os.environ.get("VERIFY_SITE_URL", "http://127.0.0.1:3000")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")


def http_json(method: str, url: str, body: dict | None = None, headers: dict | None = None):
    data = None
    hdrs = {"content-type": "application/json", **(headers or {})}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"error": raw[:300]}
        return e.code, payload


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=PWD, timeout=30)

    def run(cmd: str) -> str:
        _, o, e = c.exec_command(cmd, timeout=180)
        code = o.channel.recv_exit_status()
        out = o.read().decode("utf-8", errors="replace")
        err = e.read().decode("utf-8", errors="replace")
        if code != 0:
            print(err or out, file=sys.stderr)
        return out.strip()

    print("=== proxy check ===")
    refresh = run(f"cd {APP} && OUTREACH_ENV_FILE={APP}/.env.local node scripts/outreach/refresh-fsa-proxy.mjs")
    print(refresh)
    proxy = run(f"grep '^OUTREACH_FSA_PROXY=' {APP}/.env.local || true")
    print("PROXY:", re.sub(r":([^:@]+)@", ":***@", proxy))

    print("\n=== FSA via proxy (curl) ===")
    fsa_code = run(
        f'''bash -lc 'set -a; source {APP}/.env.local; set +a; PROXY="$OUTREACH_FSA_PROXY"; curl -s -o /dev/null -w "%{{http_code}}" -x "$PROXY" --max-time 45 https://pub.fsa.gov.ru/rds/declaration || echo fail' '''
    )
    print("FSA HTTP:", fsa_code)

    print("\n=== admin login (localhost) ===")
    cookie = run(
        f"""bash -lc 'set -a; source {APP}/.env.local; set +a; python3 - <<'"'"'PY'"'"'
import json, urllib.request, re, os
pwd = os.environ.get("ADMIN_PASSWORD", "")
req = urllib.request.Request(
    "http://127.0.0.1:3000/api/admin/login",
    data=json.dumps({{"password": pwd}}).encode(),
    headers={{"content-type": "application/json"}},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
    cookie = r.headers.get("Set-Cookie", "")
m = re.search(r"navicert_admin=([^;]+)", cookie)
print(f"navicert_admin={{m.group(1)}}" if m else "")
PY'"""
    )
    if not cookie:
        print("no admin cookie", file=sys.stderr)
        c.close()
        return 1

    print("\n=== FSA append scan ===")
    scan = run(
        f"""python3 - <<'PY'
import json, urllib.request
cookie = {json.dumps(cookie)}
req = urllib.request.Request(
    "http://127.0.0.1:3000/api/admin/outreach/scan",
    data=json.dumps({{"mode": "append", "maxItems": 30, "pageSize": 100}}).encode(),
    headers={{"content-type": "application/json", "cookie": cookie}},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        print(r.status, r.read().decode()[:500])
except Exception as e:
    if hasattr(e, "read"):
        print("ERR", e.code, e.read().decode()[:500])
    else:
        print("ERR", e)
PY"""
    )
    print(scan)

    print("\n=== pick sendable item ===")
    pick = run(
        f"""python3 - <<'PY'
import json, pathlib, re
from datetime import datetime, timezone, timedelta
APP = "{APP}"
q = json.loads(pathlib.Path(APP, "data", "outreach-queue.json").read_text(encoding="utf-8"))
sent = []
sp = pathlib.Path(APP, "data", "outreach-sent.json")
if sp.exists():
    sent = json.loads(sp.read_text(encoding="utf-8"))
sent_emails = {{(r.get("originalRecipient") or "").lower() for r in sent}}
corp = re.compile(r"@(?!mail\\.ru|yandex\\.ru|gmail\\.com|bk\\.ru|list\\.ru|inbox\\.ru)", re.I)

def ok_email(item):
    email = ((item.get("applicant") or {{}}).get("email") or "").strip().lower()
    if not email or email in sent_emails:
        return False
    return bool(corp.search(email))

for item in q.get("items") or []:
    if ok_email(item):
        print(item["id"])
        break
else:
    print("NONE")
PY"""
    )
    pick_id = pick.strip().splitlines()[-1] if pick else "NONE"
    print("pick_id:", pick_id)
    if pick_id == "NONE" or not pick_id.isdigit():
        print("No sendable item in queue", file=sys.stderr)
        c.close()
        return 1

    print("\n=== send one email (manual) ===")
    send = run(
        f"""python3 - <<'PY'
import json, urllib.request
cookie = {json.dumps(cookie)}
item_id = {pick_id}
req = urllib.request.Request(
    "http://127.0.0.1:3000/api/admin/outreach/send",
    data=json.dumps({{"ids": [item_id], "manual": True, "force": True}}).encode(),
    headers={{"content-type": "application/json", "cookie": cookie}},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        print(r.status, r.read().decode()[:800])
except Exception as e:
    if hasattr(e, "read"):
        print("ERR", e.code, e.read().decode()[:800])
    else:
        print("ERR", e)
PY"""
    )
    print(send)
    c.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
