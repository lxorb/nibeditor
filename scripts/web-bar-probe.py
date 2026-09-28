"""The web tab's bar and keys, driven in a native Windows build.

What it asks, each against a page served on the loopback that counts its own requests:

* **F6 inside the page** reaches the address field: the crate takes it before the page
  sees it (`web_keys.rs`) and the bar reads it as Chrome's way out of the page.
* **F5 inside the page** is the engine's own reload, which needs nothing of nib's.
* **F5, Ctrl+R and Ctrl+Shift+R in the app** reload the page in front and never
  present anything; the last goes past the cache, which the request says
  (`Cache-Control: no-cache`).
* **The reload glyph is a cross while a page is coming**, and pressing it stops it.
* **A right click on Back lists the pages behind**, nearest first, and a row two steps
  back goes there in one jump with the trail kept whole (`web_trail`, `web_step`).
* **Alt+Enter in the address field** opens a tab of its own and leaves this one.
* **The middle button on reload** opens the page again in a tab behind.
* **Ctrl+1 in the app** jumps to the first tab while a page is in front.

Keys inside the page are posted to the engine's own window, which is what the keyboard
would deliver: nothing touches the real keyboard or mouse, and the reader's window stays
in front. Only keys with no modifier can be posted that way - the crate asks the keyboard
whether Ctrl is down - so Ctrl+L and Alt+D inside a page are left to web_keys.rs's own
tests.

    python scripts/web-bar-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says, with its window opening off the screen
and without the focus, so the drive never comes up in front of anybody; the switch
drive's launch puts it on the screen, and this puts it back off. Nothing here needs the
window on screen: the keys are posted and the rest is read out of the page.
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

from probe_app import close_app, main_window

HERE = pathlib.Path(__file__).resolve().parent

VK_F5 = 0x74
VK_F6 = 0x75


def borrowed(name: str, file: str):
    """Another drive's helpers, read from its file: the names have dashes in them."""

    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


switch = borrowed("switch", "web-switch-probe.py")
cursor = borrowed("cursor", "web-cursor-probe.py")

#: Every request the server has had: the path and the cache header it came with.
HEARD: list[tuple[str, str]] = []


def page(name: str) -> bytes:
    return f"""<!doctype html>
<title>{name}</title>
<body style="margin:0;font:16px system-ui">
<h1 style="margin:0;padding:2rem">{name}</h1>
<input id="field" style="margin:2rem">
</body>
""".encode()


def serve(port: int) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            HEARD.append((path, self.headers.get("cache-control") or ""))
            if path == "/slow":
                time.sleep(6)
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "max-age=600")
            self.end_headers()
            self.wfile.write(page(path.strip("/") or "home"))

        def log_message(self, *_args: object) -> None:
            return

    made = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    made.daemon_threads = True
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def hits(path: str) -> list[str]:
    return [header for heard, header in HEARD if heard == path]


def post_key(engine: int, vk: int) -> None:
    """A key with no modifier, posted to an engine window with the focus on it."""

    assert cursor.user32 is not None
    cursor.focus(engine)
    cursor.user32.PostMessageW(cursor.wintypes.HWND(engine), cursor.WM_KEYDOWN, vk, 0x0000_0001)
    cursor.user32.PostMessageW(cursor.wintypes.HWND(engine), cursor.WM_KEYUP, vk, 0xC000_0001)
    time.sleep(1.2)


def key_in_app(app, key: str, code: str, **held: bool) -> object:
    """A key pressed in the app's own page, with nothing in the page having the keyboard:
    played on the window, which is where the app reads its keys."""

    init = {"key": key, "code": code, "bubbles": True, "cancelable": True}
    init.update({f"{name}Key": value for name, value in held.items()})
    return app.ask(
        "(() => { document.activeElement?.blur();"
        f" window.dispatchEvent(new KeyboardEvent('keydown', {json.dumps(init)}));"
        " return JSON.stringify(true) })()"
    )


def bar(app) -> object:
    """What the reload glyph says it would do, and what has the keyboard."""

    return app.ask(
        """JSON.stringify({
  glyph: document.querySelectorAll('.webbar .nib-glyph')[2]?.getAttribute('aria-label'),
  focused: document.activeElement?.getAttribute('aria-label') ?? null,
  presenting: !!document.querySelector('.deck, .present'),
})"""
    )


def away(window: int) -> None:
    """The window off the screen again, at the size the launch gave it, without taking
    the focus: SWP_NOZORDER | SWP_NOACTIVATE."""

    assert cursor.user32 is not None
    cursor.user32.SetWindowPos(window, None, -32000, -32000, 1280, 860, 0x0004 | 0x0010)


def invoke(app, command: str, args: dict[str, object]) -> object:
    return app.ask(
        "(async () => { try { return JSON.stringify(await window.__TAURI_INTERNALS__.invoke("
        + json.dumps(command)
        + ", "
        + json.dumps(args)
        + ")) } catch (error) { return JSON.stringify({ error: String(error) }) } })()"
    )


