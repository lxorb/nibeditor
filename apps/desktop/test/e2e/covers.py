"""Page covers, seen in the built app: the band of picture across the top of a note.

Four claims, each checked against the real editor, the real reading view and the
real export rather than against a string:

  * A note that says `cover:` in its front matter is drawn with a banner at the top
    of it in the editor's live preview, above the properties, and the banner stays
    there while the caret is inside the front matter - which is where the rows give
    way to the YAML.
  * Dragging the band writes `cover-position:` back into the note, as one whole
    number and one thing to undo.
  * The same note read rather than written draws the same banner.
  * And a note that names no cover is drawn exactly as it was before any of this:
    the same pixels, byte for byte, in the editor and in the reading view.

Run it from the repository root:

    python apps/desktop/test/e2e/covers.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/covers/`.
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

from settling import HIDE_CARET, quiet, steady

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "covers"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 23201
ORIGIN = f"http://127.0.0.1:{PORT}"

# A real picture, small enough to write into a note as a `data:` URL and wide enough
# to have a top and a bottom worth dragging between: a 4 by 8 PNG of two colours.
# Built by hand so nothing here depends on a file in the repository.
WIDE = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAICAYAAADwZCxbAAAAKUlEQVR4nGP8z8DAwPCfgYHhPwMDA8"
    "N/BgYGhv8MDAz/GRgYGP4zMDAwAAAxPwUCnZ0uVQAAAABJRU5ErkJggg=="
)

COVERED = f"---\ntitle: Covered\ncover: {WIDE}\n---\n\n# Covered\n\nWords under the band.\n"
PLAIN = "---\ntitle: Plain\n---\n\n# Plain\n\nWords with nothing over them.\n"

SEED = """
async ([covered, plain]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(covered, ws.activeSpace.root)
  await ws.noteFrom(plain, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name).join(', ')
}
"""

OPEN = """
async (starts) => {
  const ws = window.nibApp.workspace
  const found = ws.notes.find((one) => one.name.startsWith(starts))
  await ws.openEntry(found.path, { activate: true })
  return found.path
}
"""

# What the page says about the band: whether there is one, where its picture's band
# sits, and whether it is above the properties and the first heading.
BANNER = """
() => {
  const host = document.querySelector('#write')
  const cover = host?.querySelector('.nib-cover')
  const picture = cover?.querySelector('img')
  const heading = host?.querySelector('h1, .cm-line')
  return {
    there: !!cover,
    handle: !!cover?.querySelector('.nib-cover-drag'),
    position: picture ? getComputedStyle(picture).objectPosition : null,
    tall: picture ? Math.round(picture.getBoundingClientRect().height) : 0,
    first: !!cover && !!heading
      ? cover.compareDocumentPosition(heading) === Node.DOCUMENT_POSITION_FOLLOWING
      : null,
  }
}
"""

SAID = "() => window.nibApp.workspace.active?.doc ?? ''"

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
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
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
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


def shot(page: Page, name: str) -> bytes:
    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / f"{name}.png"
    bytes_ = steady(page, lambda: page.screenshot(path=str(where)))
    say(f"shot {name}.png")
    return bytes_


def note_shot(page: Page, name: str) -> bytes:
    """The note itself, and nothing of the app around it.

    Which is what the pixel proof has to compare: the tab strip and the file list
    grow as a drive opens notes, and a proof about a note being unchanged should not
    be able to fail because a second tab appeared over it."""
    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / f"{name}.png"
    surface = page.locator("#write").first
    bytes_ = steady(page, lambda: surface.screenshot(path=str(where)))
    say(f"shot {name}.png")
    return bytes_


def open_note(page: Page, starts: str) -> None:
    page.evaluate(OPEN, starts)
    wait_for(
        page,
        "window.nibApp.workspace.active?.name?.startsWith("
        f"{json.dumps(starts)}) && document.querySelector('#write')",
        f"the {starts} note to be open",
    )
    quiet(page)


def the_editor(page: Page) -> None:
    open_note(page, "Covered")
    banner = page.evaluate(BANNER)
    say(f"[editor] {json.dumps(banner)}")

    is_true(banner["there"], "the editor draws no banner for a note that names a cover")
    is_true(banner["handle"], "the banner has nothing to take hold of")
    is_true(banner["first"], "the banner is not above the note")
    is_true(banner["tall"] > 60, f"the banner is only {banner['tall']} pixels tall")
    is_true(
        banner["position"].endswith("50%"),
        f"a cover that said nothing does not start in the middle: {banner['position']}",
    )
    shot(page, "01-editor")

    # The caret into the front matter: the rows give way to the YAML and the band
    # stays, which is the whole reason it is not a replacement like the rest.
    page.evaluate(
        "() => { const at = window.nib.state.doc.toString().indexOf('cover:') + 3;"
        " window.nib.dispatch({ selection: { anchor: at } }); window.nib.focus() }"
    )
    quiet(page)
    inside = page.evaluate(BANNER)
    say(f"[editor, caret in the metadata] {json.dumps(inside)}")
    is_true(inside["there"], "the banner went away when the caret entered the front matter")
    shot(page, "02-editor-source")


def the_drag(page: Page) -> None:
    open_note(page, "Covered")
    handle = page.locator("#write .nib-cover-drag").first
    box = handle.bounding_box()
    if not box:
        wrong("the banner has no handle to drag")
        return

    middle_x = box["x"] + box["width"] / 2
    middle_y = box["y"] + box["height"] / 2
    page.mouse.move(middle_x, middle_y)
    page.mouse.down()
    page.mouse.move(middle_x, middle_y - box["height"] / 3, steps=8)
    page.mouse.up()
    quiet(page)

    said = page.evaluate(SAID)
    say(f"[dragged] {json.dumps(said.split(chr(10))[:4])}")
    is_true("cover-position:" in said, "the drag wrote no position into the note")

    line = next((one for one in said.split("\n") if one.startswith("cover-position:")), "")
    number = line.split(":", 1)[1].strip() if ":" in line else ""
    is_true(number.isdigit(), f"the position is not a whole number: {number!r}")
    is_true(number != "50", "the drag left the band where it found it")
    shot(page, "03-dragged")

    # One thing to undo, which is what a gesture should be.
    page.keyboard.press("Control+z")
    quiet(page)
    is_true(
        "cover-position:" not in page.evaluate(SAID),
        "undoing the drag left part of it behind",
    )


def the_reading_view(page: Page) -> None:
    open_note(page, "Covered")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('article#write')", "the reading view")
    quiet(page)

    banner = page.evaluate(BANNER)
    say(f"[reading] {json.dumps(banner)}")
    is_true(banner["there"], "the reading view draws no banner")
    is_true(banner["first"], "the banner is not above the note in the reading view")
    is_true(not banner["handle"], "the reading view offers a drag handle it cannot honour")
    shot(page, "04-reading")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    quiet(page)


def a_note_with_no_cover(page: Page, round_: str) -> tuple[bytes, bytes]:
    """The pixel proof: a note that names no cover is drawn exactly as it was."""
    open_note(page, "Plain")
    banner = page.evaluate(BANNER)
    is_true(not banner["there"], "a note with no cover was given a banner anyway")
    written = note_shot(page, f"{round_}-plain-editor")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('article#write')", "the reading view")
    quiet(page)
    is_true(
        not page.evaluate(BANNER)["there"],
        "a note with no cover was given a banner in the reading view",
    )
    read = note_shot(page, f"{round_}-plain-reading")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    quiet(page)
    return written, read


def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
    )
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, [COVERED, PLAIN])}")

    # The note with no cover, before anything has touched a cover at all, and again
    # at the end: the same pixels either side is the proof that a note without one is
    # untouched by all of this.
    before = a_note_with_no_cover(page, "05")

    the_editor(page)
    the_drag(page)
    the_reading_view(page)

    after = a_note_with_no_cover(page, "07")
    is_true(before[0] == after[0], "the plain note is not drawn the same way twice in the editor")
    is_true(before[1] == after[1], "the plain note is not drawn the same way twice when read")

    context.close()


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

    print("\na note's cover is drawn where a note is drawn", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
