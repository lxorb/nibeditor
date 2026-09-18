"""The two things a phone has that a desktop does not: the bar over the keyboard,
and pulling a list down past its top.

What it proves: the bar draws the reader's own list of commands rather than nine
hard-coded ones; a button presses the same command its key presses, so the note
changes; the Mobile pane adds, orders, removes and resets it; the default set is
the nine the bar has always had, so nothing changed for anybody who never opens
the pane; and a pull past the top of the note runs the command the pane says,
draws a mark that grows, does nothing when it is a scroll or a sideways drag, and
never reloads the page.

The keyboard is stood in for. A headless run has no soft keyboard and nothing in
a browser window can shrink the visual viewport, so the two fields the platform
writes are written directly - they are the whole of what the page ever sees of a
keyboard. The arithmetic that gets them there is measured in
src/lib/viewport.test.ts.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/phone-bar.py

Screenshots go beside this file under `shots/phone-bar/`, which is ignored.
"""

from __future__ import annotations

import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = APP / "test" / "e2e" / "shots" / "phone-bar"

# Above 18000, and not a port any other drive here uses.
PORT = 18938
ORIGIN = f"http://127.0.0.1:{PORT}"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.', undefined)
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

# The keyboard, stood in for; see the note at the top.
KEYS = """
(pixels) => {
  const seen = window.nibApp.viewport
  seen.keyboard = pixels
  seen.typing = pixels > 0
  return { keyboard: seen.keyboard, typing: seen.typing }
}
"""

# What the strip over the keyboard is holding: the mark on every button, and the
# name behind it.
BAR = """
() => {
  const bar = document.querySelector('.nib-bar.docked')
  if (!bar) return { none: true }

  const buttons = [...bar.querySelectorAll('button')]
  return {
    none: false,
    marks: buttons.map((one) => (one.textContent ?? '').trim()).filter(Boolean),
    names: buttons.map((one) => one.getAttribute('aria-label')),
    height: Math.round(bar.getBoundingClientRect().height),
    // Every one of them is something a thumb lands on.
    smallest: Math.min(...buttons.map((one) => Math.round(one.getBoundingClientRect().height))),
  }
}
"""

# The caret at the end of the first line, so a command has somewhere to act.
CARET = """
() => {
  const view = window.nib
  if (!view) return null
  const line = view.state.doc.line(1)
  view.dispatch({ selection: { anchor: line.to } })
  view.focus()
  return view.state.doc.line(1).text
}
"""

LINES = """
() => window.nib.state.doc.toString().split('\\n').slice(0, 4)
"""


# The marks on the bar are characters rather than words - a bullet, a box, a
# sum - and a console that is not UTF-8 would stop the drive on one of them
# rather than showing it.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


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


def pulling(page, down: int, across: int = 0, hold: bool = False):
    """One pull, and how far the mark came. Held, the finger stays down until
    `LIFT`, which is how a screenshot catches the mark."""
    return page.evaluate(PULL, {"down": down, "across": across, "hold": hold})


