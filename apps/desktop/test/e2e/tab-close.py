"""A tab closed with its cross, frame by frame.

Emil, 2026-10-03: *"the tab close animation is a bit buggy."* Chrome's close is the one
held to (docs/chrome-tabs.md, Closing and Motion): the closed tab shrinks to nothing where
it stood, the tabs after it slide in at the same pace, and while the pointer stays on the
strip every other tab keeps its width, so the next cross is already under it. What was
wrong was the closed tab going on being drawn as the one in front - two fills and two pairs
of feet for the whole shrink, the flash - with its lit cross riding the shrinking edge.

What this watches, every frame from the press to the end, in the light and the dark:

  - never two tabs drawn in front, and the closed one never with a fill;
  - the closed tab's trailing edge and the next tab's leading edge together within a
    pixel or two the whole way, so nothing jumps and no gap opens;
  - every other tab's width the same from the first frame to the last;
  - a second press where the first one was closes the next tab, which is what holding
    the widths is for.

Run it from the repository root:

    python apps/desktop/test/e2e/tab-close.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/tab-close/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for

NAMES = [f"Note {letter}" for letter in "ABCDEFGHIJKL"]

# Twelve notes in the space, each in a tab of its own: narrower than they would like in a
# window this size, which is when a close holds the widths.
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

# Every frame from now: each tab's box, whether it is drawn in front or on its way out, and
# whether its body is filled.
WATCH = """
() => {
  window.__frames = []
  const look = () => {
    window.__frames.push([...document.querySelectorAll('.tabs .tab')].map((one) => {
      const box = one.getBoundingClientRect()
      return {
        name: one.querySelector('.label')?.textContent ?? '',
        left: box.left,
        right: box.right,
        width: box.width,
        active: one.classList.contains('active'),
        leaving: one.classList.contains('leaving'),
        filled: getComputedStyle(one.querySelector('.fill')).backgroundColor !== 'rgba(0, 0, 0, 0)',
      }
    }))
    if (window.__frames.length < 40) requestAnimationFrame(look)
  }
  requestAnimationFrame(look)
}
"""


def tab(name: str) -> str:
    return f'.tab:has(.label:text-is("{name}"))'


def frames(page: Page) -> list[list[dict]]:
    wait_for(page, "window.__frames && window.__frames.length >= 40", "forty frames")
    return page.evaluate("() => window.__frames")


def closing(page: Page, scheme: str) -> None:
    page.emulate_media(color_scheme=scheme)
    page.evaluate(SEED, NAMES)
    wait_for(page, f"document.querySelectorAll('.tabs .tab').length === {len(NAMES)}", "the strip")
    page.locator(f"{tab('Note D')} .pick").click()
    page.wait_for_timeout(400)

    cross = page.locator(f"{tab('Note D')} .shut").bounding_box()
    x, y = cross["x"] + cross["width"] / 2, cross["y"] + cross["height"] / 2
    page.mouse.move(x, y)
    page.wait_for_timeout(300)

    page.evaluate(WATCH)
    page.mouse.down()
    page.mouse.up()
    page.wait_for_timeout(60)
    DRIVE.shot(page, f"{scheme}-01-closing")
    seen = frames(page)

    first = {one["name"]: one["width"] for one in seen[0] if one["name"] != "Note D"}
    worst = 0.0
    for at, frame in enumerate(seen):
        active = [one["name"] for one in frame if one["active"]]
        if len(active) > 1:
            wrong(f"[{scheme}] frame {at} draws {active} in front")
            break
        going = next((one for one in frame if one["name"] == "Note D"), None)
        if going is None:
            continue
        if going["filled"] and going["leaving"]:
            wrong(f"[{scheme}] frame {at}: the closed tab is still filled")
            break
        after = next((one for one in frame if one["name"] == "Note E"), None)
        if after and going["leaving"]:
            worst = max(worst, abs(going["right"] - after["left"]))
        for one in frame:
            held = first.get(one["name"])
            if held is not None and one["name"] != "Note E" and abs(one["width"] - held) > 0.5:
                wrong(f"[{scheme}] frame {at}: {one['name']} went from {held} to {one['width']} wide")
                return
    say(f"[{scheme}] the closed tab's edge and the next one's: at most {worst:.1f} px apart")
    if worst > 3:
        wrong(f"[{scheme}] the closed tab and the next one parted by {worst:.1f} px")

    # The next cross is where this one was: a second press closes Note E.
    page.mouse.down()
    page.mouse.up()
    wait_for(page, "!window.nibApp.workspace.tabs.some((one) => one.shown === 'Note E')", "Note E to close")
    left = page.evaluate("() => window.nibApp.workspace.tabs.map((one) => one.shown)")
    say(f"[{scheme}] after two presses in one place: {left}")
    if "Note D" in left or "Note E" in left or len(left) != len(NAMES) - 2:
        wrong(f"[{scheme}] two presses did not close the two tabs: {left}")
    page.mouse.move(x, y + 300)
    page.wait_for_timeout(500)
    DRIVE.shot(page, f"{scheme}-02-let-out")


def drive(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = DRIVE.page(browser, viewport={"width": 1000, "height": 700})
        DRIVE.open(page)
        closing(page, scheme)
        page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a closed tab shrinks out of the way, and the rest hold still"))
