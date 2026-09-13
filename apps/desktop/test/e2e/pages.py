"""Page notes driven for real: the paper, the pen on it, the navigator and the column.

Everything here is the real thing - the built web app in the machine's own Chrome, a
page note made through the workspace, and strokes sent as real pen events with pressure
through the DevTools protocol. No Worker and no account: a page note is a file in this
browser's own storage, which is all writing on paper needs.

What it checks and photographs:

    a new page note opens on one A4 page, fitted across the pane
    the paper stays across the pane when the sidebar narrows it, and a zoom the reader
      asked for is theirs until they ask for the paper back
    a stroke drawn with a pen lands on the page it was drawn on, in the file
    a finger draws on glass that has never seen a pen, and stops once one has - which
      is the palm rejection, and the one rule a page note must not have its own copy of
    a second finger landing while the nib is down leaves no mark at all
    the four rulings, photographed, in both themes
    the three papers, chosen from the page's own menu, and the paper a new page note
      starts on, which is a setting rather than A4 for everybody
    adding, reordering and deleting a page, and what reordering does to the ink on it
    a long page growing past A4 when writing reaches the bottom of it
    the page counter in the status bar, and the thumbnails in the outline panel's slot
    a PDF imported as a page note: every page drawn, on the sheet and in the panel,
      counted in pixels rather than taken on trust, and a page whose paper has gone
      saying so rather than coming out blank
    the file on disk: JSON Canvas, a group node per page, the ink under `nib`
    the same note renamed to `.canvas` still reading as the same pages
    the phone: the same bar, the pages in a column, no second interface

Run it from the repository root:

    python apps/desktop/test/e2e/pages.py

It builds the app, serves it, drives the browser and stops everything again. Nothing it
makes outlives it but the screenshots, which go beside it under `shots/`.

The app is built in development mode on purpose, which is what leaves the app's own
stores reachable from the page; see canvas-arrange.py, whose harness this is.
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
SHOTS = HERE / "shots" / "pages"
DIST = APP / "dist"

# Its own port, in the range this agent was given.
PORT = 23301
ORIGIN = f"http://127.0.0.1:{PORT}"

failures: list[str] = []


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def fail(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)


# What the page is allowed to say into the console without it being a failure. One entry,
# and it is about the app's own `index.html` rather than about anything here: Chrome
# ignores `frame-ancestors` in a `<meta>` policy and says so on every load. The directive
# is there for the header the published site serves; see the content policy commit.
FORGIVEN = ("frame-ancestors",)


def complain(label: str, message) -> None:
    """Every error the page reports is a failure but the ones above."""
    if message.type != "error":
        return
    if any(one in message.text for one in FORGIVEN):
        return

    fail(f"[{label}] console error: {message.text}")


def build() -> None:
    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
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
  app.viewport.portrait = true;
  const root = document.documentElement;
  root.dataset.device = 'phone';
  root.toggleAttribute('data-touch', true);
  root.toggleAttribute('data-drawer', true);
  root.toggleAttribute('data-narrow', true);
}
"""

# A glass that has never had a pen on it, which is where a finger draws. Written before
# the app starts, because the store reads it once on the way up; see hand.svelte.ts.
NO_PEN_YET = """
try { localStorage.setItem('nib:pen-seen', 'no') } catch {}
try { localStorage.setItem('nib:finger-draws', 'no') } catch {}
"""


def opened(page: Page, label: str, device: str | None = None) -> None:
    """The app started and a fresh page note open on it."""
    wait_for(page, "!!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "window.nibApp.workspace.spaces.length > 0", f"[{label}] a space to exist")

    if device == "tablet":
        page.evaluate(AS_TABLET)
    elif device == "phone":
        page.evaluate(AS_PHONE)

    # Asked more than once if it has to be: the space arrives a moment before the tree
    # under it does, and a note asked for in that moment lands nowhere.
    there = "window.nibApp.workspace.active?.path?.endsWith('.pages')"
    for _try in range(4):
        page.evaluate("() => window.nibApp.workspace.createPages()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({there})"):
            break
    else:
        raise SystemExit(f"[{label}] no page note ever opened")

    page.wait_for_selector(".pages", timeout=15000)
    page.wait_for_timeout(400)


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    path = SHOTS / f"{name}.png"
    page.screenshot(path=str(path))
    say(f"photographed {path.name}")


def surface(page: Page) -> dict:
    box = page.locator(".pages").first.bounding_box()
    assert box
    return box


def settled(page: Page) -> None:
    """Everything owing, written into the document now.

    The surface writes the file a pause after the changes stop - serialising the whole
    plane per stroke is the one thing it cannot afford - so a drive that reads the words
    straight after an edit reads the words from before it. `part` is the same call the
    surface makes when its tab closes."""
    page.evaluate("() => window.nibApp.pages.current?.store.part()")
    page.wait_for_timeout(250)


def file_of(page: Page) -> dict:
    """The note as the file holds it, read off the open note rather than guessed."""
    settled(page)
    return page.evaluate("() => JSON.parse(window.nibApp.workspace.active.doc)")


def pages_of(page: Page) -> list[dict]:
    """The pages as the surface has them, which is the file read back through the
    format: what the app is drawing, not what the JSON happens to say."""
    return page.evaluate(
        """() => {
          const held = window.nibApp.pages?.current
          return held ? held.store.pages.map((one) => ({
            id: one.id,
            y: one.y,
            width: one.width,
            height: one.height,
            paper: one.paper,
            pattern: one.pattern,
            file: one.file ?? null,
            page: one.page ?? null,
          })) : []
        }"""
    )


def panel_of(page: Page) -> str | None:
    """Which panel is open, so a check that wanted one can say what it got."""
    return page.evaluate("() => window.nibApp.workspace.panel")


def store_call(page: Page, call: str) -> None:
    """Something asked of the open note's own store, which is what a thumbnail, a menu
    row and a key all end up doing."""
    page.evaluate(f"() => {{ const s = window.nibApp.pages.current.store; {call} }}")
    page.wait_for_timeout(350)


def tool(page: Page, key: str) -> None:
    """A tool taken with its own key. The surface has to have the keyboard for a bare
    letter to reach it, and a press on the paper is what gives it."""
    page.keyboard.press("Escape")
    box = surface(page)
    page.mouse.click(box["x"] + 30, box["y"] + 30)
    page.keyboard.press(key)
    page.wait_for_timeout(120)


def stroke(
    page: Page,
    cdp,
    points: list[tuple[float, float]],
    kind: str = "pen",
    buttons: int = 1,
) -> None:
    """A stroke drawn with a real stylus, with pressure on it.

    `Input.dispatchMouseEvent` carries a `pointerType` of `mouse` or `pen` and nothing
    else, which is why a finger has a function of its own below: asking this one for a
    touch gets a mouse, and a mouse is allowed to draw where a palm is not - so the check
    would pass for the wrong reason."""
    if kind == "touch":
        finger(page, cdp, points)
        return

    def send(what: str, x: float, y: float, force: float, held: int) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": what,
                "x": x,
                "y": y,
                "button": "right" if held & 2 else "left",
                "buttons": held,
                "clickCount": 1,
                "pointerType": kind,
                "force": force,
                "tiltX": 0,
                "tiltY": 0,
            },
        )

    first = points[0]
    send("mousePressed", first[0], first[1], 0.4, buttons)
    for x, y in points[1:]:
        send("mouseMoved", x, y, 0.7, buttons)
        page.wait_for_timeout(8)

    last = points[-1]
    send("mouseReleased", last[0], last[1], 0, buttons)
    page.wait_for_timeout(300)


