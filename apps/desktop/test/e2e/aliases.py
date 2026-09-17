"""The other names a note gives itself, seen: `[[Roadmap]]` reaching the note
whose front matter declares it, the completion offering an alias under the
note's real name, and the Links panel counting an alias link as a backlink.

Serves the built web app and drives it in the machine's own Chrome.

Run it from the repository root:

    python apps/desktop/test/e2e/aliases.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/aliases/`.
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
SHOTS = HERE / "shots" / "aliases"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18956
ORIGIN = f"http://127.0.0.1:{PORT}"

PLAN = "---\naliases:\n  - Roadmap\n  - The plan\n---\n\n# Plan\n\nWhat we are doing.\n"
OTHER = "# Other\n\nSee [[Roadmap]] and [[The plan]] and [[Nothing]].\n"

SEED = """
async ([plan, other]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(plan, root)
  await ws.noteFrom(other, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
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


def open_note(page: Page, starts: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { activate: true })
        }""",
        starts,
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)


LINKS = """
() => [...document.querySelectorAll('.cm-content .nib-link')].map((one) => ({
  words: one.textContent,
  missing: one.classList.contains('nib-link-missing'),
}))
"""


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, [PLAN, OTHER])}")
    page.wait_for_timeout(400)

    open_note(page, "Other")
    shot(page, "01-links")

    drawn = page.evaluate(LINKS)
    say(f"[drawn] {json.dumps(drawn)}")
    by_words = {one["words"]: one["missing"] for one in drawn}

    if by_words.get("Roadmap") is not False:
        wrong("a link by an alias is drawn as a name nothing answers to")
    if by_words.get("The plan") is not False:
        wrong("a link by the second alias is drawn as unresolved")
    if by_words.get("Nothing") is not True:
        wrong("a name nothing answers to is no longer drawn as one")

    # The panel: an alias link is a backlink of the note that declared it.
    open_note(page, "Plan")
    page.evaluate("() => window.nibApp.workspace.showPanel('links')")
    page.wait_for_timeout(900)
    shot(page, "02-backlinks")
    panel = page.evaluate(
        "() => [...document.querySelectorAll('aside .hit-note')].map((one) => one.textContent)"
    )
    say(f"[panel] {json.dumps(panel)}")
    if "Other" not in panel:
        wrong(f"the note linking by an alias is not among the backlinks: {panel}")

    # And the completion offers the alias, under the note's real name.
    open_note(page, "Other")
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
    page.keyboard.type("[[Road", delay=25)
    page.wait_for_timeout(800)
    shot(page, "03-completion")

    rows = page.evaluate(
        """() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((one) => ({
          label: one.querySelector('.cm-completionLabel')?.textContent ?? one.textContent,
          detail: one.querySelector('.cm-completionDetail')?.textContent ?? null,
        }))"""
    )
    say(f"[completion] {json.dumps(rows)}")
    alias = next((one for one in rows if (one["label"] or "").startswith("Roadmap")), None)
    if not alias:
        wrong("the completion does not offer the alias")
    elif alias["detail"] != "Plan":
        wrong(f"the alias row does not say which note it is: {alias}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    written = page.evaluate("() => window.nib.state.doc.toString()")
    if "[[Roadmap]]" not in written:
        wrong(f"choosing the alias did not write it: {json.dumps(written[-40:])}")
    shot(page, "04-written")

    context.close()


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

    print("\na note answers to the names it gave itself", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
