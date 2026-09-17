"""Icons on everything that can wear one, and the picker they are chosen in.

What the run is for: a note, a canvas and a folder each keep an icon in a
different place - front matter, the canvas's own `nib` key, the space's map - and
the only place that shows whether all three arrived is the tree. The picker is the
other half: three sets behind one search field, and the grid is virtualised, so a
screenshot is the only thing that says the cells are actually drawn.

No Worker and no account: the browser build seeds its own space. Builds the web
app, serves `dist` on a port of its own, shoots the tree and the picker on a
desktop and on a phone, and stops everything again.

Run it from the repository root:

    python apps/desktop/test/e2e/icons.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/icons/`.
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
SHOTS = Path(__file__).resolve().parent / "shots" / "icons"

# A port of this run's own. Never 1420, which is the dev server's, and not one the
# other drives use either.
PORT = 18981
ORIGIN = f"http://127.0.0.1:{PORT}"

# How long anything is waited for before the run gives up and says what it saw.
PATIENCE = 40

# A desktop, and a phone at the size the app calls one.
DESKTOP = {"width": 1180, "height": 760}
PHONE = {"width": 390, "height": 844}

failures: list[str] = []

# What a row wears may be an emoji, and this console is code page 1252. Said in
# UTF-8 rather than left to fail on the one line that carries a picture.
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
    # A production build hides the app's stores, and the rows here are written
    # through them; both of these are what keeps the built page carrying them.
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


def fresh(browser: Browser, label: str, viewport: dict[str, int]) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme="dark")
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    return page


# What makes the window a phone. A headless browser has no touch screen for the
# app to recognise, so the device is set the way touch-scale.py sets it, along with
# the attributes the tokens read for the touch scale.
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

# Four notes, a folder, and a canvas. The notes say what they wear the way a note
# always does: in their own front matter, which is also what a vault out of
# Obsidian's Iconize carries in.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('---\\nicon: rocket\\n---\\n\\n# Deep work\\n\\nthe first line\\n', root)
  await ws.noteFrom('---\\nicon: \\u{1F680}\\n---\\n\\n# Launch day\\n\\nsoon\\n', root)
  await ws.noteFrom(
    '---\\nicon: flame\\nicon-color: orange\\n---\\n\\n# Burning\\n\\nurgent\\n',
    root,
  )
  await ws.noteFrom('# Chapter one\\n\\nreading\\n', at('Reading'))

  // Named outright: with a name in hand the file is written at once, rather than a
  // row waiting to be typed into. See `createCanvas`.
  await ws.createCanvas(root, 'Roadmap.canvas')

  // A folder is not a file, so its icon comes out of the space's own map.
  ws.setFolderIcon(at('Reading'), 'flat-color-icons:folder')

  ws.toggleFolder(at('Reading'))
  await ws.loadTree()
  return ws.tree.children.map((one) => one.name)
}
"""

# What each row wears, so the shot is not the only record of it.
ROWS = """
() => [...document.querySelectorAll('aside .row')].map((row) => {
  const mark = row.querySelector('.mark')
  const glyph = mark?.querySelector('svg, .emoji')
  return [
    row.textContent.trim().slice(0, 24),
    glyph?.tagName === 'SPAN' ? `emoji ${glyph.textContent}` : (glyph?.getAttribute('viewBox') ?? 'no mark'),
    glyph?.getAttribute('style') ?? '',
  ].join(' | ')
})
"""

CANVAS_ICON = """
() => {
  const ws = window.nibApp.workspace
  const canvas = ws.files.find((one) => one.name === 'Roadmap.canvas')
  window.nibApp.iconChoice.file(canvas.path)
  return canvas.path
}
"""