def finger(page: Page, cdp, points: list[tuple[float, float]]) -> None:
    """A stroke drawn with a real finger, through the protocol's own touch events - which
    is the only way to get a `pointerType` of `touch` into the page."""

    def send(what: str, at: list[tuple[float, float]]) -> None:
        cdp.send(
            "Input.dispatchTouchEvent",
            {
                "type": what,
                "touchPoints": [
                    {"x": x, "y": y, "id": 1, "force": 0.5} for x, y in at
                ],
            },
        )

    send("touchStart", [points[0]])
    for one in points[1:]:
        send("touchMove", [one])
        page.wait_for_timeout(8)

    send("touchEnd", [])
    page.wait_for_timeout(300)


def ink_count(page: Page) -> int:
    return page.evaluate("() => window.nibApp.pages.current.store.canvas.ink.length")


def check_opens(page: Page, label: str) -> None:
    """Item 1: a new page note is one A4 page, fitted across the pane."""
    say("--- the first page ---")

    pages = pages_of(page)
    if len(pages) != 1:
        fail(f"[{label}] a new page note has {len(pages)} pages rather than one")
        return

    one = pages[0]
    if (one["width"], one["height"]) != (794, 1123):
        fail(f"[{label}] the first page is {one['width']}x{one['height']} rather than A4")
    if one["pattern"] != "blank":
        fail(f"[{label}] the first page is ruled {one['pattern']} rather than blank")
    if one["y"] != 0:
        fail(f"[{label}] the first page starts at y={one['y']} rather than the origin")

    # Fitted across the paper with a margin, which is what a page note opens as.
    scale = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    box = surface(page)
    wanted = (box["width"] - 56) / 794
    if abs(scale - wanted) > 0.02:
        fail(f"[{label}] the view opened at {scale:.3f} rather than fitted ({wanted:.3f})")

    if page.locator(".pages .sheet").count() != 1:
        fail(f"[{label}] one page, {page.locator('.pages .sheet').count()} sheets drawn")

    shot(page, f"{label}-one-page")


def check_refits(page: Page, label: str) -> None:
    """The paper stays across the pane when the pane changes width, until somebody zooms.

    This is what a sheet of paper means and what every PDF viewer does. It is also the
    bug this check was written for: the sidebar opening narrowed the pane by three
    hundred pixels and the page kept the scale it had been fitted at, so a third of the
    paper was off the side of the view with no way to know it was there."""
    say("--- the paper stays across the pane ---")

    was = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(800)

    narrowed = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { scale: s.camera.scale, width: s.pane.width, widest: s.widest }
        }"""
    )

    # The paper, plus its two margins, inside the pane it is now in.
    across = narrowed["widest"] * narrowed["scale"]
    if across > narrowed["width"]:
        fail(
            f"[{label}] the page is {across:.0f}px across a {narrowed['width']:.0f}px pane "
            f"after the sidebar opened (was {was:.3f}, now {narrowed['scale']:.3f})"
        )

    shot(page, f"{label}-refitted")

    # And a zoom the reader asked for is theirs: the pane changing must not take it away.
    store_call(page, "s.zoomBy(2)")
    theirs = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    page.evaluate("() => { window.nibApp.workspace.panel = null }")
    page.wait_for_timeout(800)

    still = page.evaluate("() => window.nibApp.pages.current.store.camera.scale")
    if abs(still - theirs) > 0.001:
        fail(f"[{label}] a zoom the reader chose was taken away by a resize ({theirs} -> {still})")

    # Until they ask for the paper back, which hands the fitting over again.
    store_call(page, "s.fitAgain()")
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(800)

    after = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { scale: s.camera.scale, width: s.pane.width, widest: s.widest }
        }"""
    )
    if after["widest"] * after["scale"] > after["width"]:
        fail(f"[{label}] Fit did not hand the fitting back")

    page.evaluate("() => { window.nibApp.workspace.panel = null }")
    page.wait_for_timeout(500)


