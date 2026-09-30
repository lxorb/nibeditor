"""Tooltips with keys, tab hover cards and several tabs at once, driven.

Three things a unit test cannot see because they happen between a pointer and a
screen:

  - every icon-only control says its key in its tooltip, the key the registry holds
    now: rebinding one shows at once (lib/titled.ts);
  - a card hangs under a tab the pointer rests on after Chrome's wait, slides across
    to the next tab at once, and goes when the pointer leaves the strip, on a press,
    and never over a menu (lib/tab-strip/hover-card.svelte.ts);
  - three tabs picked with Ctrl, dragged along the strip together, carried to the
    other pane together, closed together, and brought back by one Reopen closed tab
    (lib/tab-strip/chosen.svelte.ts and picking.ts).

Serves the built web app and drives it headless in the machine's own Chrome. The
build has to be one a drive may steer - `--mode drive` - or `window.nibApp` is not
there. A still of a web page in a card is the native app's alone (the web build has
no way to photograph a site's frame), so that half is left to the probe.

Run it from the repository root:

    python apps/desktop/test/e2e/tabs-hints.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/tabs-hints/`.
"""

from __future__ import annotations

import functools
import http.server
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "tabs-hints"

# Where this drive listens; see docs/conventions.md.
PORT = 23911
ORIGIN = f"http://127.0.0.1:{PORT}"

NAMES = ["Alpha", "Beta", "Gamma", "Delta"]

# Four notes in the space, each in a tab of its own, the first in front.
SEED = """
async (names) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const one of [...ws.tabs]) ws.close(one.id)

  for (const name of names) {
    const path = await ws.noteFrom(`# ${name}\\n\\nWords about ${name}.\\n`, root)
    await ws.open(path)
    ws.keep(ws.activeTabId)
  }
  // Whatever the launch opened on its own - the welcome note - goes, so the strip is
  // these four.
  for (const one of ws.tabs.filter((tab) => !names.includes(tab.shown))) ws.close(one.id)
  ws.activate(ws.tabs.find((one) => one.shown === names[0]).id)
  if (!ws.panel) ws.showPanel('tree')
  return ws.tabs.map((one) => one.shown)
}
"""

