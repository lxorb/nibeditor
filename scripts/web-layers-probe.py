"""Is a web page ever hidden for a layer of the app's that covers only part of it? Windows only.

Emil, 2026-10-13: *"sometimes when there are toasts, e.g. for a new version, or other stuff
you hover over, the web tab is just not visible - completely black - until you click it
away."* A page is a native webview over the pane, so whether it is on screen round a layer
is a question about another process's window, which this asks the windows: for each kind
of layer the app has, the layer is opened over a page, held, and closed, while the page's
window is sampled as fast as it answers - whether it is shown, and what region it may
draw in (see src-tauri/src/web_cut.rs).

* **over a page** - the update notice, the undo toast, a tab's hover card, the address
  field's suggestions, the bar's menu, and a layer nothing announces (put into the
  document by hand, on no overlay stack and by no press). None of them covers the whole
  page, so the page must never be hidden or emptied: `out of sight ms` is 0 and the
  region is `cut` while the layer is up.
* **a page built under one** - a web note opened while the update notice is up, and while
  a tab's card is. The page that arrives must arrive cut round the layer, not hidden.
* **settings** - a sheet over a scrim covers the whole window, so the page may be emptied
  there, but the window's own photograph must show the page or its still in a corner the
  sheet is not over, never an empty pane.

    python scripts/web-layers-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

The exe is a probe build a drive can steer; see web-smooth-probe.py for how one is built.
Launched through `probe_app.run_probe`, off the screen and never in front.
"""

from __future__ import annotations

import argparse
import ctypes
import http.server
import importlib.util
import json
import pathlib
import sys
import threading
import time
from typing import Any

from probe_app import close_app, main_window, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Web layers probe"

FLAT = b"""<!doctype html><title>Flat</title>
<body style="margin:0;background:#ff0080;height:100vh"></body>"""


def borrowed(name: str) -> Any:
    """Another drive's helpers, so the two cannot drift apart."""

    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


smooth = borrowed("web-smooth-probe")


class Pages:
    """Every page's window under the app's, asked about as fast as they answer: which
    ones there are, whether each is shown and what region it may draw in."""

    def __init__(self, hwnd: int, own: int) -> None:
        self.hwnd, self.own = hwnd, own
        self.rows: list[tuple[float, dict[int, tuple[bool, int]]]] = []
        self.on = False

    def run(self) -> None:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
        while self.on:
            seen = {
                one: (smooth.shown(one), smooth.region(one))
                for one in smooth.views(self.hwnd)
                if one != self.own
            }
            self.rows.append((time.perf_counter(), seen))

    def __enter__(self) -> Pages:
        self.rows = []
        self.on = True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.on = False
        self.thread.join()


def gone(rows: list[tuple[float, dict[int, tuple[bool, int]]]], page: int, since: float, until: float) -> dict[str, object]:
    """How long `page` was out of sight between two moments, and the regions it had."""

    within = [(at, seen[page]) for at, seen in rows if since <= at <= until and page in seen]
    out = 0.0
    for (at, (shown, region)), (after, _) in zip(within, within[1:]):
        if not shown or region == 1:
            out += (after - at) * 1000
    return {
        "out of sight ms": round(out),
        "regions": list(dict.fromkeys(smooth.REGIONS.get(region, region) for _, (_, region) in within)),
    }


def over(app: Any, hwnd: int, page: int, own: int, opening: str, closing: str, held: float = 1.6) -> dict[str, object]:
    """A layer opened over a live page, held, and closed."""

    with Pages(hwnd, own) as sampled:
        time.sleep(0.2)
        began = time.perf_counter()
        said = app.ask(opening)
        time.sleep(held)
        ended = time.perf_counter()
        app.ask(closing)
        time.sleep(0.8)
    return {"said": said, **gone(sampled.rows, page, began, ended), "after": gone(sampled.rows, page, ended + 0.6, ended + 0.8)}


def built_under(app: Any, hwnd: int, own: int, opening: str, closing: str, note: str) -> dict[str, object]:
    """A web note opened while a layer is up: the page that arrives, from the moment its
    window is there until the layer is closed."""

    before = set(smooth.views(hwnd))
    with Pages(hwnd, own) as sampled:
        said = app.ask(opening)
        time.sleep(0.4)
        app.open(note)
        until = time.perf_counter() + 20
        page = 0
        while not page and time.perf_counter() < until:
            fresh = [one for one in smooth.views(hwnd) if one not in before and one != own]
            page = fresh[0] if fresh else 0
            time.sleep(0.02)
        arrived = time.perf_counter()
        time.sleep(2.5)
        ended = time.perf_counter()
        app.ask(closing)
        time.sleep(0.8)
    if not page:
        return {"said": said, "page": "never built"}
    # A page is built over a second or so after its window exists; what counts is that
    # it is not left out of sight once it has arrived.
    return {"said": said, **gone(sampled.rows, page, arrived + 1.5, ended)}


