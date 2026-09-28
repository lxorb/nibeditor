"""Does every web tab wear its site's mark, and does its file keep it? Windows only.

Emil, 2026-09-28: *"I don't always get the proper icon, e.g. sometimes whatsapp just
doesn't get its icon and keeps at the default icon."*

Each case below is a page served here that hands its mark over in one of the ways the
web does, plus a few real sites. For each, the probe opens the note, waits, and reads
three things: the picture the tab strip draws (and whether it loaded, and its size),
the `Nib-Icon` the `.url` on disk now keeps, and what the file list's index says. A
tab that shows the globe, a picture that did not load, or a file that keeps nothing
is a failure.

* **late** - the mark is added by a script after the page has loaded and is served
  with `Cross-Origin-Resource-Policy: same-origin`, which is web.whatsapp.com's shape.
* **svg**, **data**, **plain** (only `/favicon.ico`), **touch** (only an
  `apple-touch-icon`), **sizes** (16, 32, 64 and 192 declared at once).
* **cookie** - the mark answers 403 without a cookie the page itself set.
* **redirect** - the note points at one origin, which redirects to another.
* **worker** - the mark exists only in a service worker.
* **swap** - from five seconds after it loads the mark is redrawn every half second,
  an unread count's shape; the tab follows it and the file keeps the one the page
  arrived with, which is green.
* **worker** is reported and not judged: the engine does not fetch a mark through the
  page's service worker, so it wears none, as Chrome's own tab does.

    python scripts/web-favicons-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name> [--real]

Build the exe as `scripts/probe_app.py` says, with the window off every screen and never
taking the keyboard: `"app":{"windows":[{...the config's own window..., "x":-32000,
"y":-32000, "focus":false, "visible":true}]}`. The drive refuses a window that opens on
screen. Nothing here moves the pointer, presses a key or looks
at the screen: the app is driven through its automation endpoint.
"""

from __future__ import annotations

import argparse
import base64
import http.server
import importlib.util
import json
import pathlib
import shutil
import struct
import sys
import threading
import time
import zlib

from probe_app import close_app, main_window

HERE = pathlib.Path(__file__).resolve().parent


def borrowed():
    """The switch probe's own helpers: the space, the launch, the endpoint, `eval`."""

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def png(size: int, rgb: tuple[int, int, int]) -> bytes:
    """A square of one colour, as a PNG, with nothing but the standard library."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + bytes(rgb) * size
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(row * size))
        + chunk(b"IEND", b"")
    )


RED, GREEN, BLUE, GREY = (220, 40, 40), (40, 180, 60), (40, 80, 220), (128, 128, 128)
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#c3c"/></svg>'


def html(title: str, head: str = "", body: str = "") -> bytes:
    return (
        f"<!doctype html><title>{title}</title>{head}"
        f'<body style="font:16px system-ui;padding:2rem"><h1>{title}</h1>{body}</body>'
    ).encode()


LATE = """<script>
addEventListener('load', () => setTimeout(() => {
  const link = document.createElement('link')
  link.rel = 'icon'
  link.href = '/late.png'
  document.head.append(link)
}, 1500))
</script>"""

BADGE = """<link id="mark" rel="icon" href="/badge-0.png">
<script>
let turn = 0
setTimeout(() => setInterval(() => {
  turn = (turn + 1) % 2
  document.getElementById('mark').href = '/badge-' + turn + '.png'
}, 500), 5000)
</script>"""

WORKER_PAGE = """<script>
navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready)
  .then(() => { if (!navigator.serviceWorker.controller) location.reload() })
