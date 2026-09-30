"""The glass theme: what it stands on, and whether every word still reads.

Glass is the theme that wears the platform's material - Mica Alt on Windows 11,
Acrylic on Windows 10 - through the chrome, while every pane keeps its own paper. A translucent theme is the classic way to make an editor
unreadable, so every colour that has to be read is measured against the surface it is
read on, composited over what the window could be standing on.

Two kinds of material, measured two ways (see glass.css):

  - Acrylic is the desk itself, blurred. Measured over the worst
    desks there are: a white one under the dark side, a black one under the light,
    and a busy one that holds both under the same panel. Unblurred, which is worse
    than any material a platform composites.
  - Mica keeps its own brightness and takes only the wallpaper's colour. Measured over
    the band Mica can be: its own flat colours (the tint it falls back to when the
    window is not in front, #202020 and #0a0a0a dark, #f3f3f3 and #dadada light) and
    twenty-six levels past each of them either way for the colour a wallpaper lends it.

A browser has no window for a platform to composite anything behind, so the desk is
painted on `html` and `data-translucent` is said by hand, exactly as material.ts says
it once the crate has answered. What the real Mica looks like behind a real window is
scripts/glass-probe.py, which photographs the probe build.

And the rest of what the theme promises: the paper under the note is opaque, the tab
that is open runs down into it, the reader's accent is still the reader's, and
Appearance has no Translucency row left, since glass is what it meant.

Run it from the repository root:

    python apps/desktop/test/e2e/glass.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/glass/`, which is ignored.
"""

from __future__ import annotations

import functools
import http.server
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
SHOTS = HERE / "shots" / "glass"

# Not the dev server's 1420, and not another drive's either.
PORT = 23811
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# A window with a desk behind it

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com)
and a bit of **weight** in the middle of a sentence that runs on long enough to be
read rather than glanced at.

> A quote, which is drawn in the muted colour - the first thing a wash takes.

