"""A swipe over a note and over a page, in the native app, from wheel messages posted to
the probe's own window. Windows only.

Emil, 2026-10-03: *"Swiping (left/right) to go to the previous / redo page."* See
apps/desktop/src/lib/back-swipe for the gesture and src-tauri/src/web_swipe.rs for a
page's half. What a drive in a browser cannot reach, and this does:

* **a note** - sideways wheel messages, a fraction of a notch each the way a touchpad
  that is not under Direct Manipulation reports, posted to the window of the app's own
  page: the arrow comes in, and the tab goes back to the note it showed before; the same
  the other way goes forward again;
* **a page** - the same posted to the window of a site's page in a web tab: the script
  in nib's world there says it through its binding, the crate says it to the window, and
  the tab goes back along its trail;
* **the arrow over the page** - while it is out, the page's window is given a region
  with the arrow's circle cut out of it, and once it has gone the whole page again.

No real input is used and nothing is ever on a screen: the probe is started by
`run_probe` and moved to a corner of this probe's own, still on no screen, so the point
each message carries is over its own window (the engine aims a posted wheel at whatever
`WindowFromPoint` finds there). A precision touchpad's own report reaches a page through
Direct Manipulation, which only a hand starts; gesture.test.ts holds the numbers.

    python scripts/swipe-probe.py --exe apps/desktop/src-tauri/target/debug/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

The exe is a probe build that never updates, built as `scripts/probe_app.py` says.
"""

from __future__ import annotations

import argparse
import atexit
import ctypes
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import socket
import sys
import tempfile
import threading
import time
from ctypes import wintypes

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Swipe probe"

#: This probe's own corner, off every screen and away from every other probe's.
CORNER = (-27000, -13000)

#: The window, in physical pixels.
SIZE = (2000, 1400)

WM_MOUSEHWHEEL = 0x020E

#: A fraction of a notch a message: a wheel that turns finer than a notch, which is how a
#: touchpad's scroll reaches a window that is not reading it through Direct Manipulation.
#: Not a third: the engine adds up messages that arrive within a frame, and three thirds
#: would be one whole notch, which a swipe never starts on.
STEP = 35

#: The engine's own switches for the probe's process only: a devtools port, and a window
#: off the screen drawn at full rate rather than as one nobody can see.
ENGINE_ARGS = (
    "--remote-debugging-port=0 --disable-features=CalculateNativeWinOcclusion "
    "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
)

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
gdi32 = ctypes.WinDLL("gdi32") if sys.platform == "win32" else None
if user32 is not None:
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    user32.WindowFromPoint.restype = wintypes.HWND
    user32.WindowFromPoint.argtypes = [wintypes.POINT]
    user32.GetParent.restype = wintypes.HWND
    user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]


def borrowed(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


page_probe = borrowed("web-page-probe")
scroll_probe = borrowed("web-scroll-probe")
scroll_probe.CORNER = CORNER

#: Two pages of a site, each linking to the other.
PAGES = {
    "/one": b"<!doctype html><title>One</title><body style='font:20px system-ui'><h1>One</h1>",
    "/two": b"<!doctype html><title>Two</title><body style='font:20px system-ui'><h1>Two</h1>",
}


def serve() -> tuple[http.server.ThreadingHTTPServer, int]:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = PAGES.get(self.path.split("?")[0])
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"")

        def log_message(self, *_args: object) -> None:
            return

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, port


def sweep(target: int, x: int, y: int, steps: int, turn: int) -> None:
    """`steps` sideways turns of `turn` each, posted to `target` as Windows writes them,
    twelve milliseconds apart. A turn below nought scrolls towards the left, which is the
    fingers moving right: Back."""
    assert user32 is not None
    word = turn & 0xFFFF
    for _ in range(steps):
        user32.PostMessageW(
            wintypes.HWND(target), WM_MOUSEHWHEEL, word << 16, ((y & 0xFFFF) << 16) | (x & 0xFFFF)
        )
        time.sleep(0.012)


