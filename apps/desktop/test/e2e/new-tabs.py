"""A new tab: what kind, where it comes from, and what it costs on disk.

What it proves, in order:

* **Ctrl+Shift+P** opens the palette already on the commands - a `>` in the field with
  the caret after it - from a note and from the file list alike, and a second press puts
  the mark in front of whatever is typed, once. Escape closes it.
* **Paragraph needs no chord**: Ctrl+1 on a line that is already a first-level heading
  turns it back into prose, and again makes it a heading. That is what freed
  Ctrl+Shift+P for the palette.
* **Ctrl+T asks what kind**, with the keyboard on the first row - so Ctrl+T then Enter is
  still a new note - and the arrows walk the rest.
* **Every kind opens as a tab and writes nothing**: a plane, a deck of pages and a
  website open with no file in the space and no row in the list.
* **Saving one** asks for a name and where, and writes the file the kind belongs in -
  `Plan.canvas`, not `Plan.md`.
* **A pane with nothing open** shows those same kinds as buttons, with the keyboard on
  the first, and pressing one makes that kind.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/new-tabs.py

Screenshots go beside this file under `shots/new-tabs/`, which is ignored. It fails
loudly: anything wrong is printed at the end and the exit code says so.
"""

from __future__ import annotations

import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SERVED = APP / "dist"
SHOTS = APP / "test" / "e2e" / "shots" / "new-tabs"

# Its own port, in the range this agent was given.
PORT = 23711
ORIGIN = f"http://127.0.0.1:{PORT}"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.', undefined)
  const first = ws.files.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

# What the app is showing, as plainly as it can be asked.
STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    tabs: ws.tabs.map((one) => ({ kind: one.kind, path: one.path, shown: one.shown })),
    files: ws.files.map((one) => one.name),
    active: ws.active ? { kind: ws.active.kind, path: ws.active.path } : null,
  }
}
"""

# The line the caret is in, so a key that is the editor's can be seen to have been.
LINE = """
() => {
  const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
  if (!view) return ''
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return line.text.slice(0, 40)
}
"""

# The palette's field and where the caret is in it, which is the whole of the design.
FIELD = """
() => {
  const input = document.querySelector('.palette input')
  return input ? { value: input.value, caret: input.selectionStart } : null
}
"""

MENU = """
() => {
  const rows = [...document.querySelectorAll('.menu [role="menuitem"]')]
  return {
    rows: rows.map((one) => one.textContent.trim()),
    on: document.activeElement ? document.activeElement.textContent.trim() : null,
  }
}
"""

HERE = """
() => {
  const buttons = [...document.querySelectorAll('[data-new-here] button')]
  return {
    buttons: buttons.map((one) => one.textContent.trim()),
    on: document.activeElement ? document.activeElement.textContent.trim() : null,
  }
}
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    print(f"  FAIL {words}", flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: object) -> None:  # noqa: D102
        return


class Pages:
    """The built page, served."""

    def __init__(self) -> None:
        handler = functools.partial(Quiet, directory=str(SERVED))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()
        say(f"serving {SERVED} on {ORIGIN}")

    def stop(self) -> None:
        self.server.shutdown()


def palette(page) -> None:
    """Ctrl+Shift+P, from a note and from the file list."""
    say("--- Ctrl+Shift+P ---")

    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field != {"value": ">", "caret": 1}:
        wrong(f"Ctrl+Shift+P did not open the palette on the commands: {field}")
    else:
        say("from a note            -> '>' with the caret after it")
    page.screenshot(path=str(SHOTS / "commands.png"))

    page.keyboard.type("fold")
    page.wait_for_timeout(200)
    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field != {"value": ">fold", "caret": 5}:
        wrong(f"a second press did not put the mark in front, once: {field}")
    else:
        say("pressed again          -> '>fold', the caret at the end")

    page.keyboard.press("Escape")
    page.wait_for_timeout(260)
    if page.evaluate(FIELD) is not None:
        wrong("Escape did not close the palette")

    # The file list is a surface with keys of its own, and this chord is the app's: it
    # is read off the window, so it answers there too.
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)
    row = page.locator(".nib-row").first
    if row.count():
        row.click()
        page.wait_for_timeout(250)

    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field is None or field["value"] != ">":
        wrong(f"the chord did not answer in the file list: {field}")
    else:
        say("from the file list     -> '>' as well")
    page.keyboard.press("Escape")
    page.wait_for_timeout(260)


