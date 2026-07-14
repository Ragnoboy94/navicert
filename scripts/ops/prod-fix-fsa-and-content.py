#!/usr/bin/env python3
"""Fix prod: CONTENT_DIR, remove content symlink, rebuild, verify FSA append."""
from __future__ import annotations

import os
import re
import sys

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
PERSIST = "/var/www/navicert-persist/content"
PWD = os.environ.get("DEPLOY_PASSWORD", "")
ROOT = os.path.join(os.path.dirname(__file__), "..", "..")


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)

    # upload content.ts
    sftp = c.open_sftp()
    sftp.put(
        os.path.join(ROOT, "src", "lib", "content.ts"),
        f"{APP}/src/lib/content.ts",
    )
    sftp.close()
    print("uploaded content.ts")

    script = f"""
set -euo pipefail
cd {APP}
PERSIST="{PERSIST}"
ENV_FILE="{APP}/.env.local"

mkdir -p "$PERSIST"

# CONTENT_DIR in .env.local (prod user content outside repo)
if grep -q '^CONTENT_DIR=' "$ENV_FILE"; then
  sed -i 's|^CONTENT_DIR=.*|CONTENT_DIR={PERSIST}|' "$ENV_FILE"
else
  echo 'CONTENT_DIR={PERSIST}' >> "$ENV_FILE"
fi

# If content is symlink — save user files, restore real dir for Turbopack build
if [ -L content ]; then
  rsync -a "$(readlink -f content)/" "$PERSIST/"
  rm content
fi
if [ ! -d content ]; then
  git checkout HEAD -- content/ 2>/dev/null || git restore content/ 2>/dev/null || true
fi
mkdir -p content
rsync -a "$PERSIST/" content/

# FSA: на проде обязателен купленный OUTREACH_FSA_PROXY в .env.local (не трогаем).
grep -E '^OUTREACH_FSA_PROXY=.+' "$ENV_FILE" >/dev/null && echo 'FSA proxy: set' || echo 'WARNING: FSA proxy missing'

export NODE_OPTIONS=--max-old-space-size=1536
npm run build
pm2 restart navicert --update-env

python3 - <<'PY'
import json, pathlib, re, urllib.request, os

APP = pathlib.Path("{APP}")
qpath = APP / "data" / "outreach-queue.json"
q = json.loads(qpath.read_text(encoding="utf-8"))
c = q.get("apiCursor") or {{}}
# stuck at page 20 endDate → rotate sort
if c.get("page", 0) >= 20 and c.get("sortIndex", 0) == 0:
    q["paginationVersion"] = 2
    q["apiCursor"] = {{"page": 0, "sortIndex": 1, "sliceIndex": 0}}
    q["nextApiPage"] = 0
    q["hasMore"] = True
    qpath.write_text(json.dumps(q, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
    print("cursor reset to registrationDate page 0")

env = {{}}
for line in (APP / ".env.local").read_text().splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"')

req = urllib.request.Request(
    "http://127.0.0.1:3000/api/admin/login",
    data=json.dumps({{"password": env.get("ADMIN_PASSWORD", "")}}).encode(),
    headers={{"content-type": "application/json"}},
    method="POST",
)
with urllib.request.urlopen(req, timeout=30) as r:
    m = re.search(r"(navicert_admin=[^;]+)", r.headers.get("Set-Cookie", ""))
    cookie = m.group(1) if m else ""

req = urllib.request.Request(
    "http://127.0.0.1:3000/api/admin/outreach/scan",
    data=json.dumps({{"mode": "append", "maxItems": 50, "pageSize": 100}}).encode(),
    headers={{"content-type": "application/json", "cookie": cookie}},
    method="POST",
)
with urllib.request.urlopen(req, timeout=300) as r:
    body = json.loads(r.read().decode())
    print("append", r.status, "loaded", body.get("loadedFromApi"), "addedNew", body.get("addedNew"), body.get("cursorLabel"))

for n in ("services.json", "categories.json"):
    p = pathlib.Path(os.environ.get("CONTENT_DIR", "{PERSIST}")) / n
    d = json.loads(p.read_text(encoding="utf-8"))
    print("content", n, len(d))
PY
echo FIX_OK
"""

    _, o, e = c.exec_command(script, timeout=900)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