def region_holes(hwnd: int) -> int | None:
    """The size of the window's region, or None for no region: a page whole has none,
    and one with something of the app's cut out of it has one (see web_cut.rs)."""
    assert user32 is not None and gdi32 is not None
    region = gdi32.CreateRectRgn(0, 0, 0, 0)
    try:
        kind = user32.GetWindowRgn(wintypes.HWND(hwnd), region)
        if kind == 0:  # ERROR: no region
            return None
        size = gdi32.GetRegionData(region, 0, None)
        return int(size)
    finally:
        gdi32.DeleteObject(region)


def webviews(window: int) -> list[int]:
    """The webviews on the window, largest first: the app's own page, then a site's."""
    assert user32 is not None
    shown = [
        one
        for one in scroll_probe.children(window)
        if scroll_probe.class_of(one) == "WRY_WEBVIEW" and user32.IsWindowVisible(wintypes.HWND(one))
    ]

    def area(one: int) -> int:
        left, top, right, bottom = scroll_probe.rect(one)
        return (right - left) * (bottom - top)

    return sorted(shown, key=area, reverse=True)


def app_input(window: int) -> tuple[int, int]:
    """The app's own page's input window and its parent."""
    assert user32 is not None
    app = webviews(window)[0]
    inputs = [one for one in scroll_probe.children(app) if scroll_probe.class_of(one) == "Chrome_RenderWidgetHostHWND"]
    if not inputs:
        raise SystemExit("the app's webview has no input window")
    return inputs[0], int(user32.GetParent(wintypes.HWND(inputs[0])) or 0)


PRELUDE = r"""
const ws = nib.workspace
const wait = async (ok, ms = 15000) => {
  const until = performance.now() + ms
  for (;;) {
    const got = await ok()
    if (got) return got
    if (performance.now() > until) return null
    await new Promise((go) => setTimeout(go, 100))
  }
}
"""

#: Whether the arrow came in at all, kept by the page since the last `WATCH`.
WATCH = """
window.__arrow = false
window.__watching?.disconnect()
window.__watching = new MutationObserver(() => {
  if (document.querySelector('.nib-swipe')) window.__arrow = true
})
window.__watching.observe(document.body, { childList: true, subtree: true })
return true
"""


