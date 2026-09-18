"""A space of three thousand notes, with only the rows in view in the page.

What the window has to answer for, driven rather than argued. The list mounts the
rows a panel can show and a few either side; everything else is height. So every
gesture that reaches a row somewhere else has to say so:

    at rest             how many rows are in the page at all, and how far the list runs
    scrolled            the same count, a long way down, with different rows in it
    End, Home           the two keys that land on a row nobody can see
    a spelled name      the same, by typing one
    the arrows          a step from a row the window had to fetch
    a twist             the rows it holds, sliding: the list's height, frame by frame
    a note opened       its row comes back into view, from anywhere in the space
    a rename            the field appears on a row six hundred rows down
    a reload            the list comes back to the row it was left on
    every note open     the list at its longest, which is every note in the space

It prints what it saw and nothing else: a scratch drive, not a test. The window
arithmetic itself is a test, in src/lib/row-window.test.ts, and what the flat list
holds is src/lib/tree-flat.test.ts.

The notes are seeded the way first-paint.py seeds them - straight into the
browser's storage, three thousand of four kilobytes each - which is imported from
there rather than copied.

Build the web app with the app's own handle on the page, from apps/desktop:

    NODE_ENV=development pnpm exec vite build --mode drive

then, from the repository root:

    python apps/desktop/test/e2e/big-list.py

Set NIB_DIST to drive another build folder - `dist-before` for the build without
the window, which printed 754 rows in the page where this prints 32, and 3,005 with
every note in the space open where this prints 39.
"""

from __future__ import annotations

import functools
import http.server
import importlib.util
import os
import threading
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# The seeding and the user agent are first-paint.py's; one space of three thousand
# notes, written once and read by both drives. The file name has a dash in it, so
# it is loaded by path rather than imported by name.
_spec = importlib.util.spec_from_file_location("first_paint", Path(__file__).parent / "first-paint.py")
assert _spec and _spec.loader
first_paint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(first_paint)

# A port of this drive's own. Never 1420, and not one another drive uses.
PORT = 18995
#: How many notes the space holds.
NOTES = 3000
#: Which build to drive.
FOLDER = os.environ.get("NIB_DIST", "dist")

#: The panel, by the attribute F6 already walks it with rather than by a class a
#: build is free to rename.
LIST = 'aside [data-region="list"]'


