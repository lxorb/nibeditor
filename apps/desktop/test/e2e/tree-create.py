"""Making things from the tree: from the empty stretch, and from inside a row.

Every gesture ends the same way: a row goes into the tree already in its name
field, a name is typed, Enter commits, and the file is there. This drives all four
- a note and a canvas from the empty stretch under the last row, a note inside a
folder nobody has written a note in, and a note inside a note, which nests the
note it was asked on - and checks the file list afterwards.

No New folder anywhere, because nothing in the interface is a folder: a note
inside a note is how a space is organised. See docs/tree.md.

What it is guarding is the keyboard. The menu that was pressed hands focus back
to whatever had it when the menu opened, and the field the menu entry opened is
what has it now; a hand-back that ignored that blurred the field, and a blurred
empty field is a row for something that was never made. See trap.ts.

Builds the web app, serves `dist` statically on a port of its own, drives, and
stops everything again. A shot of the row mid-name goes beside it under `shots/`.

Run it from the repository root:

    python apps/desktop/test/e2e/tree-create.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "tree-create"

# A port of this run's own, above the dev server's 1420 and clear of the ports
# the other runs use.
PORT = 18893
ORIGIN = f"http://127.0.0.1:{PORT}"

PATIENCE = 40


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") == "1":
        say("reusing the build that is there")
        return

    say("building the web app")
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


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def fresh(browser: Browser, scheme: str = "light") -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", "the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", "a space")
    return page


# One note at the top of the space and a folder with a note in it, so there is a
# folder row to ask and an empty stretch under the last row to ask on.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\nthe first line\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nreading\\n', at('Reading'))
  return ws.tree.children.map((one) => one.name)
}
"""

NAMES = """
() => {
  const walk = (entry) => entry.children.flatMap((one) =>
    one.is_dir ? [one.name + '/', ...walk(one)] : [one.name])
  return walk(window.nibApp.workspace.tree)
}
"""


def entry(page: Page, label: str) -> None:
    """Presses one entry of the menu that is open, by the words on it."""
    row = page.locator(".menu .nib-row", has_text=label).first
    row.wait_for(state="visible", timeout=PATIENCE * 1000)
    row.click()


def named(page: Page, what: str, name: str, shot: str | None = None) -> None:
    """Types a name into the row that is waiting for one, and commits it.

    The field is the whole check: a row that never arrived, or one that arrived
    and lost the keyboard again, has no field to type in."""
    field = page.locator("aside .row .naming input")
    field.wait_for(state="visible", timeout=PATIENCE * 1000)

    # Past the menu's own fade, which is when the keyboard used to be taken back.
    page.wait_for_timeout(400)
    still = page.evaluate("() => document.activeElement?.closest('.naming') !== null")
    if not still:
        raise SystemExit(f"{what}: the name field lost the keyboard before a name was typed")

    if shot:
        page.locator("aside").screenshot(path=str(SHOTS / shot))
        say(f"wrote {shot}")

    field.fill(name)
    field.press("Enter")
    say(f"{what}: typed {name}")


def rest(page: Page) -> None:
    """The empty stretch under the last row, which is the space itself."""
    page.locator("aside .rest").click(button="right", position={"x": 20, "y": 8})


def quiet_row(page: Page) -> None:
    """The row of a folder nobody has written a note in - `Reading` here, which the
    seed made by writing a note inside it. Quiet is how the list says so."""
    page.locator("aside .row.is-quiet").first.click(button="right")


def note_row(page: Page, name: str) -> None:
    """A row that is a note holding nothing yet, which is the other row that can
    take a note inside it: the note becomes a folder note as the new one arrives.

    Named, because every row in the list is a note now and the first of them is
    whichever the sort put at the top."""
    page.locator(f"aside .row[data-path$='{name}']").first.click(button="right")


def drive(browser: Browser) -> None:
    page = fresh(browser)
    try:
        say(f"the space holds {page.evaluate(SEED)}")
        wait_for(page, "() => !!document.querySelector('aside .rest')", "the file list")

        rest(page)
        entry(page, "New note")
        named(page, "a note from the background menu", "From the ground", "tree-naming.png")

        rest(page)
        entry(page, "New canvas")
        named(page, "a canvas from the background menu", "Ground plane")

        quiet_row(page)
        entry(page, "New note inside")
        named(page, "a note inside a folder nobody wrote", "Inside the folder")

        note_row(page, "Deep work.md")
        entry(page, "New note inside")
        named(page, "a note inside a note", "Inside the note")

        # The listing, once every write has been through the store.
        wait_for(
            page,
            "() => window.nibApp.workspace.tree.children.length >= 4",
            "the four new rows",
        )
        page.wait_for_timeout(400)
        names = page.evaluate(NAMES)
        say(f"the space now holds {names}")

        want = [
            "From the ground.md",
            "Ground plane.canvas",
            "Inside the folder.md",
            "Inside the note.md",
        ]
        missing = [one for one in want if one not in names]
        if missing:
            raise SystemExit(f"nothing was made for {missing}; the list holds {names}")

        # Each inside the row the menu was asked on: the folder that already was
        # one, and the note that became one by being asked.
        held = page.evaluate(
            """() => {
              const walk = (entry) => entry.children.flatMap((one) =>
                one.is_dir ? [[one.name, one.children.map((child) => child.name)], ...walk(one)] : [])
              return Object.fromEntries(walk(window.nibApp.workspace.tree))
            }"""
        )
        say(f"the rows that hold rows hold {held}")

        if "Inside the folder.md" not in held.get("Reading", []):
            raise SystemExit(f"the note was not made inside Reading; it holds {held}")

        # The note the menu was asked on is `Deep work.md`, which is now the folder
        # `Deep work/` holding its own note and the new one. That is the
        # folder-note layout, made by asking for a note inside a note.
        under = held.get("Deep work", [])
        for one in ("Deep work.md", "Inside the note.md"):
            if one not in under:
                raise SystemExit(f"{one} is not in the note that took one inside: {under}")
    finally:
        page.context.close()


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    build()

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                drive(browser)
            finally:
                browser.close()
    finally:
        say("stopping the server")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        else:
            server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    print("\nfour things made: two on the ground, and two inside rows", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
