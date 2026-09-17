"""Two browsers drawing on one canvas at the same time, against the real Worker.

Everything in this test is the real thing: the built web app, the Worker running
under `wrangler dev` on workerd, a Durable Object holding the room, two browser
contexts with their own storage that know nothing about each other, and real pen
events with pressure and tilt delivered through the debugging protocol.

What it asserts is the promise a shared plane makes - both devices end up with
every stroke, neither drawing is woven through the other, and each can see where
the other's hand is while it is drawing. And it measures how long that takes.

Run it from the repository root:

    python apps/desktop/test/e2e/draw-together.py

It builds the app, applies the migrations, starts the Worker, runs the browsers
and stops everything again. Nothing it makes outlives it but the screenshots,
which go beside it under `shots/`.

The app is built `--mode drive` on purpose. That leaves the app's own stores
reachable from the page, so the test opens a canvas by asking the workspace for it
rather than by hunting for a row in a file list - which is a test of the sidebar,
not of drawing together. Everything after that is real: real pen events into the
real surface, and the plane read back out of the file every device writes.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SERVICE = ROOT / "services" / "sync"
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "draw-together"

# A port of this test's own. Never 1420, which is the dev server's, and neither of
# the two the other end-to-end runs use.
PORT = 18866
ORIGIN = f"http://127.0.0.1:{PORT}"

EMAIL = "drawing@example.com"
SPACE = "Drawings"
CANVAS = "Board.canvas"
PAGE = "Notes page.canvas"
BIG = "Handwriting.canvas"

# A plane with nothing on it, which is what a canvas made just now says.
BLANK = '{\n\t"nodes": [],\n\t"edges": []\n}\n'

# How long anything is waited for before the test gives up and says what it saw.
PATIENCE = 40

# What a stroke crossing has to stay under here. The budget the design is held to
# is 150 ms on a normal connection; this is the ceiling past which something is
# actually wrong rather than merely busy, on one laptop running the Worker's
# emulated runtime and three browser contexts at once.
CEILING = 1500

# And what joining a plane of five thousand strokes has to stay under. The budget
# is 500 ms; the same argument applies to the ceiling.
JOIN_CEILING = 6000


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def npx(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    """A command from the repository's own node_modules."""
    executable = shutil.which("npx") or shutil.which("npx.cmd")
    if not executable:
        raise SystemExit("npx is not on the path")

    return subprocess.run(
        [executable, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


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


def request(
    path: str, token: str | None = None, body: dict | None = None, method: str | None = None
):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(
        f"{ORIGIN}{path}",
        data=data,
        headers=headers,
        method=method or ("GET" if data is None else "POST"),
    )
    with urllib.request.urlopen(call, timeout=60) as answer:
        return json.loads(answer.read() or b"null")


class Worker:
    """The Worker under wrangler dev, and the local database behind it."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        # Its output goes to a file rather than to a pipe. A pipe nobody reads
        # fills up, and a Worker whose output has nowhere to go stops answering.
        self.log = SHOTS.parent / "drawing-worker.log"
        self.opened = None

    def build(self) -> None:
        say("building the web app against the local Worker")
        # `vite build` is a production build whatever mode it is given unless the
        # environment says otherwise, and a production build is the one with the
        # app's stores hidden. Both are set, so the built page keeps them.
        environment = {**os.environ, "VITE_NIB_API": ORIGIN, "NODE_ENV": "development"}
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

    def clean(self) -> None:
        """Everything the last run left: the database, the blobs, and the rooms'
        own storage. A test that starts from yesterday's state is a test of
        yesterday."""
        state = SERVICE / ".wrangler" / "state"
        if state.exists():
            say("clearing what the last run left")
            shutil.rmtree(state, ignore_errors=True)

    def migrate(self) -> None:
        say("applying the migrations to the local database")
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local", cwd=SERVICE)
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

    def sql(self, statement: str) -> None:
        done = npx(
            "wrangler",
            "d1",
            "execute",
            "nib",
            "--local",
            f"--command={statement}",
            cwd=SERVICE,
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

    def start(self) -> None:
        say(f"starting the Worker on {ORIGIN}")
        self.log.parent.mkdir(parents=True, exist_ok=True)
        self.opened = self.log.open("wb")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                "--port",
                str(PORT),
                "--ip",
                "127.0.0.1",
                "--show-interactive-dev-session=false",
            ],
            cwd=SERVICE,
            stdout=self.opened,
            stderr=subprocess.STDOUT,
        )

        until = time.monotonic() + 90
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit(f"the Worker stopped before it answered:\n{self.said()}")
            try:
                if request("/health").get("ok"):
                    say("the Worker is answering")
                    return
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        """The last of what the Worker printed, for a failure to be read beside."""
        if self.opened:
            self.opened.flush()
        if not self.log.exists():
            return "(nothing)"

        return "\n".join(self.log.read_text("utf-8", errors="replace").splitlines()[-40:])

    def kept(self) -> int:
        """How many bytes the rooms are holding, as the runtime has them on disk.
        Everything under the object storage, which after a settle is the plane's
        snapshot and nothing else."""
        state = SERVICE / ".wrangler" / "state" / "v3" / "do"
        if not state.exists():
            return 0

        return sum(path.stat().st_size for path in state.rglob("*") if path.is_file())

    def stop(self) -> None:
        if not self.process:
            return

        say("stopping the Worker")
        # The whole tree. `wrangler dev` is a wrapper around the runtime itself,
        # and stopping only the wrapper leaves the runtime holding the port - which
        # the next run then waits ninety seconds for and gives up on.
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(self.process.pid)],
                capture_output=True,
                check=False,
            )
        else:
            self.process.terminate()

        try:
            self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()

        self.process = None
        if self.opened:
            self.opened.close()
            self.opened = None

    def account(self) -> str:
        """An account with a live session, put straight into the database.

        Signing in needs an emailed code, and what is under test is not the
        sign-in. Everything after this goes through the API the app uses.
        """
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )

        return token


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")


def signed_in(browser: Browser, token: str, label: str) -> Page:
    """A browser context with the session in its storage, on the app."""
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    return page


def listed(path: str) -> str:
    """A script that answers whether the open space's file list holds a path."""
    return (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        f"  return walk(window.nibApp.workspace.tree).includes('/{SPACE}/{path}')"
        "}"
    )


def opened(page: Page, label: str, name: str, note_id: str) -> None:
    """Waits for the account's space to come down, opens the canvas in it, and
    waits for that canvas to be in its room."""
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space to arrive",
    )
    # The file list is the open space's, and a browser opens on whichever space it
    # opened on last. Picking one is what a person does from the rail.
    page.evaluate(
        "async () => {"
        f"  const space = window.nibApp.workspace.spaces.find((one) => one.name === {json.dumps(SPACE)});"
        "  if (space) await window.nibApp.workspace.showSpace(space.id)"
        "}"
    )
    try:
        wait_for(page, listed(name), f"[{label}] {name} to arrive")
    except SystemExit:
        say(
            "the tree held: "
            + json.dumps(
                page.evaluate(
                    "() => { const walk = (e) => (e ? [e.path, ...(e.children ?? []).flatMap(walk)] : []);"
                    "  return { tree: walk(window.nibApp.workspace.tree),"
                    "    spaces: window.nibApp.workspace.spaces,"
                    "    active: window.nibApp.workspace.activeSpaceId,"
                    "    mirrors: JSON.parse(localStorage.getItem('nib:mirrors') ?? 'null') } }"
                )
            )[:2000]
        )
        raise

    page.evaluate(f"async () => {{ await window.nibApp.workspace.openCanvas('/{SPACE}/{name}') }}")
    wait_for(page, "() => !!document.querySelector('canvas.ink.settled')", f"[{label}] the plane")
    wait_for(
        page,
        f"() => window.nibApp.rooms.joined.has({json.dumps(note_id)})",
        f"[{label}] the plane to join its room",
    )


def plane(page: Page) -> dict:
    """Where the plane is on screen, so the same point means the same place in
    either browser."""
    return page.evaluate(
        """() => {
            const host = document.querySelector('div.canvas')
            const box = host.getBoundingClientRect()
            return { x: box.left, y: box.top, width: box.width, height: box.height }
        }"""
    )


def strokes(page: Page) -> int:
    """How many strokes the file this device writes holds. The plane itself is
    pixels; the file is what every device agrees on and what the account keeps."""
    return page.evaluate(
        """() => {
            const text = window.nibApp.workspace.active?.doc ?? ''
            try {
                return (JSON.parse(text).nib?.ink ?? []).length
            } catch {
                return 0
            }
        }"""
    )


def file_of(page: Page) -> str:
    return page.evaluate("() => window.nibApp.workspace.active?.doc ?? ''")


def pen(page: Page):
    """A pen, as the debugging protocol delivers one: pressure and tilt, and the
    events a digitiser really sends rather than a mouse pretending to be one."""
    session = page.context.new_cdp_session(page)

    def down(x: float, y: float) -> None:
        session.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mousePressed",
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 1,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0.6,
                "tiltX": 4,
                "tiltY": -3,
            },
        )

    def move(x: float, y: float) -> None:
        session.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseMoved",
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 1,
                "pointerType": "pen",
                "force": 0.6,
                "tiltX": 4,
                "tiltY": -3,
            },
        )

    def up(x: float, y: float) -> None:
        session.send(
            "Input.dispatchMouseEvent",
            {
                "type": "mouseReleased",
                "x": x,
                "y": y,
                "button": "left",
                "buttons": 0,
                "clickCount": 1,
                "pointerType": "pen",
                "force": 0,
            },
        )

    return down, move, up, session


