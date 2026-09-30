"""What the reader sees of an agent, against a crate in memory, in light and dark.

The browser build has no crate, so a fake one (lib/agents/ui/fake.ts) stands in and says
exactly the news the real one does (docs/agent-native.md 13.1). The drive opens a web
tab, lets an agent act in it, and photographs and checks:

- the frame round the page in the agent's colour, and the agent's spark on the tab,
  turning; both muted once the reader takes the tab, and back on a press on the mark;
- the activity panel on the right: the agent, what it is doing now, its own tab as a
  picture, the session, and a question with Don't allow, Always on this site, Allow -
  and Allow sends the answer and takes the question away;
- a takeover's line and Done under the tab's bar;
- the pairing bubble for a client asking to connect.

Serves the app from a Vite dev server of its own on its own origin, so it builds
nothing and leaves apps/desktop/dist alone, and drives it in headless Chromium. The
activity UI is imported by its module path, which only a dev server answers.

    python apps/desktop/test/e2e/agent-activity.py

Screenshots go beside this file under `shots/agent-activity/`.
"""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
SHOTS = Path(os.environ.get("NIB_SHOTS", HERE / "shots" / "agent-activity"))

PORT = int(os.environ.get("NIB_DRIVE_PORT", "18973"))
ORIGIN = f"http://agent-activity-ui.localhost:{PORT}"

AGENT = "claude-code"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

START = """
async () => {
  const { FakeCrate } = await import('/src/lib/agents/ui/fake.ts')
  const { start } = await import('/src/lib/agents/ui/index.ts')
  const fake = new FakeCrate()
  fake.listen(start(fake))
  window.__fake = fake
}
"""

