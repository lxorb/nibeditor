"""The plugin driven in a real browser, against a bridge that answers like the
device.

The unit tests measure the pieces: the mapping, the pager, the gesture machine, the
command grammar, the question flow. This measures the whole road - `even.html`
boots the app, finds a bridge, makes its page, sets a note into six text
containers, and answers a tap, a hold, a double tap and a scroll off a temple. A
mapping can be right and the plugin still be wrong: a container never made, a
gesture never wired up, a band never sent.

What it cannot do is prove anything about a pair of glasses. There is no radio and
no firmware here, so every timing is the plugin's own share and the panel pictures
are drawn with the firmware's metrics and a stand-in face; see
`scripts/even-panel.mjs` and the device checklist in docs/even.md.

Run it with the repository's own Chromium, after the plugin's own build:

    pnpm --filter @nib/desktop build:even
    python scripts/even-e2e.py
"""

import functools
import http.server
import json
import os
import pathlib
import re
import socket
import subprocess
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "desktop" / "dist-even"
OUT = ROOT / "target" / "even-e2e"
DOCS = ROOT / "docs" / "even"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

SPACE = "/Notes"
NOTE_PATH = f"{SPACE}/Even Realities glasses.md"
OTHER_PATH = f"{SPACE}/Monday standup.md"
DEEP_PATH = f"{SPACE}/Inbox/Reading list.md"
CANVAS_PATH = f"{SPACE}/A canvas.canvas"
# Everything the app has learned to write since the mapping was last driven: the
# properties at the head of a note, a fence with a caption, callouts by name, a
# comment to nobody, and a folded section. Its own note rather than more of the one
# above, so every assertion about that note's pages still says what it said.
MORE_PATH = f"{SPACE}/Everything else.md"
# One line per writing system, to see on the glass which of them the firmware's one
# font actually draws. The samples are read out of the glasses package rather than
# written again here: that list is data with a test of its own against the metrics,
# and this puts the same data in front of the firmware's own folding.
SCRIPTS_PATH = f"{SPACE}/Scripts.md"

# A second space, for the icons: one that chose an icon and one that did not.
OTHER_SPACE = "/Uni"
UNI_PATH = f"{OTHER_SPACE}/Lecture.md"
ICON = "GraduationCap"

NOTE = r"""# Even Realities glasses

The panel is 576 by 288 pixels with one font in one size, so every construct in a
note has to be said with the character set rather than with type.

## What the mapping does

Marks that only style words are dropped: **bold**, *italic*, ~~struck~~ and
==marked== all reach the glasses as their words. Marks that say what something
*is* are kept, because on a panel with one font code and prose look exactly alike:
`inline code` keeps its ticks and a fence keeps its lines.

- a bullet
  - one level in
- [ ] a task not done
- [x] a task done

> A quote, with a bar down its left.

> [!warning]
> A callout says which kind it is.

## Code

```ts
const panel = { width: 576, height: 288 }
const line = 27
```

## A table

| Call | Cost |
| :--- | ---: |
| textContainerUpgrade | 83 |
| rebuildPageContainer | 165 |
| updateImageRawData | 185 |

## Maths and pictures

Inline $E = mc^2$ and a display formula:

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

![A sketch of the panel](sketch.png)

A footnote[^one], a [link](https://nibeditor.com) and a wikilink to
[[Monday standup]].

[^one]: Which reads as a superscript.

## The glyphs the font has not got

No backtick, no check mark, no ballot box, no tab: ✓ ✗ ☐ ☑ and a tab between
these	two words. Nothing is dropped, and nothing draws as nothing.
"""

MORE = r"""---
tags: [glasses, panel]
status: reading
---

# Everything else

%% A note to myself, which nobody is read out to. %%

Words around %% an aside %% a comment.

## A fence with a caption

```ts src/panel.ts
const rows = 8
```

## Callouts by name

> [!warning]
> Mind the gap.

> [!recipe]
> Flour and water.

> [!tip] Mind the gap
> Between the two.

> [!note]- Shut
> Behind the fold.

## What is left

- [ ] a task not done
- [x] a task done

| Band | Rows |
| :--- | ---: |
| head | 1 |
| body | 8 |

Inline $E = mc^2$ and a display formula:

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$
"""

def scripts() -> list[dict]:
    """The writing systems, read out of packages/glasses/src/scripts.ts.

    One source for the samples: that file is data with a test against the firmware's
    own metrics, and a second copy here would be a second copy to go stale."""
    text = (ROOT / "packages" / "glasses" / "src" / "scripts.ts").read_text(encoding="utf-8")
    found = re.findall(
        r"code: '(\w+)',\s*name: '([^']+)',\s*sample: '([^']+)',\s*draws: (true|false)",
        text,
    )

    return [
        {"code": one[0], "name": one[1], "sample": one[2], "draws": one[3] == "true"}
        for one in found
    ]


SCRIPTS = scripts()
SCRIPTS_NOTE = "# Scripts\n\n" + "".join(f"- {one['name']}: {one['sample']}\n" for one in SCRIPTS)

OTHER = "# Monday standup\n\nSomewhere for the wikilink to point.\n"
DEEP = "# Reading list\n\nA note one folder in.\n"
UNI = "# Lecture\n\nA note in the second space.\n"
CANVAS = '{"nodes":[],"edges":[]}'

