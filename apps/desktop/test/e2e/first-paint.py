"""How long the file list takes to appear, and how long until the note can be typed in.

A space of three thousand notes, with links, tags and front matter in every one of
them, written straight into the browser's storage; then the app is launched against
it and the launch is timed from the navigation to three moments:

    tree     the first row of the file list on screen
    note     the open note's editor on screen
    index    the link index landed, which is the pass that reads every body

then two numbers that are not moments - the longest gap between animation frames
and the longest single task, both taken from the moment the tree appears, which
together are the keystrokes a reader would lose to whatever the launch is still
doing behind their note - and four more taken warm, with the launch out of the way:
what one listing of the space costs, what one read of every body costs, how many
rows of the file list are in the page at all, and the longest frame gap while the
list is flicked from the top of the space to the bottom.

Two builds at once, each on its own port, turn and turn about. A laptop's own load
moves by more than this change does, so five launches of one build followed by five
of the other measures the afternoon rather than the code.

Build both, with the app's own handle on the page - a production build hides the
stores this reads. From the repository root, with the change in place:

    cd apps/desktop
    NODE_ENV=development pnpm exec vite build --mode drive

and then the same again from the commit before it, into a folder of its own. A
worktree rather than a stash: the stash stack belongs to the whole repository, so a
`git stash pop` in one worktree can restore whatever another one pushed last, and two
sets of changes swap owners with nothing said. `git worktree add <path> <sha>` gives
the other build a checkout of its own and costs nothing but disk.

    NODE_ENV=development pnpm exec vite build --mode drive --outDir dist-before

Then, from the repository root:

    python apps/desktop/test/e2e/first-paint.py

Either folder on its own is fine; the one that is there is the one that is driven.
It prints numbers and nothing else: a scratch drive, not a test. The ordering
itself is a test, in src/lib/startup-order.test.ts.

What it said on one laptop, nine launches each, over three thousand notes of four
kilobytes - before the file list was painted first, and after:

    time to tree                      1943ms ->  341ms
    time to the open note             2479ms ->  460ms
    link index landed                 2554ms -> 1447ms
    worst frame gap after the tree     383ms ->  200ms
    listing the space, warm            188ms ->   97ms

and what it said for the window over the rows - the change after that one, which
left every row exactly as it was and stopped drawing the ones nobody can see. A
slower machine than the one above, so read the ratios rather than the numbers; 754
is how many rows this space shows with its folders shut, and 3,005 with them open:

    rows of the list in the page       754    ->   40
    longest single task after the tree 550ms  ->  136ms
    worst frame gap after the tree     633ms  ->  117ms
    longest single task in that scan   543ms  ->   57ms
    time to tree                      2551ms -> 1930ms

The last of those is the pass that reads every body, and the row that asks the index
for its icon is in it: that number is the two hundred milliseconds a reader used to
lose to the index landing behind their note, because every row in the space asked it
for a mark and now only the forty on screen do.

Flicking the list is the same either way, and that is worth knowing: a page of seven
hundred rows nobody is changing scrolls perfectly well. What the window is for is the
work - painting them in the first place, and answering the index for every one of
them - not the scrolling.
"""

from __future__ import annotations

import functools
import http.server
import json
import statistics
import threading
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# Above 1425, and not any other drive's port. One per build, so each has storage of
# its own: two builds cannot share one database, since the one after the change
# keeps a listing beside the notes and the one before it does not.
PORT = 18991

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

#: How many notes the space holds.
NOTES = 3000
#: How many launches each number is the middle of.
ROUNDS = 9

#: A page on the app's own origin that is not the app, so the storage underneath it
#: can be written without the app being up to read it half way through.
SEED_PAGE = "<!doctype html><title>seed</title><p>seeding"


