"""A real properties UI, seen in the built app: every row of a note's front matter
edited in the control its own shape asks for, and the three-way choice above it.

What this drives, all of it against the real editor and the real file:

  * A field for a word, a number field for a number, a date picker for a date, a real
    checkbox for a `true`, chips with an `x` and a field to add one for a list, and a
    menu where the key is one the app has a fixed set of answers for.
  * Each of them writes plain front matter back into the note - `tags: [one, two]`,
    `done: true` - and one gesture is one thing to undo.
  * `Add a property` writes a new key.
  * The Front matter setting has three answers, and the editor and the reading view
    read the same one: Properties draws the rows, Source draws the YAML, Hidden draws
    neither.

Run it from the repository root:

    python apps/desktop/test/e2e/properties.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/properties/`.
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

from settling import HIDE_CARET, quiet

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "properties"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 23202
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = (
    "---\n"
    "title: A note\n"
    "count: 3\n"
    "due: 2026-09-14\n"
    "done: false\n"
    "tags: [one, two]\n"
    "icon-color: violet\n"
    "---\n"
    "\n"
    "# A note\n"
    "\n"
    "Words under the metadata.\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('A note'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

SAID = "() => window.nibApp.workspace.active?.doc ?? ''"

# What controls the rows are drawn with, by key.
CONTROLS = """
() => {
  const out = {}
  for (const row of document.querySelectorAll('#write .property')) {
    const cell = row.querySelector('.property-value')
    const chips = cell?.querySelector('.property-chip, .property-add')
    const control = chips ? null : cell?.querySelector('input, select')
    out[row.dataset.key] = control
      ? `${control.tagName.toLowerCase()}:${control.getAttribute('type') ?? ''}`
      : [...cell.children].map((one) => one.className.split(' ')[0]).join(',')
  }
  return out
}
"""

ROWS = "() => [...document.querySelectorAll('#write .property')].map((row) => row.dataset.key)"
SOURCE = "() => !!document.querySelector('#write .properties-source')"

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
    quiet(page)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def line(page: Page, key: str) -> str:
    said = page.evaluate(SAID)
    return next((one for one in said.split("\n") if one.startswith(f"{key}:")), "")


def the_controls(page: Page) -> None:
    controls = page.evaluate(CONTROLS)
    say(f"[controls] {json.dumps(controls, ensure_ascii=False)}")

    wanted = {
        "title": "input:text",
        "count": "input:number",
        "due": "input:date",
        "done": "input:checkbox",
        "icon-color": "select:",
    }
    for key, shape in wanted.items():
        is_true(
            controls.get(key) == shape,
            f"the {key} row is {controls.get(key)!r} rather than {shape}",
        )

    is_true(
        controls.get("tags", "").startswith("property-chip,property-chip"),
        f"the tags row is {controls.get('tags')!r} rather than chips and a field",
    )
    is_true(
        "property-add" in controls.get("tags", ""),
        "the list row has no field to add an item with",
    )
    shot(page, "01-rows")


def a_word_and_a_number(page: Page) -> None:
    page.fill("#write .property[data-key='title'] .property-field", "Another name")
    page.locator("#write .property[data-key='count'] .property-field").click()
    quiet(page)
    # The rows are still rows: a caret nobody chose sat at 0, which is inside the
    # block, and the first thing written used to swap the table for the YAML under the
    # control being used.
    is_true(bool(page.evaluate(ROWS)), "writing a row turned the rows back into source")
    is_true(line(page, "title") == "title: Another name", f"the title is {line(page, 'title')!r}")

    page.fill("#write .property[data-key='count'] .property-field", "42")
    page.locator("#write .property[data-key='title'] .property-field").click()
    quiet(page)
    is_true(line(page, "count") == "count: 42", f"the count is {line(page, 'count')!r}")

    # One gesture, one undo step: a field rewritten per keystroke would be one undo
    # step per letter. Asked of the editor, which is where undo lives - a key pressed
    # inside a field is the field's.
    page.locator("#write .cm-line", has_text="Words under the metadata").click()
    page.keyboard.press("Control+z")
    quiet(page)
    is_true(line(page, "count") == "count: 3", f"undoing left {line(page, 'count')!r}")


def a_checkbox_and_a_date(page: Page) -> None:
    page.check("#write .property[data-key='done'] .property-box")
    quiet(page)
    is_true(line(page, "done") == "done: true", f"the checkbox wrote {line(page, 'done')!r}")

    page.fill("#write .property[data-key='due'] .property-field", "2026-12-24")
    page.locator("#write .property[data-key='title'] .property-field").click()
    quiet(page)
    is_true(line(page, "due") == "due: 2026-12-24", f"the date is {line(page, 'due')!r}")


def a_list(page: Page) -> None:
    page.fill("#write .property[data-key='tags'] .property-add", "three")
    page.keyboard.press("Enter")
    quiet(page)
    is_true(line(page, "tags") == "tags: [one, two, three]", f"adding wrote {line(page, 'tags')!r}")

    # The `x` on the first chip.
    page.locator("#write .property[data-key='tags'] .property-chip-off").first.click()
    quiet(page)
    is_true(line(page, "tags") == "tags: [two, three]", f"removing wrote {line(page, 'tags')!r}")
    shot(page, "02-list")


def a_menu(page: Page) -> None:
    page.select_option("#write .property[data-key='icon-color'] .property-menu", "teal")
    quiet(page)
    is_true(
        line(page, "icon-color") == "icon-color: teal",
        f"the menu wrote {line(page, 'icon-color')!r}",
    )


def adding_a_property(page: Page) -> None:
    before = page.evaluate(ROWS)
    page.locator("#write .nib-property-add").click()
    quiet(page)

    said = page.evaluate(SAID)
    is_true("property" in said.split("---")[1], "Add a property wrote no new key")
    # The caret lands on the new key, so the block is showing its source now.
    is_true(not page.evaluate(ROWS), "the block did not give way to its source")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+z")
    quiet(page)
    say(f"[add] the rows were {json.dumps(before)}")


def the_three_answers(page: Page) -> None:
    for mode, rows, source in [("source", False, True), ("hidden", False, False)]:
        page.evaluate("(mode) => window.nibApp.modes.setProperties(mode)", mode)
        quiet(page)
        drawn = page.evaluate(ROWS)
        is_true(bool(drawn) == rows, f"{mode} drew rows: {json.dumps(drawn)}")
        # The editor shows the source as the document itself, so there is no `<pre>`
        # in it; what matters here is that the rows are gone and the YAML is not
        # replaced by anything.
        shot(page, f"03-editor-{mode}")

        page.evaluate("() => window.nibApp.workspace.toggleReading()")
        wait_for(page, "document.querySelector('article#write')", "the reading view")
        quiet(page)
        read = page.evaluate(ROWS)
        is_true(bool(read) == rows, f"{mode} drew rows when read: {json.dumps(read)}")
        is_true(
            page.evaluate(SOURCE) == source,
            f"{mode} drew the source when read: {page.evaluate(SOURCE)}",
        )
        shot(page, f"04-reading-{mode}")

        page.evaluate("() => window.nibApp.workspace.toggleReading()")
        quiet(page)

    page.evaluate("() => window.nibApp.modes.setProperties('properties')")
    quiet(page)
    is_true(bool(page.evaluate(ROWS)), "the rows did not come back")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('article#write')", "the reading view")
    quiet(page)
    is_true(bool(page.evaluate(ROWS)), "the rows did not come back when read")
    shot(page, "05-reading-rows")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    quiet(page)


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 860}, color_scheme="light")
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(
        page,
        "document.querySelector('#write .property[data-key=\\'tags\\']')",
        "the rows to be drawn",
    )
    quiet(page)

    the_controls(page)
    a_word_and_a_number(page)
    a_checkbox_and_a_date(page)
    a_list(page)
    a_menu(page)
    adding_a_property(page)
    the_three_answers(page)

    say(f"[note] {json.dumps(page.evaluate(SAID).split('---')[1])}")
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

    print("\nevery property row is edited in the control its shape asks for", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
