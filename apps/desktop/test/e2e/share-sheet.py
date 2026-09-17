"""The Share sheet, in every state it has.

Serves the built web app and photographs the sheet with nobody in the space, with
people in it, with an invitation waiting and somebody asking to be let in, and
with the link off, on, and on with approval - on a desktop in both schemes and on
a phone.

The states are put into the store rather than arranged through a real Worker: what
is being judged here is the surface, and `share.who` is exactly the shape the
Worker answers with. Sharing end to end, against the real thing, is `share.py`
beside this.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/share-sheet.py

Screenshots go beside this file under `shots/share-sheet/`, which is ignored.
"""

from __future__ import annotations

import functools
import http.server
import json
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# Above 1425, and not any other drive's port.
PORT = 18957
ORIGIN = f"http://127.0.0.1:{PORT}"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

# name, width, height, agent, finger, scheme
DEVICES = [
    ("desktop-light", 1440, 900, DESKTOP_AGENT, False, "light"),
    ("desktop-dark", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("phone", 390, 844, PHONE_AGENT, True, "light"),
    ("phone-dark", 390, 844, PHONE_AGENT, True, "dark"),
]

OWNER = {"email": "emil@example.com", "name": "Emil"}

LINK = {"url": "https://nibeditor.com/join/8f2c1d5ab9", "role": "read", "mode": "open"}


def member(email, role="write", pending=False, name=None, guest=None):
    return {"email": email, "guest": guest, "name": name, "role": role, "pending": pending}


def request(email, name, role="write", guest=None):
    return {"email": email, "guest": guest, "name": name, "role": role, "at": 0}


PEOPLE = [
    member("ada@example.com", "write", name="Ada Lovelace"),
    member("grace@example.com", "read"),
    member(None, "write", name="Windows wren", guest="g1"),
]

# name, what the store is handed
STATES = [
    ("empty", {"owner": OWNER, "members": [], "requests": [], "link": None}),
    ("people", {"owner": OWNER, "members": PEOPLE, "requests": [], "link": None}),
    (
        "waiting",
        {
            "owner": OWNER,
            "members": PEOPLE + [member("mary@example.com", "read", pending=True)],
            "requests": [
                request("kat@example.com", "Kat"),
                request(None, "iPhone lark", guest="g2"),
            ],
            "link": {**LINK, "mode": "approval"},
        },
    ),
    ("link-off", {"owner": OWNER, "members": PEOPLE, "requests": [], "link": None}),
    ("link-open", {"owner": OWNER, "members": PEOPLE, "requests": [], "link": LINK}),
    (
        "link-asks",
        {
            "owner": OWNER,
            "members": PEOPLE,
            "requests": [],
            "link": {**LINK, "role": "write", "mode": "approval"},
        },
    ),
]


def say(words: str) -> None:
    print(f"  {words}", flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The same server, without a line per asset."""

    def log_message(self, *args: object) -> None:  # noqa: D102
        return


class Pages:
    """The built page, served."""

    def __init__(self) -> None:
        handler = functools.partial(Quiet, directory=str(APP / "dist"))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()
        say(f"serving {APP / 'dist'} on {ORIGIN}")

    def stop(self) -> None:
        self.server.shutdown()


SHOW = """
(who) => {
  const app = window.nibApp
  app.share.space = app.workspace.activeSpace
  app.share.spaceId = app.workspace.activeSpaceId
  app.share.error = null
  app.share.email = ''
  app.share.wrongAddress = false
  app.share.role = 'write'
  app.share.who = who
  app.share.open = true
}
"""


def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    out.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    page.evaluate("() => { for (let i = 0; i < 12; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")

    # The space wears an icon, so the badge in the sheet's head is drawn by the
    # same component every other icon in the app is: a Lucide stroke in the
    # space's own tint. See SpaceMark.svelte and Icon.svelte.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.setIcon(ws.activeSpaceId, 'notebook-pen', 'teal')
        }"""
    )
    page.wait_for_timeout(300)

    def shot(tag: str) -> None:
        page.screenshot(path=str(out / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    def sheet(tag: str) -> None:
        """The sheet on its own, which is what is being judged."""
        box = page.locator(".sheet").first.bounding_box()
        if not box:
            shot(tag)
            return

        pad = 24
        page.screenshot(
            path=str(out / f"{name}-{tag}.png"),
            clip={
                "x": max(0, box["x"] - pad),
                "y": max(0, box["y"] - pad),
                "width": min(width, box["width"] + pad * 2),
                "height": min(height, box["height"] + pad * 2),
            },
        )
        say(f"shot {name}-{tag}.png")

    # Waiting on the answer, which is the shape of the rows before they land.
    page.evaluate(
        """() => {
          const app = window.nibApp
          app.share.space = app.workspace.activeSpace
          app.share.spaceId = app.workspace.activeSpaceId
          app.share.who = null
          app.share.open = true
        }"""
    )
    page.wait_for_timeout(500)
    sheet("loading")

    for tag, who in STATES:
        page.evaluate(SHOW, who)
        page.wait_for_timeout(450)
        sheet(tag)

    # Something typed in, which is when the send button is there at all.
    page.evaluate(SHOW, STATES[1][1])
    page.wait_for_timeout(300)
    field = page.locator(".compose input").first
    field.click()
    field.type("ada@example.com, bob@")
    page.wait_for_timeout(300)
    sheet("typing")

    # And what it says about something that is not an address.
    field.fill("nonsense")
    page.wait_for_timeout(100)
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    sheet("wrong")

    # What somebody may do, open: the whole of it in one menu.
    page.evaluate(SHOW, STATES[2][1])
    page.wait_for_timeout(400)
    picks = page.locator(".person .pick button")
    if picks.count() > 1:
        picks.nth(1).click(force=True)
        page.wait_for_timeout(400)
        shot("rolemenu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

        # And somebody who has not opened their invitation, whose menu holds the
        # invitation again as well.
        picks.last.click(force=True)
        page.wait_for_timeout(400)
        shot("invitedmenu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    page.evaluate("() => window.nibApp.share.close()")
    context.close()


def main() -> int:
    out = Path(__file__).resolve().parent / "shots" / "share-sheet"

    pages = Pages()
    pages.start()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for one in DEVICES:
                    say(f"--- {one[0]} ---")
                    drive(browser, out, *one)
            finally:
                browser.close()
    finally:
        pages.stop()

    say(f"shots in {out}")
    say(json.dumps(sorted(p.name for p in out.glob('*.png'))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