def go(app, tab: str, url: str) -> None:
    invoke(app, "web_navigate", {"tab": tab, "url": url})
    time.sleep(2.5)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch.wipe(args.identifier)
    port = switch.free_port()
    server = serve(port)
    base = f"http://127.0.0.1:{port}"

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "A page.url").write_text(switch.shortcut(f"{base}/a", "A page"), encoding="utf-8")

    said: dict[str, object] = {}
    running = None
    try:
        running, app, shown_at = switch.launch(args.exe, args.identifier)
        away(shown_at)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)

        running, app, shown_at = switch.launch(args.exe, args.identifier, unlike=app.port)
        away(shown_at)
        window = 0
        until = time.perf_counter() + 90
        while not window and time.perf_counter() < until:
            window = main_window(running.pid)
            time.sleep(0.2)
        if not window:
            raise SystemExit("the app never showed its window")

        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A page.url")
        time.sleep(6)
        tab = switch.tab_of(app, "A page")
        if tab is None:
            raise SystemExit("the web tab never opened")

        shown = [one for one in cursor.engines(window) if one[2]]
        if len(shown) != 2:
            raise SystemExit(f"expected the app's page and the site's, found {shown}")
        site = min(shown, key=lambda one: cursor.area(one[0]))[1]

        # F6 inside the page: the keyboard leaves the page for the address field.
        post_key(site, VK_F6)
        said["F6 in the page: what has the keyboard"] = bar(app)

        # F5 inside the page: the engine's own reload.
        before = len(hits("/a"))
        post_key(site, VK_F5)
        time.sleep(1)
        said["F5 in the page: requests"] = len(hits("/a")) - before

        # F5, Ctrl+R, Ctrl+Shift+R and Ctrl+F5 in the app, with the page in front.
        for name, key, code, held in [
            ("F5", "F5", "F5", {}),
            ("Ctrl+R", "r", "KeyR", {"ctrl": True}),
            ("Ctrl+Shift+R", "R", "KeyR", {"ctrl": True, "shift": True}),
            ("Ctrl+F5", "F5", "F5", {"ctrl": True}),
        ]:
            before = len(hits("/a"))
            key_in_app(app, key, code, **held)
            time.sleep(2)
            fresh = hits("/a")[before:]
            said[f"{name} in the app: requests, cache header"] = [len(fresh), fresh[-1:] or None]
        said["after the reloads"] = bar(app)

        # The cross, and stopping.
        invoke(app, "web_navigate", {"tab": tab, "url": f"{base}/slow"})
        time.sleep(1)
        said["while /slow is coming"] = bar(app)
        app.ask(
            "(() => { document.querySelectorAll('.webbar .nib-glyph')[2]?.click();"
            " return JSON.stringify(true) })()"
        )
        time.sleep(1)
        said["after the cross"] = bar(app)
        time.sleep(7)
        said["the tab's address once /slow would have answered"] = app.ask(
            "JSON.stringify(nib.workspace.tabs.find((one) => one.id === '"
            + tab
            + "')?.address ?? null)"
        )
        said["the page's own title then"] = switch.place(app, tab)

        # The history under a held Back.
        for path in ("/b", "/c"):
            go(app, tab, f"{base}{path}")
        said["trail"] = invoke(app, "web_trail", {"tab": tab})
        app.ask(
            """(() => {
  const back = document.querySelector('.webbar .nib-glyph')
  const box = back.getBoundingClientRect()
  back.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: box.left + 4, clientY: box.bottom + 2,
  }))
  return JSON.stringify(true)
})()"""
        )
        time.sleep(1.5)
        said["rows under Back"] = app.ask(
            "JSON.stringify([...document.querySelectorAll('[role=menu] [role=menuitem]')]"
            ".map((one) => one.textContent.trim()))"
        )
        app.ask(
            "(() => { document.querySelectorAll('[role=menu] [role=menuitem]')[1]?.click();"
            " return JSON.stringify(true) })()"
        )
        time.sleep(3)
        said["trail after the second row"] = invoke(app, "web_trail", {"tab": tab})

        # Alt+Enter in the address field.
        count = app.ask("JSON.stringify(nib.workspace.tabs.length)")
        app.ask(
            f"""(() => {{
  const field = document.querySelector('.webbar input')
  field.focus()
  field.value = '{base}/d'
  field.dispatchEvent(new InputEvent('input', {{ bubbles: true }}))
  field.dispatchEvent(new KeyboardEvent('keydown', {{
    key: 'Enter', code: 'Enter', altKey: true, bubbles: true, cancelable: true,
  }}))
  return JSON.stringify(true)
}})()"""
        )
        time.sleep(3)
        said["Alt+Enter: tabs before, after, and the new one's address"] = [
            count,
            app.ask("JSON.stringify(nib.workspace.tabs.length)"),
            app.ask("JSON.stringify(nib.workspace.active?.address ?? null)"),
        ]
        said["and the first tab's address"] = app.ask(
            "JSON.stringify(nib.workspace.tabs.find((one) => one.id === '"
            + tab
            + "')?.address ?? null)"
        )

        # The middle button on reload: the page again, behind.
        count = app.ask("JSON.stringify(nib.workspace.tabs.length)")
        app.ask(
            "(() => { document.querySelectorAll('.webbar .nib-glyph')[2]?.dispatchEvent("
            "new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));"
            " return JSON.stringify(true) })()"
        )
        time.sleep(2)
        said["middle button on reload: tabs before, after, the one in front"] = [
            count,
            app.ask("JSON.stringify(nib.workspace.tabs.length)"),
            app.ask("JSON.stringify(nib.workspace.active?.address ?? null)"),
        ]

        # Ctrl+1 with a page in front: the first tab along the strip.
        said["the strip"] = app.ask(
            "JSON.stringify(nib.workspace.tabsIn(nib.workspace.panes.focusedId)"
            ".map((one) => one.name))"
        )
        key_in_app(app, "1", "Digit1", ctrl=True)
        time.sleep(1)
        said["Ctrl+1: the tab in front"] = app.ask("JSON.stringify(nib.workspace.active?.name)")
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    for name, value in said.items():
        print(f"{name}: {json.dumps(value)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
