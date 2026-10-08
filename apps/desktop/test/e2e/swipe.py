"""Two fingers sideways over a note, and over a page, in a real browser.

What only a browser can answer about src/lib/back-swipe and src-tauri/src/web_swipe.js:

  - a sweep to the right over a note brings the arrow in from the pane's side, and the
    tab goes back to the note it showed before; one to the left goes forward again; a
    short one goes nowhere; a sweep after a scroll down is a sweep of its own; the
    setting turned off is a scroll and nothing else;
  - the arrow, photographed half way and past the point where it goes, light and dark;
  - the page script in a site's page says each sideways scroll the page left over, and
    says that the page took it where a scroller in the page could still move, where the
    page keeps its overscroll (`overscroll-behavior-x: none`, Google Sheets' line), and
    where the page's own handler took the wheel; and says nothing for a scroll down - one
    that drifts sideways as it goes included - or a tilted wheel's notch.

The sweeps are Chromium's own smooth scroll gestures from the protocol
(`Input.synthesizeScrollGesture`), whose wheel events are trusted and precise - a pixel
delta and no notch - the way a touchpad's are; `page.mouse.wheel` is the tilted wheel, a
whole notch each. A touchpad's own report is a hand's alone; see scripts/swipe-probe.py
for the native app, and gesture.test.ts for the numbers.

    python apps/desktop/test/e2e/swipe.py
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

SCRIPT = (Path(__file__).resolve().parents[2] / "src-tauri" / "src" / "web_swipe.js").read_text(
    encoding="utf-8"
)

#: The two notes the tab has shown, Alpha and then Beta: the trail a swipe walks.
TRAIL = """async () => {
  const ws = window.nibApp.workspace
  const path = (starts) => ws.notes.find((one) => one.name.startsWith(starts)).path
  await ws.open(path('Alpha'), { preview: true })
  await ws.open(path('Beta'), { preview: true })
}"""

#: Keeps an arrow out for a picture: `across` thirty times, then a hair of scroll every
#: 30 ms so the touchpad never goes quiet. Untrusted, which nib's own page does not mind.
HOLD = """(across) => {
  const at = document.querySelector('.cm-content')
  const step = (dx) => at.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaMode: 0, bubbles: true }))
  for (let one = 0; one < 30; one++) step(-across)
  window.__holding = setInterval(() => step(-0.001), 30)
}"""


def front(page: Page) -> str:
    return str(page.evaluate("window.nibApp.workspace.active?.note?.name ?? ''"))


def on(page: Page, starts: str, what: str) -> None:
    wait_for(page, f"window.nibApp.workspace.active?.note?.name.startsWith({json.dumps(starts)})", what)


def sweep(page: Page, x: float, y: float, across: float, down: float = 0) -> None:
    """Two fingers moved `across` to the right (and `down`) at `x`, `y`: a scroll the
    other way, a pixel delta at a time, as a touchpad reports one. Back is a sweep to the
    right."""
    tools = page.context.new_cdp_session(page)
    tools.send(
        "Input.synthesizeScrollGesture",
        {
            "x": x,
            "y": y,
            "xDistance": across,
            "yDistance": down,
            "gestureSourceType": "mouse",
            "speed": 1200,
            "preventFling": True,
        },
    )
    tools.detach()


def lifted(page: Page) -> None:
    """Long enough after the last report for the fingers to count as lifted, and for
    the arrow to play out."""
    time.sleep(0.6)
    DRIVE.settled(page)


def opened(browser: Browser, scheme: str = "light", off: bool = False) -> tuple[Page, float, float]:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820}, color_scheme=scheme)
    if off:
        page.add_init_script("localStorage.setItem('nib:swipe', 'off')")
    DRIVE.open(page)
    DRIVE.seed(page, "# Alpha\n\nThe first note.\n", "# Beta\n\nThe second note.\n")
    page.evaluate(TRAIL)
    wait_for(page, "window.nibApp.workspace.active?.canGoBack", "a tab with somewhere to go back to")
    DRIVE.settled(page)
    box = page.locator(".cm-content").first.bounding_box()
    if box is None:
        raise SystemExit("no note on screen")
    return page, box["x"] + box["width"] / 2, box["y"] + 120


def notes(browser: Browser, scheme: str) -> None:
    page, x, y = opened(browser, scheme)

    # Half way, and past the point where it goes, each held there for its picture.
    for across, name in ((7, "half"), (14, "armed")):
        page.evaluate(HOLD, across)
        DRIVE.settled(page)
        if page.locator(".nib-swipe").count() != 1:
            wrong(f"{scheme}: no arrow {name} way along a sweep")
        if (page.locator(".nib-swipe.armed").count() == 1) != (name == "armed"):
            wrong(f"{scheme}: the arrow {name} way along is armed wrong")
        shot(page, f"{scheme}-{name}")
        page.evaluate("clearInterval(window.__holding)")
        lifted(page)
        if front(page).startswith("Alpha"):
            page.evaluate("window.nibApp.workspace.goForward()")
        on(page, "Beta", "Beta again")

    sweep(page, x, y, 120)
    lifted(page)
    if not front(page).startswith("Beta"):
        wrong(f"{scheme}: a short sweep went somewhere: {front(page)}")
    else:
        say(f"ok   {scheme}: a short sweep stays")

    sweep(page, x, y, 700)
    lifted(page)
    on(page, "Alpha", "back on Alpha")
    say(f"ok   {scheme}: a long sweep to the right goes back")
    if page.locator(".nib-swipe").count() != 0:
        wrong(f"{scheme}: the arrow stayed after it went")

    sweep(page, x, y, -700)
    lifted(page)
    on(page, "Beta", "forward on Beta")
    say(f"ok   {scheme}: a long sweep to the left goes forward")

    # A scroll down first is a stream of its own; the sweep after it is a sweep.
    sweep(page, x, y, 0, -300)
    lifted(page)
    sweep(page, x, y, 700)
    lifted(page)
    on(page, "Alpha", "back on Alpha after a scroll down")
    page.close()


def turned_off(browser: Browser) -> None:
    """Off in the settings: a sweep is a scroll."""
    page, x, y = opened(browser, off=True)
    sweep(page, x, y, 700)
    lifted(page)
    if not front(page).startswith("Beta"):
        wrong(f"switched off, a sweep went back: {front(page)}")
    else:
        say("ok   switched off, a sweep is a scroll")
    page.close()


#: A site's page with the page script in it, as nib's world holds it, and the binding a
#: list in the page. Three places to put the pointer: plain words, a scroller in the
#: middle of its row, and a map that takes the wheel.
PAGE = f"""<!doctype html>
<meta charset="utf-8">
<style>
  body {{ margin: 0; font: 16px system-ui }}
  #row {{ width: 400px; overflow-x: auto; white-space: nowrap }}
  #row div {{ display: inline-block; width: 300px; height: 80px; background: #ccd }}
  #map {{ width: 400px; height: 120px; background: #dfd }}
