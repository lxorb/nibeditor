"""Zoom in a web tab, Chrome's way, on the packaged app. Windows only.

Ctrl and the wheel over a page did nothing at all - `scripts/web-scroll-probe.py`
measured no step - because the engine's own zoom is off in every webview unless it is
asked for. See "Zoom" in docs/web-tabs.md for what it does now, and `web_page.rs` for why
a zoom made in the page is set again as the app's own.

What it drives, all on pages of its own served here, read back from the page's own
`devicePixelRatio` through the engine's devtools and from the app's own state:

* **the wheel** - a notch of Ctrl and the wheel posted to the page's own window, which
  is exactly what `web_wheel.rs` posts for a real one, zooms the page one rung of
  Chrome's ladder: 110 per cent, and a second notch 125. The dots' percentage says so
  and the site keeps it.
* **the same site** - another page of it opens at that size, rather than back at the
  last size the app set, which is where the engine alone would put it.
* **another site** - opens at a hundred per cent, and the first at its own size again.
* **a site's own** - a page that answers Ctrl and the wheel itself (a map) hears the
  notch, and the page is not zoomed.
* **devtools** - the same notch handed to the engine through its devtools
  (`Input.dispatchMouseEvent` with Ctrl) reaches the page's own handler with Ctrl held.
  The engine takes a wheel from there as a touchpad's, in precise pixels, and zooms
  nothing on one, as Chrome does; the number is written down, not judged.
* **the keys in the app** - Ctrl+=, Ctrl and `+`, Ctrl+- and Ctrl+0, pressed on whatever
  in the app has the keyboard with a page in the focused pane, zoom the page and leave
  the size of a note's words alone.
* **Ctrl+0 inside the page** - the ask the page's own script makes when nothing in the
  page took Ctrl+0, made the same way through devtools with a user's gesture rather than
  as a key: the page is at a hundred per cent and the site forgotten.

What it does not drive: a real wheel, a real key inside the page, or a pinch. Real input
goes to the window under the pointer on the screen, and a probe is never on the screen;
a key pressed inside a page through devtools puts the probe's window in front (see
scripts/web-page-probe.py). The Rust tests hold the hook's part (`web_wheel.rs`), the
script's names (`web_opens.rs`) and the bar's keys (`bar-keys.test.ts`).

    python scripts/web-zoom-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

The exe is a probe build that never updates, built as `scripts/probe_app.py` says;
`run_probe` starts it off the screen and without the keyboard. A posted wheel is aimed by
`WindowFromPoint`, so the window is moved to a corner of this drive's own - on no screen,
which is checked before it moves.
"""

from __future__ import annotations

import argparse
import atexit
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

from probe_app import close_app, main_window, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Web zoom probe"
PORT_FROM = 23940
PORT_TO = 23959

#: This drive's own corner: off every screen, and away from every other probe's.
CORNER = (-29000, -15000)

#: A plain page tall enough to scroll, which says how large it is drawn. `/maps` answers
#: Ctrl and the wheel itself, the way a map or a spreadsheet does, and counts them.
PAGE = """<!doctype html><title>{title}</title>
<body style="margin:0;font:16px system-ui"><div style="height:4000px">{title}</div>
<script>
window.__wheels = []
window.__size = function () {{ return devicePixelRatio }}
addEventListener('wheel', function (event) {{
  window.__wheels.push(event.ctrlKey)
  if ({own} && event.ctrlKey) event.preventDefault()
}}, {{ passive: false }})
</script></body>"""


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


#: The page probe's devtools client and launch, and the scroll probe's windows and wheel.
page_probe = load("page_probe", "web-page-probe.py")
scroll_probe = load("scroll_probe", "web-scroll-probe.py")


def serve() -> int:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            name = self.path.strip("/") or "a"
            body = PAGE.format(title=f"Page {name}", own="true" if name == "maps" else "false")
            data = body.encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args: object) -> None:
            return

    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


