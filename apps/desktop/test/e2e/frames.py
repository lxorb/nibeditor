"""Frames, and the policy they run under.

Three claims, one note, and the whole thing served with the app's own
Content-Security-Policy as a header - the same string `src/csp.ts` writes into
`tauri.conf.json`, read back out of the built `index.html` so the drive cannot be
testing a policy the app does not ship.

1. An `<iframe src="…">` a note wrote by hand is the click-to-load card a
   provider's address becomes: nothing fetched until it is pressed, and then a
   sandboxed frame of that page. In the editor and in the reading view.
2. A block of the note's own HTML with a script in it is a card that runs the
   block in a frame of its own when pressed - never in the app - and says how much
   room it needs once it is running. That last part is the proof that the script
   ran at all: the block sets its own height, and the card takes it.
3. Nothing the app already did stops working under the policy. A ` ```js ` fence
   still runs, which is the sharpest test of it there is - the runner is a
   sandboxed `srcdoc` document, and such a document inherits the policy of the
   page that made it. Every violation the browser reports is collected and any one
   of them fails the run.

Run it from the repository root:

    python apps/desktop/test/e2e/frames.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/frames/`.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import subprocess
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, ConsoleMessage, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "frames"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 19305
ORIGIN = f"http://127.0.0.1:{PORT}"

# The page this note frames. Nothing is ever fetched from it - the card is only
# ever pressed once, and what is checked then is the frame's own attributes.
PAGE = "https://frames.example.test/plan?a=1&b=2"

NOTE = f"""# Frames

A page somewhere else, framed by hand:

<iframe src="{PAGE}" height="240"></iframe>

A block that does something:

<div id="dial">nothing yet</div>
<script>
document.getElementById('dial').textContent = 'it ran'
document.body.style.height = '300px'
</script>

A provider the table knows:

![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

And a fence that runs:

```js
console.log('the fence ran')
6 * 7
```
"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Frames'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

COUNTS = """
() => {
  const count = (selector) => document.querySelectorAll(selector).length
  return {
    cards: count('.embed-web'),
    pages: count('.embed-page'),
    blocks: count('.embed-html'),
    frames: count('iframe'),
    // The tag itself, which must never reach the page as a tag.
    tags: document.querySelector('#write')?.innerHTML.includes('<iframe src=') ?? false,
  }
}
"""

FRAME = """
(selector) => {
  const found = document.querySelector(selector + ' iframe')
  if (!found) return null
  const card = found.closest('.embed-web')
  const box = found.getBoundingClientRect()
  return {
    src: found.getAttribute('src'),
    srcdoc: (found.getAttribute('srcdoc') || '').slice(0, 40),
    sandbox: found.getAttribute('sandbox'),
    title: found.getAttribute('title'),
    height: Math.round(box.height),
    asked: card.style.getPropertyValue('--embed-height'),
  }
}
"""

failures: list[str] = []
violations: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
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


def policy() -> str:
    """The app's own policy, read out of the page it ships in.

    Read rather than repeated, so that this drive cannot pass against a policy the
    app does not have."""
    html = (DIST / "index.html").read_text(encoding="utf-8")
    found = re.search(
        r'http-equiv="Content-Security-Policy"\s*content="([^"]*)"', html, re.IGNORECASE
    )
    if not found:
        raise SystemExit("the built index.html declares no policy to serve")

    return re.sub(r"\s+", " ", found.group(1)).strip()


class Quiet(http.server.SimpleHTTPRequestHandler):
    policy = ""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        # The header as well as the meta the page carries, because a served build
        # is the nearest thing to the installed app this drive can stand in. It is
        # the meta form, read out of the page itself: the one directive the header
        # form adds is `frame-ancestors`, which says who may frame this page and so
        # has nothing to do with the frames the page makes, which is all this drive
        # is about. See src/csp.ts.
        self.send_header("Content-Security-Policy", self.policy)
        super().end_headers()


class Strict(socketserver.TCPServer):
    allow_reuse_address = False


def serve(said: str) -> Strict:
    say(f"serving {DIST.name} on {ORIGIN} under the app's own policy")
    Quiet.policy = said
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


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def scroll_to(page: Page, selector: str) -> None:
    page.evaluate(
        """(selector) => {
          document.querySelector(selector)?.scrollIntoView({ block: 'center' })
        }""",
        selector,
    )
    page.wait_for_timeout(400)


def noticed(message: ConsoleMessage) -> None:
    """Every complaint the browser makes about the policy, kept.

    Nothing is excused here any more. The browser used to say `frame-ancestors` was
    ignored on every page load, because the policy named it in a `<meta>` where it
    has no meaning, and this drive stepped over that one line. The policy is now
    written in the two forms its carriers can hold - see src/csp.ts - so the line
    cannot be said, and a filter for it would only be somewhere for the next real
    complaint to hide."""
    text = message.text
    if "Content Security Policy" in text or "Content-Security-Policy" in text:
        violations.append(text)
        say(f"violation: {text[:170]}")


def asked_for(page: Page) -> list[str]:
    """Every address the page has asked anybody else for."""
    return page.evaluate(
        """() => performance
          .getEntriesByType('resource')
          .map((one) => one.name)
          .filter((name) => !name.startsWith(location.origin))"""
    )


def fresh(browser: Browser) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on("console", noticed)
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)
    return page


