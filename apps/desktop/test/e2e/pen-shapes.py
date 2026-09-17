"""Every pen out there, driven for real: the five shapes a browser reports a stylus in.

The ink was built with an S Pen on a Samsung tablet, because that is the pen there was
to hold. This drive is the other four: an Apple Pencil on an iPad, a Surface Pen on
Windows, a Wacom on a desktop, and a USI pen on a Chromebook - each of them emulated as
the numbers its own platform sends, against the built web app in the machine's own
Chrome. The table it is drawn from is in `docs/canvas.md`.

What it checks and photographs, one context per pen so each carries its platform's own
user agent and the app's own profile detection is exercised:

    a Pencil: the pressure gain, the lean reported as an altitude and an azimuth,
      and a stroke drawn with neither `getCoalescedEvents` nor `getPredictedEvents`
    a Surface Pen: the barrel button rubbing out, the eraser end rubbing out, a nib
      held still opening no menu, and a barrel held while hovering doing nothing
    a Wacom: the pen lifted, moved right across the tablet and put down again, with
      no line from where it was last hovering, and the middle button panning
    a USI pen: a pressure that never changes, ignored rather than drawn as a hairline
    a finger on glass that has seen a pen: the page moves and nothing is drawn

Two of the shapes cannot come down the DevTools protocol at all. `Input.dispatchMouseEvent`
carries the five buttons a mouse has, so the eraser end - button 5, bit 32 - is
unsendable, and it has no field for the spherical angles Safari reports a lean in. Those
two are dispatched as `PointerEvent`s from inside the page instead, which is the same
handlers, the same reducer and the same ink; everything else here is the protocol.

Run it from the repository root:

    python apps/desktop/test/e2e/pen-shapes.py

It builds the app, serves it, drives the browser and stops everything again. Nothing it
makes outlives it but the screenshots, which go beside it under `shots/`.

The app is built `--mode drive` on purpose, which is what leaves the app's own
stores reachable from the page; see the other drives beside this one.
"""

from __future__ import annotations

import functools
import http.server
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
SHOTS = HERE / "shots" / "pen-shapes"
DIST = APP / "dist"

# Its own port, above the dev server and above the other drives.
PORT = 18881
ORIGIN = f"http://127.0.0.1:{PORT}"

failures: list[str] = []


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def fail(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)


def build() -> None:
    say("building the web app")
    # From nothing: a build over the last one leaves its chunks behind, and a drive that
    # photographs yesterday's ink is worse than no drive at all.
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address; see pen-bar.py for why that matters on Windows."""

    allow_reuse_address = False


def serve() -> Strict:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
    except OSError as error:
        raise SystemExit(f"something is already listening on {ORIGIN}: {error}") from error

    threading.Thread(target=server.serve_forever, daemon=True).start()

    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)

    raise SystemExit("the file server never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


# The real user agents, because the profile is read off one and that is the only thing
# about this which can be wrong.
AGENTS = {
    "pencil": (
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
        " (KHTML, like Gecko) Version/18.0 Safari/604.1"
    ),
    "surface": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/140.0.0.0 Safari/537.36"
    ),
    "wacom": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/140.0.0.0 Safari/537.36"
    ),
    "usi": (
        "Mozilla/5.0 (X11; CrOS aarch64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko)"
        " Chrome/140.0.0.0 Safari/537.36"
    ),
}

# Safari has neither of the two calls, and a stroke that needed either of them would be a
# stroke that only draws properly on Chromium. Taken off the prototype before any of the
# app's own scripts run, so its feature detection sees what an iPad's would.
NO_COALESCING = """
delete PointerEvent.prototype.getCoalescedEvents;
delete PointerEvent.prototype.getPredictedEvents;
"""

AS_TABLET = """
() => {
  const app = window.nibApp;
  app.viewport.device = 'tablet';
  app.viewport.portrait = false;
  const root = document.documentElement;
  root.dataset.device = 'tablet';
  root.toggleAttribute('data-touch', true);
  root.toggleAttribute('data-drawer', false);
  root.toggleAttribute('data-narrow', false);
}
"""


def opened(page: Page, label: str, tablet: bool = False) -> None:
    """The app started and a fresh canvas open on it."""
    wait_for(page, "!!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "window.nibApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    if tablet:
        page.evaluate(AS_TABLET)

    # Asked more than once if it has to be: the space arrives a moment before the tree
    # under it does, and a canvas asked for in that moment lands nowhere.
    opened_it = "window.nibApp.workspace.active?.path?.endsWith('.canvas')"
    for _try in range(4):
        page.evaluate("() => window.nibApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({opened_it})"):
            break
    else:
        raise SystemExit(f"[{label}] no canvas ever opened")

    page.wait_for_selector(".canvas", timeout=15000)
    page.wait_for_timeout(400)


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path))
    say(f"photographed {path.name}")


def plane(page: Page) -> dict:
    box = page.locator(".canvas").first.bounding_box()
    assert box
    return box


def ink_of(page: Page) -> list[dict]:
    """What the plane holds, read off the open canvas rather than guessed at."""
    return page.evaluate("() => JSON.parse(window.nibApp.workspace.active.doc).nib?.ink ?? []")


def points_of(stroke: dict) -> list[dict]:
    """A stroke's points, out of the flat six-a-point run the file keeps them in; see
    `packed` in packages/markdown/src/canvas.ts."""
    flat = stroke["points"]

    return [
        {
            "x": flat[at],
            "y": flat[at + 1],
            "pressure": flat[at + 2],
            "tiltX": flat[at + 3],
            "tiltY": flat[at + 4],
            "t": flat[at + 5],
        }
        for at in range(0, len(flat) - 5, 6)
    ]


def camera_of(page: Page) -> dict:
    """Where the plane is under the pane. A tab that has never been moved has no camera
    of its own yet, and the plane it is showing is the one at the origin."""
    return page.evaluate(
        "() => ({ x: 0, y: 0, scale: 1, ...(window.nibApp.workspace.active.camera ?? {}) })"
    )


def profile_of(page: Page) -> str:
    """What the app decided this device's pen is; see canvas/contacts.ts."""
    said = page.locator("[data-pointer]").first.inner_text()
    return said.split("//")[0].strip()


