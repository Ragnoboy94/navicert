#!/usr/bin/env python3
"""Deep search for lost article data on prod."""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

PWD = os.environ.get("DEPLOY_PASSWORD", "")

SCRIPT = r"""
import json, pathlib, subprocess, re

print("=== article images ===")
for d in [
    "/var/www/navicert-persist/images/articles",
    "/var/www/navicert/public/images/articles",
]:
    p = pathlib.Path(d)
    if p.exists():
        for f in sorted(p.iterdir()):
            if f.is_file():
                print(f, f.stat().st_size)

print("\n=== grep novaya / slug in /var/www ===")
subprocess.run(
    ["grep", "-r", "-l", "novaya-statya", "/var/www/navicert", "/var/www/navicert-persist"],
    capture_output=True,
)
# manual find json with title/slug keys
hits = []
for root in ["/var/www/navicert", "/var/www/navicert-persist", "/var/backups"]:
    for p in pathlib.Path(root).rglob("*.json"):
        if p.stat().st_size > 50 and p.stat().st_size < 5_000_000:
            try:
                t = p.read_text(encoding="utf-8")
            except Exception:
                continue
            if "novaya-statya" in t or ("slug" in t and "title" in t and "articles" in str(p)):
                hits.append((str(p), t[:200]))
            elif re.search(r'"slug"\s*:\s*"[^"]+"', t) and "draft" in t and "publishedAt" in t:
                hits.append((str(p), t[:200]))
for path, preview in hits[:20]:
    print("HIT", path)
    print(preview[:180].replace("\n", " "))
    print()

print("\n=== CONTENT_DIR ===")
env = pathlib.Path("/var/www/navicert/.env.local").read_text(encoding="utf-8")
for line in env.splitlines():
    if line.startswith("CONTENT_DIR"):
        print(line)

print("\n=== git objects articles ===")
subprocess.run("cd /var/www/navicert && git log -5 --oneline -- content/articles.json 2>/dev/null", shell=True)
subprocess.run("cd /var/www/navicert && git show HEAD:content/articles.json 2>/dev/null | head -c 500", shell=True)

print("\n=== find any articles.json non-empty ===")
for p in pathlib.Path("/var").rglob("articles.json"):
    try:
        if p.stat().st_size > 5:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, list) and len(data) > 0:
                print("FOUND", p, len(data), [a.get("slug") for a in data if isinstance(a, dict)][:5])
    except Exception:
        pass
"""


def main() -> int:
    if not PWD:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=PWD, timeout=30)
    _, o, e = c.exec_command(f"python3 - <<'PY'\n{SCRIPT}\nPY", timeout=300)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