def check_pen(page: Page, cdp, label: str) -> None:
    """Item 2: a stroke drawn with a pen lands on the page, in the file."""
    say("--- a stroke on the paper ---")

    tool(page, "d")
    box = surface(page)
    middle = box["x"] + box["width"] / 2

    before = ink_count(page)
    stroke(
        page,
        cdp,
        [(middle - 120 + n * 12, box["y"] + 200 + (n % 4) * 9) for n in range(22)],
    )
    after = ink_count(page)

    if after != before + 1:
        fail(f"[{label}] a pen stroke left {after - before} strokes rather than one")
        return

    # And it is on the first page, which is what the format has to be able to say.
    first = pages_of(page)[0]
    on = page.evaluate(
        """(box) => {
          const ink = window.nibApp.pages.current.store.canvas.ink
          const one = ink[ink.length - 1]
          const at = one.points[0]
          return at.x >= box.x && at.x <= box.x + box.width
            && at.y >= box.y && at.y <= box.y + box.height
        }""",
        {"x": -397, "y": first["y"], "width": first["width"], "height": first["height"]},
    )
    if not on:
        fail(f"[{label}] the stroke did not land on the page it was drawn on")

    # Pressure reached the file, which is the whole reason a pen is not a mouse.
    varied = page.evaluate(
        """() => {
          const ink = window.nibApp.pages.current.store.canvas.ink
          const one = ink[ink.length - 1]
          return new Set(one.points.map((p) => p.pressure)).size
        }"""
    )
    if varied < 2:
        fail(f"[{label}] the stroke carries {varied} pressure(s): the nib was not felt")

    shot(page, f"{label}-a-stroke")


