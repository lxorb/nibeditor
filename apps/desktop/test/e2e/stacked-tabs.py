"""Stacked tabs, seen in the built app: a pane's notes as columns side by side.

What this drives:

  * Off by default. A pane opens as one document with a strip of names over it, which
    is what a window is.
  * Stacked, the pane lays its notes out as columns, each its own editor: several live
    CodeMirror views in one pane, each with its own caret and its own words on screen.
  * Every column keeps a spine of the note's name, and the spine stays put as the row
    scrolls sideways. The active column is the widest, and pressing a spine makes that
    column the active one.
  * It is the pane's own answer: stacking one side of a split leaves the other as it
    was, and it survives being written down and read back.
  * A phone is offered none of it, because a handheld holds one document.

Run it from the repository root:

    python apps/desktop/test/e2e/stacked-tabs.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/stacked-tabs/`.
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

from playwright.sync_api import Browser, BrowserContext, Page, sync_playwright

from settling import HIDE_CARET, quiet

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "stacked-tabs"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 23204
ORIGIN = f"http://127.0.0.1:{PORT}"

# Five, which is more than fits across the window this drive opens: a column is as wide
# as a column of words wants to be rather than a share of the pane, so enough of them and
# the row has to be scrolled through - which is the whole gesture.
NAMES = ["First", "Second", "Third", "Fourth", "Fifth"]
NOTES = [(f"{name}.md", f"# {name}\n\nThe words of the {name.lower()} note.\n") for name in NAMES]

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  for (const [, text] of notes) await ws.noteFrom(text, ws.activeSpace.root)
  await ws.loadTree()

  // The welcome note a first visit is given goes first, so what the pane holds is what
  // this drive put in it and the numbers below are its own.
  for (const tab of [...ws.tabs]) ws.close(tab.id)

  for (const [name] of notes) {
    const found = ws.notes.find((one) => one.name === name)
    await ws.openEntry(found.path, { activate: true })
  }

  return ws.tabs.map((one) => one.shown)
}
"""

# What the pane is showing: how many columns, which is active, what each spine says,
# and how many editors are alive in it.
STACK = """
() => {
  const stack = document.querySelector('.stack')
  const columns = [...document.querySelectorAll('.stack .column')]
  return {
    stacked: !!stack,
    columns: columns.length,
    editors: document.querySelectorAll('.stack .cm-content').length,
    spines: columns.map((one) => one.querySelector('.spine')?.textContent?.trim() ?? ''),
    active: columns.findIndex((one) => one.classList.contains('is-active')),
    widths: columns.map((one) => Math.round(one.getBoundingClientRect().width)),
    scrolls: stack ? stack.scrollWidth > stack.clientWidth + 1 : false,
    plain: document.querySelectorAll('.editor').length,
  }
}
"""