def tool(page: Page, key: str) -> None:
    """A tool taken with its own key. The plane has to have the keyboard for a bare
    letter to reach it, and a press on the plane is what gives it."""
    page.keyboard.press("Escape")
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    page.keyboard.press(key)
    page.wait_for_timeout(120)


ERASE_ALL = 'button[aria-label="Erase everything drawn"]'


def wipe(page: Page) -> None:
    """Everything drawn, gone, through the eraser's own popover.

    Not select-all and Delete, which is what the other drives use: the key for select-all
    is Cmd on an Apple platform and Ctrl everywhere else, and this drive is four platforms
    at once. And not by writing an empty canvas into the file either, which does not work:
    a plane somebody has been drawing on is merged with words that arrive under it rather
    than replaced by them, so the stroke comes straight back. See `follow` in
    canvas/store.svelte.ts."""
    page.keyboard.press("Escape")
    eraser = page.locator('.cluster button[aria-label="Erase"]').first

    # The first press may only be taking the eraser; pressing the tool you are already
    # holding is what opens its options.
    for _try in range(3):
        if page.locator(ERASE_ALL).count() > 0:
            break
        eraser.click()
        page.wait_for_timeout(250)

    page.locator(ERASE_ALL).first.click()
    page.keyboard.press("Escape")

    until = time.monotonic() + 6
    while time.monotonic() < until:
        if not ink_of(page):
            return
        page.wait_for_timeout(100)

    fail("the plane would not empty")


def settled(page: Page) -> None:
    """Long enough for a gesture that edits as it goes to be written down; see
    WRITE_DELAY in store.svelte.ts."""
    page.wait_for_timeout(1600)


def span_of(stroke: dict) -> float:
    """How far across the plane a stroke reaches. A stroke that took a phantom line
    with it from where the pen was last hovering is several times as wide as it should
    be, and that is the whole of what a hover must not do."""
    xs = [point["x"] for point in points_of(stroke)]

    return max(xs) - min(xs)


def line(page: Page, steps: int = 24, span: float = 240, down: float = 60) -> list[tuple[float, float]]:
    """A line across the middle of the plane, wobbling a little the way a hand does."""
    box = plane(page)
    x = box["x"] + box["width"] / 2 - span / 2
    y = box["y"] + box["height"] / 2 - down

    return [(x + span * at / (steps - 1), y + (at % 4) * 12) for at in range(steps)]


