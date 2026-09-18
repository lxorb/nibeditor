"""A link in a note opens in nib, and the modifier says where.

nib holds pages, so a link in somebody's words has no business handing them to
another browser. What this drives, in order:

* **Ctrl+click in a note opens a tab behind it.** The page is in the strip, the note
  is still the one being read, and nothing left the app.
* **The middle button does the same with a different finger**, which is what it does
  in every browser and what it did in none of nib before this.
* **Ctrl+Shift+click opens it in front**, which is the browser's own way of saying
  "and take me there".
* **A locked note follows a plain click**, and follows it into a tab in front - the
  reading case, where there is no caret for a click to be about.
* **The reading view answers the same three gestures**, because it draws the same
  words through a different renderer.
* **A right click on a link offers the browser**, which is the way out in words for a
  hand that does not know Shift+click - and it is not offered on words that are not a
  link.
* **A `mailto:` link is never a tab.** No modifier turns an email address into a
  page, and nothing local is reachable from a note at all.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode development

Then, from the repository root:

    python apps/desktop/test/e2e/link-tabs.py

Screenshots go beside this file under `shots/link-tabs/`, which is ignored. It fails
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
SHOTS = APP / "test" / "e2e" / "shots" / "link-tabs"

PORT = 23794
ORIGIN = f"http://127.0.0.1:{PORT}"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

NOTE = (
    "# Kestrel notes\\n\\n"
    "The bird is written up at [Svelte](https://svelte.dev/docs) and the keeper is "
    "at [the keeper](mailto:keeper@example.com).\\n"
)

SEED = f"""
async () => {{
  const ws = window.nibApp.workspace
  await ws.noteFrom('{NOTE}', undefined)
  const first = ws.files.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, {{ activate: true }})
  return ws.tabs.length
}}
"""

# What the window is holding: every tab, which one is in front, and where the web
# ones point. `address` is what a tab opened from a link is put on.
STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    tabs: ws.tabs.map((one) => ({ kind: one.kind, address: one.address ?? null })),
    active: ws.active ? { kind: ws.active.kind, address: ws.active.address ?? null } : null,
  }
}
"""

# Every page this window would have handed to the system browser, caught rather than
# opened: a drive has no system browser, and a popup would be a window it never
# closed. What matters is which addresses arrive here and which do not.
CATCH = """
() => {
  window.__left = []
  const was = window.open
  window.open = (url) => {
    window.__left.push(String(url))
    return null
  }
  window.__unwrap = () => { window.open = was }
}
"""

LEFT = "() => window.__left"

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


def web_tabs(state: dict) -> list[str]:
    return [one["address"] or "" for one in state["tabs"] if one["kind"] == "web"]


def close_pages(page) -> None:
    """Back to one note, so each gesture is read against a clean strip."""
    page.evaluate(
        """
        () => {
          const ws = window.nibApp.workspace
          for (const one of [...ws.tabs]) if (one.kind === 'web') ws.close(one.id)
        }
        """
    )
    page.wait_for_timeout(250)


def press(page, selector: str, *, modifiers=(), button="left") -> None:
    page.locator(selector).first.click(modifiers=list(modifiers), button=button)
    page.wait_for_timeout(400)


def in_the_note(page) -> None:
    """The writing surface, where a plain click is the caret's and the modifier's is
    the link's."""
    say("--- a link in a note ---")

    link = ".nib-link[data-href]"
    if not page.locator(link).count():
        wrong("the note drew no link to press")
        return

    press(page, link, modifiers=["Control"])
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"Ctrl+click made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"Ctrl+click took the reader off their note: {state['active']}")
    else:
        say("Ctrl+click            -> a page in the strip, the note still in front")
    page.screenshot(path=str(SHOTS / "behind.png"))
    close_pages(page)

    press(page, link, button="middle")
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"the middle button made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"the middle button took the reader off their note: {state['active']}")
    else:
        say("middle-click          -> the same, with a different finger")
    close_pages(page)

    press(page, link, modifiers=["Control", "Shift"])
    state = page.evaluate(STATE)
    if state["active"]["address"] != "https://svelte.dev/docs":
        wrong(f"Ctrl+Shift+click did not open the page in front: {state}")
    else:
        say("Ctrl+Shift+click      -> the page, in front")
    page.screenshot(path=str(SHOTS / "in-front.png"))
    close_pages(page)


def an_email(page) -> None:
    """No modifier turns an email address into a page."""
    say("--- what is not a page ---")

    mail = '.nib-link[data-href^="mailto:"]'
    if not page.locator(mail).count():
        wrong("the note drew no mailto link to press")
        return

    page.evaluate(CATCH)
    press(page, mail, modifiers=["Control"])
    state = page.evaluate(STATE)
    left = page.evaluate(LEFT)
    page.evaluate("() => window.__unwrap()")

    if web_tabs(state):
        wrong(f"an email address became a tab: {state}")
    elif left != ["mailto:keeper@example.com"]:
        wrong(f"the email address did not leave for the system: {left}")
    else:
        say("Ctrl+click on mailto: -> left for the system, no tab made")
    close_pages(page)


