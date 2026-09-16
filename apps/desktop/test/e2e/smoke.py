"""Can a person write in it at all.

The smallest drive in the folder, and the only one meant to be run on every
change. Everything the repository gates on today - types, lint, prettier, knip
and the unit suite - is blind to layout and paint by construction: the desktop
app's own `vitest.config.ts` says so in as many words, because jsdom has no
layout. So a note that will not scroll and a `**bold**` that comes out plain
both pass every gate, get merged, and are found by Emil. Both of those shipped.

This drive is the floor under that. It opens the built app in a real browser and
asks the four questions that have to be true before any other question about the
app is worth asking:

  - the words render as the markdown says: bold is bold, a heading is bigger
  - a note longer than the window scrolls
  - a tab switch shows the note the tab names, and nothing of the note before it
  - nothing threw on the way

It is deliberately shallow. Depth belongs in the drive written beside the
feature; what belongs here is the handful of facts whose failure means the app is
not usable at all, checked in the time a pull request can afford. Everything here
must stay cheap enough to gate: no account, no worker, no network.

Run it from the repository root:

    python apps/desktop/test/e2e/smoke.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run, or NIB_ORIGIN
to drive a server somebody else is already running - the dev server on 1420, which
is what a desktop build in development loads from.

One thing this does NOT cover, said here because the gap is easy to miss. The build
it makes is a development build, because `window.nibApp` and `window.nib` - the
handles every drive in this folder steers the app by - are behind
`import.meta.env.DEV`, which a production build folds to false and removes. So the
bundle that actually ships is driven by nothing at all, here or anywhere else in the
repository. Closing that means a define the release build can turn on, and a harness
these ninety drives can share; it is worth doing and it is more than a smoke test.
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
SHOTS = HERE / "shots" / "smoke"

# Not the dev server's 1420, and not another drive's either.
PORT = 18847
#: Where to drive. Its own build by default, served here. `NIB_ORIGIN` points it
#: at a server that is already running instead - the dev server on 1420, or the
#: address a desktop build is loading from - which is how this answers "is what
#: is on that screen the same as what is in main" without a build of its own.
ORIGIN = os.environ.get("NIB_ORIGIN") or f"http://127.0.0.1:{PORT}"
BORROWED = bool(os.environ.get("NIB_ORIGIN"))

#: A note with one of everything this drive asks about, and long enough that it
#: cannot fit in the window: the filler is what makes the scroll question real.
FILLER = "\n\n".join(f"Paragraph {n} of the body, here to make the note tall." for n in range(60))
FIRST = f"# Smoke\n\nA line with **stout** in it, and *slanted* too.\n\n{FILLER}\n"

#: The second note. Its marker never appears in the first, which is what makes
#: "the wrong note's words are on screen" a question with a yes or no answer.
SECOND = "# Second\n\nThe second note says quinine and nothing else.\n"

SEED = """
async ([first, second]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(first, ws.activeSpace.root)
  await ws.noteFrom(second, ws.activeSpace.root)
  await ws.loadTree()
  const named = (start) => ws.notes.find((one) => one.name.startsWith(start))
  await ws.openEntry(named('Smoke').path, { activate: true })
  await ws.openEntry(named('Second').path, { activate: true })
  return ws.notes.length
}
"""

#: Which tab is in front, by the name of the note in it. The drive switches by
#: asking the workspace rather than by clicking a strip whose shape is another
#: drive's business.
SHOW = """
async (start) => {
  const ws = window.nibApp.workspace
  const tab = ws.tabs.find((one) => one.note?.name?.startsWith(start))
  if (!tab) return null
  ws.activate(tab.id)
  return tab.note.name
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
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
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


def show(page: Page, start: str) -> None:
    """Brings the tab on the note whose name starts with `start` to the front,
    and waits for the editor to be showing it."""
    if not page.evaluate(SHOW, start):
        raise SystemExit(f"there is no tab on a note called {start}")

    wait_for(
        page,
        f"window.nibApp.workspace.active?.note?.name?.startsWith({json.dumps(start)})",
        f"the {start} tab to come forward",
    )
    # A switch is a state swap inside one view; the words are there in the frame
    # it happens in, and this is the frame after it.
    page.wait_for_timeout(120)
    # To the top, so what is drawn is the start of the note whatever place the
    # switch put back. The editor only draws the part of a note that is on
    # screen, and reading it is how this drive sees what a person sees.
    page.evaluate("() => { const s = document.querySelector('.cm-scroller'); if (s) s.scrollTop = 0 }")
    page.wait_for_timeout(60)


def weight_of(page: Page, words: str) -> float:
    """The heaviest font-weight any element covering `words` is drawn at.

    Asked of the painted element rather than of the decoration behind it: what
    Emil reported is that bold is not bold on screen, and only the computed style
    answers that. The heaviest, because the word sits inside nested spans and
    only one of them carries the weight."""
    return page.evaluate(
        """
        (words) => {
          const content = document.querySelector('.cm-content')
          if (!content) return 0
          const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
          let heaviest = 0
          for (let node = walk.nextNode(); node; node = walk.nextNode()) {
            if (!node.textContent.includes(words)) continue
            for (let el = node.parentElement; el && el !== content; el = el.parentElement) {
              const weight = parseInt(getComputedStyle(el).fontWeight, 10) || 0
              if (weight > heaviest) heaviest = weight
            }
          }
          return heaviest
        }
        """,
        words,
    )


def drive(browser: Browser) -> None:
    context = browser.new_context(viewport={"width": 1180, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    # A first visit is given a welcome note and the app opens it after the space
    # is there rather than with it, so seeding before that wins the tab for a
    # moment and loses it again. See `restore` in workspace.svelte.ts.
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, [FIRST, SECOND])} notes")
    wait_for(page, "document.querySelector('.cm-content')", "the writing surface")
    # Which code this actually is. Printed rather than checked: the drive's job is
    # to say what it drove, so a passing run against the wrong build cannot be
    # mistaken for a passing run against the right one. See main.ts.
    stamp = page.evaluate("() => window.nibBuild || 'unstamped'")
    say(f"driving build {stamp}")

    show(page, "Smoke")
    shot(page, "01-smoke")

    # ── The words render as the markdown says ────────────────────────────
    stout = weight_of(page, "stout")
    plain = weight_of(page, "A line with")
    if stout < 600:
        wrong(f"**stout** is drawn at weight {stout}, which is not bold")
    elif stout <= plain:
        wrong(f"**stout** at {stout} is no heavier than the line around it at {plain}")
    else:
        say(f"bold is {stout} against {plain} for the line it sits in")

    heading, body = page.evaluate(
        """
        () => {
          const size = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0)
          const content = document.querySelector('.cm-content')
          const lines = [...content.querySelectorAll('.cm-line')]
          const head = lines.find((one) => one.textContent.includes('Smoke'))
          const para = lines.find((one) => one.textContent.startsWith('Paragraph 1'))
          return [size(head), size(para)]
        }
        """
    )
    if heading <= body:
        wrong(f"the heading is {heading}px against {body}px of body text, so it is not a heading")
    else:
        say(f"the heading is {heading}px against {body}px")

    # ── And bold as it is typed, which is what was reported ──────────────
    # The measurement above is of bold that was already in the file. What Emil
    # said is "when I put stuff in ** it doesn't get displayed bold", which is
    # the live preview answering a keystroke - a different code path, and the one
    # a person actually uses. So this types it.
    typed = page.evaluate(
        """
        () => {
          const view = window.nib
          if (!view) return false
          view.dispatch({ selection: { anchor: view.state.doc.length } })
          view.focus()
          return true
        }
        """
    )
    if not typed:
        say("no view handle in this build; the typed-bold question is skipped")
    else:
        page.keyboard.press("Enter")
        page.keyboard.press("Enter")
        page.keyboard.type("Typed **marzipan** here.")
        page.wait_for_timeout(250)
        # The caret is still in the line it was typed on, where a live preview
        # shows the markers. Moving it away is what asks the question.
        page.keyboard.press("Home")
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(300)
        weight = weight_of(page, "marzipan")
        if weight < 600:
            wrong(f"**marzipan** typed into the note is drawn at weight {weight}")
        else:
            say(f"bold typed into the note came out at {weight}")
        shot(page, "01b-typed")

    # ── A note longer than the window scrolls ────────────────────────────
    room = page.evaluate(
        """
        () => {
          const scroller = document.querySelector('.cm-scroller')
          if (!scroller) return null
          return { over: scroller.scrollHeight - scroller.clientHeight, at: scroller.scrollTop }
        }
        """
    )
    if room is None:
        wrong("there is no scroller in the editor at all")
    elif room["over"] <= 1:
        wrong(f"a sixty paragraph note has {room['over']}px to scroll, so it does not scroll")
    else:
        moved = page.evaluate(
            """
            () => {
              const scroller = document.querySelector('.cm-scroller')
              scroller.scrollTop = 400
              return scroller.scrollTop
            }
            """
        )
        if moved < 200:
            wrong(f"the scroller was asked for 400px and went to {moved}px")
        else:
            say(f"the note has {room['over']}px to scroll and went to {moved}px")

        # And with a wheel, which is how a person scrolls. Setting scrollTop only
        # says the scroller CAN move; a wheel says nothing between the pointer and
        # the scroller swallows the gesture, which is a different question and the
        # one Emil asked. The pointer is put over the writing first, because a
        # wheel lands wherever it is.
        page.evaluate("() => { document.querySelector('.cm-scroller').scrollTop = 0 }")
        page.wait_for_timeout(60)
        box = page.evaluate(
            """
            () => {
              const r = document.querySelector('.cm-scroller').getBoundingClientRect()
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
            }
            """
        )
        page.mouse.move(box["x"], box["y"])
        page.mouse.wheel(0, 600)
        page.wait_for_timeout(300)
        wheeled = page.evaluate("() => document.querySelector('.cm-scroller').scrollTop")
        if wheeled < 100:
            wrong(f"a 600px wheel over the note moved it {wheeled}px, so it does not scroll")
        else:
            say(f"a 600px wheel moved the note {wheeled}px")
        shot(page, "02-scrolled")

    # ── A tab switch shows the note the tab names, and nothing before it ──
    # There and back, because a swap that leaks does it on the way back as often
    # as on the way out, and twice because the second switch is the one that has
    # a previous note to leak.
    for name, mine, theirs in [
        ("Second", "quinine", "stout"),
        ("Smoke", "stout", "quinine"),
        ("Second", "quinine", "stout"),
    ]:
        show(page, name)
        # What is on screen, read off the surface rather than out of the view:
        # `window.nib` is only there in a development build and this drive has to
        # say the same thing about the build that ships.
        drawn = page.evaluate("() => document.querySelector('.cm-content')?.innerText ?? ''")
        # And what the app believes the tab holds, which is what would be saved.
        held = page.evaluate(
            "() => window.nibApp.workspace.active?.note?.live?.text?.toString() ?? ''"
        )
        if mine not in drawn:
            wrong(f"the {name} tab does not show its own words")
        if theirs in drawn:
            wrong(f"the {name} tab shows words from the note before it")
        if mine not in held:
            wrong(f"the {name} tab does not hold its own words")
        if theirs in held:
            wrong(f"the {name} tab holds words from the note before it")

    held = page.evaluate(
        """
        () => {
          const ws = window.nibApp.workspace
          return ws.notes.map((one) => one.name).sort()
        }
        """
    )
    if len(held) != len(set(held)):
        wrong(f"the space has two notes under one name: {held}")
    say(f"the tabs kept their own words; the space holds {json.dumps(held)}")
    shot(page, "03-switched")

    context.close()


def main() -> int:
    shutil.rmtree(SHOTS, ignore_errors=True)
    if BORROWED:
        say(f"driving {ORIGIN}, which somebody else is serving")
        server = None
    else:
        build()
        server = serve()

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                drive(browser)
            finally:
                browser.close()
    finally:
        if server:
            server.shutdown()
            server.server_close()

    if failures:
        say(f"{len(failures)} of the floor's questions came back wrong")
        return 1

    say("the floor holds")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
