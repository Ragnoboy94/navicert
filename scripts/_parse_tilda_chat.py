import re
from pathlib import Path

text = Path(
    r"C:\Users\Sergei\.cursor\projects\c-Users-Sergei-Documents-sert\agent-tools\fa963a1e-8470-4fc9-ade4-1bc298e69a89.txt"
).read_text(encoding="utf-8", errors="replace")

scripts = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', text, re.I)
print("=== external scripts (non-core tilda) ===")
for s in scripts:
    low = s.lower()
    if any(
        x in low
        for x in [
            "jivo",
            "chat",
            "widget",
            "callback",
            "bitrix",
            "tawk",
            "carrot",
            "envybox",
            "livetex",
            "verbox",
            "talk",
            "webim",
            "usedesk",
            "clever",
            "marquiz",
            "botfaqtor",
            "helpdesk",
            "redhelper",
        ]
    ):
        print(s)

keywords = [
    "jivo",
    "jivosite",
    "tawk",
    "carrot",
    "bitrix",
    "envybox",
    "livetex",
    "verbox",
    "chatra",
    "webim",
    "usedesk",
    "talk-me",
    "redhelper",
    "callbackhunter",
    "cleversite",
    "marquiz",
    "botfaqtor",
    "widget_id",
    "chat_id",
    "t898",
    "t123",
    "whatsapp",
    "telegram",
    "max.ru",
]
print("\n=== keyword hits ===")
low = text.lower()
for kw in keywords:
    if kw in low:
        idx = low.find(kw)
        print(f"\n[{kw}]")
        print(text[max(0, idx - 120) : idx + 280])

inline = re.findall(r"<script[^>]*>(.*?)</script>", text, re.I | re.S)
print("\n=== inline scripts with chat markers ===")
for i, block in enumerate(inline):
    bl = block.lower()
    if any(
        k in bl
        for k in [
            "jivo",
            "tawk",
            "bitrix",
            "envybox",
            "livetex",
            "verbox",
            "widget",
            "chat",
            "callback",
            "carrot",
            "talk-me",
            "webim",
            "usedesk",
        ]
    ):
        print(f"\n--- inline #{i} ---")
        print(block.strip()[:1200])
