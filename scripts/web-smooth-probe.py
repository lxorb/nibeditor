"""Does a web tab's page stay glued to its pane? Windows only.

Emil, 2026-10-03: *"web sites display feels very buggy"* - while resizing the window the
page sometimes froze where it was, opening the sidebar moved the page in steps, and while
a toast showed or something was hovered the page was sometimes invisible. A page is a
native webview placed over the pane's hole, so none of that can be unit tested: it is a
question about where a window of another process is, and when. This asks the windows.

The app's window is driven with messages to its own HWND - `SetWindowPos` while it stays
off the screen - and the page's window is sampled as fast as Python can ask, on a thread
of its own: its rectangle, whether it is shown and what region it may draw in. What it
reports:

* **resize** - a window resized in eighty steps a frame apart. `lag ms` is how long after
  the app's own view took a new width the page did; `never caught up` counts the steps
  the page skipped altogether, which is the freeze.
* **sidebar** - the panel opened and shut: how many times the page moved, the longest gap
  between two moves, and the app's own frames over 20 ms while it slid. The page should
  move once per frame the app draws.
* **hover a tab**, **address suggestions**, **toast**, **settings** - whether the page was
  ever hidden or emptied (`out of sight ms`), how often its region changed, and whether
  the window's own photograph shows the page or its still in a corner the layer is not
  over. A layer that is not over the page must leave it alone; one that is must never
  leave the pane blank.

    python scripts/web-smooth-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

The exe is a probe build a drive can steer, so `window.nibApp` is there:

    npx vite build --mode drive                     # in apps/desktop
    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.<name>","version":"99.0.0",
                 "build":{"beforeBuildCommand":""},
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'

Launched through `probe_app.run_probe`, off the screen and never in front.
"""

from __future__ import annotations

import argparse
import ctypes
import http.server
import importlib.util
import json
import pathlib
import statistics
import sys
import threading
import time
from ctypes import wintypes
from typing import Any

from probe_app import close_app, main_window, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Web smooth probe"

#: A page of one colour, so a photograph says at a glance whether the page is there.
FLAT = b"""<!doctype html><title>Flat</title>
<body style="margin:0;background:#ff0080;height:100vh"></body>"""
TALL = b"""<!doctype html><title>Tall</title>
<body style="margin:0;font:16px system-ui"><h1 style="margin:0;padding:2rem">Tall</h1>
<div style="height:9000px;background:linear-gradient(#fff,#048)"></div></body>"""

#: `GetWindowRgnBox`: no region is the whole window, an empty one is none of it.
REGIONS = {0: "whole", 1: "empty", 2: "rect", 3: "cut"}

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


def borrowed(name: str) -> Any:
    """Another drive's helpers, so the two cannot drift apart."""

    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rect(hwnd: int) -> tuple[int, int, int, int]:
    assert user32 is not None
    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    return (box.left, box.top, box.right, box.bottom)


def shown(hwnd: int) -> bool:
    assert user32 is not None
    return bool(user32.IsWindowVisible(wintypes.HWND(hwnd)))


def region(hwnd: int) -> int:
    assert user32 is not None
    box = wintypes.RECT()
    return int(user32.GetWindowRgnBox(wintypes.HWND(hwnd), ctypes.byref(box)))


def views(hwnd: int) -> list[int]:
    """Every webview straight under the window, the app's own and each page's."""

    assert user32 is not None
    user32.GetAncestor.restype = wintypes.HWND
    found: list[int] = []
    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def each(child: int, _lparam: int) -> bool:
        name = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(wintypes.HWND(child), name, 64)
        if name.value == "WRY_WEBVIEW" and user32.GetAncestor(wintypes.HWND(child), 1) == hwnd:
            found.append(child)
        return True

    user32.EnumChildWindows(wintypes.HWND(hwnd), kind(each), 0)
    return found


def area(box: tuple[int, int, int, int]) -> int:
    return (box[2] - box[0]) * (box[3] - box[1])


def app_view(hwnd: int) -> int:
    return max(views(hwnd), key=lambda one: area(rect(one)))


def page_view(hwnd: int, seconds: float = 60) -> int:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        own = app_view(hwnd)
        for one in views(hwnd):
            if one != own and shown(one) and rect(one)[2] - rect(one)[0] > 50:
                return one
        time.sleep(0.05)
    raise SystemExit("the page never appeared")


