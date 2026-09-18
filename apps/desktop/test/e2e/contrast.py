"""Contrast, measured: the high contrast theme the app ships with, on both of its sides.

Contrast was a switch beside the mode, and what it did was restate the palette over
whichever theme was in force. It is a theme now - one of the two the app ships with,
`High contrast` in the Style row and `contrast` in the palette - so what is measured
here is a theme: every colour that has to be read, against the page it is read on, in
the dark and in the light, plus the syntax inside a code fence, which no theme could
reach at all until the four `--syntax-*` tokens existed and which is the reason the
switch existed in the first place.

The theme is chosen through the app itself, `theme.select('contrast')`, because it is
built in: nothing is fetched, nothing is installed, and a first launch with no network
at all is answered with it. The same palette is published as `contrast` in
lxorb/nib-themes for a reader who wants to update it separately, and installing that
copy still works; what this drive measures is the copy that is always there. See
contrast.css in @nib/themes.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/contrast.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/contrast/`.
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
SHOTS = HERE / "shots" / "contrast"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18986
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# What contrast is for

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com)
and a bit of **weight**.

> A quote, which is drawn in the muted colour.

```js
class Kestrel {}
const answer = 41 + 1 // a comment
function shout(word) { return `${word}!` }
```

| Kind | Size |
| --- | ---: |
| Image | 288 |
"""

SEED = """
async ([note]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""

# Every colour that has to be read, against the page it is read on. Measured
# through a probe element so a token written as a hex, an rgb() or a color-mix()
# all come back as the colour the eye gets.
RATIOS = """
(names) => {
  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.opacity = '0'
  document.body.append(probe)

  const colourOf = (token) => {
    probe.style.color = 'red'
    probe.style.color = `var(${token})`
    const said = getComputedStyle(probe).color
    const parts = said.match(/[\\d.]+/g) ?? []
    return parts.slice(0, 3).map(Number)
  }

  const light = ([r, g, b]) => {
    const channel = (one) => {
      const value = one / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const paper = light(colourOf('--bg'))
  const out = {}
  for (const name of names) {
    const ink = light(colourOf(name))
    const [high, low] = ink > paper ? [ink, paper] : [paper, ink]
    out[name] = Math.round(((high + 0.05) / (low + 0.05)) * 10) / 10
  }

  probe.remove()
  return out
}
"""

# What a fence is coloured in. The four `--syntax-*` tokens reach these and
# nothing else does, so this is the assertion the tokens exist for.
CODE = """
() => {
  const found = {}
  for (const span of document.querySelectorAll('.cm-line.nib-code span')) {
    const name = [...span.classList].find((one) => one.startsWith('ͼ')) ?? span.className
    if (name && !found[name]) found[name] = getComputedStyle(span).color
  }
  return found
}
"""

WANTED = [
    "--text",
    "--text-strong",
    "--muted",
    "--muted-strong",
    "--accent",
    "--line",
    "--line-strong",
    "--danger",
    "--success",
]

# The floors the theme has to clear, each against the page the colour is read on.
FLOORS = {
    "--text": 15,
    "--text-strong": 15,
    "--muted": 7,
    "--muted-strong": 9,
    "--accent": 5.5,
    "--line": 3,
    "--line-strong": 4.5,
    "--danger": 4.5,
    "--success": 4.5,
}

# The catalogue is behind nibeditor.com and this run is not about reaching it. A
# console error that is the browser reporting a request nobody could answer is not
# the app going wrong.
TOLERATED = ("nibeditor.com", "Failed to load resource", "net::ERR")

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
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address, so a run cannot photograph the last one."""

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


def listen(page: Page, label: str) -> None:
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error" and not any(one in message.text for one in TOLERATED)
        else None,
    )


def launched(browser: Browser, label: str, forced: bool = False) -> Page:
    """A window, up, with nothing in it yet. What a first launch looks like."""
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="dark",
        forced_colors="none",
        contrast="more" if forced else "no-preference",
    )
    page = context.new_page()
    listen(page, label)
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    return page