</style>
<p id="words">Words.</p>
<div id="row"><div></div><div></div><div></div></div>
<div id="map">A map.</div>
<script>
  window.said = []
  window.nibSwiped = (one) => window.said.push(JSON.parse(one))
  document.getElementById('row').scrollLeft = 200
  document.getElementById('map').addEventListener('wheel', (event) => event.preventDefault(), {{ passive: false }})
</script>
<script>{SCRIPT}</script>
"""


def page_script(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 800, "height": 600})
    page.set_content(PAGE)

    def heard(selector: str, across: float, down: float = 0, notch: bool = False) -> list[dict[str, object]]:
        page.evaluate("window.said = []")
        box = page.locator(selector).bounding_box()
        assert box is not None
        x, y = box["x"] + 20, box["y"] + box["height"] / 2
        if notch:
            page.mouse.move(x, y)
            page.mouse.wheel(-across, -down)
        else:
            sweep(page, x, y, across, down)
        # Past the page's own quiet, so the next gesture is a stream of its own.
        time.sleep(0.2)
        return list(page.evaluate("window.said"))

    plain = heard("#words", 100)
    if not plain or any(one.get("k") != "w" or one.get("l") or one.get("r") for one in plain):
        wrong(f"a sideways scroll over plain words: {json.dumps(plain)}")
    elif sum(float(str(one["dx"])) for one in plain) >= 0:
        wrong(f"a scroll towards the left was not said as one: {json.dumps(plain)}")
    else:
        say(f"ok   the page says a scroll it left over ({len(plain)} frames)")

    row = heard("#row", 100)
    if not row or not all(one.get("l") for one in row):
        wrong(f"a scroller with room to the left did not take the scroll: {json.dumps(row)}")
    else:
        say("ok   a scroller in the page takes what it can")

    kept = heard("#map", 100)
    if not kept or not all(one.get("l") and one.get("r") for one in kept):
        wrong(f"a map that took the wheel did not keep it: {json.dumps(kept)}")
    else:
        say("ok   a handler that took the wheel keeps it")

    if heard("#words", 0, 100):
        wrong("a scroll down was said")
    drifting = heard("#words", 60, 400)
    if drifting:
        wrong(f"a scroll down that drifted sideways was said: {json.dumps(drifting)}")
    else:
        say("ok   a scroll down that drifts sideways says nothing")
    if heard("#words", 100, notch=True):
        wrong("a tilted wheel's notch was said")
    page.evaluate("document.documentElement.style.overscrollBehaviorX = 'none'")
    contained = heard("#words", 100)
    if not contained or not all(one.get("l") and one.get("r") for one in contained):
        wrong(f"a page that keeps its overscroll did not keep it: {json.dumps(contained)}")
    else:
        say("ok   overscroll-behavior-x: none keeps the swipe out")
    page.close()


def drive(browser: Browser) -> None:
    page_script(browser)
    for scheme in ("light", "dark"):
        notes(browser, scheme)
    turned_off(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "swipes go back and forward, and only where they should"))