def check_gutter(page: Page, cdp, label: str) -> None:
    """A press between two pages writes nothing: there is no paper there."""
    say("--- the gutter ---")

    pages = pages_of(page)
    if len(pages) < 2:
        say("only one page: the gutter check needs two, skipped")
        return

    # The middle of the gutter put at the middle of the view, which is what the camera
    # names: a stroke drawn across the middle of the pane is then a stroke on no paper.
    middle_of_gutter = pages[0]["height"] + 20
    store_call(page, f"s.camera = s.held({{ ...s.camera, y: {middle_of_gutter} }})")

    # And only if the view is close enough in that the gutter fills the middle of it: at a
    # zoom where a whole page is on screen there is paper either side of the nib.
    fits = page.evaluate(
        """(gutter) => {
          const s = window.nibApp.pages.current.store
          const down = s.pane.height / s.camera.scale
          return Math.abs(s.camera.y - gutter) < 1 && down < 40
        }""",
        middle_of_gutter,
    )
    if not fits:
        store_call(page, "s.camera = s.held({ ...s.camera, scale: 4 })")
        store_call(page, f"s.camera = s.held({{ ...s.camera, y: {middle_of_gutter} }})")

    where = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { y: s.camera.y, scale: s.camera.scale, down: s.pane.height / s.camera.scale }
        }"""
    )
    box = surface(page)
    tool(page, "d")

    before = ink_count(page)
    stroke(
        page,
        cdp,
        [(box["x"] + box["width"] / 2 + n, box["y"] + box["height"] / 2) for n in range(14)],
    )
    if ink_count(page) != before:
        fail(
            f"[{label}] a stroke in the gutter left ink where there is no paper "
            f"(view at y={where['y']:.0f}, {where['down']:.0f} units tall)"
        )

    shot(page, f"{label}-gutter")


def check_palm(page: Page, cdp, label: str) -> None:
    """The one rule a page note must not have its own copy of: a finger draws on glass
    that has never seen a pen, and stops being a nib once one has been on it."""
    say("--- two hands and a pen ---")

    seen = page.evaluate("() => window.nibApp.canvasHand?.penSeen ?? null")
    if seen is None:
        say("the hand store is not reachable from the page; checking through the surface")

    tool(page, "d")
    box = surface(page)
    middle = box["x"] + box["width"] / 2

    # A pen has already been on this glass in this drive, so the finger must not draw.
    before = ink_count(page)
    stroke(
        page,
        cdp,
        [(middle - 60 + n * 8, box["y"] + 420) for n in range(12)],
        kind="touch",
    )
    if ink_count(page) != before:
        fail(f"[{label}] a finger drew on glass that has had a pen on it")

    # And a finger landing while the nib is down leaves nothing at all.
    cdp.send(
        "Input.dispatchMouseEvent",
        {
            "type": "mousePressed",
            "x": middle,
            "y": box["y"] + 500,
            "button": "left",
            "buttons": 1,
            "clickCount": 1,
            "pointerType": "pen",
            "force": 0.5,
        },
    )
    page.wait_for_timeout(30)
    was = ink_count(page)
    stroke(
        page,
        cdp,
        [(middle + 100 + n * 8, box["y"] + 500) for n in range(10)],
        kind="touch",
    )
    cdp.send(
        "Input.dispatchMouseEvent",
        {
            "type": "mouseReleased",
            "x": middle,
            "y": box["y"] + 500,
            "button": "left",
            "buttons": 0,
            "clickCount": 1,
            "pointerType": "pen",
            "force": 0,
        },
    )
    page.wait_for_timeout(300)

    # The pen's own dot is allowed; the palm's stroke is not, so at most one arrived.
    if ink_count(page) > was + 1:
        fail(f"[{label}] a palm left a mark while the nib was down")

    shot(page, f"{label}-palm")


def check_finger_draws(browser, label: str) -> None:
    """And the other half: on glass that has never had a pen, the finger is the nib,
    because on a phone nothing else can be."""
    say("--- a finger on glass with no pen ---")

    context = browser.new_context(
        viewport={"width": 1280, "height": 860}, device_scale_factor=1
    )
    context.add_init_script(PREPARE)
    context.add_init_script(NO_PEN_YET)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[{label}] page error: {error}"))
    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, label, device="tablet")

        tool(page, "d")
        box = surface(page)
        middle = box["x"] + box["width"] / 2

        before = ink_count(page)
        stroke(
            page,
            cdp,
            [(middle - 80 + n * 10, box["y"] + 240 + (n % 3) * 8) for n in range(16)],
            kind="touch",
        )
        if ink_count(page) != before + 1:
            fail(f"[{label}] a finger did not draw on glass that has never had a pen")

        shot(page, f"{label}-finger-draws")
    finally:
        context.close()


def check_rulings(page: Page, label: str) -> None:
    """The four rulings, drawn on real sheets, photographed."""
    say("--- the four rulings ---")

    for pattern in ("blank", "lines", "grid", "dots"):
        page.evaluate(
            """(pattern) => {
              const s = window.nibApp.pages.current.store
              const first = s.pages[0]
              s.edit({
                ...s.canvas,
                nodes: s.canvas.nodes.map((node) =>
                  node.id === first.id ? { ...node, pattern } : node,
                ),
              })
            }""",
            pattern,
        )
        page.wait_for_timeout(250)

        held = pages_of(page)[0]["pattern"]
        if held != pattern:
            fail(f"[{label}] a page asked for {pattern} is ruled {held}")

        shot(page, f"{label}-ruling-{pattern}")


def check_adding(page: Page, label: str) -> None:
    """Adding, reordering and deleting a page, and what reordering does to the ink."""
    say("--- adding, reordering, deleting ---")

    was = len(pages_of(page))

    # The navigator's own Add a page, which is the row somebody presses. The panel is
    # opened through the workspace's own setter, then waited for: it slides in.
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(700)

    add = page.locator(".navigator .add")
    if add.count() < 1:
        shot(page, f"{label}-no-navigator")
        fail(f"[{label}] the navigator has no Add a page (panel is {panel_of(page)!r})")
        return

    add.click()
    page.wait_for_timeout(500)

    pages = pages_of(page)
    if len(pages) != was + 1:
        fail(f"[{label}] Add a page made {len(pages) - was} pages")
        return

    # The column: the second page starts a gutter below the first.
    if pages[1]["y"] != pages[0]["height"] + 40:
        fail(f"[{label}] the second page sits at y={pages[1]['y']}, not one gutter down")

    thumbs = page.locator(".navigator .page").count()
    if thumbs != len(pages):
        fail(f"[{label}] {len(pages)} pages, {thumbs} thumbnails")

    shot(page, f"{label}-navigator")

    # Ink onto the second page, then the second page moved to the front: the ink has to
    # go with it, which is what makes this a reorder and not a shuffle of empty sheets.
    second = pages[1]
    page.evaluate(
        """(page) => {
          const s = window.nibApp.pages.current.store
          s.edit({
            ...s.canvas,
            ink: [...s.canvas.ink, {
              id: 'driven',
              tool: 'pen',
              color: '1',
              size: 3,
              points: [
                { x: 0, y: page.y + 40, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 },
                { x: 80, y: page.y + 60, pressure: 0.6, tiltX: 0, tiltY: 0, t: 8 },
              ],
            }],
          })
        }""",
        second,
    )
    page.wait_for_timeout(300)

    store_call(page, "s.turnTo(2)")
    shot(page, f"{label}-second-page")

    before_y = page.evaluate(
        "() => window.nibApp.pages.current.store.canvas.ink.find((o) => o.id === 'driven').points[0].y"
    )

    # The drag's own drop: the second thumbnail dragged above the first, which is the
    # gesture, through the navigator's own handlers rather than round them.
    rows = page.locator(".navigator .page")
    if rows.count() < 2:
        fail(f"[{label}] fewer than two thumbnails to drag between")
        return

    rows.nth(1).drag_to(rows.nth(0), target_position={"x": 20, "y": 4})
    page.wait_for_timeout(500)

    after = pages_of(page)
    if after[0]["id"] != second["id"]:
        fail(f"[{label}] the page moved to the front is not at the front")

    after_y = page.evaluate(
        "() => window.nibApp.pages.current.store.canvas.ink.find((o) => o.id === 'driven').points[0].y"
    )
    if after_y >= before_y:
        fail(f"[{label}] the ink did not move with its page ({before_y} -> {after_y})")

    shot(page, f"{label}-reordered")


def check_papers(page: Page, label: str) -> None:
    """The three papers, chosen from the page's own menu, and the one a new note starts on.

    Through the menu rather than the store, because a row somebody can press is the whole
    of what was missing: `reshaped` could always change a page's paper and nothing in the
    app ever asked it to. The row for the paper the page already wears is disabled, the
    way the rulings are.

    A page note used to start on A4 whatever anybody said, which is wrong in North
    America and wrong for anybody taking notes in a lecture, so the setting is driven
    too: it is set, a note is made, and the note is the size it asked for.
    """
    say("--- the three papers ---")

    # A page note of its own, so this check does not care what the ones above left open
    # and they do not care what it makes.
    page.evaluate("async () => window.nibApp.workspace.createPages(undefined, 'Papers.pages')")
    page.wait_for_timeout(900)
    page.wait_for_selector(".pages", timeout=15000)

    held = pages_of(page)
    if not held:
        fail(f"[{label}] no page note opened for the paper check")
        return

    first = held[0]

    for paper, width in (("letter", 816), ("long", 794), ("a4", 794)):
        rows = paper_menu(page, 0)
        if not rows:
            fail(f"[{label}] the page menu has no rows at all")
            return

        wanted = {"letter": "Letter", "long": "Long page", "a4": "A4"}[paper]
        if wanted not in rows:
            fail(f"[{label}] the page menu offers no {wanted!r} row: {rows}")
            return

        pressed = press_menu(page, wanted)
        if not pressed:
            fail(f"[{label}] the {wanted!r} row could not be pressed")
            return

        held = pages_of(page)[0]
        if held["paper"] != paper:
            fail(f"[{label}] a page asked for {paper} says {held['paper']}")
        if held["width"] != width:
            fail(f"[{label}] a {paper} page is {held['width']} wide rather than {width}")
        say(f"[{label}] {wanted}: {held['width']}x{held['height']}, called {held['paper']}")

        # The row for the paper it now wears says so by being disabled, which is this
        # menu's way of showing what is already on.
        again = paper_menu(page, 0, disabled=True)
        if wanted not in again:
            fail(f"[{label}] the {wanted!r} row is offered again on a page that is {paper}")

    if first["id"] != pages_of(page)[0]["id"]:
        fail(f"[{label}] changing the paper made a different page")

    shot(page, f"{label}-papers")

    # And what a new page note starts on, which is a setting rather than A4 for everyone.
    made = page.evaluate(
        """async (paper) => {
          const app = window.nibApp
          app.modes.setPagesPaper(paper)
          await app.workspace.createPages(undefined, 'On Letter.pages')
          await new Promise((resolve) => setTimeout(resolve, 700))
          const store = app.pages.current?.store
          const first = store?.pages[0]
          return first ? { paper: first.paper, width: first.width, kept: app.modes.pagesPaper } : null
        }""",
        "letter",
    )
    if not made:
        fail(f"[{label}] no page note was made for the default-paper check")
    else:
        if made["kept"] != "letter":
            fail(f"[{label}] the setting did not keep Letter: {made}")
        if made["paper"] != "letter" or made["width"] != 816:
            fail(f"[{label}] a new page note ignored the setting: {made}")
        else:
            say(f"[{label}] a new page note on the chosen paper: {made}")

    shot(page, f"{label}-new-on-letter")
    page.evaluate("() => window.nibApp.modes.setPagesPaper('a4')")


def paper_menu(page: Page, at: int, disabled: bool = False) -> list[str]:
    """The rows of the menu on one thumbnail, by label.

    `disabled` asks for the greyed-out ones instead, which is how this menu says a row
    would do nothing: there are no ticks in it.
    """
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(500)

    thumb = page.locator(".navigator .page").nth(at)
    if thumb.count() < 1:
        return []

    thumb.click(button="right")
    page.wait_for_timeout(350)

    which = "[role=menuitem][disabled]" if disabled else "[role=menuitem]:not([disabled])"
    rows = page.locator(f"[role=menu] {which}")
    out = [rows.nth(one).inner_text().strip() for one in range(rows.count())]
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    return out


def press_menu(page: Page, label: str) -> bool:
    """One row of the page menu, pressed the way somebody presses it."""
    thumb = page.locator(".navigator .page").first
    thumb.click(button="right")
    page.wait_for_timeout(350)

    row = page.locator("[role=menu] [role=menuitem]", has_text=label).first
    if row.count() < 1:
        page.keyboard.press("Escape")
        return False

    row.click()
    page.wait_for_timeout(450)
    return True


def check_counter(page: Page, label: str) -> None:
    """The page counter in the status bar, which shows unasked."""
    say("--- the page counter ---")

    count = len(pages_of(page))
    store_call(page, "s.turnTo(1)")

    # The bar itself first. It was once left out over a page note - the kind was
    # put in with the graph and a canvas, which have nothing for a bar to say -
    # and the counter went with it, silently: this is the only place it is drawn,
    # and a reader scrolling a stack of paper cannot guess which page they are on.
    # See hasStatusBar in regions.ts.
    bar = page.evaluate(
        """() => {
          const bar = document.querySelector('footer[data-region="status"], footer')
          if (!bar) return null
          const box = bar.getBoundingClientRect()
          const counter = bar.querySelector('.page')
          const spot = counter?.getBoundingClientRect()
          return {
            bar: { top: Math.round(box.top), height: Math.round(box.height) },
            counter: spot ? { top: Math.round(spot.top), width: Math.round(spot.width) } : null,
            inside: window.innerHeight,
          }
        }"""
    )
    if bar is None:
        fail(f"[{label}] there is no status bar over a page note, so no page counter either")
    else:
        if bar["counter"] is None:
            fail(f"[{label}] the status bar over a page note has no page counter in it")
        elif bar["counter"]["width"] < 8 or bar["counter"]["top"] > bar["inside"]:
            fail(f"[{label}] the page counter is not in view: {bar}")
        say(f"[{label}] the bar and its counter: {bar}")

    said = page.locator("footer .page").inner_text() if page.locator("footer .page").count() else ""

    if said.replace(" ", "") != f"1/{count}":
        fail(f"[{label}] the bar says {said!r} rather than 1 / {count}")

    if count > 1:
        store_call(page, f"s.turnTo({count})")
        said = page.locator("footer .page").inner_text()
        if said.replace(" ", "") != f"{count}/{count}":
            fail(f"[{label}] turned to the last page the bar says {said!r}")

    shot(page, f"{label}-counter")


def check_long_page(page: Page, label: str) -> None:
    """A long page grows past A4 when writing reaches the bottom of it; A4 never does."""
    say("--- the page that grows ---")

    page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          const first = s.pages[0]
          s.edit({
            ...s.canvas,
            nodes: s.canvas.nodes.map((node) =>
              node.id === first.id ? { ...node, paper: 'long' } : node,
            ),
          })
        }"""
    )
    page.wait_for_timeout(300)

    tall = pages_of(page)[0]["height"]

    # A stroke near the bottom of it, which is what makes it grow.
    page.evaluate(
        """(tall) => {
          const s = window.nibApp.pages.current.store
          s.edit({
            ...s.canvas,
            ink: [...s.canvas.ink, {
              id: 'deep',
              tool: 'pen',
              color: '1',
              size: 3,
              points: [{ x: 0, y: tall - 40, pressure: 0.5, tiltX: 0, tiltY: 0, t: 0 }],
            }],
          })
        }""",
        tall,
    )
    page.wait_for_timeout(400)

    grown = pages_of(page)[0]["height"]
    if grown <= tall:
        fail(f"[{label}] a long page did not grow ({tall} -> {grown})")
    elif (grown - tall) % 600 != 0:
        fail(f"[{label}] a long page grew by {grown - tall}, not in whole screenfuls")

    shot(page, f"{label}-long-page")


