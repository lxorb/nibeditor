"""The file tree with a mark on every kind of row, shot light and dark.

No Worker and no account: the browser build seeds its own space, and the rows are
written through `window.nibApp.workspace`. Builds the web app, serves `dist`
statically on a port of its own, shoots the sidebar twice, and stops everything
again. Nothing it makes outlives it but the screenshots, which go beside it
under `shots/`.

Run it from the repository root:

    python apps/desktop/test/e2e/tree_shots.py
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
SHOTS = Path(__file__).resolve().parent / "shots" / "tree-shots"

# A port of this run's own. Never 1420, which is the dev server's, and not the
# ones the sharing and collaboration runs use either.
PORT = 18877
ORIGIN = f"http://127.0.0.1:{PORT}"

# How long anything is waited for before the run gives up and says what it saw.
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
    say("building the web app")
    # `vite build` is a production build whatever mode it is given unless the
    # environment says otherwise, and a production build is the one with the
    # app's stores hidden. Both are set, so the built page keeps them, which is
    # what lets the rows be written from the page.
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
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def fresh(browser: Browser, label: str, scheme: str) -> Page:
    """A browser context that has never held anything, told what the machine
    around it prefers: the app follows that, so this is what picks the theme."""
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    return page


# A note, a second note, a folder with a note and a paper in it, and a canvas.
# A folder exists in the browser's store because something is in it, so the
# notes inside it are what makes it.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  // The drawer opens on nothing until somebody asks for a panel.
  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\nthe first line\\n', root)
  await ws.noteFrom('# Meeting notes\\n\\nwho said what\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nreading\\n', at('Reading'))

  const paper = await ws.noteFrom('# paper\\n', at('Reading'))
  await ws.rename(paper, 'Deep Learning.pdf')

  // Named outright: with a name in hand the file is written at once, rather than a
  // row waiting to be typed into. See `createCanvas`.
  await ws.createCanvas(root, 'Roadmap.canvas')

  ws.toggleFolder(at('Reading'))
  await ws.openEntry(at('Meeting notes.md'))
  return ws.tree.children.map((one) => one.name)
}
"""

# What each row wears, so the shot is not the only record of it.
ROWS = """
() => [...document.querySelectorAll('aside .row')].map((row) =>
  [row.className, row.querySelector('svg')?.getAttribute('viewBox') ?? 'no mark',
   row.textContent.trim()].join(' | '))
"""


# A picture and a file of no known kind, put on the tree by hand.
#
# Neither the app's own file listing nor the browser's stand-in for it lists
# anything but a note, a PDF and a canvas, so a row of either kind cannot be
# made by writing a file. The rows below are real rows drawn by the real
# component; only the entries behind them are put there rather than read.
UNLISTED = """
() => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  const entry = (name) => ({
    name, path: at(name), is_dir: false, modified: 0, created: 0, children: [],
  })

  ws.tree.children.push(entry('Whiteboard.png'), entry('numbers.csv'))
  return ws.tree.children.map((one) => one.name)
}
"""


def shoot(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme, scheme)
    try:
        say(f"[{scheme}] the space holds {page.evaluate(SEED)}")

        wait_for(
            page,
            "() => document.querySelectorAll('aside .row .mark').length >= 4",
            f"[{scheme}] a mark on every file row",
        )
        # Past the row transitions and the folder's slide.
        page.wait_for_timeout(400)

        for one in page.evaluate(ROWS):
            say(f"[{scheme}] {one}")

        page.locator("aside").screenshot(path=str(SHOTS / f"tree-{scheme}.png"))
        say(f"[{scheme}] wrote tree-{scheme}.png")

        # The two marks no file listing can produce, once each, beside the three
        # that can. Light only: it is the shapes that are in question here.
        if scheme == "light":
            say(f"[{scheme}] with the unlisted kinds: {page.evaluate(UNLISTED)}")
            page.wait_for_timeout(300)
            page.locator("aside").screenshot(path=str(SHOTS / "tree-every-mark.png"))
            say(f"[{scheme}] wrote tree-every-mark.png")
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
                shoot(browser, "light")
                shoot(browser, "dark")
            finally:
                browser.close()
    finally:
        say("stopping the server")
        # The whole tree, the way the other runs stop theirs: a wrapper left
        # behind would keep holding the port.
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

    print("\nthe tree was shot light and dark", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