def heading_key(page) -> None:
    """The key that made a heading unmakes it, which is why Paragraph needs no chord."""
    say("--- the heading key undoes itself ---")

    page.evaluate(
        """() => {
          const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
          view?.dispatch({ selection: { anchor: 6 } })
          view?.focus()
        }"""
    )
    page.wait_for_timeout(250)
    heading = page.evaluate(LINE)

    page.keyboard.press("Control+Digit1")
    page.wait_for_timeout(300)
    if page.evaluate(LINE).startswith("#"):
        wrong(f"Ctrl+1 on a first-level heading did not make it prose: {page.evaluate(LINE)!r}")
    else:
        say(f"Control+1              -> {page.evaluate(LINE)!r}")

    page.keyboard.press("Control+Digit1")
    page.wait_for_timeout(300)
    if page.evaluate(LINE) != heading:
        wrong(f"Ctrl+1 did not make it a heading again: {page.evaluate(LINE)!r}")
    else:
        say(f"Control+1 again        -> {page.evaluate(LINE)!r}")


def chooser(page) -> None:
    """Ctrl+T, and what it offers."""
    say("--- Ctrl+T ---")

    page.keyboard.press("Control+KeyT")
    page.wait_for_timeout(450)
    menu = page.evaluate(MENU)
    if menu["rows"] != ["New note", "New canvas", "New web note", "New page note"]:
        wrong(f"Ctrl+T did not offer the kinds: {menu['rows']}")
    else:
        say(f"the chooser            -> {menu['rows']}")
    if menu["on"] != "New note":
        wrong(f"the keyboard did not land on the first row: {menu['on']!r}")
    else:
        say("the keyboard           -> on New note, so Enter is a new note")
    page.screenshot(path=str(SHOTS / "chooser.png"))

    page.keyboard.press("ArrowDown")
    page.wait_for_timeout(200)
    if page.evaluate(MENU)["on"] != "New canvas":
        wrong("the arrows do not walk the chooser")
    else:
        say("ArrowDown              -> New canvas")
    page.keyboard.press("ArrowUp")
    page.wait_for_timeout(200)

    # Escape closes it and makes nothing, like every other layer the app puts up.
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    if page.evaluate(MENU)["rows"]:
        wrong("Escape did not close the chooser")
    else:
        say("Escape                 -> closed, and nothing made")

    page.keyboard.press("Control+KeyT")
    page.wait_for_timeout(450)

    before = len(page.evaluate(STATE)["tabs"])
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    state = page.evaluate(STATE)
    if len(state["tabs"]) != before + 1 or state["active"] != {"kind": "note", "path": None}:
        wrong(f"Ctrl+T then Enter did not make a new note: {state['active']}")
    else:
        say("Enter                  -> a note, with no file")


def unsaved(page) -> None:
    """Each kind, as a tab with nothing behind it."""
    say("--- a tab of each kind, and nothing on disk ---")

    files = page.evaluate(STATE)["files"]
    for kind, row in (
        ("canvas", "New canvas"),
        ("pages", "New page note"),
        ("web", "New web note"),
    ):
        page.keyboard.press("Control+KeyT")
        page.wait_for_timeout(450)
        page.locator(f'.menu [role="menuitem"]:has-text("{row}")').first.click()
        page.wait_for_timeout(800)

        state = page.evaluate(STATE)
        if state["active"] != {"kind": kind, "path": None}:
            wrong(f"{row} did not open an unsaved {kind}: {state['active']}")
        else:
            say(f"{row:<22} -> a {kind} tab, path null")
        if state["files"] != files:
            wrong(f"{row} wrote something into the space: {state['files']}")

    say(f"the strip              -> {[one['shown'] for one in page.evaluate(STATE)['tabs']]}")
    page.screenshot(path=str(SHOTS / "unsaved-tabs.png"))