# The bridge, installed before a line of the app runs, exactly as the phone app
# installs the real one. It answers what the host answers and writes down every
# call, so what reached the glasses can be read back off the page.
BRIDGE = r"""
window.__even = { calls: [], containers: {}, page: null, mic: false }

const ok = (value) => Promise.resolve(value)

window.flutter_inappwebview = { callHandler: () => ok(null) }

window.EvenAppBridge = {
  createStartUpPageContainer(page) {
    window.__even.calls.push({ method: 'start', page })
    window.__even.page = page
    for (const one of page.textObject ?? []) {
      window.__even.containers[one.containerName] = { ...one }
    }
    // Zero is success, which is what the host answers.
    return ok(0)
  },

  rebuildPageContainer(page) {
    window.__even.calls.push({ method: 'rebuild', page })
    window.__even.page = page
    window.__even.containers = {}
    for (const one of page.textObject ?? []) {
      window.__even.containers[one.containerName] = { ...one }
    }
    return ok(true)
  },

  textContainerUpgrade(one) {
    if ((window.__heardAt || window.__spokeAt) && !window.__wroteAt) {
      window.__wroteAt = performance.now()
    }
    window.__even.calls.push({ method: 'words', name: one.containerName })
    const held = window.__even.containers[one.containerName]
    if (held) held.content = one.content
    return ok(true)
  },

  audioControl(open, source) {
    window.__even.calls.push({ method: 'mic', open, source })
    window.__even.mic = open
    return ok(true)
  },

  shutDownPageContainer(exitMode) {
    window.__even.calls.push({ method: 'leave', exitMode })
    return ok(true)
  },

  /** The phone app's own store, which is the one that survives a launch and the one
   *  that is not limited to a cookie's four kilobytes. Kept in `sessionStorage`,
   *  which the app itself never touches and which outlives a reload here the way the
   *  phone app outlives a launch there. An absent key answers the empty string,
   *  exactly as the host does. */
  getLocalStorage: (key) => ok(sessionStorage.getItem(`host:${key}`) ?? ''),
  setLocalStorage: (key, value) => {
    sessionStorage.setItem(`host:${key}`, value)
    return ok(true)
  },

  onEvenHubEvent(handler) {
    window.__even.send = handler
    return () => {
      window.__even.send = null
    }
  },
}

/** One gesture, in the shape the host sends it.
 *
 *  A tap is protobuf's zero and protobuf leaves a zero field out, so a tap really
 *  does arrive with no event type on it at all. */
window.__gesture = (kind) => {
  const of = { tap: null, double: 3, hold: 9, up: 1, down: 2 }
  const type = of[kind]
  const sys = type === null ? { eventSource: 1 } : { eventType: type, eventSource: 1 }
  window.__even.send?.({ sysEvent: sys })
}

/** A recogniser of our own, in place of the WebView's.
 *
 *  Chromium has `webkitSpeechRecognition` and it needs a microphone and a network to
 *  say anything, so this stands in for it: the same three properties, the same
 *  `onresult` shape, and one function to make it hear something. */
window.__heardAt = 0
window.__wroteAt = 0
window.__spokeAt = 0

class Recogniser {
  constructor() {
    this.continuous = false
    this.interimResults = false
    this.lang = ''
    this.onresult = null
    this.onerror = null
    this.onend = null
    window.__recogniser = this
  }

  start() {
    this.running = true
  }

  stop() {
    this.running = false
  }

  abort() {
    this.running = false
  }
}

window.SpeechRecognition = Recogniser

/** The recogniser refusing the way it refuses on a real phone: `start()` was happy
 *  and a moment later the service is not there. What Emil's phone does, and what
 *  sends the plugin to the glasses' own microphone. */
window.__refuse = () => {
  window.__recogniser?.onerror?.({ error: 'service-not-allowed' })
}

/** Speaking into the glasses' own microphone, which is the path a phone with no
 *  usable recogniser is on - Emil's, and every iPhone.
 *
 *  Frames of PCM the way the host sends them: twenty milliseconds each, sixteen bit
 *  little endian at 16 kHz, loud enough to be speech or quiet enough to be a room.
 *  Real time, because what is being measured is a wait a person feels. */
window.__speak = async (ms, loud = true) => {
  const samples = 320
  const frame = new Uint8Array(samples * 2)
  const view = new DataView(frame.buffer)
  for (let at = 0; at < samples; at++) {
    view.setInt16(at * 2, Math.round((loud ? 0.2 : 0.001) * 0x7fff * (at % 2 ? 1 : -1)), true)
  }

  // Counted in frames rather than by the clock: what the plugin measures is how
  // much sound arrived, and a timer that fires late does not make a word shorter.
  for (let at = 0; at < Math.round(ms / 20); at++) {
    if (loud) window.__spokeAt = performance.now()
    window.__even.send?.({ audioEvent: { audioPcm: frame, source: 'glasses' } })
    await new Promise((done) => setTimeout(done, 20))
  }
}

/** What the transcriber answers, and how long it takes about it. A round trip to a
 *  model is a couple of hundred milliseconds on a good day; the drive uses one
 *  number so that what it measures is the plugin's own share and the waiting it
 *  chooses to do. */
window.__heardSays = 'next'
window.__heardTakes = 250
window.__heardAsked = []
/** How often the plugin has opened the connection before it had anything to send. */
window.__warmed = 0

window.__say = (text) => {
  window.__heardAt = performance.now()
  window.__wroteAt = 0
  window.__recogniser?.onresult?.({
    resultIndex: 0,
    results: { length: 1, 0: { isFinal: true, 0: { transcript: text } } },
  })
}

/** Nib's own API, answering from a script. Nothing leaves the machine, and every
 *  host the plugin asked for is written down - which is now the whole of the check,
 *  because the account's OpenAI key is written and never read back and the plugin
 *  has none to send. The question goes to nibeditor.com, and to nothing else.
 *
 *  Signed in, because a question is asked of an account: `/v1/me` answers with one,
 *  which is what puts a token in `account.accountToken`. Everything the syncing then
 *  asks for is answered 404 here, which the app already treats as "not now" - the
 *  glasses are what this drive is about. */
window.__asked = []
window.__hosts = []
const realFetch = window.fetch.bind(window)

const ANSWER = [
  'You decided to use the firmware font only, with no bitmaps at all.',
  '',
  'The note says the panel is 576 by 288 pixels with one font in one size,',
  'so the mapping says every construct with the character set instead of',
  'with type. A page of words is one send of about 83 ms against four',
  'image sends of about 185 ms each, which is the whole reason for it.',
  '',
  'It also says what the font has not got: no backtick, so a fence is',
  'written with three left quotes; no check mark and no ballot box, so a',
  'task is a box that is filled or not; and no tab at all, so one is spent',
  'as the spaces it stood for. Nothing in a note is dropped, and nothing',
  'reaches the glasses as a character that draws nothing.',
].join('\n')

const json = (body, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

window.fetch = (input, init) => {
  const url = String(typeof input === 'string' ? input : (input?.url ?? input))
  if (!url.startsWith('https://nibeditor.com')) return realFetch(input, init)

  const path = new URL(url).pathname
  window.__hosts.push(new URL(url).host)

  if (path === '/v1/me') {
    return json({ user: { id: 'u1', email: 'reader@example.com', name: 'Reader' } })
  }

  if (path === '/v1/settings') {
    return json({
      settings: { glassesModel: 'gpt-6-astra', glassesEffort: 'low' },
      // What the account says about its key: that there is one, and how it ends.
      // Never the key - there is no route that answers with it.
      key: { set: true, tail: 'key1' },
    })
  }

  if (path === '/v1/ask/models') return json({ models: ['gpt-6-astra'] })

  if (path === '/v1/ask') {
    window.__asked.push(JSON.parse(String(init?.body ?? '{}')))
    return json({ answer: ANSWER })
  }

  if (path === '/health') {
    window.__warmed++
    return json({ ok: true })
  }

  if (path.startsWith('/v1/ask/heard')) {
    window.__heardAsked.push({ at: performance.now(), url: path })
    return new Promise((done) =>
      setTimeout(() => done(json({ said: window.__heardSays })), window.__heardTakes),
    )
  }

  // Everything else the app asks the account for. Refused rather than half
  // answered: a shape made up here would be a second copy of the service.
  return json({ error: 'not in this drive' }, 404)
}

/** No sockets. A room is opened for every note that is being written in, and a
 *  socket that cannot connect writes an error to the console - which this drive
 *  reads as a fault in the plugin. There is no service here to connect to. */
class NoSocket {
  constructor() {
    this.readyState = 0
  }
  send() {}
  close() {
    this.readyState = 3
  }
  addEventListener() {}
  removeEventListener() {}
}

window.WebSocket = NoSocket

window.__listen = () => {
  window.__say('voice commands on')
  return true
}

window.__bands = () => {
  const out = {}
  for (const [name, one] of Object.entries(window.__even.containers)) {
    out[name] = one.content
  }
  return out
}
"""