# Where a spine sits against the row it is in, before and after the row is scrolled: a
# sticky spine keeps its distance from the left edge of the scroller.
SPINE_AT = """
(index) => {
  const stack = document.querySelector('.stack')
  const spine = document.querySelectorAll('.stack .column')[index]?.querySelector('.spine')
  if (!stack || !spine) return null
  return Math.round(spine.getBoundingClientRect().left - stack.getBoundingClientRect().left)
}
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
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
    quiet(page)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def opened(browser: Browser, finger: bool = False) -> tuple[BrowserContext, Page]:
    context = browser.new_context(
        viewport={"width": 420, "height": 880} if finger else {"width": 1400, "height": 880},
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
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {json.dumps(page.evaluate(SEED, NOTES))}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    quiet(page)
    return context, page


def stack(page: Page) -> dict:
    return page.evaluate(STACK)


def off_by_default(page: Page) -> None:
    said = stack(page)
    say(f"[off] {json.dumps(said)}")

    is_true(not said["stacked"], "a pane opens stacked")
    is_true(said["plain"] == 1, f"a pane that is not stacked has {said['plain']} editors")
    is_true(
        not page.evaluate("() => window.nibApp.workspace.stacked()"),
        "the pane says it is stacked before anybody asked",
    )
    is_true(
        page.evaluate("() => window.nibApp.workspace.canStack()"),
        "a pane holding three notes says it cannot stack them",
    )
    shot(page, "01-off")


def the_columns(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.toggleStacked()")
    quiet(page)

    said = stack(page)
    say(f"[stacked] {json.dumps(said)}")

    is_true(said["stacked"], "turning it on drew no columns")
    is_true(
        said["columns"] == len(NAMES),
        f"the pane drew {said['columns']} columns rather than {len(NAMES)}",
    )
    # One editor per column, all of them alive at once: a column with a caret of its own
    # is what makes this stacked tabs rather than a picture of them.
    is_true(
        said["editors"] == len(NAMES),
        f"{said['editors']} editors are alive rather than {len(NAMES)}",
    )
    is_true(said["spines"] == NAMES, f"the spines say {said['spines']}")
    is_true(
        said["active"] == len(NAMES) - 1,
        f"column {said['active']} is the active one rather than the last",
    )
    # The active one is the widest, which is what says which one is being written in.
    widest = max(said["widths"])
    is_true(
        said["widths"][said["active"]] == widest,
        f"the active column is not the widest: {said['widths']}",
    )
    is_true(said["scrolls"], "the row of columns does not scroll sideways")
    shot(page, "02-stacked")


def the_spine(page: Page) -> None:
    before = page.evaluate(SPINE_AT, 0)
    page.evaluate("() => { document.querySelector('.stack').scrollLeft = 260 }")
    quiet(page)
    after = page.evaluate(SPINE_AT, 0)
    say(f"[spine] the first spine was {before} from the edge and is now {after}")

    # Sticky: it keeps its distance from the left edge of the scroller rather than being
    # carried off with the words beside it.
    is_true(after is not None and after >= 0, f"the spine went off the edge: {after}")
    page.evaluate("() => { document.querySelector('.stack').scrollLeft = 0 }")
    quiet(page)

    # And pressing one makes that column the active one, which is the press a tab is.
    page.locator(".stack .column .spine").first.click()
    quiet(page)
    said = stack(page)
    say(f"[spine] the active column is now {said['active']}")
    is_true(said["active"] == 0, "pressing the first spine did not make it the active column")
    is_true(
        page.evaluate("() => window.nibApp.workspace.active?.shown") == "First",
        "the pane is showing something other than the note whose spine was pressed",
    )
    shot(page, "03-first-active")


def a_pane_of_its_own(page: Page) -> None:
    page.evaluate("() => window.nibApp.workspace.split('row')")
    quiet(page)

    panes = page.evaluate("() => window.nibApp.workspace.panes.all.map((one) => one.id)")
    stacks = page.evaluate(
        "() => window.nibApp.workspace.panes.all.map((one) => one.stacked)",
    )
    say(f"[split] the panes are {json.dumps(panes)} and say {json.dumps(stacks)}")

    # The split carried the stacked pane's answer with it and left the new one as every
    # pane starts: stacking is a pane's own arrangement, not the window's.
    is_true(len(panes) == 2, f"the split made {len(panes)} panes")
    is_true(stacks.count(True) == 1, f"both panes say {json.dumps(stacks)}")
    shot(page, "04-split")

    # Written down and read back: the arrangement is what the window opens in.
    page.evaluate("() => window.nibApp.workspace.persist()")
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp", "the app again")
    wait_for(page, "window.nibApp.workspace.active", "a note again")
    quiet(page)

    kept = page.evaluate("() => window.nibApp.workspace.panes.all.map((one) => one.stacked)")
    say(f"[restored] the panes say {json.dumps(kept)}")
    is_true(kept.count(True) == 1, f"the arrangement came back as {json.dumps(kept)}")
    shot(page, "05-restored")


def a_handheld(browser: Browser) -> None:
    """A handheld holds one document, so there is nothing to put beside anything."""
    context, page = opened(browser, finger=True)

    is_true(
        not page.evaluate("() => window.nibApp.workspace.canStack()"),
        "a phone says its pane can stack its notes",
    )
    is_true(not stack(page)["stacked"], "a phone drew columns")
    shot(page, "06-phone")
    context.close()


def drive(browser: Browser) -> None:
    context, page = opened(browser)

    off_by_default(page)
    the_columns(page)
    the_spine(page)
    a_pane_of_its_own(page)

    context.close()
    a_handheld(browser)


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

    print("\na pane lays its notes out as columns when it is asked to", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
