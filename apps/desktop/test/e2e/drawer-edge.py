"""What a shut drawer leaves at the left edge of the screen.

Emil photographed a phone whose title bar had something of the panel's own header
sitting in front of the sidebar button, partly cut off. This is the state that
produces it: a handheld wide enough that the drawer slides *over* the note rather
than becoming the whole screen, so the bar underneath stays put while the panel
travels across it.

It photographs the top left corner at each stage of the drawer going - open,
part-way, and shut - so what is under the bar at each of them can be looked at
rather than guessed.

Build first, as for shell.py, then from the repository root:

    python apps/desktop/test/e2e/drawer-edge.py
"""

from __future__ import annotations


from harness import Drive
from shell import PHONE_AGENT, SEED

DRIVE = Drive(__file__)
say = DRIVE.say

OUT = DRIVE.shots

# What is actually painted over the bar: every element the top left corner of the
# screen hits, from the front backwards, with the panel's own box beside it.
CORNER = """
() => {
  const at = document.elementsFromPoint(12, 28).map((one) => {
    const name = one.tagName.toLowerCase()
    const cls = typeof one.className === 'string' ? one.className : ''
    return cls ? `${name}.${cls.trim().split(/\\s+/).join('.')}` : name
  })
  const panels = document.querySelector('.panels')
  const box = panels ? panels.getBoundingClientRect() : null
  return {
    under: at.slice(0, 4),
    panels: box ? { left: Math.round(box.left), right: Math.round(box.right) } : null,
  }
}
"""


# A finger starting at the left edge and pulling right, a frame at a time.
SWIPE = """
async () => {
  const target = document.elementFromPoint(6, 200)
  const fire = (kind, x) => {
    const touch = new Touch({ identifier: 1, target, clientX: x, clientY: 200 })
    target.dispatchEvent(
      new TouchEvent(kind, {
        touches: kind === 'touchend' ? [] : [touch],
        targetTouches: kind === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      }),
    )
  }

  fire('touchstart', 6)
  for (let x = 20; x <= 320; x += 20) {
    await new Promise((go) => requestAnimationFrame(go))
    fire('touchmove', x)
  }
  fire('touchend', 320)
}
"""


def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(
            viewport={"width": 844, "height": 390},
            user_agent=PHONE_AGENT,
            has_touch=True,
            is_mobile=True,
            device_scale_factor=2,
        )
        page = context.new_page()
        DRIVE.open(page)
        page.evaluate(SEED)
        page.wait_for_timeout(700)

        def corner(tag: str) -> None:
            page.screenshot(
                path=str(OUT / f"{tag}.png"), clip={"x": 0, "y": 0, "width": 420, "height": 90}
            )
            say(f"{tag}: {page.evaluate(CORNER)}")

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)
        corner("01-open")

        page.evaluate("() => window.nibApp.workspace.closePanel()")
        page.wait_for_timeout(90)
        corner("02-going")

        page.wait_for_timeout(700)
        corner("03-shut")

        # And back, by the gesture rather than by a button: the drag measures
        # the panel's own width, and with the column of spaces gone a shut
        # drawer has no width at all to measure, so this is the path that had
        # to keep working. Real touch events, dispatched in the page: the
        # drawer listens for touches and a synthesised mouse is not one.
        page.evaluate(SWIPE)
        page.wait_for_timeout(800)
        say(f"dragged open: panel is {page.evaluate('() => window.nibApp.workspace.panel')}")
        corner("04-dragged-back")

        context.close()

    say(f"shots in {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
