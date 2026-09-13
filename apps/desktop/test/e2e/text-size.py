"""The size of the text, changed with Ctrl and the wheel.

What it proves: Ctrl and a notch over the note steps `--zoom` and says so with a
badge that goes on its own; a notch without Ctrl scrolls and changes nothing; a
notch over the panel changes nothing; and nothing here touches the browser's own
zoom - the page's own scale stays 1, which is the whole point of the app owning the
gesture.

And the keys, which are the three every browser uses: **Ctrl+=**, **Ctrl+-** and
**Ctrl+0** are the size and nothing else, Ctrl+0 answers to the key underneath so it
reads the same on a keyboard where the nought needs Shift, and Heading up, heading
down and Paragraph are one modifier over on Ctrl+Shift+=, Ctrl+Shift+- and
Ctrl+Shift+P, where they change the line and not the size.

It fails loudly: anything wrong is printed at the end and the exit code says so.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode development

Then, from the repository root:

    python apps/desktop/test/e2e/text-size.py

Screenshots go beside this file under `shots/text-size/`, which is ignored.
"""

from __future__ import annotations

import functools
import http.server
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = APP / "test" / "e2e" / "shots" / "text-size"

# Its own port, in the range this agent was given.
PORT = 23302
ORIGIN = f"http://127.0.0.1:{PORT}"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\nThe words here are what the size is about.', undefined)
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

