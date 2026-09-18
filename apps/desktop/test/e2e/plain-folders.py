"""A vault's own folders, seen: rows for notes nobody has written yet.

What the run is for. nib has no folders in it any more - a note that holds notes
is the whole of how a space is organised - but the folders on disk are still
there, and an Obsidian vault is full of them. So a folder with no note of its own
is drawn as the row it is: the folder's name, the plain page mark, quiet, with a
twist for what it holds. Opening it opens the empty page it would be and writes
nothing; the first words are what make the file.

The other convention is read on the way in: a folder holding an `index.md` is
drawn as that note, under the folder's own name, and the index is not listed a
second time inside itself.

A unit test can say the model is right. Only a screenshot can say the quiet row
reads as a name waiting for words rather than as a row that failed to load.

No Worker and no account: the browser build seeds its own space. Builds the web
app, serves `dist` on a port of its own, shoots the tree on a desktop and on a
phone, and stops everything again.

Run it from the repository root:

    python apps/desktop/test/e2e/plain-folders.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/plain-folders/`.
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
SHOTS = Path(__file__).resolve().parent / "shots" / "plain-folders"

# A port of this run's own. Never 1420, which is the dev server's, and not one the
# other drives use either.
PORT = 18984
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

# A vault as one arrives: `Projects/` holding notes and nothing of its own, and
# `Handbook/` whose own page is the other convention's `index.md`. Neither folder
# is made on purpose - they are here because notes were written into them, which
# is the only way a folder appears at all.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Quick start\\n\\nwhat this space is\\n', root)
  await ws.noteFrom('# Kitchen rebuild\\n\\nthe quote\\n', at('Projects'))
  await ws.noteFrom('# Loft\\n\\nthe other one\\n', at('Projects'))

  const page = await ws.noteFrom('# Handbook\\n\\nthe front page\\n', at('Handbook'))
  await ws.rename(page, 'index.md')
  await ws.noteFrom('# Chapter one\\n\\nthe first chapter\\n', at('Handbook'))

  ws.device.expand(at('Projects'))
  ws.device.expand(at('Handbook'))
  await ws.loadTree()

  return ws.notes.map((one) => one.path).sort()
}
"""

ROWS = """
() => [...document.querySelectorAll('aside .row')].map((row) =>
  [
    row.dataset.path ?? '',
    row.className.replace(/svelte-\\w+/, '').trim(),
    row.textContent.trim().slice(0, 30),
  ].join(' | '))
"""

# What the row's menu offers, in the words it offers them in.
MENU = """
() => [...document.querySelectorAll('[role="menuitem"]')].map((one) => one.textContent.trim())
"""


def row(page: Page, path_ends: str):
    return page.locator(f'aside .row[data-path$="{path_ends}"]').first


def relist(page: Page, where: str) -> None:
    """A phone's drawer goes as a note opens, which is right - the note is what was
    asked for. A shot of the list needs it back."""
    if where != "phone":
        return

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(350)