# The strip of the pane in front, by name, and which of them are picked.
STRIP = """
() => {
  const ws = window.nibApp.workspace
  return ws.panes.all.map((pane) => ({
    id: pane.id,
    tabs: ws.tabsIn(pane.id).map((one) => one.shown),
    picked: [...document.querySelectorAll(`[data-strip="${pane.id}"] .tab.chosen .label`)].map(
      (one) => one.textContent,
    ),
  }))
}
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
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
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


class Strict(socketserver.ThreadingTCPServer):
    """Never reuses the address, so a run cannot photograph the last one; answers the
    page's modules side by side, with a queue long enough for all of them at once - the
    default five is refused connections on a busy machine."""

    allow_reuse_address = False
    daemon_threads = True
    request_queue_size = 128


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


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return True
        page.wait_for_timeout(40)
    wrong(f"gave up waiting for {what}")
    return False


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def title(page: Page, selector: str) -> str:
    found = page.locator(selector).first
    if found.count() == 0:
        wrong(f"nothing at {selector}")
        return ""
    return found.get_attribute("title") or ""


def keyed(page: Page, selector: str, name: str, key: str) -> None:
    said = title(page, selector)
    if said != f"{name} ({key})":
        wrong(f"{selector} says {said!r}, not {name!r} with {key!r}")
    else:
        say(f"{said}")


def centre(page: Page, selector: str) -> tuple[float, float]:
    box = page.locator(selector).first.bounding_box()
    if not box:
        raise SystemExit(f"nothing to point at: {selector}")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def tab(name: str) -> str:
    return f'.tab:has(.label:text-is("{name}")) .pick'


def tooltips(page: Page) -> None:
    say("the tooltips")
    keyed(page, "header .toggle", "Hide sidebar", "Ctrl+Shift+L")
    keyed(page, ".tabs .new", "New", "Ctrl+T")
    keyed(page, ".tab.active .shut", "Close", "Ctrl+W")
    keyed(page, '[data-region="panels"] [role="tab"]', "Files", "Ctrl+Shift+E")
    keyed(page, '.foot button[aria-label="Settings"]', "Settings", "Ctrl+,")

    # A key given another key shows the new one at once, and a key taken away takes
    # the brackets with it.
    page.evaluate("() => window.nibApp.shortcuts.set('app.sidebar', 'Mod-Alt-j')")
    page.wait_for_timeout(60)
    keyed(page, "header .toggle", "Hide sidebar", "Ctrl+Alt+J")
    page.evaluate("() => window.nibApp.shortcuts.set('app.sidebar', null)")
    page.wait_for_timeout(60)
    if title(page, "header .toggle") != "Hide sidebar":
        wrong("a key taken away still shows in the sidebar toggle's tooltip")
    page.evaluate("() => window.nibApp.shortcuts.reset('app.sidebar')")

    # The format bar, over a word picked in the note. Before the find bar: a word picked
    # after the find bar has been up overflows the editor's update listener on main as
    # it stands (reported), and the bar never comes.
    page.locator('.cm-line:has-text("Words about")').first.dblclick()
    if wait_for(page, "document.querySelector('.nib-bar-at')", "the format bar", 10):
        keyed(page, '.nib-bar-at button[aria-label="Bold"]', "Bold", "Ctrl+B")
    page.keyboard.press("ArrowRight")

    # The find bar's steps, over the note in front.
    page.locator(".cm-content").first.click()
    page.keyboard.press("Control+f")
    if wait_for(page, "document.querySelector('.findbar')", "the find bar", 10):
        page.keyboard.type("Words")
        keyed(page, '.findbar button[aria-label="Next"]', "Next", "Ctrl+G")
        keyed(page, '.findbar button[aria-label="Previous"]', "Previous", "Ctrl+Shift+G")
        keyed(page, '.findbar button[aria-label="Close"]', "Close", "Esc")
        page.keyboard.press("Escape")

    # A web tab's bar: back, forward and reload say Chrome's keys.
    page.evaluate("() => window.nibApp.workspace.openPage('https://example.com/', 'plain')")
    if wait_for(page, "document.querySelector('.webbar')", "a web tab's bar", 15):
        keyed(page, '.webbar button[aria-label="Back"]', "Back", "Alt+←")
        keyed(page, '.webbar button[aria-label="Forward"]', "Forward", "Alt+→")
        reload = title(page, '.webbar button[aria-label="Reload"], .webbar button[aria-label="Stop"]')
        if not re.fullmatch(r"(Reload \(F5\)|Stop \(Esc\))", reload):
            wrong(f"the web bar's reload says {reload!r}")
        else:
            say(reload)
    page.evaluate("() => window.nibApp.workspace.closeActive()")

    # The canvas bar's tools say the plane's own keys.
    page.evaluate(
        "async () => { const ws = window.nibApp.workspace; await ws.createCanvas(ws.activeSpace.root, 'Board.canvas') }"
    )
    if wait_for(page, "document.querySelector('.scroller')", "the canvas bar", 20):
        keyed(page, '.scroller button[aria-label="Select"]', "Select", "V")
        keyed(page, '.scroller button[aria-label="Undo"]', "Undo", "Ctrl+Z")
    page.evaluate("() => window.nibApp.workspace.closeActive()")
    shot(page, "01-tooltips")


def card_up(page: Page) -> bool:
    return bool(page.evaluate("() => !!document.querySelector('.card')"))


def hover_cards(page: Page) -> None:
    say("the hover cards")
    page.mouse.move(640, 500)
    page.wait_for_timeout(400)

    if page.locator(".tabs .pick[title]").count():
        wrong("a tab still has a native tooltip beside its card")

    x, y = centre(page, tab("Beta"))
    started = time.monotonic()
    page.mouse.move(x, y, steps=4)
    page.wait_for_timeout(200)
    if card_up(page):
        wrong("the card came before Chrome's wait")
    if not wait_for(page, "document.querySelector('.card')", "a card under Beta", 3):
        return
    say(f"the card came after {int((time.monotonic() - started) * 1000)} ms")
    words = page.locator(".card").inner_text()
    if "Beta" not in words:
        wrong(f"the card under Beta says {words!r}")
    shot(page, "02-card")

    # One card up, the next tab's comes at once and the card slides across.
    x, y = centre(page, tab("Gamma"))
    page.mouse.move(x, y, steps=3)
    page.wait_for_timeout(120)
    if "Gamma" not in (page.locator(".card").inner_text() if card_up(page) else ""):
        wrong("the card did not follow the pointer to the next tab at once")
    page.wait_for_timeout(300)
    shot(page, "03-card-slid")

    # Off the strip and into the note: gone.
    page.mouse.move(640, 500, steps=4)
    page.wait_for_timeout(400)
    if card_up(page):
        wrong("the card stayed after the pointer left the strip")

    # A press on the tab puts it away, and it does not come back for that tab.
    x, y = centre(page, tab("Delta"))
    page.mouse.move(x, y, steps=3)
    wait_for(page, "document.querySelector('.card')", "a card under Delta", 3)
    page.mouse.down()
    page.mouse.up()
    page.wait_for_timeout(400)
    if card_up(page):
        wrong("the card stayed through a press on its tab")
    page.mouse.move(640, 500, steps=3)
    page.wait_for_timeout(400)

    # Never over a menu.
    x, y = centre(page, tab("Alpha"))
    page.mouse.click(x, y, button="right")
    page.wait_for_timeout(200)
    bx, by = centre(page, tab("Beta"))
    page.mouse.move(bx, by, steps=3)
    page.wait_for_timeout(1800)
    if card_up(page):
        wrong("a card came up over an open menu")
    page.keyboard.press("Escape")
    page.mouse.move(640, 500, steps=3)
    page.wait_for_timeout(400)


def strip(page: Page) -> list[dict]:
    return page.evaluate(STRIP)


def several(page: Page) -> None:
    say("several tabs at once")
    page.locator(tab("Alpha")).click()
    page.locator(tab("Gamma")).click(modifiers=["Control"])
    page.locator(tab("Delta")).click(modifiers=["Control"])
    page.wait_for_timeout(200)
    now = strip(page)[0]
    say(f"picked {now['picked']}")
    if sorted(now["picked"]) != ["Alpha", "Delta", "Gamma"]:
        wrong(f"Ctrl and a click picked {now['picked']}")
    shot(page, "04-picked")

    # Its menu is about all three.
    page.locator(tab("Gamma")).click(button="right")
    menu = page.locator('[role="menu"]')
    menu.wait_for(state="visible", timeout=5000)
    if menu.get_attribute("aria-label") != "3 tabs":
        wrong(f"the menu of a picked tab says {menu.get_attribute('aria-label')!r}")
    shot(page, "05-pick-menu")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # Dragged along the strip, all three go together, to the end.
    sx, sy = centre(page, tab("Gamma"))
    end = page.locator(".tabs .new").first.bounding_box()
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + 30, sy, steps=4)
    page.mouse.move(end["x"] + 4, sy, steps=12)
    page.wait_for_timeout(150)
    shot(page, "06-block-carried")
    page.mouse.up()
    page.wait_for_timeout(500)
    now = strip(page)[0]
    say(f"after the drag {now['tabs']}")
    if now["tabs"] != ["Beta", "Alpha", "Gamma", "Delta"]:
        wrong(f"the block did not land together at the end: {now['tabs']}")
    if sorted(now["picked"]) != ["Alpha", "Delta", "Gamma"]:
        wrong(f"the pick did not survive its drag: {now['picked']}")

    # Carried to the other pane together.
    page.evaluate("() => window.nibApp.workspace.split('row', window.nibApp.workspace.tabs.find((one) => one.shown === 'Beta').id)")
    page.wait_for_timeout(500)
    page.locator(tab("Alpha")).first.click()
    page.locator(tab("Gamma")).first.click(modifiers=["Control"])
    page.locator(tab("Delta")).first.click(modifiers=["Control"])
    panes = strip(page)
    left = panes[0]["id"]
    right = panes[1]
    target = page.locator(f'[data-strip="{right["id"]}"]').bounding_box()
    sx, sy = centre(page, f'[data-strip="{left}"] {tab("Gamma")}')
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx, sy + 40, steps=4)
    page.mouse.move(target["x"] + target["width"] - 60, target["y"] + target["height"] / 2, steps=14)
    page.wait_for_timeout(200)
    shot(page, "07-block-over-the-other-pane")
    page.mouse.up()
    page.wait_for_timeout(600)
    panes = strip(page)
    say(f"after the carry {[one['tabs'] for one in panes]}")
    if not any(one["tabs"][-3:] == ["Alpha", "Gamma", "Delta"] for one in panes):
        wrong(f"the three did not arrive in the other pane together: {panes}")

    # Closed together, and back with one Reopen closed tab.
    before = [one["tabs"] for one in strip(page)]
    page.keyboard.press("Control+w")
    page.wait_for_timeout(500)
    after = [one["tabs"] for one in strip(page)]
    say(f"Ctrl+W on the pick: {after}")
    if any("Gamma" in one for one in after):
        wrong(f"Ctrl+W did not close the whole pick: {after}")
    page.evaluate("() => window.nibApp.workspace.reopenClosed()")
    page.wait_for_timeout(500)
    again = [one["tabs"] for one in strip(page)]
    say(f"reopened: {again}")
    if again != before:
        wrong(f"one Reopen closed tab did not bring the pick back where it was: {again}")
    shot(page, "08-reopened")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    build()
    server = serve()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            context = browser.new_context(viewport={"width": 1280, "height": 820})
            page = context.new_page()
            page.on("pageerror", lambda error: wrong(f"page error: {error}"))
            page.on("console", lambda message: say(f"console {message.type}: {message.text[:200]}") if message.type in ("error", "warning") else None)
            page.goto(ORIGIN, wait_until="domcontentloaded")
            if not wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space", 40):
                shot(page, "00-no-space")
                say(page.evaluate("() => [location.href, document.readyState, document.body.innerText.slice(0, 300), !!window.nibApp]"))
                raise SystemExit(1)
            say(f"seeded {page.evaluate(SEED, NAMES)}")
            page.wait_for_timeout(500)

            tooltips(page)
            hover_cards(page)
            several(page)
            browser.close()
    finally:
        server.shutdown()
        server.server_close()

    print(f"\n{len(failures)} failed" if failures else "\nall held")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