class Sampler:
    """The page's window and the app's own, asked about as fast as they answer."""

    def __init__(self, page: int, own: int) -> None:
        self.page, self.own = page, own
        self.rows: list[tuple[float, tuple[int, int, int, int], bool, tuple[int, int, int, int], int]] = []
        self.on = False

    def run(self) -> None:
        assert user32 is not None
        user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
        user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
        while self.on:
            self.rows.append(
                (time.perf_counter(), rect(self.page), shown(self.page), rect(self.own), region(self.page))
            )

    def __enter__(self) -> Sampler:
        self.rows = []
        self.on = True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self.on = False
        self.thread.join()


def changes(rows: list[Any], key: Any) -> list[tuple[float, Any]]:
    out: list[tuple[float, Any]] = []
    last: Any = object()
    for row in rows:
        value = key(row)
        if value != last:
            out.append((row[0], value))
            last = value
    return out


# Every placement and photograph the window asks the crate for, counted at the fetch the
# runtime sends it down. `invoke` itself is frozen; `fetch` is not.
COUNT = """(() => {
  if (!window.__counted) {
    const real = window.fetch.bind(window)
    window.__placed = []
    window.fetch = (input, init) => {
      const url = String(input?.url ?? input)
      const cmd = ['web_place', 'web_shot'].find((one) => url.includes(one))
      if (cmd) {
        let args = {}
        try { args = JSON.parse(init?.body ?? '{}') } catch {}
        window.__placed.push([performance.now(), cmd, args?.visible ?? null, Boolean(args?.cut)])
      }
      return real(input, init)
    }
    window.__counted = true
  }
  window.__placed = []
  return 'ok'
})()"""
TAKE = "JSON.stringify(window.__placed.splice(0))"

FRAMES = """(() => { window.__frames = []; let last = performance.now(); const until = last + %d;
  const tick = (now) => { window.__frames.push(now - last); last = now; if (now < until) requestAnimationFrame(tick) };
  requestAnimationFrame(tick); return 'ok' })()"""


