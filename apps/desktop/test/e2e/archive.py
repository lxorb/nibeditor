"""The archive, seen: a note and a folder put away from their rows, gone from the
file list, listed at its foot and taken back out exactly where they were; one note
brought back out of an archived folder on its own; a link into an archived note
still drawn and marked; a folder holding something archived refused its deletion;
and the search's own switch for looking inside the archive.

Serves the built web app and drives it in the machine's own Chrome, headless. The
build has to be one a drive may steer - `--mode drive` - or `window.nib` and
`window.nibApp` are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/archive.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/archive/`.
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
SHOTS = HERE / "shots" / "archive"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18946
ORIGIN = f"http://127.0.0.1:{PORT}"

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nThe plan.\\n', root)
  await ws.noteFrom('# Keep\\n\\nSee [[Plan]] and [[Taxes]].\\n', root)
  await ws.noteFrom('# Notes\\n\\nOld notes.\\n', root + '/Old')
  await ws.noteFrom('# Taxes\\n\\nThe receipts.\\n', root + '/Old/2019')
  await ws.noteFrom('# Trip\\n\\nThe mountains, and a lighthouse.\\n', root + '/Old/2019')
  await ws.loadTree()
  return ws.notes.map((one) => one.path.slice(root.length + 1))
}
"""

TREE = """
() => [...document.querySelectorAll('.row[data-path]')].map((row) =>
  row.getAttribute('data-path').replace(/^.*?\\/(?=[^/]*$)/, '')
)
"""

ARCHIVE = """
() => [...document.querySelectorAll('.archive-head + ul .line .row .nib-row-label')].map(
  (one) => one.textContent
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
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.ThreadingTCPServer):
    """Never reuses the address, so a run cannot photograph the last one. A thread per
    request and a deep queue, because a page fetching forty chunks at once overflows
    a single-threaded server's backlog on a busy machine, and a refused chunk reads as
    the app being broken."""

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


def wait_for(page: Page, expression: str, what: str, patience: float = 20) -> None:
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


def fresh(browser: Browser) -> Page:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820}, color_scheme="light", reduced_motion="reduce"
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}") if message.type == "error" else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED)}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name === 'Keep.md')
          await ws.openEntry(note.path, {})
          if (ws.panel !== 'tree') ws.showPanel('tree')
          for (const path of ws.visibleRows()) if (!path.endsWith('.md')) ws.device.expand(path)
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(600)
    return page


def row_menu(page: Page, name: str, choose: str) -> None:
    """A row's own menu, by a right click, and one of its rows pressed."""
    page.locator(f'.row[data-path$="/{name}"]').first.click(button="right")
    wait_for(page, "document.querySelector('.rows .nib-row')", f"the menu of {name}")
    page.locator(".rows .nib-row", has_text=choose).first.click()
    page.wait_for_timeout(500)


def tree(page: Page) -> list[str]:
    return page.evaluate(TREE)


