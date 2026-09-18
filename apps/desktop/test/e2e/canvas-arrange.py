"""The canvas driven for real: the pointer, the pattern, the bar and the arrange side.

Everything here is the real thing - the built web app in the machine's own Chrome, a
canvas made through the workspace, and gestures sent as real mouse, touch and pen
events through the DevTools protocol. No Worker and no account: a plane is a file in
this browser's own storage, which is all a drawing needs.

What it checks and photographs:

    the cursor every tool puts on the plane, and the eraser's ring at its real width
    a stroke drawn with a pen that turns sharply, which is where the tail used to flick
    the background pattern at four zooms, including far enough out that it used to go
    the bar dragged to each of the four edges, standing on its end down the sides
    a popover shut by a tap on the plane
    the pen's colours in both themes, where the page's own ink used to read as white
    the S Pen's barrel button, in all three shapes the browser reports it
    every put-down tool drawn while it is being dragged out
    an arrow dragged from one card to another becoming a connector
    a picture and a note as two entries in the grid rather than one

Run it from the repository root:

    python apps/desktop/test/e2e/canvas-arrange.py

It builds the app, serves it, drives the browser and stops everything again. Nothing it
makes outlives it but the screenshots, which go beside it under `shots/`.

The app is built `--mode drive` on purpose, which is what leaves the app's own
stores reachable from the page: the device class is settled from the window and no
window on a desktop machine is a tablet, so the drive says so directly rather than
pretending to be Android well enough to fool the whole Tauri bridge. Everything the
plane itself does is real.
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
SHOTS = HERE / "shots" / "canvas-arrange"
DIST = APP / "dist"

# Its own port, above the dev server anybody may be using.
PORT = 18879
ORIGIN = f"http://127.0.0.1:{PORT}"

failures: list[str] = []


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def fail(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)


def build() -> None:
    say("building the web app")
    # From nothing: a build over the last one leaves its chunks behind, and a drive
    # that photographs yesterday's canvas is worse than no drive at all.
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


def canvas_of(page: Page) -> dict:
    """The plane as the file holds it, read off the open canvas rather than guessed."""
    return page.evaluate("() => JSON.parse(window.nibApp.workspace.active.doc)")


def written(page: Page, holds: str, patience: int = 8000) -> None:
    """Waits until the file says what the gesture just did.

    Serialising the plane is the size of the plane, so it is written once the changes
    have stopped coming rather than per event: the file a drive reads straight after a
    drag is the plane as it was before it. `holds` is a line of JavaScript about
    `plane`, the parsed file. Waited on rather than slept through, because the pause is
    the app's own and this drive should not have to know how long it is; see
    WRITE_DELAY in lib/canvas/store.svelte.ts."""
    try:
        page.wait_for_function(
            "() => { const doc = window.nibApp.workspace.active?.doc;"
            " if (!doc) return false;"
            " let plane; try { plane = JSON.parse(doc) } catch { return false }"
            f" return {holds} }}",
            timeout=patience,
        )
    except Exception:  # noqa: BLE001 - the check after this says what was missing
        pass


def cursor_of(page: Page) -> str:
    return page.evaluate("() => getComputedStyle(document.querySelector('.canvas')).cursor")


def tool(page: Page, key: str) -> None:
    """A tool taken with its own key, which is how the bar teaches the keyboard.

    The plane has to have the keyboard for a bare letter to reach it, and a press on the
    plane is what gives it: with the arrow in hand that press means nothing, which is why
    Escape comes first. With a pen in hand it would be a dot."""
    page.keyboard.press("Escape")
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    page.keyboard.press(key)
    page.wait_for_timeout(120)


def pen_stroke(
    page: Page,
    cdp,
    points: list[tuple[float, float]],
    buttons: int = 1,
    kind: str = "pen",
    halfway: int | None = None,
) -> None:
    """A stroke drawn with a real stylus.

    `buttons` is what the contact carries from the moment it lands, and `halfway` is what
    it changes to partway through - which is the gesture that matters, because a hand
    that presses the barrel button while it is already writing is what Emil reported."""

    def send(what: str, x: float, y: float, force: float, held: int) -> None:
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": what,
                "x": x,
                "y": y,
                # The button that changed, which for a barrel button is the right one.
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

    held = buttons
    turn = len(points) // 2
    for at, (x, y) in enumerate(points[1:], start=1):
        if halfway is not None and at == turn:
            held = halfway
        send("mouseMoved", x, y, 0.7, held)
        page.wait_for_timeout(8)

    last = points[-1]
    send("mouseReleased", last[0], last[1], 0, held)
    page.wait_for_timeout(250)


def open_panel(page: Page, opener, inside: str) -> None:
    """A tool's own panel, opened. Pressing the tool you are already holding is what
    opens it, so the first press may only be picking the tool up."""
    for _try in range(3):
        if page.locator(inside).count() > 0:
            return

        opener.click()
        page.wait_for_timeout(250)

    if page.locator(inside).count() < 1:
        fail(f"the panel holding {inside} never opened")


def shut_panels(page: Page) -> None:
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)


def check_cursors(page: Page) -> None:
    """Item 1: every tool sets its own cursor on the plane."""
    say("--- what the pointer says ---")

    tool(page, "v")
    if cursor_of(page) != "default":
        fail(f"the arrow does not wear the default cursor ({cursor_of(page)})")

    tool(page, "h")
    if cursor_of(page) != "grab":
        fail(f"the hand does not wear a grab ({cursor_of(page)})")

    tool(page, "r")
    if cursor_of(page) != "crosshair":
        fail(f"a put-down tool does not wear a crosshair ({cursor_of(page)})")

    tool(page, "d")
    drawn = cursor_of(page)
    if "svg" not in drawn:
        fail(f"the pen does not wear a drawn nib ({drawn})")
    else:
        say("the pen wears a nib drawn in its own colour")

    tool(page, "e")
    narrow = cursor_of(page)
    if "svg" not in narrow:
        fail(f"the eraser does not wear a drawn ring ({narrow})")

    # The ring follows the width dial while the slider is still moving, which is the
    # whole point of drawing it: the ring on screen is the hole it will rub.
    eraser = page.locator('.cluster button[aria-label="Erase"]').first
    open_panel(page, eraser, 'button[aria-label="Erase everything drawn"]')
    width = page.locator('.panel input[aria-label="Width"]').first
    width.fill("40")
    width.dispatch_event("input")
    page.wait_for_timeout(250)
    shot(page, "canvas-eraser-panel")

    shut_panels(page)
    wide = cursor_of(page)
    if wide == narrow:
        fail("the eraser's ring does not follow the width dial")
    else:
        say("the eraser's ring is redrawn when the width dial moves")

    open_panel(page, eraser, 'button[aria-label="Erase everything drawn"]')
    width = page.locator('.panel input[aria-label="Width"]').first
    width.fill("10")
    width.dispatch_event("input")
    page.wait_for_timeout(150)
    shut_panels(page)

    tool(page, "v")
    shot(page, "canvas-cursor-arrow")


def check_pattern(page: Page) -> None:
    """Item 3: the pattern coarsens as the plane goes out; it never goes away."""
    say("--- the background pattern ---")

    for name, scale in (("in", 2.0), ("one", 1.0), ("out", 0.2), ("far", 0.03)):
        page.evaluate(
            "(scale) => { const tab = window.nibApp.workspace.active;"
            " tab.camera = { ...(tab.camera ?? { x: 0, y: 0 }), scale } }",
            scale,
        )
        page.wait_for_timeout(250)

        layers = page.locator(".canvas > .dots").count()
        if layers < 1:
            fail(f"no pattern at all at a zoom of {scale}")
        else:
            steps = page.evaluate(
                "() => [...document.querySelectorAll('.canvas > .dots')]"
                ".map((one) => Math.round(parseFloat(getComputedStyle(one)"
                ".getPropertyValue('--dot-step'))))"
            )
            say(f"at {scale}x the pattern is {layers} layer(s), {steps}px apart")
            if min(steps) < 4:
                fail(f"the pattern is a wash at a zoom of {scale} ({steps}px apart)")

        shot(page, f"canvas-pattern-{name}")

    page.evaluate(
        "() => { const tab = window.nibApp.workspace.active;"
        " tab.camera = { x: 0, y: 0, scale: 1 } }"
    )
    page.wait_for_timeout(200)


def check_pull(page: Page) -> None:
    """Item 9a: everything put down is drawn while it is being dragged out."""
    say("--- what is drawn while it is dragged out ---")

    box = plane(page)
    for name, key, selector in (
        ("arrow", "a", ".canvas svg.drawing path"),
        ("elbow", "b", ".canvas svg.drawing path"),
        ("diamond", "m", ".canvas svg.drawing path"),
        ("rectangle", "r", ".canvas .band.pulling"),
        ("card", "c", ".canvas .band.pulling"),
        ("frame", "f", ".canvas .band.pulling"),
    ):
        tool(page, key)
        page.mouse.move(box["x"] + 200, box["y"] + 200)
        page.mouse.down()
        page.mouse.move(box["x"] + 420, box["y"] + 340, steps=8)
        page.wait_for_timeout(150)

        drawn = page.locator(selector).count()
        if drawn < 1:
            fail(f"a {name} being dragged out is not drawn until it is let go")
        else:
            say(f"a {name} is drawn while it is being dragged out")

        shot(page, f"canvas-pulling-{name}")
        page.mouse.up()
        page.wait_for_timeout(250)
        page.keyboard.press("Delete")
        page.wait_for_timeout(150)

    tool(page, "v")


def check_connector(page: Page) -> None:
    """Item 9a and 9d: an arrow dragged between two cards becomes a connector, and an
    end of one can be dragged onto another card."""
    say("--- connectors ---")

    three_cards(page)

    # From the middle of the first card to the middle of the second, read off where they
    # really are: a fresh canvas frames what is on it, so the camera is its own.
    one = page.locator('.canvas .node[data-id="aa"]').first.bounding_box()
    two = page.locator('.canvas .node[data-id="bb"]').first.bounding_box()
    assert one and two

    tool(page, "a")
    page.mouse.move(one["x"] + one["width"] / 2, one["y"] + one["height"] / 2)
    page.mouse.down()
    page.mouse.move(two["x"] + two["width"] / 2, two["y"] + two["height"] / 2, steps=12)
    page.wait_for_timeout(200)

    if page.locator(".canvas .port.aiming").count() < 1:
        fail("the anchor an arrow will attach to is not shown while it is dragged")
    else:
        say("the anchor an arrow will attach to is shown before it is let go")

    shot(page, "canvas-connector-aiming")
    page.mouse.up()
    written(page, "plane.edges.length >= 1")

    edges = canvas_of(page).get("edges", [])
    if len(edges) != 1:
        fail(f"an arrow dragged between two cards did not become a connector ({edges})")
    else:
        say("an arrow dragged from one card to another became a connector")
        shot(page, "canvas-connector-made")

    tool(page, "v")


def check_shape_text(page: Page) -> None:
    """Item 9c: a shape holds words."""
    say("--- words inside a shape ---")

    fresh(page)
    page.evaluate(
        """() => {
          const tab = window.nibApp.workspace.active
          tab.note.replace(JSON.stringify({
            nodes: [],
            edges: [],
            nib: { version: 1, shapes: [
              { id: 'dd', shape: 'rhombus', x: -120, y: -80, width: 240, height: 160,
                text: 'Ready?' },
              { id: 'ee', shape: 'triangle', x: 200, y: -80, width: 200, height: 160 },
            ] },
          }, null, '\\t') + '\\n')
        }"""
    )
    page.wait_for_timeout(600)

    said = page.locator(".canvas .node.shape .card").first
    if said.count() < 1 or "Ready?" not in said.inner_text():
        fail("a shape does not show the words inside it")
    else:
        say("a shape shows the words inside it")

    shot(page, "canvas-shape-words")

    # And Enter opens the words of whatever is picked, shape or card alike. On the
    # triangle's own line: a hollow shape is its outline, and the plane of nothing
    # inside it is nothing to a press too.
    tool(page, "v")
    empty = page.locator('.canvas .node[data-id="ee"]').first.bounding_box()
    assert empty
    # A quarter along the bottom line rather than the middle of it: the middle of a side
    # is where the dot a connector is dragged from sits, and that press means that.
    page.mouse.click(empty["x"] + empty["width"] * 0.25, empty["y"] + empty["height"] - 2)
    page.wait_for_timeout(250)

    if page.locator(".canvas .node.shape.picked").count() < 1:
        fail("a press on a shape's own line does not pick it")
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)

    if page.locator(".canvas .node.shape .editor").count() < 1:
        fail("Enter does not open the words inside a shape")
    else:
        say("Enter opens the words inside a shape")
        shot(page, "canvas-shape-writing")

    page.keyboard.press("Escape")
    page.wait_for_timeout(200)


def check_more_menu(page: Page) -> None:
    """Item 9f: lining up and spreading out, in the menu behind the selection bar."""
    say("--- the rest of what can be done ---")

    three_cards(page)
    page.locator(".canvas").first.click(position={"x": 20, "y": 20})
    page.keyboard.press("Control+a")
    page.wait_for_timeout(300)

    more = page.locator('.over button[aria-label="More"]').first
    if more.count() < 1:
        fail("the bar over what is picked offers no menu")
        return

    more.click()
    page.wait_for_timeout(400)

    for wanted in ("Align left", "Spread across", "Group", "Bring to front"):
        if page.get_by_text(wanted, exact=True).count() < 1:
            fail(f"the selection bar's menu does not offer {wanted}")

    say("the selection bar's menu offers lining up, spreading out and the z order")
    shot(page, "canvas-more-menu")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)


def check_broken_picture(page: Page) -> None:
    """Item 10: a picture the space no longer holds is a calm placeholder."""
    say("--- a picture that is not there ---")

    fresh(page)
    page.evaluate(
        """() => {
          const tab = window.nibApp.workspace.active
          tab.note.replace(JSON.stringify({
            nodes: [
              { id: 'ff', type: 'file', x: -120, y: -80, width: 240, height: 160,
                file: 'gone/nowhere.png' },
            ],
            edges: [],
          }, null, '\\t') + '\\n')
        }"""
    )
    page.wait_for_timeout(900)

    if page.locator(".canvas .node .missing").count() < 1:
        fail("a picture the space no longer holds shows no placeholder")
    else:
        say("a picture the space no longer holds shows a calm placeholder")

    shot(page, "canvas-picture-gone")


def fresh(page: Page) -> None:
    """A canvas with nothing on it and nothing behind it.

    A new one rather than the old one emptied, because a plane somebody has been drawing
    on merges what arrives under it rather than taking it whole - which is what keeps two
    devices' drawings, and what makes writing a document under a live surface a bad way
    to set one up. See `follow` in store.svelte.ts."""
    page.evaluate("() => window.nibApp.workspace.createCanvas()")
    page.wait_for_timeout(800)
    page.wait_for_selector(".canvas", timeout=15000)


def three_cards(page: Page) -> None:
    """Three cards on a plane with nothing else on it, put there through the document
    rather than by hand: what is being checked is what happens to them, not how they got
    there."""
    fresh(page)
    page.evaluate(
        """() => {
          const tab = window.nibApp.workspace.active
          tab.note.replace(JSON.stringify({
            nodes: [
              { id: 'aa', type: 'text', x: -300, y: -60, width: 200, height: 80, text: 'one' },
              { id: 'bb', type: 'text', x: 120, y: -60, width: 200, height: 80, text: 'two' },
              { id: 'cc', type: 'text', x: -60, y: 200, width: 200, height: 80, text: 'three' },
            ],
            edges: [],
          }, null, '\\t') + '\\n')
        }"""
    )
    page.wait_for_timeout(600)


def check_arranging(page: Page) -> None:
    """Items 9b, 9e and 9g: held aspect, group and ungroup, and alt to leave a copy."""
    say("--- arranging ---")

    box = plane(page)
    tool(page, "v")
    three_cards(page)

    # Everything picked, made one frame, from the bar over the selection.
    page.keyboard.press("Control+a")
    page.wait_for_timeout(300)
    grouped = page.locator('.over button[aria-label="Group"]')
    if grouped.count() < 1:
        fail("the bar over several things picked does not offer to group them")
    else:
        grouped.first.click()
        written(page, "plane.nodes.some((one) => one.type === 'group')")
        frames = [one for one in canvas_of(page)["nodes"] if one["type"] == "group"]
        if len(frames) != 1:
            fail(f"grouping several things did not make one frame ({len(frames)})")
        else:
            say("several things picked were made one frame from the selection bar")
        shot(page, "canvas-grouped")

        # And taken apart again, which is the same button once a frame is what is picked.
        ungrouped = page.locator('.over button[aria-label="Ungroup"]')
        if ungrouped.count() < 1:
            fail("the bar over a frame does not offer to take it apart")
        else:
            ungrouped.first.click()
            written(page, "!plane.nodes.some((one) => one.type === 'group')")
            left = canvas_of(page)["nodes"]
            if any(one["type"] == "group" for one in left):
                fail("ungrouping left the frame behind")
            elif len(left) != 3:
                fail(f"ungrouping did not leave what the frame held ({len(left)})")
            else:
                say("a frame taken apart left everything it held where it was")

    # Alt on a drag leaves a copy behind and carries the originals off.
    three_cards(page)
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    card = page.locator('.canvas .node[data-id="aa"]').first.bounding_box()
    assert card
    page.keyboard.down("Alt")
    page.mouse.move(card["x"] + card["width"] / 2, card["y"] + card["height"] / 2)
    page.mouse.down()
    page.mouse.move(card["x"] + card["width"] / 2, card["y"] + card["height"] / 2 + 220, steps=10)
    page.wait_for_timeout(150)
    page.mouse.up()
    page.keyboard.up("Alt")
    # The copy and the drag that follows it name one gesture, so the file is written
    # once it has gone quiet rather than twice while it is happening.
    settled(page)

    after = canvas_of(page)["nodes"]
    if len(after) != 4:
        fail(f"alt on a drag did not leave a copy behind ({len(after)} cards)")
    else:
        say("alt on a drag left a copy where the drag began")
    shot(page, "canvas-alt-drag")

    # One press of undo puts both the copy and the move back, because they are one
    # thing somebody did.
    page.keyboard.press("Control+z")
    written(page, "plane.nodes.length === 3")
    if len(canvas_of(page)["nodes"]) != 3:
        fail("one undo did not take back both the copy and the drag that made it")
    else:
        say("one undo takes back both the copy and the drag")

    # A card resized with Shift keeps the shape it had.
    three_cards(page)
    picked = page.locator('.canvas .node[data-id="bb"]').first.bounding_box()
    assert picked
    page.mouse.click(picked["x"] + picked["width"] / 2, picked["y"] + picked["height"] / 2)
    page.wait_for_timeout(250)
    was = next(one for one in canvas_of(page)["nodes"] if one["id"] == "bb")
    handle = page.locator(".canvas .handle").nth(4).bounding_box()
    if handle:
        page.keyboard.down("Shift")
        page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2)
        page.mouse.down()
        page.mouse.move(
            handle["x"] + handle["width"] / 2 + 200,
            handle["y"] + handle["height"] / 2,
            steps=10,
        )
        page.wait_for_timeout(150)
        shot(page, "canvas-resize-aspect")
        page.mouse.up()
        page.keyboard.up("Shift")
        written(
            page,
            f"plane.nodes.some((one) => one.id === 'bb' && one.width !== {was['width']})",
        )

        now = next(one for one in canvas_of(page)["nodes"] if one["id"] == "bb")
        before = was["width"] / was["height"]
        after_ratio = now["width"] / now["height"]
        if abs(before - after_ratio) > 0.15:
            fail(f"a resize held with Shift did not keep the shape ({before} to {after_ratio})")
        elif now["width"] == was["width"]:
            fail("a resize held with Shift changed nothing at all")
        else:
            say("a resize held with Shift kept the shape of the box")

    page.keyboard.press("Escape")


def check_picture(page: Page) -> None:
    """Item 10: the picture tool asks the system for a picture."""
    say("--- a picture ---")

    asked: list[str] = []
    page.on("filechooser", lambda chooser: asked.append(chooser.element.get_attribute("accept")))

    tool(page, "i")
    page.locator(".canvas").first.click(position={"x": 400, "y": 300})
    page.wait_for_timeout(700)

    if not asked:
        fail("the picture tool never asked for a picture")
    elif "image/" not in (asked[0] or ""):
        fail(f"the picture picker does not ask for pictures ({asked[0]})")
    else:
        say(f"the picture tool opens the system's own picker, asking for {asked[0]}")

    page.keyboard.press("Escape")
    tool(page, "v")


def check_panel_shuts(page: Page) -> None:
    """Item 6: a popover shuts on a press anywhere outside it."""
    say("--- popovers ---")

    box = plane(page)
    open_panel(page, page.locator(".cluster button.pen").first, 'input[aria-label="Opacity"]')
    shot(page, "canvas-pen-panel")

    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + 120)
    page.wait_for_timeout(300)

    if page.locator('input[aria-label="Opacity"]').count() > 0:
        fail("the pen panel does not shut when the plane is tapped")
    else:
        say("the pen panel shuts when the plane is tapped")

    # And the put-down grid, the same way.
    page.locator('.cluster button[aria-label="Add"]').first.click()
    page.wait_for_timeout(200)
    if page.locator('.panel button[aria-label="Picture"]').count() < 1:
        fail("the put-down grid has no Picture in it")
    else:
        say("the put-down grid offers a Note and a Picture as two things")
    shot(page, "canvas-put-grid")

    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + 120)
    page.wait_for_timeout(300)
    if page.locator(".panel").count() > 0:
        fail("the put-down grid does not shut when the plane is tapped")
    else:
        say("the put-down grid shuts when the plane is tapped")


def check_bar_docks(page: Page) -> None:
    """Item 5: the bar follows the finger and springs to the nearest edge."""
    say("--- where the bar sits ---")

    grip = page.locator('[aria-label="Move the bar"]').first
    if grip.count() < 1:
        say("note: the bar shows no grip on this device, so there is nothing to drag")
        return

    window = page.evaluate("() => ({ w: window.innerWidth, h: window.innerHeight })")
    corners = {
        "left": (20, window["h"] / 2),
        "top": (window["w"] / 2, 20),
        "right": (window["w"] - 20, window["h"] / 2),
        "bottom": (window["w"] / 2, window["h"] - 20),
    }

    for edge, (x, y) in corners.items():
        here = page.locator('[aria-label="Move the bar"]').first.bounding_box()
        assert here
        page.mouse.move(here["x"] + here["width"] / 2, here["y"] + here["height"] / 2)
        page.mouse.down()
        # Halfway first, so the bar is seen following the pointer rather than jumping.
        page.mouse.move((here["x"] + x) / 2, (here["y"] + y) / 2, steps=6)
        page.wait_for_timeout(120)
        if edge == "left":
            shot(page, "canvas-bar-carried")
        page.mouse.move(x, y, steps=8)
        page.wait_for_timeout(120)
        page.mouse.up()
        page.wait_for_timeout(500)

        held = page.evaluate("() => JSON.parse(localStorage.getItem('nib:pens') ?? '{}').dock")
        if held != edge:
            fail(f"the bar let go by the {edge} edge went to {held}")
        else:
            say(f"the bar let go by the {edge} edge sprang to it")

        standing = page.locator(".cluster.standing").count() > 0
        if standing != (edge in ("left", "right")):
            fail(f"the bar at the {edge} edge is {'standing' if standing else 'lying'}")

        shot(page, f"canvas-bar-{edge}")


def wipe(page: Page) -> None:
    """Everything on the plane, gone, through the app's own keys."""
    page.locator(".canvas").first.click(position={"x": 30, "y": 30})
    page.keyboard.press("Escape")
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.wait_for_timeout(400)