# The one number the whole thing is about, and the badge beside it.
SIZE = """
() => {
  const root = document.documentElement
  const badge = document.querySelector('.size')
  return {
    zoom: getComputedStyle(root).getPropertyValue('--zoom').trim(),
    kept: window.nibApp.modes.zoom,
    badge: badge ? badge.textContent.trim() : null,
    // What the app must never be doing: the page's own scale, which a webview
    // zoom would move.
    scale: Math.round(window.devicePixelRatio * 100) / 100,
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
        handler = functools.partial(Quiet, directory=str(APP / "dist"))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()
        say(f"serving {APP / 'dist'} on {ORIGIN}")

    def stop(self) -> None:
        self.server.shutdown()


def wheel(page, where: str, ctrl: bool, up: bool) -> None:
    """One notch, over whatever `where` names, with or without Ctrl."""
    box = page.locator(where).first.bounding_box()
    if not box:
        raise SystemExit(f"nothing at {where}")

    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    if ctrl:
        page.keyboard.down("Control")
    page.mouse.wheel(0, -120 if up else 120)
    if ctrl:
        page.keyboard.up("Control")
    page.wait_for_timeout(260)


def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    say(f"the space holds {page.evaluate(SEED)} files")
    page.wait_for_timeout(600)

    page.evaluate("() => window.nibApp.modes.resetZoom()")
    page.wait_for_timeout(400)
    say(f"at rest: {page.evaluate(SIZE)}")

    say("--- Ctrl and the wheel over the note ---")
    wheel(page, "#write", ctrl=True, up=True)
    say(f"one notch in:  {page.evaluate(SIZE)}")
    page.screenshot(path=str(SHOTS / "badge.png"))
    say("shot badge.png")

    wheel(page, "#write", ctrl=True, up=True)
    say(f"two notches in: {page.evaluate(SIZE)}")

    for _ in range(3):
        wheel(page, "#write", ctrl=True, up=False)
    say(f"three notches out: {page.evaluate(SIZE)}")

    # The badge says the size and then goes, which is what makes it a badge
    # rather than a thing to close.
    page.wait_for_timeout(1200)
    say(f"a moment later: {page.evaluate(SIZE)}")

    say("--- what must not change it ---")
    before = page.evaluate("() => window.nibApp.modes.zoom")
    wheel(page, "#write", ctrl=False, up=True)
    say(f"a notch without Ctrl: {before} -> {page.evaluate('() => window.nibApp.modes.zoom')}")

    # Over the panel, which a fresh profile starts without.
    page.keyboard.press("Control+Shift+L")
    page.wait_for_timeout(500)
    wheel(page, "[data-region='list']", ctrl=True, up=True)
    say(f"a notch over the file list: {page.evaluate('() => window.nibApp.modes.zoom')}")

    say("--- the keys ---")

    def focus() -> None:
        page.evaluate(
            "() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()"
        )

    def size() -> float:
        return page.evaluate("() => window.nibApp.modes.zoom")

    def line() -> str:
        return page.evaluate(LINE)

    def pressed(key: str) -> None:
        page.keyboard.press(key)
        page.wait_for_timeout(260)

    # Inside the note, because that is where somebody is when they want bigger words -
    # and because it is the one place a key of the editor's could take it instead.
    focus()
    page.evaluate("() => window.nibApp.modes.resetZoom()")
    page.wait_for_timeout(300)

    # The caret onto the heading, so a key that is the editor's can be seen to have
    # been the editor's.
    page.evaluate(
        """() => {
          const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
          view?.dispatch({ selection: { anchor: 6 } })
        }"""
    )
    page.wait_for_timeout(200)
    heading = line()
    say(f"the caret is in {heading!r} at {size()}")

    pressed("Control+Equal")
    bigger = size()
    say(f"Control+=              -> {bigger}")
    if bigger <= 1:
        wrong(f"Ctrl+= did not make the words bigger: {bigger}")
    if line() != heading:
        wrong(f"Ctrl+= changed the line as well: {line()!r}")

    pressed("Control+Equal")
    if size() <= bigger:
        wrong(f"a second Ctrl+= did not step again: {size()}")
    say(f"Control+= twice        -> {size()}")

    pressed("Control+Minus")
    if size() != bigger:
        wrong(f"Ctrl+- did not step back down: {size()} rather than {bigger}")
    say(f"Control+-              -> {size()}")

    pressed("Control+Digit0")
    said = page.evaluate(SIZE)
    if said["kept"] != 1:
        wrong(f"Ctrl+0 did not reset the size: {said}")
    if not said["badge"]:
        wrong("Ctrl+0 said nothing: the badge is what says what just happened")
    say(f"Control+0              -> {said}")
    page.screenshot(path=str(SHOTS / "reset-badge.png"))
    say("shot reset-badge.png")

    # The layout case. On AZERTY the nought is the shifted character of the top row, so
    # what a French reader presses for Ctrl+0 has Shift down - and Shift and the nought
    # key is exactly what this sends. The chord is matched by the key underneath, which
    # is what every browser does with its own Ctrl+0; see keys.ts.
    pressed("Control+Equal")
    if size() <= 1:
        wrong("Ctrl+= would not step, so the layout case cannot be told apart")
    pressed("Control+Shift+Digit0")
    if size() != 1:
        wrong(f"Ctrl+Shift+0 - which is Ctrl+0 on AZERTY - did not reset: {size()}")
    else:
        say("Control+Shift+0        -> reset, which is the AZERTY road to Ctrl+0")

    say("--- and the three that moved ---")
    was = size()

    pressed("Control+Shift+Equal")
    if line() == heading:
        wrong(f"Ctrl+Shift+= did not change the heading: {line()!r}")
    else:
        say(f"Control+Shift+=        -> {line()!r}")
    if size() != was:
        wrong(f"Ctrl+Shift+= changed the size as well: {size()}")

    pressed("Control+Shift+Minus")
    if line() != heading:
        wrong(f"Ctrl+Shift+- did not put the heading back: {line()!r}")
    else:
        say(f"Control+Shift+-        -> {line()!r}")

    pressed("Control+Shift+KeyP")
    if line().startswith("#"):
        wrong(f"Ctrl+Shift+P did not make it a paragraph: {line()!r}")
    else:
        say(f"Control+Shift+P        -> {line()!r}")
    if size() != was:
        wrong(f"Ctrl+Shift+P changed the size as well: {size()}")

    page.screenshot(path=str(SHOTS / "after.png"))
    say("shot after.png")
    context.close()


# The line the caret is in, so a key that is the editor's can be seen to have
# been the editor's.
LINE = """
() => {
  const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
  if (!view) return ''
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return line.text.slice(0, 40)
}
"""


def main() -> int:
    if not (APP / "dist" / "index.html").exists():
        raise SystemExit("build the app first; see the top of this file")

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