def pressed(buttons: int) -> str:
    """Which button the protocol should say changed, from the mask of what is held. The
    barrel button is the right one, the driver's lower button is often the middle one,
    and the nib is the left one - and the protocol has a name rather than a bit for it."""
    if buttons & 2:
        return "right"
    if buttons & 4:
        return "middle"

    return "left" if buttons else "none"


def pen_stroke(
    page: Page,
    cdp,
    points: list[tuple[float, float]],
    buttons: int = 1,
    halfway: int | None = None,
    pressure: float | None = None,
    tilt: tuple[float, float] = (0, 0),
    kind: str = "pen",
    pause: int = 8,
) -> None:
    """A stroke drawn with a real stylus, through the DevTools protocol.

    `pressure` fixed is what a pen with nothing to say about pressure reports; left out,
    the hand leans on the middle of the stroke and lifts off, which is what a hand does.
    `halfway` is what the buttons change to partway through - the gesture a hand makes
    when it presses the barrel while it is already writing."""

    def send(what: str, x: float, y: float, force: float, held: int, changed: str = "") -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": what,
                "x": x,
                "y": y,
                # Which button changed, which is not the same question as what is held: a
                # release holds nothing and still has to say what came up.
                "button": changed or pressed(held),
                "buttons": held,
                "clickCount": 1,
                "pointerType": kind,
                "force": force,
                "tiltX": tilt[0],
                "tiltY": tilt[1],
            },
        )

    first = points[0]
    send("mousePressed", first[0], first[1], pressure if pressure is not None else 0.4, buttons)

    held = buttons
    turn = len(points) // 2
    for at, (x, y) in enumerate(points[1:], start=1):
        if halfway is not None and at == turn:
            held = halfway
        share = at / (len(points) - 1)
        force = pressure if pressure is not None else 0.35 + 0.6 * (1 - abs(0.5 - share) * 2)
        send("mouseMoved", x, y, force, held)
        page.wait_for_timeout(pause)

    last = points[-1]
    # Nothing held any more, and the button that came up named: a release that says
    # "none" changed nothing, and the browser sends no `pointerup` for it at all.
    send("mouseReleased", last[0], last[1], 0, 0, pressed(held))
    page.wait_for_timeout(250)


def hover(page: Page, cdp, points: list[tuple[float, float]], buttons: int = 0) -> None:
    """A pen over the glass rather than on it: moves with nothing pressed, which every
    pen on the list reports and none of them means as ink."""
    for x, y in points:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseMoved",
                "x": x,
                "y": y,
                "button": "none",
                "buttons": buttons,
                "pointerType": "pen",
                "force": 0,
                "tiltX": 0,
                "tiltY": 0,
            },
        )
        page.wait_for_timeout(16)


# The two shapes the protocol cannot send, dispatched from inside the page: the eraser
# end, whose button is 5 and whose bit is 32, and a lean reported as an altitude and an
# azimuth, which is the only way WebKit reports one. Everything the page does with them
# after this line is the app's own.
RAW = """
([kind, points, over]) => {
  const host = document.querySelector('.canvas');
  const rect = host.getBoundingClientRect();

  for (const [at, point] of points.entries()) {
    const what = at === 0 ? 'pointerdown' : at === points.length - 1 ? 'pointerup' : 'pointermove';
    host.dispatchEvent(
      new PointerEvent(what, {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: 'pen',
        isPrimary: true,
        clientX: rect.left + point[0],
        clientY: rect.top + point[1],
        ...over,
        ...(what === 'pointerup' ? { button: 0, buttons: 0, pressure: 0 } : {}),
      }),
    );
  }

  return kind;
}
"""


def raw_stroke(page: Page, points: list[tuple[float, float]], over: dict, what: str) -> None:
    """A stroke of pointer events made in the page, for a shape the protocol has no
    field for. Same handlers, same reducer, same ink."""
    inside = plane(page)
    page.evaluate(
        RAW,
        [what, [(x - inside["x"], y - inside["y"]) for x, y in points], over],
    )
    page.wait_for_timeout(250)


def context_for(browser, shape: str, tablet: bool):
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        user_agent=AGENTS[shape],
        color_scheme="dark",
        has_touch=tablet,
        is_mobile=False,
        device_scale_factor=1,
    )
    if shape == "pencil":
        context.add_init_script(NO_COALESCING)

    return context