def check_file(page: Page, label: str) -> None:
    """The file on disk: JSON Canvas, a spec node per page, the ink under `nib`."""
    say("--- the file ---")

    written = file_of(page)
    pages = pages_of(page)

    if "nodes" not in written or "edges" not in written:
        fail(f"[{label}] the file is not JSON Canvas: {sorted(written)}")
        return

    kinds = {node["type"] for node in written["nodes"]}
    if not kinds <= {"group", "file", "text", "link"}:
        fail(f"[{label}] the file holds a node type the spec does not name: {kinds}")

    records = written.get("nib", {}).get("pages", [])
    if len(records) != len(pages):
        fail(f"[{label}] {len(pages)} pages, {len(records)} records under nib.pages")

    ids = {node["id"] for node in written["nodes"]}
    for record in records:
        if record["id"] not in ids:
            fail(f"[{label}] a page record names no node: {record['id']}")

    if written.get("nib", {}).get("ink") is None and page.evaluate(
        "() => window.nibApp.pages.current.store.canvas.ink.length > 0"
    ):
        fail(f"[{label}] there is ink on the pages and none under nib.ink")

    say(f"the file holds {len(records)} pages and {len(written['nodes'])} nodes")


def check_as_canvas(page: Page, label: str) -> None:
    """The same file opened as a canvas: the escape hatch this format is for.

    A page note renamed to `.canvas` is what Obsidian opens, so the app has to agree:
    the very same bytes, opened by the canvas surface, have to come up with the same
    cards and the same ink rather than with nothing. Driven by writing the note's own
    text into a `.canvas` file and opening it."""
    say("--- the same file as a canvas ---")

    held = page.evaluate(
        """() => {
          const s = window.nibApp.pages.current.store
          return { nodes: s.canvas.nodes.length, ink: s.canvas.ink.length, pages: s.pages.length }
        }"""
    )

    settled(page)
    before = file_of(page)

    # Renamed through the app's own rename, which is what somebody would do.
    renamed = page.evaluate(
        """async () => {
          const workspace = window.nibApp.workspace
          const path = workspace.active?.path
          if (!path) return null

          await workspace.rename(path, 'As a canvas.canvas')
          return workspace.active?.path ?? null
        }"""
    )
    page.wait_for_timeout(900)

    if renamed is None or not renamed.endswith(".canvas"):
        fail(f"[{label}] the note did not rename to a canvas ({renamed!r})")
        return

    kind = page.evaluate("() => window.nibApp.workspace.active?.kind ?? null")
    if kind != "canvas":
        # The tab may still be the page note's until it is reopened, which is itself
        # worth knowing rather than worth hiding.
        say(f"the renamed file is still open as {kind!r}; reopening it")
        page.evaluate("async (path) => window.nibApp.workspace.openEntry(path)", renamed)
        page.wait_for_timeout(800)
        kind = page.evaluate("() => window.nibApp.workspace.active?.kind ?? null")

    if kind != "canvas":
        fail(f"[{label}] a renamed page note opens as {kind!r} rather than a canvas")
        return

    after = file_of(page)
    if after != before:
        fail(f"[{label}] the bytes changed when the file became a canvas")
    else:
        say(f"the same bytes either way: {held['pages']} pages, {held['ink']} strokes")

    # And the canvas surface has the cards and the ink, not an empty plane.
    drawn = page.evaluate(
        """() => {
          const written = JSON.parse(window.nibApp.workspace.active.doc)
          return { nodes: written.nodes.length, ink: (written.nib?.ink ?? []).length }
        }"""
    )
    if drawn["ink"] != held["ink"]:
        fail(f"[{label}] as a canvas the ink is {drawn['ink']}, as pages it was {held['ink']}")

    page.wait_for_selector(".canvas", timeout=10000)
    shot(page, f"{label}-as-a-canvas")