def ask(app, body: str) -> object:
    return app.ask(f"(async () => {{ {PRELUDE}\n{body} }})()")


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    page_probe.wipe(args.identifier)
    server, port = serve()
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-swipe-probe-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    space = root / SPACE
    space.mkdir(parents=True)
    (space / "Alpha.md").write_text("# Alpha\n\nThe first note.\n", encoding="utf-8")
    (space / "Beta.md").write_text("# Beta\n\nThe second note.\n", encoding="utf-8")
    (space / "Site.url").write_text(page_probe.shortcut(f"http://127.0.0.1:{port}/one", "Site"), encoding="utf-8")
    env = {**os.environ, "NIB_SPACES_DIR": str(root), "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": ENGINE_ARGS}

    said: dict[str, object] = {}
    failed: list[str] = []

    # Once to write the endpoint file, and again with `eval` turned on in it.
    running = run_probe(args.exe, env=env, quiet=True)
    first, _, _ = page_probe.endpoint(args.identifier)
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not main_window(running.pid):
        time.sleep(0.2)
    time.sleep(1.5)
    close_app(running)
    page_probe.allow_eval(args.identifier)
    time.sleep(1)

    running = run_probe(args.exe, env=env, quiet=True)
    try:
        endpoint, secret, pid = page_probe.endpoint(args.identifier, unlike=first)
        if pid and pid != running.pid:
            raise SystemExit(f"another nib (pid {pid}) is listening under {args.identifier}")
        app = page_probe.App(endpoint, secret)
        window = 0
        until = time.perf_counter() + 90
        while not window and time.perf_counter() < until:
            window = main_window(running.pid)
            time.sleep(0.2)
        if not window:
            raise SystemExit("the app never showed its window")
        sized(window, *SIZE)
        scroll_probe.to_corner(window)
        time.sleep(2)

        # A note tab that has shown Alpha and then Beta, once the launch is over: the
        # listeners are fetched at its last turn.
        said["trail"] = ask(
            app,
            """
            await wait(() => ws.notes.length >= 2 &&
              performance.getEntriesByName('nib: launch order finished').length > 0, 40000)
            const path = (starts) => ws.notes.find((one) => one.name.startsWith(starts)).path
            // Whatever the launch opened goes, so both notes pass through one tab.
            for (const one of [...ws.tabs]) ws.close(one.id)
            await ws.open(path('Alpha'), { preview: true })
            await ws.open(path('Beta'), { preview: true })
            await wait(() => document.querySelector('.cm-content'))
            await new Promise((go) => setTimeout(go, 500))
            return {
              back: ws.active?.canGoBack,
              note: ws.active?.note?.name,
              tabs: ws.tabs.map((one) => [one.kind, one.trail?.length, one.id === ws.previewTabId]),
            }
            """,
        )
        _, page = app_input(window)
        box = scroll_probe.rect(page)
        x, y = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
        ask(app, WATCH)
        sweep(page, x, y, 40, -STEP)
        time.sleep(0.8)
        back = ask(app, "return { note: ws.active?.note?.name, arrow: window.__arrow }")
        said["note, swept back"] = back
        if not (isinstance(back, dict) and str(back.get("note", "")).startswith("Alpha") and back.get("arrow")):
            failed.append(f"a sweep over a note did not go back with the arrow: {back}")

        ask(app, WATCH)
        sweep(page, x, y, 40, STEP)
        time.sleep(0.8)
        forward = ask(app, "return { note: ws.active?.note?.name, arrow: window.__arrow }")
        said["note, swept forward"] = forward
        if not (isinstance(forward, dict) and str(forward.get("note", "")).startswith("Beta")):
            failed.append(f"a sweep over a note did not go forward: {forward}")

        ask(app, WATCH)
        sweep(page, x, y, 6, -STEP)
        time.sleep(0.8)
        short = ask(app, "return { note: ws.active?.note?.name, arrow: window.__arrow }")
        said["note, a short sweep"] = short
        if not (isinstance(short, dict) and str(short.get("note", "")).startswith("Beta")):
            failed.append(f"a short sweep went somewhere: {short}")

        # A web tab on one page and then the other.
        app.act("open", {"path": "Site.url", "space": SPACE})
        url = None
        until = time.perf_counter() + 40
        while url is None and time.perf_counter() < until:
            url = page_probe.page_socket(args.identifier, "/one")
            time.sleep(0.5)
        if url is None:
            raise SystemExit("the site's page never answered")
        tools = page_probe.Devtools(url)
        try:
            tools.value("location.href = '/two'")
        finally:
            tools.close()
        said["web tab"] = ask(
            app,
            """
            const tab = await wait(() => ws.tabs.find((one) => one.kind === 'web'))
            await wait(() => String(nib.pages?.of?.(tab.id)?.url ?? tab.address ?? '').endsWith('/two'), 8000)
            await new Promise((go) => setTimeout(go, 800))
            return { address: tab.address, active: ws.active?.id === tab.id }
            """,
        )
        _, site_page = scroll_probe.page_windows(window)
        site = webviews(window)[-1]
        box = scroll_probe.rect(site_page)
        x, y = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
        ask(app, WATCH)
        holes: list[int | None] = []
        sweep(site_page, x, y, 30, -STEP)
        holes.append(region_holes(site))
        sweep(site_page, x, y, 10, -STEP)
        holes.append(region_holes(site))
        time.sleep(1.2)
        holes.append(region_holes(site))
        said["page's region while swiping, and after"] = holes
        tools = None
        url = None
        until = time.perf_counter() + 10
        while url is None and time.perf_counter() < until:
            url = page_probe.page_socket(args.identifier, "/one")
            time.sleep(0.3)
        went = ask(app, "return { arrow: window.__arrow }")
        said["page, swept back"] = {"on one": url is not None, **(went if isinstance(went, dict) else {})}
        if url is None:
            failed.append("a sweep over a page did not take its tab back")
        if not (isinstance(went, dict) and went.get("arrow")):
            failed.append("no arrow came in over the page")
        if not any(one is not None for one in holes[:2]):
            failed.append(f"the arrow was not cut out of the page: {holes}")
        if holes[2] is not None:
            failed.append(f"the page was not whole again after the arrow: {holes}")
    finally:
        if not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2, default=str))
    for one in failed:
        print(f"FAIL: {one}")
    if not failed:
        print("swipes go back and forward over a note and a page")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