def drive_pencil(browser) -> None:
    """An Apple Pencil on an iPad: a gain of its own, a lean in radians, and a browser
    with neither of Chromium's two calls for getting more samples out of one event."""
    say("--- an Apple Pencil on an iPad ---")

    context = context_for(browser, "pencil", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[pencil] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "pencil", tablet=True)
        tool(page, "d")

        # Coarse on purpose: a tenth of the samples an S Pen reports, which is what a
        # browser with no coalescing hands over for the same word.
        pen_stroke(page, cdp, line(page, steps=9, span=300), pause=24)
        settled(page)

        drawn = ink_of(page)
        said = profile_of(page)
        say(f"the profile says: {said}")

        if "apple g0.8" not in said:
            fail(f"an iPad's pen is not read as a Pencil with its own gain ({said})")
        if "plain unguessed" not in said:
            fail(f"a browser with neither call is not read as having neither ({said})")
        if len(drawn) != 1:
            fail(f"a Pencil with no coalescing did not draw one stroke ({len(drawn)})")
        else:
            say(f"a coarse Pencil stroke landed, {len(points_of(drawn[0]))} samples long")
        shot(page, "pen-shape-pencil-stroke")

        # The lean, in the only language WebKit has for it: radians up from the glass and
        # radians round it. It has to arrive on the plane as the degrees the format keeps.
        wipe(page)
        tool(page, "d")
        raw_stroke(
            page,
            line(page, steps=8, span=260),
            {
                "button": 0,
                "buttons": 1,
                "pressure": 0.55,
                "tiltX": 0,
                "tiltY": 0,
                "altitudeAngle": 0.7853981633974483,
                "azimuthAngle": 0,
            },
            "a Pencil leaning halfway over",
        )
        settled(page)

        leaning = ink_of(page)
        if len(leaning) != 1:
            fail(f"a Pencil reporting its lean as two angles did not draw ({len(leaning)})")
        else:
            tilts = {point["tiltX"] for point in points_of(leaning[0])}
            if tilts != {45}:
                fail(f"an altitude of a quarter turn did not land as 45 degrees of tilt ({tilts})")
            else:
                say("a lean reported as an altitude and an azimuth landed as tilt")

        said = profile_of(page)
        if "spherical" not in said:
            fail(f"a lean reported in radians is not read as the spherical pair ({said})")
        else:
            say(f"the profile says: {said}")
        shot(page, "pen-shape-pencil-lean")

        # Hovering, which every M2 iPad's Pencil does. Nothing may appear, and the stroke
        # that follows must begin where the nib landed rather than where the pen was.
        check_hover(page, cdp, "pencil")

        # And the eraser, which a Pencil can only reach from the bar: it has no button.
        tool(page, "d")
        pen_stroke(page, cdp, line(page, steps=12, span=200))
        settled(page)
        before = len(ink_of(page))
        tool(page, "e")
        pen_stroke(page, cdp, line(page, steps=12, span=200))
        settled(page)

        if len(ink_of(page)) >= before:
            fail("the eraser off the bar rubbed nothing out for a pen with no button")
        else:
            say("the eraser off the bar rubs out, which is a Pencil's only way to")
        shot(page, "pen-shape-pencil-erased")
    finally:
        context.close()


def check_hover(page: Page, cdp, label: str) -> None:
    """A pen over the glass leaves nothing, and takes nothing with it when it lands.

    The two strokes are compared with each other rather than with a number, so the check
    holds at whatever zoom the canvas happens to be at: a stroke that dragged a phantom
    line in from where the pen was last hovering is several times as wide as its twin."""
    wipe(page)
    tool(page, "d")
    box = plane(page)

    pen_stroke(page, cdp, line(page, steps=14, span=200))
    settled(page)
    clean = ink_of(page)
    if len(clean) != 1:
        fail(f"[{label}] the stroke to compare a hover against never landed")
        return

    wipe(page)
    tool(page, "d")

    # Right across the plane with nothing pressed, then down where the other stroke was.
    hover(
        page,
        cdp,
        [
            (box["x"] + 40, box["y"] + 40),
            (box["x"] + 120, box["y"] + box["height"] - 80),
            (box["x"] + box["width"] - 60, box["y"] + 60),
        ],
    )

    if ink_of(page):
        fail(f"[{label}] a hovering pen drew on the plane")
    else:
        say(f"[{label}] a hovering pen leaves nothing")

    pen_stroke(page, cdp, line(page, steps=14, span=200))
    settled(page)
    after = ink_of(page)

    if len(after) != 1:
        fail(f"[{label}] the stroke after a hover did not land ({len(after)})")
    elif span_of(after[0]) > span_of(clean[0]) * 1.4:
        fail(
            f"[{label}] the stroke after a hover took a phantom line with it"
            f" ({span_of(after[0]):.0f} against {span_of(clean[0]):.0f})"
        )
    else:
        say(f"[{label}] a stroke after a hover begins where the nib landed")

    shot(page, f"pen-shape-{label}-after-hover")


