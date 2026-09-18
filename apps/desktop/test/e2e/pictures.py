"""Pictures, in a browser: the one thing the web build could not do.

A note-relative `pictures/x.png` in an `<img>` is asked of the page's own origin,
where nothing answers, so a picture pasted into the web app or into the phone's
PWA never drew - while the desktop drew it through the asset protocol. The fix is
one resolver for every surface and one address behind it, answered by
public/sw.js out of the same IndexedDB the notes are in.

So this drive is about a picture being *there*: pasted into a note and drawn in the
editor, drawn the same in the reading view, drawn again after a reload - because an
address that survives a reload is the whole reason it is an address rather than a
`blob:` - named three ways in one note, brought in from a Notion export through the
Import sheet, and dropped onto a plane. On a pointer and on a finger, because the
claim is that the two are one design.

The worker itself is asked directly as well: what it says a picture is, how long it
may be kept, what a picture that is not there gets, and that it does not answer for
the app's own chunks.

Run it from the repository root:

    python apps/desktop/test/e2e/pictures.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/pictures/`.
"""

from __future__ import annotations

import base64
import functools
import http.server
import json
import os
import shutil
import socket
import socketserver
import struct
import subprocess
import tempfile
import threading
import time
import zipfile
import zlib
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "pictures"

# Not the dev server's 1420, and not another drive's port either.
PORT = 18967
ORIGIN = f"http://127.0.0.1:{PORT}"


def png(width: int, height: int, tint: tuple[int, int, int]) -> bytes:
    """A picture big enough to see in a screenshot, written here rather than kept
    as a fixture: what is under test is that bytes pasted into the app come back
    out of storage, and these are bytes."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body))
        )

    rows = bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.append(tint[0] * (x + 1) // width)
            rows.append(tint[1] * (y + 1) // height)
            rows.append(tint[2])

    head = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", head)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


PASTED = base64.b64encode(png(220, 150, (250, 120, 60))).decode()
DROPPED = base64.b64encode(png(180, 180, (70, 170, 250))).decode()
IMPORTED = png(200, 130, (120, 220, 130))

# The ids Notion sticks on the end of every name it writes; the same shape
# test/e2e/import.py builds its fixture in.
PLAN = "1a2b3c4d5e6f78901a2b3c4d5e6f7890"
KIT = "aaaabbbbccccddddeeeeffff00001111"


def notion_zip(into: Path) -> Path:
    """A Notion export with a picture in it: a page, a page under it, and the
    picture beside that one. Written here rather than kept in the repository, for
    the same reason the pasted picture is."""
    path = into / "Export-4b7c1d2e.zip"

    with zipfile.ZipFile(path, "w") as zip_file:
        zip_file.writestr(
            f"Plan {PLAN}.md",
            f"# Plan\n\nSee [Kit list](Plan%20{PLAN}/Kit%20list%20{KIT}.md).\n",
        )
        zip_file.writestr(
            f"Plan {PLAN}/Kit list {KIT}.md",
            f"# Kit list\n\nA tent and a stove.\n\n![](tent%20{KIT}.png)\n",
        )
        zip_file.writestr(f"Plan {PLAN}/tent {KIT}.png", IMPORTED)

    return path


NOTE = """# Pictures

Paste one here:

