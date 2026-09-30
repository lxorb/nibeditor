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

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wait_for = DRIVE.say, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP


PATIENCE = 40

DESKTOP = {"width": 1180, "height": 760}
PHONE = {"width": 390, "height": 844}


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def check(fine: bool, what: str) -> None:
    say(("ok   " if fine else "FAIL ") + what)
    if not fine:
        failures.append(what)


def fresh(browser: Browser, label: str, viewport: dict[str, int]) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme="dark")
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    DRIVE.open(page)
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
    with DRIVE.session() as browser:
        shoot(browser, "desktop", DESKTOP)
        shoot(browser, "phone", PHONE)

    return DRIVE.verdict("a note held notes, and stopped holding them again")


if __name__ == "__main__":
    sys.exit(main())
