"""The pen bar a finger gets, photographed on a tablet and on a phone.

Everything here is the real thing: the built web app in a browser, a canvas made
through the workspace, and a stroke drawn with real pen events carrying real
pressure through the Chrome DevTools protocol. No Worker and no account: a plane
is a file in this browser's own storage, which is all a drawing needs.

What it photographs, in both themes and on both shapes of device:

    the bar, the pen popover, the eraser popover, the bar folded to its handle,
    the bar docked to the top edge, and a stroke drawn at a fifth of its opacity

It also measures the popover's row of colours: the eight that are always in it are
one row at whatever width the panel has, and each is still a round dot.

Run it from the repository root:

    python apps/desktop/test/e2e/pen-bar.py

It builds the app, serves it, drives the browser and stops everything again.
Nothing it makes outlives it but the screenshots, which go beside it under
`shots/`.

The app is built `--mode drive` on purpose, which is what leaves the app's
own stores reachable from the page: the device class is settled from the window
and there is no window on a desktop machine that is a tablet, so the test says
so directly rather than pretending to be Android well enough to fool the whole
Tauri bridge. Everything the bar itself does is real - real taps on real buttons,
and the ink read back off the plane.
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
SHOTS = HERE / "shots" / "pen-bar"
DIST = APP / "dist"

# Its own port, and never 1420, which is the dev server somebody may be using.
PORT = 18877
ORIGIN = f"http://127.0.0.1:{PORT}"

# What a phone and a tablet say about themselves, which is half of what decides
# the device class; the other half is the pointer, emulated with the context.
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    say("building the web app")
    # From nothing. A build over the last one leaves its chunks behind, and a
    # test that photographs yesterday's bar is worse than no test at all.
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A file server that says nothing and is never cached.

    Silent because its log is every asset the app loads and none of it is what
    this test is about. Uncached because a build names its chunks after their
    contents and a browser that already has one of those names will not ask for
    it again: a run against yesterday's bar that says everything is fine is the
    worst outcome this file has."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address.

    Windows reads `SO_REUSEADDR` as leave to bind a port somebody is already
    listening on, and the one still listening goes on answering: a second run
    then binds happily, serves nothing, and photographs the first run's build.
    Refusing the bind turns that into a message instead of an hour."""

    allow_reuse_address = False


def serve() -> tuple[Strict, threading.Thread]:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
    except OSError as error:
        raise SystemExit(f"something is already listening on {ORIGIN}: {error}") from error
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server, thread
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


# Written before any of the app's own scripts run.
#
# The os plugin's globals are what `platform()` reads, so anything in the app that
# asks which platform this is gets an answer; and the pen having been seen is what
# puts the finger switch in the pen's popover, which is one of the things being
# photographed. The device class itself is set from the page below: it is settled
# from the window, and no window on this machine is a tablet.
PREPARE = """
window.__TAURI_OS_PLUGIN_INTERNALS__ = {
  platform: 'android',
  family: 'unix',
  os_type: 'android',
  version: '15.0.0',
  arch: 'aarch64',
  exe_extension: '',
  eol: '\\n',
};
localStorage.setItem('nib:pen-seen', 'yes');
localStorage.setItem('nib:finger-draws', 'yes');
"""