</script><link rel="icon" href="/sw-icon.png">"""

WORKER = """self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
const ICON = Uint8Array.from(atob('%s'), (c) => c.charCodeAt(0))
self.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname === '/sw-icon.png') {
    event.respondWith(new Response(ICON, { headers: { 'content-type': 'image/png' } }))
  }
})"""


def routes(port: int) -> dict[str, tuple[int, dict[str, str], bytes]]:
    """Every path the server answers: a status, headers and a body."""

    image = {"content-type": "image/png"}
    own = {**image, "cross-origin-resource-policy": "same-origin"}
    page = {"content-type": "text/html; charset=utf-8"}
    data = base64.b64encode(png(32, BLUE)).decode()
    return {
        "/favicon.ico": (200, {"content-type": "image/x-icon"}, png(32, GREY)),
        "/late": (200, page, html("Late", LATE)),
        "/late.png": (200, own, png(32, GREEN)),
        "/svg": (200, page, html("Svg", '<link rel="icon" type="image/svg+xml" href="/mark.svg">')),
        "/mark.svg": (200, {"content-type": "image/svg+xml"}, SVG),
        "/data": (200, page, html("Data", f'<link rel="icon" href="data:image/png;base64,{data}">')),
        "/plain": (200, page, html("Plain")),
        "/touch": (200, page, html("Touch", '<link rel="apple-touch-icon" href="/touch.png">')),
        "/touch.png": (200, image, png(180, RED)),
        "/sizes": (
            200,
            page,
            html(
                "Sizes",
                '<link rel="icon" sizes="16x16" href="/s16.png">'
                '<link rel="icon" sizes="32x32" href="/s32.png">'
                '<link rel="icon" sizes="64x64" href="/s64.png">'
                '<link rel="icon" sizes="192x192" href="/s192.png">',
            ),
        ),
        "/s16.png": (200, image, png(16, RED)),
        "/s32.png": (200, image, png(32, GREEN)),
        "/s64.png": (200, image, png(64, BLUE)),
        "/s192.png": (200, image, png(192, GREY)),
        "/cookie": (
            200,
            {**page, "set-cookie": "mark=yes; Path=/; SameSite=Lax"},
            html("Cookie", '<link rel="icon" href="/private.png">'),
        ),
        "/redirect": (302, {"location": f"http://localhost:{port}/landing"}, b""),
        "/landing": (200, page, html("Landing", '<link rel="icon" href="/landing.png">')),
        "/landing.png": (200, own, png(32, RED)),
        "/swap": (200, page, html("Swap", BADGE)),
        "/badge-0.png": (200, own, png(32, GREEN)),
        "/badge-1.png": (200, own, png(32, RED)),
        "/worker": (200, page, html("Worker", WORKER_PAGE)),
        "/sw.js": (
            200,
            {"content-type": "text/javascript"},
            (WORKER % base64.b64encode(png(32, RED)).decode()).encode(),
        ),
    }


def serve(port: int) -> http.server.ThreadingHTTPServer:
    table = routes(port)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            status, headers, body = table.get(path, (404, {}, b"no"))
            if path == "/private.png":
                allowed = "mark=yes" in (self.headers.get("cookie") or "")
                status, headers, body = (
                    (200, {"content-type": "image/png"}, png(32, BLUE))
                    if allowed
                    else (403, {}, b"no")
                )
            self.send_response(status)
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


LOCAL = ["late", "svg", "data", "plain", "touch", "sizes", "cookie", "redirect", "worker", "swap"]
REAL = {
    "whatsapp": "https://web.whatsapp.com/",
    "github": "https://github.com/",
    "proton": "https://mail.proton.me/",
    "moodle": "https://moodle-app2.let.ethz.ch/",
    "google": "https://www.google.com/maps",
}

# What the tab strip draws for a tab, and how large the picture it holds is.
DRAWN = """(async () => {
  const tab = nib.workspace.tabs.find((one) => one.name.startsWith('%s'))
  if (!tab) return JSON.stringify({ tab: null })
  const img = document.querySelector(`[data-tab="${tab.id}"] .face img`)
  const src = img?.getAttribute('src') ?? ''
  let size = null
  if (src.startsWith('data:image/png;base64,')) {
    const bytes = atob(src.slice(22, 22 + 40))
    const at = (i) => (bytes.charCodeAt(i) << 24) | (bytes.charCodeAt(i + 1) << 16) | (bytes.charCodeAt(i + 2) << 8) | bytes.charCodeAt(i + 3)
    size = at(16) + 'x' + at(20)
  }
  const pixel = img && img.complete && img.naturalWidth > 0 ? (() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.drawImage(img, 0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(',')
  })() : null
  return JSON.stringify({
    words: tab.doc.length,
    kind: src ? src.slice(0, 22) : 'globe',
    loaded: !!(img && img.complete && img.naturalWidth > 0),
    size,
    colour: pixel,
    dpr: devicePixelRatio,
    listed: (nib.links.faviconOf(tab.path) ?? '').slice(0, 22),
  })
})()"""


def launch(switch, exe: pathlib.Path, identifier: str, unlike: int = 0):
    """The switch probe's launch, without putting the window on screen: the build's own
    window config keeps it off every screen and unfocused, and this only checks that it
    did. Moving it, as the switch probe does, would bring it back into view."""

    import ctypes
    import subprocess
    from ctypes import wintypes

    from probe_app import refuse_updating

    refuse_updating(exe)
    app = subprocess.Popen([str(exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port, secret = switch.endpoint(identifier, 90, unlike)
    until = time.perf_counter() + 90
    hwnd = 0
    while time.perf_counter() < until and not hwnd:
        hwnd = main_window(app.pid)
        time.sleep(0.05)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    # The app puts its window where the config says a moment after it first exists.
    box = wintypes.RECT()
    settle = time.perf_counter() + 3
    while True:
        switch.user32.GetWindowRect(hwnd, ctypes.byref(box))
        if box.left <= -10000 or time.perf_counter() > settle:
            break
        time.sleep(0.05)
    if box.left > -10000:
        app.terminate()
        raise SystemExit(
            f"the window opened on screen at {box.left},{box.top}: build the exe with "
            '"x": -32000, "y": -32000 and "focus": false in its window config'
        )
    time.sleep(1.5)
    return app, switch.App(port, secret)


def kept(space: pathlib.Path, name: str) -> str:
    """The `Nib-Icon` the file now keeps, shortened, with the colour of its first pixel
    where it is one of the plain squares this probe serves."""

    text = (space / f"{name}.url").read_text(encoding="utf-8")
    for line in text.splitlines():
        if line.lower().startswith("nib-icon="):
            value = line[len("nib-icon=") :]
            return f"{value[:30]}... ({len(value)} chars, first pixel {first_pixel(value)})"
    return ""


def first_pixel(address: str) -> str | None:
    try:
        data = base64.b64decode(address.split(",", 1)[1])
        at = data.index(b"IDAT")
        size = struct.unpack(">I", data[at - 4 : at])[0]
        rows = zlib.decompress(data[at + 4 : at + 4 + size])
        return ",".join(str(one) for one in rows[1:4])
    except (ValueError, IndexError, zlib.error, struct.error):
        return None


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    parsed.add_argument("--real", action="store_true", help="also open the real sites")
    parsed.add_argument("--wait", type=float, default=8)
    parsed.add_argument("--only", nargs="*", help="just these cases")
    args = parsed.parse_args()

    switch = borrowed()
    switch.wipe(args.identifier)
    port = switch.free_port()
    server = serve(port)

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    sites = {name: f"http://127.0.0.1:{port}/{name}" for name in LOCAL}
    if args.real:
        sites.update(REAL)
    if args.only:
        sites = {name: url for name, url in sites.items() if name in args.only}
    for name, url in sites.items():
        (space / f"{name}.url").write_text(switch.shortcut(url, name), encoding="utf-8")

    said: dict[str, object] = {}
    running = None
    try:
        running, app = launch(switch, args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)

        running, app = launch(switch, args.exe, args.identifier, unlike=app.port)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)

        for name in sites:
            app.open(f"{name}.url")
            time.sleep(args.wait)
            one = app.ask(DRAWN % name)
            if name == "swap":
                # The tab follows the mark as the page redraws it.
                seen = set()
                for _ in range(20):
                    drawn = app.ask(DRAWN % name)
                    if isinstance(drawn, dict):
                        seen.add(drawn.get("colour"))
                    time.sleep(0.1)
                if isinstance(one, dict):
                    one["colours seen"] = sorted(str(colour) for colour in seen)
            said[name] = one

        # The file is written a couple of seconds after the reading settles.
        time.sleep(4)
        for name in sites:
            entry = said.get(name)
            if isinstance(entry, dict):
                entry["file"] = kept(space, name)
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    # A tab whose document never read its file has nothing to write the mark into, and
    # that is the tab's opening and not the mark: said apart, so it is not mistaken for
    # this. Seen on both sides of the fix, for a different case each run.
    unread = [name for name, one in said.items() if isinstance(one, dict) and one.get("words") == 0]
    if unread:
        print(f"note: the document of {unread} never read its file")
    failed = [
        name
        for name, one in said.items()
        if name != "worker"
        and (
            not isinstance(one, dict)
            or not one.get("loaded")
            or not (one.get("file") or name in unread)
        )
    ]
    if failed:
        print(f"FAIL: no mark for {failed}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
