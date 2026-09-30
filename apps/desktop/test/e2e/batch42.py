"""Batch 42, seen: one document at a time, the row along the top, and full screen.

Serves the built web app and drives it in Chromium with a phone,
a tablet and a desktop, each with the user agent and the pointer that device
really has - because the device class is decided from those and not from the
width; see deviceFor in apps/desktop/src/lib/viewport.svelte.ts.

Run it from the repository root:

    python apps/desktop/test/e2e/batch42.py

Screenshots go beside this file under `shots/batch42/`. This is a scratch drive
rather than a test: it prints what the page says about itself and photographs it.
"""

from __future__ import annotations

import json

from harness import Drive

DRIVE = Drive(__file__)
say, shot, wait_for = DRIVE.say, DRIVE.shot, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots


PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

DEVICES = [
    ("phone", 390, 844, PHONE_AGENT, True),
    ("tablet", 834, 1194, TABLET_AGENT, True),
    # On its side a tablet docks the file list beside the note, so the drawer's
    # own sidebar button is not there and the bar's is the only one.
    ("tablet-wide", 1194, 834, TABLET_AGENT, True),
    ("desktop", 1440, 900, DESKTOP_AGENT, False),
    # The tick in the browser: the phone's screen with the desktop's user agent
    # and the wide viewport it comes with.
    ("phone-desktop-site", 980, 1743, DESKTOP_AGENT, True),
]

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  await ws.noteFrom('# Thursday\\n\\nWhat the morning holds.', undefined)
  await ws.noteFrom('# Reading\\n\\nA paper about ink.', undefined)
  await ws.loadTree()
  return ws.files.map((one) => one.name)
}
"""

STATE = """
() => {
  const app = window.nibApp
  const root = document.documentElement
  return {
    device: root.dataset.device,
    touch: root.hasAttribute('data-touch'),
    drawer: root.hasAttribute('data-drawer'),
    narrow: root.hasAttribute('data-narrow'),
    finger: matchMedia('(hover: none) and (pointer: coarse)').matches,
    agentMobile: navigator.userAgentData ? navigator.userAgentData.mobile : null,
    tabs: app.workspace.tabs.map((tab) => tab.shown),
    panes: app.workspace.panes.count,
    closed: app.workspace.closed.stack.length,
  }
}
"""


def drive(browser, name: str, width: int, height: int, agent: str, finger: bool) -> dict:
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme="light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate("() => { for (let i = 0; i < 8; i++) history.pushState({ spare: i }, '') }")
    say(f"[{name}] the space holds {page.evaluate(SEED)}")
    page.wait_for_timeout(400)

    # Two notes opened one after the other: on a handheld the second takes the
    # first one's place.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const notes = ws.notes.map((one) => one.path)
          await ws.openEntry(notes[0], { activate: true })
          await ws.openEntry(notes[1], { activate: true })
        }"""
    )
    page.wait_for_timeout(400)
    state = page.evaluate(STATE)
    say(f"[{name}] {json.dumps(state)}")
    shot(page, f"{name}-open")

    # The row along the top, with the file list out.
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)
    shot(page, f"{name}-list")
    page.evaluate("() => window.nibApp.workspace.closePanel?.() ?? (window.nibApp.workspace.panel = null)")
    page.wait_for_timeout(400)

    # The menu the three dots open, or the rail's own button on a desktop.
    trigger = page.locator("header button[aria-label]").last if state["touch"] else None
    if trigger is not None:
        trigger.click()
        page.wait_for_timeout(500)
        shot(page, f"{name}-menu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    # Full screen, and the way back out of it.
    page.evaluate(
        "() => window.nibApp.fullscreen.toggle(window.nibApp.workspace.activeTabId)"
    )
    page.wait_for_timeout(500)
    shot(page, f"{name}-full")
    full = page.evaluate(
        """() => ({
          on: window.nibApp.fullscreen.on,
          bar: !!document.querySelector('header'),
          rail: !!document.querySelector('nav'),
          status: !!document.querySelector('footer'),
          leave: !!document.querySelector('button.leave'),
        })"""
    )
    say(f"[{name}] full screen {json.dumps(full)}")

    page.wait_for_timeout(3000)
    shot(page, f"{name}-full-idle")
    page.evaluate("() => window.nibApp.fullscreen.leave()")
    page.wait_for_timeout(400)
    shot(page, f"{name}-back")

    # A canvas, which is what full screen was asked for: its floating bar has to
    # stay when everything else goes.
    page.evaluate("() => window.nibApp.workspace.createCanvas()")
    page.wait_for_timeout(900)
    shot(page, f"{name}-canvas")
    page.evaluate(
        "() => window.nibApp.fullscreen.toggle(window.nibApp.workspace.activeTabId)"
    )
    page.wait_for_timeout(700)
    shot(page, f"{name}-canvas-full")
    say(
        f"[{name}] the canvas keeps its bar: "
        + str(page.evaluate("() => !!document.querySelector('.bar, .canvas-bar, [data-canvas-bar]')"))
    )
    page.evaluate("() => window.nibApp.fullscreen.leave()")
    page.wait_for_timeout(300)

    context.close()
    return {"state": state, "full": full}


def main() -> int:
    found: dict = {}
    with DRIVE.session() as browser:
        for name, width, height, agent, finger in DEVICES:
            say(f"--- {name} ---")
            found[name] = drive(browser, name, width, height, agent, finger)

    (SHOTS / "found.json").write_text(json.dumps(found, indent=2), encoding="utf8")
    return DRIVE.verdict()


if __name__ == "__main__":
    raise SystemExit(main())
