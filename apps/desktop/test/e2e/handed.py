"""What the phone hands the page, driven in a browser at a phone's size.

Everything on the Android side of this - the share intent, the quick settings
tiles, the widget, the speech recogniser - is Kotlin, and the Kotlin is compiled
by the `android-check` job in check.yml because an emulator does not run on this
machine. What is left is the half that decides anything: the page reading what the
activity handed over, and what it writes.

So the activity is stood in for. One object on the window, answering exactly what
`MainActivity.Bridge` answers and recording what it is told, and the page cannot
tell the difference: it looks for methods by name and there is nothing else to
find. See apps/desktop/src/lib/mobile/bridge.ts.

What this drive holds:

- a share of a link and a picture, at a cold start, landing as a note with the
  address and the day in its front matter and the picture beside it
- a share arriving while the app is open, and the sheet that asks whether it goes
  into the note in front of you - both answers, and dismissing it, which means do
  nothing
- a quick settings tile, which is a command id and nothing else, and a widget row,
  which is a path
- what the widget is told to draw, and a pinned note going to the top of it
- the camera row: that it is only offered where there is a camera, that it opens a
  `capture` input, and that the photograph lands beside a pasted picture with the
  embed at the caret
- dictation through the web's own recogniser, the line that says it is listening,
  and the same row turning it off

Run it from the repository root:

    python apps/desktop/test/e2e/handed.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/handed/`.
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
import threading
import time
import zlib
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "handed"

# Not the dev server's 1420, and not another drive's port either.
PORT = 19637
ORIGIN = f"http://127.0.0.1:{PORT}"

PHONE = {"width": 420, "height": 880}
AGENT = (
    "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def png(width: int, height: int, tint: tuple[int, int, int]) -> bytes:
    """A picture big enough to see in a screenshot, written here rather than kept
    as a fixture: what is under test is that bytes handed over by the activity come
    back out of storage, and these are bytes."""

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


SHARED_PICTURE = png(240, 160, (250, 120, 60))
TAKEN_PHOTO = png(200, 200, (90, 180, 250))

# The activity, as the page finds it: the ten methods of MainActivity.Bridge this
# drive is about, answering out of `window.__android` and writing down what it is
# told. The three about an AI key are the same shape and nothing here asks for them.
# The slices are honest - `sharedBytes` decodes, cuts and re-encodes - because the
# loop that asks for them is one of the things under test.
#
# The word is honest too. `addJavascriptInterface` puts the bridge in every frame of
# the webview and tells the activity nothing about which of them called, so since
# 837d689d the calls that matter want a word the activity says only into the main
# frame, and the real one refuses anybody who says the wrong thing. This one refuses
# too: a page that stopped asking for the word would be a framed page's microphone,
# and a stand-in that let it through would never say so. See mobile/bridge.ts.
ACTIVITY = """
() => {
  const held = {
    shared: '',
    handed: '{"command":"","open":""}',
    bytes: {},
    dictates: false,
    word: 'this launch, and no frame in it',
    said: { widgets: [], done: 0, listen: [] },
  }
  window.__android = held

  const slice = (base64, offset, length) => {
    const binary = atob(base64)
    const cut = binary.slice(offset, offset + length)
    return cut ? btoa(cut) : ''
  }

  window.__NIB_SYSTEM__ = {
    insets: () => '{"top":24,"right":0,"bottom":48,"left":0}',
    // Into the page itself, whoever asked, which is what makes it a word only the
    // page has: the activity runs this line in the main frame.
    askForTheFrame: () => window.__nibFrame?.(held.word),
    bars: () => undefined,
    handed: () => {
      const answer = held.handed
      held.handed = '{"command":"","open":""}'
      return answer
    },
    shared: () => held.shared,
    sharedBytes: (at, offset, length) => slice(held.bytes[at] ?? '', offset, length),
    sharedDone: () => {
      held.shared = ''
      held.said.done++
    },
    widgets: (json) => held.said.widgets.push(json),
    dictates: () => held.dictates,
    listen: (said, on) => {
      if (said !== held.word) return false
      held.said.listen.push(on)
      return on
    },
  }
}
"""

# The web's own recogniser, stood in for the same way. Chrome has one; a headless
# run of it will not open a microphone, and what is under test is what the page
# does with the words rather than whether Google heard them.
SPEECH = """
() => {
  class Fake {
    constructor() {
      this.continuous = false
      this.interimResults = true
      this.lang = ''
      this.onresult = null
      this.onerror = null
      this.onend = null
      window.__speech = this
      this.started = 0
      this.stopped = 0
    }

    start() {
      this.started++
    }

    stop() {
      this.stopped++
    }

    hear(words, isFinal) {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: words } }] })
    }
  }

  window.SpeechRecognition = Fake
  delete window.webkitSpeechRecognition
}
"""

# Every file input the page opens, so the camera row can be asked what kind of
# chooser it asked for. The click still happens, so Playwright still sees the
# chooser and can answer it.
PICKERS = """
() => {
  window.__pickers = []
  const clicked = HTMLInputElement.prototype.click
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file') {
      window.__pickers.push({ accept: this.accept, capture: this.capture })
    }
    return clicked.call(this)
  }
}
"""

SHARE_LINK = {
    "action": "android.intent.action.SEND",
    "subject": "A page worth keeping",
    "items": [
        {"name": "", "mime": "text/plain", "size": 0, "text": "https://example.test/a/plan"},
        {"name": "shot.png", "mime": "image/png", "size": len(SHARED_PICTURE)},
    ],
}

SHARE_WORDS = {
    "action": "android.intent.action.SEND",
    "subject": "",
    "items": [{"name": "", "mime": "text/plain", "size": 0, "text": "one more thing"}],
}

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Handed'))
  await ws.openEntry(found.path, { activate: true })
  return { name: found.name, root: ws.activeSpace.root }
}
"""

