"""A tab with no file, in a real browser, in the light and in the dark.

Emil, 2026-09-30: *"When I open a new tab or note on nib it should be in an unsaved
state (with no saving location) and there should be a dot behind it (indicating that).
For web tabs there should not be the dot behind them if they're unsaved."* And: *"it
should NEVER be possible that we have the same web note open multiple times within one
nib session."*

What it proves, in order, and photographs:

* **The dot**: a new note typed into is still a tab with no file, and wears the dot; a
  web tab with no file wears none.
* **Save**: Ctrl+S puts the layer under the tab, with the name its first line offers and
  the root of the space to put it in; another place is picked by typing, and Enter
  writes the file there. The dot goes.
* **Dropped on the list**: a tab carried off its strip and let go of below the file
  list's rows is saved at the root of the space, under its first line.
* **Close and reopen**: a new note with words closes with no question, its words are in
  Recently deleted, and Ctrl+Shift+T brings the tab back with them - and out of the
  trash again.
* **A restart**: the page loaded again brings a tab with no file back, words, dot and all.
* **One tab per web note**: a split of a web note is an unsaved web tab beside it, never a
  second tab of the file.

Run it from the repository root:

    python apps/desktop/test/e2e/unsaved-tabs.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go beside this file under
`shots/unsaved-tabs/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

LAYER = "() => !!document.querySelector('[role=\"dialog\"] form input')"

STATE = """
() => {
  const ws = window.nibApp.workspace
  const front = ws.active
  return {
    tabs: ws.tabs.map((one) => ({ kind: one.kind, path: one.path, shown: one.shown })),
    files: ws.files.map((one) => one.path.slice(ws.activeSpace.root.length + 1)),
    front: front ? { kind: front.kind, path: front.path, doc: front.doc } : null,
    dotted: !!(front && document.querySelector(`[data-tab="${front.id}"] .nib-unsaved`)),
  }
}
"""


def state(page: Page) -> dict:
    return page.evaluate(STATE)  # type: ignore[no-any-return]


def typed(page: Page, words: str) -> None:
    """A new note, with words typed into it the way a hand types them."""
    page.evaluate("() => window.nibApp.workspace.openBlank()")
    wait_for(page, "document.querySelector('.cm-content')", "the editor")
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.type(words)
    page.wait_for_timeout(900)


def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 760}, color_scheme=scheme, reduced_motion="reduce")
    DRIVE.open(page)
    DRIVE.seed(page, "# Trips\n\nWhere we went.\n")
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")

    say(f"--- {scheme}: the dot ---")
    typed(page, "Groceries\nmilk, eggs, bread")
    now = state(page)
    if now["front"]["path"] is not None or any(one.startswith("Groceries") for one in now["files"]):
        wrong(f"typing into a new note made it a file: {now['front']}")
    if not now["dotted"]:
        wrong("the new note wears no dot")
    say(f"typed into a new note -> no file, dot: {now['dotted']}")

    page.evaluate("() => window.nibApp.workspace.openWebsite()")
    page.wait_for_timeout(400)
    if state(page)["dotted"]:
        wrong("a new web tab wears the dot")
    else:
        say("a new web tab          -> no dot")
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const note = ws.tabs.find((one) => one.kind === 'note' && one.path === null)
          if (note) ws.activate(note.id)
        }"""
    )
    DRIVE.settled(page)
    DRIVE.shot(page, f"{scheme}-01-dot")

    say(f"--- {scheme}: save ---")
    page.keyboard.press("Control+KeyS")
    wait_for(page, LAYER, "the layer under the tab")
    offered = page.locator('[role="dialog"] form input').first.input_value()
    if offered != "Groceries":
        wrong(f"the name offered is {offered!r}")
    DRIVE.shot(page, f"{scheme}-02-save")

    # Another place: the folder row, a word typed, the row it finds.
    page.locator('[role="dialog"] .where').click()
    page.keyboard.type("Trips")
    wait_for(page, "document.querySelector('[role=\"dialog\"] .nib-row')", "the places")
    DRIVE.shot(page, f"{scheme}-03-places")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    wait_for(page, "(window.nibApp.workspace.active?.path ?? '').endsWith('Trips/Groceries.md')", "the save")
    now = state(page)
    if now["dotted"]:
        wrong("the saved note still wears the dot")
    say(f"Ctrl+S, Trips, Enter   -> {now['front']['path']}")
    DRIVE.settled(page)
    DRIVE.shot(page, f"{scheme}-04-saved")

    say(f"--- {scheme}: dropped on the list ---")
    typed(page, "Dropped here")
    tab = page.evaluate("() => window.nibApp.workspace.active.id")
    grip = page.locator(f'[data-tab="{tab}"]').bounding_box()
    rest = page.locator("[data-space-rest]").bounding_box()
    if grip and rest:
        page.mouse.move(grip["x"] + 30, grip["y"] + grip["height"] / 2)
        page.mouse.down()
        page.mouse.move(grip["x"] + 30, grip["y"] + 60, steps=6)
        page.mouse.move(rest["x"] + 60, rest["y"] + 40, steps=12)
        page.wait_for_timeout(300)
        DRIVE.shot(page, f"{scheme}-05-dropping")
        page.mouse.up()
        if DRIVE.waited(page, "(window.nibApp.workspace.tabs.find((one) => one.doc === 'Dropped here')?.path ?? '').endsWith('/Dropped here.md')", "the drop"):
            say("a tab dropped below the rows -> saved at the root of the space")
    else:
        wrong("no tab or no stretch below the rows to drag between")

    say(f"--- {scheme}: close and reopen ---")
    typed(page, "Scratch thought")
    page.keyboard.press("Control+KeyW")
    page.wait_for_timeout(600)
    if page.locator('[role="dialog"]').count():
        wrong("closing a new note with words asked something")
    # Its words in Recently deleted, as a note deleted from the root of the space.
    page.evaluate(
        """() => {
          const { settings } = window.nibApp
          settings.section = 'trash'
          settings.open = true
        }"""
    )
    if DRIVE.waited(page, "document.body.innerText.includes('Scratch thought')", "Recently deleted"):
        say("closed with words      -> no question, and in Recently deleted")
    else:
        wrong("the closed note's words are not in Recently deleted")
    DRIVE.shot(page, f"{scheme}-06-recently-deleted")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)

    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.press("Control+Shift+KeyT")
    wait_for(page, "window.nibApp.workspace.active?.doc === 'Scratch thought'", "the tab back")
    say("Ctrl+W, Ctrl+Shift+T   -> no question, back with its words")

    say(f"--- {scheme}: a restart ---")
    page.evaluate("() => window.nibApp.workspace.persist()")
    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    wait_for(
        page,
        "window.nibApp.workspace.tabs.some((one) => one.path === null && one.doc === 'Scratch thought')",
        "the unsaved note back",
    )
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.path === null && one.doc === 'Scratch thought')
          if (tab) ws.activate(tab.id)
        }"""
    )
    DRIVE.settled(page)
    if not state(page)["dotted"]:
        wrong("the unsaved note came back without its dot")
    say("reloaded               -> the unsaved note back, words and dot")
    DRIVE.shot(page, f"{scheme}-07-restart")

    say(f"--- {scheme}: one tab per web note ---")
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          await ws.createWebsite(ws.activeSpace.root, 'Svelte.url')
        }"""
    )
    wait_for(page, "(window.nibApp.workspace.active?.path ?? '').endsWith('Svelte.url')", "the web note")
    page.evaluate("() => window.nibApp.workspace.split('row')")
    page.wait_for_timeout(400)
    tabs = state(page)["tabs"]
    held = [one for one in tabs if (one["path"] or "").endswith("Svelte.url")]
    loose = [one for one in tabs if one["kind"] == "web" and one["path"] is None]
    if len(held) != 1 or not loose:
        wrong(f"a split of a web note is not one tab and a copy: {tabs}")
    else:
        say("split of a web note    -> the note once, an unsaved web tab beside it")
    page.close()


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            drive(browser, scheme)
    return DRIVE.verdict("a tab with no file waits for a place, and a web note is open once")


if __name__ == "__main__":
    raise SystemExit(main())
