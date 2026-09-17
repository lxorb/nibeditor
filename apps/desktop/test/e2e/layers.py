"""The two layers Emil found dead: the space switcher, and a note's own menu.

Both are opened by a gesture and both are a `.nib-layer` over the panel, and on
2026-09-12 neither answered on an installed app signed in to the account. So this
drives exactly those two gestures - on a desktop and on a phone, against a real
Worker with an account that owns two spaces - and says for each whether the layer
arrived, whether it can be seen, and what the console said while it was asked.

It drives whatever build it is handed, so the same two gestures can be put to the
app that shipped and to the one on main against the same server: that is the whole
question when a client is older than the service it is talking to.

Run it from the repository root:

    python apps/desktop/test/e2e/layers.py

    # and, to put an older build to the same server:
    python apps/desktop/test/e2e/layers.py --also <path to a built dist>

Screenshots go beside this file under `shots/layers/`, which is ignored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SERVICE = ROOT / "services" / "sync"
SHOTS = APP / "test" / "e2e" / "shots" / "layers"

# Above 1425, and not any other drive's port.
PORT = 20530
ORIGIN = f"http://127.0.0.1:{PORT}"

EMAIL = "layers-drive@example.com"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def npx(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [shutil.which("npx") or "npx", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def request(path: str, token: str | None = None, body: object = None, method: str | None = None):
    data = None if body is None else json.dumps(body).encode()
    ask = urllib.request.Request(f"{ORIGIN}{path}", data=data, method=method)
    if token:
        ask.add_header("authorization", f"Bearer {token}")
    if data is not None:
        ask.add_header("content-type", "application/json")

    try:
        with urllib.request.urlopen(ask, timeout=30) as answer:
            said = answer.read().decode()
            return json.loads(said) if said else {}
    except urllib.error.HTTPError as refused:
        said = refused.read().decode()
        return {"status": refused.code, **(json.loads(said) if said else {})}


class Worker:
    """The Worker under wrangler dev, its database, and the account in it. The
    same three first-sync.py and sync.py bring up."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.log = SHOTS / "worker.log"
        self.opened = None
        self.vars: Path | None = None

    def build(self) -> Path:
        say("building main's app against the local Worker")
        environment = {**os.environ, "VITE_NIB_API": ORIGIN, "NODE_ENV": "development"}
        built = subprocess.run(
            [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
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

        return APP / "dist"

    def clean(self) -> None:
        state = SERVICE / ".wrangler" / "state"
        if state.exists():
            say("clearing what the last run left")
            shutil.rmtree(state, ignore_errors=True)

    def migrate(self) -> None:
        say("applying the migrations")
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local", cwd=SERVICE)
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

    def sql(self, statement: str) -> str:
        done = npx(
            "wrangler", "d1", "execute", "nib", "--local", f"--command={statement}", cwd=SERVICE
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

        return done.stdout

    def start(self) -> None:
        say(f"starting the Worker on {ORIGIN}")
        self.vars = SERVICE / ".dev.vars"
        self.vars.write_text("OPENAI_KEY_SECRET=a secret for the drive" + chr(10), "utf-8")

        SHOTS.mkdir(parents=True, exist_ok=True)
        self.opened = self.log.open("wb")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                "--local",
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

        until = time.monotonic() + 180
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
        if self.opened:
            self.opened.flush()
        if not self.log.exists():
            return "(nothing)"

        return "\n".join(self.log.read_text("utf-8", errors="replace").splitlines()[-40:])

    def stop(self) -> None:
        if not self.process:
            return

        say("stopping the Worker")
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

        if self.vars and self.vars.exists():
            self.vars.unlink()

    def account(self, device: str = "the drive") -> tuple[str, str]:
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        self.sql(f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});")
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        self.sql(
            "insert into sessions (token_hash, user_id, created_at, expires_at, id, name,"
            f" last_used_at) values ('{digest}', '{user}', {now}, {now + 86400000},"
            f" '{uuid.uuid4().hex[:16]}', '{device}', {now});"
        )

        return token, user


def look(page, name: str, tag: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}-{tag}.png"))


def panel(page) -> None:
    """The file list, open. A phone opens on the note with the drawer shut, and a
    desktop remembers whichever it was left on, so this is asked for rather than
    assumed."""
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_selector("aside .name", timeout=30000)


def held(page, row) -> None:
    """A finger held still on a row, which is what a right click is on a touch
    screen. Real touch points, because `longPress` reads `event.touches`."""
    row.scroll_into_view_if_needed()
    box = row.bounding_box()
    at = {"x": box["x"] + box["width"] / 2, "y": box["y"] + box["height"] / 2}
    page.evaluate(
        """(at) => {
          const row = document.elementFromPoint(at.x, at.y)?.closest('.nib-row.row')
          if (!row) throw new Error('no row under the finger')
          const touch = new Touch({
            identifier: 1,
            target: row,
            clientX: at.x,
            clientY: at.y,
          })
          row.dispatchEvent(
            new TouchEvent('touchstart', {
              bubbles: true,
              cancelable: true,
              touches: [touch],
              targetTouches: [touch],
              changedTouches: [touch],
            }),
          )
        }""",
        at,
    )
    # `HOLD` in longpress.ts is 500ms; the menu opens on its own from there.
    page.wait_for_timeout(900)


def drive(browser, origin: str, name: str, width, height, agent, finger, token: str) -> list[str]:
    """The two gestures, on one shape of screen. Answers what went wrong."""
    wrong: list[str] = []

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="light",
        device_scale_factor=2,
    )
    context.add_init_script(f"try {{ localStorage.setItem('nib:session', '{token}') }} catch {{}}")

    page = context.new_page()
    page.set_default_timeout(20000)

    def hurt(words: str) -> None:
        wrong.append(f"[{name}] {words}")
        say(f"[{name}] {words}")

    page.on("pageerror", lambda error: hurt(f"PAGE ERROR: {error}"))
    page.on(
        "console",
        lambda one: hurt(f"console {one.type}: {one.text}") if one.type == "error" else None,
    )

    page.goto(origin, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=40000)
    page.wait_for_function("() => !!window.nibApp.account.user", timeout=40000)
    page.wait_for_function(
        "() => window.nibApp.workspace.activeSpace && window.nibApp.sync.status !== 'off'",
        timeout=60000,
    )
    # Two spaces, so the switcher has a list rather than one row.
    page.wait_for_function("() => window.nibApp.workspace.spaces.length >= 2", timeout=60000)

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind.', ws.activeSpace.root)
          await ws.loadTree()
        }"""
    )
    # A note written is a note opened, and on a phone opening one shuts the
    # drawer: the panel is asked for after that has settled, not before.
    page.wait_for_timeout(1500)
    panel(page)
    page.wait_for_timeout(900)
    say(
        f"[{name}] {page.evaluate('() => window.nibApp.workspace.spaces.length')} spaces,"
        f" sync is {page.evaluate('() => window.nibApp.sync.status')},"
        f" panel is {page.evaluate('() => window.nibApp.workspace.panel')!r}"
    )

    # ── The space switcher ────────────────────────────────────────────────
    switcher = page.locator("aside .name")
    if not switcher.count():
        hurt("no switcher on the panel at all")
    else:
        switcher.first.click()
        page.wait_for_timeout(700)
        spaces = page.locator(".spaces")
        seen = bool(spaces.count()) and spaces.first.is_visible()
        rows = page.locator(".spaces .nib-row").count()
        box = spaces.first.bounding_box() if spaces.count() else None
        say(f"[{name}] the switcher: layer={spaces.count()} seen={seen} rows={rows} box={box}")
        if not seen or not rows:
            hurt("THE SWITCHER DID NOT OPEN")
        if box and (box["width"] < 40 or box["height"] < 20):
            hurt(f"the switcher opened with nothing to see: {box}")
        look(page, name, "switcher")
        # And it acts: the space it names is the one that is open. Chosen on the
        # row for the space already showing, so what the list holds after this is
        # still the space the notes were written into.
        page.locator(".spaces .nib-row.is-on").first.click()
        page.wait_for_timeout(700)
        if page.locator(".spaces").count():
            hurt("the switcher did not close on a choice")

    # ── A note's own menu ─────────────────────────────────────────────────
    panel(page)
    page.wait_for_timeout(600)
    rows = page.locator("aside .nib-row.row[data-path]")
    if not rows.count():
        hurt("no rows in the file list")
    else:
        if finger:
            held(page, rows.first)
        else:
            rows.first.click(button="right")
        page.wait_for_timeout(900)

        popup = page.locator("[role=menu].menu")
        there = bool(popup.count()) and popup.first.is_visible()
        items = page.locator("[role=menu].menu [role=menuitem]").count()
        box = popup.first.bounding_box() if popup.count() else None
        say(f"[{name}] the note's menu: layer={popup.count()} seen={there} items={items} box={box}")
        if not there or not items:
            hurt("THE NOTE'S MENU DID NOT OPEN")
        look(page, name, "menu")

        # And it acts: the first row is Open, and it opens the note.
        if there and items:
            page.locator("[role=menu].menu [role=menuitem]").first.click()
            page.wait_for_timeout(800)
            if page.locator("[role=menu].menu").count():
                hurt("the menu did not close on a choice")

    context.close()
    return wrong


SHAPES = [
    ("desktop", 1440, 900, DESKTOP_AGENT, False),
    ("phone", 390, 844, PHONE_AGENT, True),
]


def serve(folder: Path) -> None:
    """The build the Worker is to hand out. It serves `apps/desktop/dist` itself -
    which is what makes the app and the API one origin, and the only arrangement
    the app's own content policy allows: `connect-src` names `'self'` and no
    second port."""
    if folder.resolve() == DIST.resolve():
        return

    # Emptied rather than removed: on Windows the Worker that was serving it may
    # still hold the directory itself for a moment after it is stopped.
    if DIST.exists():
        for one in DIST.iterdir():
            if one.is_dir():
                shutil.rmtree(one, ignore_errors=True)
            else:
                one.unlink(missing_ok=True)
    shutil.copytree(folder, DIST, dirs_exist_ok=True)
    say(f"the Worker will hand out {folder}")


DIST = APP / "dist"


def main() -> int:
    parse = argparse.ArgumentParser()
    parse.add_argument("--also", type=Path, default=None, help="a second built dist to drive")
    said = parse.parse_args()

    SHOTS.mkdir(parents=True, exist_ok=True)
    worker = Worker()
    worker.build()
    kept = SHOTS / "main-dist"
    if kept.exists():
        shutil.rmtree(kept)
    shutil.copytree(DIST, kept)

    worker.clean()
    worker.migrate()

    builds: list[tuple[str, Path]] = [("main", kept)]
    if said.also:
        builds.append(("shipped", said.also.resolve()))

    wrong: list[str] = []
    token: str | None = None

    with sync_playwright() as play:
        browser = play.chromium.launch()
        try:
            for which, folder in builds:
                serve(folder)
                worker.start()
                try:
                    if token is None:
                        token, _user = worker.account()
                        # Two spaces on the account, so the switcher has a list
                        # rather than one row. The app adopts both on its first
                        # reconcile.
                        for label in ("Field notes", "Ledger"):
                            made = request("/v1/spaces", token, {"name": label}, "POST")
                            say(f"the account holds {made.get('space', {}).get('name')!r}")

                    for shape in SHAPES:
                        wrong += drive(
                            browser, ORIGIN, f"{which}-{shape[0]}", *shape[1:], token
                        )
                finally:
                    worker.stop()
        finally:
            browser.close()

    say("")
    if wrong:
        say(f"{len(wrong)} thing(s) went wrong:")
        for one in wrong:
            say(f"  {one}")
        return 1

    say("both layers opened on every shape, and the console stayed quiet")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