def drive(browser: Browser) -> None:
    page = fresh(browser)
    say(f"the list: {tree(page)}")
    shot(page, "01-the-list")

    # A note put away from its own row: gone from the list, the corner says so, and
    # the archive appears at the list's foot.
    row_menu(page, "Plan.md", "Archive")
    listed = tree(page)
    say(f"after archiving Plan: {listed}")
    if "Plan.md" in listed:
        wrong("the archived note is still in the file list")
    toast = page.evaluate("() => document.querySelector('.toast p')?.textContent ?? null")
    if toast != "Archived":
        wrong(f"the corner does not say Archived: {toast!r}")
    wait_for(page, "document.querySelector('.archive-head')", "the archive's head")
    shot(page, "02-archived")

    # The link into it still resolves, drawn marked rather than missing.
    marks = page.evaluate(
        """() => [...document.querySelectorAll('.cm-content .nib-link')].map((one) => ({
          text: one.textContent, archived: one.classList.contains('nib-link-archived'),
          missing: one.classList.contains('nib-link-missing'),
        }))"""
    )
    say(f"the links in Keep: {json.dumps(marks)}")
    plan = next((one for one in marks if one["text"] == "Plan"), None)
    if not plan or not plan["archived"] or plan["missing"]:
        wrong(f"the link into the archived note is not drawn marked: {plan}")

    # Undo from the corner puts it back where it was.
    page.locator(".toast .undo").click()
    page.wait_for_timeout(500)
    if tree(page) != listed and "Plan.md" not in tree(page):
        wrong(f"Undo did not bring the note back: {tree(page)}")
    say(f"after Undo: {tree(page)}")
    shot(page, "03-undone")

    # A folder put away takes everything under it.
    row_menu(page, "Plan.md", "Archive")
    row_menu(page, "Old", "Archive")
    listed = tree(page)
    say(f"after archiving Old: {listed}")
    if any(one in listed for one in ("Old", "Notes.md", "Taxes.md", "Trip.md")):
        wrong(f"the archived folder left rows behind: {listed}")

    # The archive, opened: newest first, each saying where it came from.
    page.locator(".archive-head").click()
    page.wait_for_timeout(400)
    rows = page.evaluate(ARCHIVE)
    say(f"the archive: {rows}")
    shot(page, "04-the-archive")
    if rows[:2] != ["Old", "Plan"]:
        wrong(f"the archive does not list the newest first: {rows}")

    # Into the folder, and one note brought back out of it on its own.
    page.locator(".archive-head + ul .line", has_text="Old").locator(".twist").click()
    page.wait_for_timeout(300)
    page.locator(".archive-head + ul .line", has_text="2019").locator(".twist").click()
    page.wait_for_timeout(300)
    page.locator(".archive-head + ul .line .row", has_text="Taxes").click()
    wait_for(page, "document.querySelector('.archived-strip .back')", "the strip over an archived note")
    shot(page, "05-opened-archived")
    page.locator(".archived-strip .back").click()
    page.wait_for_timeout(600)

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const path of ws.visibleRows()) if (!path.endsWith('.md')) ws.device.expand(path)
        }"""
    )
    page.wait_for_timeout(300)
    kept = page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          return { map: ws.archive.of(ws.activeSpace.root), open: ws.active?.path ?? null }
        }"""
    )
    say(f"the archive now: {json.dumps(kept)}")
    listed = tree(page)
    say(f"after taking Taxes back: {listed}")
    shot(page, "06-taxes-back")
    if "Taxes.md" not in listed or "2019" not in listed or "Old" not in listed:
        wrong(f"Taxes did not come back where it was: {listed}")
    if "Trip.md" in listed or "Notes.md" in listed:
        wrong(f"taking one note back brought its neighbours with it: {listed}")
    if page.evaluate("() => !!document.querySelector('.archived-strip')"):
        wrong("the strip stayed over a note that is no longer archived")

    # A folder holding something archived is never deleted.
    row_menu(page, "Old", "Delete")
    wait_for(page, "document.querySelector('[role=dialog], .nib-layer')", "the refusal")
    said = page.evaluate("() => document.querySelector('[role=dialog]')?.textContent ?? ''")
    say(f"the refusal: {said.strip()[:80]!r}")
    shot(page, "07-refused")
    if "Nothing archived is deleted" not in said:
        wrong("deleting a folder holding archived notes was not refused")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    if "Old" not in tree(page):
        wrong("the folder went anyway")

    # The search leaves the archive out until its switch is pressed.
    found = page.evaluate(
        """async () => {
          const { search, workspace } = window.nibApp
          workspace.showPanel('search')
          search.ask('lighthouse')
          await new Promise((done) => setTimeout(done, 900))
          const without = search.hits.length
          search.showArchived(true)
          await new Promise((done) => setTimeout(done, 900))
          const withIt = search.hits.length
          return { without, withIt }
        }"""
    )
    say(f"the search for a word only the archive holds: {json.dumps(found)}")
    shot(page, "08-search")
    if found["without"] != 0 or found["withIt"] < 1:
        wrong(f"the search's switch does not decide whether the archive answers: {found}")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                drive(browser)
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

    print("\nwhat is archived leaves the lists, is never deleted, and comes back", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