# A picture of a page for the agent's own tab: drawn here rather than shipped, as the
# engine's screencast would send one, a JPEG in base64.
PICTURE = """
() => {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 300
  const ink = canvas.getContext('2d')
  ink.fillStyle = '#f4f1ea'
  ink.fillRect(0, 0, 480, 300)
  ink.fillStyle = '#1f2937'
  ink.fillRect(0, 0, 480, 44)
  ink.fillStyle = '#e5e7eb'
  ink.font = 'bold 20px sans-serif'
  ink.fillText('Flights', 20, 30)
  ink.fillStyle = '#374151'
  for (let row = 0; row < 5; row++) {
    ink.fillRect(20, 70 + row * 42, 300, 12)
    ink.fillRect(20, 88 + row * 42, 180, 8)
    ink.fillStyle = row === 1 ? '#2563eb' : '#374151'
    ink.fillRect(380, 70 + row * 42, 80, 26)
    ink.fillStyle = '#374151'
  }
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
}
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def serve() -> subprocess.Popen[bytes]:
    say(f"serving the app on {ORIGIN}")
    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", PORT)) == 0:
            raise SystemExit(f"something is already listening on port {PORT}")

    server = subprocess.Popen(
        [
            "node",
            str(APP / "node_modules" / "vite" / "bin" / "vite.js"),
            "--port",
            str(PORT),
            "--strictPort",
            "--host",
            "127.0.0.1",
        ],
        cwd=APP,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    until = time.monotonic() + 60
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.3)

    stop(server)
    raise SystemExit("the dev server never answered")


def stop(server: subprocess.Popen[bytes]) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(server.pid), "/T", "/F"], capture_output=True, check=False
        )
    else:
        server.terminate()
    server.wait(timeout=10)


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return True
        page.wait_for_timeout(50)
    wrong(f"gave up waiting for {what}")
    return False


def settle(page: Page) -> None:
    page.evaluate("() => document.fonts.ready")
    page.wait_for_timeout(250)


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    settle(page)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fake(page: Page, call: str) -> object:
    return page.evaluate(f"() => window.__fake.{call}")


def drive(page: Page, scheme: str) -> None:
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space", 120)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")

    tab = page.evaluate(
        "() => window.nibApp.workspace.openPage('https://shop.example/checkout', 'front')"
    )
    wait_for(page, "document.querySelector('.web .card')", "the web tab's card")
    page.evaluate(START)

    # The agent connects and acts in the reader's tab.
    fake(page, f"connect('{AGENT}', 'Claude Code')")
    fake(page, f"act('{AGENT}', '{tab}', 'browser_open', {{ url: 'https://shop.example/' }})")
    fake(page, f"act('{AGENT}', '{tab}', 'browser_click')")
    if wait_for(page, "document.querySelector('.web .card.acted')", "the frame round the page"):
        colour = page.evaluate(
            "() => getComputedStyle(document.querySelector('.web .card.acted')).outlineColor"
        )
        if "0, 0, 0, 0" in colour:
            wrong(f"the frame has no colour: {colour}")
    wait_for(page, "document.querySelector('.tab .mark.agent.turning')", "the turning mark")
    shot(page, f"{scheme}-01-acting")

    # The reader takes the tab: both go muted, and a press on the mark gives it back.
    fake(page, f"readerTook('{AGENT}', '{tab}')")
    wait_for(page, "document.querySelector('.web .card.acted.resting')", "the muted frame")
    wait_for(page, "document.querySelector('.tab .mark.agent.resting')", "the still mark")
    shot(page, f"{scheme}-02-paused")
    page.click(".tab .mark.agent")
    if not wait_for(page, "document.querySelector('.tab .mark.agent.turning')", "the mark given back"):
        say(f"asked: {page.evaluate('() => window.__fake.asked.slice(-3)')}")

    # The activity panel: an agent tab of its own, a picture of it, and a question.
    own = page.evaluate(
        f"() => window.__fake.open('{AGENT}', 'https://flights.example/', 'Flights to Lisbon').id"
    )
    fake(page, f"act('{AGENT}', '{own}', 'browser_type')")
    page.evaluate("() => window.nibApp.workspace.showPanel('agents')")
    wait_for(page, "document.querySelector('section.agent .name')", "the activity panel")
    wait_for(page, f"window.__fake.watching.includes('{own}')", "the thumbnail being watched")
    picture = page.evaluate(PICTURE)
    page.evaluate(f"(jpeg) => window.__fake.frame('{own}', jpeg)", picture)
    fake(
        page,
        f"ask('{AGENT}', 'paying', 'Place order on shop.example', 'shop.example', '{tab}')",
    )
    wait_for(page, "document.querySelector('.agent .question')", "the question")
    wait_for(page, "document.querySelector('.thumb .picture[style*=\"base64\"]')", "the picture")
    page.evaluate("() => import('/src/lib/agents/ui/index.ts').then((ui) => ui.started().readLog())")
    wait_for(page, "document.querySelectorAll('.agent .call').length >= 3", "the session")

    name = page.evaluate("() => document.querySelector('section.agent .name').textContent")
    if name != "Claude Code":
        wrong(f"the panel names the agent {name!r}")
    badge = page.evaluate("() => document.querySelector('.waiting')?.textContent.trim()")
    if badge != "1":
        wrong(f"the badge on the panel's tab says {badge!r}")
    answers = page.evaluate(
        "() => [...document.querySelectorAll('.agent .question button')].map((b) => b.textContent.trim())"
    )
    if answers != ["Don’t allow", "Allow", "Always on this site"]:
        wrong(f"the question's answers are {answers}")
    shot(page, f"{scheme}-03-panel")

    page.click(".agent .question .rows .nib-button:not(.is-quiet)")
    wait_for(page, "!document.querySelector('.agent .question')", "the answered question to go")
    answered = page.evaluate("() => window.__fake.asked.filter((one) => one.command === 'answer')")
    if not answered or answered[-1]["args"][1] is not True:
        wrong(f"Allow sent {answered}")

    # A takeover: the agent's line under the tab's bar, and Done.
    fake(
        page,
        f"ask('{AGENT}', 'takeover', 'Sign in to finish the order', 'https://shop.example/', '{tab}')",
    )
    wait_for(page, "document.querySelector('.takeover')", "the takeover's line")
    shot(page, f"{scheme}-04-takeover")
    page.click(".takeover .nib-button")
    wait_for(page, "!document.querySelector('.takeover')", "the takeover handed back")

    # A client asking to connect.
    fake(page, "pair('Codex')")
    wait_for(page, "document.querySelector('.pairing')", "the pairing bubble")
    words = page.evaluate("() => document.querySelector('.pairing').textContent")
    if "Codex wants to connect" not in words:
        wrong(f"the pairing bubble says {words!r}")
    shot(page, f"{scheme}-05-pairing")


def main() -> int:
    server = serve()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            for scheme in ("light", "dark"):
                say(f"-- {scheme}")
                context = browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    color_scheme=scheme,
                    reduced_motion="reduce",
                )
                page = context.new_page()
                errors: list[str] = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                drive(page, scheme)
                for error in errors:
                    wrong(f"the page threw: {error}")
                context.close()
            browser.close()
    finally:
        stop(server)

    if failures:
        print(f"{len(failures)} failed")
        return 1
    print("all good")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
