"""Several cursors, seen: Alt and a click puts another one down, Alt+Shift and a
drag takes a column of them, Ctrl+D grows to the word and then to the next one
like it, every range draws its own smoothed block, typing reaches all of them,
and Escape leaves one.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/cursors.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/cursors/`.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "cursors"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18953
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = (
    "# Cursors\n\n"
    "alpha one alpha\n"
    "beta one beta\n"
    "gamma one gamma\n"
    "delta one delta\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

STATE = """
() => ({
  ranges: window.nib.state.selection.ranges.map((one) => [one.from, one.to]),
  text: window.nib.state.selection.ranges.map((one) =>
    window.nib.state.doc.sliceString(one.from, one.to),
  ),
  carets: document.querySelectorAll('.cm-cursorLayer .cm-cursor').length,
  blocks: document.querySelectorAll('.cm-nib-selection-block').length,
  doc: window.nib.state.doc.toString(),
})
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address, so a run cannot photograph the last one."""

    allow_reuse_address = False


def serve() -> Strict:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
    except OSError as error:
        raise SystemExit(f"something is already listening on {ORIGIN}: {error}") from error

    threading.Thread(target=server.serve_forever, daemon=True).start()

    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)

    raise SystemExit("the file server never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fresh(browser: Browser) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    page.wait_for_timeout(400)

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Cursors'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)
    return page


def at(page: Page, offset: int) -> tuple[float, float]:
    """Where a document offset sits on the screen."""
    box = page.evaluate("(at) => window.nib.coordsAtPos(at)", offset)
    return (box["left"] + 1, (box["top"] + box["bottom"]) / 2)


def place(page: Page, offset: int) -> None:
    page.evaluate(
        """(at) => {
          window.nib.dispatch({ selection: { anchor: at } })
          window.nib.focus()
        }""",
        offset,
    )


def state(page: Page) -> dict:
    return page.evaluate(STATE)


def drive(browser: Browser) -> None:
    page = fresh(browser)
    doc = page.evaluate("() => window.nib.state.doc.toString()")

    # Alt and a click puts a second cursor down.
    place(page, doc.index("alpha one"))
    page.wait_for_timeout(200)
    x, y = at(page, doc.index("gamma one"))
    page.keyboard.down("Alt")
    page.mouse.click(x, y)
    page.keyboard.up("Alt")
    page.wait_for_timeout(400)

    two = state(page)
    say(f"[alt-click] {json.dumps({'ranges': two['ranges'], 'carets': two['carets']})}")
    shot(page, "01-two-cursors")
    if len(two["ranges"]) != 2:
        wrong(f"alt and a click did not add a cursor: {two['ranges']}")
    if two["carets"] < 2:
        wrong(f"only {two['carets']} carets are drawn for {len(two['ranges'])} cursors")

    # And typing reaches both of them.
    page.keyboard.type("X")
    page.wait_for_timeout(400)
    typed = state(page)
    shot(page, "02-typed-into-both")
    if typed["doc"].count("X") != 2:
        wrong(f"typing reached {typed['doc'].count('X')} cursors, not 2")
    page.keyboard.press("Control+z")
    page.wait_for_timeout(300)

    # Escape leaves one.
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    one = state(page)
    say(f"[escape] {len(one['ranges'])} range")
    if len(one["ranges"]) != 1:
        wrong(f"Escape left {len(one['ranges'])} cursors, not one")

    # Ctrl+D: the word, then the next one like it.
    place(page, doc.index("one") + 1)
    page.wait_for_timeout(200)
    page.keyboard.press("Control+d")
    page.wait_for_timeout(300)
    first = state(page)
    say(f"[ctrl-d once] {json.dumps(first['text'])}")
    shot(page, "03-word")
    if first["text"] != ["one"]:
        wrong(f"the first press did not take the word: {first['text']}")
    if first["blocks"] < 1:
        wrong("a selected word draws no block")

    page.keyboard.press("Control+d")
    page.keyboard.press("Control+d")
    page.wait_for_timeout(400)
    more = state(page)
    say(f"[ctrl-d thrice] {json.dumps({'text': more['text'], 'blocks': more['blocks']})}")
    shot(page, "04-three-words")
    if more["text"] != ["one", "one", "one"]:
        wrong(f"the presses after did not add the next ones: {more['text']}")
    if more["blocks"] != 3:
        wrong(f"three ranges drew {more['blocks']} smoothed blocks")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # Alt+Shift and a drag takes a column.
    top = at(page, doc.index("alpha one") + 6)
    bottom = at(page, doc.index("delta one") + 6)
    page.keyboard.down("Alt")
    page.keyboard.down("Shift")
    page.mouse.move(top[0], top[1])
    page.mouse.down()
    page.mouse.move(bottom[0] + 24, bottom[1], steps=8)
    page.mouse.up()
    page.keyboard.up("Shift")
    page.keyboard.up("Alt")
    page.wait_for_timeout(500)

    column = state(page)
    say(f"[alt-shift-drag] {json.dumps({'text': column['text'], 'blocks': column['blocks']})}")
    shot(page, "05-column")
    if len(column["ranges"]) != 4:
        wrong(f"a drag down four lines took {len(column['ranges'])} ranges")
    if column["blocks"] != len([one for one in column["text"] if one]):
        wrong(f"{len(column['ranges'])} ranges drew {column['blocks']} blocks")

    # The crosshair, which is the hint that Alt is doing something.
    page.keyboard.down("Alt")
    page.wait_for_timeout(300)
    pointer = page.evaluate(
        "() => getComputedStyle(document.querySelector('.cm-content')).cursor"
    )
    page.keyboard.up("Alt")
    say(f"[alt held] the pointer is a {pointer}")
    if pointer != "crosshair":
        wrong(f"Alt does not say it is doing something: the pointer is {pointer}")
    shot(page, "06-crosshair")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    left = state(page)
    if len(left["ranges"]) != 1:
        wrong(f"Escape after a column left {len(left['ranges'])} cursors")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                drive(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nseveral cursors, a column of them, and one again on Escape", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
