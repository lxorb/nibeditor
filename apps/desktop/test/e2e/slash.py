"""The `/` menu, seen: typing a slash opens the blocks, typing narrows them,
Enter inserts one and takes the slash with it, Escape leaves the slash where it
was, and a slash in the middle of a word is a slash.

Serves the built web app and drives it in the machine's own Chrome, on a desktop
and on a phone.

Run it from the repository root:

    python apps/desktop/test/e2e/slash.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/slash/`.
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
SHOTS = HERE / "shots" / "slash"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18957
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = "# Slash\n\nSomething already written.\n"

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Slash'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

ROWS = """
() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map(
  (one) => one.textContent,
)
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
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
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


def fresh(browser: Browser, finger: bool) -> Page:
    context = browser.new_context(
        viewport={"width": 420, "height": 880} if finger else {"width": 1180, "height": 820},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)
    return page


def caret_at_end(page: Page) -> None:
    page.evaluate(
        """() => {
          const doc = window.nib.state.doc
          window.nib.dispatch({
            changes: { from: doc.length, insert: '\\n\\n' },
            selection: { anchor: doc.length + 2 },
          })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(300)


def drive(browser: Browser) -> None:
    page = fresh(browser, finger=False)
    caret_at_end(page)

    page.keyboard.type("/", delay=30)
    page.wait_for_timeout(600)
    rows = page.evaluate(ROWS)
    say(f"[slash] {len(rows)} rows, first: {json.dumps(rows[:4])}")
    shot(page, "01-open")
    if len(rows) < 15:
        wrong(f"the slash offered {len(rows)} blocks")
    if not any("Table" in one for one in rows):
        wrong("the blocks the Paragraph menu offers are not all here")

    # Typing narrows it, on the words the rows show.
    page.keyboard.type("tab", delay=40)
    page.wait_for_timeout(600)
    narrowed = page.evaluate(ROWS)
    say(f"[/tab] {json.dumps(narrowed)}")
    shot(page, "02-narrowed")
    if not narrowed or not any("Table" in one for one in narrowed):
        wrong(f"typing did not narrow to the table: {narrowed}")

    # Enter inserts it and the slash goes with it.
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    doc = page.evaluate("() => window.nib.state.doc.toString()")
    say(f"[after] {json.dumps(doc[-60:])}")
    shot(page, "03-inserted")
    if "/tab" in doc:
        wrong("the slash and what was typed after it are still in the note")
    if "|" not in doc:
        wrong(f"no table was written: {json.dumps(doc[-60:])}")

    # Escape leaves the slash where it was typed.
    page.evaluate("() => window.nib.focus()")
    caret_at_end(page)
    page.keyboard.type("/quo", delay=40)
    page.wait_for_timeout(500)
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    shut = page.evaluate(ROWS)
    kept = page.evaluate("() => window.nib.state.doc.toString()")
    shot(page, "04-escaped")
    if shut:
        wrong("Escape left the menu open")
    if not kept.endswith("/quo"):
        wrong(f"Escape took the slash with it: {json.dumps(kept[-20:])}")

    # And a slash that names nothing is a slash.
    page.keyboard.type("xyz", delay=30)
    page.wait_for_timeout(500)
    nothing = page.evaluate(ROWS)
    if nothing:
        wrong(f"a slash that names nothing still offered rows: {nothing}")

    caret_at_end(page)
    page.keyboard.type("and/or and 24/7", delay=20)
    page.wait_for_timeout(500)
    inside = page.evaluate(ROWS)
    shot(page, "05-a-slash-in-a-word")
    if inside:
        wrong(f"a slash in the middle of a word opened the menu: {inside}")

    page.context.close()


def finger(browser: Browser) -> None:
    page = fresh(browser, finger=True)
    caret_at_end(page)

    page.keyboard.type("/", delay=30)
    page.wait_for_timeout(700)
    rows = page.evaluate(ROWS)
    say(f"[phone] {len(rows)} rows")
    shot(page, "10-phone")
    if not rows:
        wrong("the slash menu does not open on a phone")

    box = page.evaluate(
        """() => {
          const menu = document.querySelector('.cm-tooltip-autocomplete')
          if (!menu) return null
          const rect = menu.getBoundingClientRect()
          return { left: rect.left, top: rect.top, width: rect.width }
        }"""
    )
    say(f"[phone] the menu sits at {json.dumps(box)}")
    if not box or box["left"] < 0 or box["width"] < 80:
        wrong(f"the menu is not where a thumb can reach it: {box}")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- a pointer ---")
                drive(browser)
                say("--- a finger ---")
                finger(browser)
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

    print("\na slash offers the blocks, and a slash in a word is a slash", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