SEED = r"""
async ([rows]) => {
  // Whatever version the app itself made, rather than a version of this script's
  // own: the page has already booted by the time this runs, so the database is
  // there and asking for an older version is a `VersionError` and a drive that
  // measures nothing. Only a database this script somehow met first is created here,
  // and then at the version it is opened at.
  const open = (version) => new Promise((resolve, reject) => {
    const request = version === undefined ? indexedDB.open('nib') : indexedDB.open('nib', version)
    request.onupgradeneeded = () => {
      const made = request.result
      if (!made.objectStoreNames.contains('files')) made.createObjectStore('files', { keyPath: 'path' })
      if (!made.objectStoreNames.contains('assets')) made.createObjectStore('assets', { keyPath: 'path' })
      if (!made.objectStoreNames.contains('meta')) made.createObjectStore('meta')
      if (!made.objectStoreNames.contains('snapshots')) {
        const store = made.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true })
        store.createIndex('notePath', 'notePath')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  let db = await open()
  if (!db.objectStoreNames.contains('files')) {
    const version = db.version + 1
    db.close()
    db = await open(version)
  }

  const put = (store, row) => new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(row)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

  const now = Date.now()
  for (const [path, content] of rows) {
    await put('files', { path, content, modified: now, created: now })
    // And a row in `stats`, because that is what the file list is built from: one
    // row per file with its dates and nothing else, so a tree can be drawn without
    // reading a single body. A seed that wrote only the bodies left the app with
    // three notes it could open by name and an empty sidebar. See
    // lib/web/store.ts, where every write puts both.
    if (db.objectStoreNames.contains('stats')) {
      await put('stats', { path, modified: now, created: now })
    }
  }

  // The picture the note names, so that nothing on the page asks the server for
  // something that is not there.
  const png = Uint8Array.from(
    atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    ),
    (one) => one.charCodeAt(0),
  )
  await put('assets', {
    path: '/Notes/sketch.png',
    type: 'image/png',
    data: png.buffer,
    modified: now,
  })
  if (db.objectStoreNames.contains('stats')) {
    await put('stats', { path: '/Notes/sketch.png', modified: now, created: now })
  }

  return true
}
"""


