"""The tab strip scrolls only as far as its tabs go.

Emil, 2026-10-14: *"man kann viel zu weit nach rechts scrollen bei den tabs."* Three
tabs in a wide window, and the strip scrolled the first one out under the buttons
before it. The line the open tab stands on ran a whole window's width past it, and the
strip counted that line as something to scroll to.

What this holds, as a browser's strip does:

  - tabs that fit never scroll: the wheel, Shift with the wheel and a sideways swipe
    leave the strip where it is, and so does a script asking it to move;
  - tabs that do not fit scroll exactly to the plus after the last one, and no further;
  - the open tab is brought into view, and only just: from either side it stops at the
    strip's edge rather than past it;
  - closing tabs or widening the window until they fit takes the strip back to its start.

Run it from the repository root:

    python apps/desktop/test/e2e/tab-scroll.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/tab-scroll/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

# Notes in the space, each in a tab of its own, and nothing else open.
SEED = """
async (names) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const tab of [...ws.tabs]) ws.close(tab.id)
  for (const name of names) {
    const path = await ws.noteFrom(`# ${name}\\n\\nWords.\\n`, root)
    await ws.openEntry(path, { activate: true })
    ws.keep(ws.activeTabId)
  }
  for (const one of ws.tabs.filter((tab) => !names.includes(tab.shown))) ws.close(one.id)
}
"""

# The strip as it scrolls: how far it is along, how far it could go, and where the open
# tab and the plus are inside what it shows.
LOOK = """
() => {
  const strip = document.querySelector('.tabs')
  const box = strip.getBoundingClientRect()
  const active = strip.querySelector('.tab.active')?.getBoundingClientRect()
  const plus = strip.querySelector('.new')?.getBoundingClientRect()
  return {
    at: strip.scrollLeft,
    most: strip.scrollWidth - strip.clientWidth,
    left: box.left,
    right: box.left + strip.clientWidth,
    active: active ? { left: active.left, right: active.right } : null,
    plus: plus ? { left: plus.left, right: plus.right } : null,
  }
}
"""

#: Enough for even the narrowest tabs not to fit in 900px, and all to fit in 2400px.
MANY = 80

ACTIVATE = "(at) => { const ws = window.nibApp.workspace; ws.activate(ws.tabs.at(at).id) }"


def names(count: int, start: int = 0) -> list[str]:
    return [f"Note {at + 1:02d}" for at in range(start, start + count)]


def look(page: Page) -> dict:
    return page.evaluate(LOOK)


def settle(page: Page) -> None:
    """Past every tab's easing, and past a smooth scroll."""
    page.wait_for_timeout(700)


def over_strip(page: Page) -> None:
    """The pointer on the strip's empty stretch, past the plus, where the wheel is the strip's."""
    seen = look(page)
    box = page.locator(".tabs").bounding_box()
    page.mouse.move(seen["right"] - 4, box["y"] + box["height"] / 2)


def turns(page: Page, dx: float, dy: float, shift: bool = False, times: int = 6) -> None:
    if shift:
        page.keyboard.down("Shift")
    for _ in range(times):
        page.mouse.wheel(dx, dy)
        page.wait_for_timeout(30)
    if shift:
        page.keyboard.up("Shift")
    page.wait_for_timeout(250)


def still(page: Page, where: str) -> None:
    seen = look(page)
    if seen["most"] > 0:
        wrong(f"{where}: the strip has {seen['most']}px to scroll with every tab in view")
    if seen["at"] != 0:
        wrong(f"{where}: the strip is {seen['at']}px along with every tab in view")


def fitting(page: Page) -> None:
    """Three tabs in a wide window, the last one open: nothing moves the strip."""
    page.evaluate(SEED, names(3))
    wait_for(page, "document.querySelectorAll('.tabs .tab').length === 3", "three tabs")
    settle(page)
    still(page, "three tabs")

    over_strip(page)
    for label, dx, dy, shift in (
        ("the wheel", 0, 300, False),
        ("Shift and the wheel", 0, 300, True),
        ("a sideways swipe", 300, 0, False),
    ):
        turns(page, dx, dy, shift)
        still(page, f"three tabs, {label}")

    page.evaluate("() => { document.querySelector('.tabs').scrollLeft = 2000 }")
    page.wait_for_timeout(100)
    still(page, "three tabs, asked by a script")

    page.evaluate(ACTIVATE, 0)
    settle(page)
    still(page, "three tabs, the first one opened")
    DRIVE.shot(page, "01-three-tabs")