def saving(page) -> None:
    """Saving an unsaved plane, which is the sheet and the file it writes."""
    say("--- saving an unsaved plane ---")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.kind === 'canvas')
          if (tab) ws.activate(tab.id)
        }"""
    )
    page.wait_for_timeout(400)

    page.keyboard.press("Control+KeyS")
    page.wait_for_timeout(700)
    if not page.locator(".sheet input").count():
        wrong("Ctrl+S on an unsaved plane asked nothing")
        return

    page.locator(".sheet input").first.fill("Plan")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "save-sheet.png"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)

    state = page.evaluate(STATE)
    path = (state["active"] or {}).get("path") or ""
    if not path.endswith("Plan.canvas"):
        wrong(f"saving did not write Plan.canvas: {state['active']}")
    else:
        say(f"saved                  -> {path}")
    if "Plan.canvas" not in state["files"]:
        wrong(f"the space has no Plan.canvas: {state['files']}")
    else:
        say("the space              -> holds Plan.canvas")

    # And the same name again, which must never replace the first: the sheet says the
    # name is taken and the save steps it aside by number, the way the file list does
    # for a duplicate.
    page.evaluate("async () => window.nibApp.workspace.newCanvas()")
    page.wait_for_timeout(500)
    page.keyboard.press("Control+KeyS")
    page.wait_for_timeout(700)

    offered = page.locator(".sheet input").first.input_value()
    said = page.locator(".sheet .collides").count()
    page.locator(".sheet input").first.fill("Plan")
    page.wait_for_timeout(250)
    if not page.locator(".sheet .collides").count():
        wrong("the sheet said nothing about a name the folder already has")
    else:
        say(f"typing Plan again      -> {page.locator('.sheet .collides').first.text_content()!r}")
    say(f"the field offered      -> {offered!r} (collision line at once: {bool(said)})")
    page.screenshot(path=str(SHOTS / "taken.png"))

    page.keyboard.press("Enter")
    page.wait_for_timeout(1000)
    state = page.evaluate(STATE)
    if (state["active"] or {}).get("path") != "/Notes/Plan 2.canvas":
        wrong(f"a second Plan replaced the first: {state['active']}")
    else:
        say("saved again            -> /Notes/Plan 2.canvas, nothing replaced")
    if "Plan.canvas" not in state["files"]:
        wrong(f"the first Plan.canvas is gone: {state['files']}")


def nothing_open(page) -> None:
    """Closing everything, and the buttons that answer."""
    say("--- nothing open ---")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)

    state = page.evaluate(STATE)
    if state["tabs"]:
        wrong(f"closing every tab left something open: {state['tabs']}")
    else:
        say("every tab closed       -> nothing open, and nothing made")

    here = page.evaluate(HERE)
    if here["buttons"] != ["New note", "New canvas", "New web note", "New page note"]:
        wrong(f"the empty pane does not offer the kinds: {here['buttons']}")
    else:
        say(f"the buttons            -> {here['buttons']}")
    if here["on"] != "New note":
        wrong(f"the keyboard did not land on the first button: {here['on']!r}")
    else:
        say("the keyboard           -> on New note")
    page.screenshot(path=str(SHOTS / "nothing-open.png"))

    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(250)
    if page.evaluate(HERE)["on"] != "New canvas":
        wrong("the arrows do not walk the buttons")
    else:
        say("ArrowRight             -> New canvas")

    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    state = page.evaluate(STATE)
    if state["active"] != {"kind": "canvas", "path": None}:
        wrong(f"pressing the button did not make a plane: {state['active']}")
    else:
        say("Enter                  -> an unsaved plane")


def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_timeout(800)

    say(f"{page.evaluate(SEED)} file(s) in the space")
    page.wait_for_timeout(500)
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.wait_for_timeout(200)

    palette(page)
    heading_key(page)
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    chooser(page)
    unsaved(page)
    saving(page)
    nothing_open(page)

    page.screenshot(path=str(SHOTS / "after.png"))
    context.close()


def main() -> int:
    if not (SERVED / "index.html").exists():
        raise SystemExit("build the drive bundle first; see the top of this file")

    pages = Pages()
    pages.start()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                drive(browser)
            finally:
                browser.close()
    finally:
        pages.stop()

    say(f"shots in {SHOTS}")

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\neverything the drive checked was right")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
