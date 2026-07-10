#!/usr/bin/env python3
"""Compare deploy backup vs live files (content, data, uploads)."""
from __future__ import annotations

import hashlib
import os
import sys

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

APP = "/var/www/navicert"
PWD = os.environ.get("DEPLOY_PASSWORD", "")
BK = os.environ.get("DEPLOY_BACKUP", "/var/backups/navicert-20260710-093656")


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)

    script = f"""
import hashlib, json, pathlib, os

APP = "{APP}"
BK = "{BK}"

def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

pairs = [
    ("content/services.json", f"{{BK}}/content/services.json", f"{{APP}}/content/services.json"),
    ("content/categories.json", f"{{BK}}/content/categories.json", f"{{APP}}/content/categories.json"),
    ("content/site.json", f"{{BK}}/content/site.json", f"{{APP}}/content/site.json"),
    ("data/leads.json", f"{{BK}}/leads.json", f"{{APP}}/data/leads.json"),
    ("outreach-queue", f"{{BK}}/data-snapshot/outreach-queue.json", f"{{APP}}/data/outreach-queue.json"),
    ("outreach-sent", f"{{BK}}/data-snapshot/outreach-sent.json", f"{{APP}}/data/outreach-sent.json"),
]

print("BACKUP", BK)
for label, bp, np in pairs:
    be = pathlib.Path(bp).exists()
    ne = pathlib.Path(np).exists()
    if not be and not ne:
        print(label, "both missing")
        continue
    if not be:
        print(label, "MISSING_IN_BACKUP", np)
        continue
    if not ne:
        print(label, "MISSING_NOW", bp)
        continue
    bm, nm = md5(bp), md5(np)
    same = bm == nm
    print(label, "OK" if same else "DIFF", f"backup={{pathlib.Path(bp).stat().st_size}} now={{pathlib.Path(np).stat().st_size}}")

# leads detail
lp = pathlib.Path(APP) / "data" / "leads.json"
bp = pathlib.Path(BK) / "leads.json"
if lp.exists() and bp.exists():
    l = json.loads(lp.read_text(encoding="utf-8"))
    b = json.loads(bp.read_text(encoding="utf-8"))
    print("leads_count backup", len(b) if isinstance(b, list) else "?", "now", len(l) if isinstance(l, list) else "?")

# list backups
print("\\nRECENT_BACKUPS")
for p in sorted(pathlib.Path("/var/backups").glob("navicert-*"))[-5:]:
    print(p.name, p.stat().st_size)
"""

    _, o, e = c.exec_command(f"python3 - <<'PY'\n{script}\nPY", timeout=120)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
