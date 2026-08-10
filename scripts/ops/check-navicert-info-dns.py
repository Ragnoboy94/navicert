#!/usr/bin/env python3
"""Check whether navicert-info.ru DNS points to the VPS and how HTTP responds."""
from __future__ import annotations

import json
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

VPS = "89.22.238.194"


def dns(name: str, rtype: str) -> list[str]:
    url = f"https://dns.google/resolve?name={name}&type={rtype}"
    with urllib.request.urlopen(url, timeout=12) as r:
        data = json.load(r)
    return [a.get("data", "") for a in data.get("Answer") or []]


def http_check(url: str) -> str:
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            return f"{resp.status} final={resp.geturl()} server={resp.headers.get('Server')}"
    except urllib.error.HTTPError as e:
        loc = e.headers.get("Location") if e.headers else None
        return f"HTTPError {e.code} location={loc}"
    except Exception as e:
        return f"{type(e).__name__}: {e}"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    for name in ("navicert-info.ru", "www.navicert-info.ru"):
        for t in ("A", "MX"):
            print(f"{name} {t}: {dns(name, t) or '(none)'}")
        print()

    a = dns("navicert-info.ru", "A")
    print(f"VPS target: {VPS}")
    print(f"A points to VPS: {VPS in a}")
    print(f"http://navicert-info.ru/ -> {http_check('http://navicert-info.ru/')}")
    print(f"https://navicert-info.ru/ -> {http_check('https://navicert-info.ru/')}")

    has_pwd = False
    for name in (".env.local", ".env"):
        p = Path(name)
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("DEPLOY_PASSWORD=") and line.split("=", 1)[1].strip().strip('"'):
                has_pwd = True
    print(f"DEPLOY_PASSWORD present: {has_pwd}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
