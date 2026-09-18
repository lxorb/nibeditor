"""The other side of the window.

What it proves, in order: a window nobody has arranged has no right side at all -
not an empty one - so the left side, the foot row and the tab strip are pixel for
pixel where they were; a panel moved over draws a column on the right with that
panel in it and takes its tab with it; the side's own button appears only once it
holds something; the panel comes back on the right after a restart, because the
side a panel sits on is part of what the window remembers; F6 reaches it as one
region and leaves it again; and on a phone it is a drawer from the right with the
same scrim, which the left drawer is not disturbed by.

The measurements are taken twice: once with nothing moved, and once with the
right side emptied again. Both are compared against the first, so "nothing
changed for anybody who never moves a panel" is a number rather than a promise.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/right-side.py

Screenshots go beside this file under `shots/right-side/`, which is ignored.
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
SHOTS = APP / "test" / "e2e" / "shots" / "right-side"

# Above 18000, and not a port any other drive here uses.
PORT = 18936
ORIGIN = f"http://127.0.0.1:{PORT}"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\n## What went in\\n\\nA kestrel over the field.\\n\\n### Wind\\n\\nSteady all week.', undefined)
  await ws.noteFrom('# Read me\\n\\nA markdown editor.', undefined)
  await ws.loadTree()

  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

# The three things that must not move: the left column, the row under it, and the
# strip of notes. To the pixel, as the page reports them.
MEASURED = """
() => {
  const box = (what) => {
    const found = document.querySelector(what)
    if (!found) return null

    const rect = found.getBoundingClientRect()
    return [rect.left, rect.top, rect.width, rect.height].map((one) => Math.round(one * 100) / 100)
  }

  return {
    left: box('.panels:not(.right) aside'),
    foot: box('[data-region="foot"]'),
    tabs: box('[data-region="tabs"]'),
    editor: box('[data-region="editor"]'),
    // And whether there is a right side in the page at all.
    right: document.querySelectorAll('.panels.right').length,
    toggles: document.querySelectorAll('button.toggle').length,
  }
}
"""

# Which panels are where, and which of them is open on each side.
SIDES = """
() => {
  const ws = window.nibApp.workspace
  return { right: [...ws.right], left: ws.panel, rightOpen: ws.rightPanel }
}
"""

# What the two tab strips hold, by the names on their buttons.
STRIPS = """
() => [...document.querySelectorAll('.panels')].map((one) => ({
  side: one.classList.contains('right') ? 'right' : 'left',
  tabs: [...one.querySelectorAll('[role=tab]')].map((tab) => tab.getAttribute('aria-label')),
  showing: [...one.querySelectorAll('[role=tab][aria-selected=true]')].map((tab) =>
    tab.getAttribute('aria-label'),
  ),
}))
"""

WHERE = """
() => {
  const at = document.activeElement
  if (!at) return 'nothing'

  const region = at.closest('[data-region]')?.dataset.region ?? '-'
  const named =
    at.getAttribute('aria-label') ?? (at.textContent ?? '').trim().slice(0, 24)
  return `${region} | ${at.tagName.toLowerCase()} | ${JSON.stringify(named)}`
}
"""

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


def started(browser, name: str, width: int, height: int, agent: str, finger: bool):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="dark" if not finger else "light",
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    say(f"[{name}] the space holds {page.evaluate(SEED)} files")
    page.wait_for_timeout(700)

    return context, page


def onDesktop(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    context, page = started(browser, "desktop", 1440, 900, DESKTOP_AGENT, False)

    def shot(tag: str) -> None:
        page.screenshot(path=str(SHOTS / f"desktop-{tag}.png"))
        say(f"    shot desktop-{tag}.png")

    # The sidebar open, on the left, the way it has always been.
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(600)

    before = page.evaluate(MEASURED)
    say(f"as it arrives: {before}")
    say(f"the strips: {page.evaluate(STRIPS)}")
    shot("nothing-moved")

    say("--- a panel moved over ---")
    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(400)
    page.evaluate("() => window.nibApp.workspace.movePanel('outline', 'right')")
    page.wait_for_timeout(700)

    say(f"the sides say: {page.evaluate(SIDES)}")
    say(f"the strips: {page.evaluate(STRIPS)}")
    moved = page.evaluate(MEASURED)
    say(f"with a panel on the right: right columns {moved['right']}, toggles {moved['toggles']}")
    say(f"the note is now {moved['editor']} (it was {before['editor']})")
    shot("outline-on-the-right")

    # Both sides at once, which is the arrangement the whole thing is for.
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(600)
    say(f"both sides open: {page.evaluate(SIDES)}")
    shot("both-sides")

    say("--- F6 reaches it ---")
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.wait_for_timeout(200)
    walked = []
    for _ in range(10):
        page.keyboard.press("F6")
        page.wait_for_timeout(220)
        walked.append(page.evaluate("() => document.activeElement?.closest('[data-region]')?.dataset.region ?? '-'"))
    say(f"F6 went round: {' -> '.join(walked)}")
    say(f"and where it stopped: {page.evaluate(WHERE)}")

    say("--- the window remembers which side ---")
    page.evaluate("() => window.nibApp.workspace.flush?.()")
    page.wait_for_timeout(400)
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    page.wait_for_timeout(1200)
    say(f"after a restart: {page.evaluate(SIDES)}")
    shot("after-a-restart")

    say("--- and moved back ---")
    page.evaluate("() => window.nibApp.workspace.movePanel('outline', 'left')")
    page.wait_for_timeout(700)
    after = page.evaluate(MEASURED)
    say(f"the sides say: {page.evaluate(SIDES)}")

    for what in ["left", "foot", "tabs", "editor"]:
        same = before[what] == after[what]
        say(f"{what}: {after[what]} {'same as before' if same else f'MOVED (was {before[what]})'}")
    say(f"right columns now {after['right']}, toggles {after['toggles']}")
    shot("moved-back")

    context.close()


def onPhone(browser) -> None:
    context, page = started(browser, "phone", 390, 844, PHONE_AGENT, True)

    def shot(tag: str) -> None:
        page.screenshot(path=str(SHOTS / f"phone-{tag}.png"))
        say(f"    shot phone-{tag}.png")

    say("--- a drawer from the right ---")
    page.evaluate("() => window.nibApp.workspace.movePanel('outline', 'right')")
    page.wait_for_timeout(500)
    say(f"the sides say: {page.evaluate(SIDES)}")

    # The side's own button, which is in the bar on a phone as well.
    toggle = page.locator("button.toggle.right").first
    say(f"the right side's button is there: {toggle.count() == 1}")
    toggle.click(force=True)
    page.wait_for_timeout(700)
    say(f"after pressing it: {page.evaluate(SIDES)}")
    say(f"and the drawer is over the note: {page.evaluate(DRAWER)}")
    shot("drawer-open")

    # The scrim dismisses it, the way it dismisses the left one. Pressed on the
    # strip of note the drawer leaves showing, which is where a thumb would
    # land: the middle of the scrim is behind the drawer itself.
    page.mouse.click(40, 400)
    page.wait_for_timeout(700)
    say(f"after the scrim: {page.evaluate(SIDES)}")
    shot("drawer-shut")

    # And the left drawer still opens, unbothered.
    page.evaluate("() => window.nibApp.workspace.toggleSidebar()")
    page.wait_for_timeout(700)
    say(f"the left drawer still opens: {page.evaluate(SIDES)}")
    shot("left-drawer")

    page.evaluate("() => window.nibApp.workspace.closePanel()")
    page.wait_for_timeout(700)

    say("--- and a thumb drags it out ---")
    # A finger in from the right edge, stopped half way across with the finger
    # still down: the panel has to be part way out, not waiting for the lift.
    held = page.evaluate(DRAG, {"from": 380, "to": 200, "y": 420, "steps": 9, "hold": True})
    for one in held[::3]:
        say(f"    at x={one['x']}: right edge {one['right']}, scrim {one['scrim']:.2f}")
    say(f"the sides mid-drag: {page.evaluate(SIDES)}")
    shot("drag-half-way")

    # The rest of the way and off: past halfway it settles open.
    page.evaluate(DRAG, {"from": 200, "to": 60, "y": 420, "steps": 6, "hold": False})
    page.wait_for_timeout(700)
    say(f"after the drag: {page.evaluate(SIDES)}")
    say(f"and where it landed: {page.evaluate(DRAWER)}")
    shot("drag-open")

    # Back the other way, which is how a thumb puts it away.
    back = page.evaluate(DRAG, {"from": 120, "to": 380, "y": 420, "steps": 9, "hold": False})
    say(f"pushing it back: {[one['right'] for one in back]}")
    page.wait_for_timeout(700)
    say(f"after pushing it back: {page.evaluate(SIDES)}")
    shot("drag-shut")

    # The left drawer's own drag, with the note it moves at the narrow end: the
    # numbers here are what "the left drawer is untouched" is measured against, so
    # both sides are put back to shut first and the run is comparable against a
    # build without any of this in it.
    say("--- the left drawer's drag is what it was ---")
    page.evaluate("() => window.nibApp.workspace.closePanel()")
    page.evaluate("() => window.nibApp.workspace.closePanel('right')")
    page.wait_for_timeout(700)
    say(f"from shut: {page.evaluate(SIDES)}")
    left = page.evaluate(DRAG, {"from": 30, "to": 300, "y": 420, "steps": 9, "hold": True})
    say(f"the note follows: {[one['note'] for one in left]}")
    say(f"the sides mid-drag: {page.evaluate(SIDES)}")
    shot("left-drag-half-way")
    page.evaluate(DRAG, {"from": 300, "to": 380, "y": 420, "steps": 3, "hold": False})
    page.wait_for_timeout(700)
    say(f"after the left drag: {page.evaluate(SIDES)}")

    context.close()


# A thumb, dragged across the glass a frame at a time, answering where both
# drawers are at every step of it.
#
# Real touch events dispatched in the page: the drag listens for touches and a
# synthesised mouse is not one. The frames matter as much as the ends - what is
# under test is that the panel follows the finger rather than arriving when it
# lifts - so every move reports both layers and the scrim with it.
DRAG = """
async (plan) => {
  const target = document.elementFromPoint(plan.from, plan.y) ?? document.body
  const fire = (kind, x) => {
    const touch = new Touch({ identifier: 1, target, clientX: x, clientY: plan.y })
    target.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  const edge = (what) => {
    const one = document.querySelector(what)
    if (!one) return null
    return Math.round(one.getBoundingClientRect().left)
  }

  const seen = () => ({
    right: edge('.panels.right'),
    left: edge('.panels:not(.right)'),
    note: edge('.document'),
    scrim: Number(getComputedStyle(document.querySelector('.scrim') ?? document.body).opacity),
  })

  fire('touchstart', plan.from)
  const frames = []
  for (let step = 1; step <= plan.steps; step += 1) {
    const x = Math.round(plan.from + ((plan.to - plan.from) * step) / plan.steps)
    await new Promise((go) => requestAnimationFrame(go))
    fire('touchmove', x)
    frames.push({ x, ...seen() })
  }

  if (!plan.hold) fire('touchend', plan.to)
  return frames
}
"""


# Where the right drawer is, and whether it is over the note rather than beside
# it.
DRAWER = """
() => {
  const one = document.querySelector('.panels.right')
  if (!one) return { none: true }

  const box = one.getBoundingClientRect()
  const style = getComputedStyle(one)
  return {
    left: Math.round(box.left),
    right: Math.round(box.right),
    width: Math.round(box.width),
    window: window.innerWidth,
    fixed: style.position === 'fixed',
  }
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
                onDesktop(browser)
                onPhone(browser)
            finally:
                browser.close()
    finally:
        pages.stop()

    say(f"shots in {SHOTS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
