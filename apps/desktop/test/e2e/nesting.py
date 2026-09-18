"""A note that holds notes, seen: nesting one, the row it becomes, and the way back.

What the run is for. Dropping a note onto a note is one gesture with three
outcomes on disk - a folder is made, the note moves inside it under its own name,
and the note that was dropped lands beside it - and the tree then draws all three
as one row. A unit test can say the model is right; only a screenshot can say the
row reads as the note it is rather than as a folder that happens to hold one.

The way back is the other half: drag the last child out and the row is a plain
note again, with no empty folder left behind.

No Worker and no account: the browser build seeds its own space. Builds the web
app, serves `dist` on a port of its own, shoots the tree on a desktop and on a
phone, and stops everything again.

Run it from the repository root:

    python apps/desktop/test/e2e/nesting.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/nesting/`.
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
SHOTS = Path(__file__).resolve().parent / "shots" / "nesting"

# A port of this run's own. Never 1420, which is the dev server's, and not one the
# other drives use either.
PORT = 18982
ORIGIN = f"http://127.0.0.1:{PORT}"

PATIENCE = 40

DESKTOP = {"width": 1180, "height": 760}
PHONE = {"width": 390, "height": 844}

failures: list[str] = []

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(fine: bool, what: str) -> None:
    say(("ok   " if fine else "FAIL ") + what)
    if not fine:
        failures.append(what)


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
    if os.environ.get("NIB_SKIP_BUILD"):
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


def fresh(browser: Browser, label: str, viewport: dict[str, int]) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme="dark")
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    return page


AS_PHONE = """
() => {
  const app = window.nibApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  app.viewport.narrow = true

  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""

# A note to nest into, one to nest, and a third to put in after it. The parent
# wears an icon of its own, because the row a nested note becomes has to keep it:
# it is drawn from the note's path, not from the folder's.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('---\\nicon: rocket\\n---\\n\\n# Launch\\n\\nthe plan\\n', root)
  await ws.noteFrom('# Timeline\\n\\nwhen\\n', root)
  await ws.noteFrom('# Budget\\n\\nhow much\\n', root)
  await ws.loadTree()

  return ws.tree.children.map((one) => one.name)
}
"""

# The drop, as the tree makes it: what a note dropped on a note does. `moveMany`
# is the one call the drop handler makes, so this is that gesture and not a
# second way of doing it.
NEST = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  await ws.moveMany([at('Timeline.md')], at('Launch'))
  await ws.moveMany([at('Budget.md')], at('Launch'))
  ws.device.expand(at('Launch'))
  await ws.loadTree()

  return ws.notes.map((one) => one.path).sort()
}
"""

# And out again: the last child dragged back to the root leaves a note behind,
# not a folder holding one.
UNNEST = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  await ws.moveMany([at('Launch/Timeline.md')], root)
  await ws.moveMany([at('Launch/Budget.md')], root)
  await ws.loadTree()

  return ws.notes.map((one) => one.path).sort()
}
"""

ROWS = """
() => [...document.querySelectorAll('aside .row')].map((row) =>
  [row.className.replace(/svelte-\\w+/, '').trim(), row.textContent.trim().slice(0, 30)].join(' | '))
"""


def shoot(browser: Browser, where: str, viewport: dict[str, int]) -> None:
    label = where
    page = fresh(browser, label, viewport)
    try:
        say(f"[{label}] the space holds {page.evaluate(SEED)}")
        if where == "phone":
            page.evaluate(AS_PHONE)
            page.evaluate(
                "() => { const ws = window.nibApp.workspace;"
                " if (!ws.panel) ws.showPanel('tree') }"
            )
            page.wait_for_timeout(350)

        page.wait_for_timeout(400)
        page.locator("aside").screenshot(path=str(SHOTS / f"before-{where}.png"))
        say(f"[{label}] wrote before-{where}.png")

        say(f"[{label}] nested: {page.evaluate(NEST)}")
        page.wait_for_timeout(600)

        for one in page.evaluate(ROWS):
            say(f"[{label}] {one}")

        page.locator("aside").screenshot(path=str(SHOTS / f"nested-{where}.png"))
        say(f"[{label}] wrote nested-{where}.png")

        # The note is inside its own folder under its own name, which is what
        # Obsidian's folder-note plugins look for.
        check(
            page.evaluate(
                "() => window.nibApp.workspace.notes.some((one) =>"
                " one.path.endsWith('Launch/Launch.md'))"
            ),
            f"[{label}] the note moved into the folder under its own name",
        )
        check(
            page.locator("aside .row[aria-expanded]").count() == 1,
            f"[{label}] one row holds rows, and it is drawn as the note",
        )
        check(
            page.locator('aside .row[aria-expanded] .mark svg[viewBox="0 0 24 24"]').count() == 1,
            f"[{label}] wearing the note's own icon",
        )
        # Not quiet: the note is written, so the row is a note to read rather than
        # a name nobody has put words under. See docs/tree.md.
        check(
            page.locator("aside .row[aria-expanded].is-quiet").count() == 0,
            f"[{label}] at full strength, because the note has words in it",
        )
        # Once as the row, never again as a child of itself.
        check(
            page.evaluate(
                "() => [...document.querySelectorAll('aside .row')]"
                ".filter((row) => row.textContent.trim().startsWith('Launch')).length"
            )
            == 1,
            f"[{label}] and the note is not listed a second time inside itself",
        )

        say(f"[{label}] unnested: {page.evaluate(UNNEST)}")
        page.wait_for_timeout(600)
        page.locator("aside").screenshot(path=str(SHOTS / f"unnested-{where}.png"))
        say(f"[{label}] wrote unnested-{where}.png")

        check(
            page.evaluate(
                "() => window.nibApp.workspace.notes.some((one) =>"
                " one.path.endsWith('/Launch.md'))"
            ),
            f"[{label}] the note came back up as a plain note",
        )
        check(
            page.locator("aside .row[aria-expanded]").count() == 0,
            f"[{label}] and no empty folder was left behind",
        )
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
                shoot(browser, "desktop", DESKTOP)
                shoot(browser, "phone", PHONE)
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

    if failures:
        print("\n%d of it did not hold:" % len(failures), flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\na note held notes, and stopped holding them again", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
