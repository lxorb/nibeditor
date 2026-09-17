"""Tabs that stay and tabs that remember, seen: a pinned tab at the head of the
strip wearing its mark and refusing to close, and the trail a tab leaves as it
moves from note to note, walked with the two arrows.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/tabs.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/tabs/`.
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

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "tabs"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18964
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTES = {
    "Daily": "# Daily\n\nThe note that stays open.\n",
    "First": "# First\n\nThe first stop.\n",
    "Second": "# Second\n\nThe second stop.\n",
    "Third": "# Third\n\nThe third stop.\n",
}

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const text of notes) await ws.noteFrom(text, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

# The strip, as the reader sees it.
STRIP = """
() => ({
  tabs: [...document.querySelectorAll('.tab')].map((tab) => ({
    name: tab.querySelector('.label')?.textContent ?? null,
    pinned: tab.classList.contains('pinned'),
    // Every tab wears one of these since a4be39f4 - the mark of the kind of thing
    // it holds - and a pinned tab is that mark with the name taken away. Which mark
    // it is, and that there is exactly one, is tab-icons.py's question.
    mark: !!tab.querySelector('.mark'),
    shut: !!tab.querySelector('.shut'),
    width: Math.round(tab.getBoundingClientRect().width),
  })),
  steps: [...document.querySelectorAll('.step')].map((one) => one.disabled),
  showing: window.nibApp.workspace.active?.name ?? null,
  trail: (window.nibApp.workspace.active?.trail ?? []).map((one) => one.split(/[\\\\/]/).pop()),
  at: window.nibApp.workspace.active?.at ?? null,
})
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
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address, so a run cannot photograph the last one."""

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
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fresh(browser: Browser, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, list(NOTES.values()))}")
    page.wait_for_timeout(300)
    return page


def peek(page: Page, name: str) -> None:
    """A single click in the file list: the preview tab takes the note on."""
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { preview: true })
        }""",
        name,
    )
    page.wait_for_timeout(500)