def drive(browser: Browser) -> None:
    page = fresh(browser)

    # ── The editor ───────────────────────────────────────────────────
    counts = page.evaluate(COUNTS)
    say(f"[editor] {json.dumps(counts)}")
    shot(page, "01-editor")
    # Three, the same three the reading view draws below: the page the note framed by
    # hand, the block of its own HTML, and the video a provider's address becomes.
    # Every card wears `embed-web` and one class of its own beside it; see
    # web-embed.ts and html-block.ts in @nib/markdown.
    if counts["cards"] != 3:
        wrong(f"the editor drew {counts['cards']} cards, not 3 (a page, a block and a video)")
    if counts["pages"] != 1:
        wrong(f"the editor drew {counts['pages']} cards for the tag, not 1")
    if counts["frames"] != 0:
        wrong(f"the editor loaded {counts['frames']} frames before anybody asked")
    if counts["tags"]:
        wrong("the tag itself reached the page")

    outside = asked_for(page)
    if outside:
        wrong(f"opening the note fetched from outside: {outside[:4]}")

    # ── The fence, which is the policy's hardest case ────────────────
    # The runner is a sandboxed srcdoc document, and such a document inherits the
    # policy of the page that made it: if this is quiet, `script-src-elem` is
    # wrong and a feature that used to work has been switched off.
    page.evaluate(
        """() => {
          const at = window.nib.state.doc.toString().indexOf("console.log('the fence ran')")
          window.nib.focus()
          window.nib.dispatch({ selection: { anchor: at + 3 } })
        }"""
    )
    page.wait_for_timeout(300)
    page.keyboard.press("Control+Enter")

    # A sandbox is a browser process coming up, which on a loaded machine is
    # seconds rather than milliseconds; the app itself allows it forty-five.
    lines: list[str] = []
    until = time.monotonic() + 30
    while time.monotonic() < until:
        lines = page.evaluate(
            """() => [...document.querySelectorAll('.nib-run-line')].map((one) => one.textContent)"""
        )
        if len(lines) >= 2:
            break
        page.wait_for_timeout(200)

    say(f"[fence] {json.dumps(lines)}")
    shot(page, "02-fence")
    if not any("the fence ran" in (line or "") for line in lines):
        wrong("the js fence printed nothing: the runner cannot run under this policy")
    if not any("42" in (line or "") for line in lines):
        wrong("the js fence gave back no value")

    # ── The reading view ────────────────────────────────────────────
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    read = page.evaluate(COUNTS)
    say(f"[reading] {json.dumps(read)}")
    shot(page, "03-reading")
    if read["cards"] != 3:
        wrong(f"the reading view drew {read['cards']} cards, not 3")
    if read["blocks"] != 1:
        wrong(f"the reading view drew {read['blocks']} cards for the block, not 1")
    if read["frames"] != 0:
        wrong(f"the reading view loaded {read['frames']} frames before anybody asked")
    if read["tags"]:
        wrong("the tag itself reached the reading view")

    # ── A press on the page's card ──────────────────────────────────
    scroll_to(page, ".embed-page")
    page.click(".embed-page")
    page.wait_for_timeout(900)
    framed = page.evaluate(FRAME, ".embed-page")
    say(f"[page] {json.dumps(framed)}")
    shot(page, "04-page-framed")
    if not framed:
        wrong("a press on the page's card loaded no frame")
    else:
        if framed["src"] != PAGE:
            wrong(f"the frame points at {framed['src']}")
        if framed["sandbox"] != "allow-scripts":
            wrong(f"a page nobody vouched for got the sandbox {framed['sandbox']!r}")
        if framed["title"] != "frames.example.test":
            wrong(f"the frame is titled {framed['title']!r}")
        if abs(framed["height"] - 240) > 4:
            wrong(f"the frame is not the room the tag asked for: {framed['height']}")

    # ── A press on the block's card ─────────────────────────────────
    scroll_to(page, ".embed-html")
    page.click(".embed-html")
    page.wait_for_timeout(1800)
    ran = page.evaluate(FRAME, ".embed-html")
    say(f"[block] {json.dumps(ran)}")
    shot(page, "05-block-running")
    if not ran:
        wrong("a press on the block's card ran nothing")
    else:
        if ran["src"] is not None:
            wrong(f"the block's frame fetched {ran['src']}")
        if "<!doctype html>" not in ran["srcdoc"].lower():
            wrong(f"the block's frame holds {ran['srcdoc']!r}")
        # The one thing that cannot be faked: the block sets its own height, and
        # only a block whose script ran could have asked for 300.
        if ran["asked"].strip() not in {"300px", "301px"}:
            wrong(f"the block asked for {ran['asked']!r}, so its script did not run")
        if ran["sandbox"] != "allow-scripts":
            wrong(f"the block's frame got the sandbox {ran['sandbox']!r}")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    said = policy()
    say(f"the policy is {said[:90]}…")
    server = serve(said)

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                drive(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if violations:
        say(f"{len(violations)} complaint(s) about the policy")
        for one in violations:
            failures.append(f"policy violation: {one[:170]}")

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print(
        "\na tag is a card, a block runs in a sandbox, a fence still runs,"
        " and the policy complained about nothing",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
