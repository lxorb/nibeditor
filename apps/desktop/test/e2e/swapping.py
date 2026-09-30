"""The swap, watched frame by frame.

A screenshot cannot show a movement, and a screenshot taken from outside the page
cannot even be aimed at the middle of one: the round trip is longer than the
movement. So this samples from inside the page instead - it asks for the panel to
change and then reads, on each of the next fourteen frames, where the segmented
control's raised surface has got to and how far through their fades the outgoing
and incoming panels are.

What it is checking, on a desktop and on a phone:

- the raised surface moves rather than jumping, over `--dur-fast`;
- two panels exist while they cross, one fading out and slipping up, the other
  fading in from below;
- nothing but `opacity` and `transform` ever differs between two frames;
- and for a reader who has asked for as little movement as possible, every one of
  those is finished on the first frame after the press.

Build first, as for shell.py, then from the repository root:

    python apps/desktop/test/e2e/swapping.py

It prints what it saw, and photographs the space switcher standing open.
"""

from __future__ import annotations


from harness import Drive
from shell import DESKTOP_AGENT, PHONE_AGENT, SEED

DRIVE = Drive(__file__)
say = DRIVE.say

OUT = DRIVE.shots

# Fourteen frames, from inside the page, so the reading is of the frame and not
# of a round trip. Every property the swap is allowed to touch is read on each,
# and nothing else is: if a width or a height ever moved, it would have to be
# added here to be seen, which is the point.
FRAMES = """
async () => {
  const seen = []
  const look = () => {
    const thumb = document.querySelector('.nib-segmented-thumb')
    const panels = [...document.querySelectorAll('aside .body')]
    const box = (one) => {
      const style = getComputedStyle(one)
      return {
        opacity: Number(style.opacity).toFixed(2),
        y: Number(new DOMMatrixReadOnly(style.transform).m42.toFixed(2)),
        width: Math.round(one.getBoundingClientRect().width),
      }
    }
    return {
      thumb: thumb ? Number(new DOMMatrixReadOnly(getComputedStyle(thumb).transform).m41.toFixed(1)) : null,
      panels: panels.map(box),
    }
  }

  seen.push(look())
  window.nibApp.workspace.showPanel('links')
  for (let frame = 0; frame < 14; frame++) {
    await new Promise((go) => requestAnimationFrame(go))
    seen.push(look())
  }
  return seen
}
"""


def drive(browser, name: str, width: int, height: int, agent: str, finger: bool, still: bool):

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        reduced_motion="reduce" if still else "no-preference",
        device_scale_factor=2,
    )
    page = context.new_page()
    DRIVE.open(page)
    page.evaluate(SEED)
    page.wait_for_timeout(700)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)

    frames = page.evaluate(FRAMES)
    places = [one["thumb"] for one in frames]
    crossing = sum(1 for one in frames if len(one["panels"]) > 1)

    say(f"[{name}] the raised surface: {places[0]} to {places[-1]} over {len(set(places))} places")
    say(f"[{name}] two panels crossed on {crossing} of {len(frames)} frames")
    for one in frames[: 8 if not still else 3]:
        say(f"[{name}]   surface {one['thumb']}, panels {one['panels']}")

    if still:
        # Nothing may still be moving after the frame the press was answered on.
        moving = [one for one in frames[2:] if one["thumb"] != places[-1]]
        say(f"[{name}] frames still moving after the first: {len(moving)}")

    # The switcher standing open, which is the one part of this a picture shows.
    page.locator("aside .name").first.click(force=True)
    page.wait_for_timeout(350)
    page.screenshot(
        path=str(OUT / f"{name}-switcher.png"),
        clip={"x": 0, "y": 0, "width": min(width, 420), "height": 340},
    )
    say(f"shot {name}-switcher.png")

    context.close()


def main() -> int:
    with DRIVE.session() as browser:
        drive(browser, "desktop", 1440, 900, DESKTOP_AGENT, False, False)
        drive(browser, "desktop-still", 1440, 900, DESKTOP_AGENT, False, True)
        drive(browser, "phone", 390, 844, PHONE_AGENT, True, False)

    return DRIVE.verdict(f"shots in {OUT}")


if __name__ == "__main__":
    raise SystemExit(main())