def the_menu(page) -> None:
    """The way out in words, for a hand that does not know Shift+click."""
    say("--- a right click on a link ---")

    page.locator(".nib-link[data-href^='https']").first.click(button="right")
    page.wait_for_timeout(400)
    rows = page.evaluate(
        """
        () => [...document.querySelectorAll('.menu [role="menuitem"]')]
          .map((one) => one.textContent.trim())
        """
    )
    if not rows or rows[0] != "Open in the browser":
        wrong(f"the link's menu did not offer the browser first: {rows[:3]}")
    else:
        say("right click           -> 'Open in the browser' at the top")

    # And reachable, which the editor's menu was not: it is longer than a laptop
    # screen, and used to hang its first rows above the top of the window.
    box = page.locator('.menu [role="menuitem"]').first.bounding_box()
    if box is None or box["y"] < 0 or box["y"] + box["height"] > 900:
        wrong(f"the first row of the menu is off the window: {box}")
    else:
        say("and in the window     -> the rows scroll rather than hang off the top")
    page.screenshot(path=str(SHOTS / "menu.png"))

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # And not on plain words, where there is no link for it to be about.
    page.locator(".cm-content p, .cm-line").first.click(button="right")
    page.wait_for_timeout(400)
    rows = page.evaluate(
        """
        () => [...document.querySelectorAll('.menu [role="menuitem"]')]
          .map((one) => one.textContent.trim())
        """
    )
    if rows and rows[0] == "Open in the browser":
        wrong("the browser row appeared on words that are not a link")
    else:
        say("right click on words  -> no browser row, because there is no link")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def a_locked_note(page) -> None:
    """With the doors locked there is no caret to place, so the plain click is the
    link's - and it opens the page in front, the way a press on a page does."""
    say("--- a locked note ---")

    page.evaluate("() => window.nibApp.modes.toggleReadOnly(undefined)")
    page.wait_for_timeout(400)

    press(page, ".nib-link[data-href^='https']")
    state = page.evaluate(STATE)
    if state["active"]["address"] != "https://svelte.dev/docs":
        wrong(f"a plain click in a locked note did not open the page in front: {state}")
    else:
        say("plain click           -> the page, in front")
    close_pages(page)

    page.evaluate("() => window.nibApp.modes.toggleReadOnly(undefined)")
    page.wait_for_timeout(400)


def the_reading_view(page) -> None:
    """The same words through the renderer, answering the same three gestures."""
    say("--- the reading view ---")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(700)

    anchor = '.read a[href^="https"]'
    if not page.locator(anchor).count():
        wrong("the reading view drew no link to press")
        return

    press(page, anchor)
    state = page.evaluate(STATE)
    if state["active"]["address"] != "https://svelte.dev/docs":
        wrong(f"a plain click in the reading view did not open the page in front: {state}")
    else:
        say("plain click           -> the page, in front")
    page.screenshot(path=str(SHOTS / "reading.png"))
    close_pages(page)

    press(page, anchor, modifiers=["Control"])
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"Ctrl+click in the reading view made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"Ctrl+click in the reading view moved the reader: {state['active']}")
    else:
        say("Ctrl+click            -> a page in the strip, the reading still in front")
    close_pages(page)

    press(page, anchor, button="middle")
    state = page.evaluate(STATE)
    if web_tabs(state) != ["https://svelte.dev/docs"]:
        wrong(f"the middle button in the reading view made no web tab: {state}")
    elif state["active"]["kind"] != "note":
        wrong(f"the middle button in the reading view moved the reader: {state['active']}")
    else:
        say("middle-click          -> the same, with a different finger")
    close_pages(page)

    page.evaluate(CATCH)
    press(page, anchor, modifiers=["Shift"])
    state = page.evaluate(STATE)
    left = page.evaluate(LEFT)
    page.evaluate("() => window.__unwrap()")

    if web_tabs(state):
        wrong(f"Shift+click made a tab rather than leaving: {state}")
    elif left != ["https://svelte.dev/docs"]:
        wrong(f"Shift+click did not leave for the system browser: {left}")
    else:
        say("Shift+click           -> out to the system browser, which is the way out")
    close_pages(page)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(500)


def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_timeout(900)

    say(f"{page.evaluate(SEED)} tab(s) open")
    page.wait_for_timeout(600)

    in_the_note(page)
    the_menu(page)
    an_email(page)
    a_locked_note(page)
    the_reading_view(page)

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