def chrome() -> pathlib.Path:
    """The newest Chromium the repository's Playwright has fetched."""
    found = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))
    if not found:
        raise SystemExit(f"no Chromium under {CHROME_HOME}")

    return found[-1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server


class Report:
    def __init__(self):
        self.lines: list[str] = []
        self.bad = 0

    def ok(self, said: str, passed: bool, detail: str = ""):
        self.lines.append(f"{'PASS' if passed else 'FAIL'}  {said}{f'  [{detail}]' if detail else ''}")
        if not passed:
            self.bad += 1

    def say(self, said: str):
        self.lines.append(f"      {said}")

    def show(self):
        print("\n".join(self.lines))
        print(f"\n{len(self.lines)} lines, {self.bad} failures")


def main() -> int:
    if not (DIST / "even.html").exists():
        raise SystemExit("no dist-even/even.html: pnpm --filter @nib/desktop build:even first")

    OUT.mkdir(parents=True, exist_ok=True)
    report = Report()
    address, server = serve()
    screens: list[dict] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))
        try:
            page = browser.new_page(viewport={"width": 420, "height": 900})
            errors: list[str] = []
            page.on("pageerror", lambda one: errors.append(str(one)))
            page.on(
                "console",
                lambda one: errors.append(one.text) if one.type == "error" else None,
            )
            missing: list[str] = []
            page.on(
                "requestfailed",
                lambda one: missing.append(one.url),
            )
            page.on(
                "response",
                lambda one: missing.append(f"{one.status} {one.url}") if one.status >= 400 else None,
            )

            # The bridge before the app, which is how the phone installs the real
            # one: a call made before it lands does nothing and says nothing.
            page.add_init_script(BRIDGE)

            # The notes have to exist before the app reads its space.
            page.goto(f"{address}even.html")
            page.wait_for_timeout(400)
            page.evaluate(
                SEED,
                [
                    [
                        [NOTE_PATH, NOTE],
                        [OTHER_PATH, OTHER],
                        [DEEP_PATH, DEEP],
                        [CANVAS_PATH, CANVAS],
                        [MORE_PATH, MORE],
                        [SCRIPTS_PATH, SCRIPTS_NOTE],
                    ]
                ],
            )
            page.evaluate(
                """
                () => {
                  localStorage.setItem(
                    'nib:modes',
                    JSON.stringify({
                      glassesBreak: 2,
                      glassesLineNumbers: true,
                      glassesPageNumber: true,
                      glassesVoice: true,
                      glassesModel: 'gpt-6-astra',
                      glassesEffort: 'low',
                    }),
                  )
                  // A session, because a question is asked of an account: the key is
                  // on the account and the plugin has none. The stub above answers
                  // for it; see BRIDGE.
                  localStorage.setItem('nib:session', 'a-test-session')
                }
                """
            )
            # The plugin's own store flushes to a cookie after a pause, because a
            # packed plugin's localStorage belongs to a port that never comes back;
            # see lib/even/local.ts. Nothing survives a reload before it has.
            page.wait_for_timeout(700)
            page.reload()
            page.wait_for_timeout(1200)

            # The page the plugin asked for.
            made = page.evaluate("window.__even.page")
            report.ok("the plugin found the bridge and made its page", made is not None)
            if made is None:
                report.say("nothing else can be measured without one")
                report.show()
                return 1

            texts = made.get("textObject") or []
            report.ok(
                "makes text containers and no image container at all",
                len(texts) >= 6 and not made.get("imageObject"),
                f"{len(texts)} text, {len(made.get('imageObject') or [])} image",
            )
            report.ok(
                "exactly one container captures events",
                sum(1 for one in texts if one.get("isEventCapture") == 1) == 1,
            )
            report.ok(
                "the capture layer holds one space, so a scroll reaches us",
                any(
                    one.get("isEventCapture") == 1 and one.get("content") == " "
                    for one in texts
                ),
            )
            report.ok(
                "every container carries a unique z order",
                len({one.get("zOrderIndex") for one in texts}) == len(texts),
            )
            report.ok(
                "no container reaches past the panel",
                all(
                    one["xPosition"] + one["width"] <= 576
                    and one["yPosition"] + one["height"] <= 288
                    for one in texts
                ),
            )

            # A note has to be opened before there is anything to show. The plugin
            # opens on its own welcome note, so the sidebar is the way to another.
            open_note(page, "Even Realities glasses")

            bands = page.evaluate("window.__bands()")
            body = bands.get("nibBody", "")
            report.ok("sets the note into the body band", "panel is 576" in body, body[:40])
            report.ok(
                "puts the heading in the head band, not in the body",
                bands.get("nibHead", "").startswith("EVEN REALITIES GLASSES"),
                bands.get("nibHead", ""),
            )
            report.ok(
                "draws the heavy rule under a first level heading",
                set(bands.get("nibRule", "").strip()) == {"═"},
            )
            report.ok(
                "never sends more rows than the panel holds",
                len(body.split("\n")) <= 8,
                f"{len(body.split(chr(10)))} rows",
            )
            report.ok(
                "carries the line numbers in a column of their own",
                bands.get("nibNums", "").strip() != "",
                bands.get("nibNums", "").replace("\n", "|"),
            )
            report.ok(
                "says which page of how many in the top right, beside the microphone",
                re.search(r"\S {2,}1/\d+$", bands.get("nibHead", "").rstrip()) is not None,
                bands.get("nibHead", "").rstrip(),
            )
            report.ok(
                "keeps the last line of the panel for the note",
                "nibFoot" not in bands,
                ", ".join(sorted(bands)),
            )
            screens.append({"name": "glasses-1", "lineNumbers": True, **naming(bands)})

            # A scroll off a temple turns the page, and the frame in the plugin
            # follows it.
            before = bands.get("nibHead", "")
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(500)
            turned = page.evaluate("window.__bands()")
            report.ok(
                "a scroll off a temple turns the page",
                turned.get("nibHead") != before and turned.get("nibBody") != body,
                turned.get("nibHead", "").rstrip(),
            )

            # A white card over the region with the rest of the note faded, which is
            # the screenshot Emil sent; see even/Glasses.svelte.
            report.ok(
                "the plugin marks the region with one frame around the words",
                page.locator(".frame").count() == 1,
            )
            report.ok(
                "and the frame is sized to what the glasses show",
                page.evaluate(
                    "() => { const one = document.querySelector('.frame'); "
                    "return one ? one.getBoundingClientRect().height > 12 : false }"
                ),
            )
            # Emil: "the note on the phone is very dark and hardly visible." Nothing
            # covers the note and nothing paints over the words.
            report.ok(
                "and nothing is laid over the note to dim it",
                page.evaluate(
                    "() => { const over = [...document.querySelectorAll('body *')].filter((one) => {"
                    " const box = one.getBoundingClientRect();"
                    " const style = getComputedStyle(one);"
                    " if (style.position !== 'fixed' || style.visibility === 'hidden') return false;"
                    " if (box.width < innerWidth * 0.9 || box.height < innerHeight * 0.9) return false;"
                    " const paint = style.backgroundColor;"
                    " return paint !== 'rgba(0, 0, 0, 0)' && paint !== 'transparent' });"
                    " return over.map((one) => one.className).join(', ') }"
                )
                == "",
                page.evaluate(
                    "() => { const one = document.querySelector('.frame');"
                    " return one ? getComputedStyle(one).backgroundColor : 'no frame' }"
                ),
            )
            page.screenshot(path=str(OUT / "phone-frame.png"))

            # Sent again only where it changed: the head and the rule did not.
            page.evaluate("window.__even.calls = []")
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(500)
            sent = [one["name"] for one in page.evaluate("window.__even.calls") if one["method"] == "words"]
            report.ok(
                "a page turn sends only the bands that changed",
                "nibRule" not in sent and "nibBody" in sent,
                ", ".join(sent),
            )
            report.say(f"a page turn is {len(sent)} bands, about {len(sent) * 83} ms of radio")

            deeper = page.evaluate("window.__bands()")
            screens.append({"name": "glasses-2", "lineNumbers": True, **naming(deeper)})

            # A tap opens the sidebar.
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(500)
            side = page.evaluate("window.__bands()")
            report.ok(
                "a tap opens the sidebar, with the space at the top",
                side.get("nibHead", "").startswith("Notes"),
                side.get("nibHead", ""),
            )
            report.ok(
                "the sidebar lists the notes with a cursor on one",
                "▶ " in side.get("nibBody", ""),
                side.get("nibBody", "").replace("\n", " | "),
            )
            report.ok(
                "the sidebar never lists a canvas",
                "A canvas" not in side.get("nibBody", ""),
            )
            report.ok(
                "the sidebar lists a folder as a label",
                "Inbox" in side.get("nibBody", ""),
            )
            screens.append({"name": "sidebar", "lineNumbers": True, **naming(side)})

            # And a scroll moves the cursor rather than the page.
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(300)
            moved = page.evaluate("window.__bands()")
            report.ok(
                "a scroll in the sidebar moves the cursor",
                moved.get("nibBody") != side.get("nibBody"),
                moved.get("nibHead", "").rstrip(),
            )

            # A double tap closes it rather than leaving the app.
            page.evaluate("window.__even.calls = []")
            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(400)
            after = page.evaluate("window.__bands()")
            left = [one for one in page.evaluate("window.__even.calls") if one["method"] == "leave"]
            report.ok(
                "a double tap closes the sidebar instead of leaving the app",
                not left and not after.get("nibHead", "").startswith("Notes"),
                after.get("nibHead", ""),
            )

            # And on the note it is the system's own question, which a review checks.
            page.evaluate("window.__even.calls = []")
            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(400)
            left = [one for one in page.evaluate("window.__even.calls") if one["method"] == "leave"]
            report.ok(
                "a double tap on the note raises the system's leave question",
                len(left) == 1 and left[0]["exitMode"] == 1,
                json.dumps(left),
            )

            # A hold opens the modal.
            page.evaluate("window.__gesture('hold')")
            page.wait_for_timeout(400)
            modal = page.evaluate("window.__bands()")
            rows = modal.get("nibBody", "")
            report.ok(
                "a hold offers switch space, change note and the microphone",
                "Switch space" in rows and "Change note" in rows and "Voice" in rows,
                rows.replace("\n", " | "),
            )
            screens.append({"name": "modal", "lineNumbers": True, **naming(modal)})

            # Switch space is a list of the spaces.
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            spaces = page.evaluate("window.__bands()")
            report.ok(
                "switch space lists the spaces",
                spaces.get("nibHead", "").startswith("Spaces"),
                spaces.get("nibBody", "").replace("\n", " | "),
            )
            screens.append({"name": "spaces", "lineNumbers": True, **naming(spaces)})

            # Change note is the tree, with folders that open and shut. It opens with
            # the cursor on the note the reader is in, which is Emil's rule, so the
            # folder above it is one step up.
            page.evaluate("window.__gesture('hold')")
            page.wait_for_timeout(300)
            page.evaluate("window.__gesture('down')")
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            tree = page.evaluate("window.__bands()")
            report.ok(
                "the notes open with the cursor on the note the reader is in",
                "▶ Even Realities glasses" in tree.get("nibBody", ""),
                tree.get("nibBody", "").replace("\n", " | "),
            )
            page.evaluate("window.__gesture('up')")
            page.wait_for_timeout(200)
            report.ok(
                "change note is the tree, with a folder shut",
                tree.get("nibHead", "").startswith("Notes") and "▶ Inbox" in tree.get("nibBody", ""),
                tree.get("nibBody", "").replace("\n", " | "),
            )

            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            opened = page.evaluate("window.__bands()")
            report.ok(
                "a tap on a folder opens it where it stands",
                "▼ Inbox" in opened.get("nibBody", "") and "Reading list" in opened.get("nibBody", ""),
                opened.get("nibBody", "").replace("\n", " | "),
            )
            screens.append({"name": "notes", "lineNumbers": True, **naming(opened)})

            # A tap on a note opens it and puts the tree away.
            page.evaluate("window.__gesture('down')")
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(1200)
            switched = page.evaluate("window.__bands()")
            report.ok(
                "a tap on a note opens it on the glasses",
                "READING LIST" in switched.get("nibHead", ""),
                switched.get("nibHead", ""),
            )

            # The settings, on the glasses. Every one of them is reachable without the
            # phone, and the rows come from the one schema the phone's own Settings
            # section is drawn from; see even/settings.ts.
            def open_settings():
                page.evaluate("window.__gesture('hold')")
                page.wait_for_timeout(300)
                for _one in range(3):
                    page.evaluate("window.__gesture('down')")
                page.evaluate("window.__gesture('tap')")
                page.wait_for_timeout(400)

            open_settings()
            settings = page.evaluate("window.__bands()")
            rows = settings.get("nibBody", "")
            report.ok(
                "a hold reaches the settings, with every setting and what it says now",
                "Line numbers" in rows and "New page at" in rows and "On" in rows,
                rows.replace(chr(10), " | "),
            )
            # Two rows this section has not got: the page number, and who scrolls.
            # Both were choices about the same thing, and the answer is one behaviour
            # now - Emil: "effectively it should be always nib who turns the pages."
            # Every other row is where it was; see the walk below for the whole list.
            report.ok(
                "and neither a page-number nor a scrolling row, which are one answer now",
                "Page number" not in rows and "Scrolling" not in rows,
                rows.replace(chr(10), " | "),
            )
            screens.append({"name": "settings", "lineNumbers": True, **naming(settings)})

            # The reset is at the foot of them, where an action belongs. Walked to
            # rather than looked for: the cursor stops at the end of the list.
            seen = []
            for _step in range(40):
                seen.append(page.evaluate("window.__bands()").get("nibBody", ""))
                page.evaluate("window.__gesture('down')")
            report.ok(
                "and the reset at the foot of them",
                any("Reset glasses settings" in one for one in seen),
            )

            # A tap on a toggle flips it where it stands, and the panel says so at
            # once. This is the mechanism behind Emil's page number: he turned a
            # setting off and on again and it never came back, because nothing was sent
            # when the page had not changed a character.
            open_settings()
            page.evaluate("window.__gesture('down')")
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            off = page.evaluate("window.__bands()")
            report.ok(
                "a tap on a toggle flips it, and the row says so at once",
                "Off" in off.get("nibBody", ""),
                off.get("nibBody", "").replace(chr(10), " | "),
            )
            page.evaluate("window.__gesture('tap')")
            page.wait_for_timeout(400)
            report.ok(
                "off and then on again is the same as never having touched it",
                "On" in page.evaluate("window.__bands()").get("nibBody", ""),
            )
            page.evaluate("window.__gesture('double')")
            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(700)

            # Who turns the pages: the app, always. There was a setting offering the
            # glasses' own scrolling instead, and no firmware ever did it - Emil, on
            # the device: "the bar at the side shows but scrolling does nothing" - so
            # Emil asked for the row to go: "effectively it should be always nib who
            # turns the pages." What is left is one behaviour, and this is it on the
            # glass: a page number that always means a page, and a flick that turns one.
            open_note(page, "Even Realities glasses")
            paged = page.evaluate("window.__bands()")
            report.ok(
                "the page number is there, because Nib turns every page",
                re.search(r"\d+/\d+$", paged.get("nibHead", "").rstrip()) is not None,
                paged.get("nibHead", "").rstrip(),
            )

            def walk_to(word: str) -> bool:
                """The cursor onto the row whose label holds `word`. Walked to rather
                than counted to, so another setting between them changes nothing."""
                for _one in range(40):
                    rows_now = page.evaluate("window.__bands()").get("nibBody", "")
                    on = next((one for one in rows_now.split(chr(10)) if one.startswith("▶")), "")
                    if word in on:
                        return True
                    page.evaluate("window.__gesture('down')")
                return False

            open_settings()
            report.ok(
                "and there is no scrolling row left to reach on the glasses",
                not walk_to("Scrolling"),
            )
            page.evaluate("window.__gesture('double')")
            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(700)

            def numbered() -> tuple[int, int]:
                """Which page of how many the head says, as two numbers."""
                said = page.evaluate("window.__bands()").get("nibHead", "").rstrip()
                found = re.search(r"(\d+)/(\d+)$", said)
                return (int(found[1]), int(found[2])) if found else (0, 0)

            first = page.evaluate("window.__bands()")
            was, count = numbered()
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(500)
            turned = page.evaluate("window.__bands()")
            now, still = numbered()
            report.ok(
                "a flick turns a whole page, and the number counts it",
                turned.get("nibBody") != first.get("nibBody")
                and now == was + 1
                and still == count,
                f"{was}/{count} then {now}/{still}",
            )

            # Voice, driven through a recogniser of our own: the words arrive exactly
            # as the WebView's own hands them over, and what the plugin does with them
            # is the whole of what is being measured.
            report.ok(
                "opens the microphone when the reader asks for it",
                page.evaluate("(() => { window.__listen(); return true })()") is True,
            )
            page.wait_for_timeout(500)
            report.ok(
                "lights the corner while it is listening",
                page.evaluate("window.__bands()").get("nibMic", "").strip() == "\u25cf",
                page.evaluate("window.__bands()").get("nibMic", ""),
            )

            for said, wanted, what in [
                ("next", "turns the page", "next"),
                ("back", "turns it back", "back"),
                ("spaces view", "opens the spaces", "Spaces"),
                ("close", "closes it again", "close"),
                ("open page three", "goes to a page by number", "3/"),
                ("go to line forty", "goes to a line of the note", "line"),
            ]:
                page.evaluate("(text) => window.__say(text)", said)
                page.wait_for_timeout(400)
                heard = page.evaluate("window.__bands()")
                # Either the words are still flashed in the foot, or the screen the
                # command asked for is up. Both are the command having been obeyed.
                report.ok(
                    f'hears "{said}" and {wanted}',
                    said.split()[0] in heard.get("nibHead", "").lower()
                    or what in heard.get("nibHead", ""),
                    heard.get("nibHead", "").rstrip(),
                )

            # How long the plugin itself takes over a command, from the words arriving
            # to the panel being written. What the recogniser took before that is the
            # recogniser's own and is not ours to measure.
            page.evaluate("window.__even.calls = []; window.__heardAt = 0; window.__wroteAt = 0")
            worst = 0.0
            for _round in range(10):
                page.evaluate("window.__say('next')")
                page.wait_for_timeout(220)
                took = page.evaluate("window.__wroteAt - window.__heardAt")
                worst = max(worst, float(took or 0))

            # Nothing on the phone about the voice. Emil, on the panel this used to
            # put over his note: "that ugly listening overlay". The facts are still
            # here, in an element that is never drawn, so the drive can read them and a
            # reader is never shown them.
            report.ok(
                "puts no listening panel on the note at all",
                page.locator(".voice").count() == 0,
            )
            said = page.get_attribute("[data-voice]", "data-voice") or ""
            report.ok(
                "and still says which way it is listening, at no cost on screen",
                "webview" in said,
                said,
            )
            page.screenshot(path=str(OUT / "phone-voice.png"))

            report.ok("answers a spoken command inside one frame", worst < 16, f"{worst:.2f} ms worst")
            report.say(f"a command costs the plugin {worst:.2f} ms from the word to the panel")

            # A question, with the model answering from a stub.
            page.evaluate("window.__say('question what did I decide about the font')")
            page.wait_for_timeout(300)
            asking = page.evaluate("window.__bands()")
            report.ok(
                "puts the question up while the model is working",
                "what did i decide" in asking.get("nibHead", "").lower(),
                asking.get("nibHead", ""),
            )
            report.ok(
                "and puts nothing over the note on the phone while it waits",
                page.locator(".voice").count() == 0,
            )
            page.screenshot(path=str(OUT / "phone-asking.png"))
            screens.append({"name": "asking", "lineNumbers": True, **naming(asking)})

            page.wait_for_timeout(1200)
            answered = page.evaluate("window.__bands()")
            report.ok(
                "opens the answer on the glasses, one sentence first",
                "firmware font" in answered.get("nibBody", ""),
                answered.get("nibBody", "").split("\n")[0],
            )
            asked = page.evaluate("window.__asked")
            sent = asked[0] if asked else {}
            report.ok(
                "asked Nib the question, with the model and nothing else",
                sorted(sent.keys()) == ["effort", "model", "question"],
                json.dumps(sorted(sent.keys())),
            )
            report.ok(
                "sent no key and no note, because it has neither",
                "sk-" not in json.dumps(sent) and "firmware font" not in json.dumps(sent),
                json.dumps(sent),
            )
            hosts = page.evaluate("window.__hosts")
            report.ok(
                "reached nibeditor.com and nothing else, which is the whole whitelist",
                bool(hosts) and set(hosts) == {"nibeditor.com"},
                json.dumps(sorted(set(hosts))),
            )
            report.ok(
                "and nothing over the note on the phone when it comes back",
                page.locator(".voice").count() == 0,
            )
            page.screenshot(path=str(OUT / "phone-answer.png"))
            screens.append({"name": "answer", "lineNumbers": True, **naming(answered)})

            # A scroll goes down the answer a line at a time.
            first = answered.get("nibBody", "").split("\n")[0]
            page.evaluate("window.__gesture('down')")
            page.wait_for_timeout(300)
            scrolled = page.evaluate("window.__bands()")
            report.ok(
                "a scroll goes down the answer a line at a time",
                scrolled.get("nibBody", "").split("\n")[0] != first,
                scrolled.get("nibBody", "").split("\n")[0],
            )

            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(400)
            closed = page.evaluate("window.__bands()")
            report.ok(
                "a double tap closes the answer, back to the note",
                "firmware font only" not in closed.get("nibBody", "")
                and closed.get("nibNums", "").strip() != "",
                closed.get("nibHead", "").rstrip(),
            )

            # The frame, and the note on the phone, with the glasses on page one.
            open_note(page, "Even Realities glasses")
            page.screenshot(path=str(OUT / "phone-note.png"))
            back = page.evaluate("window.__bands()")
            screens.append({"name": "glasses-3", "lineNumbers": True, **naming(back)})

            # ── Everything the app has learned to write since ─────────────────
            # The mapping has unit tests for each of these; what this says is that a
            # note holding all of them reaches the panel through the whole road - the
            # app's own reader, the plugin's paging, the containers - and that nothing
            # the reader was never meant to see came with it.
            open_note(page, "Everything else")
            page.wait_for_timeout(900)
            whole = []
            for _page in range(12):
                bands = page.evaluate("window.__bands()")
                whole.append(f"{bands.get('nibHead', '')}\n{bands.get('nibBody', '')}")
                page.evaluate("window.__gesture('down')")
                page.wait_for_timeout(180)

            said = "\n".join(whole)
            report.ok(
                "a captioned fence says what it is above the code, and names the language alone",
                "src/panel.ts" in said and "‘‘‘ts" in said and "‘‘‘ts src" not in said,
                next((one for one in said.split("\n") if "src/panel.ts" in one), "not there"),
            )
            report.ok(
                "callouts say which kind they are, named or not, folded or not",
                all(one in said for one in ["WARNING", "RECIPE", "Mind the gap", "Behind the fold"]),
                "; ".join(one for one in ["WARNING", "RECIPE", "Behind the fold"] if one not in said),
            )
            report.ok(
                "and a callout's fold sign is not read out as words",
                "]-" not in said and "[!" not in said,
            )
            report.ok(
                "a comment is not on the panel, whichever way it was written",
                "note to myself" not in said and "an aside" not in said,
            )
            report.ok(
                "the properties at the head of a note are not on the panel either",
                "tags:" not in said and "status: reading" not in said,
            )
            report.ok(
                "tasks are boxes, filled or not",
                "□ a task not done" in said and "■ a task done" in said,
            )
            report.ok(
                "a table keeps its columns, and maths keeps its dollars",
                "head" in said and "body" in said and "$$" in said and "E = mc^2" in said,
            )
            page.screenshot(path=str(OUT / "phone-everything.png"))

            # ── Which scripts the firmware actually draws ─────────────────────
            # One line per writing system, on the glass, through the whole road: the
            # app's reader, the mapping, the firmware's own folding, the containers.
            # `packages/glasses/src/scripts.ts` is the list as data and its own test
            # holds it to the metrics; this is the same data seen on the panel, which
            # is where a claim about a font becomes a picture.
            open_note(page, "Scripts")
            page.wait_for_timeout(900)
            drawn = []
            for _page in range(6):
                bands = page.evaluate("window.__bands()")
                drawn.append(bands.get("nibBody", ""))
                if _page == 0:
                    screens.append({"name": "scripts", "lineNumbers": False, **naming(bands)})
                page.evaluate("window.__gesture('down')")
                page.wait_for_timeout(180)

            panel = "\n".join(drawn)
            wrong = []
            for one in SCRIPTS:
                line = next((row for row in panel.split("\n") if one["name"] in row), None)
                if line is None:
                    wrong.append(f"{one['name']} never reached the panel")
                elif one["draws"] and one["sample"] not in line:
                    wrong.append(f"{one['name']} should draw: {line.strip()}")
                elif not one["draws"] and "□" not in line:
                    wrong.append(f"{one['name']} should be boxes: {line.strip()}")

            report.ok(
                "every script the list claims is drawn is drawn, and every other is boxes",
                not wrong,
                "; ".join(wrong[:3]) or f"{len(SCRIPTS)} scripts on the glass",
            )
            report.say(
                "drawn: "
                + ", ".join(one["name"] for one in SCRIPTS if one["draws"])
                + "; boxes: "
                + ", ".join(one["name"] for one in SCRIPTS if not one["draws"])
            )
            page.screenshot(path=str(OUT / "phone-scripts.png"))

            open_note(page, "Even Realities glasses")
            page.wait_for_timeout(900)

            # ── The glasses' own microphone, and what a command costs on it ──
            # Emil, on even 0.5.7: "right now it's extremely delayed ... it takes so
            # long for a voice command that there's no reason to use it." This is the
            # path he is on: the WebView's recogniser answers `service-not-allowed` a
            # moment after starting, the plugin falls to the glasses' microphone, and
            # every word has to go to a model and come back.
            page.evaluate("window.__warmed = 0")
            page.evaluate("window.__refuse()")
            page.wait_for_timeout(400)
            report.ok(
                "a recogniser that refuses hands over to the glasses' microphone",
                page.evaluate("window.__even.mic") is True,
                page.get_attribute("[data-voice]", "data-voice") or "",
            )

            report.ok(
                "and opens the connection before there is anything to send through it",
                int(page.evaluate("window.__warmed")) >= 1,
                f"{page.evaluate('window.__warmed')} warm-ups",
            )

            # Half a second of "next", spoken into the glasses, and then quiet. What
            # is measured is what a person feels: from the last sound they made to the
            # panel in front of their eye changing.
            spoken = []
            for _round in range(5):
                # Alternating, so the page always has somewhere to go: "next" at the
                # end of a note writes nothing, and nothing written is nothing to
                # measure.
                page.evaluate(
                    "(word) => { window.__heardSays = word; window.__heardAt = 0;"
                    " window.__wroteAt = 0; window.__spokeAt = 0; window.__heardAsked = [] }",
                    "next" if _round % 2 == 0 else "back",
                )
                page.evaluate("window.__speak(500, true)")
                page.evaluate("window.__speak(900, false)")
                page.wait_for_timeout(1600)
                took = page.evaluate("window.__wroteAt - window.__spokeAt")
                if took and float(took) > 0:
                    spoken.append(float(took))

            spoken.sort()
            middle = spoken[len(spoken) // 2] if spoken else 0.0
            model = page.evaluate("window.__heardTakes")
            looks = page.evaluate("window.__heardAsked.length")
            report.ok(
                "a spoken command is acted on well under a second after the last word",
                len(spoken) == 5 and middle < 1000,
                f"{middle:.0f} ms in the middle of {len(spoken)} of 5 "
                f"{[round(one) for one in spoken]}, with a {model} ms model",
            )
            report.say(
                f"a command costs {middle:.0f} ms from the last word to the panel, "
                f"of which the model is {model} ms"
            )
            report.ok(
                "because the words are sent before the reader has stopped talking",
                looks >= 1,
                f"{looks} transcriptions for the last phrase",
            )
            took = page.get_attribute("[data-voice]", "data-took") or ""
            report.ok(
                "and the phone says where that time went, at no cost on screen",
                "spoke" in took and "hang" in took,
                took,
            )

            # Emil: "it doesn't change WHILE scrolling but you kinda need to pause for
            # it to react." The card is measured every frame off the note's own
            # scroll, so a drag moves it forty times rather than twice. Driven by
            # moving the scroller a little on each frame, which is what a finger on a
            # phone produces.
            followed = page.evaluate(
                """
                () => new Promise((done) => {
                  const scroller = document.querySelector('.cm-scroller')
                  const card = () => {
                    const one = document.querySelector('.frame')
                    if (!one) return 'gone'
                    const box = one.getBoundingClientRect()
                    return `${Math.round(box.top)}:${Math.round(box.bottom)}`
                  }

                  scroller.scrollTop = 0
                  const seen = []
                  let step = 0
                  const drag = () => {
                    scroller.scrollTop = step * 9
                    seen.push(card())
                    if (++step > 30) {
                      let moved = 0
                      for (let at = 1; at < seen.length; at++) {
                        if (seen[at] !== seen[at - 1]) moved++
                      }
                      return done({ frames: seen.length, moved })
                    }
                    requestAnimationFrame(drag)
                  }
                  requestAnimationFrame(drag)
                })
                """
            )
            report.ok(
                "the card follows the note on every frame of a scroll",
                followed["moved"] >= followed["frames"] * 0.8,
                f"moved in {followed['moved']} of {followed['frames']} frames",
            )
            page.wait_for_timeout(700)

            # Emil: "when I open the sidebar I can still see that frame." A mark on a
            # note has no business floating over the file list.
            #
            # Only true where the sidebar is a *drawer* over the note, which is what it
            # is on a phone and is not what it is in a headless browser at the same
            # width: the layout asks whether the pointer is a finger, not only how wide
            # the window is. So the rest of this drive runs as the phone it is about -
            # a coarse pointer, no hover, and Emil's own user agent - which is worth
            # having anyway.
            phone = page.context.new_cdp_session(page)
            # A finger rather than a mouse, which is what decides the layout.
            phone.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            phone.send(
                "Emulation.setEmulatedMedia",
                {
                    "features": [
                        {"name": "pointer", "value": "coarse"},
                        {"name": "hover", "value": "none"},
                    ]
                },
            )
            phone.send(
                "Emulation.setUserAgentOverride",
                {
                    "userAgent": "Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36"
                    " (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36"
                },
            )
            # The layout measures itself on a resize, so it is nudged rather than told.
            page.set_viewport_size({"width": 419, "height": 900})
            page.wait_for_timeout(200)
            page.set_viewport_size({"width": 420, "height": 900})
            page.wait_for_timeout(400)
            report.ok(
                "the sidebar is a drawer over the note here, the way it is on a phone",
                page.evaluate("document.documentElement.hasAttribute('data-drawer')"),
            )

            press(page, "Show sidebar")
            page.wait_for_timeout(500)
            report.ok(
                "and the card is not drawn at all while it is over the note",
                page.evaluate(
                    "() => { const one = document.querySelector('.frame');"
                    " return !one || Number(getComputedStyle(one).opacity) === 0 }"
                ),
                page.evaluate(
                    "() => { const one = document.querySelector('.frame');"
                    " return one ? getComputedStyle(one).opacity : 'no card' }"
                ),
            )

            press(page, "Hide sidebar")
            page.wait_for_timeout(600)
            report.ok(
                "and comes back when the note is bare again",
                page.evaluate(
                    "() => { const one = document.querySelector('.frame');"
                    " return !!one && Number(getComputedStyle(one).opacity) > 0 }"
                ),
                page.evaluate(
                    "() => { const one = document.querySelector('.frame');"
                    " return one ? getComputedStyle(one).opacity : 'no card' }"
                ),
            )

            # ── The icons of the spaces ───────────────────────────────────────
            # Emil, on his phone with even 0.5.6: "I don't see the icons of the
            # spaces on the Even Realities plugin right now." The icon a space wears
            # comes down with the account and is written into the plugin's own
            # storage - which is not the page's, because a packed plugin's port never
            # comes back - and the store that reads it was built before that storage
            # was in place. Both halves are measured: a space that chose an icon, and
            # one that did not and shows its letter instead.
            page.evaluate(SEED, [[[UNI_PATH, UNI]]])
            page.evaluate(
                "([icon]) => localStorage.setItem('nib:icons', JSON.stringify({ '/Notes': icon }))",
                [ICON],
            )
            page.wait_for_timeout(700)
            page.reload()
            page.wait_for_timeout(1500)
            press(page, "Show sidebar")
            page.wait_for_timeout(400)

            # The rail of squares is gone: the spaces are a switcher at the top of the
            # sidebar now, and each row wears its mark in a badge. Opened by its own
            # name, which is the button that says which space is up.
            opened = press(page, "Notes") or press(page, "Uni")
            page.wait_for_timeout(500)

            marks = page.evaluate(
                """
                () => [...document.querySelectorAll('.spaces .nib-row')].map((one) => {
                  const badge = one.querySelector('.nib-badge')
                  const path = badge ? badge.querySelector('svg path') : null
                  return {
                    name: (one.querySelector('.nib-row-label')?.textContent ?? '').trim(),
                    shape: badge ? badge.querySelectorAll('svg path').length : 0,
                    // The half that cannot be seen in the DOM: an element in the
                    // wrong namespace is there, is the right size, and draws nothing
                    // at all. See scripts/even-stage.mjs.
                    drawn: path ? path.namespaceURI : null,
                    said: badge ? (badge.textContent ?? '').trim() : '',
                  }
                })
                """
            )
            wearing = next((one for one in marks if one["name"] == "Notes"), None)
            plain = next((one for one in marks if one["name"] == "Uni"), None)
            report.ok(
                "the spaces open from the switcher in the sidebar",
                opened and len(marks) >= 2,
                f"{len(marks)} rows",
            )
            report.ok(
                "a space that chose an icon draws it in the plugin",
                bool(
                    wearing
                    and wearing["shape"] > 0
                    and wearing["drawn"] == "http://www.w3.org/2000/svg"
                ),
                json.dumps(wearing),
            )
            report.ok(
                "and one that chose none draws its letter, never an empty badge",
                bool(plain and plain["shape"] == 0 and plain["said"] == "U"),
                json.dumps(plain),
            )
            page.screenshot(path=str(OUT / "phone-spaces.png"))

            # ── A language the firmware has no glyphs for ─────────────────────
            # The app has thirty-nine interface catalogues; the firmware's one font
            # draws Latin, Cyrillic, Greek, CJK and emoji. A reader in Thai, Hindi or
            # Arabic had a menu of boxes on the glass, so the panel falls back to
            # English - and the catalogues the font cannot draw are not in the package
            # at all, which is 1.2 MB of it. Both halves are here: the panel is in
            # English, and the chunk that would have said otherwise is missing without
            # anything on the page breaking over it.
            page.evaluate("localStorage.setItem('nib:language', 'th')")
            page.wait_for_timeout(700)
            page.reload()
            page.wait_for_timeout(1800)
            page.evaluate("window.__gesture('hold')")
            page.wait_for_timeout(500)
            held = page.evaluate("window.__bands()")
            asked = held.get("nibBody", "")
            report.ok(
                "a reader whose script the firmware cannot draw gets an English panel",
                "Switch space" in asked and "Settings" in asked,
                asked.replace("\n", " | ")[:80],
            )
            report.ok(
                "and not one box on it",
                "□" not in asked,
                asked.replace("\n", " | ")[:80],
            )
            page.evaluate("window.__gesture('double')")
            page.wait_for_timeout(400)

            # ── And two the firmware draws ────────────────────────────────────
            # A reader whose script the font has keeps their own words on the glass.
            # German, the app's own second language, and Cantonese, the fortieth
            # catalogue and the first added since the rule existed: Han, so it draws.
            # A picture of the settings panel in each, because a panel of somebody
            # else's words is the one thing a screenshot settles.
            def panel_in(language: str) -> dict:
                page.evaluate("([one]) => localStorage.setItem('nib:language', one)", [language])
                page.wait_for_timeout(700)
                page.reload()
                page.wait_for_timeout(1800)
                page.evaluate("window.__gesture('hold')")
                page.wait_for_timeout(300)
                for _one in range(3):
                    page.evaluate("window.__gesture('down')")
                page.evaluate("window.__gesture('tap')")
                page.wait_for_timeout(500)
                bands = page.evaluate("window.__bands()")
                screens.append(
                    {"name": f"settings-{language}", "lineNumbers": True, **naming(bands)}
                )
                page.evaluate("window.__gesture('double')")
                page.evaluate("window.__gesture('double')")
                page.wait_for_timeout(500)
                return bands

            rows_de = panel_in("de").get("nibBody", "")
            report.ok(
                "a reader in German reads the panel in German",
                "Zeilennummern" in rows_de and "□" not in rows_de,
                rows_de.replace(chr(10), " | ")[:90],
            )

            rows_yue = panel_in("yue").get("nibBody", "")
            report.ok(
                "and a reader in Cantonese reads it in Cantonese, box free",
                "空行" in rows_yue and "□" not in rows_yue,
                rows_yue.replace(chr(10), " | ")[:90],
            )

            page.evaluate("localStorage.removeItem('nib:language')")

            # The note names a picture on purpose, to exercise the one block that
            # cannot be what it is on a panel of one font. Where the editor looks for
            # it in a browser is the editor's own business and not the plugin's, so
            # its miss is left out of this and everything else is not.
            astray = [one for one in missing if "sketch.png" not in one]
            report.ok("asks the server for nothing that is not there", not astray, "; ".join(astray[:3]))
            loose = [one for one in errors if "404" not in one]
            report.ok("no page errors anywhere along the way", not loose, "; ".join(loose[:3]))
        except Exception as bad:  # noqa: BLE001
            # The report is the whole point: a failure half way through has still
            # measured everything before it, and hiding that behind a traceback
            # makes the run useless.
            report.ok(f"the drive finished: {bad}"[:160], False)
        finally:
            browser.close()
            server.shutdown()

    (OUT / "screens.json").write_text(json.dumps(screens, indent=1), encoding="utf-8")
    subprocess.run(
        [
            "node",
            str(ROOT / "scripts" / "even-panel.mjs"),
            str(OUT / "screens.json"),
        ],
        check=True,
        cwd=ROOT / "packages" / "glasses",
    )

    # And the panels themselves, as pictures.
    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))
        try:
            shot = browser.new_page(viewport={"width": 576, "height": 288})
            for one in screens:
                name = one["name"]
                shot.goto((OUT / f"{name}.html").as_uri())
                shot.wait_for_timeout(120)
                shot.locator(".panel").screenshot(path=str(OUT / f"{name}.png"))
        finally:
            browser.close()

    # The pictures docs/even.md shows are these, so they are put where it looks for
    # them rather than copied by hand: a document with last month's panel in it is
    # worse than one with none.
    DOCS.mkdir(parents=True, exist_ok=True)
    for one in sorted(OUT.glob("*.png")):
        if one.name == "debug.png":
            continue
        (DOCS / one.name).write_bytes(one.read_bytes())

    report.say("")
    report.say(f"pictures in {OUT}, and in {DOCS}")
    report.show()
    return 1 if report.bad else 0