"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Pictures'))
  await ws.openEntry(found.path, { activate: true })
  return { name: found.name, root: ws.activeSpace.root }
}
"""

# A paste of a picture, as the clipboard hands one over: a File in a DataTransfer
# on a `paste` event. The editor's own handler takes it from there; see
# packages/editor/src/images.ts.
PASTE = """
([base64, name, selector]) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  const data = new DataTransfer()
  data.items.add(new File([bytes], name, { type: 'image/png' }))

  const target = document.querySelector(selector)
  if (!target) return false

  target.focus()
  return target.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
  )
}
"""

DROP = """
([base64, name, selector]) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)

  const data = new DataTransfer()
  data.items.add(new File([bytes], name, { type: 'image/png' }))

  const plane = document.querySelector(selector)
  if (!plane) return false

  const box = plane.getBoundingClientRect()
  return plane.dispatchEvent(
    new DragEvent('drop', {
      dataTransfer: data,
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  )
}
"""

# Every picture on the page that is being asked of the asset store, and whether it
# arrived. `naturalWidth` is the honest question: an `<img>` that 404s is still an
# `<img>`, and only the decoded bytes have a width.
DRAWN = """
() => {
  const seen = []
  for (const image of document.querySelectorAll('img[src*="/asset/"]')) {
    const box = image.getBoundingClientRect()
    seen.push({
      src: new URL(image.src).pathname,
      complete: image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
      left: Math.round(box.left),
      drawn: Math.round(box.width),
    })
  }
  return {
    controlled: navigator.serviceWorker.controller !== null,
    images: seen,
    // The editor's own placeholder, which is what a picture that did not load
    // leaves behind. Nothing here should be wearing it.
    broken: document.querySelectorAll('.nib-image-frame.is-broken').length,
    loading: document.querySelectorAll('.nib-image-frame.is-loading').length,
  }
}
"""

ASKED = """
async (path) => {
  const answer = await fetch(path)
  return {
    status: answer.status,
    type: answer.headers.get('content-type'),
    cache: answer.headers.get('cache-control'),
    bytes: (await answer.arrayBuffer()).byteLength,
  }
}
"""

# The app's own chunks live under `/assets/`, one letter away from the route the
# worker owns. If it ever answered for those it would be serving the app out of the
# picture store.
OWN_CHUNK = """
async () => {
  const found = [...document.querySelectorAll('script[src]')]
    .map((one) => one.src)
    .find((one) => one.includes('/assets/'))
  if (!found) return null

  const answer = await fetch(found)
  return { status: answer.status, type: answer.headers.get('content-type') }
}
"""

failures: list[str] = []

# Where the Notion export is written for the run, set by `main`.
FIXTURES = Path(tempfile.gettempdir())


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
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
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

    if not (DIST / "sw.js").exists():
        raise SystemExit("the build carries no sw.js; public/ is what puts it at the root")


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


def started(page: Page) -> dict:
    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    return page.evaluate("() => ({ root: window.nibApp.workspace.activeSpace.root })")


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

    started(page)
    seeded = page.evaluate(SEED, NOTE)
    say(f"the space {seeded['root']} holds {seeded['name']}")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(600)
    return page


def paste_into_note(page: Page, where: str) -> str:
    """Pastes the picture and answers with the path the note now carries."""
    page.evaluate(PASTE, [PASTED, "pasted.png", ".cm-content"])
    wait_for(
        page,
        "window.nibApp.workspace.active.doc.includes('](assets/')",
        f"[{where}] the paste to reach the note",
    )

    written = page.evaluate(
        "() => /!\\[\\]\\(([^)]+)\\)/.exec(window.nibApp.workspace.active.doc)?.[1] ?? ''"
    )
    say(f"[{where}] the note now says ![]({written})")
    if not written.startswith("assets/"):
        wrong(f"{where}: the paste wrote {written!r}, not a path beside the note")

    page.wait_for_timeout(700)
    return written


def expect_drawn(page: Page, where: str, most: int, wide: int | None = None) -> dict:
    state = page.evaluate(DRAWN)
    say(f"[{where}] {json.dumps(state)}")

    if not state["controlled"]:
        wrong(f"{where}: no worker is in front of the page, so nothing can answer")
    if len(state["images"]) != most:
        wrong(f"{where}: {len(state['images'])} pictures asked of the store, not {most}")
    if state["broken"]:
        wrong(f"{where}: {state['broken']} pictures wearing the missing placeholder")

    for image in state["images"]:
        if not image["complete"] or image["width"] < 1:
            wrong(f"{where}: {image['src']} did not draw ({image['width']}px wide)")
        if wide is not None and (image["left"] < 0 or image["left"] + image["drawn"] > wide):
            wrong(f"{where}: {image['src']} runs off a {wide}px screen: {image}")

    return state


THREE = """
(relative) => {
  const view = window.nib
  const name = relative.split('/').pop()
  const text = [
    '# Pictures',
    '',
    'Beside the note, as the paste wrote it:',
    '',
    '![pasted](' + relative + ')',
    '',
    'By its name alone, the way Obsidian finds an attachment:',
    '',
    '![[' + name + ']]',
    '',
    'And as plain HTML, which the renderer passes straight through:',
    '',
    '<img src="' + relative + '" alt="as markup" width="120">',
    '',
  ].join('\\n')

  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  return name
}
"""


def three_ways(page: Page, where: str, relative: str) -> None:
    """The same picture named three ways in one note: a path beside the note, a
    bare name looked for anywhere in the space, and an `<img>` the note wrote
    itself. All three go through the one resolver, and this is what says so.

    The space is read again first, and waited on: a bare name is found through the
    link index, which is built when a space opens, and a picture pasted a moment
    ago is not in it yet. A reader meets this the other way round - the pictures a
    `![[…]]` names came with the space - so the drive asks for the reading rather
    than the app doing it per paste."""
    name = relative.split("/")[-1]
    page.evaluate("() => window.nibApp.workspace.loadTree()")
    page.evaluate("() => window.nibApp.links.build(window.nibApp.workspace.activeSpace.root)")
    wait_for(page, f"window.nibApp.links.fileNamed('{name}')", f"[{where}] the index to know it")

    page.evaluate(THREE, relative)
    page.wait_for_timeout(1200)


OPEN_NAMED = """
async (stem) => {
  const ws = window.nibApp.workspace
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith(stem))
  if (!found) return null
  await ws.openEntry(found.path, { activate: true })
  return found.path
}
"""


def imported(page: Page, where: str, zip_path: Path) -> None:
    """A Notion export brought in through the Import sheet, and the picture it
    carried drawn in the note that names it.

    An import writes a picture through `write_bytes` under a path it chose, rather
    than through the app's own naming: a name somebody else picked and not a hash,
    which is the other half of the addressing this drive is about."""
    page.evaluate("() => window.nibApp.importing.show()")
    page.wait_for_selector("button.drop", timeout=20000)
    page.wait_for_timeout(450)

    with page.expect_file_chooser() as chooser:
        page.click("button.drop")
    chooser.value.set_files(str(zip_path))

    page.wait_for_function("() => window.nibApp.importing.stage === 'ready'", timeout=30000)
    say(f"[{where}] the sheet read a {page.evaluate('() => window.nibApp.importing.format')}")
    page.click("button.primary")
    page.wait_for_function("() => window.nibApp.importing.stage === 'done'", timeout=60000)
    page.evaluate("() => window.nibApp.importing.close()")
    page.wait_for_timeout(400)

    opened = page.evaluate(OPEN_NAMED, "Kit list")
    if not opened:
        wrong(f"{where}: nothing called Kit list arrived")
        return

    page.wait_for_timeout(1200)
    say(f"[{where}] {opened} says {page.evaluate('() => window.nibApp.workspace.active.doc')!r}")


def drive(browser: Browser) -> None:
    page = fresh(browser, finger=False)
    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root")

    # One picture, pasted, drawn in the editor's live preview.
    relative = paste_into_note(page, "editor")
    shot(page, "01-editor-pasted")
    expect_drawn(page, "editor", 1)

    three_ways(page, "editor", relative)
    shot(page, "02-editor-three-ways")
    expect_drawn(page, "editor three ways", 3)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "03-reading-three-ways")
    expect_drawn(page, "reading", 3)

    # The address is the point: it survives a reload, which a `blob:` would not.
    # A reload comes back in the editor, so both faces are asked again.
    page.reload(wait_until="domcontentloaded")
    started(page)
    page.wait_for_timeout(1400)
    shot(page, "04-editor-after-reload")
    expect_drawn(page, "editor after a reload", 3)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "05-reading-after-reload")
    expect_drawn(page, "reading after a reload", 3)

    # The worker, asked the questions directly.
    space = root.strip("/")
    name = relative.split("/")[-1]
    hit = page.evaluate(ASKED, f"/asset/{space}/{relative}")
    say(f"[worker] a hit: {json.dumps(hit)}")
    if hit["status"] != 200:
        wrong(f"the worker answered {hit['status']} for a picture that is there")
    if hit["type"] != "image/png":
        wrong(f"the worker called a PNG {hit['type']!r}")
    if hit["bytes"] < 100:
        wrong(f"the worker answered with {hit['bytes']} bytes")
    # Named by the hash of its own bytes, so the address can never mean anything
    # else and is worth keeping for good.
    if "immutable" not in (hit["cache"] or ""):
        wrong(f"a picture named {name} was not offered for keeping: {hit['cache']!r}")

    miss = page.evaluate(ASKED, f"/asset/{space}/assets/nowhere.png")
    say(f"[worker] a miss: {json.dumps(miss)}")
    if miss["status"] != 404:
        wrong(f"a picture that is not there answered {miss['status']}, not 404")

    chunk = page.evaluate(OWN_CHUNK)
    say(f"[worker] the app's own chunk: {json.dumps(chunk)}")
    if not chunk:
        wrong("the page carries no chunk under /assets/ to check")
    elif chunk["status"] != 200 or "javascript" not in (chunk["type"] or ""):
        wrong(f"the worker answered for the app's own code: {chunk}")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(500)

    # A Notion export, through the Import sheet. The picture in it arrives under a
    # name somebody else chose rather than a hash of its bytes, which is the other
    # half of the addressing: it draws, and it is not offered for keeping for good.
    imported(page, "import", notion_zip(FIXTURES))
    shot(page, "06-editor-imported")
    expect_drawn(page, "the imported note", 1)

    brought = page.evaluate(
        "() => new URL(document.querySelector('img[src*=\"/asset/\"]').src).pathname"
    )
    asked = page.evaluate(ASKED, brought)
    say(f"[worker] the imported picture: {brought} {json.dumps(asked)}")
    if asked["type"] != "image/png":
        wrong(f"the imported picture is served as {asked['type']!r}")
    if asked["cache"] != "no-cache":
        wrong(f"a picture named by a person was offered for keeping: {asked['cache']!r}")

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "07-reading-imported")
    expect_drawn(page, "the imported note, read", 1)
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)

    # A plane: a picture dropped on it is a card of its own, drawn through the same
    # resolver the note's pictures go through.
    opened = "window.nibApp.workspace.active?.path?.endsWith('.canvas')"
    for _try in range(4):
        page.evaluate("() => window.nibApp.workspace.createCanvas()")
        page.wait_for_timeout(700)
        if page.evaluate(f"() => !!({opened})"):
            break
    else:
        wrong("no canvas ever opened")
        page.context.close()
        return

    page.wait_for_selector(".canvas", timeout=15000)
    page.evaluate(DROP, [DROPPED, "dropped.png", ".canvas"])
    page.wait_for_timeout(1600)

    plane = page.evaluate(
        """() => {
          const found = document.querySelector('.canvas img.picture')
          if (!found) return null
          return {
            src: new URL(found.src).pathname,
            complete: found.complete,
            width: found.naturalWidth,
          }
        }"""
    )
    say(f"[plane] {json.dumps(plane)}")
    shot(page, "08-plane-dropped")
    if not plane:
        wrong("a picture dropped on the plane is not on the plane")
    else:
        if "/asset/" not in plane["src"]:
            wrong(f"the plane asks for {plane['src']}, not the asset store")
        if not plane["complete"] or plane["width"] < 1:
            wrong(f"the picture on the plane did not draw: {plane}")
    if page.evaluate("() => document.querySelectorAll('.canvas .missing').length"):
        wrong("the plane says there is nothing there")

    page.context.close()


def finger(browser: Browser) -> None:
    page = fresh(browser, finger=True)

    relative = paste_into_note(page, "phone editor")
    shot(page, "10-phone-editor")
    expect_drawn(page, "phone editor", 1, wide=420)

    three_ways(page, "phone", relative)
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1400)
    shot(page, "11-phone-reading")
    expect_drawn(page, "phone reading", 3, wide=420)

    # The PWA's own case: the app is opened again and the pictures are still there.
    page.reload(wait_until="domcontentloaded")
    started(page)
    page.wait_for_timeout(1400)
    shot(page, "12-phone-after-reload")
    expect_drawn(page, "phone editor after a reload", 3, wide=420)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "13-phone-reading-after-reload")
    expect_drawn(page, "phone reading after a reload", 3, wide=420)
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(400)

    # And a Notion export through the sheet on a phone, which is where somebody
    # moving off another app actually does it.
    imported(page, "phone import", notion_zip(FIXTURES))
    shot(page, "14-phone-imported")
    expect_drawn(page, "the imported note on a phone", 1, wide=420)

    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    shot(page, "15-phone-reading-imported")
    expect_drawn(page, "the imported note read on a phone", 1, wide=420)

    page.context.close()


def main() -> int:
    global FIXTURES

    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with tempfile.TemporaryDirectory() as made:
            FIXTURES = Path(made)
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

    print("\na picture pasted, named, imported and dropped draws everywhere", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
