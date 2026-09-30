"""Full window in a native build: a web tab's page is placed over the whole window but its
own bar, in one step.

A web tab's page is a webview of its own that the crate places over the pane, so what the
browser build can only measure as a box, this one measures as the window it is: the page's
webview, asked of Windows, against the app window's content area.

  * **Before**: the page's webview is exactly where the pane's hole is.
  * **Filled** (the palette's row, `commands.run full-window`): the webview spans the
    window's content area from edge to edge and down to its foot, under the web tab's own
    bar - and it got there in one placement, not one a frame.
  * **Back**: the webview is where it was before.

Nothing presses a key or moves the pointer: the fill is asked for over the local endpoint,
and the probe is started by `run_probe`, off every screen and never in front. Keys inside a
page are not posted either - the crate asks the keyboard for Shift, which a posted key
does not hold - so Shift+F11 in a page is `web_keys.rs`'s own tests.

    NIB_PROBE_EXE=path/to/nib.exe NIB_PROBE_IDENTIFIER=ch.emilvinu.nib.probe.<name> \\
      python apps/desktop/test/e2e/full-window-native.py

Build the exe as scripts/probe_app.py says.
"""

from __future__ import annotations

import ctypes
import http.server
import importlib.util
import json
import os
import sys
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any

from harness import ROOT, Drive, Native, identifier_of

NEEDS = ("native",)

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong

SPACE = "Full window"
PAGE = "A page"


def borrowed(name: str, file: str) -> Any:
    """Another probe's helpers, read from its file: the names have dashes in them."""
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Page(http.server.BaseHTTPRequestHandler):
    """A tall page, served on the loopback, for the tab to hold."""

    def do_GET(self) -> None:  # noqa: N802 - the name http.server wants
        body = b"<!doctype html><title>A page</title><body style='margin:0;height:3000px'>page"
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass


def rect_of(hwnd: int, user32: Any) -> tuple[int, int, int, int]:
    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    return box.left, box.top, box.right, box.bottom


def content_of(hwnd: int, user32: Any) -> tuple[int, int, int, int]:
    """The window's content area, in the screen's own pixels."""
    box = wintypes.RECT()
    user32.GetClientRect(wintypes.HWND(hwnd), ctypes.byref(box))
    corner = wintypes.POINT(0, 0)
    user32.ClientToScreen(wintypes.HWND(hwnd), ctypes.byref(corner))
    return corner.x, corner.y, corner.x + box.right, corner.y + box.bottom


# The hole the page is placed over, and every `web_place` the window asks for from now on.
WATCH = """(() => {
  const internals = window.__TAURI_INTERNALS__
  if (!internals.watched) {
    const invoke = internals.invoke.bind(internals)
    internals.placed = []
    internals.invoke = (command, args, options) => {
      if (command === 'web_place') internals.placed.push({ ...args.pane, visible: args.visible })
      return invoke(command, args, options)
    }
    internals.watched = true
  }
  internals.placed = []
  return JSON.stringify(true)
})()"""

HOLE = """(() => {
  const hole = document.querySelector('.hole')?.getBoundingClientRect()
  return JSON.stringify({
    hole: hole ? [hole.x, hole.y, hole.width, hole.height] : null,
    scale: devicePixelRatio,
    fills: nib.workspace.panes.fills,
    placed: window.__TAURI_INTERNALS__.placed ?? [],
  })
})()"""


def near(one: tuple[int, ...], other: tuple[int, ...], slack: int = 2) -> bool:
    return all(abs(a - b) <= slack for a, b in zip(one, other, strict=True))


def drive(_browser: object) -> None:
    if sys.platform != "win32":
        raise SystemExit("this probe drives a Windows build")

    exe = Path(os.environ["NIB_PROBE_EXE"])
    identifier = identifier_of(exe)
    # Refused here, before anything is started, if the build is the reader's own nib.
    native = Native(DRIVE, exe)
    switch = borrowed("switch", "web-switch-probe.py")
    cursor = borrowed("cursor", "web-cursor-probe.py")
    user32 = ctypes.WinDLL("user32", use_last_error=True)

    origin = DRIVE.side(Page)
    switch.wipe(identifier)
    space = native.spaces / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / f"{PAGE}.url").write_text(switch.shortcut(f"{origin}/page", PAGE), encoding="utf-8")

    # Once to write the endpoint, once more with `eval` on: the crate reads the flag as it
    # opens the socket.
    app = native.start()
    port, _ = switch.endpoint(identifier, 90)
    native.probe.close_app(app)
    switch.allow_eval(identifier)
    app = native.start()
    port, secret = switch.endpoint(identifier, 90, unlike=port)
    asked = switch.App(port, secret)

    window = 0
    until = time.perf_counter() + 90
    while not window and time.perf_counter() < until:
        window = native.probe.main_window(app.pid)
        time.sleep(0.2)
    if not window:
        raise SystemExit("the app never showed its window")
    native.probe.sized(window, 1280, 860)
    time.sleep(1.5)

    asked.open("Idea.md", SPACE)
    time.sleep(2)
    asked.open(f"{PAGE}.url")

    site = 0
    until = time.perf_counter() + 60
    while not site and time.perf_counter() < until:
        shown = [one for one in cursor.engines(window) if one[2]]
        if len(shown) == 2:
            site = min(shown, key=lambda one: cursor.area(one[0]))[0]
        time.sleep(0.3)
    if not site:
        raise SystemExit("the page never came up beside the app's own")
    time.sleep(1)

    content = content_of(window, user32)
    before = rect_of(site, user32)
    said = asked.ask(HOLE)
    say(f"content {content}, page {before}, {json.dumps(said)}")
    scale = float(said["scale"])
    x, y, width, height = said["hole"]
    hole = (
        content[0] + round(x * scale),
        content[1] + round(y * scale),
        content[0] + round((x + width) * scale),
        content[1] + round((y + height) * scale),
    )
    if not near(before, hole):
        wrong(f"before filling, the page {before} is not over its hole {hole}")

    asked.ask(WATCH)
    ran = switch.act(port, secret, "commands.run", {"id": "full-window"})
    say(f"commands.run full-window: {ran}")
    time.sleep(2)

    filled = rect_of(site, user32)
    said = asked.ask(HOLE)
    say(f"filled: page {filled}, {json.dumps(said)}")
    if not said.get("fills"):
        wrong("the palette's row did not fill the window")
    bar = round(said["hole"][1] * scale)
    wanted = (content[0], content[1] + bar, content[2], content[3])
    if not near(filled, wanted):
        wrong(f"filled, the page is {filled} rather than the content area under its bar {wanted}")
    places = {(one["x"], one["y"], one["width"], one["height"]) for one in said["placed"] if one["visible"]}
    if len(places) != 1:
        wrong(f"the page was placed at {len(places)} rectangles on the way in, not one: {places}")

    switch.act(port, secret, "commands.run", {"id": "full-window"})
    time.sleep(2)
    after = rect_of(site, user32)
    say(f"back: page {after}")
    if not near(after, before):
        wrong(f"back, the page is {after} rather than where it was, {before}")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the page fills the window in one step", browser=False))
