#!/usr/bin/env python3
"""Prod hotfix: image upload dirs, nginx body size, upload route files."""
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
HOST = os.environ.get("DEPLOY_HOST", "89.22.238.194")
USER = os.environ.get("DEPLOY_USER", "root")

FILES = [
    "src/lib/upload-paths.ts",
    "src/lib/serve-uploaded-image.ts",
    "src/app/images/[folder]/[...path]/route.ts",
    "src/app/api/admin/upload/route.ts",
]

SETUP = f"""
set -euo pipefail
cd {APP}
PERSIST=/var/www/navicert-persist
mkdir -p "$PERSIST/images/uploads" "$PERSIST/images/articles" public/images
for sub in uploads articles; do
  if [ -d "public/images/$sub" ] && [ ! -L "public/images/$sub" ]; then
    rsync -a "public/images/$sub/" "$PERSIST/images/$sub/" 2>/dev/null || true
    rm -rf "public/images/$sub"
  fi
  if [ ! -e "public/images/$sub" ]; then
    ln -sfn "$PERSIST/images/$sub" "public/images/$sub"
  fi
done
chmod -R u+rwX "$PERSIST/images"
ls -la public/images
ls -la "$PERSIST/images"

NGINX=/etc/nginx/sites-available/navicert
if [ -f "$NGINX" ] && ! grep -q 'client_max_body_size' "$NGINX"; then
  sed -i '/server_name /a\\    client_max_body_size 10m;' "$NGINX"
  nginx -t && systemctl reload nginx
  echo "nginx: client_max_body_size 10m added"
elif [ -f "$NGINX" ]; then
  echo "nginx: client_max_body_size already set"
fi

# quick write test as app user
TEST="$PERSIST/images/articles/.write-test"
touch "$TEST" && rm -f "$TEST" && echo "write test: ok"

npm run build
pm2 restart navicert --update-env
echo HOTFIX_UPLOAD_OK
"""


def load_password() -> str:
    pwd = os.environ.get("DEPLOY_PASSWORD", "").strip()
    if pwd:
        return pwd
    for name in (".env.local", ".env"):
        path = Path.cwd() / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("DEPLOY_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""


def main() -> int:
    pwd = load_password()
    if not pwd:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    root = Path.cwd()
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=pwd, timeout=30)
    sftp = c.open_sftp()

    for rel in FILES:
        local = root / rel
        if not local.exists():
            print(f"missing local file: {rel}", file=sys.stderr)
            return 1
        remote = f"{APP}/{rel.replace(chr(92), '/')}"
        remote_dir = os.path.dirname(remote)
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            parts = remote_dir.split("/")
            cur = ""
            for part in parts:
                if not part:
                    continue
                cur += f"/{part}"
                try:
                    sftp.stat(cur)
                except FileNotFoundError:
                    sftp.mkdir(cur)
        sftp.put(str(local), remote)
        print(f"uploaded {rel}")

    # remove old uploads-only route if present
    old_route = f"{APP}/src/app/images/uploads/[...path]/route.ts"
    try:
        sftp.remove(old_route)
        print("removed old uploads route")
    except FileNotFoundError:
        pass

    sftp.close()
    _, o, e = c.exec_command(SETUP, timeout=900)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
