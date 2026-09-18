"""Fold more and Fold less, seen: the palette rows that run them, one level of the
note going at a time from the deepest thing open, the same number of presses back
the other way, and a press that has nothing left to fold answering with nothing.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/fold-levels.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/fold-levels/`.
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
SHOTS = HERE / "shots" / "fold-levels"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 19101
ORIGIN = f"http://127.0.0.1:{PORT}"

# Three levels of one chapter, and a second chapter to prove a level is every
# block of that level and not the one the caret is near.
NOTE = """# Chapter one

The first words of the chapter.

## Under one

Something nested here.

### Deeper still

The deepest words there are.

# Chapter two

- an item
  - a child of it
  - another child

The last words.
"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Chapter'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

STATE = """
() => ({
  marks: document.querySelectorAll('.nib-folded').length,
  folds: window.nibApp.workspace.active?.folds ?? [],
  shown: [...document.querySelectorAll('.cm-content .cm-line')]
    .map((line) => line.textContent.trim())
    .filter((text) => text.length),
})
"""

ROWS = """
() => [...document.querySelectorAll('.palette .nib-row')].map((one) =>
  one.textContent.replace(/\\s+/g, ' ').trim(),
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


def fresh(browser: Browser) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 900},
        color_scheme="light",
    )
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
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(800)
    return page


def heads(folds: list[list[int]]) -> list[int]:
    """The line each fold hangs from, which says which blocks a press folded."""
    return sorted(fold[0] for fold in folds)


def run_row(page: Page, label: str, at: str) -> None:
    """Runs a command by its name in the palette, which is where a command with no
    chord has to be reachable."""
    page.locator(".cm-content").click()
    page.keyboard.press("Control+p")
    page.wait_for_timeout(400)
    page.keyboard.type(f"> {label}", delay=15)
    page.wait_for_timeout(500)

    rows = page.evaluate(ROWS)
    say(f"[palette] {label}: {json.dumps(rows[:3])}")
    shot(page, f"{at}-palette-{label.lower().replace(' ', '-')}")
    if not rows or label.lower() not in rows[0].lower():
        wrong(f"the palette does not offer {label!r} first: {rows[:3]}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(900)


def drive(browser: Browser) -> None:
    page = fresh(browser)

    start = page.evaluate(STATE)
    say(f"[open] {len(start['shown'])} lines, {start['marks']} marks")
    shot(page, "01-open")
    if start["marks"]:
        wrong("something is folded in a note nobody has folded")

    # Every level of the note, from the deepest thing open. The walk is read out of
    # what is written down, which is the folds as lines.
    walk: list[list[list[int]]] = []
    for step in range(4):
        run_row(page, "Fold more", f"{2 + step * 2:02d}")
        now = page.evaluate(STATE)
        walk.append(now["folds"])
        say(f"[fold more {step + 1}] folds {json.dumps(now['folds'])}, {now['marks']} marks")
        say(f"[fold more {step + 1}] on screen: {json.dumps(now['shown'])}")
        shot(page, f"{3 + step * 2:02d}-fold-more-{step + 1}")

    # The deepest section first, then the level above it - which is the `##` and
    # the list item in the other chapter, because a level is every block of that
    # level - then the two chapters, and then nothing left to fold.
    if heads(walk[0]) != [9]:
        wrong(f"the first press did not fold the deepest level alone: {walk[0]}")
    if heads(walk[1]) != [5, 9, 15]:
        wrong(f"the second press did not fold the level above it: {walk[1]}")
    if heads(walk[2]) != [1, 5, 9, 13, 15]:
        wrong(f"the third press did not fold both chapters: {walk[2]}")
    if walk[3] != walk[2]:
        wrong(f"a fourth press folded something that was already out of sight: {walk[3]}")

    outline = page.evaluate(STATE)
    if any("Deeper" in one for one in outline["shown"]):
        wrong("a heading inside a folded chapter is still on the page")
    if outline["marks"] != 2:
        wrong(f"the outline is not one mark per chapter: {outline['marks']}")

    # And the same number of presses back the other way, shallowest first.
    back: list[list[list[int]]] = []
    for step in range(4):
        run_row(page, "Fold less", f"{10 + step * 2:02d}")
        now = page.evaluate(STATE)
        back.append(now["folds"])
        say(f"[fold less {step + 1}] folds {json.dumps(now['folds'])}, {now['marks']} marks")
        shot(page, f"{11 + step * 2:02d}-fold-less-{step + 1}")

    if len(back[0]) >= len(walk[2]):
        wrong(f"the first press opened nothing: {back[0]}")
    if back[2] != []:
        wrong(f"three presses back did not open all of it: {back[2]}")
    if back[3] != []:
        wrong(f"a press with nothing folded did something: {back[3]}")

    end = page.evaluate(STATE)
    say(f"[open again] {len(end['shown'])} lines, {end['marks']} marks")
    shot(page, "19-open-again")
    if end["marks"]:
        wrong("something is still folded after walking all the way back")
    if len(end["shown"]) != len(start["shown"]):
        wrong(f"the note came back with {len(end['shown'])} lines of {len(start['shown'])}")

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

    print("\na note folds one level at a time, and comes back the same way", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