NOTE = """# Handed

Words already here.
"""

STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    open: ws.active?.path ?? null,
    name: ws.active?.name ?? null,
    doc: ws.active?.doc ?? '',
    tabs: ws.tabs.length,
    notes: ws.notes.map((one) => one.name),
    files: ws.files.map((one) => one.path),
  }
}
"""


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


def started(page: Page) -> None:
    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")


def fresh(
    browser: Browser,
    finger: bool,
    share: dict | None = None,
    activity: bool = True,
) -> Page:
    """A page with the activity behind it, and a share already waiting where one is
    asked for - which is the cold start a share actually is.

    `activity` off is a plain browser: no bridge to find, which is what a desktop, a
    phone browser and the PWA all are. Dictation there is the web's own recogniser
    rather than the phone's, and that is the only difference the page ever sees."""
    context = browser.new_context(
        viewport=PHONE if finger else {"width": 1180, "height": 900},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **({"user_agent": AGENT} if finger else {}),
    )
    # Each of these is written as a function and run as one: an init script is
    # source that is evaluated, so an arrow function on its own would be evaluated
    # and thrown away.
    for one in ((ACTIVITY,) if activity else ()) + (SPEECH, PICKERS):
        context.add_init_script(f"({one})()")

    if share:
        waiting = json.dumps(json.dumps(share))
        bytes_of = json.dumps({"1": base64.b64encode(SHARED_PICTURE).decode()})
        context.add_init_script(
            f"""
            (() => {{
              window.__android.shared = {waiting}
              window.__android.bytes = {bytes_of}
            }})()
            """
        )

    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    # The app writes its own failures to the console through `log`, and a share
    # that could not be written would otherwise be a silent nothing.
    page.on(
        "console",
        lambda message: say(f"console {message.type}: {message.text}")
        if message.type in ("error", "warning")
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    started(page)
    return page


def palette(page: Page, words: str) -> None:
    """A command, from the palette, which is where every row has to be reachable."""
    page.keyboard.press("Control+p")
    page.wait_for_timeout(350)
    page.keyboard.type(f"> {words}")
    page.wait_for_timeout(450)


def rows(page: Page) -> list[dict]:
    return page.evaluate(
        """() => [...document.querySelectorAll('.palette .nib-row')].map((one) => ({
             label: one.querySelector('.nib-row-label')?.textContent?.trim() ?? '',
             dim: one.classList.contains('dim'),
           }))"""
    )


def shared_at_a_cold_start(page: Page) -> str:
    """A link and a picture, shared into an app that was not running.

    The app comes back up where it was left, which on a phone means a note on
    screen, so the sheet asks here as well - there is a note this could go into.
    One rule and no hidden state: the question is asked whenever both answers are
    possible, whether the app was already running or not."""
    page.wait_for_selector(".sheet .nib-button", timeout=20000)
    page.wait_for_timeout(500)
    shot(page, "01-the-sheet-asks-at-a-cold-start")

    labels = page.evaluate(
        """() => [...document.querySelectorAll('.sheet .nib-button')]
             .map((one) => one.textContent.trim()).filter(Boolean)"""
    )
    say(f"[cold] the sheet offers {labels}")
    if "New note" not in labels:
        wrong(f"the sheet does not offer a note of its own: {labels}")

    # Scoped to the sheet: the phone's own plus over the note is called the same
    # thing, which is the point of both of them.
    page.locator(".sheet").get_by_role("button", name="New note", exact=True).click()

    wait_for(
        page,
        "window.nibApp.workspace.notes.some((one) => one.name.startsWith('A page worth keeping'))",
        "the shared note to land",
        patience=30,
    )
    page.wait_for_timeout(900)

    state = page.evaluate(STATE)
    say(f"[cold] {json.dumps(state)}")

    if not (state["name"] or "").startswith("A page worth keeping"):
        wrong(f"the shared note was not opened: {state['name']!r}")

    doc = state["doc"]
    for wanted in ("source: https://example.test/a/plan", "date: 20", "# A page worth keeping"):
        if wanted not in doc:
            wrong(f"the note does not say {wanted!r}: {doc!r}")

    if "![](assets/shot.png)" not in doc:
        wrong(f"the picture is not drawn in the note: {doc!r}")

    done = page.evaluate("() => window.__android.said.done")
    if done != 1:
        wrong(f"the activity was told {done} times that the copies may go, not once")

    # The whole picture crossed in slices and is in storage under the address the
    # note carries. Asked after a reload, because in a browser the worker that
    # answers for a picture only takes the page over on the second load - which is
    # every load but the very first, and is the same question pictures.py asks.
    page.reload(wait_until="domcontentloaded")
    started(page)
    wait_for(page, "navigator.serviceWorker.controller", "the worker to take the page over")
    page.evaluate(
        """() => {
             const ws = window.nibApp.workspace
             const found = ws.notes.find((one) => one.name.startsWith('A page worth keeping'))
             return ws.openEntry(found.path, { activate: true })
           }"""
    )
    page.wait_for_timeout(1600)

    drawn = page.evaluate(
        """() => {
             // The editor's own image, and not the empty one-pixel buffers CodeMirror
             // puts either side of every widget it draws.
             const image = document.querySelector('.cm-content img.nib-image')
             if (!image) return null

             // The address as the page resolved it, and as the note wrote it: an
             // `<img>` the resolver has not answered for yet has the second and
             // not the first.
             let where = image.getAttribute('src') ?? ''
             try {
               where = new URL(image.src, location.href).pathname
             } catch {}

             return { src: where, complete: image.complete, width: image.naturalWidth }
           }"""
    )
    say(f"[cold] the picture as the editor drew it: {json.dumps(drawn)}")
    shot(page, "02-shared-at-a-cold-start")

    if not drawn:
        wrong("the shared picture is not in the note at all")
    else:
        if "/asset/" not in drawn["src"] or not drawn["src"].endswith("shot.png"):
            wrong(f"the picture is not beside the note: {drawn['src']}")
        if not drawn["complete"] or drawn["width"] < 1:
            wrong(f"the shared picture did not draw: {drawn}")

    return state["open"]


def shared_while_it_is_open(page: Page) -> None:
    """The same thing again, with a note in front of somebody: the sheet asks, and
    both of its answers are answers."""
    page.evaluate(SEED, NOTE)
    wait_for(page, "window.nib", "the editor")
    page.wait_for_timeout(500)

    # The caret at the end, which is where somebody writing would have left it.
    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() }"
    )

    hand(page, SHARE_WORDS)
    page.wait_for_selector(".sheet .nib-button", timeout=10000)
    page.wait_for_timeout(500)
    shot(page, "03-the-sheet-asks")

    labels = page.evaluate(
        """() => [...document.querySelectorAll('.sheet .nib-button')]
             .map((one) => one.textContent.trim()).filter(Boolean)"""
    )
    say(f"[open] the sheet offers {labels}")
    if not any(one.startswith("Add to") for one in labels):
        wrong(f"the sheet does not offer the note in front of you: {labels}")

    page.locator(".sheet").get_by_role("button", name="Add to Handed").click()
    page.wait_for_timeout(900)

    state = page.evaluate(STATE)
    say(f"[open] {json.dumps(state)}")
    shot(page, "04-added-to-the-open-note")

    if not (state["name"] or "").startswith("Handed"):
        wrong(f"the words went somewhere else: {state['name']!r}")
    if "one more thing" not in state["doc"]:
        wrong(f"the words did not land in the note: {state['doc']!r}")
    if state["doc"].count("one more thing") != 1:
        wrong(f"the words landed more than once: {state['doc']!r}")