# The row of colours in the pen's popover, measured as rows rather than looked at.
#
# Eight dots are always in it - the six the theme names, the bare dot that is the ink
# of the page, and the wheel behind which every other colour is - and they are one
# row at every width the panel takes. They were not: a dot was 40px in a row that
# wrapped, and the panel is `min(21rem, 100%)` less its padding, which is 320px, so
# seven fitted and the wheel went down alone - the one colour that is not one of the
# theme's own, orphaned. See `.colours` in CanvasColours.svelte.
#
# The circle is read off the pseudo-element that draws it rather than off the button,
# which is the cell: what has to stay round as the cells narrow is the dot.
COLOUR_ROWS = """
() => {
  const row = document.querySelector('.colours');
  if (!row) return { none: true };

  const dots = [...row.children].map((one) => {
    const box = one.getBoundingClientRect();
    const ink = getComputedStyle(one, '::after');
    return {
      name: one.getAttribute('aria-label') ?? one.title ?? '?',
      top: Math.round(box.top),
      cell: Math.round(box.width * 10) / 10,
      wide: Math.round(parseFloat(ink.width) * 10) / 10,
      tall: Math.round(parseFloat(ink.height) * 10) / 10,
    };
  });

  const tops = [...new Set(dots.map((one) => one.top))];
  const panel = row.parentElement.getBoundingClientRect();

  return {
    none: false,
    dots: dots.length,
    first: dots.slice(0, 8),
    rows: tops.map((top) => dots.filter((one) => one.top === top).length),
    panel: Math.round(panel.width),
    over: Math.round(row.getBoundingClientRect().right - panel.right),
  };
}
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

AS_PHONE = """
() => {
  const app = window.nibApp;
  app.viewport.device = 'phone';
  const root = document.documentElement;
  root.dataset.device = 'phone';
  root.toggleAttribute('data-touch', true);
  root.toggleAttribute('data-drawer', true);
  root.toggleAttribute('data-narrow', false);
}
"""


def opened(page: Page, label: str, device: str) -> None:
    """The app started, the device settled, and a fresh canvas open on it."""
    wait_for(page, "!!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "window.nibApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    page.evaluate(AS_TABLET if device == "tablet" else AS_PHONE)

    # Asked more than once if it has to be. The space arrives a moment before the
    # tree under it does, and a canvas asked for in that moment lands nowhere.
    opened_it = "window.nibApp.workspace.active?.path?.endsWith('.canvas')"
    for _try in range(4):
        page.evaluate("() => window.nibApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({opened_it})"):
            break
    else:
        raise SystemExit(f"[{label}] no canvas ever opened")
    # The bar is what everything after this presses.
    page.wait_for_selector('[aria-label="Move the bar"]', timeout=15000)
    page.wait_for_timeout(400)


def shot(page: Page, name: str) -> None:
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path))
    say(f"photographed {path.name}")


def pen_at(page: Page, index: int):
    """One of the pens in the row, by where it sits.

    `pen`, not `pen-slot`: the bar was rewritten into one bar for every device
    and the class went with it. See CanvasBar.svelte."""
    return page.locator(".cluster button.pen").nth(index)


def kept_pens(page: Page) -> list[str]:
    """Which pens the row holds, in the order it holds them."""
    return page.evaluate(
        "() => JSON.parse(localStorage.getItem('nib:pens')).pens.map((one) => one.tool)"
    )


def drag(page: Page, one, onto) -> None:
    """A pen held and then dragged onto another. The wait is the whole gesture:
    a finger that sets off at once is scrolling.

    Nothing should come of it now; it is driven so that the row going back to
    something you arrange would be noticed."""
    here = one.bounding_box()
    there = onto.bounding_box()
    assert here and there

    page.mouse.move(here["x"] + here["width"] / 2, here["y"] + here["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(600)
    page.mouse.move(there["x"] + there["width"] / 2, there["y"] + there["height"] / 2, steps=10)
    page.wait_for_timeout(150)
    page.mouse.up()
    page.wait_for_timeout(250)


def stroke(page, cdp, points: list[tuple[float, float]]) -> None:
    """A stroke drawn with a real stylus: pen events with pressure on them,
    which is the only way the ink pipeline can be exercised for what it does
    with pressure and with alpha."""

    def send(kind: str, x: float, y: float, force: float, buttons: int) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": kind,
                "x": x,
                "y": y,
                "button": "left",
                "buttons": buttons,
                "clickCount": 1,
                "pointerType": "pen",
                "force": force,
                "tiltX": 0,
                "tiltY": 0,
            },
        )

    first = points[0]
    send("mousePressed", first[0], first[1], 0.4, 1)
    for at, (x, y) in enumerate(points[1:], start=1):
        # Leaning on the middle of the stroke and lifting off, which is what a
        # hand does and what a pen that thins with pressure is for.
        share = at / (len(points) - 1)
        send("mouseMoved", x, y, 0.35 + 0.6 * (1 - abs(0.5 - share) * 2), 1)
        page.wait_for_timeout(8)

    last = points[-1]
    send("mouseReleased", last[0], last[1], 0, 0)
    page.wait_for_timeout(250)


def ink_of(page: Page) -> list[dict]:
    """What the plane holds, read off the open canvas rather than guessed at."""
    return page.evaluate(
        "() => JSON.parse(window.nibApp.workspace.active.doc).nib?.ink ?? []",
    )


def photograph(browser, theme: str, device: str, failures: list[str]) -> None:
    label = f"{device}/{theme}"
    say(f"--- {label} ---")

    tablet = device == "tablet"
    size = {"width": 1180, "height": 820} if tablet else {"width": 412, "height": 900}
    # The size alone is not a device: the class is decided from what the machine
    # says about itself and from the pointer, with the width only telling a phone
    # from a tablet. So each context carries the user agent that device sends; see
    # `deviceFor` in apps/desktop/src/lib/viewport.svelte.ts.
    context = browser.new_context(
        viewport=size,
        user_agent=TABLET_AGENT if tablet else PHONE_AGENT,
        color_scheme=theme,
        has_touch=True,
        is_mobile=True,
        device_scale_factor=2,
    )
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, label, device)

        # The bar as it stands, with a pen in hand.
        pen_at(page, 0).click()
        page.wait_for_timeout(350)
        shot(page, f"pen-bar-{device}-{theme}")

        # Pressing the pen that is already out opens its settings, and the line
        # across the top of them is drawn with that pen.
        pen_at(page, 0).click()
        page.wait_for_selector('input[aria-label="Opacity"]', timeout=5000)
        page.wait_for_timeout(300)
        shot(page, f"pen-settings-{device}-{theme}")

        # The row of colours in it: eight to a row, none of them orphaned, and every
        # dot still round as the cells share whatever width the panel has.
        rows = page.evaluate(COLOUR_ROWS)
        say(f"[{label}] the colours: {rows}")
        if rows["none"]:
            failures.append(f"{label}: the pen's popover has no row of colours")
        else:
            eight = rows["first"]
            if len(eight) < 8:
                failures.append(f"{label}: the row holds {len(eight)} dots rather than eight")
            elif len({one['top'] for one in eight}) != 1:
                failures.append(
                    f"{label}: the eight colours are not one row"
                    f" ({rows['rows']} per row, panel {rows['panel']}px)"
                )
            else:
                say(f"[{label}] eight colours on one row of {rows['panel']}px")

            if rows["over"] > 0:
                failures.append(f"{label}: the row runs {rows['over']}px past its panel")

            for one in eight:
                if abs(one["wide"] - one["tall"]) > 0.6:
                    failures.append(
                        f"{label}: the {one['name']!r} dot is {one['wide']}x{one['tall']}"
                        " rather than round"
                    )
                elif one["wide"] < 20:
                    failures.append(
                        f"{label}: the {one['name']!r} dot is down to {one['wide']}px"
                    )

        # A colour and an alpha, set with the dials rather than from the console.
        page.locator('[aria-label="Colour 4"]').first.click()
        opacity = page.locator('input[aria-label="Opacity"]')
        opacity.fill("0.2")
        opacity.dispatch_event("input")
        width = page.locator('input[aria-label="Width"]').first
        width.fill("9")
        width.dispatch_event("input")
        page.wait_for_timeout(300)
        shot(page, f"pen-settings-set-{device}-{theme}")

        set_to = page.evaluate("() => window.nibApp && localStorage.getItem('nib:pens')")
        if '"opacity":0.2' not in (set_to or ""):
            failures.append(f"{label}: the pen did not remember its alpha ({set_to})")

        # Out of the popover and draw with it.
        page.keyboard.press("Escape")
        page.locator(".canvas").first.click(position={"x": 40, "y": 40})
        page.wait_for_timeout(150)
        pen_at(page, 0).click()
        page.wait_for_timeout(250)

        middle = (size["width"] / 2, size["height"] / 2 - 60)
        stroke(
            page,
            cdp,
            [(middle[0] - 150 + step * 12, middle[1] + (step % 4) * 14) for step in range(26)],
        )

        drawn = ink_of(page)
        if not drawn:
            failures.append(f"{label}: the pen left nothing on the plane")
        elif drawn[0].get("opacity") != 0.2:
            failures.append(f"{label}: the stroke did not carry the alpha ({drawn[0]})")
        else:
            say(f"[{label}] the stroke landed at {drawn[0]['opacity']} of its colour")

        page.wait_for_timeout(200)
        shot(page, f"pen-stroke-faint-{device}-{theme}")

        # The eraser, and its own popover on a second press.
        eraser = page.locator('.cluster button[aria-label="Erase"]')
        eraser.click()
        page.wait_for_timeout(200)
        eraser.click()
        page.wait_for_selector('button[aria-label="Erase everything drawn"]', timeout=5000)
        page.wait_for_timeout(300)
        shot(page, f"eraser-settings-{device}-{theme}")

        # Folded away to its handle, which is what a landscape tablet wants.
        page.keyboard.press("Escape")
        page.locator(".canvas").first.click(position={"x": 40, "y": 40})
        page.locator('[aria-label="Move the bar"]').click()
        page.wait_for_selector('button[aria-label="The pens"]', timeout=5000)
        page.wait_for_timeout(350)
        shot(page, f"pen-bar-folded-{device}-{theme}")

        # Unfolded again, and one pen dragged along the row past another, which
        # must do nothing. The row used to be a row you arranged; it is three
        # fixed slots now - something to write with, something to sketch with,
        # something to mark with - because a row that grows is a row that
        # overflows and then it needs managing, which is not what anybody opened
        # a canvas to do. See PEN_SLOTS in canvas/pens.svelte.ts.
        page.locator('button[aria-label="The pens"]').click()
        page.wait_for_timeout(350)

        was = kept_pens(page)
        drag(page, pen_at(page, 0), pen_at(page, 2))
        now = kept_pens(page)
        if now != was:
            failures.append(f"{label}: dragging a pen rearranged the row ({was} to {now})")
        elif len(now) != 3:
            failures.append(f"{label}: the row holds {len(now)} pens rather than three: {now}")
        else:
            say(f"[{label}] the three slots stayed as they were: {now}")

        # And the whole bar dragged by its grip to the other edge.
        grip = page.locator('[aria-label="Move the bar"]')
        box = grip.bounding_box()
        assert box
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2, 90, steps=12)
        page.mouse.up()
        page.wait_for_timeout(400)

        docked = page.evaluate("() => JSON.parse(localStorage.getItem('nib:pens')).dock")
        if docked != "top":
            failures.append(f"{label}: the bar dragged upwards did not dock to the top ({docked})")

        pen_at(page, 0).click()
        page.wait_for_timeout(400)
        shot(page, f"pen-bar-docked-top-{device}-{theme}")

        # It comes back where it was left, which is the point of remembering.
        page.reload(wait_until="domcontentloaded")
        opened(page, label, device)
        if page.evaluate("() => JSON.parse(localStorage.getItem('nib:pens')).dock") != "top":
            failures.append(f"{label}: the bar did not come back against the top edge")

        # And the biro the dials were turned on is still the one they were turned
        # to, wherever the drag left it in the row. That is the whole point of
        # keeping a row of pens rather than one width the app shares.
        kept = page.evaluate(
            "() => JSON.parse(localStorage.getItem('nib:pens'))"
            "  .pens.find((one) => one.tool === 'pen')"
        )
        if kept.get("opacity") != 0.2 or kept.get("size") != 9 or kept.get("colour") != "4":
            failures.append(f"{label}: the pen was not the one it was left as ({kept})")
        else:
            say(f"[{label}] the pen came back set the way it was left")
    finally:
        context.close()


def main() -> int:
    if SHOTS.exists():
        shutil.rmtree(SHOTS, ignore_errors=True)
    SHOTS.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    build()
    server, thread = serve()

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                for device in ("tablet", "phone"):
                    for theme in ("light", "dark"):
                        photograph(browser, theme, device, failures)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
        say("everything stopped")

    if failures:
        print("\nwhat went wrong:", flush=True)
        for one in failures:
            print(f"  {one}", flush=True)
        return 1

    print(f"\nall of it held. the pictures are under {SHOTS}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