def pick(page: Page, label: str, words: str) -> None:
    """Types into the picker's one search field and clicks the cell it finds.

    By the words the cell is called rather than by the name it writes: a cell says
    what it is for a reader who cannot see it, and an emoji's name is the picture."""
    page.locator(".sheet input.nib-field").fill(words)
    cell = page.locator(f'.sheet button[aria-label="{words}"]').first
    cell.wait_for(state="visible", timeout=PATIENCE * 1000)
    cell.click()
    say(f"[{label}] picked {words}")


def sets(page: Page, label: str, where: str) -> None:
    """The three tabs, each shot once its own cells are drawn. A set is a chunk of
    its own and arrives when its tab is opened, which is what the wait is for."""
    for tab in ("Line", "Emoji", "Colour"):
        page.locator(f'.nib-segmented button:has-text("{tab}")').click()
        page.locator(".sheet input.nib-field").fill("")
        wait_for(
            page,
            "() => document.querySelectorAll('.sheet .cell').length > 8",
            f"[{label}] the {tab} set to arrive",
        )
        page.wait_for_timeout(250)
        page.locator(".sheet").screenshot(path=str(SHOTS / f"picker-{tab.lower()}-{where}.png"))
        say(f"[{label}] wrote picker-{tab.lower()}-{where}.png")
        check(
            page.locator(".sheet .cell").count() > 8,
            f"[{label}] the {tab} set draws cells",
        )


def shoot(browser: Browser, where: str, viewport: dict[str, int]) -> None:
    label = where
    page = fresh(browser, label, viewport)
    try:
        say(f"[{label}] the space holds {page.evaluate(SEED)}")

        # A phone is a phone because the app says so, and on one the list is a
        # drawer over the note rather than a column beside it. Told rather than
        # inferred, the way touch-scale.py tells it: a headless window has no
        # touch screen to be recognised by.
        if where == "phone":
            page.evaluate(AS_PHONE)
            page.evaluate(
                "() => { const ws = window.nibApp.workspace;"
                " if (!ws.panel) ws.showPanel('tree') }"
            )
            page.wait_for_timeout(350)

        wait_for(
            page,
            "() => document.querySelectorAll('aside .row .mark svg, aside .row .mark .emoji')"
            ".length >= 5",
            f"[{label}] a mark on every row",
        )
        # Past the row transitions, the folder's slide, and the sets arriving.
        page.wait_for_timeout(700)

        for one in page.evaluate(ROWS):
            say(f"[{label}] {one}")

        page.locator("aside").screenshot(path=str(SHOTS / f"tree-{where}.png"))
        say(f"[{label}] wrote tree-{where}.png")

        check(
            page.locator("aside .row .mark .emoji").count() >= 1,
            f"[{label}] a note wearing an emoji draws the character",
        )
        check(
            page.locator("aside .row .mark .drawn").count() >= 1,
            f"[{label}] a folder wearing a coloured drawing draws it",
        )
        check(
            page.locator('aside .row .mark svg[style*="color"]').count() >= 1,
            f"[{label}] a note with a colour on its icon is drawn in it",
        )

        # The picker, on the canvas, which is the one row that had nothing yet.
        say(f"[{label}] choosing for {page.evaluate(CANVAS_ICON)}")
        page.locator(".sheet").wait_for(state="visible", timeout=PATIENCE * 1000)
        sets(page, label, where)

        page.locator('.nib-segmented button:has-text("Line")').click()
        pick(page, label, "rocket")

        worn = wait_for(
            page,
            "() => { const ws = window.nibApp.workspace;"
            " const c = ws.files.find((one) => one.name === 'Roadmap.canvas');"
            " return c ? window.nibApp.links.iconOf(c.path) : null }",
            f"[{label}] the canvas to wear what was picked",
        )
        check(worn == "rocket", f"[{label}] the canvas kept `{worn}` in its own file")

        page.wait_for_timeout(300)
        page.locator("aside").screenshot(path=str(SHOTS / f"tree-chosen-{where}.png"))
        say(f"[{label}] wrote tree-chosen-{where}.png")
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

    print("\nicons on a note, a canvas and a folder, and the picker in three sets", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
