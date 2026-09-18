"""Embeds, seen: a recording and a film as players, a paper and a plane as cards,
a video from the web as a card that loads nothing until it is clicked, and a
` ```chart ` fence drawn.

The same note in the editor and in the reading view, on a desktop and on a phone,
because the whole claim of this batch is that the two are one design.

The media files themselves are not in the space, so the players draw with nothing
to play: what is under test is that the player is there, the right way round, and
takes the room it should. The web card is checked twice - before a click, that
nothing has been fetched from anybody, and after one, that the frame arrived with
the provider's own sandbox on it.

Run it from the repository root:

    python apps/desktop/test/e2e/embeds.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/embeds/`.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "embeds"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18958
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# Embeds

A recording:

![[take.mp3]]

A film:

![[demo.mp4]]

A paper, at the page the link names:

![[paper.pdf#page=3]]

A plane:

![[Board.canvas]]

A video from the web:

![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)

```chart
type: bar
title: Two quarters
labels: [Jan, Feb, Mar]
series:
  - title: Sales
    data: [3, 5, 2]
  - title: Costs
    data: [1, 2, 1]
```

```chart
type: donut
labels: [Bern, Zug, Chur]
series:
  - data: [4, 2, 1]
```

```chart
not a chart at all
```
"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Embeds'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

# What is on the page, whichever surface it is: the editor writes `nib-` classes
# for the widgets it builds itself and the renderer's own classes for the markup
# it reuses, so both spellings are counted.
COUNTS = """
() => {
  const count = (selector) => document.querySelectorAll(selector).length
  return {
    audio: count('audio.nib-embed-media, audio.embed-media'),
    video: count('video.nib-embed-media, video.embed-media'),
    cards: count('.nib-embed-file, figure.embed-file'),
    web: count('.embed-web'),
    charts: count('.chart-svg'),
    bars: count('rect.chart-bar'),
    slices: count('path.chart-slice'),
    keys: count('.chart-key'),
    frames: count('iframe'),
    // A fence stays code either way, and the two surfaces spell that
    // differently: the reading view writes a `<pre>`, the editor colours the
    // lines where they are.
    code: count('pre, .cm-line.nib-code'),
  }
}
"""

BOXES = """
() => {
  const seen = {}
  for (const [name, selector] of [
    ['audio', 'audio.nib-embed-media, audio.embed-media'],
    ['video', 'video.nib-embed-media, video.embed-media'],
    ['card', '.nib-embed-file, figure.embed-file'],
    ['web', '.embed-web'],
    ['chart', '.chart-svg'],
  ]) {
    const found = document.querySelector(selector)
    if (!found) continue
    const box = found.getBoundingClientRect()
    seen[name] = {
      left: Math.round(box.left),
      width: Math.round(box.width),
      height: Math.round(box.height),
    }
  }
  return seen
}
"""

failures: list[str] = []


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
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
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


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def scroll_to(page: Page, selector: str) -> None:
    """The app scrolls inside a pane rather than the window, so a screenshot of
    the charts has to be asked for by name."""
    page.evaluate(
        """(selector) => {
          document.querySelector(selector)?.scrollIntoView({ block: 'center' })
        }""",
        selector,
    )
    page.wait_for_timeout(500)


def fresh(browser: Browser, finger: bool) -> Page:
    context = browser.new_context(
        viewport={"width": 420, "height": 880} if finger else {"width": 1180, "height": 900},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
            if finger
            else {}
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)
    return page


def asked_for(page: Page) -> list[str]:
    """Every address the page has asked anybody else for."""
    return page.evaluate(
        """() => performance
          .getEntriesByType('resource')
          .map((one) => one.name)
          .filter((name) => !name.startsWith(location.origin))"""
    )


def expect(counts: dict[str, int], where: str) -> None:
    if counts["audio"] != 1:
        wrong(f"{where}: {counts['audio']} audio players, not 1")
    if counts["video"] != 1:
        wrong(f"{where}: {counts['video']} video players, not 1")
    if counts["cards"] != 2:
        wrong(f"{where}: {counts['cards']} file cards, not 2 (a paper and a plane)")
    if counts["web"] != 1:
        wrong(f"{where}: {counts['web']} web cards, not 1")
    if counts["charts"] != 2:
        wrong(f"{where}: {counts['charts']} charts drawn, not 2")
    if counts["bars"] != 6:
        wrong(f"{where}: {counts['bars']} bars, not 6")
    if counts["slices"] != 3:
        wrong(f"{where}: {counts['slices']} donut slices, not 3")
    if counts["keys"] != 5:
        wrong(f"{where}: {counts['keys']} legend keys, not 5 (2 series and 3 slices)")
    if counts["code"] < 1:
        wrong(f"{where}: the fence that is not a chart did not stay code")


def drive(browser: Browser) -> None:
    page = fresh(browser, finger=False)

    counts = page.evaluate(COUNTS)
    say(f"[editor] {json.dumps(counts)}")
    say(f"[editor] boxes {json.dumps(page.evaluate(BOXES))}")
    shot(page, "01-editor")
    expect(counts, "the editor")
    if counts["frames"] != 0:
        wrong(f"the editor loaded {counts['frames']} frames before anybody asked")

    scroll_to(page, ".chart-svg")
    shot(page, "01b-editor-charts")

    outside = asked_for(page)
    say(f"[editor] asked {len(outside)} things of anybody else")
    if outside:
        wrong(f"opening the note fetched from outside: {outside[:4]}")

    # The reading view: the same note, the same design.
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(900)
    read = page.evaluate(COUNTS)
    say(f"[reading] {json.dumps(read)}")
    say(f"[reading] boxes {json.dumps(page.evaluate(BOXES))}")
    shot(page, "02-reading")
    scroll_to(page, ".chart-svg")
    shot(page, "02b-reading-charts")
    scroll_to(page, ".embed-web")
    expect(read, "the reading view")
    if read["frames"] != 0:
        wrong(f"the reading view loaded {read['frames']} frames before anybody asked")

    # A click on the card, and only then a frame.
    page.click(".embed-web")
    page.wait_for_timeout(900)
    frame = page.evaluate(
        """() => {
          const found = document.querySelector('.embed-web iframe')
          if (!found) return null
          const box = found.getBoundingClientRect()
          return {
            src: found.getAttribute('src'),
            sandbox: found.getAttribute('sandbox'),
            allow: found.getAttribute('allow'),
            referrer: found.getAttribute('referrerpolicy'),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }
        }"""
    )
    say(f"[clicked] {json.dumps(frame)}")
    shot(page, "03-clicked")
    if not frame:
        wrong("a click on the card loaded no frame")
    else:
        if "youtube-nocookie.com/embed/dQw4w9WgXcQ" not in (frame["src"] or ""):
            wrong(f"the frame points at {frame['src']}")
        if frame["sandbox"] != "allow-scripts allow-same-origin allow-presentation":
            wrong(f"the frame's sandbox is {frame['sandbox']!r}")
        if frame["referrer"] != "origin":
            wrong(f"the frame tells the provider more than the origin: {frame['referrer']!r}")
        if frame["height"] < 100 or abs(frame["width"] / max(1, frame["height"]) - 16 / 9) > 0.2:
            wrong(f"the frame is not the shape the card was: {frame}")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(500)
    page.context.close()


def finger(browser: Browser) -> None:
    page = fresh(browser, finger=True)

    counts = page.evaluate(COUNTS)
    boxes = page.evaluate(BOXES)
    say(f"[phone editor] {json.dumps(counts)}")
    say(f"[phone editor] boxes {json.dumps(boxes)}")
    shot(page, "10-phone-editor")
    expect(counts, "the phone editor")

    for name, box in boxes.items():
        if box["left"] < 0 or box["left"] + box["width"] > 420:
            wrong(f"on a phone the {name} runs off the screen: {box}")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(900)
    read = page.evaluate(COUNTS)
    phone_boxes = page.evaluate(BOXES)
    say(f"[phone reading] {json.dumps(read)}")
    say(f"[phone reading] boxes {json.dumps(phone_boxes)}")
    shot(page, "11-phone-reading")
    expect(read, "the phone reading view")

    for name, box in phone_boxes.items():
        if box["left"] < 0 or box["left"] + box["width"] > 420:
            wrong(f"on a phone the {name} runs off the screen when read: {box}")

    page.tap(".embed-web")
    page.wait_for_timeout(800)
    shot(page, "12-phone-clicked")
    if page.evaluate("() => document.querySelectorAll('.embed-web iframe').length") != 1:
        wrong("a tap on the card loaded no frame on a phone")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- a pointer ---")
                drive(browser)
                say("--- a finger ---")
                finger(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nmedia plays, files are cards, a chart draws, and nothing loads unasked", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
