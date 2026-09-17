"""A side panel held on one note, seen: the outline of the note on the left while
the note on the right is being written in, the name of the note it is held on,
and the row press that takes the reader back to it.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/panels.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/panels/`.
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
SHOTS = HERE / "shots" / "panels"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18963
ORIGIN = f"http://127.0.0.1:{PORT}"

LEFT = """# The left note

## First part

Words in the first part.

## Second part

Words in the second part.
"""

RIGHT = """# The right note

## Something else

Words nobody is looking for.
"""

SEED = """
async ([left, right]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(left, root)
  await ws.noteFrom(right, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""

# What the sidebar is showing, and which note it says it is about.
PANEL = """
() => ({
  rows: [...document.querySelectorAll('.body .row.heading .nib-row-label')].map(
    (one) => one.textContent,
  ),
  holding: document.querySelector('.body .holding')?.textContent ?? null,
  held: document.querySelector('.tools .tool')?.getAttribute('aria-pressed') ?? null,
  tools: document.querySelectorAll('.tools .tool').length,
  active: window.nibApp.workspace.active?.name ?? null,
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


def fresh(browser: Browser, label: str, finger: bool = False) -> Page:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820} if not finger else {"width": 420, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {}
            if not finger
            else {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
        ),
    )
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
    say(f"[{label}] the space holds {page.evaluate(SEED, [LEFT, RIGHT])}")
    page.wait_for_timeout(300)
    return page


def open_note(page: Page, starts: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { activate: true })
        }""",
        starts,
    )
    page.wait_for_timeout(500)


def panel(page: Page) -> dict:
    return page.evaluate(PANEL)


def drive_holding(browser: Browser) -> None:
    page = fresh(browser, "desktop")

    open_note(page, "The left note")
    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(500)

    following = panel(page)
    say(f"[desktop] following the pane: {json.dumps(following, ensure_ascii=False)}")
    shot(page, "01-following")

    if following["rows"] != ["The left note", "First part", "Second part"]:
        wrong(f"the outline is not of the note being read: {following['rows']}")
    if following["held"] != "false":
        wrong("the panel says it is held before anybody held it")
    if following["holding"] is not None:
        wrong("a panel that follows says it is holding something")

    # Held, and then a second note opened beside it in another pane.
    page.locator(".tools .tool").first.click()
    page.wait_for_timeout(400)
    page.evaluate("() => window.nibApp.workspace.split('row')")
    page.wait_for_timeout(600)
    open_note(page, "The right note")

    holding = panel(page)
    say(f"[desktop] held while the other note is open: {json.dumps(holding, ensure_ascii=False)}")
    shot(page, "02-held")

    if holding["active"] != "The right note.md":
        wrong(f"the pane being worked in is not the right note: {holding['active']}")
    if holding["rows"] != ["The left note", "First part", "Second part"]:
        wrong(f"the held outline followed the other pane: {holding['rows']}")
    if holding["held"] != "true":
        wrong("the panel does not say it is held")
    if holding["holding"] != "The left note":
        wrong(f"the panel does not say which note it is held on: {holding['holding']!r}")

    # A row in a held panel takes the reader to the note it is about.
    page.locator(".body .row.heading", has_text="Second part").first.click()
    page.wait_for_timeout(600)
    landed = page.evaluate(
        """() => ({
          note: window.nibApp.workspace.active?.name ?? null,
          line: window.nibApp.workspace.active?.line ?? null,
        })"""
    )
    say(f"[desktop] after pressing a row: {json.dumps(landed)}")
    shot(page, "03-jumped-back")
    if landed["note"] != "The left note.md":
        wrong(f"pressing a row in a held panel did not go to its note: {landed['note']}")

    # And it follows again when the hold comes off.
    page.locator(".tools .tool").first.click()
    page.wait_for_timeout(300)
    page.evaluate("() => window.nibApp.workspace.panes.focusNext()")
    page.wait_for_timeout(600)
    freed = panel(page)
    say(f"[desktop] following again: {json.dumps(freed, ensure_ascii=False)}")
    shot(page, "04-following-again")
    if freed["holding"] is not None:
        wrong("the panel still says it is holding something")
    if freed["rows"] and freed["rows"][0] != freed["active"].replace(".md", ""):
        wrong(f"the outline did not follow the pane again: {freed['rows']}")

    page.context.close()


def drive_links(browser: Browser) -> None:
    page = fresh(browser, "links")
    open_note(page, "The left note")
    page.evaluate("() => window.nibApp.workspace.showPanel('links')")
    page.wait_for_timeout(500)

    tools = page.evaluate("() => document.querySelectorAll('.tools .tool').length")
    say(f"[links] the tools in the row: {tools}")
    shot(page, "10-links")
    if tools != 2:
        wrong(f"the links panel offers {tools} tools, not the hold and the graph")

    page.context.close()


def drive_finger(browser: Browser) -> None:
    page = fresh(browser, "phone", finger=True)
    open_note(page, "The left note")
    page.evaluate("() => window.nibApp.workspace.showPanel('outline')")
    page.wait_for_timeout(500)

    tools = page.evaluate("() => document.querySelectorAll('.tools .tool').length")
    say(f"[phone] the tools in the row: {tools}")
    shot(page, "20-phone")
    if tools:
        wrong("a screen that holds one document offers a panel to hold it against")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- the outline, held ---")
                drive_holding(browser)
                say("--- the links panel ---")
                drive_links(browser)
                say("--- a finger ---")
                drive_finger(browser)
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

    print("\na panel can be held on one note while another is written in", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