def dismissing_it_does_nothing(page: Page) -> None:
    before = page.evaluate(STATE)
    hand(page, SHARE_WORDS)
    page.wait_for_selector(".sheet .nib-button", timeout=10000)
    page.wait_for_timeout(400)

    page.keyboard.press("Escape")
    page.wait_for_timeout(900)

    after = page.evaluate(STATE)
    say(f"[dismissed] {json.dumps(after)}")

    if after["doc"] != before["doc"]:
        wrong("dismissing the sheet wrote into the note anyway")
    if len(after["notes"]) != len(before["notes"]):
        wrong(f"dismissing the sheet made a note: {after['notes']}")
    if not page.evaluate("() => window.__android.said.done >= 3"):
        wrong("the activity was never told it could let the dismissed share go")


def hand(page: Page, share: dict) -> None:
    """A share arriving at an app that is already open, which is `onNewIntent` and
    then one line run in the page."""
    page.evaluate(
        """([shared, bytes]) => {
             window.__android.shared = shared
             window.__android.bytes = bytes
             window.__nibHanded()
           }""",
        [json.dumps(share), {}],
    )
    page.wait_for_timeout(300)


def tile(page: Page, command: str) -> None:
    """A quick settings tile pressed: the id of a row in the app's own registry,
    arriving the way a share does."""
    page.evaluate(
        """(command) => {
             window.__android.handed = JSON.stringify({ command, open: '' })
             window.__nibHanded()
           }""",
        command,
    )


