"""Does the app's own furniture leave a web page on screen? Windows only.

Emil, 2026-09-27, in the installed app: the corner notice *"Nib 0.9.1 is ready to
install"* came up and the whole web page went blank until **Later** was pressed. A web
tab's page is a native webview, which draws above every pixel of HTML in the window, so
the pane hides the page while anything of the app's is over it - and the notice floated
over the pane's corner. It sits in a row of its own under the panes now, beside the page
rather than over it; see `.notices` in App.svelte and docs/web-tabs.md.

The drive asks the pixels, the way web-overlays-probe.py does, of a page in one of two
colours. A photograph cannot tell the page from its still picture - that is the point of
the picture - so whether the page itself is up is asked of the window manager: wry gives
every webview a child window and hides a page by hiding it. So:

* **with the notice up** the page is still up, the pane is the page, and the notice's
  own rectangle is the notice rather than the page;
* **with a menu open** the page is down, the pane is its picture - one of its colours,
  never the window's empty ground - and the menu is in front.

    python scripts/web-furniture-probe.py --exe path/to/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

The exe is a probe build as scripts/probe_app.py says, built in drive mode so the window
carries `window.nibApp` - which is how the notice is put up without a release server:

    --config '{..., "build": {"beforeBuildCommand": "pnpm vite build --mode drive"}}'
"""

from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import pathlib
import shutil
import sys
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "target" / "web-furniture"

# The page's two colours, and how near a pixel has to be to count as one of them.
ONE = (0xFF, 0x00, 0x80)
OTHER = (0x00, 0xC0, 0xFF)
NEAR = 40

PAGE = b"""<!doctype html>
<title>A page that flips</title>
<body style="margin:0;height:100vh;background:#ff0080">
<script>
  let on = false
  setInterval(() => {
    on = !on
    document.body.style.background = on ? '#00c0ff' : '#ff0080'
  }, 250)
</script>
</body>
"""


def borrowed(name: str, path: str):
    """Another drive's helpers, so the two cannot drift apart."""

    spec = importlib.util.spec_from_file_location(name, HERE / path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {path}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def share(shot: pathlib.Path, box: tuple[int, int, int, int]) -> tuple[float, float]:
    """How much of a rectangle of the window is each of the page's two colours."""

    from PIL import Image

    with Image.open(shot) as picture:
        inside = picture.convert("RGB").crop(box)
        ones = others = total = 0
        for seen in inside.getdata():
            total += 1
            if all(abs(a - b) <= NEAR for a, b in zip(seen, ONE)):
                ones += 1
            elif all(abs(a - b) <= NEAR for a, b in zip(seen, OTHER)):
                others += 1

    return ones / max(1, total), others / max(1, total)


# A rectangle of the window, in its own pixels, asked of the window.
WHERE = """(() => {
  const one = document.querySelector('%s')
  if (!one) return JSON.stringify(null)
  const box = one.getBoundingClientRect()
  return JSON.stringify([
    Math.round(box.x), Math.round(box.y), Math.round(box.right), Math.round(box.bottom),
  ])
})()"""


def aware() -> None:
    """Sees the window in the screen's own pixels. A process the system thinks is not
    aware of scaling is handed every size divided by it, and a photograph that size is
    the top left of the window rather than all of it."""

    import ctypes

    # DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    ctypes.WinDLL("user32").SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))


def pages_up(hwnd: int) -> int:
    """How many webviews in the window are on screen at this moment, the app's own
    included: asked of the window manager, because a still picture of a page and the
    page itself are the same pixels. wry gives every webview a child window of its own
    and hides a page by hiding that window."""

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32")
    seen: list[int] = []

    def each(child: int, _lparam: int) -> bool:
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(child, name, 256)
        if name.value == "WRY_WEBVIEW" and user32.IsWindowVisible(child):
            seen.append(child)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumChildWindows(wintypes.HWND(hwnd), kind(each), 0)
    return len(seen)


def mapping(app, hwnd: int):
    """How a rectangle the window reports in its own units lands in a photograph of it:
    scaled by the screen, and moved by whatever frame the window has around its page."""

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32")
    frame = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(frame))
    origin = wintypes.POINT(0, 0)
    user32.ClientToScreen(wintypes.HWND(hwnd), ctypes.byref(origin))
    dx, dy = origin.x - frame.left, origin.y - frame.top
    scale = float(app.ask("String(window.devicePixelRatio)") or 1)

    def placed(box: list[int], by: int = 12) -> tuple[int, int, int, int]:
        return (
            round(box[0] * scale) + dx + by,
            round(box[1] * scale) + dy + by,
            round(box[2] * scale) + dx - by,
            round(box[3] * scale) + dy - by,
        )

    return placed


