"""Does a page in a reader's web tab see anything a browser would not show it?

Emil, 2026-10-03: *"Cloudflare says: there was a problem with verification, please
reload and try again, every time I want to log in."* A bot check - Cloudflare's
Turnstile, hCaptcha, reCAPTCHA, Akamai - fails a browser that looks driven, and one that
loses the cookies its challenge sets. This drive asks a page what it can see, in the page
and in a frame from another site (where a challenge runs), and fails on any of it:

    navigator.webdriver    true only for a browser under automation
    the console domain     a DevTools client with `Runtime` on serialises what a page
                           logs, and a getter on what it logs says so: the best-known
                           sign of a driven page
    nib's globals          anything of nib's or the runtime's on the page's `window`
    window.name            nib's channel names (`nib-...`) left behind on a window

And a cookie its site sets twice, as Cloudflare's challenge frame does: partitioned, and
unpartitioned beside it for a browser that allows third-party cookies. Both are still
there after the pages that make logins last have loaded (src-tauri/src/web_cookies.rs):
the clean-up of an old bug took the second one away as its "twin", which is what broke
the challenge (web_cookies/twins.rs).

`EmbeddedBrowserWebView` on `window` and `Microsoft Edge WebView2` among the client
hints' brands are `WebView2`'s own, in every app built on it, and are reported but not
failed on: nib cannot take them away without lying about the engine.

    python scripts/web-bot-probe.py --exe path/to/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

Launched through `run_probe`, off the screen, with `NIB_SPACES_DIR` in a temp folder;
everything it loads is served on the loopback.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import pathlib
import re
import shutil
import sys
import tempfile
import threading
import time
from typing import Any

from probe_app import identifier_of

# The drive's own helpers for a probe build: launch, eval, the clip reader.
sys.path.insert(0, str(pathlib.Path(__file__).parent))
_parity = __import__("importlib").import_module("importlib.util")
_spec = _parity.spec_from_file_location("browser_parity", pathlib.Path(__file__).parent / "browser-parity-probe.py")
assert _spec and _spec.loader
bp: Any = _parity.module_from_spec(_spec)
_spec.loader.exec_module(bp)

# What a page can see, asked the same way in the page and in the frame.
SIGNS = r"""
function signs(where) {
  var said = { where: where, webdriver: String(navigator.webdriver), name: window.name,
    brands: navigator.userAgentData ? navigator.userAgentData.brands.map(function (one) {
      return one.brand }).join(',') : '',
    cdp: 'no', webview: window.chrome && window.chrome.webview ? 'yes' : 'no',
    globals: Object.getOwnPropertyNames(window).filter(function (one) {
      return /nib|ipc|tauri|cdc_|webview|__/i.test(one) }).join(','),
    twice: (document.cookie.match(/(?:^|; )fb=/g) || []).length }
  var error = new Error('look')
  Object.defineProperty(error, 'stack', { get: function () { said.cdp = 'yes'; return '' } })
  console.debug(error)
  return said
}
"""

PAGE = (
    """<!doctype html><title>Signs</title><body><article>WAITING
<p>A paragraph so the reader keeps the article: it says nothing the line above does not,
and it is long enough that the clipper's reader takes the article rather than the body,
which it does once there are a couple of hundred characters of it.</p></article>
<script>"""
    + SIGNS
    + """
