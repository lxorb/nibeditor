"""The mark beside every block, seen: where it stands, what it says when it is
pressed, and what happens when it is dragged.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/blocks.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/blocks/`.
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
SHOTS = HERE / "shots" / "blocks"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18961
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# A note of blocks

The first paragraph, which has seven words here.

The second paragraph, shorter.

- one item
- another item

> A quote to move around.

The last paragraph of the note.
"""

SEED = """
async ([note]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""

# Every mark on the page, against the block it belongs to.
MARKS = """
() => [...document.querySelectorAll('.nib-block-handle')].map((mark) => {
  const line = mark.closest('.cm-line')
  const box = line.getBoundingClientRect()
  const rect = mark.getBoundingClientRect()

  return {
    text: line.textContent.trim().slice(0, 24),
    gap: Math.round(box.left - rect.right),
    into: Math.round(rect.top + rect.height / 2 - box.top),
    shown: getComputedStyle(mark).opacity,
  }
})
"""

ROWS = """
() => [...document.querySelectorAll('.rows .nib-row')].map((row) => ({
  label: row.querySelector('.nib-row-label')?.textContent ?? '',
  off: row.disabled,
}))
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


def fresh(browser: Browser, label: str, finger: bool = False) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820} if not finger else {"width": 420, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        permissions=["clipboard-read", "clipboard-write"],
        **(
            {}
            if not finger
            else {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, [NOTE])}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('A note'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page


def source(page: Page) -> str:
    return page.evaluate("() => window.nib.state.doc.toString()")


def line_of(page: Page, words: str):
    """The line holding those words, as something to hover and press."""
    return page.locator(".cm-line", has_text=words).first


def press_mark(page: Page, words: str) -> None:
    """Opens the menu the mark beside a block offers."""
    line_of(page, words).hover()
    page.wait_for_timeout(250)
    line_of(page, words).locator(".nib-block-handle").click()
    page.wait_for_timeout(400)


def choose(page: Page, label: str) -> None:
    page.locator(".rows .nib-row", has_text=label).first.click()
    page.wait_for_timeout(500)


def drive_marks(browser: Browser) -> None:
    page = fresh(browser, "desktop")

    # Nothing until the pointer is on a line.
    resting = page.evaluate("() => getComputedStyle(document.querySelector('.nib-block-handle')).opacity")
    say(f"[desktop] a mark nobody is pointing at: opacity {resting}")
    if resting != "0":
        wrong(f"the mark is not calm: opacity {resting}")

    line_of(page, "The first paragraph").hover()
    page.wait_for_timeout(300)
    marks = page.evaluate(MARKS)
    say(f"[desktop] the marks: {json.dumps(marks[:4], ensure_ascii=False)}")
    shot(page, "01-mark-beside-a-block")

    if len(marks) < 6:
        wrong(f"a note of seven blocks drew {len(marks)} marks")

    gaps = sorted({one["gap"] for one in marks})
    if len(gaps) != 1:
        wrong(f"the marks do not stand in one column: {gaps}")
    if gaps and gaps[0] < 20:
        wrong(f"the mark does not stand clear of the fold chevron: gap {gaps}")
    for one in marks:
        if not 0 <= one["into"] <= 40:
            wrong(f"a mark is not on its block's first row: {one['into']}px into it")

    hovered = [one for one in marks if one["text"].startswith("The first paragraph")]
    if not hovered or hovered[0]["shown"] != "1":
        wrong("the mark did not come out under the pointer")

    page.context.close()


def drive_menu(browser: Browser) -> None:
    page = fresh(browser, "menu")

    press_mark(page, "The first paragraph")
    rows = page.evaluate(ROWS)
    say(f"[menu] the rows: {json.dumps([one['label'] for one in rows], ensure_ascii=False)}")
    shot(page, "10-the-block-menu")

    labels = [one["label"] for one in rows]
    if not any(label.startswith("Paragraph, ") for label in labels):
        wrong(f"the menu does not say what the block is: {labels[:3]}")
    if "Paragraph, 8 words" not in labels:
        wrong(f"the words of the block are not counted: {[l for l in labels if 'word' in l]}")
    if not [one for one in rows if one["label"].startswith("Paragraph") and one["off"]]:
        wrong("what the block is reads as something to press")
    for wanted in ("Duplicate", "Copy link", "Delete"):
        if wanted not in labels:
            wrong(f"the menu offers no {wanted!r}")

    # Duplicate.
    choose(page, "Duplicate")
    text = source(page)
    shot(page, "11-duplicated")
    if text.count("The first paragraph, which has seven words here.") != 2:
        wrong("the block was not duplicated")

    # And the copy is deleted again, which puts the note back.
    press_mark(page, "The first paragraph")
    choose(page, "Delete")
    if source(page).count("The first paragraph") != 1:
        wrong("the block was not deleted")
    shot(page, "12-deleted")

    # A link to a block names the block in the note and puts the link on the
    # clipboard.
    press_mark(page, "The second paragraph")
    choose(page, "Copy link")
    text = source(page)
    link = page.evaluate("() => navigator.clipboard.readText()")
    say(f"[menu] the link: {link!r}")
    shot(page, "13-copy-link")

    if not link.startswith("[[A note of blocks#^"):
        wrong(f"the link does not point into this note: {link!r}")
    name = link.split("#^")[-1].rstrip("]")
    if f"shorter. ^{name}" not in text:
        wrong(f"the block was not given the name the link points at: {name!r}")

    # A heading is linked by its words, and nothing is written into the note.
    before = source(page)
    press_mark(page, "A note of blocks")
    choose(page, "Copy link")
    heading = page.evaluate("() => navigator.clipboard.readText()")
    say(f"[menu] the heading link: {heading!r}")
    if heading != "[[A note of blocks#A note of blocks]]":
        wrong(f"a heading is not linked by its own words: {heading!r}")
    if source(page) != before:
        wrong("linking to a heading wrote something into the note")

    page.context.close()


def drive_selection(browser: Browser) -> None:
    page = fresh(browser, "selection")

    # A selection lying across two paragraphs is two blocks.
    page.evaluate(
        """() => {
          const text = window.nib.state.doc.toString()
          const from = text.indexOf('The first paragraph')
          const to = text.indexOf('shorter.') + 4
          window.nib.dispatch({ selection: { anchor: from, head: to } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(300)
    press_mark(page, "The second paragraph")
    labels = [one["label"] for one in page.evaluate(ROWS)]
    say(f"[selection] the rows: {json.dumps(labels[:4], ensure_ascii=False)}")
    shot(page, "20-two-blocks")

    if "2 blocks, 12 words" not in labels:
        wrong(f"the menu does not count the blocks a selection covers: {labels[:3]}")

    choose(page, "Delete")
    text = source(page)
    shot(page, "21-both-deleted")
    if "The first paragraph" in text or "The second paragraph" in text:
        wrong("deleting what a selection covers left one of the blocks behind")

    page.context.close()


def drive_drag(browser: Browser) -> None:
    page = fresh(browser, "drag")

    line_of(page, "A quote to move").hover()
    page.wait_for_timeout(300)
    mark = line_of(page, "A quote to move").locator(".nib-block-handle").bounding_box()
    target = line_of(page, "The first paragraph").bounding_box()
    if not mark or not target:
        raise SystemExit("nothing to drag")

    page.mouse.move(mark["x"] + mark["width"] / 2, mark["y"] + mark["height"] / 2)
    page.mouse.down()
    page.mouse.move(target["x"] + 40, target["y"] + 2, steps=12)
    page.wait_for_timeout(200)

    drawn = page.evaluate(
        """() => ({
          lifted: document.querySelectorAll('.cm-line.nib-block-lifted').length,
          over: document.querySelectorAll('.cm-line.nib-block-over').length,
        })"""
    )
    say(f"[drag] while it is carried: {json.dumps(drawn)}")
    shot(page, "30-carrying")
    if not drawn["lifted"]:
        wrong("the block being carried does not say so")
    if drawn["over"] != 1:
        wrong(f"the place it would land is not drawn: {drawn['over']} lines")

    page.mouse.up()
    page.wait_for_timeout(500)
    text = source(page)
    shot(page, "31-dropped")

    if text.index("> A quote") > text.index("The first paragraph"):
        wrong("the quote did not move above the paragraph it was dropped on")
    if "> A quote to move around.\n\nThe first paragraph" not in text:
        wrong(f"the blank line between the blocks did not survive the move:\n{text[:200]}")
    if page.evaluate("() => document.querySelectorAll('.cm-line.nib-block-lifted').length"):
        wrong("the block is still being carried after the button came up")

    page.context.close()


def drive_finger(browser: Browser) -> None:
    page = fresh(browser, "phone", finger=True)

    marks = page.evaluate(
        "() => [...document.querySelectorAll('.nib-block-handle')]"
        ".map((mark) => getComputedStyle(mark).display)"
    )
    say(f"[phone] the marks: {json.dumps(sorted(set(marks)))}")
    shot(page, "40-phone")
    if any(one != "none" for one in marks):
        wrong("a screen with no pointer draws a mark nobody can hover")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- the mark ---")
                drive_marks(browser)
                say("--- what it opens ---")
                drive_menu(browser)
                say("--- more than one block ---")
                drive_selection(browser)
                say("--- dragging one ---")
                drive_drag(browser)
                say("--- a finger ---")
                drive_finger(browser)
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

    print("\na block can be taken hold of, moved, copied and pointed at", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
