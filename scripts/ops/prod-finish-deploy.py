#!/usr/bin/env python3
"""Finish failed deploy: fix content dir + build + restart."""
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
PWD = os.environ.get("DEPLOY_PASSWORD", "")

CMD = f"""
set -euo pipefail
cd {APP}
PERSIST=/var/www/navicert-persist/content
rm -rf content
mkdir -p content
rsync -a "$PERSIST/" content/
python3 -c "import json, pathlib; p=pathlib.Path('$PERSIST/articles.json'); d=json.loads(p.read_text()); print('articles', len(d))"
export NODE_OPTIONS=--max-old-space-size=1536
npm run build
pm2 restart navicert --update-env
echo FINISH_OK
"""


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(CMD, timeout=600)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
