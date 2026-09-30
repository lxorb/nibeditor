"""The archive, seen: a note and a folder put away from their rows, gone from the
file list, listed at its foot and taken back out exactly where they were; one note
brought back out of an archived folder on its own; a link into an archived note
still drawn and marked; a folder holding something archived refused its deletion;
and the search's own switch for looking inside the archive.

Serves the built web app and drives it in Chromium, headless. The
build has to be one a drive may steer - `--mode drive` - or `window.nib` and
`window.nibApp` are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/archive.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/archive/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for


SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nThe plan.\\n', root)
  await ws.noteFrom('# Keep\\n\\nSee [[Plan]] and [[Taxes]].\\n', root)
  await ws.noteFrom('# Notes\\n\\nOld notes.\\n', root + '/Old')
  await ws.noteFrom('# Taxes\\n\\nThe receipts.\\n', root + '/Old/2019')
  await ws.noteFrom('# Trip\\n\\nThe mountains, and a lighthouse.\\n', root + '/Old/2019')
  await ws.loadTree()
  return ws.notes.map((one) => one.path.slice(root.length + 1))
}
"""

TREE = """
() => [...document.querySelectorAll('.row[data-path]')].map((row) =>
  row.getAttribute('data-path').replace(/^.*?\\/(?=[^/]*$)/, '')
)
"""

ARCHIVE = """
() => [...document.querySelectorAll('.archive-head + ul .line .row .nib-row-label')].map(
  (one) => one.textContent
)
"""


def fresh(browser: Browser) -> Page:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820}, color_scheme="light", reduced_motion="reduce"
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}") if message.type == "error" else None,
    )
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED)}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name === 'Keep.md')
          await ws.openEntry(note.path, {})
          if (ws.panel !== 'tree') ws.showPanel('tree')
          for (const path of ws.visibleRows()) if (!path.endsWith('.md')) ws.device.expand(path)
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(600)
    return page


def row_menu(page: Page, name: str, choose: str) -> None:
    """A row's own menu, by a right click, and one of its rows pressed."""
    page.locator(f'.row[data-path$="/{name}"]').first.click(button="right")
    wait_for(page, "document.querySelector('.rows .nib-row')", f"the menu of {name}")
    page.locator(".rows .nib-row", has_text=choose).first.click()
    page.wait_for_timeout(500)


def tree(page: Page) -> list[str]:
    return page.evaluate(TREE)


def drive(browser: Browser) -> None:
    page = fresh(browser)
    say(f"the list: {tree(page)}")
    shot(page, "01-the-list")

    # A note put away from its own row: gone from the list, the corner says so, and
    # the archive appears at the list's foot.
    row_menu(page, "Plan.md", "Archive")
    listed = tree(page)
    say(f"after archiving Plan: {listed}")
    if "Plan.md" in listed:
        wrong("the archived note is still in the file list")
    toast = page.evaluate("() => document.querySelector('.toast p')?.textContent ?? null")
    if toast != "Archived":
        wrong(f"the corner does not say Archived: {toast!r}")
    wait_for(page, "document.querySelector('.archive-head')", "the archive's head")
    shot(page, "02-archived")

    # The link into it still resolves, drawn marked rather than missing.
    marks = page.evaluate(
        """() => [...document.querySelectorAll('.cm-content .nib-link')].map((one) => ({
          text: one.textContent, archived: one.classList.contains('nib-link-archived'),
          missing: one.classList.contains('nib-link-missing'),
        }))"""
    )
    say(f"the links in Keep: {json.dumps(marks)}")
    plan = next((one for one in marks if one["text"] == "Plan"), None)
    if not plan or not plan["archived"] or plan["missing"]:
        wrong(f"the link into the archived note is not drawn marked: {plan}")

    # Undo from the corner puts it back where it was.
    page.locator(".toast .undo").click()
    page.wait_for_timeout(500)
    if tree(page) != listed and "Plan.md" not in tree(page):
        wrong(f"Undo did not bring the note back: {tree(page)}")
    say(f"after Undo: {tree(page)}")
    shot(page, "03-undone")

    # A folder put away takes everything under it.
    row_menu(page, "Plan.md", "Archive")
    row_menu(page, "Old", "Archive")
    listed = tree(page)
    say(f"after archiving Old: {listed}")
    if any(one in listed for one in ("Old", "Notes.md", "Taxes.md", "Trip.md")):
        wrong(f"the archived folder left rows behind: {listed}")

    # The archive, opened: newest first, each saying where it came from.
    page.locator(".archive-head").click()
    page.wait_for_timeout(400)
    rows = page.evaluate(ARCHIVE)
    say(f"the archive: {rows}")
    shot(page, "04-the-archive")
    if rows[:2] != ["Old", "Plan"]:
        wrong(f"the archive does not list the newest first: {rows}")

    # Into the folder, and one note brought back out of it on its own.
    page.locator(".archive-head + ul .line", has_text="Old").locator(".twist").click()
    page.wait_for_timeout(300)
    page.locator(".archive-head + ul .line", has_text="2019").locator(".twist").click()
    page.wait_for_timeout(300)
    page.locator(".archive-head + ul .line .row", has_text="Taxes").click()
    wait_for(page, "document.querySelector('.archived-strip .back')", "the strip over an archived note")
    shot(page, "05-opened-archived")
    page.locator(".archived-strip .back").click()
    page.wait_for_timeout(600)

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const path of ws.visibleRows()) if (!path.endsWith('.md')) ws.device.expand(path)
        }"""
    )
    page.wait_for_timeout(300)
    kept = page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          return { map: ws.archive.of(ws.activeSpace.root), open: ws.active?.path ?? null }
        }"""
    )
    say(f"the archive now: {json.dumps(kept)}")
    listed = tree(page)
    say(f"after taking Taxes back: {listed}")
    shot(page, "06-taxes-back")
    if "Taxes.md" not in listed or "2019" not in listed or "Old" not in listed:
        wrong(f"Taxes did not come back where it was: {listed}")
    if "Trip.md" in listed or "Notes.md" in listed:
        wrong(f"taking one note back brought its neighbours with it: {listed}")
    if page.evaluate("() => !!document.querySelector('.archived-strip')"):
        wrong("the strip stayed over a note that is no longer archived")

    # A folder holding something archived is never deleted.
    row_menu(page, "Old", "Delete")
    wait_for(page, "document.querySelector('[role=dialog], .nib-layer')", "the refusal")
    said = page.evaluate("() => document.querySelector('[role=dialog]')?.textContent ?? ''")
    say(f"the refusal: {said.strip()[:80]!r}")
    shot(page, "07-refused")
    if "Nothing archived is deleted" not in said:
        wrong("deleting a folder holding archived notes was not refused")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    if "Old" not in tree(page):
        wrong("the folder went anyway")

    # The search leaves the archive out until its switch is pressed.
    found = page.evaluate(
        """async () => {
          const { search, workspace } = window.nibApp
          workspace.showPanel('search')
          search.ask('lighthouse')
          await new Promise((done) => setTimeout(done, 900))
          const without = search.hits.length
          search.showArchived(true)
          await new Promise((done) => setTimeout(done, 900))
          const withIt = search.hits.length
          return { without, withIt }
        }"""
    )
    say(f"the search for a word only the archive holds: {json.dumps(found)}")
    shot(page, "08-search")
    if found["without"] != 0 or found["withIt"] < 1:
        wrong(f"the search's switch does not decide whether the archive answers: {found}")

    page.context.close()


def main() -> int:
    return DRIVE.run(drive, "what is archived leaves the lists, is never deleted, and comes back")


if __name__ == "__main__":
    raise SystemExit(main())