def drive_surface(browser) -> None:
    """A Surface Pen, and every other pen on Windows: a barrel button, an eraser end, and
    a platform that reads a nib held still as a right click."""
    say("--- a Surface Pen on Windows ---")

    context = context_for(browser, "surface", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[surface] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "surface")
        tool(page, "d")

        pen_stroke(page, cdp, line(page), tilt=(-24, 8))
        settled(page)

        said = profile_of(page)
        say(f"the profile says: {said}")
        if "windows g1" not in said:
            fail(f"a pen on Windows is not read as one ({said})")
        if "coalesced predicted" not in said:
            fail(f"Chromium's two calls are not seen where they are there ({said})")
        if "tilt" not in said:
            fail(f"a pen leaning in degrees is not read as leaning in degrees ({said})")

        drawn = ink_of(page)
        if len(drawn) != 1:
            fail(f"a Surface Pen did not draw one stroke ({len(drawn)})")
        else:
            say("a Surface Pen stroke landed")
        shot(page, "pen-shape-surface-stroke")

        # The barrel button, pressed while the nib is already writing: the line that had
        # been laid down goes with it, so the plane is left as it was.
        wipe(page)
        tool(page, "d")
        pen_stroke(page, cdp, line(page), buttons=1, halfway=3)
        settled(page)
        if ink_of(page):
            fail("a barrel button pressed halfway through a line did not rub out")
        else:
            say("a barrel button pressed halfway through a line rubs out")

        # And the eraser end, turned over: button 5, bit 32. Unsendable down the protocol,
        # so the events are made in the page.
        wipe(page)
        tool(page, "d")
        pen_stroke(page, cdp, line(page))
        settled(page)
        if not ink_of(page):
            fail("nothing to rub out with the eraser end")

        raw_stroke(
            page,
            line(page),
            {"button": 5, "buttons": 32, "pressure": 0.5, "tiltX": 0, "tiltY": 0},
            "the eraser end",
        )
        settled(page)
        if ink_of(page):
            fail("a pen turned over onto its eraser end did not rub out")
        else:
            say("a pen turned over onto its eraser end rubs out")
        shot(page, "pen-shape-surface-erased")

        # A nib held still. Windows waits half a second and then asks for a right click;
        # no menu may open, and the stroke must carry on being a stroke.
        wipe(page)
        tool(page, "d")
        points = line(page, steps=10, span=160)
        pen_stroke(page, cdp, points[:5])
        page.wait_for_timeout(900)
        if page.locator(".menu-sheet, [role='menu']").count() > 0:
            fail("a menu opened under a nib held still")
        else:
            say("a nib held still opens no menu")

        # A barrel button held while hovering, which Windows also answers with a menu.
        hover(page, cdp, [(points[0][0] + 30, points[0][1] + 30)], buttons=2)
        page.wait_for_timeout(400)
        if page.locator(".menu-sheet, [role='menu']").count() > 0:
            fail("a menu opened under a hovering pen holding its barrel button")
        else:
            say("a barrel button held over the glass opens no menu")

        check_hover(page, cdp, "surface")
    finally:
        context.close()


def drive_wacom(browser) -> None:
    """A graphics tablet on a desktop: absolute, so the pen can be lifted and put down
    anywhere, and buttons the driver may have mapped to a mouse's."""
    say("--- a Wacom on a desktop ---")

    context = context_for(browser, "wacom", tablet=False)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[wacom] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "wacom")

        # The gesture only an absolute tablet makes: the nib lifted at one corner, moved
        # right across the tablet in the air, and put down at the other.
        check_hover(page, cdp, "wacom")

        # The middle button, which is what a driver puts the lower barrel button on out of
        # the box. It pans, with a pen in hand as much as with anything else.
        tool(page, "d")
        before = camera_of(page)
        box = plane(page)
        pen_stroke(
            page,
            cdp,
            [
                (box["x"] + box["width"] / 2 + step * 8, box["y"] + box["height"] / 2)
                for step in range(14)
            ],
            buttons=4,
        )
        page.wait_for_timeout(300)
        after = camera_of(page)

        if abs(after["x"] - before["x"]) < 10:
            fail(f"the middle button did not pan the plane ({before} to {after})")
        else:
            say("the middle button pans the plane with a pen in hand")
        shot(page, "pen-shape-wacom-panned")

        # And the same pen right-clicking, which is the other thing a driver does with a
        # barrel button. It rubs out.
        wipe(page)
        tool(page, "d")
        pen_stroke(page, cdp, line(page))
        settled(page)
        if not ink_of(page):
            fail("nothing to rub out with a right-clicking pen")

        pen_stroke(page, cdp, line(page), buttons=2)
        settled(page)
        if ink_of(page):
            fail("a pen reported as right-clicking did not rub out")
        else:
            say("a pen whose button the driver mapped to the right one rubs out")
    finally:
        context.close()