def say(words: str) -> None:
    print(f"  {words}", flush=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The same server, without a line per asset."""

    def log_message(self, *args: object) -> None:  # noqa: D102
        return




# Three thousand notes into IndexedDB, written the way the app's own store writes
# them: rows keyed by path in `files`, and - where the build has one - the listing
# beside them in `stats`. Which stores exist is read off the database rather than
# assumed, so the same drive seeds the build before the change and the one after.
SEED = """
async (count) => {
  const open = () => new Promise((go, no) => {
    const ask = indexedDB.open('nib')
    ask.onupgradeneeded = () => {
      const db = ask.result
      for (const name of ['files', 'assets', 'stats']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'path' })
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true }).createIndex('notePath', 'notePath')
      }
    }
    ask.onsuccess = () => go(ask.result)
    ask.onerror = () => no(ask.error)
  })

  const db = await open()
  const has = (name) => db.objectStoreNames.contains(name)
  const stores = ['files', ...(has('stats') ? ['stats'] : [])]

  const folders = ['Field notes', 'Reading', 'Work', 'Work/Q3', 'Archive']
  const tags = ['#wind', '#ink', '#paper', '#kestrel', '#plan']
  const now = Date.now()

  // A note with front matter, an icon, an alias, tags and links out of it, so the
  // scan that reads every body has every kind of thing to find - and long enough to
  // be a note somebody wrote rather than a stub. Four kilobytes is a page and a
  // half, which over three thousand notes is the twelve megabytes a space of this
  // size actually weighs; a stub each would have measured the listing against a
  // store small enough for reading all of it to cost nothing, which is not the
  // space anybody has.
  const body = (at) => {
    const tag = tags[at % tags.length]
    const to = (at + 7) % count
    const lines = [
      '---',
      'icon: rocket',
      'icon-color: violet',
      'aliases:',
      `  - note ${at} elsewhere`,
      '---',
      '',
      `# Note ${at}`,
      '',
      `${tag} and a line about the wind, written on the ${at}th of the month.`,
      '',
      `See [[note-${String(to).padStart(4, '0')}]] and [the plan](Work/Q3/plan.md).`,
      '',
    ]

    for (let part = 0; lines.join('\\n').length < 4000; part++) {
      lines.push(
        `## What went in, ${part}`,
        '',
        '- Pressure on the pen',
        '- Slides out of a note',
        '',
        'The wind was steady all week, and the ink took its time. What the pen leaves',
        'behind on paper is the only part of this anybody reads twice.',
        '',
      )
    }

    return lines.join('\\n')
  }

  const pathOf = (at) => {
    const folder = at % 4 === 0 ? '' : `${folders[at % folders.length]}/`
    return `/Big/${folder}note-${String(at).padStart(4, '0')}.md`
  }

  // In batches, because one transaction of three thousand puts is a minute of
  // waiting and several hundred is not.
  const SIZE = 250
  for (let from = 0; from < count; from += SIZE) {
    await new Promise((go, no) => {
      const change = db.transaction(stores, 'readwrite')
      change.oncomplete = () => go()
      change.onerror = () => no(change.error)

      const files = change.objectStore('files')
      const listing = has('stats') ? change.objectStore('stats') : null

      for (let at = from; at < Math.min(count, from + SIZE); at++) {
        const path = pathOf(at)
        const row = { path, content: body(at), created: now - at * 1000, modified: now - at * 500 }
        files.put(row)
        listing?.put({ path, modified: row.modified, created: row.created })
      }
    })
  }

  db.close()
  return stores
}
"""

# Installed before the app's first script runs, so the marks are taken against the
# navigation rather than against whenever a poll got round to looking. A single
# observer for the two surfaces, and a frame counter that runs the whole time: the
# gap between two frames is the length of the task that sat between them, which is
# what a keystroke would have waited behind.
MARKS = """
window.__marks = { tree: null, note: null, worst: 0, frames: 0, task: 0 }

const marks = window.__marks
const look = () => {
  if (marks.tree === null && document.querySelector('aside .row')) {
    marks.tree = performance.now()
  }
  if (marks.note === null && document.querySelector('.cm-content')) {
    marks.note = performance.now()
  }
}

// On the document itself, which exists before there is an element in it: this runs
// before the app's first script, and a watch that waited for the body would miss
// whatever the first paint already held.
new MutationObserver(look).observe(document, { childList: true, subtree: true })

// And the longest single task the launch spends, once the list is on screen: the
// frame gap says the same thing more roughly, and a gap is easy to blame on
// whatever else the machine was doing.
new PerformanceObserver((list) => {
  if (marks.tree === null) return
  for (const one of list.getEntries()) marks.task = Math.max(marks.task, one.duration)
}).observe({ entryTypes: ['longtask'] })

