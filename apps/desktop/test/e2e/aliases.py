"""The other names a note gives itself, seen: `[[Roadmap]]` reaching the note
whose front matter declares it, the completion offering an alias under the
note's real name, and the Links panel counting an alias link as a backlink.

Serves the built web app and drives it in headless Chromium.

Run it from the repository root:

    python apps/desktop/test/e2e/aliases.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/aliases/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PLAN = "---\naliases:\n  - Roadmap\n  - The plan\n---\n\n# Plan\n\nWhat we are doing.\n"
OTHER = "# Other\n\nSee [[Roadmap]] and [[The plan]] and [[Nothing]].\n"

SEED = """
async ([plan, other]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(plan, root)
  await ws.noteFrom(other, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""


def open_note(page: Page, starts: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { activate: true })
        }""",
        starts,
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)


LINKS = """
() => [...document.querySelectorAll('.cm-content .nib-link')].map((one) => ({
  words: one.textContent,
  missing: one.classList.contains('nib-link-missing'),
}))
"""


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820}, color_scheme="light")
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED, [PLAN, OTHER])}")
    page.wait_for_timeout(400)

    open_note(page, "Other")
    shot(page, "01-links")

    drawn = page.evaluate(LINKS)
    say(f"[drawn] {json.dumps(drawn)}")
    by_words = {one["words"]: one["missing"] for one in drawn}

    if by_words.get("Roadmap") is not False:
        wrong("a link by an alias is drawn as a name nothing answers to")
    if by_words.get("The plan") is not False:
        wrong("a link by the second alias is drawn as unresolved")
    if by_words.get("Nothing") is not True:
        wrong("a name nothing answers to is no longer drawn as one")

    # The panel: an alias link is a backlink of the note that declared it.
    open_note(page, "Plan")
    page.evaluate("() => window.nibApp.workspace.showPanel('links')")
    page.wait_for_timeout(900)
    shot(page, "02-backlinks")
    panel = page.evaluate(
        "() => [...document.querySelectorAll('aside .hit .nib-row-label')].map((one) => one.textContent)"
    )
    say(f"[panel] {json.dumps(panel)}")
    if "Other" not in panel:
        wrong(f"the note linking by an alias is not among the backlinks: {panel}")

    # And the completion offers the alias, under the note's real name.
    open_note(page, "Other")
    page.evaluate(
        """() => {
          const doc = window.nib.state.doc
          window.nib.dispatch({
            changes: { from: doc.length, insert: '\\n\\n' },
            selection: { anchor: doc.length + 2 },
          })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(300)
    page.keyboard.type("[[Road", delay=25)
    page.wait_for_timeout(800)
    shot(page, "03-completion")

    rows = page.evaluate(
        """() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((one) => ({
          label: one.querySelector('.cm-completionLabel')?.textContent ?? one.textContent,
          detail: one.querySelector('.cm-completionDetail')?.textContent ?? null,
        }))"""
    )
    say(f"[completion] {json.dumps(rows)}")
    alias = next((one for one in rows if (one["label"] or "").startswith("Roadmap")), None)
    if not alias:
        wrong("the completion does not offer the alias")
    elif alias["detail"] != "Plan":
        wrong(f"the alias row does not say which note it is: {alias}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    written = page.evaluate("() => window.nib.state.doc.toString()")
    if "[[Roadmap]]" not in written:
        wrong(f"choosing the alias did not write it: {json.dumps(written[-40:])}")
    shot(page, "04-written")

    page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a note answers to the names it gave itself"))
