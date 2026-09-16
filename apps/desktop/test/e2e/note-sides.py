"""The note's front and sides, seen: front matter as rows, the count of what is
selected, dragging a section by its heading, the footnotes under the outline, and
a word added to the reader's own dictionary.

Run it from the repository root:

    python apps/desktop/test/e2e/note-sides.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/note-sides/`.
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
SHOTS = HERE / "shots" / "note-sides"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18959
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """---
title: A plan
tags: [one, two]
aliases:
  - The plan
count: 12
date: 2025-09-08
done: true
export:
  paper: A4
---

# One

The first part, which mentions nib and Zug.[^1]

## Under one

Something nested.

# Two

The second part.

[^1]: where the words came from
"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('A plan') || one.name.startsWith('One'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

ROWS = """
() => [...document.querySelectorAll('.property')].map((one) => ({
  key: one.dataset.key,
  value: one.querySelector('.property-value')?.textContent?.trim(),
  chips: one.querySelectorAll('.property-chip').length,
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


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fresh(browser: Browser, finger: bool) -> Page:
    context = browser.new_context(
        viewport={"width": 420, "height": 880} if finger else {"width": 1240, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)
    return page


def properties(page: Page) -> None:
    rows = page.evaluate(ROWS)
    say(f"[properties] {json.dumps(rows)}")
    shot(page, "01-properties")

    if len(rows) != 7:
        wrong(f"the block drew {len(rows)} rows, not 7")
    keys = [one["key"] for one in rows]
    if keys != ["title", "tags", "aliases", "count", "date", "done", "export"]:
        wrong(f"the rows are not the note's own keys in order: {keys}")

    tags = next((one for one in rows if one["key"] == "tags"), None)
    if not tags or tags["chips"] != 2:
        wrong(f"a list did not draw as chips: {tags}")

    # nib's own page setup is a shape the reader knows, so the block still draws.
    nested = next((one for one in rows if one["key"] == "export"), None)
    if not nested or "paper: A4" not in (nested["value"] or ""):
        wrong(f"the export map did not draw: {nested}")

    if page.evaluate("() => document.querySelectorAll('.nib-property-add').length") != 1:
        wrong("there is no way to add a property")

    # A click on a row's key puts the caret on the line it was drawn from, which is
    # what shows the source. On the key and not the middle of the row: the value cell
    # takes three quarters of the width, and a press inside a control belongs to the
    # control - that is where a value is changed without going near the YAML. See the
    # widget's own `mousedown` in live-preview/properties.ts.
    page.click('.property[data-key="title"] .property-key')
    page.wait_for_timeout(500)
    caret = page.evaluate("() => window.nib.state.selection.main.head")
    source = page.evaluate("() => document.querySelectorAll('.property').length === 0")
    line = page.evaluate("() => window.nib.state.doc.lineAt(window.nib.state.selection.main.head).text")
    say(f"[click] caret {caret} on {json.dumps(line)}, source shown: {source}")
    shot(page, "02-source")

    if not source:
        wrong("the caret in the block did not show its source")
    if "title" not in line:
        wrong(f"the caret did not land on the row's own line: {line!r}")


def selection(page: Page) -> None:
    page.evaluate(
        """() => {
          const doc = window.nib.state.doc
          const at = doc.toString().indexOf('The first part')
          window.nib.dispatch({ selection: { anchor: at, head: at + 14 } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(400)

    bar = page.locator("footer").last
    bar.hover()
    page.wait_for_timeout(500)
    said = bar.inner_text().replace("\n", " ")
    say(f"[status] {said!r}")
    shot(page, "03-selection")

    if "/" not in said:
        wrong(f"the bar does not say what is selected out of the whole: {said!r}")
    if not said.startswith("3/"):
        wrong(f"the selected words are not counted first: {said!r}")


def outline(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(600)

    rows = page.evaluate("() => [...document.querySelectorAll('.heading')].map((one) => one.textContent.trim())")
    notes = page.evaluate("() => [...document.querySelectorAll('.note')].map((one) => one.textContent.trim())")
    say(f"[outline] {json.dumps(rows)}")
    say(f"[footnotes] {json.dumps(notes)}")
    shot(page, "04-outline")

    if rows != ["One", "Under one", "Two"]:
        wrong(f"the outline is not the note's headings: {rows}")
    if len(notes) != 1 or "where the words came from" not in notes[0]:
        wrong(f"the footnotes section does not list the note's one footnote: {notes}")

    # The footnote row jumps to the mark in the words, not to the definition.
    page.click(".note")
    page.wait_for_timeout(400)
    line = page.evaluate("() => window.nib.state.doc.lineAt(window.nib.state.selection.main.head).text")
    say(f"[footnote click] {json.dumps(line)}")
    if "The first part" not in line:
        wrong(f"a footnote row did not go to its mark: {line!r}")

    # Dragging the last heading onto the first moves the whole section.
    before = page.evaluate("() => window.nib.state.doc.toString()")
    page.locator(".heading").nth(2).drag_to(page.locator(".heading").first)
    page.wait_for_timeout(700)
    after = page.evaluate("() => window.nib.state.doc.toString()")
    order = page.evaluate("() => [...document.querySelectorAll('.heading')].map((one) => one.textContent.trim())")
    say(f"[dragged] {json.dumps(order)}")
    shot(page, "05-dragged")

    if after == before:
        wrong("dragging a heading changed nothing")
    if order != ["Two", "One", "Under one"]:
        wrong(f"the section did not move whole: {order}")
    if after.count("## Under one") != 1:
        wrong("the nested heading was copied rather than moved")


def dictionary(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.closePanel()")
    page.wait_for_timeout(400)

    # A right click on the word "nib" in the words.
    place = page.evaluate(
        """() => {
          const at = window.nib.state.doc.toString().indexOf('nib and Zug')
          const box = window.nib.coordsAtPos(at + 1)
          return box && { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
        }"""
    )
    if not place:
        wrong("the word could not be found on screen")
        return

    page.mouse.click(place["x"], place["y"], button="right")
    page.wait_for_timeout(600)
    rows = page.evaluate("() => [...document.querySelectorAll('.nib-row')].map((one) => one.textContent.trim())")
    adding = [one for one in rows if "dictionary" in one]
    say(f"[menu] {json.dumps(adding)}")
    shot(page, "06-menu")

    if not adding:
        wrong("the menu over a word does not offer the dictionary")
        return

    page.evaluate(
        """() => {
          const row = [...document.querySelectorAll('.nib-row')]
            .find((one) => one.textContent.includes('dictionary'))
          row.click()
        }"""
    )
    page.wait_for_timeout(700)

    words = page.evaluate("() => window.nibApp.modes.spellWords")
    quiet = page.evaluate(
        """() => [...document.querySelectorAll('.nib-known-word')].map((one) => ({
          word: one.textContent,
          spellcheck: one.getAttribute('spellcheck'),
        }))"""
    )
    say(f"[dictionary] {json.dumps(words)} quiet: {json.dumps(quiet)}")
    shot(page, "07-known")

    if "nib" not in (words or []):
        wrong(f"the word was not added: {words}")
    if not quiet:
        wrong("the word is in the list but the checker was not turned off over it")
    elif quiet[0]["spellcheck"] != "false":
        wrong(f"the mark does not turn the checker off: {quiet[0]}")


def reading(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(800)

    rows = page.evaluate(ROWS)
    say(f"[reading] {len(rows)} rows")
    shot(page, "08-reading")

    if len(rows) != 7:
        wrong(f"the reading view drew {len(rows)} property rows, not 7")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)


def drive(browser: Browser) -> None:
    page = fresh(browser, finger=False)
    properties(page)
    selection(page)
    outline(page)
    dictionary(page)
    reading(page)
    page.context.close()


def finger(browser: Browser) -> None:
    page = fresh(browser, finger=True)

    rows = page.evaluate(ROWS)
    boxes = page.evaluate(
        """() => [...document.querySelectorAll('.property')].map((one) => {
          const box = one.getBoundingClientRect()
          return { left: Math.round(box.left), right: Math.round(box.right) }
        })"""
    )
    say(f"[phone] {len(rows)} property rows")
    shot(page, "10-phone-properties")

    if len(rows) != 7:
        wrong(f"the phone drew {len(rows)} property rows, not 7")
    for box in boxes:
        if box["left"] < 0 or box["right"] > 420:
            wrong(f"a property row runs off the screen: {box}")

    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(700)
    shot(page, "11-phone-outline")

    notes = page.evaluate("() => document.querySelectorAll('.note').length")
    if notes != 1:
        wrong(f"the phone outline lists {notes} footnotes, not 1")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- a pointer ---")
                drive(browser)
                say("--- a finger ---")
                finger(browser)
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

    print("\nproperties read, a selection counts, a section moves, a word is a word", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
