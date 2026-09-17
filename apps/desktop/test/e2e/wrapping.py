"""A note hard wrapped in the file, exported: one paragraph, not the lines it was
typed on, and the break the writer asked for still a break.

Drives a real export out of the built app and reads the file that comes back.

Run it from the repository root:

    python apps/desktop/test/e2e/wrapping.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
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
SHOTS = HERE / "shots" / "wrapping"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18955
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = (
    "# Wrapping\n\n"
    "A paragraph that was hard wrapped in the file\n"
    "across three lines\n"
    "by whoever wrote it.\n\n"
    "A line that asks for a break  \nand the line under it.\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const wrapped = ws.notes.find((one) => one.name.startsWith('Wrapping'))
  await ws.openEntry(wrapped.path, { activate: true })
  return wrapped.name
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


def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    # A first visit in a browser is given a welcome note, and the app opens it
    # after the space is there rather than with it; see `restore` in
    # workspace.svelte.ts. Seeding before that has happened wins the tab for a
    # moment and then loses it again, and the export below would be an export of
    # the welcome note. So the app is let finish opening its own note first.
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    # And the note this is about is the one showing, which is the condition the
    # export needs rather than a length of time.
    wait_for(
        page,
        "window.nib && document.querySelector('.cm-content')"
        " && window.nibApp.workspace.active?.note?.name?.startsWith('Wrapping')",
        "the wrapped note to be the one open",
    )
    shot(page, "01-written")

    # The palette, which is how an export is reached without a menu bar.
    page.keyboard.press("Control+p")
    page.wait_for_timeout(400)
    page.keyboard.type("> Plain text")
    page.wait_for_timeout(700)
    shot(page, "02-palette")

    with page.expect_download(timeout=20000) as caught:
        page.keyboard.press("Enter")
    download = caught.value

    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / "exported.txt"
    download.save_as(str(where))
    text = where.read_text(encoding="utf8")
    say(f"[exported] {json.dumps(text)}")

    if "A paragraph that was hard wrapped in the file across three lines by whoever wrote it." not in text:
        wrong("the wrapped paragraph did not come out as one paragraph")
    if "A line that asks for a break\nand the line under it." not in text:
        wrong("the break the writer asked for was flowed away with the rest")

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

    print("\na wrapped paragraph exports as a paragraph", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
