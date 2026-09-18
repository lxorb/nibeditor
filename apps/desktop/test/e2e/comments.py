"""Comments, seen: `%%like this%%` goes where an HTML comment goes, and comes
back the moment the caret is inside it, in the editor and in the reading view.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/comments.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/comments/`.
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
SHOTS = HERE / "shots" / "comments"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18954
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = (
    "# Comments\n\n"
    "A line with %%a note to myself%% inside it.\n\n"
    "%% a whole line of it %%\n\n"
    "A line with <!-- the other spelling --> inside it.\n\n"
    "```\n"
    "%% kept, because a fence is showing it %%\n"
    "```\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

WRITTEN = """
() => ({
  shown: [...document.querySelectorAll('.cm-content .cm-line')]
    .map((line) => line.textContent)
    .join('\\n'),
  doc: window.nib.state.doc.toString(),
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


def fresh(browser: Browser) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    page.wait_for_timeout(400)

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Comments'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)
    return page


def drive(browser: Browser) -> None:
    page = fresh(browser)

    written = page.evaluate(WRITTEN)
    say(f"[written] {json.dumps(written['shown'])}")
    shot(page, "01-written")

    if "a note to myself" in written["shown"]:
        wrong("a percent comment is on the page in the editor")
    if "the other spelling" in written["shown"]:
        wrong("an HTML comment is on the page in the editor")
    if "a whole line of it" in written["shown"]:
        wrong("a percent comment on its own line is on the page")
    if "kept, because a fence is showing it" not in written["shown"]:
        wrong("a comment inside a fence was hidden, and a fence is showing it")
    if "A line with  inside it." not in written["shown"]:
        wrong("the words around a comment did not stay")

    # And the note itself is untouched: what is written is what is in the file.
    if "%%a note to myself%%" not in written["doc"]:
        wrong("the comment was rewritten in the note")

    # The caret inside it brings it back.
    at = written["doc"].index("a note to myself") + 4
    page.evaluate(
        """(at) => {
          window.nib.dispatch({ selection: { anchor: at } })
          window.nib.focus()
        }""",
        at,
    )
    page.wait_for_timeout(500)
    revealed = page.evaluate(WRITTEN)
    shot(page, "02-caret-inside")
    if "a note to myself" not in revealed["shown"]:
        wrong("the comment did not come back with the caret inside it")

    # And the reading view, which is what anybody else would see.
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1400)
    shot(page, "03-reading")
    read = page.evaluate("() => document.querySelector('#write')?.textContent ?? ''")
    say(f"[reading] {json.dumps(read[:160])}")

    for hidden in ("a note to myself", "the other spelling", "a whole line of it"):
        if hidden in read:
            wrong(f"a comment reached the reading view: {hidden}")
    if "kept, because a fence is showing it" not in read:
        wrong("the fence stopped showing what it was showing")
    if "A line with  inside it." not in read:
        wrong("the words around a comment did not survive the reading view")

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

    print("\na note to yourself stays one, whichever way it is written", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