let last = performance.now()
const tick = (at) => {
  // Only once the list is up: the gap before that is the launch itself, which the
  // moments above already say, and this number is about what comes after it.
  if (marks.tree !== null) {
    marks.frames += 1
    marks.worst = Math.max(marks.worst, at - last)
  }
  last = at
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
"""

#: How long to watch for jank after the list appears.
WATCHING = 4000

# The listing on its own, with the launch out of the way: how long it takes to ask
# the storage what spaces there are and what is in the open one. This is the part
# the store change is about, and measuring it warm keeps the bundle, the editor and
# the fonts out of the number.
LISTING = """
async (rounds) => {
  const ws = window.nibApp.workspace
  const taken = []

  for (let round = 0; round < rounds; round++) {
    const started = performance.now()
    await ws.loadSpaces()
    await ws.loadTree()
    taken.push(performance.now() - started)
  }

  return taken.sort((a, b) => a - b)[Math.floor(rounds / 2)]
}
"""

# And the pass that reads every body, warm, for the same reason - with the longest
# single task it spent doing it, which is the one that would have swallowed a
# keystroke. The first row asking for its icon is in there too: that is what walks
# the whole index, and it is the tree's own read of it.
SCAN = """
async (rounds) => {
  const links = window.nibApp.links
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const taken = []
  let worst = 0

  const watch = new PerformanceObserver((list) => {
    for (const one of list.getEntries()) worst = Math.max(worst, one.duration)
  })
  watch.observe({ entryTypes: ['longtask'] })

  for (let round = 0; round < rounds; round++) {
    const started = performance.now()
    // Told it is of nowhere first, so the build is a build rather than a no-op.
    links.clear()
    await links.build(root)
    for (const one of ws.notes.slice(0, 3)) links.iconOf(one.path)
    taken.push(performance.now() - started)
  }

  await new Promise((go) => setTimeout(go, 300))
  watch.disconnect()

  return { scan: taken.sort((a, b) => a - b)[Math.floor(rounds / 2)], worst }
}
"""


# How many rows of the file list are in the page, and what it costs to read the
# whole space down. A row is a button, a mark and a read of the link index, so the
# count is the work; the frame gap is what a flick feels like. The panel says which
# box it is in - `data-region="list"` - rather than a class, since a scoped class is
# the build's to name.
LIST = """
async () => {
  const box = document.querySelector('aside [data-region="list"]')
  if (!box) return null

  const rows = () => document.querySelectorAll('aside [data-region="list"] .row').length
  const frame = () => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(go)))

  box.scrollTop = 0
  await frame()
  const resting = rows()

  let worst = 0
  let last = performance.now()
  let watching = true
  const tick = (at) => {
    worst = Math.max(worst, at - last)
    last = at
    if (watching) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Half a panel at a time, from the top of the space to the bottom: what reading
  // a space of three thousand notes down actually asks of the list.
  const most = box.scrollHeight - box.clientHeight
  const step = Math.max(1, Math.floor(box.clientHeight / 2))
  let seen = resting
  for (let at = 0; at <= most; at += step) {
    box.scrollTop = at
    await frame()
    seen = Math.max(seen, rows())
  }

  watching = false
  await frame()

  return { rows: seen, scroll: worst, height: Math.round(box.scrollHeight) }
}
"""


def numbers(page: Page) -> dict[str, float]:
    return page.evaluate("() => window.__marks")


def warm(page: Page, origin: str) -> None:
    """One launch whose only job is to leave a session behind: which space was open,
    which note, and that the file list was the panel showing. Every launch measured
    after this one is a launch of an app somebody has used before, which is the
    launch that happens every day."""
    page.goto(origin, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_function(
        "() => !!document.querySelector('aside .row') && !!document.querySelector('.cm-content')",
        timeout=60000,
    )
    # The session is written as things settle, so give it the moment it takes.
    page.wait_for_timeout(2000)


def launch(page: Page, origin: str) -> dict[str, float]:
    """One measured launch."""
    page.goto(origin, wait_until="commit")
    page.wait_for_function("() => window.__marks && window.__marks.tree !== null", timeout=60000)
    page.wait_for_function("() => window.__marks.note !== null", timeout=60000)

    # The index is the pass that reads every body, and its own store says when it
    # has landed.
    page.wait_for_function(
        "() => window.nibApp && window.nibApp.links.rootOf() && !window.nibApp.links.scanning",
        timeout=120000,
    )
    index = page.evaluate("() => performance.now()")

    page.wait_for_timeout(WATCHING)
    taken = numbers(page)
    taken["index"] = index
    return taken


def middle(rounds: list[dict[str, float]], key: str) -> float:
    return statistics.median(one[key] for one in rounds)


#: The numbers, in the order they are worth reading, and what each is counted in.
#: Most are milliseconds; two are not, and a count of rows printed as a duration is
#: a number nobody can read.
SAID = [
    ("tree", "time to tree (first row painted)", "ms"),
    ("note", "time to the open note (editor painted)", "ms"),
    ("index", "link index landed", "ms"),
    ("worst", "worst frame gap after the tree", "ms"),
    ("task", "longest single task after the tree", "ms"),
    ("listing", "listing the spaces and the space, warm", "ms"),
    ("scan", "reading every body for the index, warm", "ms"),
    ("longest", "longest single task in that scan", "ms"),
    ("rows", "rows of the list in the page", ""),
    ("scroll", "worst frame gap flicking the list", "ms"),
    ("height", "how far the list runs", "px"),
]


class Lane:
    """One build, served and driven. Two of these run interleaved, because this
    machine's own load moves by more than the change does: five launches of one
    build and then five of the other measures the afternoon, not the code."""

    def __init__(self, tag: str, folder: str, port: int) -> None:
        self.tag = tag
        self.folder = APP / folder
        self.port = port
        self.origin = f"http://127.0.0.1:{port}"
        self.rounds: list[dict[str, float]] = []
        self.warm: dict[str, float] = {}

        handler = functools.partial(Quiet, directory=str(self.folder))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.page: Page | None = None

    def start(self) -> None:
        (self.folder / "seed.html").write_text(SEED_PAGE, encoding="utf-8")
        self.thread.start()
        say(f"{self.tag}: serving {self.folder} on {self.origin}")

    def stop(self) -> None:
        self.server.shutdown()

    def ready(self, browser) -> None:
        """A seeded store, and a session as an app somebody has used before leaves
        one. A context of its own, which is a port of its own, which is storage of
        its own: the two builds cannot be given one database, since the one after
        the change keeps a listing beside the notes and the one before it does not."""
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=DESKTOP_AGENT,
        )
        context.add_init_script(MARKS)
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"{self.tag}: page error: {error}"))

        page.goto(f"{self.origin}/seed.html", wait_until="domcontentloaded")
        stores = page.evaluate(SEED, NOTES)
        say(f"{self.tag}: {NOTES} notes seeded into {stores}")

        self.page = page
        warm(page, self.origin)
        say(f"{self.tag}: session written")

    def park(self) -> None:
        """Off the app and onto nothing, so a lane that is not being measured is not
        an app running beside the one that is."""
        if self.page:
            self.page.goto("about:blank", wait_until="domcontentloaded")

    def round(self) -> None:
        page = self.page
        if not page:
            return

        taken = launch(page, self.origin)
        self.rounds.append(taken)
        say(
            f"{self.tag} round {len(self.rounds)}: tree {taken['tree']:.0f}ms"
            f"  note {taken['note']:.0f}ms"
            f"  index {taken['index']:.0f}ms"
            f"  worst frame gap {taken['worst']:.0f}ms"
            f"  longest task {taken['task']:.0f}ms"
        )

    def measure(self) -> None:
        """The two warm numbers. A launch first, since the lane may have been parked
        while the other one was measured, and then the app is asked to do the two
        things again with nothing else happening."""
        page = self.page
        if not page:
            return

        warm(page, self.origin)
        # The list first, before the index is asked to run again: what is being
        # counted is the panel as a reader finds it, not as a scan leaves it.
        listed = page.evaluate(LIST) or {}
        scanning = page.evaluate(SCAN, 3)
        self.warm = {
            "listing": page.evaluate(LISTING, ROUNDS),
            "scan": scanning["scan"],
            "longest": scanning["worst"],
            **{key: listed[key] for key in ("rows", "scroll", "height") if key in listed},
        }

    def numbers(self) -> dict[str, float]:
        return {
            **{key: middle(self.rounds, key) for key, *_ in SAID if key in self.rounds[0]},
            **self.warm,
        }


def main() -> int:
    # A folder per build. The one before the change is built into `dist-before`;
    # see the note at the top of this file.
    wanted = [
        Lane("before", "dist-before", PORT + 1),
        Lane("after", "dist", PORT),
    ]
    lanes = [one for one in wanted if (one.folder / "index.html").exists()]
    if not lanes:
        say("nothing built")
        return 1

    for lane in lanes:
        lane.start()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")

            for lane in lanes:
                lane.ready(browser)

            # Turn and turn about, so whatever the machine is doing is done to both,
            # and one at a time, so neither is what the machine is doing.
            for _ in range(ROUNDS):
                for lane in lanes:
                    for other in lanes:
                        if other is not lane:
                            other.park()
                    lane.round()

            for lane in lanes:
                for other in lanes:
                    if other is not lane:
                        other.park()
                lane.measure()

            browser.close()
    finally:
        for lane in lanes:
            lane.stop()

    print()
    print(f"median of {ROUNDS} launches over {NOTES} notes, run turn and turn about:")
    print(f"  {'':44} {'  '.join(f'{lane.tag:>9}' for lane in lanes)}")
    found = {lane.tag: lane.numbers() for lane in lanes}

    for key, words, unit in SAID:
        row = "  ".join(f"{found[lane.tag].get(key, 0):7.0f}{unit:<2}" for lane in lanes)
        print(f"  {words:44} {row}")

    print()
    print(json.dumps({tag: {key: round(value) for key, value in one.items()} for tag, one in found.items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