def resize(hwnd: int, page: int, own: int, steps: int = 40, by: int = 24) -> dict[str, object]:
    """The window resized a frame at a time, out and back, by messages to its own HWND."""

    x0, y0, x1, y1 = rect(hwnd)
    width, height = x1 - x0, y1 - y0
    with Sampler(page, own) as sampled:
        for step in [*range(1, steps + 1), *range(steps - 1, -1, -1)]:
            sized(hwnd, width + step * by, height + step * by // 2)
            time.sleep(0.016)
        time.sleep(1.0)
    rows = sampled.rows

    lags: list[float] = []
    skipped = 0
    edges = changes(rows, lambda row: row[3][2])
    for index, (at, right) in enumerate(edges):
        caught = next((row[0] for row in rows if row[0] >= at and row[1][2] == right), None)
        following = edges[index + 1][0] if index + 1 < len(edges) else None
        if caught is None or (following is not None and caught > following):
            skipped += 1
        else:
            lags.append((caught - at) * 1000)
    return {
        "steps": len(edges),
        "lag ms median": round(statistics.median(lags), 1) if lags else None,
        "lag ms max": round(max(lags), 1) if lags else None,
        "never caught up": skipped,
        "at rest with the app": rows[-1][1][2] == rows[-1][3][2],
    }


def slide(app: Any, page: int, own: int, code: str) -> dict[str, object]:
    """The sidebar opened or shut: every move of the page, and the app's own frames."""

    app.ask(COUNT)
    app.ask(FRAMES % 800)
    with Sampler(page, own) as sampled:
        began = time.perf_counter()
        app.ask(code)
        time.sleep(0.8)
    moves = changes([row for row in sampled.rows if row[0] >= began], lambda row: (row[1][0], row[1][2]))
    gaps = [(after[0] - before[0]) * 1000 for before, after in zip(moves[1:], moves[2:])]
    frames = app.ask("JSON.stringify(window.__frames)")
    placed = app.ask(TAKE)
    return {
        "page moves": len(moves) - 1,
        "longest gap between moves ms": round(max(gaps), 1) if gaps else None,
        "app frames over 20 ms": [round(one) for one in frames if one > 20] if isinstance(frames, list) else frames,
        "placements": len(placed) if isinstance(placed, list) else placed,
    }


def watch(app: Any, hwnd: int, page: int, own: int, code: str, corner: tuple[int, int], seconds: float, shoot: Any) -> dict[str, object]:
    """A layer opened and closed: whether the page was ever hidden or emptied, and
    whether a corner the layer is not over shows the page or its still throughout."""

    from PIL import Image

    app.ask(COUNT)
    seen: list[bool] = []
    with Sampler(page, own) as sampled:
        began = time.perf_counter()
        app.ask(code)
        while time.perf_counter() - began < seconds:
            red, green, blue = Image.open(shoot(hwnd, "corner")).convert("RGB").getpixel(corner)
            seen.append(red > 90 and green < 80 and blue > 40)
    rows = [row for row in sampled.rows if row[0] >= began]
    gone = 0.0
    for before, after in zip(rows, rows[1:]):
        if not before[2] or before[4] == 1:
            gone += (after[0] - before[0]) * 1000
    placed = app.ask(TAKE)
    return {
        "out of sight ms": round(gone),
        "hidden": sum(1 for _, one in changes(rows, lambda row: row[2])[1:] if not one),
        # Which shapes the page's window was given, in the order first seen. Asked of another
        # process's window while it is being reshaped, the answer is now and then "none".
        "regions": list(dict.fromkeys(REGIONS.get(row[4], row[4]) for row in rows)),
        "page in the free corner": f"{sum(seen)}/{len(seen)}",
        "placements hiding it": sum(1 for one in placed if one[1] == "web_place" and one[2] is False)
        if isinstance(placed, list)
        else placed,
        "photographs": sum(1 for one in placed if one[1] == "web_shot") if isinstance(placed, list) else None,
    }


HOVER = """(() => {
  const tab = [...document.querySelectorAll('[data-strip] .tab')].find((one) => one.textContent.includes('Tall'))
  if (!tab) return 'no tab'
  tab.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }))
  setTimeout(() => tab.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })), 1600)
  return 'ok'
})()"""

# The field's own focus event, since a probe's window is never in front and its document
# never has the keyboard to hand to the field.
SUGGEST = """(() => {
  const field = document.querySelector('.webbar input')
  if (!field) return 'no field'
  field.dispatchEvent(new FocusEvent('focus'))
  field.value = '127'
  field.dispatchEvent(new InputEvent('input', { bubbles: true, data: '7' }))
  setTimeout(() => field.dispatchEvent(new FocusEvent('blur')), 1400)
  return 'ok'
})()"""

TOAST = """(() => {
  const one = nibApp.workspace.tree.children.find((entry) => entry.name.startsWith('Idea'))
  void nibApp.workspace.remove(one.path, false)
  return 'ok'
})()"""

SETTINGS = "nibApp.settings.show(), setTimeout(() => (nibApp.settings.open = false), 1300), 'ok'"


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
    assert user32 is not None
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))

    switch.wipe(args.identifier)
    port = switch.free_port()
    pages = {"/flat": FLAT, "/tall": TALL}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = pages.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    for name, path in (("Flat", "/flat"), ("Tall", "/tall")):
        (space / f"{name}.url").write_text(
            switch.shortcut(f"http://127.0.0.1:{port}{path}", name), encoding="utf-8"
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
        sized(hwnd, 2400, 1600)

        app.open("Idea.md", SPACE)
        time.sleep(2)
        app.open("Tall.url")
        time.sleep(1)
        app.open("Flat.url")
        page = page_view(hwnd)
        own = app_view(hwnd)
        time.sleep(2)

        said["resize"] = [resize(hwnd, page, own) for _ in range(3)]
        for turn in range(2):
            said[f"sidebar open {turn + 1}"] = slide(app, page, own, "nibApp.workspace.showPanel('tree'), 'ok'")
            said[f"sidebar shut {turn + 1}"] = slide(app, page, own, "nibApp.workspace.closePanel(), 'ok'")
        said["resize with the sidebar open"] = resize(hwnd, page, own)

        x, y, right, bottom = rect(page)
        wx, wy, _, _ = rect(hwnd)
        top_right = (right - wx - 30, y - wy + 30)
        bottom_left = (x - wx + 20, bottom - wy - 20)
        said["hover a tab"] = watch(app, hwnd, page, own, HOVER, top_right, 2.6, overlays.shoot)
        said["address suggestions"] = watch(app, hwnd, page, own, SUGGEST, (right - wx - 30, bottom - wy - 30), 2.2, overlays.shoot)
        said["settings"] = watch(app, hwnd, page, own, SETTINGS, bottom_left, 2.6, overlays.shoot)
        said["toast"] = watch(app, hwnd, page, own, TOAST, top_right, 2.4, overlays.shoot)
    finally:
        if running is not None and not close_app(running):
            running.kill()
        server.shutdown()

    print(json.dumps(said, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
