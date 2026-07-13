#!/usr/bin/env python3
"""Emergency: find and restore articles.json from deploy backups."""
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
PERSIST = "/var/www/navicert-persist/content"
HOST = os.environ.get("DEPLOY_HOST", "89.22.238.194")


def load_password() -> str:
    pwd = os.environ.get("DEPLOY_PASSWORD", "").strip()
    if pwd:
        return pwd
    for name in (".env.local", ".env"):
        path = Path.cwd() / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("DEPLOY_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"')
    return ""


SCRIPT = r"""
import json, pathlib, shutil, subprocess
from datetime import datetime

APP = "/var/www/navicert"
PERSIST = "/var/www/navicert-persist/content"
BACKUPS = sorted(pathlib.Path("/var/backups").glob("navicert-*"))

def load_articles(path):
    p = pathlib.Path(path)
    if not p.exists():
        return None, "missing"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        return None, f"parse error: {e}"
    if not isinstance(data, list):
        return None, "not a list"
    return data, f"{len(data)} articles"

print("=== SCAN BACKUPS ===")
best = None
best_path = None
best_count = 0

for bk in reversed(BACKUPS):
  for rel in (
      bk / "content" / "articles.json",
      pathlib.Path(PERSIST) / "articles.json",
  ):
    if not rel.exists() and bk != pathlib.Path(PERSIST):
      rel = bk / "content" / "articles.json"
    candidates = [
        bk / "content" / "articles.json",
    ]
    break
  cand = bk / "content" / "articles.json"
  data, info = load_articles(cand)
  print(bk.name, str(cand), info)
  if data and len(data) > best_count:
    best = data
    best_path = cand
    best_count = len(data)

# also check pre-restore snapshots
for p in sorted(pathlib.Path("/var/backups").glob("navicert-pre-*")):
  cand = p / "content" / "articles.json"
  data, info = load_articles(cand)
  print(p.name, info)
  if data and len(data) > best_count:
    best = data
    best_path = cand
    best_count = len(data)

print("\n=== CURRENT ===")
for label, path in [
    ("persist", pathlib.Path(PERSIST) / "articles.json"),
    ("app content", pathlib.Path(APP) / "content" / "articles.json"),
]:
  data, info = load_articles(path)
  print(label, path, info)
  if data:
    for a in data[:5]:
      if isinstance(a, dict):
        print(" ", a.get("slug"), a.get("title", "")[:50], "draft=", a.get("draft"))

print("\n=== BEST BACKUP ===", best_path, "count=", best_count)
if not best or best_count == 0:
  print("NO_ARTICLES_FOUND")
  raise SystemExit(2)

# safety snapshot before restore
snap = pathlib.Path("/var/backups") / f"navicert-pre-articles-restore-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
snap.mkdir(parents=True)
for src in [
    pathlib.Path(PERSIST) / "articles.json",
    pathlib.Path(APP) / "content" / "articles.json",
]:
  if src.exists():
    dst = snap / src.name if src.parent.name != "content" else snap / "content" / "articles.json"
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)

# restore
pathlib.Path(PERSIST).mkdir(parents=True, exist_ok=True)
out = pathlib.Path(PERSIST) / "articles.json"
out.write_text(json.dumps(best, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("restored to", out)

# sync to app content if symlink or copy
app_content = pathlib.Path(APP) / "content"
if app_content.is_symlink():
  pass  # persist is source of truth
else:
  app_content.mkdir(parents=True, exist_ok=True)
  shutil.copy2(out, app_content / "articles.json")

subprocess.run(["npm", "run", "build"], cwd=APP, check=True)
subprocess.run(["pm2", "restart", "navicert", "--update-env"], check=True)
print("RESTORE_OK", best_count, "articles")
for a in best:
  if isinstance(a, dict):
    print(" -", a.get("slug"), "|", (a.get("title") or "")[:60])
"""


def main() -> int:
    pwd = load_password()
    if not pwd:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=pwd, timeout=30)
    _, o, e = c.exec_command(f"python3 - <<'PY'\n{SCRIPT}\nPY", timeout=600)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