def paper_bytes(sizes: list[tuple[float, float]]) -> str:
    """A PDF of `sizes` pages, each with a black block on it, as base64.

    Written out here rather than kept as a fixture, the way search.py writes its own:
    a drive that makes its own paper cannot drift from the paper it opens. The block is
    what the checks below count - a page that drew is a page with dark pixels on it -
    and it is inset from the edge so the count is about the paper and not about the
    sheet's own border.
    """
    import base64

    objects: list[str] = []
    kids = " ".join(f"{3 + at * 2} 0 R" for at in range(len(sizes)))
    objects.append("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj")
    objects.append(f"2 0 obj<</Type/Pages/Kids[{kids}]/Count {len(sizes)}>>endobj")

    for at, (wide, tall) in enumerate(sizes):
        page = 3 + at * 2
        stream = f"0 0 0 rg 40 40 {wide - 80:.0f} {tall - 80:.0f} re f"
        objects.append(
            f"{page} 0 obj<</Type/Page/Parent 2 0 R"
            f"/MediaBox[0 0 {wide:.2f} {tall:.2f}]/Contents {page + 1} 0 R>>endobj"
        )
        objects.append(f"{page + 1} 0 obj<</Length {len(stream)}>>stream\n{stream}\nendstream\nendobj")

    body = "\n".join(
        ["%PDF-1.4", *objects, f"trailer<</Root 1 0 R/Size {2 + len(sizes) * 2 + 1}>>", "%%EOF"]
    )

    return base64.b64encode(body.encode("latin-1")).decode("ascii")


