"""Is anything of nib's own drawn over the rectangle a web page fills?

Emil, 2026-09-18: *"For some reason a browser tab displayed above everything else.
For example when I switched to a note, there was still the browser open."*

A web tab's page is a native child webview placed over the pane, and a native
webview draws above every pixel of HTML in the window. So the app keeps one rule:
whatever the app puts over the page, the page is hidden and a still picture of it
stands in. That rule is why the app's own furniture may not be over a page's
rectangle *at all* - a card in the corner is not a menu somebody opened and will
close again, it is a card that hides the page for as long as it is up, and the
reader is then pressing a photograph.

Two of them were: the update notice, which floated in the bottom corner over the
pane, and full screen, which put a layer on the overlay stack for the whole time it
was on and so hid the page it exists to fill the screen with. Measured on
2026-09-18 by asking the pane's own hit test what it found: `['hole' x 8,
'DIV.notice']`.

This drive asks the same question the pane asks, of the same nine points, in a real
browser with a real layout - because nothing in the unit suite can: jsdom has no
layout, so a card drawn over a pane and a card drawn beside it are the same object
graph there. It is a browser build, where the page is a card rather than a webview,
and that changes nothing about the question: the rectangle the card fills is the
rectangle the webview would fill.

Run it from the repository root:

    python apps/desktop/test/e2e/notices.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run, or NIB_ORIGIN
to drive a server somebody else is already running. Screenshots go beside this file
under `shots/notices/`, which is ignored.
"""

from __future__ import annotations


from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

#: Where the page goes: everything in the web surface under its bar. On a desktop
#: this is the hole the webview is placed over, and the two are the same box - the
#: bar and what hangs under it are the app's, and the page is the rest.
PAGE_RECT = """
() => {
  const box = (el) => {
    if (!el) return null
    const one = el.getBoundingClientRect()
    return { x: one.x, y: one.y, width: one.width, height: one.height }
  }

  const web = box(document.querySelector('.web'))
  const head = box(document.querySelector('.web > .head'))
  if (!web || !head) return null

  return { x: web.x, y: head.y + head.height, width: web.width, height: web.height - head.height }
}
"""

#: What is on top at each of those nine points, named the way the pane's own hit
#: test would name it. Anything that is not the web surface is something drawn over
#: the page, which on a desktop is something drawn *behind* it.
WHAT_IS_OVER = """
(rect) => {
  const web = document.querySelector('.web')
  const found = []

  for (const x of [0.08, 0.5, 0.92]) {
    for (const y of [0.08, 0.5, 0.92]) {
      const on = document.elementFromPoint(rect.x + rect.width * x, rect.y + rect.height * y)
      if (on && web && (on === web || web.contains(on))) continue

      const name = on === null ? 'nothing' : on.tagName
      const first = on && typeof on.className === 'string' ? on.className.split(' ')[0] : ''
      found.push(first ? `${name}.${first}` : name)
    }
  }

  return found
}
"""

#: Where a piece of the app's furniture is, or null when it is not up.
BOX = """
(selector) => {
  const el = document.querySelector(selector)
  if (!el) return null

  const one = el.getBoundingClientRect()
  return { x: one.x, y: one.y, width: one.width, height: one.height }
}
"""

#: Everything in the web tab's own bar that can be pressed, and where. The bar is the
#: one piece of the app that is still on screen over a page in full screen, and it
#: carries the dots - Chrome's rows, and the row full screen was turned on from. A way
#: out drawn on top of it would take the menu with it.
BAR_CONTROLS = """
() => {
  const head = document.querySelector('.web > .head')
  if (!head) return []

  return [...head.querySelectorAll('button, input')].map((el) => {
    const one = el.getBoundingClientRect()
    return {
      name: el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName,
      x: one.x,
      y: one.y,
      width: one.width,
      height: one.height,
    }
  })
}
"""


def overlaps(one: dict[str, float], other: dict[str, float]) -> bool:
    """Whether two rectangles share a pixel."""
    return (
        one["x"] < other["x"] + other["width"]
        and other["x"] < one["x"] + one["width"]
        and one["y"] < other["y"] + other["height"]
        and other["y"] < one["y"] + one["height"]
    )


