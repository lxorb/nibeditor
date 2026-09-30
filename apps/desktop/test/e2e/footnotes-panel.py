"""The Footnotes panel, seen in the built app: one of the note's panels on the right.

What this drives:

  * The right side's strip holds the note's five panels, and Footnotes opens a panel
    of the note's footnotes: a row each, the label, what it says, and how many there
    are in the heading.
  * A row goes to the mark in the words. The sign at the end of it goes to the
    definition at the bottom, which is the one thing the section inside the Outline
    had no room to offer.
  * The Outline's own section is still there, unchanged.
  * The panel moves to the other side and can be held on one note, exactly as the
    Outline and the Links panel can - and on a real handheld neither can, because a
    handheld holds one document and there is nothing to hold a panel against.

Run it from the repository root:

    python apps/desktop/test/e2e/footnotes-panel.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/footnotes-panel/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, BrowserContext, Page

from settling import HIDE_CARET, quiet

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots


NOTE = (
    "# Where the words came from\n"
    "\n"
    "The first part[^one] of it.\n"
    "\n"
    "## Under one\n"
    "\n"
    "The second part[^two].\n"
    "\n"
    "[^one]: what the first one says\n"
    "\n"
    "[^two]: what the second one says\n"
    "\n"
    "[^three]: nothing points at this one\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Where the words'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

TABS = (
    "() => [...document.querySelectorAll('[role=\\'tablist\\'] [role=\\'tab\\']')]"
    ".map((one) => one.getAttribute('aria-label'))"
)

ROWS = """
() => [...document.querySelectorAll('.body .row.note')].map((row) => ({
  id: row.querySelector('.note-id')?.textContent ?? '',
  text: row.querySelector('.nib-row-label')?.textContent ?? '',
  quiet: row.classList.contains('is-quiet'),
  definition: !!row.parentElement?.querySelector('.to-definition'),
}))
"""

COUNT = "() => document.querySelector('.body .nib-section span')?.textContent ?? ''"
TOOLS = "() => document.querySelectorAll('.tools .tool').length"
# The hold button in particular: the Links panel has a second tool beside it, the one
# that turns its list into the picture, so counting tools says nothing about the hold.
HOLD = """
() => {
  const held = ['Stay on this note', 'Follow the open note']
  return [...document.querySelectorAll('.tools .tool')].filter((one) =>
    held.includes(one.getAttribute('aria-label') ?? ''),
  ).length
}
"""
LINE = """
() => {
  const view = window.nib
  return view.state.doc.lineAt(view.state.selection.main.head).text
}
"""


def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)


def opened(browser: Browser, finger: bool = False) -> tuple[BrowserContext, Page]:
    context = browser.new_context(
        viewport={"width": 420, "height": 880} if finger else {"width": 1240, "height": 860},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    quiet(page)
    return context, page


def show(page: Page, panel: str) -> None:
    """The app's own road, which is what a tab press takes."""
    wait_for(page, "window.nibApp", "the app")
    page.evaluate("(one) => window.nibApp.workspace.showPanel(one)", panel)
    quiet(page)


def the_strip(page: Page) -> None:
    show(page, "footnotes")
    tabs = page.evaluate(TABS)
    say(f"[strip] {json.dumps(tabs)}")
    # A note's own panels are homed on the right since 4a5f7ddc, beside Ask, and the
    # footnotes are one of them; the file list and the search stay on the left.
    is_true(
        tabs == ["Outline", "Links", "Properties", "Footnotes", "Ask"],
        f"the strip holds {tabs} rather than the note's five on the right",
    )


def the_rows(page: Page) -> None:
    rows = page.evaluate(ROWS)
    say(f"[rows] {json.dumps(rows, ensure_ascii=False)}")

    is_true(len(rows) == 3, f"the panel drew {len(rows)} rows rather than three")
    is_true([one["id"] for one in rows] == ["one", "two", "three"], "the rows are in the wrong order")
    is_true(
        rows[0]["text"] == "what the first one says",
        f"the first row says {rows[0]['text']!r}",
    )
    # The one nothing points at is last and drawn quiet, which is what the Outline's own
    # section does with it too.
    is_true(rows[2]["quiet"], "the footnote nothing points at is not drawn quiet")
    is_true(all(one["definition"] for one in rows), "a row has no way to the definition")
    is_true(page.evaluate(COUNT) == "3", f"the heading says {page.evaluate(COUNT)!r}")
    shot(page, "01-panel")