def photographs(overlays, hwnd: int, name: str, box: tuple[int, int, int, int]):
    """Four photographs a little apart, and each one's share of the two colours."""

    shares = []
    for at in range(4):
        shot = overlays.shoot(hwnd, f"{name}-{at}")
        shares.append(share(shot, box))
        time.sleep(0.13)
    return shares


def main() -> int:
    if sys.platform != "win32":
        print("this drive photographs a Windows window")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    aware()
    switch = borrowed("switch", "web-switch-probe.py")
    overlays = borrowed("overlays", "web-overlays-probe.py")
    probe_app = borrowed("probe_app", "probe_app.py")
    overlays.OUT = OUT
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    switch.wipe(args.identifier)
    port = switch.free_port()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "A page that flips.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/", "A page that flips"), encoding="utf-8"
    )

    said: dict[str, object] = {}
    failures: list[str] = []
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        probe_app.close_app(running)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        running, app, hwnd = switch.launch(args.exe, args.identifier, unlike=app.port)
        # The launch sizes the window in the screen's pixels; a scaled screen then has a
        # window too narrow for the bar. The same 1180 by 820 the browser drives use.
        scale = float(app.ask("String(window.devicePixelRatio)") or 1)
        probe_app.sized(hwnd, round(1180 * scale), round(820 * scale))
        time.sleep(1.5)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A page that flips.url")
        time.sleep(6)

        inset = mapping(app, hwnd)
        bare = app.ask(WHERE % ".hole")
        if not isinstance(bare, list):
            raise SystemExit(f"no web page on screen: {bare}")
        said["the page alone"] = bare
        said["webviews up with the page alone"] = alone = pages_up(hwnd)
        overlays.shoot(hwnd, "page-alone")

        # The notice, put up the way a finished download puts it up.
        app.ask("(() => { window.nibApp.updates.ready = '0.9.1'; return 'null' })()")
        time.sleep(1.5)
        notice = app.ask(WHERE % ".notice")
        page = app.ask(WHERE % ".hole")
        said["the notice"] = notice
        said["the page beside it"] = page
        if not isinstance(notice, list) or not isinstance(page, list):
            raise SystemExit("the notice or the page is not on screen")
        if notice[1] < page[3]:
            failures.append("the notice is drawn over the page's rectangle")

        shares = photographs(overlays, hwnd, "notice", inset(page))
        said["the page under the notice, four shots"] = [
            [round(a, 2), round(b, 2)] for a, b in shares
        ]
        if any(a + b < 0.9 for a, b in shares):
            failures.append("with the notice up the pane is not the page")
        said["webviews up with the notice"] = up = pages_up(hwnd)
        if up < alone:
            failures.append("with the notice up the page was hidden: it is a picture, not live")
        mine = share(OUT / "notice-0.png", inset(notice, 4))
        said["the page inside the notice"] = [round(one, 2) for one in mine]
        if sum(mine) > 0.1:
            failures.append("the notice is behind the page")

        app.ask("(() => { window.nibApp.updates.dismiss(); return 'null' })()")
        time.sleep(1)
        said["the page after Later"] = app.ask(WHERE % ".hole")

        # The dots menu, which is a layer somebody opened over the page: the page goes,
        # and its picture stands in.
        app.ask("document.querySelector('.webbar button[aria-label=\"More\"]').click()")
        time.sleep(1.2)
        menu = app.ask(WHERE % ".menu, [role=menu]")
        said["the menu"] = menu
        if not isinstance(menu, list):
            raise SystemExit("the menu never opened")

        shares = photographs(overlays, hwnd, "menu", inset(page))
        said["the page under the menu, four shots"] = [
            [round(a, 2), round(b, 2)] for a, b in shares
        ]
        if any(a + b < 0.6 for a, b in shares):
            failures.append("under the menu the pane is not the page's picture: it went blank")
        said["webviews up with the menu"] = under = pages_up(hwnd)
        if under >= alone:
            failures.append("under the menu the page is still up: it is in front of the menu")
        mine = share(OUT / "menu-0.png", inset(menu, 4))
        said["the page inside the menu"] = [round(one, 2) for one in mine]
        if sum(mine) > 0.1:
            failures.append("the menu is behind the page")

        app.ask("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
        time.sleep(0.8)
    finally:
        if running is not None and not probe_app.close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    print(f"\nthe photographs are in {OUT}")
    for one in failures:
        print(f"FAIL: {one}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
