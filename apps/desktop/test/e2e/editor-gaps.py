"""The editor gaps an audit found, driven in the built app.

Seven of them, each one a thing the app claimed and did not do:

- the Links setting reaches the `[[` popup, so a picked link is spelled the way
  every other link the app writes is - in a nested space, where the three markdown
  spellings are three different links
- the card over a `[[link]]` is the linked note, written in where it stands
- an indented block folds, chevron and all
- a block of the note's own HTML that runs draws its click-to-load card in the
  editor, where it used to draw nothing
- a web card on a canvas is the card it is everywhere else, and pressing it loads
  the frame there
- a selection across blocks offers every bulk action, not two
- `[!important]` and `[!caution]` wear Obsidian's looks, and a callout gets its fold
  sign from a row rather than by hand
- a chart asking for a radar gets a radar, and one asking for a kind nib does not
  draw keeps its own characters

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/editor-gaps.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/editor-gaps/`.
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
SHOTS = HERE / "shots" / "editor-gaps"

# This agent's own range, and nothing any other drive listens on.
PORT = 23110
ORIGIN = f"http://127.0.0.1:{PORT}"

DEEP = """# Deep note

Something to point at.

## Next steps

Write it down.

A line that already has a name ^a1b2c3
"""

MONDAY = """# Monday

The first thing to do.
"""

HTML_NOTE = """# Interactive

<div id="counted"></div>
<script>document.getElementById('counted').textContent = 'ran'</script>

After it.
"""

CALLOUTS = """# Callouts

> [!important] Read this one
> the body.

> [!caution] Careful
> mind it.

> [!note] Plain
> the body.
"""

CHARTS = """# Charts

```chart
type: radar
labels: [a, b, c]
series:
  - title: One
    data: [3, 1, 2]
```

