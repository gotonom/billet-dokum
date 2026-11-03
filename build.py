"""Wraps each page fragment in src/ into a full HTML document in docs/.

Shared styles (src/common.css) and the plant model (src/common.js) are inlined
where a page has /*@COMMON_CSS*/ and //@COMMON_JS, so every published page is one file.
docs/ is served by server.js (Railway) and can also be served by GitHub Pages.
Run: python3 build.py
"""
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
# Share links resolve against the Railway domain (GitHub Pages copies point there too).
BASE = "https://billet-dokum-production.up.railway.app"
OG_VERSION = 1          # bump when the cards change, so apps that cached the old image fetch the new one
# source fragment -> (published file, share title, meta description); share card is docs/og/<file stem>.png
PAGES = {
    "index.html":   ("index.html",   "Billet Dökümhanesi · Kontrol Merkezi",
                     "Ergitme, döküm, homojenizasyon ve testere tek ekranda: canlı saha planı, metal yolculuğu, günlük döküm takvimi, KPI ve alarmlar. Created by GOTONOM."),
    "firin.html":   ("firin.html",   "Billet Dökümhanesi · Fırınlar",
                     "İki ergitme fırını ve döküm fırını: şarj, ergitme, alaşım, kimya onayı ve döküme hazır kapısı. Created by GOTONOM."),
    "dokum.html":   ("dokum.html",   "Billet Dökümhanesi · Döküm Masası",
                     "Hot-top DC döküm: 64 kalıp, hız ve su reçetesi, metal seviyesi, bleed-out algılama, PLC kilitleri ve alarm senaryoları. Created by GOTONOM."),
    "homojen.html": ("homojen.html", "Billet Dökümhanesi · Homojenizasyon ve Testere",
                     "5 homojenizasyon fırını, soğutma odası, testere ve ultrasonik muayene: 580 °C bekletme, soğuma hızı, fire. Created by GOTONOM."),
}
FAVICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
           "%3Crect width='32' height='32' rx='6' fill='%230a2463'/%3E%3Crect x='11' y='5' width='10' height='22' rx='2' "
           "fill='none' stroke='%23fff' stroke-width='3'/%3E%3Cpath d='M11 10h10' stroke='%23f97316' stroke-width='3'/%3E%3C/svg%3E")

COMMON_CSS = (SRC / "common.css").read_text(encoding="utf-8")
COMMON_JS = (SRC / "common.js").read_text(encoding="utf-8")


def wrap(src: str, out: str, title: str, description: str) -> str:
    src = src.replace("/*@COMMON_CSS*/", COMMON_CSS).replace("//@COMMON_JS", COMMON_JS)
    card = out.removesuffix(".html")
    split = src.index('<div class="wrap">')
    head, body = src[:split].strip(), src[split:].strip()
    return f"""<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="{description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Dökümhane">
<meta property="og:locale" content="tr_TR">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{BASE}/{'' if out == 'index.html' else out}">
<meta property="og:image" content="{BASE}/og/{card}.png?v={OG_VERSION}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{title}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{description}">
<meta name="twitter:image" content="{BASE}/og/{card}.png?v={OG_VERSION}">
<meta name="theme-color" content="#0a2463">
<link rel="icon" href="{FAVICON}">
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0;-webkit-text-size-adjust:100%}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
{head}
</head>
<body>
{body}
</body>
</html>
"""


for name, (out, title, desc) in PAGES.items():
    src = SRC / name
    if not src.exists():
        print(f"skip {name} (not found)")
        continue
    page = wrap(src.read_text(encoding="utf-8"), out, title, desc)
    (ROOT / "docs" / out).write_text(page, encoding="utf-8")
    print(f"docs/{out} written ({len(page):,} bytes)")
