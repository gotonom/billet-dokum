"""Renders the share cards in og/og.html to docs/og/<page>.png (1200 × 630) with headless Chrome.

The cards embed each panel's live process diagram through same-origin iframes, so the repo root is
served over HTTP while rendering. Run after `python3 build.py`:  python3 og/render.py
"""
import subprocess, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = ROOT / "docs" / "og"
PORT = 4932
OUT.mkdir(parents=True, exist_ok=True)

server = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1", "--directory", str(ROOT)],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(1)
    for page in ["index", "firin", "dokum", "homojen", "lab"]:
        with tempfile.TemporaryDirectory() as profile:   # own profile, so a running Chrome is not disturbed
            subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                            f"--user-data-dir={profile}", "--window-size=1200,630", "--virtual-time-budget=12000",
                            f"--screenshot={OUT / (page + '.png')}", f"http://127.0.0.1:{PORT}/og/og.html#{page}"],
                           check=True, capture_output=True)
        print(f"docs/og/{page}.png")
finally:
    server.terminate()