def to_the_end(page: Page, where: str) -> dict:
    """Scrolled as far as the wheel goes: it ends at the plus, which is wholly in view."""
    over_strip(page)
    turns(page, 0, 400, times=40)
    seen = look(page)
    if seen["at"] < seen["most"] - 1:
        wrong(f"{where}: the wheel stopped at {seen['at']} of {seen['most']}px")
    plus = seen["plus"]
    if plus is None:
        wrong(f"{where}: no plus")
        return seen
    past = seen["right"] - plus["right"]
    say(f"{where}: at the end, {past:.1f}px of strip after the plus")
    if past < 0 or past > 8:
        wrong(f"{where}: the strip ends {past:.1f}px after the plus")
    return seen


def overflowing(page: Page) -> None:
    """Eighty tabs in a narrow window: the strip scrolls, to the plus and no further."""
    page.set_viewport_size({"width": 900, "height": 700})
    page.evaluate(SEED, names(MANY))
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {MANY}", "the tabs")
    settle(page)
    seen = look(page)
    if seen["most"] <= 0:
        wrong(f"the tabs in 900px do not overflow (most {seen['most']})")
        return

    # The last one opened, last: it is in view, and the strip is at its end.
    active = seen["active"]
    if not active or active["right"] > seen["right"] + 0.5 or active["left"] < seen["left"] - 0.5:
        wrong(f"the last tab opened is not in view: {seen}")

    # A sideways swipe goes no further than the wheel does.
    over_strip(page)
    turns(page, 600, 0, times=10)
    seen = look(page)
    if seen["at"] > seen["most"] + 0.5:
        wrong(f"a sideways swipe went to {seen['at']} of {seen['most']}px")

    to_the_end(page, "eighty tabs")
    DRIVE.shot(page, "02-the-end")

    # The first tab opened from the end: the strip goes back to its start.
    page.evaluate(ACTIVATE, 0)
    settle(page)
    seen = look(page)
    if seen["at"] != 0:
        wrong(f"the first tab opened leaves the strip {seen['at']}px along")

    # One in the middle opened from the start: in view, at the strip's far edge and not
    # past it.
    page.evaluate(ACTIVATE, 70)
    settle(page)
    seen = look(page)
    active = seen["active"]
    if not active:
        wrong("no open tab")
        return
    gap = seen["right"] - active["right"]
    say(f"the 71st tab opened from the start: {gap:.1f}px between it and the strip's end")
    if gap < 0 or gap > 20:
        wrong(f"the 71st tab opened from the start is {gap:.1f}px from the strip's end")
    DRIVE.shot(page, "03-revealed")

    # And the other way: the second opened from there is at the strip's start.
    page.evaluate(ACTIVATE, 1)
    settle(page)
    seen = look(page)
    active = seen["active"]
    gap = active["left"] - seen["left"] if active else -1
    say(f"the 2nd tab opened from there: {gap:.1f}px between the strip's start and it")
    if gap < 0 or gap > 20:
        wrong(f"the 2nd tab opened from there is {gap:.1f}px from the strip's start")


def closing(page: Page) -> None:
    """Scrolled to the end and closed down to three: back at the start."""
    page.set_viewport_size({"width": 900, "height": 700})
    page.evaluate(SEED, names(MANY))
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {MANY}", "the tabs")
    settle(page)
    to_the_end(page, "before closing")
    page.evaluate(
        "() => { const ws = window.nibApp.workspace; for (const tab of ws.tabs.slice(3)) ws.close(tab.id) }"
    )
    wait_for(page, "document.querySelectorAll('.tabs .tab').length === 3", "three tabs left")
    settle(page)
    still(page, "closed down to three")
    page.mouse.move(10, 400)


def widening(page: Page) -> None:
    """Scrolled to the end, and the window made wide enough for every tab."""
    page.set_viewport_size({"width": 700, "height": 700})
    page.evaluate(SEED, names(MANY))
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {MANY}", "the tabs")
    settle(page)
    if look(page)["most"] <= 0:
        wrong("eighty tabs in 700px do not overflow")
        return
    to_the_end(page, "eighty tabs in 700px")
    page.set_viewport_size({"width": 2400, "height": 700})
    settle(page)
    still(page, "eighty tabs in 2400px")
    over_strip(page)
    turns(page, 0, 300)
    still(page, "eighty tabs in 2400px, the wheel")
    DRIVE.shot(page, "04-widened")


def drive(browser: Browser) -> None:
    for step in (fitting, overflowing, closing, widening):
        page = DRIVE.page(browser, viewport={"width": 1600, "height": 800})
        DRIVE.open(page)
        step(page)
        page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the strip scrolls only as far as its tabs"))
