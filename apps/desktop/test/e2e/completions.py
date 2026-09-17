"""The three new lists in the one popup at the caret, seen: `[[##` for every
heading in the space, `[[^^` for every block in it - named ones out of the index,
the rest found by their own words - and `#` for the tags the space already uses,
with the notes under each counted beside them.

What each row writes is checked in the note afterwards, including the name the app
writes into another note for a block that had none, and the places the `#` popup
must stay out of: a fence, and a heading being typed.

And then the space next door, which is the other half of "every heading in the
space": a second space, opened, offers its own and none of the first one's, from
the moment it is opened rather than from the moment it has been read.

Serves the built web app and drives it in the machine's own Chrome. The build is
`--mode drive`, which is what keeps `window.nib` and `window.nibApp` in it.

Run it from the repository root:

    python apps/desktop/test/e2e/completions.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/completions/`.
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
SHOTS = HERE / "shots" / "completions"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 19102
ORIGIN = f"http://127.0.0.1:{PORT}"

PLAN = """---
tags: [work/nib]
---

# Today

The first thing to do.

# The plan for Monday

Write it all down.

Something already named ^a1b2c3
"""

IDEAS = """# Sparks

A spark about the deepest kind of idea. #reading

# Later

Something for later. #work
"""

SCRATCH = """---
tags: work
---