def a_tile_and_a_widget_row(page: Page, note: str) -> None:
    """A quick settings tile is a command id; a widget row is a path. Both arrive
    the same way a share does."""
    before = page.evaluate(STATE)

    tile(page, "new")
    page.wait_for_timeout(900)
    after = page.evaluate(STATE)
    say(f"[tile] new note: {json.dumps(after)}")
    # The row the tile carries is `new`, which opens a blank note - in the tab that
    # was previewing one, the way the same row does from the palette.
    if after["open"] is not None or after["doc"] != "" or after["name"] == before["name"]:
        wrong(f"the tile did not open a blank note: {json.dumps(after)}")

    # The recorder's tile, which was the id nothing answered to until the recorder
    # landed and now reaches the same row the palette offers: the press makes the
    # recording's note. The row is read first, because a row the palette greys out
    # does nothing from a tile either - which is the rule this whole file is about -
    # and a machine with no way to record greys this one out. Pressed again after, so
    # the run leaves nothing listening.
    palette(page, "Record")
    offered = next((one for one in rows(page) if one["label"] == "Record"), None)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    say(f"[tile] the palette's own Record row: {json.dumps(offered)}")

    quiet = page.evaluate(STATE)
    tile(page, "record")
    page.wait_for_timeout(1200)
    started = page.evaluate(STATE)
    say(f"[tile] after the recorder's tile: {started['name']!r}")
    if offered and not offered["dim"]:
        if started == quiet:
            wrong("the recorder's tile did nothing, though the app has the row")
        tile(page, "record")
        page.wait_for_timeout(900)
    elif started != quiet:
        wrong(f"a greyed Record row did something from a tile anyway: {json.dumps(started)}")

    # And an id nothing answers to, which is what keeps a tile from a newer build
    # inert in an older one.
    quiet = page.evaluate(STATE)
    tile(page, "not-a-command")
    page.wait_for_timeout(700)
    if page.evaluate(STATE) != quiet:
        wrong("a command the app does not have did something anyway")

    page.evaluate(
        """(path) => {
             window.__android.handed = JSON.stringify({ command: '', open: path })
             window.__nibHanded()
           }""",
        note,
    )
    page.wait_for_timeout(1000)
    landed = page.evaluate(STATE)
    say(f"[widget] the row opened {landed['name']!r}")
    shot(page, "05-a-widget-row-opened-a-note")
    if landed["open"] != note:
        wrong(f"the widget row opened {landed['open']!r} rather than {note!r}")


