#!/usr/bin/env python3
"""Search project agent transcripts for DEPLOY_PASSWORD / VPS password mentions."""
from __future__ import annotations

import json
import os
import re
import sys

BASE = r"C:\Users\Sergei\.cursor\projects\c-Users-Sergei-Documents-sert\agent-transcripts"

PATTERNS = [
    re.compile(r"DEPLOY_PASSWORD[=:\s]+['\"]?([A-Za-z0-9_\-!.@#$%^&*]{4,})"),
    re.compile(r"mvUKuWL7cgXc"),
    re.compile(r"парол[ьяё]\s*[:=]?\s*['\"]?([A-Za-z0-9_\-!.@#$%^&*]{6,})", re.I),
]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    found: dict[str, list[str]] = {}

    for root, _dirs, files in os.walk(BASE):
        for fname in files:
            if not fname.endswith(".jsonl"):
                continue
            path = os.path.join(root, fname)
            chat = os.path.basename(root) if os.path.basename(root) != "agent-transcripts" else fname
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                for i, line in enumerate(fh, 1):
                    if not any(
                        k in line
                        for k in (
                            "DEPLOY_PASSWORD",
                            "mvUKuWL",
                            "парол",
                            "DEPLOY_PASS",
                            "root@",
                        )
                    ):
                        continue
                    for pat in PATTERNS:
                        for m in pat.finditer(line):
                            val = m.group(1) if m.lastindex else m.group(0)
                            if val.lower() in {
                                "true",
                                "false",
                                "null",
                                "none",
                                "redacted",
                                "***",
                            }:
                                continue
                            found.setdefault(val, []).append(f"{chat}:{i}")

    # Also scan for quoted password near AEZA/VPS in user messages
    near = re.compile(
        r"(?:AEZA|VPS|сервер|deploy|деплой).{0,80}?(?:парол\w*|password|pass)\s*[:=]?\s*['\"]([A-Za-z0-9_\-!.@#$%^&*]{6,})['\"]",
        re.I | re.S,
    )
    near2 = re.compile(
        r"(?:парол\w*|password|pass)\s*[:=]?\s*['\"]([A-Za-z0-9_\-!.@#$%^&*]{6,})['\"].{0,80}?(?:AEZA|VPS|сервер|deploy)",
        re.I | re.S,
    )

    for root, _dirs, files in os.walk(BASE):
        for fname in files:
            if not fname.endswith(".jsonl"):
                continue
            path = os.path.join(root, fname)
            chat = os.path.basename(root)
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                text = fh.read()
            for pat in (near, near2):
                for m in pat.finditer(text):
                    found.setdefault(m.group(1), []).append(f"{chat}:near")

    print(f"unique_candidates={len(found)}")
    for val, locs in found.items():
        print(f"value={val!r} len={len(val)} locs={locs[:5]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
