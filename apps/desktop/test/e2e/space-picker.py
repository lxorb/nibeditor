"""Ctrl+Shift+Space: every space in the middle of the window, a digit away.

Emil, 2026-10-03: a key opens a centred modal just for switching to another space; each
row wears a number; a digit switches as soon as only one space can be meant, without
Enter; letters find a space by its name and need Enter; there is no visible field, the
typed letters are the hits in the rows; the key again closes it, and the tabs' Alt
numbers never show beside it. What this presses and looks at, in the light and the dark,
with twelve spaces so a `1` has to wait for a second digit.

    python apps/desktop/test/e2e/space-picker.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/space-picker/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

UP = "!!document.querySelector('.picker[data-spaces-open]')"
NAMES = ["Journal", "ETH", "Lab", "Reading", "Recipes", "Taxes", "Travel", "Uni", "VIS", "Work", "Zettel"]

HERE = "() => window.nibApp.workspace.activeSpace?.name"
ROWS = """() => [...document.querySelectorAll('.picker .nib-row')].map((one) => [
  one.querySelector('.place')?.textContent,
  one.querySelector('.nib-row-label')?.textContent,
  one.querySelector('.nib-row-label b')?.textContent ?? null,
])"""


def key(page: Page) -> None:
    page.keyboard.press("Control+Shift+Space")


def opened(page: Page, scheme: str, what: str) -> None:
    key(page)
    wait_for(page, UP, f"[{scheme}] the switcher for {what}")
    page.wait_for_timeout(250)


def gone(page: Page, scheme: str, what: str) -> None:
    wait_for(page, f"!({UP})", f"[{scheme}] the switcher gone {what}")
    page.wait_for_timeout(250)


def switching(page: Page, scheme: str) -> None:
    page.emulate_media(color_scheme=scheme)
    first = page.evaluate(HERE)
    page.evaluate(
        "async (names) => { for (const name of names) await window.nibApp.workspace.addSpace(name) }",
        NAMES,
    )
    page.evaluate(
        "async (name) => { const ws = window.nibApp.workspace; await ws.showSpace(ws.spaces[0].id) }",
        first,
    )
    wait_for(page, "window.nibApp.workspace.spaces.length >= 12", f"[{scheme}] twelve spaces")
    names = page.evaluate("() => window.nibApp.workspace.spaces.map((one) => one.name)")
    say(f"[{scheme}] spaces: {names}")

    opened(page, scheme, "the first look")
    box = page.locator(".picker").bounding_box()
    view = page.viewport_size
    say(f"[{scheme}] the box {box}, the window {view}")
    if box and view and abs((box["x"] + box["width"] / 2) - view["width"] / 2) > 2:
        wrong(f"[{scheme}] the switcher is not centred across")
    if page.locator(".picker input, .picker textarea, .picker [contenteditable]").count():
        wrong(f"[{scheme}] the switcher has a field")
    rows = page.evaluate(ROWS)
    if [one[0] for one in rows] != [str(at + 1) for at in range(len(names))]:
        wrong(f"[{scheme}] the rows are not numbered 1 to {len(names)}: {rows}")
    page.keyboard.down("Alt")
    page.wait_for_timeout(200)
    tabs = page.locator(".numeral").count()
    page.keyboard.up("Alt")
    say(f"[{scheme}] Alt held over the switcher: {tabs} tab numbers")
    if tabs:
        wrong(f"[{scheme}] the tabs' Alt numbers showed beside the space numbers")
    DRIVE.shot(page, f"{scheme}-01-open")

    # Letters: the name is found, its letters bold, and nothing happens until Enter.
    page.keyboard.type("re")
    page.wait_for_timeout(300)
    rows = page.evaluate(ROWS)
    say(f"[{scheme}] 're' shows {rows}")
    if not rows or any(one[2] is None for one in rows):
        wrong(f"[{scheme}] 're' left a row without its hits: {rows}")
    height = page.locator(".picker").bounding_box()
    if box and height and abs(height["height"] - box["height"]) > 1:
        wrong(f"[{scheme}] the switcher changed height as a name was typed")
    DRIVE.shot(page, f"{scheme}-02-name")
    if page.evaluate(HERE) != first:
        wrong(f"[{scheme}] a name switched without Enter")
    page.keyboard.press("Backspace")
    page.keyboard.type("ci")
    page.wait_for_timeout(200)
    page.keyboard.press("Enter")
    gone(page, scheme, "on Enter")
    if page.evaluate(HERE) != "Recipes":
        wrong(f"[{scheme}] Enter on 'rci' went to {page.evaluate(HERE)!r}, not Recipes")

    # A digit only one number starts with goes at once.
    opened(page, scheme, "a digit")
    page.keyboard.press("3")
    gone(page, scheme, "on 3")
    if page.evaluate(HERE) != names[2]:
        wrong(f"[{scheme}] 3 went to {page.evaluate(HERE)!r}, not {names[2]}")

    # `1` with twelve spaces waits for a second digit, and goes by itself after.
    opened(page, scheme, "a digit that waits")
    page.keyboard.press("1")
    page.wait_for_timeout(150)
    rows = page.evaluate(ROWS)
    say(f"[{scheme}] '1' shows {[one[0] for one in rows]}")
    DRIVE.shot(page, f"{scheme}-03-waiting")
    if page.evaluate(HERE) == names[0]:
        wrong(f"[{scheme}] 1 went before a second digit could come")
    gone(page, scheme, "after the wait")
    if page.evaluate(HERE) != names[0]:
        wrong(f"[{scheme}] 1 went to {page.evaluate(HERE)!r}, not {names[0]}")

    opened(page, scheme, "two digits")
    page.keyboard.press("1")
    page.keyboard.press("2")
    gone(page, scheme, "on 12")
    if page.evaluate(HERE) != names[11]:
        wrong(f"[{scheme}] 12 went to {page.evaluate(HERE)!r}, not {names[11]}")

    # The key again puts it away; so does Escape.
    opened(page, scheme, "the key again")
    key(page)
    gone(page, scheme, "on the key again")
    opened(page, scheme, "Escape")
    page.keyboard.press("Escape")
    gone(page, scheme, "on Escape")
    if page.evaluate(HERE) != names[11]:
        wrong(f"[{scheme}] closing it changed the space")


def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 800})
        DRIVE.open(page)
        switching(page, scheme)
        page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Ctrl+Shift+Space switches space by number and by name"))