# A PDF handed to the app's own import, which is the road a reader takes: File ▸ Import,
# one paper picked. The import makes a folder of its own named after the paper, so the
# note and the paper land one folder down from the space's root - which is exactly the
# case that was broken, because a page's `file` is the paper's bare name and nothing
# above resolved it against the note's own folder.
IMPORT_PAPER = """
async ({ base64, name }) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  const importing = window.nibApp.importing
  importing.show()
  importing.root = window.nibApp.workspace.activeSpace.root
  await importing.take([new File([bytes], name, { type: 'application/pdf' })])

  const format = importing.format
  const said = importing.error
  if (format !== 'pdf-pages') return { format, error: said }

  await importing.run()
  importing.close()
  await window.nibApp.workspace.loadTree()

  return { format, error: importing.error, stage: importing.stage, folder: importing.folder }
}
"""

# How much of a sheet is not the colour of the sheet.
#
# Read off the canvas the page draws its paper onto, at the size the canvas holds
# rather than at the size it is shown: what is asked is whether the paper was drawn at
# all, and a blank sheet answers nought however big it is on screen.
DARK_ON_SHEETS = """
() => {
  const out = []
  for (const sheet of document.querySelectorAll('.sheet canvas')) {
    const context = sheet.getContext('2d', { willReadFrequently: true })
    if (!context || !sheet.width || !sheet.height) {
      out.push({ width: sheet.width, height: sheet.height, dark: 0 })
      continue
    }

    const data = context.getImageData(0, 0, sheet.width, sheet.height).data
    let dark = 0
    // Every fortieth pixel, which is thousands of them on a page and quick enough to
    // ask for on every sheet in the note.
    for (let at = 0; at < data.length; at += 160) {
      if (data[at + 3] > 8 && data[at] < 100 && data[at + 1] < 100 && data[at + 2] < 100) dark++
    }

    out.push({ width: sheet.width, height: sheet.height, dark })
  }
  return out
}
"""

# And the same question of the thumbnails in the outline panel, which draw the paper
# through the same one reader.
DARK_ON_THUMBS = """
() => {
  const out = []
  for (const thumb of document.querySelectorAll('.navigator .page canvas')) {
    const context = thumb.getContext('2d', { willReadFrequently: true })
    if (!context || !thumb.width || !thumb.height) continue

    const data = context.getImageData(0, 0, thumb.width, thumb.height).data
    let dark = 0
    for (let at = 0; at < data.length; at += 40) {
      if (data[at + 3] > 8 && data[at] < 100 && data[at + 1] < 100 && data[at + 2] < 100) dark++
    }

    out.push({ width: thumb.width, height: thumb.height, dark })
  }
  return out
}
"""