def keep(page: Page, name: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, {})
        }""",
        name,
    )
    page.wait_for_timeout(500)


def strip(page: Page) -> dict:
    return page.evaluate(STRIP)


def drive_pinned(browser: Browser) -> None:
    page = fresh(browser, "pinned")
    keep(page, "Daily")
    keep(page, "First")
    keep(page, "Second")

    before = strip(page)
    say(f"[pinned] the strip: {json.dumps([one['name'] for one in before['tabs']])}")

    # Pin the daily note, which is not the tab in front.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.name.startsWith('Daily'))
          ws.togglePin(tab.id)
        }"""
    )
    page.wait_for_timeout(500)

    pinned = strip(page)
    say(f"[pinned] after pinning: {json.dumps(pinned['tabs'], ensure_ascii=False)}")
    shot(page, "01-pinned")

    first = pinned["tabs"][0]
    if not first["pinned"]:
        wrong("the pinned tab is not at the head of the strip")
    if not first["mark"]:
        wrong("a pinned tab does not wear its mark")
    if first["name"] is not None:
        wrong(f"a pinned tab still spends the room on its name: {first['name']!r}")
    if first["shut"]:
        wrong("a pinned tab offers a cross that cannot close it")
    if first["width"] > 60:
        wrong(f"a pinned tab is as wide as a named one: {first['width']}px")

    # It refuses to close, and it is never taken over by a preview.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.pinned)
          await ws.closeAsking(tab.id)
        }"""
    )
    page.wait_for_timeout(400)
    if not page.evaluate("() => window.nibApp.workspace.tabs.some((one) => one.pinned)"):
        wrong("a pinned tab closed when it was asked to")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.pinned)
          ws.activate(tab.id)
          ws.previewTabId = tab.id
        }"""
    )
    peek(page, "Third")
    held = page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.pinned)
          return { name: tab?.name ?? null, tabs: ws.tabs.length }
        }"""
    )
    say(f"[pinned] after previewing another note: {json.dumps(held)}")
    shot(page, "02-not-taken-over")
    if held["name"] != "Daily.md":
        wrong(f"a preview took the pinned tab over: it now holds {held['name']}")

    # And it comes back pinned.
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.tabs.length", "[pinned] the reload")
    page.wait_for_timeout(1200)
    back = strip(page)
    say(f"[pinned] after a reload: {json.dumps(back['tabs'], ensure_ascii=False)}")
    shot(page, "03-after-reload")
    if not back["tabs"] or not back["tabs"][0]["pinned"]:
        wrong("the pin did not survive a restart")

    page.context.close()


def drive_trail(browser: Browser) -> None:
    page = fresh(browser, "trail")

    # One tab, walked from note to note the way a single click walks it.
    peek(page, "First")
    peek(page, "Second")
    peek(page, "Third")

    walked = strip(page)
    say(f"[trail] where the tab has been: {json.dumps(walked['trail'])} at {walked['at']}")
    shot(page, "10-walked")

    if walked["trail"] != ["First.md", "Second.md", "Third.md"]:
        wrong(f"the tab did not write down where it has been: {walked['trail']}")
    if walked["steps"] != [False, True]:
        wrong(f"the arrows do not say where it can go: {walked['steps']}")

    # Back, and back again.
    page.locator(".step").first.click()
    page.wait_for_timeout(600)
    once = strip(page)
    say(f"[trail] one step back: showing {once['showing']}, at {once['at']}")
    shot(page, "11-back")
    if once["showing"] != "Second.md":
        wrong(f"back did not go back: {once['showing']}")
    if once["steps"] != [False, False]:
        wrong(f"the arrows do not say both ways are open: {once['steps']}")

    page.locator(".step").first.click()
    page.wait_for_timeout(600)
    twice = strip(page)
    say(f"[trail] two steps back: showing {twice['showing']}, at {twice['at']}")
    if twice["showing"] != "First.md":
        wrong(f"the second step back did not go back: {twice['showing']}")
    if twice["steps"] != [True, False]:
        wrong(f"the far end of the trail is not the far end: {twice['steps']}")

    # Forward again, by key this time.
    page.locator(".cm-content").click()
    page.keyboard.press("Alt+ArrowRight")
    page.wait_for_timeout(600)
    on = strip(page)
    say(f"[trail] forward by key: showing {on['showing']}")
    shot(page, "12-forward")
    if on["showing"] != "Second.md":
        wrong(f"Alt and an arrow did not go forward: {on['showing']}")

    # A note opened from halfway along drops what was ahead - as long as it is not
    # already open in another tab, because a note that is gets brought forward instead
    # and the trail read below would be that tab's rather than this one's. It can be:
    # a window with no sitting behind it opens the first file of the space once the
    # list is on screen, the seed hands it these four while that read is still out,
    # and `Daily` is the first of them. So the strip is cleared back to the tab that
    # was walked. See `open` in workspace.svelte.ts.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const one of [...ws.tabs]) if (one.id !== ws.activeTabId) ws.close(one.id)
        }"""
    )
    page.wait_for_timeout(250)

    peek(page, "Daily")
    turned = strip(page)
    say(f"[trail] after turning off it: {json.dumps(turned['trail'])} at {turned['at']}")
    shot(page, "13-turned-off")
    if turned["trail"] != ["First.md", "Second.md", "Daily.md"]:
        wrong(f"the road not taken was kept: {turned['trail']}")

    # The trail itself, behind the back arrow.
    page.locator(".step").first.click(button="right")
    page.wait_for_timeout(400)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.rows .nib-row')].map((row) => row.textContent.trim())"
    )
    say(f"[trail] behind the back arrow: {json.dumps(rows)}")
    shot(page, "14-the-trail")
    if rows != ["Second", "First"]:
        wrong(f"the trail does not read newest first: {rows}")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- a tab that stays ---")
                drive_pinned(browser)
                say("--- a tab that remembers ---")
                drive_trail(browser)
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

    print("\na tab can be kept at the front, and can go back where it came from", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