def what_the_widget_draws(page: Page) -> None:
    said = page.evaluate("() => window.__android.said.widgets")
    if not said:
        wrong("the home screen was never told anything")
        return

    last = json.loads(said[-1])
    say(f"[widget] {json.dumps(last)}")

    if not last.get("title"):
        wrong(f"the widget has no heading: {last}")
    if not last.get("notes"):
        wrong(f"the widget lists nothing: {last}")
    if any(".md" in one["name"] for one in last["notes"]):
        wrong(f"the widget names notes by their files: {last['notes']}")

    # A pinned note is the one being kept to hand, and it goes to the top.
    page.evaluate(
        """() => {
             const ws = window.nibApp.workspace
             const last = ws.notes[ws.notes.length - 1]
             return ws.openEntry(last.path, { activate: true }).then(() => ws.togglePin(ws.active.id))
           }"""
    )
    page.wait_for_timeout(900)

    pinned = json.loads(page.evaluate("() => window.__android.said.widgets.at(-1)"))
    kept = page.evaluate("() => window.nibApp.workspace.active.name")
    say(f"[widget] with {kept!r} kept open: {json.dumps(pinned)}")
    first = (pinned.get("notes") or [{}])[0].get("name")
    if first != kept.replace(".md", ""):
        wrong(f"the kept note is not at the top of the widget: {first!r} rather than {kept!r}")


