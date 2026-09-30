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

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP


# How long anything is waited for before the run gives up and says what it saw.
PATIENCE = 40


def fresh(browser: Browser, label: str, scheme: str) -> Page:
    """A browser context that has never held anything, told what the machine
    around it prefers: the app follows that, so this is what picks the theme."""
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
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
    with DRIVE.session() as browser:
        shoot(browser, "light")
        shoot(browser, "dark")

    return DRIVE.verdict("the tree was shot light and dark")


if __name__ == "__main__":
    sys.exit(main())