def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme="light",
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    say(f"the space holds {page.evaluate(SEED)} files")
    page.wait_for_timeout(700)

    say("--- the bar as it arrives ---")
    page.evaluate("() => window.nibApp.toolbar.reset()")
    page.evaluate(CARET)
    say(f"the keyboard: {page.evaluate(KEYS, 320)}")
    page.wait_for_timeout(400)
    held = page.evaluate(BAR)
    say(f"the strip: {held}")
    page.screenshot(path=str(SHOTS / "default.png"))
    say("shot default.png")

    say("--- a button presses the command its key presses ---")
    page.evaluate(CARET)
    page.click('.nib-bar.docked button[aria-label="Bold"]')
    page.wait_for_timeout(300)
    say(f"after Bold: {page.evaluate(LINES)}")

    say("--- the reader's own list ---")
    page.evaluate(
        "() => { const bar = window.nibApp.toolbar; bar.reset();"
        " bar.add('paragraph.task-list'); bar.add('app.save'); bar.remove('format.clear');"
        " bar.move(bar.ids.length - 1, 0); return bar.ids }"
    )
    page.wait_for_timeout(400)
    say(f"the strip now: {page.evaluate(BAR)}")
    page.screenshot(path=str(SHOTS / "chosen.png"))
    say("shot chosen.png")

    # A command that is not the editor's at all, pressed from the bar.
    page.evaluate(CARET)
    page.click('.nib-bar.docked button[aria-label="Save"]')
    page.wait_for_timeout(400)
    say(f"Save from the bar left the note saved: {page.evaluate('() => !window.nibApp.workspace.active.unsaved')}")

    say("--- the pane it is put together in ---")
    page.evaluate(KEYS, 0)
    page.evaluate("() => window.nibApp.settings.show('mobile')")
    page.wait_for_timeout(700)
    say(f"the pane says: {page.evaluate(PANE)}")
    page.screenshot(path=str(SHOTS / "pane.png"))
    say("shot pane.png")

    # Put one on the bar by pressing its row, the way a reader would. A command
    # that is not on it already, which is the only kind the list offers.
    page.fill(".sheet .search input", "Footnote")
    page.wait_for_timeout(400)
    say(f"the list offers: {page.evaluate(OFFERS)}")
    page.click('button[aria-label="Put it on the bar"]')
    page.wait_for_timeout(400)
    say(f"after adding from the list: {page.evaluate('() => window.nibApp.toolbar.ids')}")
    page.screenshot(path=str(SHOTS / "added.png"))
    say("shot added.png")

    # And the two arrows, which are what a thumb has instead of a drag.
    page.click('button[aria-label="Move down"]')
    page.wait_for_timeout(300)
    say(f"after one press of Move down: {page.evaluate('() => window.nibApp.toolbar.ids')}")

    page.click('button[aria-label="Take it off"]')
    page.wait_for_timeout(300)
    say(f"after Take it off: {page.evaluate('() => window.nibApp.toolbar.ids')}")

    say("--- pulling the note down past its top ---")
    page.evaluate("() => (window.nibApp.settings.open = false)")
    page.wait_for_timeout(500)
    say(f"the pull runs {page.evaluate('() => window.nibApp.pull.id')}")

    # A finger, dispatched as the touch events the handler listens for: a
    # headless run has no finger, and these three events are the whole of what
    # the page ever sees of one.
    say(f"a short pull: {pulling(page, 40)}")
    say(f"a long pull:  {pulling(page, 200, hold=True)}")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / "pulling.png"))
    say("shot pulling.png, with the finger still down")

    say(f"and on the lift the panel holds: {page.evaluate(LIFT)}")
    page.wait_for_timeout(600)
    page.screenshot(path=str(SHOTS / "pulled.png"))
    say(f"shot pulled.png; the panel is {page.evaluate(PANEL)}")

    say(f"a sideways drag: {pulling(page, 30, across=90)}")
    say(f"a scroll upwards: {pulling(page, -60)}")
    say(f"nothing is left held: {page.evaluate('() => window.nibApp.pull.at === 0')}")

    page.evaluate("() => window.nibApp.settings.show('mobile')")
    page.wait_for_timeout(600)
    page.click('button:text("Reset the bar")')
    page.wait_for_timeout(400)
    say(f"after the reset: {page.evaluate('() => window.nibApp.toolbar.ids')}")
    say(f"and the account is told: {page.evaluate('() => window.nibApp.toolbar.changed')}")
    page.screenshot(path=str(SHOTS / "reset.png"))
    say("shot reset.png")

    context.close()


# What the list under the box is offering, once something has been typed into it.
OFFERS = """
() => [...document.querySelectorAll('.sheet .setting.button')]
  .map((one) => one.getAttribute('aria-label') ?? (one.querySelector('.name')?.textContent ?? '').trim())
  .slice(-4)
"""

# Which panel the sidebar is holding, which is what the pull's own command opens.
PANEL = """
() => window.nibApp.workspace.panel
"""

# One pull, as the three touch events a finger sends. The mark's distance is read
# at the furthest point, before the finger lifts.
PULL = """
async ({ down, across, hold }) => {
  const view = window.nib
  const scroller = view.scrollDOM
  scroller.scrollTop = 0

  const box = scroller.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + 20

  const finger = (clientX, clientY) =>
    new Touch({ identifier: 1, target: scroller, clientX, clientY })

  const send = (kind, touch) =>
    scroller.dispatchEvent(
      new TouchEvent(kind, {
        bubbles: true,
        cancelable: true,
        touches: touch ? [touch] : [],
        targetTouches: touch ? [touch] : [],
        changedTouches: touch ? [touch] : [],
      }),
    )

  send('touchstart', finger(x, y))
  // In steps, the way a finger arrives: the handler claims the gesture on one of
  // them and follows the rest.
  for (const part of [0.3, 0.6, 1]) {
    send('touchmove', finger(x + across * part, y + down * part))
    await new Promise((done) => requestAnimationFrame(done))
  }

  const at = window.nibApp.pull.at
  const ready = window.nibApp.pull.ready
  // Held, so the mark can be looked at: the lift is `LIFT`, next door.
  if (!hold) send('touchend', null)
  window.__pullFinger = () => send('touchend', null)

  return { at, ready }
}
"""

LIFT = """
() => {
  window.__pullFinger?.()
  return window.nibApp.workspace.panel
}
"""

# What the pane is showing: the rows on the bar, and how many commands it offers.
PANE = """
() => {
  const sheet = document.querySelector('.sheet')
  if (!sheet) return { none: true }

  const rows = [...sheet.querySelectorAll('.setting.button')]
  const marks = rows.map((one) => (one.querySelector('.mark')?.textContent ?? '').trim())
  const named = rows.map((one) => one.getAttribute('aria-label')).filter(Boolean)
  const touch = Math.min(
    ...[...sheet.querySelectorAll('.setting.button .revert')].map((one) =>
      Math.round(one.getBoundingClientRect().height),
    ),
  )

  return { rows: rows.length, marks: marks.slice(0, 12), named: named.slice(0, 12), touch }
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