Scratch.
"""

SEED = """
async ([plan, ideas, scratch]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const paths = []
  for (const text of [plan, ideas, scratch]) paths.push(await ws.noteFrom(text, root))

  await ws.loadTree()
  await ws.openEntry(paths[2], { activate: true })
  return paths
}
"""

ROWS = """
() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((one) =>
  one.textContent.replace(/\\s+/g, ' ').trim(),
)
"""

# A second space, opened, and what the index holds the moment it is. Reading a
# space starts when its file list does and takes as long as the space is big, so
# this is the state `[[` is offered out of for the whole of that second.
ANOTHER_SPACE = """
async () => {
  const ws = window.nibApp.workspace
  const links = window.nibApp.links
  await ws.addSpace('Elsewhere')

  const at_once = {
    root: links.rootOf(),
    reading: links.scanning,
    notes: links.index(null).notes.map((one) => one.path),
  }

  // Written while the new space is still being read, which is where a note lands
  // for the whole of a launch: the reading must come back around it rather than
  // over it.
  const path = await ws.noteFrom('# Over here\\n\\nthe other space\\n')
  await links.scanned()

  return { at_once, path, after: links.index(null).notes.map((one) => one.path) }
}
"""

TAGS = """
() => (window.nibApp.links.index(null).tags ?? []).map((one) => `${one.tag} ${one.notes}`)
"""

# The caret at the end of the note, on a line of its own, which is where a link or
# a tag is about to be written.
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
    # `--mode drive`, which is a release build with `__DRIVEABLE__` left on:
    # `window.nibApp` and `window.nib`, the handles this file steers the app by. They
    # used to be behind `import.meta.env.DEV`, which a development build set - so this
    # said `--mode development` and got them by accident. It does not any more: a
    # development build has no handles in it at all, and this drive stopped half a
    # second in, waiting for an app it could never see. See `__DRIVEABLE__` in
    # src/env.d.ts and smoke.py.
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env=os.environ.copy(),
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


def rows(page: Page) -> list[str]:
    return page.evaluate(ROWS)


def rows_holding(page: Page, holds: str, patience: float = 15) -> list[str]:
    """Polls until a row says `holds`.

    The index answers in the same breath as the keystroke, but the space's own
    words are behind a worker that reads them off the store, and the first
    question of a session waits for that. A question asked while it was cold can
    also be answered with nothing rather than late, and nothing re-asks a popup
    that has closed - so this asks again once, the way a reader would by typing
    one more letter."""
    until = time.monotonic() + patience
    again = False

    while time.monotonic() < until:
        found = rows(page)
        if any(holds in one for one in found):
            return found

        if not found and not again and time.monotonic() > until - patience + 4:
            say("[asked again] the popup came back empty; asking the space once more")
            page.keyboard.press("Control+Space")
            again = True

        page.wait_for_timeout(200)

    return rows(page)


def doc(page: Page) -> str:
    return page.evaluate("() => window.nib.state.doc.toString()")


def note_text(page: Page, path: str) -> str:
    return page.evaluate("(path) => window.nibApp.workspace.noteText(path)", path)


def fresh(browser: Browser, finger: bool = False) -> tuple[Page, list[str]]:
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
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    paths = page.evaluate(SEED, [PLAN, IDEAS, SCRATCH])
    say(f"the space holds {json.dumps([one.split('/')[-1] for one in paths])}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(900)

    # Again, after the launch has finished opening whatever it opens: the note
    # this types in has to be the one the space was seeded with.
    open_note(page, paths[2])
    return page, paths


def open_note(page: Page, path: str) -> None:
    page.evaluate(
        "(path) => window.nibApp.workspace.openEntry(path, { activate: true })",
        path,
    )
    page.wait_for_timeout(800)


def line(page: Page) -> None:
    page.evaluate(FRESH_LINE)
    page.wait_for_timeout(250)


def name_of(path: str) -> str:
    return path.replace("\\", "/").split("/")[-1].removesuffix(".md")


def headings_of(names: list[str]) -> list[tuple[str, str]]:
    """Every heading the space was seeded with, as the note it is in and itself."""
    return [
        (names[0], "Today"),
        (names[0], "The plan for Monday"),
        (names[1], "Sparks"),
        (names[1], "Later"),
    ]


def drive_headings(page: Page, names: list[str]) -> None:
    line(page)
    page.keyboard.type("[[##", delay=40)
    page.wait_for_timeout(700)

    every = rows_holding(page, "The plan for Monday")
    say(f"[[[##] {len(every)} rows: {json.dumps(every[:6])}")
    shot(page, "01-every-heading")

    # Every heading the space was seeded with, each with the note it is in beside
    # it: a row reads as the heading and then, muted, the note's name. Named rather
    # than counted, because a count cannot tell a missing note from an extra one -
    # the list used to lose a whole note's headings on about one launch in twenty
    # and still have four rows in it, which is how long that went unseen. A fifth
    # row for "Welcome to Nib" belongs here: the browser seeds every new space with
    # a note of that name, and it is in this space like any other.
    for note, heading in headings_of(names):
        if not any(one.startswith(heading) and one.endswith(note) for one in every):
            wrong(f"the space's headings are not all offered: no {heading!r} in {note!r}: {every}")

    # A few letters of the heading, wherever they fall in it.
    page.keyboard.type("pln", delay=60)
    page.wait_for_timeout(600)
    narrowed = rows(page)
    say(f"[[[##pln] {json.dumps(narrowed)}")
    shot(page, "02-heading-narrowed")
    if len(narrowed) != 1 or "The plan for Monday" not in narrowed[0]:
        wrong(f"three letters did not narrow to the one heading: {narrowed}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    written = doc(page)
    say(f"[written] {json.dumps(written[-50:])}")
    shot(page, "03-heading-written")
    if f"[[{names[0]}#The plan for Monday]]" not in written:
        wrong(f"the link is not the whole link: {json.dumps(written[-50:])}")
    if "##" in written:
        wrong("the two hashes are still in the note")


def drive_blocks(page: Page, names: list[str]) -> None:
    line(page)
    page.keyboard.type("[[^^", delay=40)
    page.wait_for_timeout(800)

    named = rows_holding(page, "a1b2c3")
    say(f"[[[^^] {json.dumps(named)}")
    shot(page, "04-named-blocks")
    if not any("a1b2c3" in one for one in named):
        wrong(f"the blocks that already have a name are not offered: {named}")

    # And the words of a block nobody has named, found through the app's search.
    page.keyboard.type("deepest", delay=60)
    found = rows_holding(page, "deepest kind of idea")
    say(f"[[[^^deepest] {json.dumps(found)}")
    shot(page, "05-found-blocks")
    if not any("deepest kind of idea" in one for one in found):
        wrong(f"the words of an unnamed block found nothing: {found}")
    if not any(names[1] in one for one in found):
        wrong(f"the rows do not say which note the block is in: {found}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(1200)
    written = doc(page)
    say(f"[written] {json.dumps(written[-50:])}")
    shot(page, "06-block-written")

    link = [one for one in written.split("\n") if one.startswith(f"[[{names[1]}#^")]
    if not link:
        wrong(f"the link does not point at a named block: {json.dumps(written[-50:])}")
        return

    # The name the app wrote is in the other note, at the end of that block.
    id = link[0].split("#^")[1].rstrip("]")
    body = note_text(page, page.evaluate("() => window.nibApp.workspace.notes.map((o) => o.path)")[1])
    say(f"[the other note] {json.dumps(body)}")
    if f"^{id}" not in (body or ""):
        wrong(f"the block was never given the name the link points at: ^{id}")
    if "deepest kind of idea" not in (body or ""):
        wrong("the note the name was written into no longer says what it said")


def drive_tags(page: Page) -> None:
    say(f"[the tag index] {json.dumps(page.evaluate(TAGS))}")

    line(page)
    page.keyboard.type("Filed under #", delay=40)
    page.wait_for_timeout(700)

    every = rows_holding(page, "reading")
    say(f"[#] {json.dumps(every)}")
    shot(page, "07-every-tag")
    if not any("work" in one for one in every):
        wrong(f"the space's tags are not offered: {every}")
    if not any("reading" in one for one in every):
        wrong(f"a tag only one note carries is missing: {every}")
    # The count beside each is the notes under it, and `work` is carried by more
    # than one: the note that wrote `#work`, the one that wrote `#work/nib`, and
    # the one that said so in its front matter.
    if not any(one.endswith("3") for one in every):
        wrong(f"the rows do not count the notes under each tag: {every}")

    # A slash narrows to the level under it.
    page.keyboard.type("work/", delay=60)
    page.wait_for_timeout(600)
    nested = rows(page)
    say(f"[#work/] {json.dumps(nested)}")
    shot(page, "08-nested-tag")
    if not nested or not all("work/nib" in one for one in nested):
        wrong(f"a slash did not narrow to the tags under it: {nested}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    written = doc(page)
    say(f"[written] {json.dumps(written[-40:])}")
    shot(page, "09-tag-written")
    if "#work/nib" not in written:
        wrong(f"the tag is not the whole tag: {json.dumps(written[-40:])}")


def drive_quiet(page: Page) -> None:
    """The places the popup has to stay out of."""
    line(page)
    page.keyboard.type("#", delay=40)
    page.wait_for_timeout(500)
    opening = rows(page)
    shot(page, "10-a-hash-opening-a-line")
    if opening:
        wrong(f"a hash opening a line offered tags on the way to a heading: {opening}")

    page.keyboard.type(" A heading", delay=20)
    page.wait_for_timeout(400)
    if rows(page):
        wrong("a heading being typed offered tags")

    # Inside a fence, where a hash is a comment.
    line(page)
    page.keyboard.type("```py", delay=30)
    page.keyboard.press("Enter")
    page.wait_for_timeout(400)
    page.keyboard.type("# work", delay=40)
    page.wait_for_timeout(600)
    fenced = rows(page)
    shot(page, "11-a-hash-in-a-fence")
    if fenced:
        wrong(f"a hash in a fence offered tags: {fenced}")

    # And in the middle of a word, which is not a tag at all.
    line(page)
    page.keyboard.type("written in C#", delay=30)
    page.wait_for_timeout(500)
    inside = rows(page)
    shot(page, "12-a-hash-in-a-word")
    if inside:
        wrong(f"a hash in the middle of a word offered tags: {inside}")


def drive_front_matter(page: Page, paths: list[str]) -> None:
    """The one place a tag is written without a hash: a `tags:` list."""
    open_note(page, paths[2])

    # The caret at the end of the `tags:` line of this note's own front matter.
    page.evaluate(
        """() => {
          const doc = window.nib.state.doc
          const at = doc.toString().indexOf('tags: work') + 'tags: work'.length
          window.nib.dispatch({ selection: { anchor: at } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(400)
    page.keyboard.type(", rea", delay=60)
    page.wait_for_timeout(700)

    listed = rows_holding(page, "reading")
    say(f"[front matter] {json.dumps(listed)}")
    shot(page, "13-front-matter")
    if not listed or not any("reading" in one for one in listed):
        wrong(f"a `tags:` list offered nothing: {listed}")

    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    written = doc(page)
    say(f"[written] {json.dumps(written[:60])}")
    shot(page, "14-front-matter-written")
    if "tags: work, reading" not in written:
        wrong(f"the tag was not written into the list: {json.dumps(written[:60])}")
    if "#reading" in written.split("---")[1]:
        wrong("a hash was written into the front matter, where YAML reads one as a comment")


def drive_finger(browser: Browser) -> None:
    page, names = fresh(browser, finger=True)
    line(page)
    page.keyboard.type("[[##", delay=40)
    page.wait_for_timeout(900)

    every = rows_holding(page, "The plan for Monday")
    say(f"[phone] {len(every)} rows")
    shot(page, "20-phone")
    if not every:
        wrong("the space's headings do not open on a phone")

    box = page.evaluate(
        """() => {
          const menu = document.querySelector('.cm-tooltip-autocomplete')
          if (!menu) return null
          const rect = menu.getBoundingClientRect()
          return { left: Math.round(rect.left), width: Math.round(rect.width) }
        }"""
    )
    say(f"[phone] the popup sits at {json.dumps(box)}")
    if not box or box["left"] < 0 or box["width"] < 80:
        wrong(f"the popup is not where a thumb can reach it: {box}")

    page.context.close()


def drive_another_space(page: Page, names: list[str]) -> None:
    """The space next door offers its own headings and none of this one's.

    A space is read when it opens and the reading takes as long as the space is
    big, so for the whole of that second the index is what `[[` is offered out of.
    It used to be the *last* space's notes under this space's name, which is a list
    that offers a note somebody cannot link to and a link that draws as resolved
    when the space holds nothing of the sort. Empty is the honest answer until
    there is one, and the panel already says the space is being read."""
    seen = page.evaluate(ANOTHER_SPACE)
    say(f"[another space] {json.dumps(seen)}")

    at_once = seen["at_once"]
    if not at_once["reading"]:
        say("[another space] the space was read before this could look; nothing to say")
        return

    stale = [one for one in at_once["notes"] if name_of(one) in names]
    if stale:
        wrong(f"a space still being read offered the last space's notes: {stale}")

    # And what was written while it was being read is in it once it has been.
    if "Over here.md" not in seen["after"]:
        wrong(f"a note written while the space was read is not in it: {seen['after']}")

    open_note(page, seen["path"])
    line(page)
    page.keyboard.type("[[##", delay=40)
    page.wait_for_timeout(700)
    every = rows_holding(page, "Over here")
    say(f"[[[## next door] {json.dumps(every)}")
    shot(page, "15-another-space")

    if not any(one.startswith("Over here") for one in every):
        wrong(f"the new space's own heading is not offered: {every}")
    for note, heading in headings_of(names):
        if any(one.startswith(heading) and one.endswith(note) for one in every):
            wrong(f"a heading of another space is offered here: {heading!r} in {note!r}")

    page.keyboard.press("Escape")
    page.wait_for_timeout(200)


def drive(browser: Browser) -> None:
    page, paths = fresh(browser)
    names = [name_of(one) for one in paths]
    say(f"the notes are {json.dumps(names)}")

    drive_headings(page, names)
    drive_blocks(page, names)
    drive_tags(page)
    drive_quiet(page)
    drive_front_matter(page, paths)
    drive_another_space(page, names)

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

    print("\nthe space's headings, blocks and tags all finish themselves", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
