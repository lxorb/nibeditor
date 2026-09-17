"""The note behind a link, glanced at: modifier and hover over a `[[wikilink]]`
and the card that opens is that note - coloured fences with their captions,
callouts with their icons and their fold, tables, maths, task boxes, the note's own
metadata as rows, footnotes, the picture it embeds, the heading a link names.

Emil: "Some things don't render properly in the hover preview, e.g. code blocks."
The card was a second, thinner rendering of the note then. It is not any more: the
card is a small editor on the linked note's own words, drawn by the same live
preview the pane behind it is drawn by and editable for the same reason Obsidian's
is - see hover.ts and preview-card.ts. So the card is compared block for block
against a **pane** showing the same note, not against the reading view: one surface
said twice is the thing worth holding to, and which of the app's two faces it is
comes from what the card is for.

Two faults this file is here to keep from coming back, both of them a card being
almost the pane and not quite. The editor was built with no image resolver, so a
picture the note embedded asked the page for `/shot.png` - the space serves it at
`/asset/<space>/...` - and every picture in every glance was a broken one. And the
card put the caret at character nought, which in a note with metadata is inside the
front matter: an editor shows the block the caret is in as the markdown it is, so a
glance opened on three lines of raw YAML while every block below it drew perfectly.
It read as a renderer that had lost its extensions and was a caret in the wrong
place. CodeMirror also hangs a tooltip off the editor rather than inside its
content, so the card carries `#write` itself - the one scope every prose rule is
written against - and that is checked here too.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be a development one or `window.nib` and `window.nibApp` are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/hover-preview.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/hover-preview/`.
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
SHOTS = HERE / "shots" / "hover-preview"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18969
ORIGIN = f"http://127.0.0.1:{PORT}"

# Every kind of block a note is made of, in the note a link points at.
TARGET = """---
title: Everything
tags:
  - one
  - two
---

# Everything

![[shot.png]]

```ts pipeline.ts
const ink = 'on glass'
export function write(words: string) {
  return ink + words
}
```

> [!tip]- Folds away
> Mind this.

| One | Two |
| --- | --- |
| 1 | 2 |

$$
e = mc^2
$$

- [ ] one
- [x] two

Text[^1].

## Later

Only this much, for a link that names the heading.

[^1]: The note.
"""

SOURCE = """# Glance

