import re, urllib.request
from html import unescape

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9",
}

def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.geturl(), r.read().decode("utf-8", "replace")

final, html = get("https://synapsenet.ru/organizacii")
open("tmp-synapse-org.html", "w", encoding="utf-8").write(html)
print("final", final, "len", len(html))
# forms / date / email hints
for pat in [r"date", r"регистрац", r"email", r"почт", r"e-mail", r"filter", r"advanced"]:
    print(pat, len(re.findall(pat, html, re.I)))

# Try a known older company with likely email on synapse by inn
for q in ["7707083893", "gazprom", "9727092307"]:
    try:
        final, html = get(f"https://synapsenet.ru/search?query={q}")
        links = re.findall(r'href="(/organization/[^"]+|/org/[^"]+|https://synapsenet\.ru/organization/[^"]+)"', html)
        print("q", q, "links", links[:5], "len", len(html))
        if not links:
            # any /id/ style
            links = [m for m in re.findall(r'href="([^"]+)"', html) if "synapsenet" in m or m.startswith("/")][:15]
            print("  href sample", links)
    except Exception as e:
        print("q", q, e)

# list-org: open a random known old company page pattern
final, html = get("https://www.list-org.com/search?type=inn&val=7707083893")
open("tmp-listorg-sber.html", "w", encoding="utf-8").write(html)
links = re.findall(r'href="(/company/\d+)"', html)
print("list-org sber links", links[:5])
if links:
    final2, html2 = get("https://www.list-org.com" + links[0])
    mails = re.findall(r"mailto:([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})", html2, re.I)
    emails = [e for e in re.findall(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", html2) if "list-org" not in e.lower()][:10]
    print("card", final2, "mailto", mails, "emails", emails)