def wave(box: dict, count: int, offset: float) -> list[tuple[float, float]]:
    """A stroke of `count` points across the plane, `offset` pixels from its middle.
    Every stroke this test draws is above the middle, because the floating bar sits
    over the bottom of the plane and takes the pointer events there."""
    left = box["x"] + box["width"] / 2 - 150
    middle = box["y"] + box["height"] / 2 + offset

    return [
        (left + (index / max(count - 1, 1)) * 300, middle + (index % 5) * 2)
        for index in range(count)
    ]


def watches(page: Page, at: tuple[float, float]) -> None:
    """Has a browser watch one patch of its own settled ink for the first pixel to
    land there, and write down when it did.

    Timed inside the page by the wall clock both browsers share, because asking a
    page a question over the debugging protocol costs more than the thing being
    measured. A small patch rather than the whole layer: reading a whole layer's
    pixels every millisecond would be the most expensive thing in the test.
    """
    page.evaluate(
        """([sx, sy]) => {
            window.__inked = null
            const host = document.querySelector('div.canvas')
            const layer = document.querySelector('canvas.ink.settled')
            const context = layer.getContext('2d', { willReadFrequently: true })

            const look = () => {
                const box = layer.getBoundingClientRect()
                const scale = layer.width / box.width
                const x = Math.max(0, Math.round((sx - box.left) * scale) - 30)
                const y = Math.max(0, Math.round((sy - box.top) * scale) - 30)
                const data = context.getImageData(x, y, 60, 60).data

                for (let at = 3; at < data.length; at += 4) {
                    if (data[at] > 8) {
                        window.__inked = Date.now()
                        return
                    }
                }

                setTimeout(look, 1)
            }

            void host
            look()
        }""",
        [at[0], at[1]],
    )


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    worker = Worker()
    failures: list[str] = []
    # The planes whose joining is timed: a name, how many strokes, and its id.
    joins: list[tuple[str, int, str]] = []

    try:
        worker.build()
        worker.clean()
        worker.migrate()
        # Before the Worker, not after it: the runtime opens the local database on
        # its own connection, and a row written into that file by another process
        # while it is running is not one it is bound to see.
        token = worker.account()
        worker.start()

        space = request("/v1/spaces", token, {"name": SPACE})["space"]
        board = request(
            f"/v1/spaces/{space['id']}/notes", token, {"path": CANVAS, "content": BLANK}
        )["note"]
        say(f"the account holds {SPACE}/{CANVAS} as {board['id']}")

        with sync_playwright() as playwright:
            # One browser, two contexts: two devices as far as the app and the
            # account are concerned, since a context has its own storage and its
            # own session. The three throttling flags matter - a browser slows
            # down a page it is not showing, and a page waiting to hear from the
            # room is exactly that page - and the fourth is what lets the heap be
            # measured honestly.
            browser = playwright.chromium.launch(
                executable_path=chromium(),
                headless=True,
                args=[
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                    "--enable-precise-memory-info",
                    "--js-flags=--expose-gc",
                ],
            )
            try:
                one = signed_in(browser, token, "one")
                opened(one, "one", CANVAS, board["id"])
                two = signed_in(browser, token, "two")
                opened(two, "two", CANVAS, board["id"])
                say("both browsers are on the plane")

                for page, label in ((one, "one"), (two, "two")):
                    wait_for(
                        page,
                        "() => Object.values(window.nibApp.rooms.present).some((n) => n > 0)",
                        f"[{label}] the other device to appear",
                    )
                say("each browser can see that the other is there")

                box = plane(one)
                other = plane(two)
                if abs(box["x"] - other["x"]) > 1 or abs(box["y"] - other["y"]) > 1:
                    failures.append("the two planes are not on screen in the same place")

                down, move, up, session = pen(one)
                one.click("div.canvas", position={"x": 40, "y": 40})
                one.keyboard.press("d")
                one.wait_for_timeout(150)

                # A stroke of three hundred points, and how long it takes to reach
                # the other browser. Five times, so what is reported is a normal
                # crossing rather than the first one, and each on its own line so
                # no two are looked for in the same patch of pixels.
                crossings: list[float] = []
                for turn in range(5):
                    path = wave(box, 300, -280 + turn * 70)
                    middle = path[len(path) // 2]
                    watches(two, middle)

                    down(*path[0])
                    for point in path[1:]:
                        move(*point)

                    # Taken as the pen lifts, which is the moment the stroke exists.
                    # The three hundred points were in the browser already, and
                    # feeding them in one debugging-protocol round trip at a time is
                    # this test's cost rather than the room's.
                    sent = one.evaluate("() => Date.now()")
                    up(*path[-1])

                    until = time.monotonic() + PATIENCE
                    landed = None
                    while time.monotonic() < until:
                        landed = two.evaluate("() => window.__inked")
                        if landed:
                            break
                        two.wait_for_timeout(5)

                    if not landed:
                        failures.append(f"stroke {turn + 1} never crossed")
                        break

                    took = float(landed - sent)
                    crossings.append(took)
                    say(f"a 300 point stroke crossed in {took:.0f} ms")
                    one.wait_for_timeout(120)

                crossing = sorted(crossings)[len(crossings) // 2] if crossings else 0.0
                if crossing > CEILING:
                    failures.append(f"a stroke took {crossing:.0f} ms to cross, past {CEILING} ms")

                # The stroke under somebody else's pen, seen as it is drawn. The
                # pen goes down and moves and is not lifted, and the other browser
                # is photographed with the line and the hand on it.
                live = wave(box, 60, 40)
                down(*live[0])
                for point in live[1:]:
                    move(*point)

                two.wait_for_timeout(250)
                drawing = two.evaluate(
                    """() => {
                        const layer = document.querySelector('svg.hands')
                        return {
                            stroke: !!layer?.querySelector('path'),
                            hand: !!layer?.querySelector('circle'),
                            named: layer?.querySelector('text')?.textContent ?? null,
                        }
                    }"""
                )
                say(f"the other browser is showing {json.dumps(drawing)}")
                two.locator("div.canvas").first.screenshot(path=str(SHOTS / "remote-stroke.png"))

                if not drawing["stroke"]:
                    failures.append("the stroke being drawn was not shown on the other device")
                if not drawing["hand"]:
                    failures.append("the other device's hand was not shown")
                if not drawing["named"]:
                    failures.append("the other device's hand carried no name")

                # And the pen lifts: the stroke settles into the plane's own ink, the
                # name fades a second and a half later, and the dot stays.
                up(*live[-1])
                two.wait_for_timeout(1900)
                two.locator("div.canvas").first.screenshot(path=str(SHOTS / "remote-pointer.png"))
                two.locator(".strip").first.screenshot(path=str(SHOTS / "plane-presence.png"))
                say(f"the photographs are in {SHOTS}")

                # And now both at once, neither having heard the other.
                second, moving, lifting, other_session = pen(two)
                two.click("div.canvas", position={"x": 40, "y": 40})
                two.keyboard.press("d")
                two.wait_for_timeout(150)

                mine = wave(box, 120, 80)
                yours = wave(other, 120, 120)
                down(*mine[0])
                second(*yours[0])
                for step in range(1, 120):
                    move(*mine[step])
                    moving(*yours[step])
                up(*mine[-1])
                lifting(*yours[-1])

                # Every stroke that has been drawn: five crossings, one live one,
                # and the two just now.
                wanted = len(crossings) + 1 + 2
                until = time.monotonic() + PATIENCE
                while time.monotonic() < until:
                    if strokes(one) == wanted and strokes(two) == wanted:
                        break
                    one.wait_for_timeout(100)

                here, there = strokes(one), strokes(two)
                say(f"one holds {here} strokes and two holds {there}")
                if here != wanted or there != wanted:
                    failures.append(f"the two did not converge on {wanted} strokes: {here}, {there}")
                elif file_of(one) != file_of(two):
                    failures.append("the two hold the same count of strokes but not the same file")
                else:
                    say("both browsers hold the same plane, byte for byte")

                # What the account ends up holding, once the room has settled it.
                settled = ""
                until = time.monotonic() + PATIENCE
                while time.monotonic() < until:
                    settled = request(f"/v1/notes/{board['id']}", token)["content"]
                    if settled == file_of(one):
                        break
                    time.sleep(0.3)

                if settled != file_of(one):
                    failures.append(
                        f"the account holds something else: {len(settled)} bytes against "
                        f"{len(file_of(one))}"
                    )
                else:
                    say("the account holds what both browsers hold")

                say(f"the rooms are keeping {worker.kept() // 1024} KB on disk")
                session.detach()
                other_session.detach()

                # A plane joining a room, cold: the object waking, reading the file
                # out of the store, filling a map an entry to an object and saying
                # what it holds. Twice, on two sizes: a page of notes with five
                # hundred strokes on it, and a plane of five thousand, which is the
                # largest a canvas can be and still be a note the account will take.
                # Measured on canvases the browser has never opened, so nothing
                # about either of them is warm.
                for name, count, per in ((PAGE, 500, 20), (BIG, 5000, 8)):
                    written = big_canvas(count, per)
                    say(f"a {len(written) // 1024} KB plane of {count} strokes is going up")
                    made = request(
                        f"/v1/spaces/{space['id']}/notes",
                        token,
                        {"path": name, "content": written},
                    )["note"]
                    joins.append((name, count, made["id"]))

                joining = signed_in(browser, token, "three")
                wait_for(
                    joining,
                    f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
                    "[three] the space to arrive",
                )
                joining.evaluate(
                    "async () => {"
                    f"  const space = window.nibApp.workspace.spaces.find((one) => one.name === {json.dumps(SPACE)});"
                    "  if (space) await window.nibApp.workspace.showSpace(space.id)"
                    "}"
                )
                for name, count, note_id in joins:
                    wait_for(joining, listed(name), f"[three] {name} to arrive", 120)

                    before = heap(joining)
                    started = time.perf_counter()
                    joining.evaluate(
                        f"async () => {{ await window.nibApp.workspace.openCanvas('/{SPACE}/{name}') }}"
                    )
                    wait_for(
                        joining,
                        f"() => window.nibApp.rooms.joined.has({json.dumps(note_id)})",
                        f"[three] {name} to join its room",
                        90,
                    )
                    took = (time.perf_counter() - started) * 1000
                    say(f"a plane of {count} strokes joined its room in {took:.0f} ms")
                    if took > JOIN_CEILING:
                        failures.append(f"joining {name} took {took:.0f} ms, past {JOIN_CEILING} ms")

                    joining.wait_for_timeout(1500)
                    after = heap(joining)
                    if before and after:
                        say(
                            f"{count} strokes and their room cost the device "
                            f"{(after - before) // 1024} KB"
                        )

                    held = joining.evaluate(
                        """() => {
                            const text = window.nibApp.workspace.active?.doc ?? ''
                            try { return (JSON.parse(text).nib?.ink ?? []).length } catch { return 0 }
                        }"""
                    )
                    if held != count:
                        failures.append(f"{name} came back with {held} strokes rather than {count}")

                    joining.locator("div.canvas").first.screenshot(
                        path=str(SHOTS / f"plane-{count}.png")
                    )
            finally:
                browser.close()
    finally:
        worker.stop()

    if failures:
        print("\nFAILED", flush=True)
        for one_of_them in failures:
            print(f"  - {one_of_them}", flush=True)
        return 1

    print("\ntwo browsers drew on one plane and neither lost a stroke", flush=True)
    return 0


def heap(page: Page) -> int:
    """How much of the heap this page is using, once what can be collected has
    been. Chromium only, and only with the flags this run launches with; zero
    where it cannot be asked."""
    return page.evaluate(
        """() => {
            if (typeof gc === 'function') gc()
            return performance.memory?.usedJSHeapSize ?? 0
        }"""
    )


def big_canvas(strokes: int, per: int) -> str:
    """A canvas file with `strokes` strokes on it, written the way the format
    writes one: flat points, six numbers each.

    Eight points a stroke rather than the twenty a real pen leaves, because the
    format writes a file with one number to a line and twenty would put a plane of
    five thousand strokes past the four megabytes a note may be.
    """
    ink = []
    for at in range(strokes):
        points: list[float] = []
        for step in range(per):
            points += [at * 3 + step * 2, (at % 40) * 12 + step, 0.5, 0, 0, step * 8]
        ink.append({"id": f"s{at}", "tool": "pen", "color": "1", "size": 6, "points": points})

    return (
        json.dumps(
            {
                "nodes": [],
                "edges": [],
                "nib": {
                    "version": 1,
                    "ink": ink,
                    "at": {f"s{at}": 1_700_000_000_000 for at in range(strokes)},
                },
            },
            indent="\t",
        )
        + "\n"
    )


if __name__ == "__main__":
    sys.exit(main())