def corner(app: Any, hwnd: int, page: int, opening: str, closing: str, shoot: Any) -> dict[str, object]:
    """A sheet over the whole window: the page or its still in a corner it is not over."""

    from PIL import Image

    x, y, right, bottom = smooth.rect(page)
    wx, wy, _, _ = smooth.rect(hwnd)
    at = (x - wx + 20, bottom - wy - 20)
    said = app.ask(opening)
    seen: list[bool] = []
    began = time.perf_counter()
    while time.perf_counter() - began < 2.0:
        red, green, blue = Image.open(shoot(hwnd, "corner")).convert("RGB").getpixel(at)
        seen.append(red > 90 and green < 80 and blue > 40)
    app.ask(closing)
    time.sleep(0.8)
    return {"said": said, "page or its still in the free corner": f"{sum(seen)}/{len(seen)}"}


UPDATE = "nibApp.updates.ready = '99.9.9', 'ok'"
UPDATE_GONE = "nibApp.updates.dismiss(), 'ok'"

TOAST = """(() => {
  const one = nibApp.workspace.tree.children.find((entry) => entry.name.startsWith('Idea'))
  if (!one) return 'no note'
  void nibApp.workspace.remove(one.path, false)
  return 'ok'
})()"""

#: A tab's card, held until it is let go by hand.
CARD = """(() => {
  const tab = [...document.querySelectorAll('[data-strip] .tab')].find((one) => one.textContent.includes('%s'))
  if (!tab) return 'no tab'
  tab.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
  return 'ok'
})()"""
CARD_GONE = """(() => {
  for (const tab of document.querySelectorAll('[data-strip] .tab'))
    tab.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }))
  return 'ok'
})()"""

SUGGEST = """(() => {
  const field = document.querySelector('.webbar input')
  if (!field) return 'no field'
  field.dispatchEvent(new FocusEvent('focus'))
  field.value = '127'
  field.dispatchEvent(new InputEvent('input', { bubbles: true, data: '7' }))
  return 'ok'
})()"""
SUGGEST_GONE = "document.querySelector('.webbar input')?.dispatchEvent(new FocusEvent('blur')), 'ok'"

MENU = """(() => {
  const more = document.querySelector('.webbar [aria-haspopup="menu"]')
  if (!more) return 'no button'
  more.click()
  return 'ok'
})()"""
MENU_GONE = "nibApp.overlays.escape(), 'ok'"

#: A layer of the theme's own shape over the middle of the page, by no press and on no
#: overlay stack: what a hint or a card a row puts up under the pointer is.
STRANGER = """(() => {
  const hole = document.querySelector('[data-pane] .hole')
  if (!hole) return 'no hole'
  const box = hole.getBoundingClientRect()
  const layer = document.createElement('div')
  layer.className = 'nib-layer probe-layer'
  Object.assign(layer.style, { position: 'fixed', left: `${box.x + 80}px`, top: `${box.y + 80}px`,
    width: '240px', height: '140px', zIndex: '50' })
  document.body.append(layer)
  return 'ok'
})()"""
STRANGER_GONE = "document.querySelector('.probe-layer')?.remove(), 'ok'"

SETTINGS = "nibApp.settings.show(), 'ok'"
SETTINGS_GONE = "nibApp.settings.open = false, 'ok'"


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    switch = borrowed("web-switch-probe")
    overlays = borrowed("web-overlays-probe")
    overlays.OUT.mkdir(parents=True, exist_ok=True)
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))

    switch.wipe(args.identifier)
    port = switch.free_port()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(FLAT)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / SPACE
    space.mkdir(parents=True, exist_ok=True)
    for one in range(3):
        (space / f"Idea {one}.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    for name in ("Flat", "Other", "Fresh", "Fresher"):
        (space / f"{name}.url").write_text(
            switch.shortcut(f"http://127.0.0.1:{port}/{name.lower()}", name), encoding="utf-8"
        )

    said: dict[str, object] = {}
    running = None
    try:
        # One launch to write the endpoint file, so eval can be turned on in it.
        running, app, _ = switch.launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)

        hwnd = 0
        until = time.perf_counter() + 30
        while not hwnd and time.perf_counter() < until:
            hwnd = main_window(running.pid)
            time.sleep(0.1)
        sized(hwnd, 2000, 1400)

        app.open("Idea 0.md", SPACE)
        time.sleep(2)
        app.open("Other.url")
        time.sleep(1)
        app.open("Flat.url")
        page = smooth.page_view(hwnd)
        own = smooth.app_view(hwnd)
        time.sleep(2)

        said["update notice"] = over(app, hwnd, page, own, UPDATE, UPDATE_GONE)
        said["undo toast"] = over(app, hwnd, page, own, TOAST, "'ok'", held=2.0)
        said["a tab's hover card"] = over(app, hwnd, page, own, CARD % "Other", CARD_GONE)
        said["address suggestions"] = over(app, hwnd, page, own, SUGGEST, SUGGEST_GONE)
        said["the bar's menu"] = over(app, hwnd, page, own, MENU, MENU_GONE)
        said["a layer nothing announces"] = over(app, hwnd, page, own, STRANGER, STRANGER_GONE)
        said["settings"] = corner(app, hwnd, page, SETTINGS, SETTINGS_GONE, overlays.shoot)
        said["a page built under the update notice"] = built_under(app, hwnd, own, UPDATE, UPDATE_GONE, "Fresh.url")
        said["a page built under a tab's card"] = built_under(
            app, hwnd, own, CARD % "Other", CARD_GONE, "Fresher.url"
        )
    finally:
        if running is not None and not close_app(running):
            running.kill()
        server.shutdown()

    print(json.dumps(said, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