var mine = signs('page')
addEventListener('message', function (event) {
  document.querySelector('article').firstChild.textContent =
    'RESULT ' + JSON.stringify([mine, event.data]) + ' END'
})
var frame = document.createElement('iframe')
frame.src = 'http://localhost:PORT/frame' + location.search
document.body.appendChild(frame)
</script></body>"""
)

FRAME = "<!doctype html><script>" + SIGNS + "parent.postMessage(signs('frame'), '*')</script>"

# The site's one cookie, set twice: in the frame's partition, and outside it.
TWICE = [
    "fb=1; Path=/; Secure; SameSite=None; Partitioned",
    "fb=1; Path=/; Secure; SameSite=None",
]

# The engine's own, in every app on WebView2: reported, never failed on.
ENGINE_OWN = {"EmbeddedBrowserWebView"}


def serve(port: int) -> None:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            framed = self.path.startswith("/frame")
            body = (FRAME if framed else PAGE.replace("PORT", str(port))).encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "no-store")
            if framed and "set" in self.path:
                for one in TWICE:
                    self.send_header("set-cookie", one)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()


def read(app: Any, tab: str) -> list[dict[str, Any]]:
    def look() -> list[dict[str, Any]]:
        said = app.ask(f"window.__TAURI_INTERNALS__.invoke('web_clip', {{ tab: '{tab}', selection: false }})")
        html = said.get("html", "") if isinstance(said, dict) else ""
        found = re.search(r"RESULT (.*?) END", html, re.S)
        try:
            return json.loads(found[1]) if found else []
        except ValueError:
            return []

    return bp.until(look) or []


def clean(seen: dict[str, Any]) -> list[str]:
    """What a page should not have seen, in words."""

    wrong = []
    if seen.get("webdriver") != "false":
        wrong.append(f"navigator.webdriver is {seen.get('webdriver')}")
    if seen.get("cdp") != "no":
        wrong.append("a DevTools client has the console domain on")
    extra = [one for one in str(seen.get("globals", "")).split(",") if one and one not in ENGINE_OWN]
    if extra:
        wrong.append(f"globals on window: {extra}")
    if str(seen.get("name", "")).startswith("nib"):
        wrong.append(f"window.name is {seen.get('name')}")
    if seen.get("webview") != "no":
        wrong.append("window.chrome.webview is there")
    return wrong


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier")
    args = parsed.parse_args()
    identifier = identifier_of(args.exe, args.identifier)

    bp.wipe(identifier)
    port = bp.free_port()
    serve(port)
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-bot-probe-spaces-"))
    os.environ["NIB_SPACES_DIR"] = str(root)
    (root / "Bot probe").mkdir()
    (root / "Bot probe" / "Idea.md").write_text("# Idea\n", encoding="utf-8")

    said: dict[str, Any] = {}
    checks: dict[str, bool] = {}
    running = None
    try:
        running, app = bp.launch(args.exe, identifier)
        running.terminate()
        running.wait(timeout=30)
        endpoint = bp.config_dir(identifier) / "automation.json"
        written = json.loads(endpoint.read_text(encoding="utf-8"))
        written["eval"] = True
        endpoint.write_text(json.dumps(written), encoding="utf-8")
        time.sleep(1)
        running, app = bp.launch(args.exe, identifier, unlike=app.port)
        app.act("open", {"path": "Idea.md", "space": "Bot probe"})
        time.sleep(2)

        page = f"http://127.0.0.1:{port}/"
        # The first load sets the cookie twice; the ones after it only read it.
        tab = str(app.ask(f"nib.workspace.openPage('{page}?set', 'front')"))
        time.sleep(4)
        first = read(app, tab)
        said["first load"] = first
        for one in first:
            for wrong in clean(one):
                checks[f"{one.get('where')}: {wrong}"] = False
        checks["the page and its frame were read"] = len(first) == 2

        # Two more loads, each of which makes the store's logins last; the cookie set
        # twice must still be there twice after them.
        bp.go(app, tab, page)
        bp.go(app, tab, page)
        time.sleep(1)
        later = read(app, tab)
        said["after two more loads"] = later
        frame = next((one for one in later if one.get("where") == "frame"), {})
        checks["a cookie the site set twice is still there twice"] = frame.get("twice") == 2
        for one in later:
            for wrong in clean(one):
                checks[f"{one.get('where')} after loads: {wrong}"] = False
        checks.setdefault("nothing a browser would not show a page", True)
    finally:
        if running is not None:
            running.terminate()
            running.wait(timeout=30)
        shutil.rmtree(root, ignore_errors=True)

    print(json.dumps(said, indent=2))
    for name, ok in checks.items():
        print(f"{'ok  ' if ok else 'FAIL'} {name}")
    passed = all(checks.values())
    print("\nPASS" if passed else "\nFAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