def the_two_places(page: Page) -> None:
    # The row goes to the mark, which is where somebody was reading.
    page.locator(".body .row.note").first.click()
    quiet(page)
    said = page.evaluate(LINE)
    say(f"[mark] the caret is on {said!r}")
    is_true("The first part" in said, "the row did not go to the mark in the words")

    # And the sign at the end of it goes to the definition at the bottom.
    page.locator(".body .footnote").first.locator(".to-definition").click()
    quiet(page)
    said = page.evaluate(LINE)
    say(f"[definition] the caret is on {said!r}")
    is_true("what the first one says" in said, "the sign did not go to the definition")
    shot(page, "02-definition")


def the_outline_keeps_its_section(page: Page) -> None:
    show(page, "outline")
    rows = page.evaluate(ROWS)
    say(f"[outline] it still holds {len(rows)} footnote rows")
    is_true(len(rows) == 3, "the Outline lost its own footnotes section")
    shot(page, "03-outline")


def the_panel_behaves_like_the_others(page: Page) -> None:
    show(page, "footnotes")
    is_true(page.evaluate(HOLD) == 1, "the Footnotes panel offers no hold button")

    page.locator(".tools .tool").first.click()
    quiet(page)
    is_true(
        page.evaluate("() => !!window.nibApp.workspace.heldTabId"),
        "pressing the hold button held nothing",
    )
    shot(page, "04-held")
    page.locator(".tools .tool").first.click()
    quiet(page)
    is_true(
        not page.evaluate("() => !!window.nibApp.workspace.heldTabId"),
        "pressing it again did not let go",
    )

    # And it moves to the other side, which every panel does.
    page.evaluate("() => window.nibApp.workspace.movePanel('footnotes', 'right')")
    quiet(page)
    is_true(
        page.evaluate("() => window.nibApp.workspace.sideOf('footnotes')") == "right",
        "the panel would not move to the other side",
    )
    is_true(
        page.evaluate("() => window.nibApp.workspace.openOn('right')") == "footnotes",
        "it did not stay open over there",
    )
    shot(page, "05-right")
    page.evaluate("() => window.nibApp.workspace.movePanel('footnotes', 'left')")
    quiet(page)


def a_handheld(browser: Browser, panel: str, at: int) -> None:
    """A handheld holds one document, so there is nothing to hold a panel against and
    the button is not offered at all - on any of the three panels that are about a note.
    The panel itself is there: a footnote is a footnote on a phone.

    A window of its own per panel, and not because the drive would rather have one: the
    drawer on a phone gives up on the third panel it is asked for, taking the sidebar and
    `window.nibApp` with it. Nothing to do with which panel - outline, links, outline is
    enough to see it - and nothing to do with this panel, which is why it is written down
    here rather than worked around in silence. The phone shell is somebody else's to fix;
    what this drive is about is the hold."""
    context, page = opened(browser, finger=True)
    show(page, panel)

    tabs = page.evaluate(TABS)
    rows = len(page.evaluate(ROWS))
    say(f"[phone] {panel}: {len(tabs)} tabs, {rows} rows, {page.evaluate(HOLD)} hold buttons")

    # The panel itself is there - the strip holds the same five tabs - which is what makes
    # the absence of the hold below a fact about the hold rather than about a sidebar
    # nobody drew. The existing check in panels.py counts `.tools .tool` on a phone and
    # would pass just as happily with no sidebar at all.
    is_true(len(tabs) == 5, f"a phone's strip holds {len(tabs)} tabs rather than five")
    is_true(page.evaluate(HOLD) == 0, f"the hold button is offered on a phone's {panel} panel")
    if panel == "footnotes":
        is_true(rows == 3, "a phone draws no footnote rows")

    shot(page, f"0{at}-phone-{panel}")
    context.close()


def drive(browser: Browser) -> None:
    context, page = opened(browser)

    the_strip(page)
    the_rows(page)
    the_two_places(page)
    the_outline_keeps_its_section(page)
    the_panel_behaves_like_the_others(page)

    context.close()

    for at, panel in enumerate(['outline', 'links', 'footnotes']):
        a_handheld(browser, panel, at + 6)


def main() -> int:
    return DRIVE.run(drive, "the footnotes of a note have a panel of their own")


if __name__ == "__main__":
    raise SystemExit(main())