```chart
type: bubble
labels: [a]
series:
  - data: [1]
```
"""

SEED = """
async ([deep, monday, html, callouts, charts]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  const paths = {}
  paths.deep = await ws.noteFrom(deep, at('ideas/deep'))
  paths.monday = await ws.noteFrom(monday, at('journal/2026'))
  paths.html = await ws.noteFrom(html, root)
  paths.callouts = await ws.noteFrom(callouts, root)
  paths.charts = await ws.noteFrom(charts, root)

  await ws.loadTree()
  await ws.openEntry(paths.monday, { activate: true })
  return paths
}
"""

ROWS = """
() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((one) =>
  one.textContent.replace(/\\s+/g, ' ').trim(),
)
"""

# The caret on a line of its own at the end of the note, which is where a link is
# about to be written.
FRESH_LINE = """
() => {
  const doc = window.nib.state.doc
  window.nib.dispatch({
    changes: { from: doc.length, insert: '\\n\\n' },
    selection: { anchor: doc.length + 2 },
  })
  window.nib.focus()
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
    """A file server that says nothing and is never cached."""

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


def doc(page: Page) -> str:
    return page.evaluate("() => window.nib.state.doc.toString()")


def rows(page: Page) -> list[str]:
    return page.evaluate(ROWS)


def rows_holding(page: Page, holds: str, patience: float = 12) -> list[str]:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        found = rows(page)
        if any(holds in one for one in found):
            return found
        page.wait_for_timeout(150)

    return rows(page)


def open_note(page: Page, path: str) -> None:
    page.evaluate(
        "(path) => window.nibApp.workspace.openEntry(path, { activate: true })",
        path,
    )
    page.wait_for_timeout(900)


def line(page: Page) -> None:
    page.evaluate(FRESH_LINE)
    page.wait_for_timeout(250)


def heard(message: object) -> None:
    """A console error the app said, and not one somebody else's page did.

    This drive presses a card that loads a real provider's page into a sandboxed
    frame, and that page complains about the permissions it was not granted -
    `compute-pressure is not allowed in this document`, which is the sandbox
    working. A frame's document is not this app's, so what it says on the console is
    the frame's business; anything from the app's own origin is this drive's."""
    if message.type != "error":  # type: ignore[attr-defined]
        return

    where = message.location().get("url", "")  # type: ignore[attr-defined]
    if where and not where.startswith(ORIGIN):
        say(f"[the frame said] {message.text}")  # type: ignore[attr-defined]
        return

    wrong(f"console error: {message.text}")  # type: ignore[attr-defined]


def fresh(browser: Browser) -> tuple[Page, dict[str, str]]:
    context = browser.new_context(
        viewport={"width": 1180, "height": 900},
        color_scheme="light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on("console", lambda message: heard(message))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    paths = page.evaluate(SEED, [DEEP, MONDAY, HTML_NOTE, CALLOUTS, CHARTS])
    say(f"the space holds {json.dumps(sorted(paths))}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)

    open_note(page, paths["monday"])
    return page, paths


# ── The Links setting, in a nested space ──────────────────────────────


def format_to(page: Page, spelling: str) -> None:
    page.evaluate("(one) => window.nibApp.modes.setLinkFormat(one)", spelling)
    page.wait_for_timeout(250)


def picked_link(page: Page, typed: str, label: str) -> str:
    """Types into a fresh line, picks the row whose label matches, and answers with
    the line that was left behind."""
    line(page)
    page.keyboard.type(typed, delay=35)
    page.wait_for_timeout(500)

    found = rows_holding(page, label)
    if not any(label in one for one in found):
        wrong(f"[{typed}] offered no row for {label}: {found}")
        return ""

    # The row is not always the first: an alias and a note can both match.
    for _ in range(len(found)):
        if label in (rows(page)[0] if rows(page) else ""):
            break
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(80)

    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    return doc(page).rstrip("\n").split("\n")[-1]


def drive_links(page: Page, paths: dict[str, str]) -> None:
    open_note(page, paths["monday"])

    wanted = {
        "wikilink": "[[Deep note]]",
        "shortest": "[Deep note](Deep%20note.md)",
        "relative": "[Deep note](../../ideas/deep/Deep%20note.md)",
        "absolute": "[Deep note](ideas/deep/Deep%20note.md)",
    }
    written: dict[str, str] = {}

    for spelling, expected in wanted.items():
        format_to(page, spelling)
        got = picked_link(page, "[[Deep", "Deep note")
        written[spelling] = got
        say(f"[{spelling}] {json.dumps(got)}")
        if got != expected:
            wrong(f"the {spelling} spelling wrote {json.dumps(got)}, not {json.dumps(expected)}")

    shot(page, "01-links-four-spellings")

    three = {written[one] for one in ("shortest", "relative", "absolute")}
    if len(three) != 3:
        wrong(f"the three markdown spellings are not three different links: {three}")

    # A heading picked out of the space-wide list, in the spelling in force.
    format_to(page, "relative")
    heading = picked_link(page, "[[##Next", "Next steps")
    say(f"[[[## relative] {json.dumps(heading)}")
    if heading != "[Deep note](../../ideas/deep/Deep%20note.md#next-steps)":
        wrong(f"a heading picked across the space is not the markdown link: {heading}")

    block = picked_link(page, "[[^^a1b", "^a1b2c3")
    say(f"[[[^^ relative] {json.dumps(block)}")
    if block != "[Deep note](../../ideas/deep/Deep%20note.md#^a1b2c3)":
        wrong(f"a block picked across the space is not the markdown link: {block}")

    shot(page, "02-links-heading-and-block")
    format_to(page, "wikilink")


# ── The card over a link is the note, editable ────────────────────────

CARD = """
() => {
  const card = document.querySelector('.nib-note-preview')
  if (!card) return null

  const body = card.querySelector('.nib-note-preview-body')
  const inner = card.querySelector('.cm-content')
  const box = card.getBoundingClientRect()

  return {
    name: card.querySelector('.nib-note-preview-name')?.textContent ?? '',
    written: body?.dataset.written ?? 'no',
    editor: !!inner,
    said: inner ? inner.textContent.slice(0, 40) : (body?.textContent ?? '').slice(0, 40),
    top: Math.round(box.top),
    height: Math.round(box.height),
  }
}
"""


def drive_hover(page: Page, paths: dict[str, str]) -> None:
    """The note behind a link, and a word of it fixed without opening it.

    The pointer has to rest on the link with the modifier down, which is what says
    "I mean this link"; the card is opened by the editor's own hover, so the drive
    holds the key and puts the pointer where CodeMirror says the link is."""
    away(page)
    open_note(page, paths["monday"])

    page.evaluate(
        """() => {
          const doc = window.nib.state.doc
          const line = '\\n\\nSee [[Deep note]] here.\\n'
          window.nib.dispatch({
            changes: { from: doc.length, insert: line },
            selection: { anchor: 0 },
          })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(700)

    where = page.evaluate(
        """() => {
          const at = window.nib.state.doc.toString().indexOf('Deep note')
          const box = window.nib.coordsAtPos(at + 4)
          return box ? { x: Math.round((box.left + box.right) / 2), y: Math.round((box.top + box.bottom) / 2) } : null
        }"""
    )
    if not where:
        wrong("the link is not on screen")
        return

    page.keyboard.down("Control")
    page.mouse.move(where["x"] - 40, where["y"] + 60)
    page.wait_for_timeout(120)
    page.mouse.move(where["x"], where["y"])
    page.wait_for_timeout(1400)

    card = page.evaluate(CARD)
    say(f"[the card] {json.dumps(card)}")
    shot(page, "16-hover-card")

    if card is None:
        wrong("holding the modifier over a link opened no card")
        page.keyboard.up("Control")
        return
    if card["name"] != "Deep note":
        wrong(f"the card does not name the note it stands for: {card['name']}")
    if not card["editor"] or card["written"] != "yes":
        wrong(f"the card is a reading of the note rather than the note: {card}")
    if "Something to point at" not in card["said"]:
        wrong(f"the card does not hold what the note says: {card['said']}")

    # The caret into the card, which is what keeps it up.
    page.mouse.click(where["x"], where["y"] + 90)
    page.wait_for_timeout(500)
    page.keyboard.up("Control")

    settled = page.evaluate(CARD)
    say(f"[after the press] {json.dumps(settled)}")
    if settled is None:
        wrong("pressing into the card closed it")
        return
    if settled["top"] != card["top"] or settled["height"] != card["height"]:
        wrong(f"the card moved when the caret arrived in it: {card} then {settled}")

    page.keyboard.type(" and a word more", delay=25)
    page.wait_for_timeout(400)

    # The pointer somewhere else entirely: a card with a caret in it stays up.
    page.mouse.move(40, 600)
    page.wait_for_timeout(900)
    stayed = page.evaluate(CARD)
    say(f"[pointer away] {json.dumps(stayed)}")
    shot(page, "17-hover-card-written-in")

    if stayed is None:
        wrong("the card closed while the caret was still in it")
    elif "and a word more" not in stayed["said"]:
        wrong(f"what was typed is not in the card: {stayed['said']}")

    page.keyboard.press("Escape")
    page.wait_for_timeout(1500)
    gone = page.evaluate(CARD)
    say(f"[after Escape] {json.dumps(gone)}")
    shot(page, "18-hover-card-closed")
    if gone is not None:
        wrong("Escape did not put the card away")

    said = page.evaluate(
        "(path) => window.nibApp.workspace.noteText(path)",
        paths["deep"],
    )
    say(f"[the linked note] {json.dumps((said or '')[:80])}")
    if "and a word more" not in (said or ""):
        wrong(f"what was typed in the card never reached the note: {json.dumps(said)}")


# ── An indented block folds ───────────────────────────────────────────

INDENTED = """
() => {
  const doc = window.nib.state.doc
  const text = '\\n\\n  an indented block\\n  a second line\\n  a third\\n'
  window.nib.dispatch({
    changes: { from: doc.length, insert: text },
    selection: { anchor: doc.length + 4 },
  })
  window.nib.focus()
}
"""

CHEVRONS = """
() => [...document.querySelectorAll('.cm-line')].map((line) => ({
  text: line.textContent.slice(0, 24),
  fold: !!line.querySelector('.nib-fold'),
}))
"""


def drive_fold(page: Page, paths: dict[str, str]) -> None:
    open_note(page, paths["monday"])
    page.evaluate(INDENTED)
    page.wait_for_timeout(700)

    marks = page.evaluate(CHEVRONS)
    indented = [one for one in marks if one["text"].strip().startswith("an indented")]
    say(f"[the indented line] {json.dumps(indented)}")
    shot(page, "03-indented-chevron")

    if not indented:
        wrong("the indented block is not on screen at all")
        return
    if not indented[0]["fold"]:
        wrong("the indented block has no chevron in the margin")

    lines = page.evaluate("() => window.nib.state.doc.lines")
    page.evaluate(
        """() => {
          const text = window.nib.state.doc.toString()
          window.nib.dispatch({ selection: { anchor: text.indexOf('an indented') } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(200)
    page.keyboard.press("Control+Alt+BracketLeft")
    page.wait_for_timeout(700)

    folded = page.evaluate(
        "() => [...document.querySelectorAll('.cm-line')].map((one) => one.textContent)"
    )
    say(f"[after folding] {len(folded)} lines on screen of {lines} in the note")
    shot(page, "04-indented-folded")

    if any("a third" in one for one in folded):
        wrong("the indented block did not fold: its last line is still on screen")
    if not any("an indented" in one for one in folded):
        wrong("folding took the line that owns the fold with it")


# ── A block of the note's own HTML ────────────────────────────────────

CARDS = """
() => [...document.querySelectorAll('#write .embed-web')].map((one) => {
  const box = one.getBoundingClientRect()
  return {
    classes: one.className,
    said: one.textContent.replace(/\\s+/g, ' ').trim(),
    height: Math.round(box.height),
    bordered: getComputedStyle(one).borderTopWidth,
    frame: !!one.querySelector('iframe'),
  }
})
"""


def drive_html(page: Page, paths: dict[str, str]) -> None:
    open_note(page, paths["html"])
    page.wait_for_timeout(800)

    found = page.evaluate(CARDS)
    say(f"[the editor's cards] {json.dumps(found)}")
    shot(page, "05-html-card-in-the-editor")

    card = next((one for one in found if "embed-html" in one["classes"]), None)
    if card is None:
        wrong("the editor draws nothing at all for a block of the note's own HTML")
        return
    if card["said"] != "HTML":
        wrong(f"the card does not say what it stands for: {card['said']}")
    if card["height"] < 80:
        wrong(f"the card has no room in it: {card['height']}px")
    if card["frame"]:
        wrong("the frame is there before anybody asked for it")

    page.click("#write .embed-web.embed-html")
    page.wait_for_timeout(900)
    after = page.evaluate(CARDS)
    say(f"[after the press] {json.dumps(after)}")
    shot(page, "06-html-card-loaded")

    loaded = next((one for one in after if "embed-html" in one["classes"]), None)
    if not loaded or not loaded["frame"]:
        wrong("pressing the card loaded no frame")


# ── A web card on a canvas ────────────────────────────────────────────

CANVAS_CARDS = """
() => [...document.querySelectorAll('.card .embed-web')].map((one) => {
  const box = one.getBoundingClientRect()
  return {
    classes: one.className,
    said: one.textContent.replace(/\\s+/g, ' ').trim(),
    height: Math.round(box.height),
    bordered: getComputedStyle(one).borderTopWidth,
    frame: !!one.querySelector('iframe'),
  }
})
"""


def drive_canvas(page: Page) -> None:
    """A card on a canvas holding a web embed: the same card, and a press that
    loads it.

    The plane is written through the workspace rather than drawn by hand, because a
    canvas is a file and what is being checked is the card inside one."""
    away(page)
    page.evaluate(
        """() => {
          const plane = {
            nodes: [
              {
                id: 'one',
                type: 'text',
                x: 40,
                y: 40,
                width: 460,
                height: 320,
                text: '![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
              },
            ],
            edges: [],
          }
          window.nibApp.workspace.openShared(
            { id: 'plane', name: 'Plane.canvas', canvas: true },
            JSON.stringify(plane),
          )
        }"""
    )
    page.wait_for_timeout(1500)

    found = page.evaluate(CANVAS_CARDS)
    say(f"[the canvas's cards] {json.dumps(found)}")
    shot(page, "07-canvas-card")

    if not found:
        wrong("no card on the canvas holds a web embed to press")
        return

    card = found[0]
    if card["bordered"] == "0px":
        wrong("the card on the canvas has none of the card's own rules: no border")
    if card["height"] < 60:
        wrong(f"the card on the canvas is a line rather than a card: {card['height']}px")

    page.click(".card .embed-web")
    page.wait_for_timeout(900)
    after = page.evaluate(CANVAS_CARDS)
    say(f"[after the press] {json.dumps(after)}")
    shot(page, "08-canvas-card-loaded")

    if not after or not after[0]["frame"]:
        wrong("pressing the card on the canvas loaded no frame")


# ── Bulk actions over several blocks ──────────────────────────────────

MENU = """
() => [...document.querySelectorAll('.nib-layer .nib-row')].map((one) =>
  one.textContent.replace(/\\s+/g, ' ').trim(),
)
"""

# The sheet a menu row opens: a field over a list that narrows as it is typed into.
SHEET = """
() => [...document.querySelectorAll('.nib-screen.sheet .found-row')].map((one) =>
  one.textContent.replace(/\\s+/g, ' ').trim(),
)
"""

# Whatever is over the app, gone: a sheet left open puts a scrim over everything
# under it, and the next right-click would land on the scrim.
AWAY = """
() => {
  document.activeElement instanceof HTMLElement && document.activeElement.blur()
  return document.querySelectorAll('.nib-scrim').length
}
"""


def drive_bulk(page: Page, paths: dict[str, str]) -> None:
    open_note(page, paths["monday"])

    page.evaluate(
        """() => {
          const doc = window.nib.state.doc
          const text = 'one\\n\\ntwo\\n\\nthree\\n'
          window.nib.dispatch({
            changes: { from: 0, to: doc.length, insert: text },
            selection: { anchor: 0, head: text.indexOf('three') + 5 },
          })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(500)

    box = page.evaluate(
        """() => {
          const line = [...document.querySelectorAll('.cm-line')].find((one) =>
            one.textContent.trim() === 'two')
          if (!line) return null
          const rect = line.getBoundingClientRect()
          return { x: Math.round(rect.left + 12), y: Math.round(rect.top + rect.height / 2) }
        }"""
    )
    if not box:
        wrong("the three blocks are not on screen")
        return

    page.mouse.click(box["x"], box["y"], button="right")
    page.wait_for_timeout(600)
    offered = page.evaluate(MENU)
    say(f"[the menu over three blocks] {json.dumps(offered)}")
    shot(page, "09-bulk-menu")

    for wanted in ("Turn into", "Indent", "Outdent", "Move up", "Move down", "Duplicate", "Delete"):
        if not any(one == wanted for one in offered):
            wrong(f"the menu over three blocks does not offer {wanted}: {offered}")
    if not any("blocks" in one for one in offered):
        wrong(f"the menu does not say how many blocks it is about: {offered}")

    # Turn into, through the sheet the row opens.
    press_row(page, "Turn into")
    page.wait_for_timeout(900)
    choices = page.evaluate(SHEET)
    say(f"[Turn into] {json.dumps(choices)}")
    shot(page, "10-turn-into")

    for wanted in ("Heading 1", "Bulleted list", "Numbered list", "Task list", "Quote"):
        if not any(wanted in one for one in choices):
            wrong(f"Turn into does not offer {wanted}: {choices}")

    # Typed into rather than pointed at, because narrowing is what the list is for.
    page.keyboard.type("numbered", delay=35)
    page.wait_for_timeout(500)
    narrowed = page.evaluate(SHEET)
    say(f"[Turn into, narrowed] {json.dumps(narrowed)}")
    if len(narrowed) != 1 or "Numbered list" not in narrowed[0]:
        wrong(f"three letters did not narrow the list to the one row: {narrowed}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    written = doc(page)
    say(f"[after Numbered list] {json.dumps(written)}")
    shot(page, "11-turned-into-a-list")

    if "1. one" not in written or "2. two" not in written or "3. three" not in written:
        wrong(f"turning three blocks into a numbered list wrote {json.dumps(written)}")

    # Indent and Move, over the same three.
    page.mouse.click(box["x"], box["y"], button="right")
    page.wait_for_timeout(500)
    press_row(page, "Indent")
    page.wait_for_timeout(700)
    indented = doc(page)
    say(f"[after Indent] {json.dumps(indented)}")
    shot(page, "12-bulk-indented")
    if not indented.startswith(" ") and not indented.startswith("\t"):
        wrong(f"Indent over three blocks indented nothing: {json.dumps(indented)}")


# ── Callouts ──────────────────────────────────────────────────────────

CALLOUT_LOOKS = """
() => [...document.querySelectorAll('.cm-line')]
  .filter((one) => /nib-callout-/.test(one.className))
  .map((one) => ({
    text: one.textContent.replace(/\\s+/g, ' ').trim().slice(0, 28),
    classes: [...one.classList].filter((name) => name.startsWith('nib-callout')).join(' '),
    accent: getComputedStyle(one).getPropertyValue('--callout-accent').trim(),
  }))
"""


def press_row(page: Page, label: str) -> None:
    """Presses the row of the menu that is on screen whose words are exactly these."""
    page.evaluate(
        """(label) => {
          const row = [...document.querySelectorAll('.nib-layer .nib-row')].find(
            (one) => one.textContent.trim() === label)
          if (row instanceof HTMLElement) row.click()
        }""",
        label,
    )


def away(page: Page) -> None:
    """Whatever is over the app, gone. A sheet left open lays a scrim over
    everything under it, and the next press would land on the scrim."""
    for _ in range(3):
        if page.evaluate(AWAY) == 0:
            return
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

    left = page.evaluate(AWAY)
    if left:
        wrong(f"{left} scrims are still over the app")


def drive_callouts(page: Page, paths: dict[str, str]) -> None:
    away(page)
    open_note(page, paths["callouts"])
    page.wait_for_timeout(900)

    looks = page.evaluate(CALLOUT_LOOKS)
    say(f"[the callout lines] {json.dumps(looks)}")
    shot(page, "12-callout-looks")

    important = next((one for one in looks if "Read this one" in one["text"]), None)
    caution = next((one for one in looks if "Careful" in one["text"]), None)

    if important is None or caution is None:
        wrong(f"the two callouts are not drawn: {looks}")
        return

    if "nib-callout-tip" not in important["classes"]:
        wrong(f"[!important] does not wear tip: {important['classes']}")
    if "nib-callout-warning" not in caution["classes"]:
        wrong(f"[!caution] does not wear warning: {caution['classes']}")

    tip = next((one for one in looks if "nib-callout-tip" in one["classes"]), None)
    if tip and important["accent"] != tip["accent"]:
        wrong("[!important] is not the colour tip is")

    # And the fold sign, from a row rather than by hand.
    page.evaluate(
        """() => {
          const text = window.nib.state.doc.toString()
          window.nib.dispatch({ selection: { anchor: text.indexOf('Read this one') } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(300)

    box = page.evaluate(
        """() => {
          const line = [...document.querySelectorAll('.cm-line')].find((one) =>
            one.textContent.includes('Read this one'))
          if (!line) return null
          const rect = line.getBoundingClientRect()
          return { x: Math.round(rect.left + 30), y: Math.round(rect.top + rect.height / 2) }
        }"""
    )
    if not box:
        wrong("the callout being asked about is not on screen")
        return

    page.mouse.click(box["x"], box["y"], button="right")
    page.wait_for_timeout(600)
    offered = page.evaluate(MENU)
    say(f"[the menu on a callout] {json.dumps(offered)}")
    shot(page, "13-callout-menu")

    for wanted in ("Foldable", "Starts folded"):
        if not any(one == wanted for one in offered):
            wrong(f"the menu on a callout does not offer {wanted}: {offered}")

    press_row(page, "Starts folded")
    page.wait_for_timeout(800)
    written = doc(page)
    say(f"[after Starts folded] {json.dumps(written[:80])}")
    shot(page, "14-callout-fold-sign")

    if "[!important]-" not in written:
        wrong(f"the fold sign was not written: {json.dumps(written[:80])}")


# ── Charts ────────────────────────────────────────────────────────────

CHART_SHAPES = """
() => ({
  figures: [...document.querySelectorAll('#write .chart')].map((one) => one.dataset.kind),
  areas: document.querySelectorAll('#write .chart-area').length,
  webs: document.querySelectorAll('#write polygon.chart-grid').length,
  fences: [...document.querySelectorAll('#write .cm-line')].filter((one) =>
    one.textContent.includes('bubble')).length,
})
"""


def drive_charts(page: Page, paths: dict[str, str]) -> None:
    away(page)
    open_note(page, paths["charts"])
    page.wait_for_timeout(1200)

    found = page.evaluate(CHART_SHAPES)
    say(f"[the charts] {json.dumps(found)}")
    shot(page, "15-charts")

    if "radar" not in found["figures"]:
        wrong(f"a radar chart is not drawn as a radar: {found['figures']}")
    if found["areas"] < 1 or found["webs"] < 1:
        wrong(f"the radar has no web and no shape: {found}")
    if "bar" in found["figures"]:
        wrong("a kind nib does not draw came out as a bar chart")
    if found["fences"] == 0:
        wrong("the fence asking for a kind nib does not draw shows nothing at all")


def drive(browser: Browser) -> None:
    page, paths = fresh(browser)

    say("--- the Links setting reaches the popup ---")
    drive_links(page, paths)
    say("--- the card over a link is the note ---")
    drive_hover(page, paths)
    say("--- an indented block folds ---")
    drive_fold(page, paths)
    say("--- a block of the note's own HTML ---")
    drive_html(page, paths)
    say("--- bulk actions over three blocks ---")
    drive_bulk(page, paths)
    say("--- callouts ---")
    drive_callouts(page, paths)
    say("--- charts ---")
    drive_charts(page, paths)
    say("--- a web card on a canvas ---")
    drive_canvas(page)

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

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

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nevery gap the audit found is closed in the built app", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
