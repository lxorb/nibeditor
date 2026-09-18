"""Batch P17b, seen in the built app: coloured highlights, the link spelling, and
what a single newline is.

Three claims, each checked against the real editor, the real reading view and the
real stylesheets rather than against a string:

  * A `==\U0001F534 careful==` is drawn in the palette tone the emoji names - in the note
    being written and in the same note read - and the emoji itself is never on the
    page. The marks and the emoji come back the moment the caret is inside, which
    is how every other mark in the preview behaves.
  * The formatting bar's dot opens the six colours, a colour highlights the
    selection, and the one chosen sticks: the bar's own button writes it next time.
  * The Links setting decides what a writer writes and nothing about what is read,
    and the line-break setting reaches the reading view through the one renderer.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/highlights-links-breaks.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/highlights-links-breaks/`.
"""

from __future__ import annotations

import functools
import http.server
import os
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "highlights-links-breaks"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 19214
ORIGIN = f"http://127.0.0.1:{PORT}"

# The five colours Obsidian encodes, and the plain one. The tone each is drawn in
# is highlights.ts in @nib/markdown; the drive asks the page rather than repeating
# it, so a change there fails here instead of being copied.
EMOJI = ["\U0001F534", "\U0001F7E0", "\U0001F7E2", "\U0001F535", "\U0001F7E3"]

NOTE = (
    "# Marking up\n\n"
    "A plain ==highlight== the way every note already holds one.\n\n"
    + "".join(
        f"Careful: =={one} tone {number} mark== in a sentence.\n\n"
        for number, one in enumerate(EMOJI, start=1)
    )
    + "One with ==\U0001F535 **bold** inside== it.\n\n"
    "A last paragraph.\n\n"
    "A closing paragraph, for the keyboard to highlight.\n"
)

# A paragraph hard wrapped in the file, which is the whole of the newline
# question: one paragraph, or three lines?
WRAPPED = (
    "# Wrapped\n\n"
    "A paragraph hard wrapped\nover three lines in the file\nand meant as one.\n\n"
    "The next paragraph.\n"
)

# Something to link to, and a note in a folder to link from, so a relative path
# has somewhere to climb.
PLAN = "# The plan\n\nWhat the plan says.\n"
JOURNAL = "# Monday\n\nA passage worth lifting out into a note of its own.\n\nAnd the rest.\n"

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const one of notes) await ws.noteFrom(one, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

# What the editor drew for each highlight: the tone class it wears, the colour it
# actually paints, and whether the emoji reached the screen.
WRITTEN = """
() => {
  const found = [...document.querySelectorAll('.cm-content .nib-mark')]
  return found.map((one) => ({
    tone: [...one.classList].find((name) => name.startsWith('tone-')) ?? null,
    paint: getComputedStyle(one).backgroundColor,
    shown: one.textContent,
  }))
}
"""

# The same, in the note read rather than written.
READ = """
() => {
  const found = [...document.querySelectorAll('#write mark')]
  return found.map((one) => ({
    tone: one.className || null,
    paint: getComputedStyle(one).backgroundColor,
    shown: one.textContent,
  }))
}
"""

failures: list[str] = []

# The drive prints colour emoji, and a Windows console is code page 1252 until
# somebody says otherwise.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def is_true(claim: bool, what: str) -> None:
    if claim:
        say(f"ok: {what}")
    else:
        wrong(what)


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
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
    say(f"shot {name}.png")


def fresh(browser: Browser, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, [NOTE, WRAPPED, PLAN, JOURNAL])}")
    page.wait_for_timeout(400)
    return page