def settled(page: Page) -> None:
    """Long enough for a gesture that edits as it goes to be written down. An eraser
    answers under the nib and the file is written once the drag has gone quiet, which is
    the only reason this drive ever has to wait; see WRITE_DELAY in store.svelte.ts."""
    page.wait_for_timeout(1600)


def check_pen_button(page: Page, cdp, tablet: bool = False) -> None:
    """Item 8: the barrel button rubs out, in every shape the browser reports it."""
    say("--- the pen's own button ---")

    box = plane(page)
    line = [
        (box["x"] + box["width"] / 2 - 160 + step * 14, box["y"] + box["height"] / 2 - 40)
        for step in range(24)
    ]

    def ink() -> list:
        return canvas_of(page).get("nib", {}).get("ink", [])

    # Wiped before the pen is taken, because Escape puts the arrow back in your hand.
    wipe(page)
    tool(page, "d")

    # A plain stroke first, which is also what the button then has to rub out.
    pen_stroke(page, cdp, line)
    settled(page)
    drawn = ink()
    if len(drawn) != 1:
        fail(f"a pen with no button held did not draw one stroke ({len(drawn)})")
    else:
        say("a plain pen stroke landed")
    shot(page, "canvas-pen-stroke")

    # The right button bit, which is what Chrome on Android reports the barrel button as.
    #
    # Not the eraser bit, which is what Chromium reports on a desktop: the DevTools
    # protocol's `buttons` only carries the five a mouse has, so bit 32 cannot be sent
    # from here at all. That shape is covered where it can be - canvas/contacts.test.ts,
    # which is the classification itself rather than a browser's idea of it.
    pen_stroke(page, cdp, line, buttons=2)
    settled(page)
    if ink():
        fail("a pen holding its button reported as the right one did not rub out")
    else:
        say("a pen holding its button reported as the right one rubbed out")

    # And the gesture Emil actually described: the button pressed while the pen is
    # already writing. It used to stop the line and rub out nothing at all.
    wipe(page)
    tool(page, "d")
    pen_stroke(page, cdp, line, buttons=1, halfway=2)
    settled(page)
    if ink():
        fail("a button pressed halfway through a line neither wrote nor rubbed out")
    else:
        say("a button pressed halfway through a line turns that stroke into a rub")

    if tablet:
        # The third shape: some builds report the stylus as a mouse while the button is
        # held. On glass that has had a pen on it, that is the pen.
        tool(page, "d")
        pen_stroke(page, cdp, line)
        settled(page)
        pen_stroke(page, cdp, line, buttons=2, kind="mouse")
        settled(page)
        if ink():
            fail("a mouse holding button two on a tablet with a pen did not rub out")
        else:
            say("a stylus that reports itself as a mouse still rubs out on a tablet")

    say(f"the pointer record says: {page.locator('[data-pointer]').first.inner_text()}")
    shot(page, "canvas-pen-rubbed")

    # The menu must never open under a nib.
    if page.locator(".menu-sheet, [role='menu']").count() > 0:
        fail("the menu opened under the pen's own button")