#: What every step below is written against, beside the page probe's own helpers: the
#: size the dots say, the text size of a note, and a page along the tab's trail.
PRELUDE = r"""
const menuSize = async () => {
  document.querySelector('.webbar [aria-label="More"]').click()
  const rows = await wait(() => {
    const all = [...document.querySelectorAll('.menu .nib-row')]
    return all.length ? all : null
  })
  const said = (rows ?? []).map((one) => one.textContent.trim()).find((one) => one.endsWith('%'))
  key(window, { key: 'Escape' })
  await new Promise((go) => setTimeout(go, 400))
  return said ?? null
}
const words = () => document.documentElement.style.getPropertyValue('--zoom')
const kept = () => JSON.parse(localStorage.getItem('nib:web-zooms') ?? '{}')
const go = async (url, title) => {
  await invoke('web_navigate', { tab: front().id, url })
  await wait(() => bar()?.value.includes(title) && !document.querySelector('.webbar .turning'))
  await new Promise((done) => setTimeout(done, 1500))
}
"""


def step(app, body: str) -> dict[str, object]:
    return page_probe.step(app, PRELUDE + body)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    page_probe.wipe(args.identifier)
    port = serve()
    home = f"http://127.0.0.1:{port}"
    other = f"http://localhost:{port}"

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-zoom-probe-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    os.environ["NIB_SPACES_DIR"] = str(root)
    made = root / SPACE
    made.mkdir(parents=True)
    (made / "Idea.md").write_text("# Idea\n\nA note to open the space on.\n", encoding="utf-8")
    (made / "Page a.url").write_text(page_probe.shortcut(f"{home}/a", "Page a"), encoding="utf-8")
    # The page probe's launch, with the scroll probe's switches: a devtools port, and a
    # window off the screen drawn at full rate.
    page_probe.ENGINE_ARGS = scroll_probe.ENGINE_ARGS
    scroll_probe.CORNER = CORNER

    said: dict[str, object] = {}
    running = None
    try:
        running, app = page_probe.launch(args.exe, args.identifier)
        close_app(running)
        page_probe.allow_eval(args.identifier)
        time.sleep(1)
        running, app = page_probe.launch(args.exe, args.identifier, unlike=app.port)
        app.ask("(localStorage.setItem('nib:language', 'en'), location.reload(), 1)")
        time.sleep(4)
        window = main_window(running.pid)
        sized(window, *scroll_probe.SIZE)
        scroll_probe.to_corner(window)
        app.act("open", {"path": "Idea.md", "space": SPACE})
        time.sleep(2)

        opened = step(
            app,
            f"""
  ws.openWeb({json.dumps(str(made / 'Page a.url'))})
  return {{ loaded: !!(await wait(() => bar()?.value.includes('Page a'))), words: words() }}
""",
        )
        said["opened"] = opened
        time.sleep(2)

        def page(path: str, expression: str) -> object:
            url = None
            until = time.perf_counter() + 15
            while url is None and time.perf_counter() < until:
                url = page_probe.page_socket(args.identifier, path)
                if url is None:
                    time.sleep(0.3)
            if url is None:
                return None
            tools = page_probe.Devtools(url)
            try:
                return tools.value(expression)
            finally:
                tools.close()

        base = float(page("/a", "__size()") or 0)
        if not base:
            raise SystemExit(f"the page never answered: {opened}")

        def size(path: str = "/a") -> float:
            return round(float(page(path, "__size()") or 0) / base, 2)

        def state(path: str = "/a") -> dict[str, object]:
            got = step(app, "return { menu: await menuSize(), kept: kept(), words: words() }")
            return {"page": size(path), **got}

        input_window, page_window = scroll_probe.page_windows(window)
        x, y = scroll_probe.aimed_at(input_window)

        def notch(up: bool = True) -> None:
            scroll_probe.notch(page_window, x, y, scroll_probe.MK_CONTROL, down=not up)
            time.sleep(1.2)

        notch()
        said["one notch"] = state()
        notch()
        said["two notches"] = state()

        step(app, f"await go('{home}/b', 'Page b'); return 1")
        said["same site"] = state("/b")
        step(app, f"await go('{other}/a', 'Page a'); return 1")
        said["another site"] = state("/a")
        step(app, f"await go('{home}/a', 'Page a'); return 1")
        said["the first again"] = state("/a")

        step(app, f"await go('{home}/maps', 'Page maps'); return 1")
        before = size("/maps")
        notch()
        said["a site's own"] = {
            "before": before,
            "after": size("/maps"),
            "heard with Ctrl": page("/maps", "__wheels.filter(Boolean).length"),
        }

        url = page_probe.page_socket(args.identifier, "/maps")
        tools = page_probe.Devtools(url)
        try:
            tools.value("__wheels = []")
            answer = tools.call(
                "Input.dispatchMouseEvent",
                {"type": "mouseWheel", "x": 300, "y": 300, "deltaX": 0, "deltaY": -120, "modifiers": 2},
            )
        finally:
            tools.close()
        time.sleep(1.2)
        said["devtools"] = {
            "error": answer.get("error"),
            "heard with Ctrl": page("/maps", "__wheels.filter(Boolean).length"),
            "page": size("/maps"),
        }

        step(app, f"await go('{home}/a', 'Page a'); return 1")
        keys: dict[str, object] = {"start": state()}
        for name, init in (
            ("Ctrl+=", "{ key: '=', code: 'Equal', ctrlKey: true }"),
            ("Ctrl++", "{ key: '+', code: 'Equal', ctrlKey: true, shiftKey: true }"),
            ("Ctrl+-", "{ key: '-', code: 'Minus', ctrlKey: true }"),
            ("Ctrl+0", "{ key: '0', code: 'Digit0', ctrlKey: true }"),
        ):
            # On whatever has the keyboard, as a real key is: the window's own handlers run on
            # its way down and back up, in the order a press meets them.
            press = f"key(document.activeElement ?? document.body, {init})"
            step(app, f"{press}; await new Promise((go) => setTimeout(go, 800)); return 1")
            keys[name] = state()
        said["keys in the app"] = keys

        notch()
        before = state()
        # The very ask the page's script makes for Ctrl+0 nothing in the page took.
        url = page_probe.page_socket(args.identifier, "/a")
        tools = page_probe.Devtools(url)
        try:
            tools.call(
                "Runtime.evaluate",
                {"expression": "open('about:blank', 'nib-actual-size'), 1", "userGesture": True},
            )
        finally:
            tools.close()
        time.sleep(1.2)
        said["Ctrl+0 inside the page"] = {"before": before, "after": state()}
    finally:
        if running and not close_app(running):
            running.terminate()

    for name, value in said.items():
        print(f"{name:24} {json.dumps(value)}")

    wrong: list[str] = []
    site = home

    def check(name: str, zoom: float, menu: str, kept: float | None) -> None:
        one = said.get(name, {})
        if not isinstance(one, dict):
            wrong.append(f"{name}: {one}")
            return
        keeps = one.get("kept", {}) if isinstance(one.get("kept"), dict) else {}
        if one.get("page") != zoom or one.get("menu") != menu or keeps.get(site) != kept:
            wrong.append(f"{name}: expected {zoom} / {menu} / kept {kept}, got {one}")

    check("one notch", 1.1, "110%", 1.1)
    check("two notches", 1.25, "125%", 1.25)
    check("same site", 1.25, "125%", 1.25)
    another = said.get("another site", {})
    if not isinstance(another, dict) or another.get("page") != 1 or another.get("menu") != "100%":
        wrong.append(f"another site: expected 100%, got {another}")
    check("the first again", 1.25, "125%", 1.25)
    own = said.get("a site's own", {})
    if not isinstance(own, dict) or own.get("before") != own.get("after") or own.get("heard with Ctrl") != 1:
        wrong.append(f"a site's own: its Ctrl and the wheel zoomed the page or never reached it: {own}")
    tools_said = said.get("devtools", {})
    if not isinstance(tools_said, dict) or tools_said.get("heard with Ctrl") != 1:
        wrong.append(f"devtools: the page did not hear Ctrl and the wheel: {tools_said}")
    keys = said.get("keys in the app", {})
    expected = {"Ctrl+=": 1.5, "Ctrl++": 1.75, "Ctrl+-": 1.5, "Ctrl+0": 1}
    start = keys.get("start", {}) if isinstance(keys, dict) else {}
    for name, zoom in expected.items():
        one = keys.get(name, {}) if isinstance(keys, dict) else {}
        if not isinstance(one, dict) or one.get("page") != zoom or one.get("menu") != f"{round(zoom * 100)}%":
            wrong.append(f"keys in the app: {name} should draw the page at {zoom}: {one}")
        elif isinstance(start, dict) and one.get("words") != start.get("words"):
            wrong.append(f"keys in the app: {name} changed the size of a note's words: {one}")
    reset = said.get("Ctrl+0 inside the page", {})
    after = reset.get("after", {}) if isinstance(reset, dict) else {}
    if not isinstance(after, dict) or after.get("page") != 1 or after.get("menu") != "100%" or after.get("kept"):
        wrong.append(f"Ctrl+0 inside the page: expected 100% and nothing kept, got {reset}")

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