def check_paper(page: Page, label: str) -> None:
    """A PDF imported as a page note draws, page by page, on the sheet and in the panel.

    The bug this is here for: the note was written correctly - one `file` node per page,
    at the paper's own size, with `#page=N` in the subpath - and every page came out
    blank, on the web build and in the app alike, while the PDF viewer drew the same
    file. The paper's path in the note is relative, and it was handed to the reader as
    it stood; nothing in the app can read `Lecture 4.pdf`.

    So this counts pixels rather than trusting the file: a page that drew has a black
    block on it, and a page that did not is the colour of the sheet. Both places the
    paper is drawn are asked - the sheet in the pane and the thumbnail in the panel -
    because they used to fail together and would fail together again.

    A Letter page is in there as well, because a page out of a Letter paper used to
    call itself A4: the size was right and the name was wrong, so changing its ruling
    snapped it to A4's size.
    """
    say("--- a paper imported as pages ---")

    # A4 and Letter, in the points a PDF measures in.
    made = page.evaluate(
        IMPORT_PAPER,
        {"base64": paper_bytes([(595.28, 841.89), (612.0, 792.0)]), "name": "Lecture 4.pdf"},
    )
    if made.get("format") != "pdf-pages":
        fail(f"[{label}] the import read the paper as {made.get('format')!r}: {made.get('error')!r}")
        return

    say(f"[{label}] imported into a folder of its own: {made.get('folder')!r}")

    opened_note = page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.files.find((one) => one.name === 'Lecture 4.pages')
          if (!note) return null
          await ws.openEntry(note.path, { activate: true })
          return note.path
        }"""
    )
    if not opened_note:
        fail(f"[{label}] the import wrote no page note beside the paper")
        return

    say(f"[{label}] the note the import made: {opened_note}")
    page.wait_for_selector(".pages", timeout=15000)
    # The reader is fetched the first time a paper is asked for - it brings pdf.js with
    # it - and then every page is rasterised.
    page.wait_for_timeout(3500)

    held = pages_of(page)
    if len(held) != 2:
        fail(f"[{label}] the paper became {len(held)} pages rather than two")
        return

    # The sizes are the paper's own, and so are the names now.
    if [one["paper"] for one in held] != ["a4", "letter"]:
        fail(f"[{label}] the pages call themselves {[one['paper'] for one in held]}")
    if (held[0]["width"], held[0]["height"]) != (794, 1123):
        fail(f"[{label}] the A4 page is {held[0]['width']}x{held[0]['height']}")
    if (held[1]["width"], held[1]["height"]) != (816, 1056):
        fail(f"[{label}] the Letter page is {held[1]['width']}x{held[1]['height']}")

    sheets = page.evaluate(DARK_ON_SHEETS)
    say(f"[{label}] the sheets: {sheets}")
    if len(sheets) != 2:
        fail(f"[{label}] {len(sheets)} sheets draw a paper rather than two")
    for at, one in enumerate(sheets):
        if one["dark"] < 100:
            fail(f"[{label}] page {at + 1} drew nothing: {one}")

    shot(page, f"{label}-paper")

    # And the panel, which draws the same paper through the same reader. Opened the way
    # the checks above open it, then waited for: it slides in, and the thumbnails are
    # drawn a pause after the last change rather than on every stroke.
    page.evaluate("() => { window.nibApp.workspace.panel = 'outline' }")
    page.wait_for_timeout(3000)
    thumbs = page.evaluate(DARK_ON_THUMBS)
    say(f"[{label}] the thumbnails: {thumbs}")
    if not thumbs:
        fail(f"[{label}] the outline panel drew no thumbnails at all")
    elif not any(one["dark"] >= 20 for one in thumbs):
        fail(f"[{label}] no thumbnail has any of the paper on it: {thumbs}")

    shot(page, f"{label}-paper-thumbnails")

    # A page whose paper is not there says so rather than coming out blank, which is
    # the other half of the bug: a silent blank sheet is what hid it.
    # A page whose paper is not there says so rather than coming out blank, which is
    # the other half of the bug: a silent blank sheet is what hid it. Pointed at a paper
    # that was never there, through the store's own edit, which is what changing a page
    # amounts to anywhere else.
    page.evaluate(
        """() => {
          const store = window.nibApp.pages.current.store
          const first = store.pages[0]
          store.edit({
            ...store.canvas,
            nodes: store.canvas.nodes.map((node) =>
              node.id === first.id ? { ...node, file: 'Nowhere at all.pdf' } : node,
            ),
          })
        }"""
    )
    page.wait_for_timeout(1500)

    said = page.locator(".sheet .missing").count()
    if said < 1:
        fail(f"[{label}] a page whose paper is not there says nothing about it")
    else:
        say(f"[{label}] {said} sheet(s) say the paper could not be read")

    shot(page, f"{label}-paper-missing")


def drive(browser, theme: str) -> None:
    say(f"=== {theme} ===")
    context = browser.new_context(
        viewport={"width": 1280, "height": 860},
        color_scheme=theme,
        device_scale_factor=1,
    )
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[{theme}] page error: {error}"))
    page.on("console", lambda one: complain(theme, one))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, theme, device="tablet")

        check_opens(page, theme)
        check_refits(page, theme)
        check_pen(page, cdp, theme)
        check_palm(page, cdp, theme)
        check_rulings(page, theme)
        check_adding(page, theme)
        check_counter(page, theme)
        check_gutter(page, cdp, theme)
        if theme == "light":
            check_long_page(page, theme)
            check_file(page, theme)
            check_as_canvas(page, theme)
            # After those three, because it makes a page note of its own: everything
            # above is about the note this drive started with.
            check_papers(page, theme)
        # Last, because it imports a paper and opens the note the import made: every
        # check above is about the note this drive started with.
        check_paper(page, theme)
    finally:
        context.close()


def drive_phone(browser) -> None:
    """The phone: the same bar, the pages in a column, no second interface."""
    say("=== phone ===")
    context = browser.new_context(
        viewport={"width": 412, "height": 915},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    context.add_init_script(PREPARE)
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[phone] page error: {error}"))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "phone", device="phone")

        check_opens(page, "phone")

        # The same bar and no other: one `.canvas-bar` on the page, which is the
        # component the canvas uses.
        bars = page.locator(".canvas-bar, .bar").count()
        if bars < 1:
            fail("[phone] the pen bar is not on the page")
        shot(page, "phone-bar")

        # A finger writes here, because this glass has never had a pen on it.
        tool(page, "d")
        box = surface(page)
        before = ink_count(page)
        stroke(
            page,
            cdp,
            [(box["x"] + 80 + n * 6, box["y"] + 200 + (n % 3) * 7) for n in range(18)],
            kind="touch",
        )
        if ink_count(page) != before + 1:
            fail("[phone] a finger did not write on a phone")

        shot(page, "phone-a-stroke")

        # And the pages are still a column: the same layout, not a second one.
        pages = pages_of(page)
        if len(pages) >= 2 and pages[1]["y"] <= pages[0]["y"]:
            fail("[phone] the pages are not in a column")
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
                for theme in ("light", "dark"):
                    drive(browser, theme)
                check_finger_draws(browser, "no-pen")
                drive_phone(browser)
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

    print("\neverything the drive checked was right")
    return 0


if __name__ == "__main__":
    sys.exit(main())
