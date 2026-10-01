"""A piece of the app that did not arrive.

hunt-7, 2026-09-30: one chunk lost - to a deploy under a tab that stayed open, or to
a flaky network - and the palette, the right-click menu, the prompt sheet, sign-in and
the format bar were dead for the rest of the session, without a word. The doors kept
the failed fetch, and Chromium keeps it too: a module that did not arrive is never
fetched from that address again while the page lives, which the unit suite cannot
show because Node has no module map of this kind. So this drive asks the real browser.

The palette's chunk is refused while the launch fetches it, which is the whole of the
simulated failure. Then two stories, each on a page of its own:

  - The same build: the site answers with the page that is running. The notices row
    offers Reload, Ctrl+O still does nothing (Chromium will not fetch that chunk
    again), and a press on Reload brings a page whose Ctrl+O opens the palette.
  - A newer build: the site answers with a page whose entry is another file. The page
    reloads itself once the hands are off it, and without anybody pressing anything
    the next Ctrl+O opens the palette.

And nothing is thrown on the way: a failure the page answers is not an error in it.

Run it from the repository root:

    python apps/desktop/test/e2e/chunk-lost.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import re
from typing import Any

from playwright.sync_api import Browser, Page, Route

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

#: The palette's own chunk, whatever the build hashed it to.
PALETTE = re.compile(r"/assets/Palette-[^/]+\.js$")

#: The entry script's address in the page, which is what a deploy changes.
ENTRY = re.compile(r'(<script type="module"[^>]*src="[^"]+\.js)"')

#: Whether the palette is on screen.
PALETTE_OPEN = "() => !!document.querySelector('.palette[role=dialog]')"

#: Something only this page load has, so a reload is seen as the page losing it.
MARK = "() => { window.__beforeReload = true }"
SAME_PAGE = "() => window.__beforeReload === true"


def lose_the_palette(page: Page) -> dict[str, int]:
    """Refuses the palette's chunk for as long as the drive says, and counts asks."""
    asked = {"palette": 0}

    def refuse(route: Route) -> None:
        asked["palette"] += 1
        route.abort("connectionreset")

    page.route(PALETTE, refuse)
    return asked


def press_for_palette(page: Page) -> bool:
    """Ctrl+O over the note, and whether the palette came up."""
    page.mouse.click(600, 400)
    page.keyboard.press("Control+O")
    try:
        page.wait_for_function(PALETTE_OPEN, timeout=4000, polling=50)
    except Exception:  # noqa: BLE001 - a timeout is the answer "it did not open"
        return False
    page.keyboard.press("Escape")
    page.wait_for_function(f"() => !({PALETTE_OPEN})()", timeout=4000, polling=50)
    return True


def same_build(browser: Browser) -> None:
    say("--- the same build: the network lost the piece ---")
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    asked = lose_the_palette(page)
    DRIVE.open(page)
    page.evaluate(MARK)

    offered = "() => !!document.querySelector('.notices .reload button')"
    if not DRIVE.waited(page, offered, "Reload on offer"):
        return
    say(f"    the palette's chunk was asked for {asked['palette']} time(s) and refused")
    shot(page, "same-build-offered")

    if press_for_palette(page):
        wrong("Ctrl+O opened a palette whose chunk never arrived")
    else:
        say("    Ctrl+O does nothing, as Chromium will not fetch the chunk again")
    if not page.evaluate(SAME_PAGE):
        wrong("the page reloaded by itself under the same build")

    page.unroute(PALETTE)
    with page.expect_navigation():
        page.click(".notices .reload button")
    DRIVE.ready(page)
    if press_for_palette(page):
        say("    after Reload, Ctrl+O opens the palette")
    else:
        wrong("the palette does not open after Reload")
    page.context.close()


def newer_build(browser: Browser) -> None:
    say("--- a newer build: the site moved on under the tab ---")
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    asked = lose_the_palette(page)
    served = {"root": 0}

    def deployed(route: Route) -> None:
        """The first page is the build; every page after it names another entry, which
        is what a deploy does to the index."""
        served["root"] += 1
        response = route.fetch()
        body = response.text()
        if served["root"] > 1:
            body = ENTRY.sub(r'\1?deploy=2"', body, count=1)
        route.fulfill(response=response, body=body)

    page.route(re.compile(r"^[^?#]+://[^/]+/(\?.*)?$"), deployed)
    DRIVE.open(page)
    page.evaluate(MARK)
    say(f"    the palette's chunk was asked for {asked['palette']} time(s) and refused")

    # The site is asked as the chunk fails; the hands are off, so the page goes.
    page.unroute(PALETTE)
    if not DRIVE.waited(page, f"() => !({SAME_PAGE})()", "the page to reload by itself", patience=30):
        shot(page, "newer-build-stuck")
        return
    DRIVE.ready(page)
    entry: Any = page.evaluate(
        "() => document.querySelector('script[type=module][src]')?.getAttribute('src')"
    )
    say(f"    reloaded by itself, now running {entry}")
    if "deploy=2" not in str(entry):
        wrong("the reload did not pick up the newer build")
    if page.evaluate("() => !!document.querySelector('.notices .reload')"):
        wrong("Reload was offered for a newer build rather than done")
    if press_for_palette(page):
        say("    and Ctrl+O opens the palette")
        shot(page, "newer-build-reloaded")
    else:
        wrong("the palette does not open after the reload")
    page.context.close()


def drive(browser: Browser) -> None:
    same_build(browser)
    newer_build(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a lost chunk comes back, by Reload or by itself"))
