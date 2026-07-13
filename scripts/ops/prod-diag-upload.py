#!/usr/bin/env python3
"""Diagnose prod image upload: dirs, nginx, route files."""
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

SCRIPT = f"""
import os, pathlib, subprocess, json

APP = "{APP}"
PERSIST = "/var/www/navicert-persist"

def section(t):
    print("\\n=== " + t + " ===")

section("dirs")
for p in [
    f"{{APP}}/public/images/uploads",
    f"{{APP}}/public/images/articles",
    f"{{PERSIST}}/images/uploads",
    f"{{PERSIST}}/images/articles",
]:
    path = pathlib.Path(p)
    kind = "symlink->" + str(path.resolve()) if path.is_symlink() else ("dir" if path.is_dir() else "missing")
    print(p, kind)
    if path.exists():
        try:
            files = list(path.iterdir())
            print("  files", len(files))
        except Exception as e:
            print("  list error", e)

section("nginx")
nginx = pathlib.Path("/etc/nginx/sites-available/navicert")
if nginx.exists():
    text = nginx.read_text(encoding="utf-8")
    print("client_max_body_size", "yes" if "client_max_body_size" in text else "MISSING (default 1m)")
else:
    print("config missing")

section("routes")
for rel in [
    "src/app/api/admin/upload/route.ts",
    "src/app/images/[folder]/[...path]/route.ts",
    "src/app/images/uploads/[...path]/route.ts",
]:
    p = pathlib.Path(APP) / rel
    print(rel, "ok" if p.exists() else "missing")

section("write test")
for target in [f"{{PERSIST}}/images/articles", f"{{PERSIST}}/images/uploads"]:
    p = pathlib.Path(target)
    p.mkdir(parents=True, exist_ok=True)
    t = p / ".diag-write"
    try:
        t.write_text("ok", encoding="utf-8")
        t.unlink()
        print(target, "writable")
    except Exception as e:
        print(target, "FAIL", e)

section("sample urls")
for sub in ("uploads", "articles"):
    d = pathlib.Path(APP) / "public" / "images" / sub
    if not d.exists():
        continue
    sample = next((f for f in d.iterdir() if f.is_file()), None)
    if sample:
        url = f"/images/{{sub}}/{{sample.name}}"
        r = subprocess.run(
            ["curl", "-s", "-o", "/dev/null", "-w", "%{{http_code}}", f"http://127.0.0.1:3000{{url}}"],
            capture_output=True,
            text=True,
        )
        print(url, "app", r.stdout.strip())
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

    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username="root", password=pwd, timeout=30)
    _, o, e = c.exec_command(f"python3 - <<'PY'\n{SCRIPT}\nPY", timeout=120)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
