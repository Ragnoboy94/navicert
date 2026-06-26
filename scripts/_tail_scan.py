from pathlib import Path
import re

t = Path(
    r"C:\Users\Sergei\.cursor\projects\c-Users-Sergei-Documents-sert\agent-tools\fa963a1e-8470-4fc9-ade4-1bc298e69a89.txt"
).read_text(encoding="utf-8", errors="replace")

# last 80k - often global widgets here
tail = t[-80000:]
Path(r"C:\Users\Sergei\Documents\sert\scripts\_html_tail.txt").write_text(tail, encoding="utf-8")

# search uncommon domains in full file
candidates = re.findall(r'[a-zA-Z0-9][-a-zA-Z0-9]*\.(ru|com|io|net|app|pro)/[a-zA-Z0-9_./?=&%-]{0,80}', t)
from collections import Counter
filtered = []
for u in candidates:
    if any(x in u.lower() for x in ['tilda', 'google', 'gstatic', 'w3.org', 'instagram', 'killbot', 'kill-bot', 'yandex', 'mail.ru', 'voron-dev', 'navicert', 't.me', 'wa.me', 'max.ru']):
        continue
    filtered.append(u)
print("Uncommon URL-like:", Counter(filtered).most_common(30))

# tilda head/footer injection markers
for kw in ["tildastat", "tilda-stat", "footer", "headcode", "beforebody", "afterbody", "allrecords", "t657", "t123"]:
    print(kw, t.lower().count(kw.lower()))