def press(page, name: str) -> bool:
    """Presses the first button by that name a finger could actually reach.

    Not simply the first in the document: the rail lives inside the drawer, so on a
    phone layout there are two buttons called `Show sidebar` and the one in the closed
    drawer is `inert` - which is right, and is not what a reader would press."""
    for one in page.get_by_role("button", name=name).all():
        # Visible is not the same as reachable: what is inside the closed drawer is
        # `inert`, which is drawn and takes no press at all.
        if not one.is_visible() or one.evaluate("el => !!el.closest('[inert]')"):
            continue

        try:
            one.click(timeout=4000)
            return True
        except Exception:  # noqa: BLE001
            continue

    return False


def open_note(page, name: str) -> None:
    """A note opened the way a reader opens one: the sidebar, and a row in it.

    By its row in the file list rather than by its words anywhere on the page: the
    note's own heading says the same thing, and a click that lands in the editor
    instead of on the list opens nothing."""
    if press(page, "Show sidebar"):
        page.wait_for_timeout(300)

    row = page.locator(f'.row[data-path$="/{name}.md"]')
    if row.count():
        row.first.click()
    else:
        page.get_by_text(name, exact=True).first.click()

    page.wait_for_timeout(1400)


def naming(bands: dict) -> dict:
    """The bands, by the name `even-panel.mjs` draws them under."""
    return {
        "head": bands.get("nibHead", ""),
        "rule": bands.get("nibRule", ""),
        "nums": bands.get("nibNums", ""),
        "body": bands.get("nibBody", ""),
        "foot": "",
        "mic": bands.get("nibMic", ""),
    }


if __name__ == "__main__":
    sys.exit(main())