- A list, because a list is mostly second-level ink
- And a second line of it
"""

SEED = """
async ([note, name]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const first = ws.notes.find((one) => one.name.startsWith(name))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.notes.length
}
"""


def grey(level: int) -> str:
    return f"rgb({level}, {level}, {level})"


# What the window can be standing on, per material and per side. `paint` is what the
# screenshot shows behind the window; `under` is every backdrop the readings are
# composited over.
DESKS = {
    "acrylic": {
        "dark": {"paint": "#ffffff", "under": [grey(255), grey(0)]},
        "light": {"paint": "#000000", "under": [grey(0), grey(255)]},
        "busy": (
            "radial-gradient(60vw 60vh at 12% 18%, #ff5f6d 0%, transparent 60%),"
            " radial-gradient(70vw 70vh at 78% 22%, #1a2980 0%, transparent 62%),"
            " radial-gradient(55vw 55vh at 30% 82%, #f7ff00 0%, transparent 58%),"
            " linear-gradient(120deg, #ffffff, #2b2f38)"
        ),
    },
    "mica": {
        # Its own two flat colours on this side and the band round them, plus a
        # wallpaper's colour at the brightest end of the band.
        "dark": {
            "paint": "linear-gradient(120deg, #1d2338, #2a1c26)",
            "under": [grey(0), grey(10), grey(32), grey(58), "rgb(22, 30, 72)", "rgb(64, 24, 24)"],
        },
        "light": {
            "paint": "linear-gradient(120deg, #d9dde8, #e8ddd6)",
            "under": [grey(192), grey(218), grey(243), grey(255), "rgb(206, 214, 240)", "rgb(240, 205, 196)"],
        },
    },
}

# What is read, and every layer it is read through, top first. The chrome stands on
# the shell's ground, which is where the wash is; the list adds a layer of its own; a
# row under the pointer adds one more. The paper is a surface of its own and says nothing about the desk.
READINGS = [
    ("text in the bar", "--text", ["--shell-ground"]),
    ("quiet text in the bar", "--muted", ["--shell-ground"]),
    ("text in the list", "--text", ["--side-bar-bg-color", "--shell-ground"]),
    ("quiet text in the list", "--muted", ["--side-bar-bg-color", "--shell-ground"]),
    ("the second quiet level in the list", "--muted-strong", ["--side-bar-bg-color", "--shell-ground"]),
    (
        "quiet text on a row under the pointer",
        "--muted",
        ["--item-hover-bg-color", "--side-bar-bg-color", "--shell-ground"],
    ),
    ("text on the paper", "--text", ["--bg"]),
    ("quiet text on the paper", "--muted", ["--bg"]),
]

# The floor for a word somebody has to read: WCAG's AA for body text, the one the
# app's own palettes are measured against; see the muted rows in tokens.css.
FLOOR = 4.5

# Every layer composited over a backdrop, top last, and the ratio of the ink over
# that. A token may be a hex, an rgb() or a color-mix() with transparent in it, so
# each is read through a probe element; what comes back off `getComputedStyle` is
# `rgb()`, `rgba()` or - for anything that went through color-mix - `color(srgb …)`.
MEASURE = """
([readings, backdrop]) => {
  const probe = document.createElement('span')
  probe.style.position = 'fixed'
  probe.style.opacity = '0'
  document.body.append(probe)

  const parse = (said) => {
    const parts = (said.match(/[\\d.]+/g) ?? []).map(Number)
    const scale = said.startsWith('color(') ? 255 : 1
    return [
      (parts[0] ?? 0) * scale,
      (parts[1] ?? 0) * scale,
      (parts[2] ?? 0) * scale,
      parts.length > 3 ? parts[3] : 1,
    ]
  }

  const colourOf = (token) => {
    probe.style.color = 'rgb(1, 2, 3)'
    probe.style.color = `var(${token})`
    return parse(getComputedStyle(probe).color)
  }

  const over = (top, under) => [0, 1, 2].map((at) => top[at] * top[3] + under[at] * (1 - top[3]))

  const light = ([r, g, b]) => {
    const channel = (one) => {
      const value = one / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }

  const ratio = (a, b) => {
    const [high, low] = light(a) > light(b) ? [a, b] : [b, a]
    return Math.round(((light(high) + 0.05) / (light(low) + 0.05)) * 100) / 100
  }

  const desk = parse(backdrop)
  const out = []
  for (const [what, ink, layers] of readings) {
    let under = desk
    for (const layer of [...layers].reverse()) under = over(colourOf(layer), under)
    out.push([what, ratio(over(colourOf(ink), under), under)])
  }

  probe.remove()
  return out
}
"""

# What a translucent window does to the page, done by hand: the desk is painted where
# the material would be composited, and the page is told what it stands on the way
# material.ts tells it once the crate has answered.
STAND_ON = """
([desk, material]) => {
  document.getElementById('nib-desk')?.remove()
  const style = document.createElement('style')
  style.id = 'nib-desk'
  style.textContent = `html { background: ${desk} !important; background-attachment: fixed !important; }`
  document.head.append(style)
  if (material) document.documentElement.dataset.translucent = material
  else delete document.documentElement.dataset.translucent
}
"""

# A long note, scrolled, with the frames counted: what a theme costs while somebody
# reads is the one thing a screenshot cannot answer. Frames rather than milliseconds
# of work, so the paint is in it.
SCROLL = """
() => new Promise((done) => {
  const scroller = document.querySelector('.cm-scroller')
  if (!scroller) return done(null)

  scroller.scrollTop = 0
  const frames = []
  let last = performance.now()
  let at = 0

  const step = () => {
    const now = performance.now()
    frames.push(now - last)
    last = now

    if (at++ > 90 || scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight) {
      const kept = frames.slice(1).sort((a, b) => a - b)
      return done({
        frames: kept.length,
        median: Math.round(kept[Math.floor(kept.length / 2)] * 100) / 100,
        worst: Math.round(kept[kept.length - 1] * 100) / 100,
        slow: kept.filter((one) => one > 16.7).length,
      })
    }

    scroller.scrollTop += 240
    requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
})
"""

# Every filter that repaints what is behind it on every frame. Glass spends none.
FILTERS = """
() => [...document.querySelectorAll('*')]
  .filter((one) => {
    const style = getComputedStyle(one)
    return style.backdropFilter !== 'none' && style.backdropFilter !== ''
  })
  .map((one) => one.tagName.toLowerCase() + '.' + [...one.classList].join('.'))
"""

# Whether the first frame that has the app in it already wears glass's sheet, which
# is fetched after the launch has started: the sheet worn last time is put on as the
# launch paints and the fetched one replaces it (`SHEET_KEY` in theme.svelte.ts). An
# init script, so it is listening before any of the app has run.
FIRST_FRAME = """
(() => {
  const look = () => {
    const app = document.getElementById('app')
    if (!app || !app.childElementCount) return requestAnimationFrame(look)
    const sheet = document.getElementById('nib-user-theme')
    window.__glassFirstFrame = !!sheet && sheet.textContent.includes('--glass-chrome')
  }
  requestAnimationFrame(look)
})()
"""

TOLERATED = ("nibeditor.com", "Failed to load resource", "net::ERR")

failures: list[str] = []
finished: set[object] = set()


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def shows(what: str, saw: object, wanted: object) -> None:
    if saw == wanted:
        say(f"ok   {what}: {saw!r}")
        return

    failures.append(what)
    say(f"NOT  {what}: {saw!r}, wanted {wanted!r}")


def holds(what: str, ratio: float, floor: float = FLOOR) -> None:
    if ratio >= floor:
        say(f"ok   {what}: {ratio}:1")
        return

    failures.append(what)
    say(f"NOT  {what}: {ratio}:1, under {floor}")


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
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


class Strict(socketserver.ThreadingTCPServer):
    """Threaded, because a context that was closed can leave a keep-alive connection
    open, and with a backlog deep enough for a whole window's worth of assets."""

    allow_reuse_address = False
    daemon_threads = True
    request_queue_size = 128


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


def done_with(page: Page) -> None:
    finished.add(page)
    page.context.close()


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fresh(browser: Browser, scheme: str, note: str = NOTE, name: str = "A window") -> Page:
    context = browser.new_context(
        viewport={"width": 1240, "height": 760},
        color_scheme=scheme,
        device_scale_factor=1,
        reduced_motion="reduce",
    )
    page = context.new_page()
    page.on(
        "pageerror",
        lambda error: failures.append(f"page error: {error}") if page not in finished else None,
    )
    page.on(
        "console",
        lambda message: failures.append(f"console error: {message.text}")
        if message.type == "error"
        and page not in finished
        and not any(one in message.text for one in TOLERATED)
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    if not page.evaluate("() => !!window.nibApp"):
        page.wait_for_timeout(1500)
        if not page.evaluate("() => !!window.nibApp"):
            page.reload(wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    page.evaluate(SEED, [note, name])
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    wait_for(page, "document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(400)
    return page


def choose(page: Page, theme: str) -> None:
    page.evaluate(f"() => window.nibApp.theme.select('{theme}')")
    if theme == "glass":
        wait_for(
            page,
            "getComputedStyle(document.documentElement).getPropertyValue('--glass-chrome')",
            "glass's sheet",
        )
    page.wait_for_timeout(300)


def read_over(page: Page, where: str, unders: list[str]) -> None:
    for under in unders:
        for what, ratio in page.evaluate(MEASURE, [READINGS, under]):
            holds(f"[{where} over {under}] {what}", ratio)


def main() -> int:
    build()
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for scheme in ("dark", "light"):
                    drive(browser, scheme)
                scrolling(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()

    print()
    if failures:
        say(f"{len(failures)} did not hold:")
        for one in failures:
            say(f"  - {one}")
        return 1

    say("every reading held")
    return 0


def drive(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme)

    # The built-in first, over the same desk, for the pair of pictures the change is
    # judged by.
    shot(page, f"{scheme}-default")

    choose(page, "glass")
    shows(f"[{scheme}] glass is worn", page.evaluate("() => window.nibApp.theme.id"), "glass")
    # Glass is a window and not a palette: the reader's accent stays theirs.
    shows(
        f"[{scheme}] the accent is still the reader's to choose",
        page.evaluate("() => window.nibApp.theme.accentIsTheme"),
        False,
    )

    # With nothing to stand on - a browser, which is where glass is not offered - it is
    # a palette like any other, and every word is read on its own ground.
    read_over(page, f"{scheme}, nothing behind", ["rgb(255, 0, 255)"])

    for material, desks in DESKS.items():
        side = desks[scheme]
        page.evaluate(STAND_ON, [side["paint"], material])
        page.wait_for_timeout(300)
        read_over(page, f"{scheme} on {material}", side["under"])
        shot(page, f"{scheme}-glass-{material}")

    # The busiest desk there is, on the material that shows it: what somebody on
    # Windows 10 or a Mac with a photograph behind the window sees.
    page.evaluate(STAND_ON, [DESKS["acrylic"]["busy"], "acrylic"])
    page.wait_for_timeout(300)
    shot(page, f"{scheme}-glass-busy")

    # The paper: opaque under the note, and the tab that is open is that same paper
    # running up into the bar.
    page.evaluate(STAND_ON, [DESKS["mica"][scheme]["paint"], "mica"])
    page.wait_for_timeout(300)
    shows(
        f"[{scheme}] the note stands on paper of its own",
        page.evaluate("() => getComputedStyle(document.querySelector('.pane')).backgroundColor"),
        page.evaluate(
            "() => { const probe = document.createElement('span');"
            " probe.style.color = 'var(--bg)'; document.body.append(probe);"
            " const said = getComputedStyle(probe).color; probe.remove(); return said }"
        ),
    )
    shows(
        f"[{scheme}] and the open tab is filled with the same paper",
        page.evaluate(
            "() => { const one = document.querySelector('.tab.active .fill');"
            " return !!one && getComputedStyle(one).backgroundColor"
            " === getComputedStyle(document.querySelector('.pane')).backgroundColor }"
        ),
        True,
    )
    shows(f"[{scheme}] nothing repaints what is behind it on every frame", page.evaluate(FILTERS), [])

    # Appearance: Style, Mode, the accent under them, and no Translucency row in the
    # Window group any more.
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    page.wait_for_timeout(600)
    rows = page.evaluate(
        "() => [...document.querySelectorAll('.nib-setting')].map((one) => one.textContent.trim())"
    )
    shows(
        f"[{scheme}] Appearance has no Translucency row",
        any("Translucency" in one for one in rows),
        False,
    )
    shot(page, f"{scheme}-glass-settings")

    # A launch that opens on glass wears it from its first frame rather than the
    # built-in's for a moment first. And without the sheet it wore last time it would
    # not, which is said rather than gated: it is what makes the first reading mean
    # something.
    page.add_init_script(FIRST_FRAME)
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.__glassFirstFrame !== undefined", "the first frame")
    shows(
        f"[{scheme}] a launch on glass wears it from its first frame",
        page.evaluate("() => window.__glassFirstFrame"),
        True,
    )
    page.evaluate("() => localStorage.removeItem('nib:theme-sheet')")
    page.reload(wait_until="domcontentloaded")
    wait_for(page, "window.__glassFirstFrame !== undefined", "the first frame")
    say(
        f"     [{scheme}] and without last time's sheet, the first frame wears it: "
        f"{page.evaluate('() => window.__glassFirstFrame')}"
    )

    done_with(page)


def scrolling(browser: Browser) -> None:
    """A long note, scrolled, on the built-in theme and then on glass on a busy desk.
    Said rather than gated: what a frame costs is the machine's business as well as
    the theme's, and a number that fails on somebody's laptop is a number nobody
    trusts. The gate is FILTERS above: no surface asks for a blur."""
    long_note = "# A long note\n\n" + "\n\n".join(
        f"## Section {one}\n\nA paragraph of ordinary words, long enough to wrap and be"
        " read rather than glanced at, which is what a note is mostly made of."
        for one in range(120)
    )

    page = fresh(browser, "dark", note=long_note, name="A long note")

    for what in ("default", "glass"):
        choose(page, what)
        if what == "glass":
            page.evaluate(STAND_ON, [DESKS["acrylic"]["busy"], "acrylic"])
        page.wait_for_timeout(500)
        seen = page.evaluate(SCROLL)
        say(
            f"     scrolling on {what}: {seen['frames']} frames, median {seen['median']}ms,"
            f" worst {seen['worst']}ms, {seen['slow']} over 16.7"
        )

    done_with(page)


if __name__ == "__main__":
    raise SystemExit(main())