def drive_usi(browser) -> None:
    """A USI pen on a Chromebook: a pressure that never changes, which handed to a nib
    that thins with pressure would draw everything as a hairline."""
    say("--- a USI pen on a Chromebook ---")

    context = context_for(browser, "usi", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[usi] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "usi")
        tool(page, "d")

        # A fixed sliver near nought, which is the shape that draws a hairline.
        pen_stroke(page, cdp, line(page, steps=30, span=280), pressure=0.03)
        settled(page)

        said = profile_of(page)
        say(f"the profile says: {said}")
        if "chromeos" not in said:
            fail(f"a Chromebook's pen is not read as one ({said})")
        if "flat" not in said:
            fail(f"a pressure that never changes is still being believed ({said})")

        drawn = ink_of(page)
        if len(drawn) != 1:
            fail(f"a USI pen did not draw one stroke ({len(drawn)})")
        else:
            felt = {point["pressure"] for point in points_of(drawn[0])}
            # Not the sliver the pen reported: the middle of the range, which is the width
            # the nib is set to.
            if felt == {0.03}:
                fail("a pen's fixed sliver of pressure was drawn as pressure")
            else:
                say(f"a fixed sliver of pressure is ignored, and the ink is drawn at {felt}")
        shot(page, "pen-shape-usi-stroke")
    finally:
        context.close()


def drive_finger(browser) -> None:
    """A finger on glass that has seen a pen: the page moves and nothing is drawn, with
    an ink tool in hand. The rule every stylus app has and nobody has to be told."""
    say("--- a finger, on glass a pen has been on ---")

    context = context_for(browser, "surface", tablet=True)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[finger] page error: {error}"))
    cdp = context.new_cdp_session(page)

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "finger", tablet=True)
        tool(page, "d")

        pen_stroke(page, cdp, line(page, steps=14, span=200))
        settled(page)
        drawn = len(ink_of(page))
        if drawn != 1:
            fail(f"the pen that has to be seen first did not draw ({drawn})")

        before = camera_of(page)
        box = plane(page)
        page.touchscreen.tap(box["x"] + 60, box["y"] + 60)
        cdp.send(
            "Input.dispatchTouchEvent",
            {
                "type": "touchStart",
                "touchPoints": [{"x": box["x"] + 200, "y": box["y"] + 200}],
            },
        )
        for step in range(1, 12):
            cdp.send(
                "Input.dispatchTouchEvent",
                {
                    "type": "touchMove",
                    "touchPoints": [{"x": box["x"] + 200 + step * 14, "y": box["y"] + 200}],
                },
            )
            page.wait_for_timeout(16)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(400)

        after = camera_of(page)
        if len(ink_of(page)) != drawn:
            fail("a finger drew on glass that has had a pen on it")
        elif abs(after["x"] - before["x"]) < 10:
            fail(f"a finger did not move the page with an ink tool in hand ({before} to {after})")
        else:
            say("a finger moves the page and leaves no mark, with a pen in the bar")
        shot(page, "pen-shape-finger-panned")
    finally:
        context.close()


def main() -> int:
    shutil.rmtree(SHOTS, ignore_errors=True)
    build()
    server = serve()

    try:
        with sync_playwright() as playwright:
            # The machine's own Chrome, which is what Emil is looking at.
            browser = playwright.chromium.launch(channel="chrome")
            try:
                drive_pencil(browser)
                drive_surface(browser)
                drive_wacom(browser)
                drive_usi(browser)
                drive_finger(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nevery pen the drive could emulate behaves")
    return 0


if __name__ == "__main__":
    sys.exit(main())