def the_camera_row(page: Page) -> None:
    """A photograph into the note: the row is only offered where there is a camera,
    it opens a `capture` input, and what comes back lands beside a pasted picture
    with the embed at the caret."""
    page.evaluate(
        """() => {
             const ws = window.nibApp.workspace
             const found = ws.notes.find((one) => one.name.startsWith('Handed'))
             return ws.openEntry(found.path, { activate: true })
           }"""
    )
    page.wait_for_timeout(700)
    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() }"
    )

    palette(page, "Photo")
    listed = rows(page)
    say(f"[camera] the palette offers {json.dumps(listed[:3])}")
    shot(page, "06-the-camera-row")

    photo = next((one for one in listed if one["label"] == "Photo"), None)
    if not photo:
        wrong("there is no camera row on a phone")
        page.keyboard.press("Escape")
        return
    if photo["dim"]:
        wrong("the camera row is greyed out on a phone")

    with page.expect_file_chooser() as chooser:
        page.keyboard.press("Enter")
    chooser.value.set_files(
        {"name": "photo.png", "mimeType": "image/png", "buffer": TAKEN_PHOTO}
    )
    page.wait_for_timeout(1500)

    asked = page.evaluate("() => window.__pickers")
    say(f"[camera] the chooser it opened: {json.dumps(asked)}")
    if not any(one["capture"] == "environment" for one in asked):
        wrong(f"the row did not ask for the camera: {asked}")
    if not any(one["accept"] == "image/*" for one in asked):
        wrong(f"the row asked for the wrong kind of file: {asked}")

    state = page.evaluate(STATE)
    say(f"[camera] the note now says {state['doc']!r}")
    shot(page, "07-the-photo-in-the-note")
    if "![photo](" not in state["doc"]:
        wrong(f"the photograph was not drawn at the caret: {state['doc']!r}")
    if "assets/" not in state["doc"].split("![photo](")[-1]:
        wrong(f"the photograph did not land beside the note: {state['doc']!r}")


def dictation(page: Page, phone: bool) -> None:
    """Saying a note instead of typing it.

    Two recognisers behind one row: the phone's own where there is an activity, and
    the web's where there is not. Everything but the recogniser is the same, and
    that is the whole point of the row - so this runs twice and only the three
    lines about who is listening differ."""
    where = "phone" if phone else "browser"
    palette(page, "Dictate")
    listed = rows(page)
    row = next((one for one in listed if one["label"] == "Dictate"), None)
    say(f"[{where}] the palette offers {json.dumps(listed[:3])}")
    if not row:
        wrong(f"{where}: there is no dictation row")
        page.keyboard.press("Escape")
        return
    if row["dim"]:
        wrong(f"{where}: the dictation row is greyed out")

    page.keyboard.press("Enter")
    page.wait_for_timeout(600)

    if phone:
        # The activity was asked to listen, and the web's recogniser was left
        # alone: a phone has one of its own and the page prefers it.
        asked = page.evaluate("() => window.__android.said.listen")
        say(f"[{where}] the activity was told {json.dumps(asked)}")
        if asked != [True]:
            wrong(f"the phone's recogniser was not asked to listen: {asked}")
        if page.evaluate("() => window.__speech?.started ?? 0"):
            wrong("the web's recogniser was started on a phone that has its own")
    else:
        started_it = page.evaluate("() => window.__speech?.started ?? 0")
        heard = page.evaluate(
            """() => ({
                 continuous: window.__speech.continuous,
                 interim: window.__speech.interimResults,
                 lang: window.__speech.lang,
               })"""
        )
        say(f"[{where}] started {started_it} times, {json.dumps(heard)}")
        if started_it != 1:
            wrong(f"the recogniser was started {started_it} times")
        if not heard["continuous"] or heard["interim"]:
            wrong(f"the recogniser is listening in the wrong shape: {heard}")
        if not heard["lang"]:
            wrong("the recogniser was not told which language to listen in")

    # The quiet mark: the line across the top, saying what it is doing, which is
    # the one the app already uses for work that takes a moment.
    # The line the app draws over the document, and not whatever else on the page
    # wears a status role: what is under test is that sweep saying this word.
    listening = page.evaluate(
        """() => {
             const found = document.querySelector('.track[role=status]')
             return found ? found.getAttribute('aria-label') : null
           }"""
    )
    say(f"[{where}] the line says {listening!r}")
    shot(page, f"08-listening-{where}")
    if listening != "Listening":
        wrong(f"{where}: nothing on screen says it is listening: {listening!r}")

    before = page.evaluate(STATE)["doc"]
    if not phone:
        # Only the web's recogniser offers half-heard words at all, and they are
        # turned off; a sentence rewritten under the caret while somebody is
        # talking is the caret jumping about.
        page.evaluate("() => window.__speech.hear('and then we left', false)")
        page.wait_for_timeout(300)
        if page.evaluate(STATE)["doc"] != before:
            wrong("a half-heard sentence was written into the note")

    if phone:
        page.evaluate(
            """() => window.__nibHeard(JSON.stringify({ state: 'listening', text: 'and then we left' }))"""
        )
    else:
        page.evaluate("() => window.__speech.hear('and then we left', true)")

    page.wait_for_timeout(500)
    state = page.evaluate(STATE)
    say(f"[{where}] the note now says {state['doc']!r}")
    shot(page, f"09-dictated-{where}")
    if "and then we left" not in state["doc"]:
        wrong(f"{where}: what it heard is not in the note: {state['doc']!r}")
    # A sentence after a sentence is given the space the recogniser did not; see
    # src/lib/mobile/dictation.test.ts.
    if before and not before.endswith((" ", "\n")) and " and then we left" not in state["doc"]:
        wrong(f"{where}: the sentence was glued onto the last word: {state['doc']!r}")

    palette(page, "Stop")
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)

    if phone:
        asked = page.evaluate("() => window.__android.said.listen")
        say(f"[{where}] the activity was told {json.dumps(asked)}")
        if asked != [True, False]:
            wrong(f"the same row did not turn the phone's recogniser off: {asked}")
    else:
        stopped = page.evaluate("() => window.__speech.stopped")
        say(f"[{where}] stopped {stopped} times")
        if stopped < 1:
            wrong("the same row did not turn it off again")

    quiet = page.evaluate(
        "() => document.querySelector('.track[role=status]')?.getAttribute('aria-label') ?? null"
    )
    say(f"[{where}] the line now says {quiet!r}")
    if quiet == "Listening":
        wrong(f"{where}: the line still says it is listening")


