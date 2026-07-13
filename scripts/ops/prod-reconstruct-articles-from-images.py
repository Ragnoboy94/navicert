#!/usr/bin/env python3
"""Reconstruct article stubs from persisted cover images (text is lost)."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    os.system(f"{sys.executable} -m pip install paramiko -q")
    import paramiko

PERSIST = "/var/www/navicert-persist/content"
IMAGES = "/var/www/navicert-persist/images/articles"
APP = "/var/www/navicert"

SCRIPT = """
import json, pathlib, re, subprocess
from datetime import datetime, timezone

PERSIST = pathlib.Path("__PERSIST__")
IMAGES = pathlib.Path("__IMAGES__")
APP = pathlib.Path("__APP__")

def slug_from_filename(name: str) -> str:
    base = re.sub(r"\\.(jpe?g|png|webp|gif)$", "", name, flags=re.I)
    base = re.sub(r"-\\d{10,}$", "", base)
    return base or "article"

def title_from_slug(slug: str) -> str:
    words = slug.replace("-", " ").split()
    return " ".join(w.capitalize() for w in words)

groups = {}
for f in sorted(IMAGES.iterdir()):
    if not f.is_file():
        continue
    slug = slug_from_filename(f.name)
    groups.setdefault(slug, []).append(f)

if not groups:
    print("NO_IMAGES")
    raise SystemExit(2)

today = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d")
now = datetime.now(timezone.utc).isoformat()
articles = []
for slug, files in sorted(groups.items()):
    files = sorted(files, key=lambda p: p.stat().st_size, reverse=True)
    cover = files[0]
    url = "/images/articles/" + cover.name
    imgs = "".join(
        '<p><img src="/images/articles/' + f.name + '" alt=""></p>' for f in files
    )
    title = title_from_slug(slug)
    articles.append({
        "slug": slug,
        "title": title,
        "excerpt": "Черновик восстановлен после деплоя. Текст нужно вставить заново в админке.",
        "body": imgs + "<p></p>",
        "image": url,
        "publishedAt": today,
        "updatedAt": now,
        "draft": True,
        "seo": {
            "title": title + " | Нависерт",
            "description": "Черновик — восстановление обложки и вложенных фото.",
        },
    })

out = PERSIST / "articles.json"
PERSIST.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(articles, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")
print("WROTE", out, len(articles), "draft articles")
for a in articles:
    print(" -", a["slug"], "|", a["image"])

subprocess.run(["npm", "run", "build"], cwd=APP, check=True)
subprocess.run(["pm2", "restart", "navicert", "--update-env"], check=True)
print("RECONSTRUCT_OK")
""".replace("__PERSIST__", PERSIST).replace("__IMAGES__", IMAGES).replace("__APP__", APP)


def main() -> int:
    pwd = os.environ.get("DEPLOY_PASSWORD", "").strip()
    if not pwd:
        print("Set DEPLOY_PASSWORD", file=sys.stderr)
        return 1
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect("89.22.238.194", username="root", password=pwd, timeout=30)
    _, o, e = c.exec_command(f"python3 - <<'PY'\n{SCRIPT}\nPY", timeout=600)
    code = o.channel.recv_exit_status()
    sys.stdout.buffer.write(o.read())
    sys.stdout.buffer.write(e.read())
    c.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