def unlist(page: Page, where: str) -> None:
    """And out of the way again, so a finger reaches the note under it."""
    if where != "phone":
        return

    page.evaluate("() => { window.nibApp.workspace.panel = null }")
    page.wait_for_timeout(350)


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

        page.wait_for_timeout(500)
        for one in page.evaluate(ROWS):
            say(f"[{label}] {one}")

        page.locator("aside").screenshot(path=str(SHOTS / f"vault-{where}.png"))
        say(f"[{label}] wrote vault-{where}.png")

        # ── The folder with no note of its own ─────────────────────────────
        quiet = row(page, "Projects")
        check(quiet.count() == 1, f"[{label}] the folder is one row, named after itself")
        check(
            "is-quiet" in (quiet.get_attribute("class") or ""),
            f"[{label}] drawn quietly, because nobody has written in it",
        )
        check(
            quiet.locator(".twist").count() == 1,
            f"[{label}] with a twist for what it holds",
        )
        check(
            page.locator("aside .row .mark svg").count() > 0,
            f"[{label}] and a mark of the same family as every other row",
        )

        # ── Its menu is a note's menu, and says nothing about folders ──────
        quiet.click(button="right")
        page.wait_for_selector('[role="menu"]:visible', timeout=5000)
        offered = page.evaluate(MENU)
        say(f"[{label}] its menu offers {offered}")
        check(
            not any("folder" in one.lower() for one in offered),
            f"[{label}] no entry anywhere says folder",
        )
        check(
            "New note inside" in offered,
            f"[{label}] and a note can be made inside it",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        # ── Opening it opens the empty page it would be, and writes nothing ─
        quiet.click()
        wait_for(
            page,
            "() => window.nibApp.workspace.active?.path?.endsWith('Projects/Projects.md')",
            f"[{label}] the folder note to open",
        )
        check(
            page.evaluate("() => window.nibApp.workspace.active.doc === ''"),
            f"[{label}] as an empty page",
        )
        check(
            page.evaluate(
                "() => !window.nibApp.workspace.notes.some((one) =>"
                " one.path.endsWith('Projects/Projects.md'))"
            ),
            f"[{label}] and nothing was written into the vault by looking",
        )
        relist(page, where)
        page.locator("aside").screenshot(path=str(SHOTS / f"opened-{where}.png"))
        say(f"[{label}] wrote opened-{where}.png")

        # ── Writing in it is what makes the file ───────────────────────────
        unlist(page, where)
        page.locator(".cm-content").first.click()
        page.keyboard.type("The two of them")
        wait_for(
            page,
            "() => window.nibApp.workspace.notes.some((one) =>"
            " one.path.endsWith('Projects/Projects.md'))",
            f"[{label}] the note to be written",
        )
        page.wait_for_timeout(500)
        relist(page, where)
        check(True, f"[{label}] writing in it wrote the note the row stands for")
        check(
            "is-quiet" not in (row(page, "Projects").get_attribute("class") or ""),
            f"[{label}] and the row is no longer quiet",
        )
        page.locator("aside").screenshot(path=str(SHOTS / f"written-{where}.png"))
        say(f"[{label}] wrote written-{where}.png")

        # ── The Move sheet offers rows and spaces, and no folders ──────────
        # A note from inside one of them, so the space itself is a place to move to:
        # a note already at the top of the space is not offered the space it is in.
        row(page, "Loft.md").click(button="right")
        page.wait_for_selector('[role="menu"]:visible', timeout=5000)
        page.get_by_role("menuitem", name="Move", exact=True).click()
        # The sheet, by what it is. It was told apart from the menu by having no role
        # at all until the sheets were given one; now it says it is a dialog, that it
        # is modal, and what it is called. See PromptSheet.svelte.
        page.locator('div.sheet[role="dialog"]').wait_for(state="visible", timeout=5000)
        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / f"move-{where}.png"))
        say(f"[{label}] wrote move-{where}.png")

        offered = [one.strip() for one in page.locator(".found-row").all_inner_texts()]
        say(f"[{label}] the sheet offers {offered}")
        # The space's row reads as its letter and then its name, because the mark a
        # space wears is the switcher's own; `Projects` is not offered, since that
        # is where the note already sits.
        check(
            "Handbook" in offered and any(one.endswith("Notes") for one in offered),
            f"[{label}] a row that holds notes is a place, and so is the space",
        )
        check(
            page.locator(".found-row .space").count() == 1,
            f"[{label}] and the space wears its own mark rather than a folder's",
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)

        # ── The other convention, read and not rewritten ───────────────────
        book = row(page, "Handbook")
        check(
            book.inner_text().strip().startswith("Handbook"),
            f"[{label}] a folder whose page is an index is named after the folder",
        )
        check(
            page.locator('aside .row[data-path$="index.md"]').count() == 0,
            f"[{label}] and the index is not a row of its own inside itself",
        )
        check(
            "is-quiet" not in (book.get_attribute("class") or ""),
            f"[{label}] nor quiet, because it has a page after all",
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

    print("\na vault's folders read as notes nobody has written yet", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