def on_a_desktop(browser: Browser) -> None:
    """A plain browser, with no activity behind it at all.

    Two things about it. The camera row is offered where there is a camera behind
    the glass, and a desktop's `capture` is ignored by every browser, so the row
    there would be the Picture row under another name. Dictation is offered, because
    the browser has a recogniser of its own, and it is the same row doing the same
    thing to the same note."""
    page = fresh(browser, finger=False, activity=False)
    page.evaluate(SEED, NOTE)
    page.wait_for_timeout(600)

    palette(page, "Photo")
    listed = rows(page)
    say(f"[desktop] the palette offers {json.dumps(listed[:3])}")
    shot(page, "10-no-camera-row-on-a-desktop")

    photo = next((one for one in listed if one["label"] == "Photo"), None)
    if photo and not photo["dim"]:
        wrong("a desktop is offered a camera row that would open the file chooser")

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # And nothing here has an activity to ask, so the widget and the share are not
    # asked about either.
    if page.evaluate("() => '__NIB_SYSTEM__' in window"):
        wrong("the drive left an activity behind on a desktop")

    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() }"
    )
    dictation(page, phone=False)

    page.context.close()


def drive(browser: Browser) -> None:
    page = fresh(browser, finger=True, share=SHARE_LINK)
    note = shared_at_a_cold_start(page)
    shared_while_it_is_open(page)
    dismissing_it_does_nothing(page)
    a_tile_and_a_widget_row(page, note)
    what_the_widget_draws(page)
    the_camera_row(page)
    dictation(page, phone=True)
    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- a phone ---")
                drive(browser)
                say("--- a desktop ---")
                on_a_desktop(browser)
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

    print("\nwhat the phone hands over becomes a note, a command or a photograph", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
