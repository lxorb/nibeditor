"""The small things a writer notices in the first hour, seen in the built app.

  * `#tags` drawn as tags: a pill in the live preview and in the reading view, in
    both schemes and the contrast theme; never in code or in a link's words; the
    source again while the caret is in one; a modifier-click in the editor and a
    click in the reading view ask the space's search about it.
  * The pointer hides while somebody types in a note and comes back on the first
    move. Web pages are other processes and cannot be reached from here, which is the
    point: what this proves is that the app's own page hides it and shows it again.
  * A quoted comma in a flow list stays one chip through an edit in the rows.
  * The format bar goes when the tab it was over turns into the reading view.

Run it from the repository root:

    python apps/desktop/test/e2e/writing-feel.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/writing-feel/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from settling import HIDE_CARET, quiet

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for



def shot(page: Page, name: str) -> None:
    """A picture once the page has stopped moving; see settling.py."""
    quiet(page)
    DRIVE.shot(page, name)


NOTE = (
    "---\n"
    'tags: ["a, b", c]\n'
    "---\n"
    "\n"
    "# Tags\n"
    "\n"
    "Filed under #work/nib and #reading, with `#code` and [a #link](https://nib.dev)"
    " left alone.\n"
    "\n"
    "- #item in a list\n"
    "\n"
    "The last line, where the caret waits.\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Tags'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

SAID = "() => window.nibApp.workspace.active?.doc ?? ''"

# Every tag drawn in a surface: its words, its classes, and whether it wears a wash.
PILLS = """
(scope) => [...document.querySelectorAll(`${scope} .tag`)].map((one) => {
  const look = getComputedStyle(one)
  return {
    text: one.textContent,
    tag: one.dataset.tag,
    open: one.classList.contains('is-open'),
    element: one.tagName.toLowerCase(),
    washed: look.backgroundColor !== 'rgba(0, 0, 0, 0)' && look.backgroundColor !== 'transparent',
    round: parseFloat(look.borderTopLeftRadius) > 4,
  }
})
"""


def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)


def reading(page: Page, on: bool) -> None:
    if bool(page.evaluate("() => !!document.querySelector('article#write')")) == on:
        return
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    if on:
        wait_for(page, "document.querySelector('article#write .tag')", "the reading view")
    else:
        wait_for(page, "document.querySelector('.cm-content .tag')", "the editor")
    quiet(page)


def pills_in_the_editor(page: Page, label: str) -> None:
    pills = page.evaluate(PILLS, ".cm-content")
    say(f"[editor {label}] {json.dumps(pills, ensure_ascii=False)}")

    is_true(
        [one["tag"] for one in pills] == ["work/nib", "reading", "item"],
        f"[{label}] the editor drew {[one['tag'] for one in pills]} as tags",
    )
    for one in pills:
        is_true(one["washed"] and one["round"], f"[{label}] {one['text']} is not a pill")


def pills_in_the_reading_view(page: Page, label: str) -> None:
    pills = page.evaluate(PILLS, "article#write")
    say(f"[reading {label}] {json.dumps(pills, ensure_ascii=False)}")

    is_true(
        [one["tag"] for one in pills] == ["work/nib", "reading", "item"],
        f"[{label}] the reading view drew {[one['tag'] for one in pills]} as tags",
    )
    for one in pills:
        is_true(one["element"] == "a", f"[{label}] {one['text']} is not a link to press")
        is_true(one["washed"] and one["round"], f"[{label}] {one['text']} is not a pill")


def the_caret_in_a_tag(page: Page) -> None:
    tag = page.locator(".cm-content .tag[data-tag='reading']")
    box = tag.bounding_box()
    assert box is not None
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    quiet(page)

    pills = {one["tag"]: one for one in page.evaluate(PILLS, ".cm-content")}
    is_true(pills["reading"]["open"], "the tag the caret is in is not open")
    is_true(not pills["reading"]["washed"], "the tag the caret is in still wears its wash")
    is_true(not pills["work/nib"]["open"], "a tag the caret is not in opened")
    shot(page, "02-caret-in-a-tag")

    page.locator(".cm-line", has_text="The last line").click()
    quiet(page)


def pressing_a_tag(page: Page) -> None:
    page.evaluate("() => window.nibApp.search.ask('')")
    tag = page.locator(".cm-content .tag[data-tag='work/nib']")
    tag.click(modifiers=["Control"])
    wait_for(page, "window.nibApp.search.text === 'tag:work/nib'", "the search to be asked")
    is_true(
        page.evaluate("() => window.nibApp.workspace.openOn(window.nibApp.workspace.sideOf('search'))")
        == "search",
        "the search panel is not showing",
    )
    shot(page, "03-editor-press")

    reading(page, True)
    page.evaluate("() => window.nibApp.search.ask('')")
    page.locator("article#write a.tag[data-tag='reading']").click()
    wait_for(page, "window.nibApp.search.text === 'tag:reading'", "the reading view's press")

    # A real anchor, so the keyboard reaches it and Enter presses it.
    page.evaluate("() => window.nibApp.search.ask('')")
    page.locator("article#write a.tag[data-tag='item']").focus()
    page.keyboard.press("Enter")
    wait_for(page, "window.nibApp.search.text === 'tag:item'", "Enter on a tag")
    is_true(
        page.evaluate("() => location.hash") == "",
        f"a press took the window to {page.evaluate('() => location.hash')}",
    )
    reading(page, False)


def the_schemes(page: Page) -> None:
    looks = [("default", "light"), ("default", "dark"), ("contrast", "light"), ("contrast", "dark")]
    for theme, scheme in looks:
        page.evaluate("(id) => window.nibApp.theme.select(id)", theme)
        page.evaluate("(which) => window.nibApp.theme.setScheme(which)", scheme)
        page.wait_for_timeout(300)
        label = f"{theme}-{scheme}"

        reading(page, False)
        pills_in_the_editor(page, label)
        shot(page, f"01-editor-{label}")
        reading(page, True)
        pills_in_the_reading_view(page, label)
        shot(page, f"04-reading-{label}")
        reading(page, False)

    page.evaluate("() => window.nibApp.theme.select('default')")
    page.evaluate("() => window.nibApp.theme.setScheme('dark')")
    page.wait_for_timeout(300)


def the_pointer(page: Page) -> None:
    # Asked of the page's own answer rather than of the class that gives it.
    hidden = "() => getComputedStyle(document.body).cursor === 'none'"
    under = """
    () => {
      const line = [...document.querySelectorAll('.cm-line')].find((one) =>
        one.textContent.startsWith('The last line'))
      return getComputedStyle(line).cursor
    }
    """

    line = page.locator(".cm-line", has_text="The last line")
    box = line.bounding_box()
    assert box is not None
    page.mouse.click(box["x"] + box["width"] - 4, box["y"] + box["height"] / 2)
    quiet(page)
    is_true(not page.evaluate(hidden), "the pointer was hidden before anything was typed")

    # A shortcut and an arrow are not typing.
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("Control+b")
    page.keyboard.press("Control+b")
    is_true(not page.evaluate(hidden), "a shortcut or an arrow hid the pointer")

    page.keyboard.type(" more")
    wait_for(page, hidden.replace("() => ", ""), "the pointer to hide", patience=3)
    is_true(page.evaluate(under) == "none", f"the line under it shows {page.evaluate(under)}")

    page.mouse.move(box["x"] + 40, box["y"] + 3)
    page.mouse.move(box["x"] + 60, box["y"] + 5)
    wait_for(page, f"!({hidden.replace('() => ', '')})", "the pointer to come back", patience=3)
    is_true(page.evaluate(under) != "none", "the pointer did not come back after a move")

    # A button held is somebody using the mouse.
    page.mouse.down()
    page.keyboard.type("x")
    is_true(not page.evaluate(hidden), "typing with a button held hid the pointer")
    page.mouse.up()
    page.keyboard.press("Backspace")
    wait_for(page, hidden.replace("() => ", ""), "Backspace to hide the pointer", patience=3)
    page.mouse.move(box["x"] + 80, box["y"] + 6)
    page.keyboard.press("Control+z")
    quiet(page)


def a_quoted_comma(page: Page) -> None:
    page.evaluate("() => window.nibApp.modes.setProperties('properties')")
    wait_for(page, "document.querySelector('#write .property[data-key=\\'tags\\']')", "the rows")
    quiet(page)

    chips = "() => [...document.querySelectorAll('#write .property[data-key=\\'tags\\'] .property-chip')].map((one) => one.firstChild.textContent)"
    is_true(page.evaluate(chips) == ["a, b", "c"], f"the rows read {page.evaluate(chips)}")
    shot(page, "05-rows")

    page.locator("#write .property[data-key='tags'] .property-chip-off").nth(1).click()
    quiet(page)
    said = next((one for one in page.evaluate(SAID).split("\n") if one.startswith("tags:")), "")
    is_true(said == "tags: ['a, b']", f"taking c off wrote {said!r}")
    is_true(page.evaluate(chips) == ["a, b"], f"the rows then read {page.evaluate(chips)}")

    page.fill("#write .property[data-key='tags'] .property-add", "d, e")
    page.keyboard.press("Enter")
    quiet(page)
    said = next((one for one in page.evaluate(SAID).split("\n") if one.startswith("tags:")), "")
    is_true(said == "tags: ['a, b', 'd, e']", f"adding wrote {said!r}")
    is_true(page.evaluate(chips) == ["a, b", "d, e"], f"the rows then read {page.evaluate(chips)}")
    shot(page, "06-rows-after")


def the_format_bar(page: Page) -> None:
    bar = "() => !!document.querySelector('.nib-bar-at')"
    line = page.locator(".cm-line", has_text="The last line")
    line.click()
    page.keyboard.press("End")
    page.keyboard.press("Shift+Home")
    wait_for(page, bar.replace("() => ", ""), "the format bar over a selection", patience=5)
    shot(page, "07-format-bar")

    page.keyboard.press("Control+e")
    wait_for(page, "document.querySelector('article#write')", "the reading view")
    quiet(page)
    is_true(not page.evaluate(bar), "the format bar stayed over the reading view")
    shot(page, "08-format-bar-reading")

    page.keyboard.press("Control+e")
    quiet(page)


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 860}, color_scheme="dark")
    context.add_init_script(HIDE_CARET)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "document.querySelector('.cm-content .tag')", "the tags to be drawn")
    quiet(page)

    the_schemes(page)
    the_caret_in_a_tag(page)
    pressing_a_tag(page)
    the_pointer(page)
    a_quoted_comma(page)
    the_format_bar(page)

    context.close()


def main() -> int:
    return DRIVE.run(drive, "tags, the pointer, a quoted comma and the format bar all behave")


if __name__ == "__main__":
    raise SystemExit(main())