def clear_over_the_page(page: Page, when: str) -> dict[str, float]:
    """The page's rectangle, with the nine points over it checked and reported."""
    rect = page.evaluate(PAGE_RECT)
    if not rect:
        raise SystemExit(f"there is no web surface on screen {when}")

    over = page.evaluate(WHAT_IS_OVER, rect)
    if over:
        wrong(f"{when}, the app is drawn over the page at {len(over)} of nine points: {over}")
    else:
        say(f"{when}, all nine points over the page are the page's own")

    return rect


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")

    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    wait_for(page, "document.querySelector('.web')", "a web tab")
    page.wait_for_timeout(250)
    shot(page, "01-page")

    clear = clear_over_the_page(page, "with nothing up")

    # ── The update notice ────────────────────────────────────────────────
    page.evaluate("() => { window.nibApp.updates.ready = '9.9.9' }")
    wait_for(page, "document.querySelector('.notice')", "the update notice")
    # The notice flies in over a fifth of a second, and the pane resizes under it.
    page.wait_for_timeout(500)
    shot(page, "02-notice")

    notice = page.evaluate(BOX, ".notice")
    if not notice:
        raise SystemExit("the update notice never arrived")

    noticed = clear_over_the_page(page, "with the update notice up")
    if overlaps(notice, noticed):
        wrong("the update notice is drawn over the page's rectangle")
    else:
        say("the update notice is beside the page's rectangle, not over it")

    # It took the room rather than borrowing it, which is the whole of the fix: the
    # page is shorter by the height of the row the notice is in.
    shorter = clear["height"] - noticed["height"]
    if shorter < notice["height"]:
        wrong(
            f"the page lost {shorter:.0f}px to a notice {notice['height']:.0f}px tall,"
            " so the notice is floating over it"
        )
    else:
        say(f"the page gave up {shorter:.0f}px for a notice {notice['height']:.0f}px tall")

    # ── And the room comes back ──────────────────────────────────────────
    page.evaluate("() => window.nibApp.updates.dismiss()")
    page.wait_for_timeout(500)
    back = page.evaluate(PAGE_RECT)
    if abs(back["height"] - clear["height"]) > 1:
        wrong(
            f"the page is {back['height']:.0f}px after the notice went,"
            f" against {clear['height']:.0f}px before it came"
        )
    else:
        say("the page has its room back")

    # ── Full screen, which is the page and nothing else ──────────────────
    # It used to put a layer on the overlay stack for the whole time it was on, and
    # that stack is what the pane reads to decide whether the page may be seen - so
    # F11 on a web tab hid the page it is meant to fill the screen with.
    page.evaluate("() => window.nibApp.fullscreen.enter(window.nibApp.workspace.activeTabId)")
    page.wait_for_timeout(500)
    shot(page, "03-fullscreen")

    filling = clear_over_the_page(page, "in full screen")
    if filling["height"] <= clear["height"]:
        wrong(
            f"the page is {filling['height']:.0f}px in full screen,"
            f" against {clear['height']:.0f}px with the app around it"
        )
    else:
        say(f"the page fills {filling['height']:.0f}px of the screen, up from {clear['height']:.0f}")

    # The way out has to stay on screen, and a way out drawn over the page is a way
    # out drawn behind it: the one thing full screen must never be is a room with no
    # door. See fullscreen.svelte.ts.
    leaving = page.evaluate(BOX, ".leave")
    if not leaving:
        wrong("there is no way out of full screen on screen")
    elif overlaps(leaving, filling):
        wrong("the way out of full screen is drawn over the page, which is behind it")
    else:
        say("the way out of full screen is clear of the page")

    # And clear of the bar it now shares a line with: the dots at the end of it are the
    # web tab's own way out of full screen, among Chrome's other rows.
    if leaving:
        buried = [
            one["name"] for one in page.evaluate(BAR_CONTROLS) if overlaps(leaving, one)
        ]
        if buried:
            wrong(f"the way out of full screen is drawn over the bar's own {buried}")
        else:
            say("the bar's own controls are clear of the way out")

    page.evaluate("() => window.nibApp.fullscreen.leave()")
    page.wait_for_timeout(400)
    shot(page, "04-back")
    context.close()


def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("nothing of the app's is over the page")


if __name__ == "__main__":
    raise SystemExit(main())
