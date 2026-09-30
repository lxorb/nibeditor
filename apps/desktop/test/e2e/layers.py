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
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
#: The Worker's own address, which is also where the app it serves is loaded from.
ORIGIN = harness.worker_origin()
APP = harness.APP


EMAIL = "layers-drive@example.com"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
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


class Worker(harness.Worker):
    """The real Worker, with the secret the account's OpenAI key is kept under and
    this drive's account in it; see harness.py."""

    def __init__(self) -> None:
        super().__init__(DRIVE, variables={"OPENAI_KEY_SECRET": "a secret for the drive"})

    def account(self, device: str = "the drive") -> tuple[str, str]:  # type: ignore[override]
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


def main() -> int:
    parse = argparse.ArgumentParser()
    parse.add_argument("--also", type=Path, default=None, help="a second built dist to drive")
    said = parse.parse_args()

    worker = Worker()
    # The build on main first, and then whatever build was handed in, both put to
    # the same Worker and the same account. The Worker hands each out itself, which
    # is what makes the app and the API one origin - the only arrangement the app's
    # own content policy allows: `connect-src` names `'self'` and no second port.
    builds: list[tuple[str, Path | None]] = [("main", None)]
    if said.also:
        builds.append(("shipped", said.also.resolve()))

    wrong: list[str] = []
    token: str | None = None

    with DRIVE.session() as browser:
        for which, folder in builds:
            worker.start(assets=folder)
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
                    wrong += drive(browser, ORIGIN, f"{which}-{shape[0]}", *shape[1:], token)
            finally:
                worker.stop()

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