def fresh(browser: Browser, label: str, forced: bool = False) -> Page:
    """A window with a note in it, open, which is what the colours are read on."""
    page = launched(browser, label, forced)

    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, [NOTE])}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('What contrast'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page


def ratios(page: Page) -> dict:
    return page.evaluate(RATIOS, WANTED)


def wear_the_theme(page: Page) -> None:
    """Chooses the built-in high contrast theme, which is all it takes: the palette
    ships with the app, so nothing is fetched and nothing is installed."""
    page.evaluate("() => window.nibApp.theme.select('contrast')")
    page.wait_for_timeout(400)

    if page.evaluate("() => window.nibApp.theme.id") != "contrast":
        wrong("the built-in contrast theme could not be chosen")


def scheme(page: Page, which: str) -> None:
    page.evaluate("(which) => window.nibApp.theme.setScheme(which)", which)
    page.wait_for_timeout(400)


def check(page: Page, label: str, floors: dict) -> dict:
    """Every colour against the page it is read on, with the floors the theme has
    to clear."""
    said = ratios(page)
    say(f"[{label}] {json.dumps(said)}")

    for token, floor in floors.items():
        if said.get(token, 0) < floor:
            wrong(f"[{label}] {token} is {said.get(token)}:1 against the page, under {floor}:1")

    return said


def unmarked(page: Page, label: str) -> None:
    """The attribute the switch used to set. Nothing sets it any more, and a theme
    that needed the app's help would be a theme the app was drawing over."""
    if page.evaluate("() => document.documentElement.getAttribute('data-contrast')"):
        wrong(f"[{label}] the page still says it is drawn with more contrast from outside")


def drive_scheme(browser: Browser, which: str, at: int) -> None:
    page = fresh(browser, which)
    scheme(page, which)

    plain = check(page, f"{which}, the built-in", {})
    shot(page, f"{at}-{which}-default")
    code_plain = page.evaluate(CODE)
    unmarked(page, which)

    wear_the_theme(page)
    more = check(page, f"{which}, the contrast theme", FLOORS)
    shot(page, f"{at + 1}-{which}-contrast")
    unmarked(page, which)

    if page.evaluate("() => document.documentElement.dataset.theme") != which:
        wrong(f"[{which}] the page is not wearing the scheme that was asked for")

    for token, was in plain.items():
        if more.get(token, 0) < was:
            wrong(f"[{which}] {token} lost contrast: {was}:1 became {more.get(token)}:1")

    code_more = page.evaluate(CODE)
    say(f"[{which}] the fence: {json.dumps(code_plain)} became {json.dumps(code_more)}")
    if code_plain == code_more:
        wrong(f"[{which}] the syntax in a fence is the same colour under the contrast theme")

    page.context.close()


def drive_settings(browser: Browser) -> None:
    """The Appearance pane asks two questions: which theme, and which side of it.
    Contrast was a third row, and is a theme in the store instead."""
    page = fresh(browser, "settings")
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    # The sheet is fetched the first time it is asked for rather than carried into the
    # first paint, so it arrives a moment after the store says it is open. Waited for,
    # because every question below is about what the pane does not say and a pane that
    # is not there yet says nothing at all. See surfaces.svelte.ts.
    page.wait_for_selector(".nib-screen.sheet", timeout=15000)
    page.wait_for_timeout(600)
    shot(page, "20-appearance")

    rows = page.evaluate(
        "() => [...document.querySelectorAll('.setting')]"
        ".map((row) => row.textContent.trim().slice(0, 40))"
    )
    say(f"[settings] the appearance pane: {json.dumps(rows[:8], ensure_ascii=False)}")

    if not rows:
        wrong("the appearance pane is empty, so what it offers cannot be read")
    # Still not a third row: contrast is one of the answers to "which theme", which is
    # the first of the two questions rather than a question of its own.
    if page.locator("[role='switch']", has_text="More contrast").count():
        wrong("the More contrast switch is back")

    offered = page.evaluate("() => window.nibApp.theme.all.map((one) => one.id)")
    say(f"[settings] the Style row offers {json.dumps(offered)}")
    if offered[:2] != ["default", "contrast"]:
        wrong(f"the two the app ships with are not the first two offered: {offered}")

    page.context.close()


def drive_offered(browser: Browser) -> None:
    """A first launch on a system that asks for more contrast is answered with the
    theme that answers it: chosen, with nothing fetched, and shown where it was chosen
    from so putting it back is one press. Once, and never asked again."""
    page = launched(browser, "offered", forced=True)
    page.wait_for_timeout(800)

    if not page.evaluate("() => window.nibApp.theme.offerContrast"):
        wrong("a system asking for more contrast was not answered")
    # The theme itself, not a card to fetch one from: it ships with the app.
    if page.evaluate("() => window.nibApp.theme.id") != "contrast":
        wrong("the launch did not choose the high contrast theme")
    if page.evaluate("() => localStorage.getItem('nib:theme')") != "contrast":
        wrong("the choice was not written down, so the next launch would forget it")
    if page.evaluate("() => window.nibApp.settings.section") != "appearance":
        wrong("Appearance did not open on the row the theme was chosen from")
    if page.evaluate("() => localStorage.getItem('nib:contrast-offered')") != "yes":
        wrong("the answer was not written down, so it would be given again")
    # And the palette is really on the page, offline, on the first frame there was one.
    said = ratios(page)
    say(f"[offered] {json.dumps(said)}")
    for token, floor in FLOORS.items():
        if said.get(token, 0) < floor:
            wrong(f"[offered] {token} is {said.get(token)}:1 against the page, under {floor}:1")
    shot(page, "30-answered")

    # The same machine, launched again. Still asking for more contrast, and this
    # time it is not asked back.
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.nibApp", "[offered] the app again")
    page.wait_for_timeout(800)

    if page.evaluate("() => window.nibApp.theme.offerContrast"):
        wrong("the answer was given a second time")
    if page.evaluate("() => window.nibApp.theme.id") != "contrast":
        wrong("the theme chosen by the first launch did not survive the second")
    shot(page, "31-not-asked-again")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- dark ---")
                drive_scheme(browser, "dark", 1)
                say("--- light ---")
                drive_scheme(browser, "light", 10)
                say("--- the appearance pane ---")
                drive_settings(browser)
                say("--- offered to a system that asks ---")
                drive_offered(browser)
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

    print("\ncontrast is a theme, and it measures up on both of its sides", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