def check_sharp_stroke(page: Page, cdp) -> None:
    """Item 2: a stroke that turns sharply, which is where the tail used to flick."""
    say("--- a stroke that turns sharply ---")

    box = plane(page)
    tool(page, "d")
    page.evaluate(
        "() => { const tab = window.nibApp.workspace.active;"
        " tab.note.replace('{\\n\\t\"nodes\": [],\\n\\t\"edges\": []\\n}\\n') }"
    )
    page.wait_for_timeout(400)

    # A zigzag with corners in it: every corner is where a prediction points the old way.
    zigzag = []
    for step in range(30):
        zigzag.append(
            (
                box["x"] + 160 + step * 18,
                box["y"] + 260 + (60 if step % 2 else -60),
            )
        )

    pen_stroke(page, cdp, zigzag)
    written(page, "(plane.nib?.ink ?? []).length > 0")
    shot(page, "canvas-sharp-stroke")

    drawn = canvas_of(page).get("nib", {}).get("ink", [])
    if not drawn:
        fail("a stroke that turns sharply left nothing on the plane")
    else:
        say("a stroke that turns sharply landed whole")


def check_pen_colours(page: Page, theme: str) -> None:
    """Item 7: the pen's own colours, where the page's ink used to read as white."""
    open_panel(page, page.locator(".cluster button.pen").first, 'input[aria-label="Opacity"]')

    dot = page.locator('.panel button[aria-label="The ink of the page"]').first
    if dot.count() < 1:
        fail("the pen's colours do not name the ink of the page")
    else:
        shown = page.evaluate(
            "(el) => getComputedStyle(el, '::after').backgroundColor",
            dot.element_handle(),
        )
        say(f"[{theme}] the page's own ink shows as {shown}")

    shot(page, f"canvas-pen-colours-{theme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)


def drive_tablet(browser) -> None:
    """The same plane on a tablet with a stylus, which is the device the pen report came
    from: touch sizes, no cursor at all, and a pen that has been on this glass."""
    say("=== tablet ===")
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        has_touch=True,
        device_scale_factor=1,
    )
    context.add_init_script(PREPARE + "\nlocalStorage.setItem('nib:pen-seen', 'yes');")
    page = context.new_page()
    page.on("pageerror", lambda error: fail(f"[tablet] page error: {error}"))

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, "tablet", tablet=True)

        # No cursor on glass: the eraser draws its ring on the page instead, under the
        # nib, which is checked while it is rubbing below.
        tool(page, "e")
        if cursor_of(page) not in ("auto", "default"):
            fail(f"a touch screen was given a drawn cursor ({cursor_of(page)})")
        else:
            say("a touch screen is given no drawn cursor, as it should be")

        tool(page, "v")
        shot(page, "canvas-tablet-bar")

        # The eraser's ring, drawn on the page under the nib because there is no cursor
        # on glass to put it on. Photographed while it is actually rubbing.
        wipe(page)
        tool(page, "d")
        line = [
            (
                plane(page)["x"] + 240 + step * 16,
                plane(page)["y"] + 300 + (step % 3) * 12,
            )
            for step in range(20)
        ]
        pen_stroke(page, cdp, line)
        settled(page)

        tool(page, "e")
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mousePressed",
                "x": line[8][0],
                "y": line[8][1],
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0.5,
            },
        )
        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseMoved",
                "x": line[9][0],
                "y": line[9][1],
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0.5,
            },
        )
        page.wait_for_timeout(200)

        if page.locator(".canvas .rubbing").count() < 1:
            fail("the eraser shows no ring on a screen that has no cursor")
        else:
            say("the eraser draws its ring on the page, under the nib")
        shot(page, "canvas-tablet-rubbing")

        cdp.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseReleased",
                "x": line[9][0],
                "y": line[9][1],
                "button": "left",
                "buttons": 0,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0,
            },
        )
        page.wait_for_timeout(200)

        check_pen_button(page, cdp, tablet=True)
        check_bar_docks(page)
    finally:
        context.close()


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
    # Every error the page reports is a failure, except the one this drive goes looking
    # for: a picture the space no longer holds is meant to 404, and what is being checked
    # is the placeholder that goes in its place.
    page.on(
        "console",
        lambda one: fail(f"[{theme}] console error: {one.text}")
        if one.type == "error" and "404" not in one.text
        else None,
    )

    cdp = context.new_cdp_session(page)
    cdp.send("Input.setIgnoreInputEvents", {"ignore": False})

    try:
        page.goto(ORIGIN, wait_until="domcontentloaded")
        opened(page, theme)

        check_cursors(page)
        check_pattern(page)
        check_panel_shuts(page)
        check_pen_colours(page, theme)
        check_pull(page)
        check_connector(page)
        check_shape_text(page)
        check_arranging(page)
        check_more_menu(page)
        check_picture(page)
        check_broken_picture(page)
        check_sharp_stroke(page, cdp)
        check_pen_button(page, cdp)
        if theme == "light":
            check_bar_docks(page)
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
                drive_tablet(browser)
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