def open_note(page: Page, starts: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { activate: true })
        }""",
        starts,
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)


def at(page: Page, words: str, offset: int = 0) -> int:
    """Where some words are in the open note."""
    found = page.evaluate("(words) => window.nib.state.doc.toString().indexOf(words)", words)
    if found < 0:
        raise SystemExit(f"the note does not say {words!r}")

    return found + offset


def select(page: Page, anchor: int, head: int) -> None:
    page.evaluate(
        "([anchor, head]) => {"
        "  window.nib.focus();"
        "  window.nib.dispatch({ selection: { anchor, head }, scrollIntoView: true })"
        "}",
        [anchor, head],
    )
    page.wait_for_timeout(300)


def opaque(colour: str) -> bool:
    """Whether a computed colour paints anything at all."""
    if colour in ("", "transparent", "rgba(0, 0, 0, 0)"):
        return False
    return True


def in_the_editor(page: Page) -> None:
    """The note being written in: five tones, five colours, and no emoji on the
    screen."""
    open_note(page, "Marking up")
    # The caret out of the way, so nothing is revealed.
    select(page, at(page, "A last paragraph"), at(page, "A last paragraph"))
    page.wait_for_timeout(300)

    marks = page.evaluate(WRITTEN)
    tones = [one["tone"] for one in marks]
    is_true(len(marks) == 6, f"the editor coloured six highlights, not {len(marks)}")
    is_true(
        tones == ["tone-1", "tone-2", "tone-4", "tone-5", "tone-6", "tone-5"],
        f"each emoji drew its own tone: {tones}",
    )

    painted = {one["tone"]: one["paint"] for one in marks}
    is_true(
        all(opaque(colour) for colour in painted.values()),
        f"every tone paints a colour: {painted}",
    )
    is_true(
        len(set(painted.values())) == 5,
        f"the five tones are five different colours: {sorted(set(painted.values()))}",
    )

    shown = "".join(one["shown"] for one in marks)
    is_true(
        not any(emoji in shown for emoji in EMOJI),
        f"the colour never reached the screen as an emoji: {shown!r}",
    )
    is_true(
        "==" not in page.evaluate("() => document.querySelector('.cm-content').textContent"),
        "the marks are hidden while the caret is away",
    )

    shot(page, "editor-six-tones")

    # The caret inside one of them: the emoji and the marks come back, which is
    # how every other mark in the preview behaves.
    select(page, at(page, "tone 1 mark", 2), at(page, "tone 1 mark", 2))
    page.wait_for_timeout(400)
    line = page.evaluate(
        """() => {
          const at = window.nib.state.selection.main.head
          const line = window.nib.domAtPos(at).node
          const row = line.nodeType === 1 ? line.closest('.cm-line') : line.parentElement.closest('.cm-line')
          return row ? row.textContent : ''
        }"""
    )
    is_true("==" in line, f"the marks come back with the caret inside: {line!r}")
    is_true("\U0001F534" in line, "and so does the colour, so it stays editable")
    shot(page, "editor-revealed")

    # A click on the first word of a coloured highlight: the caret lands in the
    # words, never inside the colour, which has no width and is atomic while it is
    # hidden. Clicked rather than dispatched, because it is the pointer that could
    # land in a mark nobody can see; see snap.ts.
    select(page, at(page, "A last paragraph"), at(page, "A last paragraph"))
    page.wait_for_timeout(300)
    box = page.evaluate(
        """() => {
          const mark = document.querySelector('.cm-content .nib-mark')
          const box = mark.getBoundingClientRect()
          return { x: box.left + 4, y: box.top + box.height / 2 }
        }"""
    )
    page.mouse.click(box["x"], box["y"])
    page.wait_for_timeout(400)
    landed = page.evaluate(
        """() => {
          const at = window.nib.state.selection.main.head
          return window.nib.state.doc.sliceString(at, at + 6)
        }"""
    )
    is_true(
        not any(emoji in landed for emoji in EMOJI),
        f"a click on the words lands in the words, not in the colour: {landed!r}",
    )


def in_the_reading_view(page: Page) -> None:
    """The same note read: the same classes, the same colours, no emoji."""
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('#write mark')", "the note read")
    page.wait_for_timeout(500)

    marks = page.evaluate(READ)
    tones = [one["tone"] for one in marks]
    is_true(
        tones == [None, "tone-1", "tone-2", "tone-4", "tone-5", "tone-6", "tone-5"],
        f"the reading view wears the same classes: {tones}",
    )
    is_true(
        all(opaque(one["paint"]) for one in marks),
        f"and paints every one of them: {[one['paint'] for one in marks]}",
    )
    is_true(
        not any(emoji in one["shown"] for one in marks for emoji in EMOJI),
        "and the emoji is nowhere on the page",
    )
    shot(page, "reading-six-tones")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)


def the_bar(page: Page) -> None:
    """The dot on the formatting bar: it opens the six, one of them highlights the
    selection, and the one chosen sticks."""
    open_note(page, "Marking up")
    before = page.evaluate("() => window.nibApp.modes.highlightTone")
    is_true(before is None, f"nothing is chosen to begin with, so the plain one: {before}")

    select(page, at(page, "A last paragraph"), at(page, "A last paragraph", 6))
    wait_for(page, "document.querySelector('.nib-bar-at')", "the formatting bar")
    shot(page, "bar-actions")

    # The bar is a toolbar with one tab stop and the arrows inside it, and the dot
    # is a button in that row rather than a surface of its own - so it is a stop
    # like every other button and needs no rule of its own. See roving.ts.
    shape = page.evaluate(
        """() => {
          const bar = document.querySelector('.nib-bar-at')
          return { role: bar.getAttribute('role'), label: bar.getAttribute('aria-label') }
        }"""
    )
    is_true(shape["role"] == "toolbar", f"the bar says what it is: {shape}")
    is_true(bool(shape["label"]), "and it is named, since every button on it is one letter")

    dots = page.locator(".nib-bar-at button.swatch")
    is_true(dots.count() == 1, f"one dot beside the actions, not {dots.count()}")
    dots.first.click()
    page.wait_for_timeout(300)
    opened = page.locator(".nib-bar-at button.swatch")
    is_true(opened.count() == 6, f"the dot opens the six colours, not {opened.count()}")
    is_true(
        page.locator(".nib-bar-at button.swatch.bare").count() == 1,
        "and one of them is the highlight with no colour of its own",
    )
    shot(page, "bar-colours")

    # The second dot in the row, which is the first with an emoji behind it.
    opened.nth(1).click()
    page.wait_for_timeout(500)
    text = page.evaluate("() => window.nib.state.doc.toString()")
    is_true(
        "==\U0001F534 A last==" in text,
        f"picking red wrote the markup Obsidian writes: {text[text.index('A last') - 20 :][:40]!r}",
    )
    is_true(
        page.evaluate("() => window.nibApp.modes.highlightTone") == 1,
        "and the colour stuck",
    )

    # The bar's own button now writes that colour without being asked.
    select(page, at(page, "A plain"), at(page, "A plain", 7))
    page.wait_for_timeout(300)
    page.locator('.nib-bar-at button[title="Highlight"]').click()
    page.wait_for_timeout(400)
    text = page.evaluate("() => window.nib.state.doc.toString()")
    is_true("==\U0001F534 A plain==" in text, "the button writes the colour that stuck")

    # A key, not a pointer. Every button on the bar acts on the click rather than
    # on the press, so Enter on one of them formats a word instead of merely
    # focusing it - and a colour is a button on that bar like any other. The arrows
    # move within the one tab stop, which is what makes the dots reachable at all.
    page.evaluate("() => window.nibApp.modes.setHighlightTone(null)")
    select(page, at(page, "A closing"), at(page, "A closing", 9))
    page.wait_for_timeout(300)
    page.locator(".nib-bar-at button.swatch").first.focus()
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    is_true(
        page.locator(".nib-bar-at button.swatch").count() == 6,
        "Enter on the dot opens the colours",
    )

    # The row swapped under the keyboard, so the button it was on has gone. The
    # keyboard has to land on the row that replaced it rather than on the page: a
    # focus on nothing is what takes the bar away on the next selection, which is
    # the one thing `follow` is written to prevent.
    inside = page.evaluate(
        """() => {
          const bar = document.querySelector('.nib-bar-at')
          return bar ? bar.contains(document.activeElement) : false
        }"""
    )
    is_true(inside, "and the keyboard stays in the bar rather than falling to the page")

    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(200)
    moved = page.evaluate(
        """() => {
          const on = document.activeElement
          const dots = [...document.querySelectorAll('.nib-bar-at button.swatch')]
          return dots.indexOf(on)
        }"""
    )
    is_true(moved == 1, f"the arrows step along the colours, landing on {moved}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    text = page.evaluate("() => window.nib.state.doc.toString()")
    is_true("==\U0001F534 A closing==" in text, "and Enter on a colour highlights in it")

    # And the plain one is still reachable, and takes the colour off.
    page.evaluate("() => window.nibApp.modes.setHighlightTone(null)")
    page.wait_for_timeout(200)
    is_true(
        page.evaluate("() => window.nibApp.modes.highlightTone") is None,
        "the plain highlight is one of the six answers",
    )


def the_newline(page: Page) -> None:
    """Whether a single newline breaks the line, in the note as it is read."""
    open_note(page, "Wrapped")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('#write p')", "the note read")
    page.wait_for_timeout(500)

    def breaks() -> int:
        return page.evaluate("() => document.querySelectorAll('#write p br').length")

    is_true(breaks() == 0, f"CommonMark to begin with, so no break: {breaks()}")
    shot(page, "reading-commonmark")

    page.evaluate("() => window.nibApp.modes.toggleHardBreaks()")
    page.wait_for_timeout(900)
    is_true(breaks() == 2, f"the switch breaks the wrapped paragraph: {breaks()}")
    shot(page, "reading-hard-breaks")

    page.evaluate("() => window.nibApp.modes.toggleHardBreaks()")
    page.wait_for_timeout(900)
    is_true(breaks() == 0, "and puts it back")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)


def the_link(page: Page) -> None:
    """The Links setting: what a writer writes, with every spelling still read."""
    open_note(page, "Monday")
    start = at(page, "A passage worth")
    end = at(page, "of its own", 10)

    for spelling, wanted in (
        ("wikilink", "[[A passage worth lifting out into a note of its own]]"),
        # Percent-encoded, because a markdown destination cannot hold a space.
        ("shortest", "](A%20passage%20worth%20lifting%20out%20into%20a%20note%20of%20its%20own.md)"),
    ):
        page.evaluate("(one) => window.nibApp.modes.setLinkFormat(one)", spelling)
        page.wait_for_timeout(200)
        page.evaluate(
            "([from, to]) => window.nibApp.workspace.extractSelection(from, to)",
            [start, end],
        )
        page.wait_for_timeout(900)

        text = page.evaluate("() => window.nib.state.doc.toString()")
        is_true(wanted in text, f"{spelling} wrote {wanted!r}")

        # Put the note back for the next spelling.
        page.evaluate("() => window.nibApp.workspace.undoFileAction()")
        page.wait_for_timeout(700)

    page.evaluate("() => window.nibApp.modes.setLinkFormat('wikilink')")
    page.wait_for_timeout(200)

    # Both spellings still resolve, which is the other half of the claim: the
    # setting decides what is written and nothing about what is read.
    resolved = page.evaluate(
        """() => {
          const links = window.nibApp.links
          const from = window.nibApp.workspace.active.path
          return [
            links.targetOf(from, { kind: 'wikilink', target: 'The plan' }),
            links.targetOf(from, { kind: 'markdown', target: 'The plan.md' }),
          ]
        }"""
    )
    is_true(
        all(one for one in resolved) and resolved[0] == resolved[1],
        f"a wikilink and a markdown link reach the same note: {resolved}",
    )


def drive(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme)
    try:
        in_the_editor(page)
        in_the_reading_view(page)
        the_bar(page)
        the_newline(page)
        the_link(page)
    finally:
        page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for scheme in ("light", "dark"):
                    say(f"--- {scheme} ---")
                    drive(browser, scheme)
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

    print("\nsix colours, one link spelling, one answer about a newline", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
