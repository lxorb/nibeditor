"""The note behind a link, glanced at: modifier and hover over a `[[wikilink]]`
and the card that opens is the reading view of that note - coloured fences with
their captions, callouts with their icons, tables, maths, task boxes, the note's
own metadata as rows, footnotes, the heading a link names.

Emil: "Some things don't render properly in the hover preview, e.g. code blocks."
Two things were wrong and both are checked here. The editor rendered a shown note
itself, with a renderer that has no fence highlighter and no resolvers - so the
card is compared block for block against the reading view of the same note. And
CodeMirror hangs a tooltip off the editor rather than inside its content, so the
card sat outside `#write`, the one scope every prose rule is written against - so
the colours and the frames in the card are compared against the reading view's
own, computed.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

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

![[shot.png]]

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

# What the card holds, and what the browser computed for the things in it. Read
# off the card rather than off the note, because the whole question is whether the
# rules reached this element tree at all.
INSIDE = """
() => {
  const card = document.querySelector('.nib-note-preview')
  if (!card) return null

  const body = card.querySelector('.nib-note-preview-body')
  const fence = body.querySelector('figure.code')
  const keyword = body.querySelector('.hl-keyword')
  const pre = body.querySelector('pre')
  const callout = body.querySelector('[data-callout]')
  const table = body.querySelector('table')
  const box = card.getBoundingClientRect()

  const said = (node) => (node ? getComputedStyle(node) : null)
  const preStyle = said(pre)
  const calloutStyle = said(callout)

  return {
    // The scope: the body is a writing surface, like the reading view's page.
    scope: body.id,
    words: body.textContent.slice(0, 40),
    name: card.querySelector('.nib-note-preview-name')?.textContent ?? null,
    fence: !!fence,
    caption: fence?.querySelector('figcaption')?.textContent ?? null,
    language: fence?.querySelector('code')?.className ?? null,
    keyword: keyword?.textContent ?? null,
    keywordColour: keyword ? getComputedStyle(keyword).color : null,
    preBackground: preStyle?.backgroundColor ?? null,
    preRadius: preStyle?.borderTopLeftRadius ?? null,
    callout: callout?.dataset.callout ?? null,
    calloutFolds: callout?.tagName ?? null,
    calloutIcon: !!body.querySelector('.callout-icon'),
    calloutBar: calloutStyle?.borderLeftWidth ?? null,
    table: !!table,
    tableBorders: said(table)?.borderCollapse ?? null,
    maths: !!body.querySelector('.katex'),
    tasks: body.querySelectorAll('input[type=checkbox]').length,
    ticked: body.querySelectorAll('.task-list-item.is-done').length,
    inert: [...body.querySelectorAll('input[type=checkbox]')].every((one) => one.disabled),
    picture: body.querySelector('img')?.getAttribute('src') ?? null,
    properties: !!body.querySelector('.properties'),
    propertyKeys: [...body.querySelectorAll('.property-key')].map((one) => one.textContent),
    footnotes: !!body.querySelector('.footnotes'),
    anchored: [...body.querySelectorAll('h1, h2')].map((one) => one.id),
    // Front matter must not reach the words of the note.
    raw: body.textContent.includes('tags:'),
    // And the card itself: where it is, and how it arrives.
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

# The same things, in the reading view of the same note. One scope or two.
READ = """
() => {
  const page = document.querySelector('#write')
  const keyword = page.querySelector('.hl-keyword')
  const pre = page.querySelector('pre')
  const callout = page.querySelector('[data-callout]')
  const preStyle = pre ? getComputedStyle(pre) : null

  return {
    keywordColour: keyword ? getComputedStyle(keyword).color : null,
    preBackground: preStyle?.backgroundColor ?? null,
    preRadius: preStyle?.borderTopLeftRadius ?? null,
    calloutBar: callout ? getComputedStyle(callout).borderLeftWidth : null,
    tableBorders: page.querySelector('table')
      ? getComputedStyle(page.querySelector('table')).borderCollapse
      : null,
  }
}
"""

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
        link.hover(position={"x": 3, "y": 3})

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
    inside = page.evaluate(INSIDE)
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

    # The blocks Emil could not see.
    if not card["fence"]:
        wrong("a fenced code block came out unframed")
    if card["caption"] != "pipeline.ts":
        wrong(f"the block does not say what it is: {card['caption']!r}")
    if card["language"] != "language-ts":
        wrong(f"the block is not marked as its language: {card['language']!r}")
    if card["keyword"] is None:
        wrong("nothing in the code block is coloured: the fence was never highlighted")
    if card["callout"] != "tip":
        wrong(f"the callout is a plain quote: {card['callout']!r}")
    if card["calloutFolds"] != "DETAILS":
        wrong(f"a callout that folds is not foldable here: {card['calloutFolds']!r}")
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
    if not card["inert"]:
        wrong("a task box in a glance can be pressed")
    if card["picture"] is None:
        wrong("the embedded picture drew no element at all")
    if not card["properties"]:
        wrong("the note's own metadata is not shown as rows")
    if card["raw"]:
        wrong("the front matter is in the words of the note")
    if not card["footnotes"]:
        wrong("the footnotes were not gathered")
    if not all(card["anchored"]):
        wrong(f"a heading in the card has no anchor: {card['anchored']}")

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

    # And the same note read as a page, for the styles to be compared against.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Everything'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    page.wait_for_timeout(600)
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    wait_for(page, "document.querySelector('#write .hl-keyword')", "the reading view")
    page.wait_for_timeout(500)
    read = page.evaluate(READ)
    say(f"[desktop] the reading view: {json.dumps(read, ensure_ascii=False)}")
    shot(page, "02-reading")

    for what in ("keywordColour", "preBackground", "preRadius", "calloutBar", "tableBorders"):
        if card[what] != read[what]:
            wrong(f"{what} differs: the card says {card[what]!r}, the page {read[what]!r}")

    page.context.close()


def drive_section(browser: Browser) -> None:
    """`[[Everything#Later]]`: the heading's own section and not the note."""
    page = fresh(browser, "section")
    card = glance(page, "section", which=1)
    if card is None:
        wrong("no hover preview over a link that names a heading")
        page.context.close()
        return

    say(f"[section] the card says {card['words']!r}")
    shot(page, "10-section")

    if "Only this much" not in card["words"]:
        wrong(f"the card did not open on the heading the link names: {card['words']!r}")
    if "const ink" in card["words"]:
        wrong("the card showed the whole note rather than the section")
    # The section starts below the front matter, so there are no rows to draw.
    if card["properties"]:
        wrong("a section of a note carries the whole note's metadata")

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
