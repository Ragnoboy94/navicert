import re
from pathlib import Path

text = Path(
    r"C:\Users\Sergei\.cursor\projects\c-Users-Sergei-Documents-sert\agent-tools\fa963a1e-8470-4fc9-ade4-1bc298e69a89.txt"
).read_text(encoding="utf-8", errors="replace")

# All Tilda record types
types = re.findall(r'data-record-type="(\d+)"', text)
from collections import Counter
print("=== record types ===")
for t, c in Counter(types).most_common():
    print(t, c)

# Extract all T123 / HTML blocks
for m in re.finditer(
    r'data-record-type="(123|131|868|898|109|702)"[^>]*>.*?<!-- /T\1 -->',
    text,
    re.S,
):
    block = m.group(0)
    if len(block) > 200:
        print("\n=== BLOCK type", m.group(1), "len", len(block), "===")
        print(block[:2500])

# Any iframe
iframes = re.findall(r'<iframe[^>]+>', text, re.I)
print("\n=== iframes ===")
for f in iframes:
    print(f[:300])

# Any third-party domains in src/href
urls = set(re.findall(r'https?://[a-z0-9._/-]+', text, re.I))
print("\n=== third-party domains (not tilda) ===")
for u in sorted(urls):
    if "tildacdn" not in u and "tilda." not in u:
        print(u)