A link to [[Everything]] and one to [[Everything#Later]].
"""

SEED = """
async ([target, source]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(target, ws.activeSpace.root)
  await ws.noteFrom(source, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

# Everything a surface drawing a note draws, by the names the live preview gives
# them, and what the browser computed for each. Written once and asked of two
# element trees - the card, and a pane showing the same note - because the whole
# question is whether the card is that surface or a thinner copy of it.
BLOCKS = """
(root) => {
  if (!root) return null

  const fence = root.querySelector('.nib-code')
  const header = root.querySelector('.nib-fence-header')
  const callout = root.querySelector('.nib-callout')
  const table = root.querySelector('table')
  const said = (node) => (node ? getComputedStyle(node) : null)
  const fenceStyle = said(fence)
  const calloutStyle = said(callout)

  // A word in the code that the highlighter gave a colour of its own. Found by
  // colour rather than by class, because which class a token wears is the
  // highlighter's business and changes with the theme.
  const ink = said(root).color
  const token = [...root.querySelectorAll('.nib-code span')].find(
    (one) => one.textContent.trim() && getComputedStyle(one).color !== ink,
  )

  return {
    fence: !!fence,
    caption: root.querySelector('.nib-fence-caption')?.textContent?.trim() ?? null,
    language: root.querySelector('.nib-fence-language')?.textContent?.trim() ?? null,
    header: !!header,
    keyword: token?.textContent?.trim() ?? null,
    keywordColour: token ? getComputedStyle(token).color : null,
    fenceBackground: fenceStyle?.backgroundColor ?? null,
    fenceRadius: fenceStyle?.borderTopLeftRadius ?? null,
    callout: callout ? [...callout.classList].find((one) => one.startsWith('nib-callout-')) : null,
    calloutFolds: !!root.querySelector('.nib-folded, .nib-callout .nib-fold'),
    calloutIcon: !!root.querySelector('.callout-icon'),
    calloutBar: calloutStyle?.borderLeftWidth ?? null,
    table: !!table,
    tableBorders: said(table)?.borderCollapse ?? null,
    maths: !!root.querySelector('.katex'),
    tasks: root.querySelectorAll('.nib-checkbox, input[type=checkbox]').length,
    ticked: root.querySelectorAll('.nib-task-done').length,
    // The first picture that names a file. A surface draws more than one `img` -
    // a widget puts an empty one up while it works out where the file is - so the
    // first element is not the answer; the first address is.
    picture:
      [...root.querySelectorAll('img')].map((one) => one.getAttribute('src')).find(Boolean) ??
      null,
    properties: !!root.querySelector('.nib-properties'),
    propertyKeys: [...root.querySelectorAll('.property-key')].map((one) => one.textContent),
    footnotes: root.querySelectorAll('.nib-footnote').length,
    // Front matter must not reach the words of the note: it is rows, not YAML.
    raw: root.textContent.includes('tags:'),
  }
}
"""

# What the card holds, and the card itself: where it is and how it arrives. The
# reading above is written once and spliced into both of the two below, so the card
# and a pane are asked exactly the same question; see `asking`.
INSIDE = """
() => {
  const card = document.querySelector('.nib-note-preview')
  if (!card) return null

  const body = card.querySelector('.nib-note-preview-body')
  const inner = body.querySelector('.cm-content')
  const box = card.getBoundingClientRect()

  return {
    // The scope: the body is a writing surface, like every other place a note is
    // read or written in this app.
    scope: body.id,
    words: (inner ?? body).textContent.slice(0, 40),
    // The lines inside the card's own box, which is what a reader sees of it. The
    // card holds the whole note - what is typed in it goes back to the file - so
    // where it is scrolled to is what says which part of the note the link named.
    showing: [...body.querySelectorAll('.cm-line')]
      .filter((one) => {
        const line = one.getBoundingClientRect()
        const frame = body.getBoundingClientRect()
        return line.bottom > frame.top + 2 && line.top < frame.bottom - 2
      })
      .map((one) => one.textContent)
      .join(' ')
      .slice(0, 160),
    name: card.querySelector('.nib-note-preview-name')?.textContent ?? null,
    // The card is the note, so there is an editor in it and it can be typed in.
    written: body.dataset.written ?? 'no',
    editor: !!inner,
    editable: inner?.getAttribute('contenteditable') ?? null,
    ...BLOCKS(body),
    animation: getComputedStyle(card).animationName,
    duration: getComputedStyle(card).animationDuration,
    rect: {
      left: Math.round(box.left),
      top: Math.round(box.top),
      right: Math.round(box.right),
      bottom: Math.round(box.bottom),
    },
    window: { width: window.innerWidth, height: window.innerHeight },
  }
}
"""

# The same note in a pane of its own, which is the surface the card claims to be.
PANE_BLOCKS = """
() => {
  const pane = document.querySelector('.cm-content')
  return pane ? BLOCKS(pane) : null
}
"""


def asking(reading: str) -> str:
    """The reading above, spliced into a page function that calls it.

    One definition of what a surface draws, asked of two element trees. Spliced
    rather than passed in, because a function cannot cross into the page: what
    crosses is the text of one, and building it back up in there is `new Function`,
    which is a thing a test should not teach a page to do."""
    return reading.replace("BLOCKS(", f"({BLOCKS.strip()})(")


# What the pane is doing, for when the links in a note are not drawn.
PANE = """
() => {
  const content = document.querySelector('.cm-content')
  const box = content?.getBoundingClientRect()
  return {
    doc: window.nib ? window.nib.state.doc.toString().slice(0, 70) : null,
    height: box ? Math.round(box.height) : null,
    width: box ? Math.round(box.width) : null,
    panes: document.querySelectorAll('.cm-content').length,
    visible: window.nib ? window.nib.visibleRanges.map((one) => [one.from, one.to]) : null,
    html: content ? content.innerHTML.slice(0, 400) : null,
  }
}
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


# The note names a picture on purpose - `![[shot.png]]` is one of the things a
# glance has to draw - and nothing seeds the file, so whatever answers for an
# asset answers 404 for it. That the address was asked for at all is the point:
# the embed resolved, and the drive reads the `src` off the element rather than
# asking the picture to exist. Either responder's words, and the address itself,
# because which of them answers depends on what the page has loaded.
EXCUSED = ("/asset/", "no such file in the space")


def complain(label: str, message: object) -> None:
    if getattr(message, "type", "") != "error":
        return

    text = getattr(message, "text", "")
    where = getattr(getattr(message, "location", None), "get", lambda _k, _d: "")("url", "")
    if any(one in text or one in str(where) for one in EXCUSED):
        return

    wrong(f"[{label}] console error: {text} ({where})")


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


def wait_for(page: Page, expression: str, what: str, patience: float = 60) -> None:
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


def fresh(
    browser: Browser,
    label: str,
    open_note: str = "Glance",
    finger: bool = False,
    still: bool = False,
) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820} if not finger else {"width": 420, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        reduced_motion="reduce" if still else "no-preference",
        **(
            {}
            if not finger
            else {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on("console", lambda message: complain(label, message))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, [TARGET, SOURCE])}")

    # Opened, and asked for again until the note asked for is the note in the
    # pane. Making a note opens it, so the two seeded notes are already opening
    # while this runs, and whichever open lands last is the one that shows; a
    # cold page is slow enough for that to be either of them.
    wait_for(page, "window.nibApp.workspace.notes.length > 1", f"[{label}] the notes")
    for _ in range(6):
        page.evaluate(
            """async (wanted) => {
              const ws = window.nibApp.workspace
              const note = ws.notes.find((one) => one.name.startsWith(wanted))
              await ws.openEntry(note.path, { activate: true })
            }""",
            open_note,
        )
        wait_for(
            page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor"
        )
        page.wait_for_timeout(700)
        if page.evaluate("() => window.nib.state.doc.toString().startsWith('# Glance')"):
            return page

        say(f"[{label}] the pane holds another note; asking again")

    raise SystemExit(f"[{label}] {open_note} never arrived in the pane")


def glance(page: Page, label: str, which: int = 0) -> dict | None:
    """Holds the modifier and rests on a link, which is what opens the card."""
    # Waited for rather than slept past. Two things have to be true before there
    # is anything to rest a pointer on: the pane has to have a size, because
    # CodeMirror decorates what is in view and a surface of no height has nothing
    # in view; and the links in the note have to be drawn.
    wait_for(
        page,
        "document.querySelector('.cm-content').getBoundingClientRect().height > 0",
        f"[{label}] the pane to have a size",
    )
    drawn = f"document.querySelectorAll('.cm-content .nib-link').length > {which}"
    until = time.monotonic() + 30
    while time.monotonic() < until and not page.evaluate(f"() => !!({drawn})"):
        page.wait_for_timeout(100)
    if not page.evaluate(f"() => !!({drawn})"):
        say(f"[{label}] the pane: {json.dumps(page.evaluate(PANE), ensure_ascii=False)}")

    links = page.locator(".cm-content .nib-link")
    found = links.count()
    if found < which + 1:
        wrong(f"[{label}] the note draws {found} links, so there is none to rest on")
        return None

    link = links.nth(which)
    link.scroll_into_view_if_needed()

    page.keyboard.down("Control")
    for attempt in range(3):
        # Away first, then onto the link: the card opens on the pointer coming to
        # rest, and a pointer already sitting where it is asked to go sends no
        # move at all. The second touch is what makes it a rest rather than a
        # crossing, which is what a reader's hand does anyway.
        page.mouse.move(4, 4)
        page.wait_for_timeout(120)
        link.hover()
        page.wait_for_timeout(120)
        # The second touch is what makes it a rest rather than a crossing, which is
        # what a reader's hand does anyway. Forced, because by now the card may
        # already be up and a card stands over the link it was opened from.
        link.hover(position={"x": 3, "y": 3}, force=True)

        try:
            # The frame goes up at once and the note arrives into it; the render
            # is a round trip of its own, so the words are waited for rather than
            # the card.
            page.wait_for_selector(".nib-note-preview-body > *", timeout=10_000)
            break
        except Exception:
            say(f"[{label}] no card on the link yet, resting on it again")
            if attempt == 2:
                page.keyboard.up("Control")
                return None

    page.wait_for_timeout(400)
    inside = page.evaluate(asking(INSIDE))
    page.keyboard.up("Control")
    return inside


def drive_desktop(browser: Browser) -> None:
    page = fresh(browser, "desktop")
    card = glance(page, "desktop")
    if card is None:
        wrong("no hover preview at all on the desktop")
        page.context.close()
        return

    say(f"[desktop] the card: {json.dumps(card, ensure_ascii=False)}")
    shot(page, "01-preview")

    if card["scope"] != "write":
        wrong(f"the card is not a writing surface, so no prose rule reaches it: {card['scope']!r}")
    if card["name"] != "Everything":
        wrong(f"the card does not name the note: {card['name']!r}")

    # The card is the note, not a picture of it: a word of it can be fixed from
    # here. See hover.ts and preview-card.ts.
    if not card["editor"] or card["written"] != "yes":
        wrong(f"the card is a reading of the note rather than the note: {card}")
    if card["editable"] != "true":
        wrong(f"the note in the card cannot be written in: {card['editable']!r}")

    # The blocks Emil could not see.
    if not card["fence"]:
        wrong("a fenced code block came out unframed")
    if card["caption"] != "pipeline.ts":
        wrong(f"the block does not say what it is: {card['caption']!r}")
    if card["language"] != "ts":
        wrong(f"the block is not marked as its language: {card['language']!r}")
    if card["keyword"] is None:
        wrong("nothing in the code block is coloured: the fence was never highlighted")
    if card["callout"] != "nib-callout-tip":
        wrong(f"the callout is a plain quote: {card['callout']!r}")
    if not card["calloutFolds"]:
        wrong("a callout that folds is not foldable here")
    if not card["calloutIcon"]:
        wrong("the callout has no icon")
    if not card["table"]:
        wrong("the table is not a table")
    if not card["maths"]:
        wrong("the maths block was not set")
    if card["tasks"] != 2:
        wrong(f"the task boxes are {card['tasks']}, not two")
    if card["ticked"] != 1:
        wrong(f"the ticked task is not marked done: {card['ticked']} of them")
    # The one thing a glance must not do to a picture: ask the page for it. The
    # space serves what a note embeds at an address of its own.
    if card["picture"] is None:
        wrong("the embedded picture drew no element at all")
    elif "/asset/" not in card["picture"]:
        wrong(f"the picture is not at the space's own address: {card['picture']!r}")
    if not card["properties"]:
        wrong("the note's own metadata is not shown as rows")
    if card["raw"]:
        wrong("the front matter is in the words of the note")
    if not card["footnotes"]:
        wrong("the footnotes were not drawn")

    # It arrives rather than appearing, and it stays on the screen.
    if card["animation"] != "settle-in":
        wrong(f"the card does not settle in: {card['animation']!r}")
    if card["duration"] in ("0s", "0ms"):
        wrong("the card has no motion where motion is wanted")
    rect, window = card["rect"], card["window"]
    if rect["left"] < 0 or rect["right"] > window["width"] + 1:
        wrong(f"the card runs off the side: {rect} in {window}")
    if rect["top"] < 0 or rect["bottom"] > window["height"] + 1:
        wrong(f"the card runs off the bottom: {rect} in {window}")

    # And the same note in a pane of its own, which is the surface the card says it
    # is. Everything the two draw is drawn by one live preview, so a difference here
    # is a card that was built with something the pane has and it has not.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Everything'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib.state.doc.toString().includes('pipeline.ts')", "the note in a pane")
    page.wait_for_timeout(900)
    pane = page.evaluate(asking(PANE_BLOCKS))
    say(f"[desktop] the same note in a pane: {json.dumps(pane, ensure_ascii=False)}")
    shot(page, "02-pane")

    for what in (
        "fence",
        "caption",
        "language",
        "keywordColour",
        "fenceBackground",
        "fenceRadius",
        "callout",
        "calloutIcon",
        "calloutBar",
        "table",
        "tableBorders",
        "maths",
        "tasks",
        "ticked",
        "properties",
        "footnotes",
        "raw",
    ):
        if card[what] != pane[what]:
            wrong(f"{what} differs: the card says {card[what]!r}, a pane {pane[what]!r}")

    # The picture is the one thing the two cannot say the same way - a pane resolves
    # it against the note it has open, and that is the same note here - so it is
    # compared rather than skipped.
    if card["picture"] != pane["picture"]:
        wrong(f"the picture differs: the card {card['picture']!r}, a pane {pane['picture']!r}")

    page.context.close()


def drive_section(browser: Browser) -> None:
    """`[[Everything#Later]]`: the heading's own section and not the note."""
    page = fresh(browser, "section")
    card = glance(page, "section", which=1)
    if card is None:
        wrong("no hover preview over a link that names a heading")
        page.context.close()
        return

    say(f"[section] the card is showing {card['showing']!r}")
    shot(page, "10-section")

    # The whole note is in the card - what is typed there goes back to the file, and
    # a section spliced in at an offset nobody can check is a note rewritten wrong -
    # opened at the part the link named. See `PreviewNote` in hover.ts.
    if "Only this much" not in card["showing"]:
        wrong(f"the card did not open on the heading the link names: {card['showing']!r}")
    if card["raw"]:
        wrong("the front matter is in the words of the note")

    page.context.close()


def drive_still(browser: Browser) -> None:
    """A reader who asked for no motion gets the card without any."""
    page = fresh(browser, "still", still=True)
    card = glance(page, "still")
    if card is None:
        wrong("no hover preview with reduced motion asked for")
        page.context.close()
        return

    say(f"[still] the card settles in over {card['duration']}")
    shot(page, "20-reduced-motion")

    if card["duration"] not in ("0s", "0ms"):
        wrong(f"the card still moves where no motion was asked for: {card['duration']}")
    if not card["fence"]:
        wrong("the card lost its blocks along with its motion")
    if card["raw"]:
        wrong("the front matter is in the words of the note")

    page.context.close()


def drive_finger(browser: Browser) -> None:
    """A phone: there is no modifier and no hover, so there is nothing to open -
    what matters is that nothing breaks and that a card, if one is ever opened,
    stays on a screen this size. Driven with a pointer anyway, which is what a
    phone plugged into a keyboard has."""
    page = fresh(browser, "phone", finger=True)
    card = glance(page, "phone")
    shot(page, "30-phone")

    if card is None:
        say("[phone] no card over a link, which is what a screen with no hover does")
        page.context.close()
        return

    say(f"[phone] the card: {json.dumps(card['rect'])} in {json.dumps(card['window'])}")
    rect, window = card["rect"], card["window"]
    if rect["left"] < 0 or rect["right"] > window["width"] + 1:
        wrong(f"the card runs off the side of a phone: {rect} in {window}")
    if rect["top"] < 0 or rect["bottom"] > window["height"] + 1:
        wrong(f"the card runs off the bottom of a phone: {rect} in {window}")
    if card["scope"] != "write":
        wrong("the card is not a writing surface on a phone")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- a glance at a note ---")
                drive_desktop(browser)
                say("--- a glance at one heading ---")
                drive_section(browser)
                say("--- no motion asked for ---")
                drive_still(browser)
                say("--- a finger ---")
                drive_finger(browser)
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

    print("\nthe note behind a link reads exactly as the note does", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
