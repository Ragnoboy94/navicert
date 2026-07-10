#!/usr/bin/env python3
"""One-time: move content/ outside git repo via symlink."""
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

SCRIPT = f"""
set -euo pipefail
cd {APP}
PERSIST=/var/www/navicert-persist
mkdir -p "$PERSIST/content"
if [ -L content ]; then
  echo "already symlink:" "$(readlink content)"
elif [ -d content ]; then
  rsync -a content/ "$PERSIST/content/"
  rm -rf content
  ln -sfn "$PERSIST/content" content
  echo "migrated to $PERSIST/content"
else
  echo "no content dir"; exit 1
fi
python3 - <<'PY'
import json, pathlib
p = pathlib.Path("content")
for n in ("services.json", "categories.json", "site.json"):
    d = json.loads((p / n).read_text(encoding="utf-8"))
    print(n, len(d) if isinstance(d, list) else 1)
PY
"""


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(SCRIPT, timeout=90)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