def say(words: str) -> None:
    print(f"  {words}", flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The same server, without a line per asset."""

    def log_message(self, *args: object) -> None:  # noqa: D102
        return


# What the list is: how many rows exist, which two are at the ends of them, and how
# far the whole thing runs. The height is the number that says the window is
# honest - a list of three thousand rows has to be as tall as three thousand rows
# whether or not they are drawn.
COUNT = """
() => {
  const box = document.querySelector('aside [data-region="list"]')
  const rows = document.querySelectorAll('aside [data-region="list"] .row')
  const ul = document.querySelector('aside [data-region="list"] ul')
  return {
    rows: rows.length,
    first: rows[0]?.textContent.trim() ?? null,
    last: rows[rows.length - 1]?.textContent.trim() ?? null,
    listHeight: ul ? Math.round(ul.getBoundingClientRect().height) : null,
    runs: box ? box.scrollHeight : null,
    at: box ? Math.round(box.scrollTop) : null,
  }
}
"""

# Where the keyboard is, and whether the row it is on is on screen. A focus inside a
# row the window has taken away is a focus on nothing, so `tag` saying BODY is the
# failure this drive is looking for.
FOCUS = """
() => {
  const on = document.activeElement
  const box = document.querySelector('aside [data-region="list"]')
  let inView = null
  if (on instanceof HTMLElement && box) {
    const row = on.getBoundingClientRect()
    const holds = box.getBoundingClientRect()
    inView = row.top >= holds.top - 1 && row.bottom <= holds.bottom + 1
  }

  return {
    tag: on?.tagName ?? null,
    words: on?.textContent?.trim().slice(0, 40) ?? null,
    inView,
  }
}
"""

IN_VIEW = """
() => {
  const row = document.querySelector('aside [data-region="list"] .row.is-on')
  if (!row) return 'no open row in the page'

  const box = document.querySelector('aside [data-region="list"]')
  const one = row.getBoundingClientRect()
  const holds = box.getBoundingClientRect()

  return {
    row: row.textContent.trim(),
    inView: one.top >= holds.top - 1 && one.bottom <= holds.bottom + 1,
    rowTop: Math.round(one.top),
    rowBottom: Math.round(one.bottom),
    boxTop: Math.round(holds.top),
    boxBottom: Math.round(holds.bottom),
  }
}
"""

# The slide itself, frame by frame: how tall the list is while the band comes out.
# A twist over four hundred rows adds twelve thousand pixels in a hundred and ninety
# milliseconds, so what there is to see is the easing, not a clipped row - the row
# part way out is at the bottom edge of the band, a screen and a half below the view.
# What a clipped row is is row-window.test.ts.
SLIDE = """
async (twist) => {
  const ul = document.querySelector('aside [data-region="list"] ul')
  const ws = window.nibApp.workspace
  const seen = []

  ws.toggleFolder(twist)
  for (let frame = 0; frame < 14; frame++) {
    await new Promise((go) => requestAnimationFrame(go))
    seen.push(Math.round(ul.getBoundingClientRect().height))
  }

  return seen
}
"""

SCROLL_TO = '(at) => { document.querySelector(\'aside [data-region="list"]\').scrollTop = at }'

FIRST_FOLDER = """
() => window.nibApp.workspace.tree.children.find((one) => one.is_dir).path
"""

# Every note in the space open at once, which is the list at its longest: three
# thousand rows of it, all of them rows the reader could scroll to and twenty of them
# rows the reader can see.
ALL_OPEN = """
() => {
  const ws = window.nibApp.workspace
  const open = (entry) => {
    for (const child of entry.children) {
      if (!child.is_dir) continue
      if (!ws.isExpanded(child.path)) ws.toggleFolder(child.path)
      open(child)
    }
  }

  open(ws.tree)
  return ws.visibleTree().length
}
"""

#: A note at the top of the space, far enough down the list to be nowhere near the
#: view. A note inside a folder nobody has opened is no row at all, here or before
#: the window: `startRenaming` opens no folders.
FAR_NOTE = """
() => {
  const ws = window.nibApp.workspace
  const notes = ws.tree.children.filter((one) => !one.is_dir)
  return notes[Math.min(600, notes.length - 1)].path
}
"""


def ready(page: Page, origin: str) -> None:
    page.goto(origin, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_selector("aside .row", timeout=60000)
    # Past the launch: the link index is still reading every body behind the list.
    page.wait_for_timeout(2500)


def main() -> int:
    folder = APP / FOLDER
    if not (folder / "index.html").exists():
        say(f"nothing built in {folder}")
        return 1

    handler = functools.partial(Quiet, directory=str(folder))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{PORT}"
    (folder / "seed.html").write_text(first_paint.SEED_PAGE, encoding="utf-8")
    say(f"serving {folder} on {origin}")

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            context = browser.new_context(
                viewport={"width": 1440, "height": 900},
                user_agent=first_paint.DESKTOP_AGENT,
            )
            page = context.new_page()
            page.on("pageerror", lambda error: say(f"page error: {error}"))

            page.goto(f"{origin}/seed.html", wait_until="domcontentloaded")
            page.evaluate(first_paint.SEED, NOTES)
            say(f"{NOTES} notes seeded")

            ready(page, origin)
            say(f"at rest:        {page.evaluate(COUNT)}")

            page.evaluate(SCROLL_TO, 20000)
            page.wait_for_timeout(400)
            say(f"20,000px down:  {page.evaluate(COUNT)}")

            page.evaluate(SCROLL_TO, 0)
            page.wait_for_timeout(300)
            # The keyboard put on the first row rather than a click on it: a click
            # opens the note and the note takes the keyboard, which is the right
            # thing and the wrong thing to measure the walk with.
            page.locator(f"{LIST} .row").first.focus()
            page.wait_for_timeout(300)
            say(f"the first row:  {page.evaluate(FOCUS)}")

            page.keyboard.press("End")
            page.wait_for_timeout(500)
            say(f"End:            {page.evaluate(FOCUS)}")
            say(f"                {page.evaluate(COUNT)}")

            page.keyboard.press("Home")
            page.wait_for_timeout(500)
            say(f"Home:           {page.evaluate(FOCUS)}")

            for letter in "note-19":
                page.keyboard.press("Minus" if letter == "-" else letter)
            page.wait_for_timeout(600)
            say(f"spelled a name: {page.evaluate(FOCUS)}")

            page.keyboard.press("ArrowDown")
            page.keyboard.press("ArrowDown")
            page.wait_for_timeout(400)
            say(f"two downs:      {page.evaluate(FOCUS)}")

            twist = page.evaluate(FIRST_FOLDER)
            say(f"a twist on:     {twist}")
            say(f"  opening:      {page.evaluate(SLIDE, twist)}")
            page.wait_for_timeout(400)
            say(f"  open:         {page.evaluate(COUNT)}")
            say(f"  shutting:     {page.evaluate(SLIDE, twist)}")
            page.wait_for_timeout(400)
            say(f"  shut:         {page.evaluate(COUNT)}")

            page.evaluate(
                """async () => {
                    const ws = window.nibApp.workspace
                    await ws.openEntry(ws.notes[ws.notes.length - 1].path)
                }"""
            )
            page.wait_for_timeout(800)
            say(f"the last note:  {page.evaluate(COUNT)}")
            say(f"  in view:      {page.evaluate(IN_VIEW)}")

            far = page.evaluate(FAR_NOTE)
            page.evaluate("(path) => window.nibApp.workspace.startRenaming(path)", far)
            page.wait_for_timeout(700)
            said = page.evaluate(f'() => !!document.querySelector({LIST!r} + " input")')
            say(f"renaming a row  600 down: field in the page = {said}")
            say(f"                {page.evaluate(COUNT)}")
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)

            page.evaluate(SCROLL_TO, 12345)
            page.wait_for_timeout(900)
            ready(page, origin)
            page.wait_for_timeout(1500)
            say(f"after a reload: {page.evaluate(COUNT)}")
            say(f"                panel = {page.evaluate('() => window.nibApp.workspace.panel')}")

            # And the list at its longest: every note in the space open at once.
            say(f"every note open: {page.evaluate(ALL_OPEN)} rows in the list")
            page.wait_for_timeout(1200)
            say(f"                {page.evaluate(COUNT)}")
            page.evaluate(SCROLL_TO, 40000)
            page.wait_for_timeout(400)
            say(f"  40,000px down: {page.evaluate(COUNT)}")

            browser.close()
    finally:
        server.shutdown()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
