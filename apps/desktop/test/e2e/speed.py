"""What the built web app actually costs, in Chrome, measured against counted work.

Eleven things are timed, twice over: once against the build as it stands and once
against a build of the code before the change, served side by side on ports of
their own so neither is what the machine was doing while the other was measured.

    launch          the navigation to the first paint, to the file list, to the
                    editor, and to the first half second the main thread has
                    nothing left to do in - which is the first moment a keystroke
                    would land in the frame it was typed in
    big note        a note of twenty thousand lines opened, and a key pressed at
                    the end of it, input to paint
    tabs            the other tab shown
    palette         Mod-P to the list on screen
    settings        the sheet on screen
    search          four queries over five thousand notes: one hit, no hits, a
                    tag, a task - and whether the notes were read again for any
                    of them, which is the counter the worker keeps
    graph           five thousand nodes, panned
    canvas          ten thousand strokes: opened, panned, zoomed, drawn on
    reading         the big note as a page
    memory          the heap once the launch has settled

Nothing here asserts. It prints numbers taken over several rounds run turn and turn
about, because this machine's own load moves by more than most of these changes do.
A row in milliseconds is reported as its least disturbed round and not its median:
noise only ever adds time, so the quietest round is the one that is about the code,
and it is the only one that repeats. See `pick`. The counted work behind each fix is
asserted in the unit tests beside the code it is about; a clock says what the machine
was doing and a count says what the code did.

The two search walks that keep a clock on themselves are timed here and nowhere
else. Both count what the code did, and those counts are their test; each also has
one wall-clock bound on its worst case, which a loaded machine misses for reasons
that are nothing to do with the code. So they ask for `NIB_PERF=1` before they
believe their own clock, this drive is the only thing that sets it, and it is asked
before a browser exists. `--no-clock` leaves it out. See `clocked`.

Every run ends by reading each lane against the other and against what the row is
worth to nobody - the two halves of the run asked the same question. Put the same
build in both folders and every row must read `same`; a row that says `differs` then
is a fault in this file. `--as-was` serves the way this file used to, which is how
that check earns its keep: HTTP/1.0 with no caching headers made Chrome guess how
long each asset was good for from the folder's own timestamp, so the same build in
two folders written minutes apart was two different launches - 252 revalidation
round-trips in one lane and none in the other, and sixty to ninety milliseconds on
the file list and the editor for it.

Two builds, each with the app's own handle on the page - a production build hides
the stores this reads. From the repository root:

    cd apps/desktop
    NODE_ENV=development pnpm exec vite build --mode drive

and, from a tree without the change in it, the same again into a folder of its own:

    NODE_ENV=development pnpm exec vite build --mode drive --outDir dist-before

Then, from the repository root:

    python apps/desktop/test/e2e/speed.py

Either folder on its own is fine; the one that is there is the one that is driven.
A subset by name, when one number is being chased:

    python apps/desktop/test/e2e/speed.py launch search canvas

The names are the keys of `PARTS`. `--rounds` sets how many of each.

When a number here is bad, the next question is which function. The long animation
frames this prints already name the file and the handler; for the function, build a
third time with the names left in and take a sampling profile of the one thing:

    NODE_ENV=development pnpm exec vite build --mode drive \
        --outDir dist-profile --minify false

then drive that folder with Chrome's own profiler through `CDPSession`
(`Profiler.enable`, `Profiler.start`, the gesture, `Profiler.stop`) and sum the
samples per call frame. Every cause named in this file's comments was found that
way, and the folder is ignored so it can be left lying about.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import shutil
import statistics
import subprocess
import threading
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# Above 1425, and not any other drive's port. One per build and per space: two
# builds cannot share one database, and a space of five thousand notes in the same
# database as the empty one would make the empty launch a launch of both.
PORTS = {("before", "big"): 21901, ("after", "big"): 21902, ("before", "empty"): 21903, ("after", "empty"): 21904}

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

#: How many notes the big space holds.
NOTES = 5000
#: How many lines the big note holds.
LINES = 20000
#: How many ink strokes the canvas holds.
STROKES = 10000
#: How many points each of them went through.
POINTS = 10

#: A page on the app's own origin that is not the app, so the storage underneath it
#: can be written before the app is up to read it.
SEED_PAGE = "<!doctype html><title>seed</title><p>seeding"

#: How long to watch for jank while a gesture runs.
GESTURE = 1500

#: How many launches a lane gets before any of them is timed; see `ready`.
WARMING = 3

#: How long the machine is left alone between one lane's round and the next.
SETTLING = 2000


def say(words: str) -> None:
    print(f"  {words}", flush=True)


#: What each lane's server was asked for, by port: how many requests, how many of
#: them were answered out of the folder rather than with a "you already have it",
#: and how many bytes went down the socket. A lane that fetches its assets while
#: the other lane reads them out of the browser's cache is not the same launch, and
#: this is the counter that says so.
SERVED: dict[int, dict[str, int]] = {}

#: Served the way this file used to serve, for showing that the way it serves now is
#: what fixed the lane bias: HTTP/1.0, no caching headers, and the build's own
#: mtimes. `--as-was` sets it. Nothing but the proof should ever want it.
AS_WAS = False


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The same server, told to behave like the one a build is really served by.

    Three things, all of which were measuring the rig rather than the app.

    HTTP/1.1, so the connection is kept between assets. The default is HTTP/1.0,
    which closes after every response: a page of thirty assets was thirty TCP
    connections and - because this is a `ThreadingHTTPServer` - thirty Python
    threads, taking the interpreter's lock turn and turn about with the thread that
    is driving the measurement.

    A `Cache-Control` on everything, because without one Chrome has to guess how
    long a file is good for, and what it guesses is a tenth of the file's own age.
    The two lanes are two folders written at two different times, so the same build
    served twice got two different freshness lifetimes: the older folder was served
    out of the browser's cache and the newer one revalidated every asset over the
    socket. That is the lane bias - it follows the folder's timestamp, not the code
    in it, which is why it survived byte-identical builds.

    And a fixed `Last-Modified`, so nothing downstream of this can tell the two
    folders apart by their age either.
    """

    @property
    def protocol_version(self) -> str:  # type: ignore[override]
        """One connection for the whole page, as a real server keeps it."""
        return "HTTP/1.0" if AS_WAS else "HTTP/1.1"

    #: A kept connection holds a thread; this is how long an idle one keeps it.
    timeout = 10

    #: One date for every file in every lane. The build's own mtimes are what made
    #: the two lanes different, and nothing here wants to know them.
    STAMP = "Mon, 01 Jan 2024 00:00:00 GMT"

    def log_message(self, *args: object) -> None:  # noqa: D102
        return

    def send_header(self, keyword: str, value: str) -> None:
        """`Last-Modified` flattened on the way out, wherever it is sent from - and
        the body's length counted where it is promised, which is the one place a
        length is known and is not a race with the socket."""
        if keyword == "Last-Modified" and not AS_WAS:
            value = self.STAMP
        if keyword == "Content-Length":
            self.tally()["bytes"] += int(value)
        super().send_header(keyword, value)

    def end_headers(self) -> None:
        """The caching a deploy of this actually sends, and the desktop build has by
        being on the disk already: an asset under a hash of its content is good
        forever, and the page that names them is checked every time so a rebuild is
        never missed. Both lanes, identically."""
        if not AS_WAS:
            forever = self.path.startswith("/assets/") and "." in self.path.rsplit("/", 1)[-1]
            super().send_header(
                "Cache-Control",
                "public, max-age=31536000, immutable" if forever else "no-cache",
            )
        super().end_headers()

    def tally(self) -> dict[str, int]:
        """This lane's counter."""
        return SERVED.setdefault(
            self.server.server_address[1], {"asked": 0, "sent": 0, "again": 0, "bytes": 0}
        )

    def send_response(self, code: int, message: str | None = None) -> None:
        """Counted here, where every answer passes and its code is known."""
        held = self.tally()
        held["asked"] += 1
        if code == 200:
            held["sent"] += 1
        elif code == 304:
            held["again"] += 1
        super().send_response(code, message)



# --------------------------------------------------------------------------- seed

# The notes, the big note and the canvas, written the way the app's own store
# writes them: a row per path in `files`, and the listing beside it in `stats`.
# Which stores exist is read off the database rather than assumed, so the same
# drive seeds a build from before a store was added.
SEED = r"""
async (plan) => {
  const { notes, lines, strokes, points, space } = plan

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
  const now = Date.now()

  const rows = []
  const add = (path, content, at) => rows.push({ path, content, created: now - at * 1000, modified: now - at * 500 })

  const folders = ['Field notes', 'Reading', 'Work', 'Work/Q3', 'Archive']
  const tags = ['#wind', '#ink', '#paper', '#kestrel', '#plan']

  // A note with front matter, an icon, an alias, tags, tasks and links out of it,
  // so every operator has something to find and the scan that reads every body has
  // every kind of thing in it. Four kilobytes is a page and a half, which over five
  // thousand notes is the twenty megabytes a space of this size actually weighs: a
  // stub each would have measured the search against a store small enough for
  // reading all of it to cost nothing, which is not the space anybody has.
  const body = (at) => {
    const tag = tags[at % tags.length]
    const to = (at + 7) % notes
    const out = [
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
      // The one word in the space that names this note and nothing else: a query
      // for it is a hit the walk cannot stop early on, which is the search every
      // other one is faster than.
      `Filed under marker-${String(at).padStart(4, '0')}.`,
      '',
      `See [[note-${String(to).padStart(4, '0')}]] and [the plan](Work/Q3/plan.md).`,
      // Every fifth note points at one note, so the space holds a note a thousand
      // others link to. A space where every note has exactly one link in is a space
      // where the Links panel is never asked a hard question, and the hard question
      // is the one somebody with a hub note - an index, a person, a project - asks
      // every time they open it. See `part_links`.
      ...(at % 5 === 0 ? [`Filed under [[hub]].`, ''] : []),
      '',
      '- [ ] Pressure on the pen',
      '- [x] Slides out of a note',
      '',
    ]

    for (let part = 0; out.join('\n').length < 4000; part++) {
      out.push(
        `## What went in, ${part}`,
        '',
        'The wind was steady all week, and the ink took its time. What the pen leaves',
        'behind on paper is the only part of this anybody reads twice.',
        '',
      )
    }

    return out.join('\n')
  }

  const pathOf = (at) => {
    const folder = at % 4 === 0 ? '' : `${folders[at % folders.length]}/`
    return `${space}/${folder}note-${String(at).padStart(4, '0')}.md`
  }

  for (let at = 0; at < notes; at++) add(pathOf(at), body(at), at)

  // The folder marker, so a space with no notes in it is still a space.
  add(`${space}/.keep`, '', notes)

  // One small note, so every space has an editor to reach - the empty one too.
  add(`${space}/first.md`, '# First\n\nA short note, opened at launch.\n', notes + 1)

  // The note a fifth of the space points at. Short itself: what is being measured
  // when it is opened is the panel finding what points here, not the editor.
  add(`${space}/hub.md`, '# Hub\n\nThe note everything is filed under.\n', notes + 5)
  add(`${space}/second.md`, '# Second\n\nThe other tab.\n', notes + 2)

  // The big note: twenty thousand lines with headings, links, tasks and tags
  // through it, so the editor has the work a long note of somebody's actually is
  // rather than one paragraph repeated.
  if (lines) {
    const long = ['# The long one', '']
    for (let line = 0; long.length < lines; line++) {
      if (line % 40 === 0) long.push(`## Part ${line / 40}`, '')
      if (line % 17 === 0) long.push(`- [ ] Something at line ${line} #plan`)
      else if (line % 11 === 0) long.push(`See [[note-${String(line % 1000).padStart(4, '0')}]] on this.`)
      else if (line % 7 === 0) long.push('')
      else long.push(`Line ${line}: the wind was steady and the ink took its time on the page.`)
    }
    add(`${space}/long.md`, long.join('\n'), notes + 3)
  }

  // And the canvas: ten thousand strokes of ink, spread over a plane wide enough
  // that panning brings new ones into view, plus a handful of cards so the plane is
  // a plane rather than a drawing.
  if (strokes) {
    const ink = []
    for (let at = 0; at < strokes; at++) {
      const column = at % 100
      const row = Math.floor(at / 100)
      const x = column * 120 + 40
      const y = row * 120 + 40
      const packed = []
      for (let step = 0; step < points; step++) {
        packed.push(
          Math.round((x + step * 8) * 10) / 10,
          Math.round((y + Math.sin(step) * 20) * 10) / 10,
          0.5,
          0,
          0,
          step * 12,
        )
      }
      ink.push({ id: `s${at}`, tool: 'pen', color: 'ink', size: 3, points: packed })
    }

    const nodes = []
    for (let at = 0; at < 20; at++) {
      nodes.push({
        id: `n${at}`,
        type: 'text',
        x: (at % 5) * 400,
        y: Math.floor(at / 5) * 300,
        width: 260,
        height: 120,
        text: `Card ${at}`,
      })
    }

    add(`${space}/plane.canvas`, JSON.stringify({ nodes, edges: [], nib: { version: 1, ink } }), notes + 4)
  }

  // In batches, because one transaction of five thousand puts is a minute of
  // waiting and several hundred is not.
  const SIZE = 200
  for (let from = 0; from < rows.length; from += SIZE) {
    await new Promise((go, no) => {
      const change = db.transaction(stores, 'readwrite')
      change.oncomplete = () => go()
      change.onerror = () => no(change.error)

      const files = change.objectStore('files')
      const listing = has('stats') ? change.objectStore('stats') : null

      for (const row of rows.slice(from, from + SIZE)) {
        files.put(row)
        listing?.put({ path: row.path, modified: row.modified, created: row.created })
      }
    })
  }

  db.close()
  return { rows: rows.length, stores }
}
"""

# --------------------------------------------------------------------------- marks

# Installed before the app's first script runs, so every moment is taken against
# the navigation rather than against whenever a poll got round to looking.
#
# Four moments and two counters. The moments are the first paint the browser
# reports, the first row of the file list, the editor, and - worked out at the end -
# the first half second after the editor in which no task ran long enough to eat a
# frame, which is the first moment typing would have appeared in the frame it
# happened in. The counters are every long task and every long animation frame,
# kept with the scripts the browser blames for them, which is the profile.
MARKS = r"""
window.__marks = { paint: null, tree: null, editor: null, tasks: [], loaf: [] }
const marks = window.__marks

const look = () => {
  if (marks.tree === null && document.querySelector('aside .row')) marks.tree = performance.now()
  if (marks.editor === null && document.querySelector('.cm-content')) marks.editor = performance.now()
}

// On the document itself, which exists before there is an element in it: this runs
// before the app's first script, and a watch that waited for the body would miss
// whatever the first paint already held.
new MutationObserver(look).observe(document, { childList: true, subtree: true })

new PerformanceObserver((list) => {
  for (const one of list.getEntries()) {
    if (one.name === 'first-contentful-paint' && marks.paint === null) marks.paint = one.startTime
  }
}).observe({ type: 'paint', buffered: true })

new PerformanceObserver((list) => {
  for (const one of list.getEntries()) marks.tasks.push({ at: one.startTime, ms: one.duration })
}).observe({ entryTypes: ['longtask'] })

// The long animation frames, with what the browser blames: a frame's own length,
// how much of it blocked, how long style and layout were forced inside it, and the
// three longest scripts by name. This is the attribution the profile is read from.
if (typeof PerformanceObserver.supportedEntryTypes !== 'undefined'
    && PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
  new PerformanceObserver((list) => {
    for (const one of list.getEntries()) {
      const scripts = [...(one.scripts ?? [])]
        .sort((a, b) => b.duration - a.duration)
        .slice(0, 3)
        .map((script) => ({
          name: `${script.invokerType ?? ''} ${script.invoker ?? ''} ${script.sourceFunctionName ?? ''}`.trim(),
          url: (script.sourceURL ?? '').split('/').pop() ?? '',
          ms: Math.round(script.duration),
          layout: Math.round(script.forcedStyleAndLayoutDuration ?? 0),
        }))

      marks.loaf.push({
        at: one.startTime,
        ms: one.duration,
        blocking: one.blockingDuration,
        render: one.renderStart ? one.startTime + one.duration - one.renderStart : 0,
        layout: one.styleAndLayoutStart ? one.startTime + one.duration - one.styleAndLayoutStart : 0,
        scripts,
      })
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
}

// Frames, collected only while something is being driven: the gap between two of
// them is the length of whatever sat in between, which is the frame a reader lost.
window.__frames = { list: [], on: false, last: 0 }
const tick = (at) => {
  const frames = window.__frames
  if (frames.on) {
    if (frames.last) frames.list.push(at - frames.last)
    frames.last = at
  } else {
    frames.last = 0
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

/** Every moment since the page was navigated to, cleared so the next gesture's
 *  jank is its own. */
window.__since = () => {
  const marks = window.__marks
  marks.tasks = []
  marks.loaf = []
  window.__frames.list = []
  window.__frames.last = 0
  return performance.now()
}

/** One frame the browser has actually painted: the first callback runs before the
 *  paint it was scheduled for, so the second is the first moment the pixels are on
 *  screen. Everything below that says "to paint" waits for this. */
window.__painted = () => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(() => go(performance.now()))))
"""

#: How long after the editor to look for a quiet stretch, and how long a stretch
#: has to be to count as one.
SETTLED_WITHIN = 8000
QUIET = 500

# --------------------------------------------------------------------------- steps

LAUNCHED = "() => !!window.nibApp && !!window.nibApp.workspace.activeSpace"

#: The note every launch opens, and the one beside it for the tab switch.
FIRST = "first.md"
SECOND = "second.md"

# The launch, once the app is up and has stopped moving: the four moments, the
# longest task after the editor, and the heap. `settled` is worked out here rather
# than watched for, because it is a property of the list of tasks.
LAUNCH = r"""
(quiet) => {
  const marks = window.__marks
  const after = marks.editor ?? 0
  const tasks = marks.tasks.filter((one) => one.at + one.ms > after)

  // The first moment with nothing long enough to eat a frame for `quiet` after it.
  let settled = after
  for (const one of tasks.sort((a, b) => a.at - b.at)) {
    if (one.at - settled >= quiet) break
    settled = Math.max(settled, one.at + one.ms)
  }

  const worst = tasks.reduce((most, one) => Math.max(most, one.ms), 0)
  const memory = performance.memory ? performance.memory.usedJSHeapSize : 0

  return {
    paint: marks.paint ?? 0,
    tree: marks.tree ?? 0,
    editor: marks.editor ?? 0,
    settled: settled + quiet,
    worst,
    tasks: tasks.filter((one) => one.ms >= 50).length,
    memory: Math.round(memory / 1e6),
    // Every long frame of the launch, not only the ones after the editor: what
    // holds the first paint up is before it by definition, and a profile that
    // started at the editor could not see it.
    loaf: marks.loaf.filter((one) => one.ms >= 60),
  }
}
"""

# One note opened by path, timed from the call to the frame the editor's own
# document is that note in. The editor is asked rather than the DOM: a long note is
# drawn a viewport at a time, so the rows on screen say nothing about whether the
# document has landed.
OPEN_NOTE = r"""
async (path) => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  await ws.open(path)
  // The editor catches up on the frame after the tab does.
  for (let spin = 0; spin < 240; spin++) {
    await window.__painted()
    if (ws.active?.path === path && document.querySelector('.cm-content')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf, tasks: window.__marks.tasks }
}
"""

# The other tab shown: the store is told, and the frame after it is when the words
# are on screen.
SWITCH = r"""
async (id) => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  ws.activeTabId = id
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf }
}
"""

# The settings sheet. Opened through its own store rather than through a pointer,
# because what is being timed is the sheet being built and not the click.
SHEET = r"""
async () => {
  const started = window.__since()
  window.nibApp.settings.open = true
  for (let spin = 0; spin < 120; spin++) {
    await window.__painted()
    if (document.querySelector('.sheet, .settings, dialog[open]')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf }
}
"""

SHUT_SHEET = "() => { window.nibApp.settings.open = false }"

# One query, from the word being typed to the last note having answered, less the
# wait the field keeps before it asks at all - which is a decision about typing
# rather than a cost. The counter the worker keeps is read either side of it: rows
# read out of storage, which is what "the notes are kept between searches" means.
QUERY = r"""
async (plan) => {
  const { text, wait } = plan
  const search = window.nibApp.search
  const held = () => document.querySelector('[data-search]')?.dataset.search ?? ''
  const readOf = (line) => Number(/read=(\d+)/.exec(line)?.[1] ?? -1)

  const before = readOf(held())
  const started = performance.now()
  search.ask(text)
  await new Promise((go) => {
    const look = () => (search.running ? setTimeout(look, 4) : go())
    setTimeout(look, 4)
  })
  const ms = performance.now() - started - wait
  // The worker says what it is holding after it has answered, which is a message
  // back to the page: give it the turn it needs to land.
  await new Promise((go) => setTimeout(go, 120))

  return { ms, hits: search.hits.length, read: readOf(held()) - Math.max(0, before), warmth: held() }
}
"""

# A gesture watched: frames while it runs, and the frames the browser called long.
WATCH_START = "() => { window.__t0 = window.__since(); window.__frames.on = true }"
WATCH_STOP = r"""
() => {
  window.__frames.on = false
  const frames = window.__frames.list
  const sorted = [...frames].sort((a, b) => a - b)
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0
  return {
    frames: frames.length,
    middle,
    fps: middle ? Math.round(1000 / middle) : 0,
    worst: sorted.at(-1) ?? 0,
    ninety: sorted[Math.floor(sorted.length * 0.9)] ?? 0,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""


def pick(rounds: list[dict[str, float]], key: str, unit: str) -> float:
    """One number out of several rounds, chosen by what the row is.

    For anything in milliseconds: the smallest. Noise on a machine only ever adds
    time - a round is slow because something else ran, never because the code got
    faster - so the least disturbed round is the one that is about the code, and it
    is the only one that repeats. The same build in both lanes agreed to within
    seven milliseconds on every launch row by its minimum while its medians were a
    hundred and fifty apart, because a median of eight rounds carries whatever the
    machine did in four of them.

    For frames a second: the largest, for the same reason the other way up. For a
    count or a heap: the middle, because those do not drift, and a count that came
    out low is a round that did less rather than a round that was left alone.
    """
    found = [one[key] for one in rounds if key in one]
    if not found:
        return 0.0
    if unit == "ms":
        return min(found)
    if unit == "fps":
        return max(found)
    return statistics.median(found)


def floor(rounds: list[dict[str, float]], key: str, unit: str) -> float:
    """How far this row would move if the whole run were done again.

    Two ways of asking, and the larger answer, because each catches what the other
    misses.

    The rounds split down the middle and the same number taken from each half: two
    goes at the same question on the same machine, so the gap between them is what
    this row is worth to nobody.

    And how far the round that was picked sits from the one that nearly matched it -
    the second smallest of a time, the second largest of a rate. A row read as its
    best round is only worth what its next best round agrees it is worth: four
    rounds split two and two can happen to agree closely while every round is ten
    per cent from the last, and that read as a floor of one millisecond called four
    rows on this machine a difference when the two folders held the same build.
    """
    found = [one[key] for one in rounds if key in one]
    if len(found) < 4:
        return 0.0

    half = len(found) // 2
    halves = abs(pick(rounds[:half], key, unit) - pick(rounds[half:], key, unit))

    ordered = sorted(found)
    if unit == "ms":
        nearly = ordered[1] - ordered[0]
    elif unit == "fps":
        nearly = ordered[-1] - ordered[-2]
    else:
        nearly = 0.0

    return max(halves, nearly)


def blame(entries: list[dict]) -> list[str]:
    """The scripts the browser blamed for the long frames, worst first, as lines."""
    worst: dict[str, dict[str, float]] = {}
    for frame in entries:
        for script in frame.get("scripts", []):
            name = f"{script.get('url', '')} {script.get('name', '')}".strip()
            if not name:
                continue
            held = worst.setdefault(name, {"ms": 0, "layout": 0, "times": 0})
            held["ms"] = max(held["ms"], script.get("ms", 0))
            held["layout"] = max(held["layout"], script.get("layout", 0))
            held["times"] += 1

    lines = []
    for name, held in sorted(worst.items(), key=lambda one: -one[1]["ms"])[:6]:
        layout = f" layout {held['layout']:.0f}ms" if held["layout"] else ""
        lines.append(f"{held['ms']:.0f}ms x{held['times']:.0f}{layout}  {name}")

    return lines


# --------------------------------------------------------------------------- parts


def part_launch(lane: Lane, page: Page) -> dict[str, object]:
    """One measured launch: the navigation, the four moments, and the heap."""
    page.goto(lane.origin, wait_until="commit")
    page.wait_for_function("() => window.__marks.editor !== null", timeout=120000)
    page.wait_for_function(LAUNCHED, timeout=120000)
    page.wait_for_timeout(SETTLED_WITHIN)
    # Swept first, or the heap is whatever the collector had not got round to: the
    # same build read 123MB one round and 215MB the next without it.
    lane.sweep()
    found = page.evaluate(LAUNCH, QUIET)
    lane.profile("launch", found.pop("loaf"))
    return found


def part_note(lane: Lane, page: Page) -> dict[str, object]:
    """The big note opened, and a key pressed at the end of it."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    # The launch's own reads have to be out of the way first. This part is about the
    # editor, and a keystroke measured while the space is still being scanned measures
    # the scan: the browser blamed `IDBRequest.onsuccess` for eight hundred
    # milliseconds inside the typing window, in both builds alike.
    settled(page)
    opened = page.evaluate(OPEN_NOTE, f"{lane.root}/long.md")
    lane.profile("big note opened", opened["loaf"])

    # The end of it, which is where a note this long is slowest: every line above
    # the caret is a line the editor has to have measured to know where it is.
    page.click(".cm-content")
    page.keyboard.press("Control+End")
    page.wait_for_timeout(400)

    page.evaluate(TYPING_READY)
    # One key at a time, each waited for: a key pressed while the frame of the last
    # one is still being laid out is a key whose wait is the one before it as well,
    # and twelve of those measure the queue rather than the keystroke. A key that
    # never lands at all is given up on after a second and the rest still go.
    for at in range(12):
        page.keyboard.press("x")
        try:
            page.wait_for_function(
                "(had) => (window.__keys?.length ?? 0) > had", arg=at, timeout=2000
            )
        except PlaywrightError:
            break

    latency = page.evaluate(TYPING)
    lane.profile("typing at the end of the big note", latency.pop("loaf"))

    # A round where the keys never reached the editor says nothing about typing, and
    # its noughts would read as "no wait at all".
    if not latency.pop("keys"):
        lane.note("the keystrokes went nowhere; that round is not in the typing numbers")
        latency = {}

    reading = page.evaluate(READING)
    lane.profile("reading the big note", reading.pop("loaf"))
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(300)

    return {"note-open": opened["ms"], **latency, **reading}


# The keystrokes, taken from the browser's own event timing rather than from a
# clock around `press`: what a reader feels is the key going down to the frame that
# shows the letter, which is exactly what this entry measures. Eight millisecond
# buckets, which is the browser rounding and not this drive.
TYPING_READY = r"""
() => {
  window.__keys = []

  // The key going down, and the second frame after it: the first callback runs
  // before the paint it was scheduled for, so the second is the first moment the
  // letter is on screen. The same two frames everything else here calls painted.
  //
  // Not the Event Timing entry, which is what this used to read. That API will not
  // report an event whose duration is under sixteen milliseconds however low
  // `durationThreshold` is set - the spec floors it - so a keystroke that landed in
  // its own frame produced no entry at all, and a round of twelve fast keystrokes
  // looked like a round where the keys went nowhere and was thrown away. What was
  // left was the median of the keystrokes slow enough to be reported, which is a
  // number that can only ever look bad and cannot show an improvement: the same
  // build read 432ms in one lane and 560 in the other off one or two rounds each.
  // The entry is still read for the handler time beside it, which is the one thing
  // a clock around the frame cannot see.
  addEventListener('keydown', () => {
    const down = performance.now()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => window.__keys.push({ ms: performance.now() - down })),
    )
  }, { capture: true })

  window.__handlers = []
  new PerformanceObserver((list) => {
    for (const one of list.getEntries()) {
      if (one.name === 'keydown') {
        window.__handlers.push(one.processingEnd - one.processingStart)
      }
    }
  }).observe({ type: 'event', durationThreshold: 16 })

  window.__since()
  return true
}
"""

TYPING = r"""
() => {
  const keys = window.__keys ?? []
  const middle = (list) => {
    const sorted = [...list].sort((a, b) => a - b)
    return { middle: sorted[Math.floor(sorted.length / 2)] ?? 0, worst: sorted.at(-1) ?? 0 }
  }

  const paint = middle(keys.map((one) => one.ms))
  const handler = middle(window.__handlers ?? [])
  return {
    // How many keystrokes were actually seen, so a round where the keys went
    // somewhere else is a round with nothing in it rather than a nought: a nought
    // read as "no wait at all" and dragged the median of every other round down.
    keys: keys.length,
    'type-paint': paint.middle,
    'type-worst': paint.worst,
    'type-handler': handler.middle,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""

READING = r"""
async () => {
  const ws = window.nibApp.workspace
  performance.clearMeasures('nib:reading')
  const started = window.__since()
  ws.toggleReading()

  // The page painted - and the render's own measure beside it, which is what the
  // renderer already takes for exactly this question; see `MEASURE` in
  // lib/reading/render.ts. A spin on a selector that never matched measured the
  // spin, which is how the first run of this said twenty-five seconds.
  for (let spin = 0; spin < 900; spin++) {
    await window.__painted()
    if (document.querySelector('.read #write')?.childElementCount) break
  }
  const painted = await window.__painted()
  const render = performance.getEntriesByName('nib:reading').at(-1)?.duration ?? 0

  return {
    reading: painted - started,
    'reading-render': render,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""


def part_shell(lane: Lane, page: Page) -> dict[str, object]:
    """The two tabs, the palette and the settings sheet."""
    ready(page, lane)

    page.evaluate(OPEN_NOTE, f"{lane.root}/{FIRST}")
    page.evaluate(OPEN_NOTE, f"{lane.root}/{SECOND}")
    tabs = page.evaluate("() => window.nibApp.workspace.tabs.map((one) => one.id)")
    switched = page.evaluate(SWITCH, tabs[0])
    lane.profile("tab switch", switched["loaf"])
    back = page.evaluate(SWITCH, tabs[-1])
    del back

    # The palette, driven by its own key so the keystroke is in the number.
    page.evaluate(WATCH_START)
    page.keyboard.press("Control+p")
    page.wait_for_selector(".palette, .quick, [role=listbox]", timeout=20000)
    palette = page.evaluate(PALETTE)
    lane.profile("palette", palette.pop("loaf"))
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)

    sheet = page.evaluate(SHEET)
    lane.profile("settings", sheet["loaf"])
    page.evaluate(SHUT_SHEET)
    page.wait_for_timeout(200)

    return {"tab-switch": switched["ms"], **palette, "settings": sheet["ms"]}


PALETTE = r"""
async () => {
  const started = window.__t0 ?? performance.now()
  const painted = await window.__painted()
  window.__frames.on = false
  const rows = document.querySelectorAll('.palette li, .palette .row, [role=option]').length
  return { palette: painted - started, 'palette-rows': rows, loaf: window.__marks.loaf }
}
"""


def part_search(lane: Lane, page: Page) -> dict[str, object]:
    """Four queries over the space, and what the worker was holding either side."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    # Opening the panel is a cost of its own: it asks the space for its tags, which
    # is the one thing on this surface that reads every note there is.
    panel = page.evaluate(PANEL)
    lane.profile("search panel opened", panel.pop("loaf"))
    # Attached rather than visible: the line is a data attribute on a row that a
    # theme may give no size at all, and what is being read is the attribute.
    try:
        page.wait_for_selector("[data-search]", state="attached", timeout=30000)
    except Exception:
        # Which panel the sidebar is actually on, so a run that ends here says what
        # it found rather than only which selector it was waiting for.
        say(f"{lane.name}: no search panel; the window says {page.evaluate(SIDEBAR)}")
        raise
    # The pass that reads the space into the worker is part of the launch, not part
    # of a query: wait for it to say it is warm before asking anything.
    page.wait_for_function(
        "() => /warm=1/.test(document.querySelector('[data-search]')?.dataset.search ?? '')",
        timeout=180000,
    )

    found: dict[str, object] = dict(panel)
    for name, text in QUERIES:
        one = page.evaluate(QUERY, {"text": text, "wait": 140})
        page.evaluate("() => window.nibApp.search.clear()")
        page.wait_for_timeout(80)
        found[f"q-{name}"] = one["ms"]
        found[f"q-{name}-read"] = one["read"]
        lane.note(f"{name}: {one['hits']} hits, {one['read']} rows read  [{one['warmth']}]")

    return found


#: What the window says about its sidebar, for a run that did not find a panel it
#: asked for. Read off the app and off the page, because the two disagreeing is the
#: interesting answer.
SIDEBAR = r"""
() => ({
  panel: window.nibApp?.workspace?.panel ?? null,
  aside: !!document.querySelector('aside'),
  rows: document.querySelectorAll('aside .row').length,
  find: !!document.querySelector('.find'),
  sheet: !!document.querySelector('.nib-screen.sheet'),
  palette: !!document.querySelector('.palette'),
  space: window.nibApp?.workspace?.activeSpace?.root ?? null,
})
"""

PANEL = r"""
async () => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  ws.showPanel('search')

  // Two moments, because they are two questions. The panel is on screen when the
  // field is there to type in; the tag tree above it says what the space is tagged
  // with, and where that comes from is the thing being measured - off the disk, which
  // costs a read of every note, or off the index, which costs nothing and is not
  // answerable until the space has been scanned once.
  let panel = 0
  let tags = 0
  let asked = started
  for (let spin = 0; spin < 900 && !(panel && tags); spin++) {
    // Asked again where it did not take, and the clock started again with it. A
    // window whose sitting was still being read back put the file list over the top
    // of the panel this had just asked for, and a run that only waited waited its
    // whole timeout and took the lane's numbers with it. Once a second is often
    // enough to get past that and rare enough not to be what is measured.
    if (!panel && spin && spin % 60 === 0 && ws.panel !== 'search') {
      ws.showPanel('search')
      asked = performance.now()
    }
    const at = await window.__painted()
    if (!panel && document.querySelector('[data-search]')) panel = at - asked
    if (!tags && ws.tags?.length) tags = at - asked
  }

  return {
    'search-panel': panel,
    'search-tags': tags,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""


#: The four questions, and what each is about.
QUERIES = [
    ("hit", "marker-4242"),
    ("none", "zzqqxxnothing"),
    ("tag", "tag:kestrel"),
    ("task", "task:pressure"),
]


def part_graph(lane: Lane, page: Page) -> dict[str, object]:
    """The picture of the space, opened and panned."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    opened = page.evaluate(OPEN_GRAPH)
    lane.profile("graph opened", opened.pop("loaf"))

    # The picture's own surface, by the one class only it wears. `canvas` was in this
    # selector as well, and a page that has been through the parts above has canvases
    # in it that are nothing to do with the graph and are not on screen: the first of
    # those in the page is what both of these lines then waited on, which is a wait
    # that never ends. See surfaces.svelte.ts, which is also why the surface is not there the
    # moment the tab is opened.
    page.wait_for_selector(".graph", state="visible", timeout=90000)
    box = page.locator(".graph").first.bounding_box()
    if not box:
        return opened

    panned = drag(lane, page, box, "graph panned", button="left")
    hovered = hover(lane, page, box)
    return {
        "graph-open": opened["ms"],
        "graph-fps": panned["fps"],
        "graph-worst": panned["worst"],
        "hover-fps": hovered["fps"],
        "hover-worst": hovered["worst"],
    }


OPEN_GRAPH = r"""
async () => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  ws.openGraph()
  for (let spin = 0; spin < 900; spin++) {
    await window.__painted()
    if (document.querySelector('.graph canvas, .graph svg, canvas.graph')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf.filter((one) => one.ms >= 50) }
}
"""


def part_canvas(lane: Lane, page: Page) -> dict[str, object]:
    """Ten thousand strokes: opened, panned, zoomed and drawn on."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    opened = page.evaluate(OPEN_CANVAS, f"{lane.root}/plane.canvas")
    lane.profile("canvas opened", opened.pop("loaf"))
    if not opened.get("ms"):
        return {}

    # The element, and a size for it. A plane of ten thousand strokes is still
    # laying itself out when the div arrives, and a locator asked for a box before
    # then waits its own thirty seconds and gives up.
    page.wait_for_selector(".canvas", state="visible", timeout=90000)
    box = page.locator(".canvas").first.bounding_box()
    if not box:
        return {"canvas-open": opened["ms"]}

    panned = drag(lane, page, box, "canvas panned")
    zoomed = wheel(lane, page, box)
    drawn = draw(lane, page, box)

    return {
        "canvas-open": opened["ms"],
        "canvas-fps": panned["fps"],
        "canvas-worst": panned["worst"],
        "zoom-fps": zoomed["fps"],
        "zoom-worst": zoomed["worst"],
        "draw-fps": drawn["fps"],
        "draw-worst": drawn["worst"],
    }


OPEN_CANVAS = r"""
async (path) => {
  const ws = window.nibApp.workspace
  const started = window.__since()
  await ws.openCanvas(path)
  for (let spin = 0; spin < 900; spin++) {
    await window.__painted()
    if (document.querySelector('.canvas')) break
  }
  const painted = await window.__painted()
  return { ms: painted - started, loaf: window.__marks.loaf.filter((one) => one.ms >= 50) }
}
"""


def drag(lane: Lane, page: Page, box: dict, what: str, button: str = "middle") -> dict:
    """A pan: the middle of the surface dragged, with the frames counted.

    The canvas pans with the middle button, over a card as readily as over the
    paper; the graph pans with the left one, from anywhere no node is."""
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.move(*middle)
    page.evaluate(WATCH_START)
    page.mouse.down(button=button)
    for step in range(40):
        page.mouse.move(middle[0] - step * 6, middle[1] - step * 3)
    page.mouse.up(button=button)
    page.wait_for_timeout(200)
    found = page.evaluate(WATCH_STOP)
    lane.profile(what, found["loaf"])
    return found


def hover(lane: Lane, page: Page, box: dict) -> dict:
    """The pointer moved across the picture with nothing held down, which is the
    gesture that asks what is under it - once per event rather than once a frame."""
    start = (box["x"] + 60, box["y"] + box["height"] / 2)
    page.mouse.move(*start)
    page.evaluate(WATCH_START)
    for step in range(60):
        page.mouse.move(start[0] + step * 12, start[1] + (step % 9) * 8)
    page.wait_for_timeout(200)
    found = page.evaluate(WATCH_STOP)
    lane.profile("graph hovered", found["loaf"])
    return found


def wheel(lane: Lane, page: Page, box: dict) -> dict:
    """A zoom: the wheel with the modifier down, which is how both surfaces zoom."""
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.evaluate(WATCH_START)
    for _ in range(30):
        page.keyboard.down("Control")
        page.mouse.wheel(0, -120)
        page.keyboard.up("Control")
    page.wait_for_timeout(300)
    found = page.evaluate(WATCH_STOP)
    lane.profile("canvas zoomed", found["loaf"])
    return found


def draw(lane: Lane, page: Page, box: dict) -> dict:
    """One more stroke on a plane that already holds ten thousand."""
    page.keyboard.press("d")
    page.wait_for_timeout(300)
    start = (box["x"] + 80, box["y"] + box["height"] - 80)
    page.mouse.move(*start)
    page.evaluate(WATCH_START)
    page.mouse.down()
    for step in range(60):
        page.mouse.move(start[0] + step * 5, start[1] - (step % 12) * 4)
    page.mouse.up()
    page.wait_for_timeout(300)
    found = page.evaluate(WATCH_STOP)
    lane.profile("stroke drawn", found["loaf"])
    page.keyboard.press("Escape")
    return found


def part_links(lane: Lane, page: Page) -> dict[str, object]:
    """The note a thousand others point at, and the panel that says who."""
    if lane.space == "empty":
        return {}

    ready(page, lane)
    # The index has to have read the space before what points here is answerable,
    # and that read is part of the launch rather than part of this.
    settled(page)

    found = page.evaluate(LINKS, f"{lane.root}/hub.md")
    lane.profile("the links panel on a note a thousand notes point at", found.pop("loaf"))
    lane.note(f"hub: {found['links-rows']} rows over {found.pop('sections')} sections")

    page.evaluate("() => { const ws = window.nibApp.workspace; ws.showPanel('tree') }")
    page.wait_for_timeout(200)
    return found


# The note opened and the panel asked for, timed to the frame the rows are on.
#
# What points here is answered off the index, so this is that answer and the rows it
# comes to. What merely *mentions* the name is a search of every note in the space
# and lands later; it is not timed here, because the only thing on the page saying it
# has landed is a heading in whatever language the window is in.
LINKS = r"""
async (path) => {
  const ws = window.nibApp.workspace
  await ws.open(path)
  for (let spin = 0; spin < 240; spin++) {
    await window.__painted()
    if (ws.active?.path === path) break
  }

  const started = window.__since()
  if (ws.panel !== 'links') ws.showPanel('links')

  let shown = 0
  for (let spin = 0; spin < 900 && !shown; spin++) {
    if (spin && spin % 60 === 0 && ws.panel !== 'links') ws.showPanel('links')
    const at = await window.__painted()
    if (document.querySelector('.hit')) shown = at - started
  }

  const rows = document.querySelectorAll('.hit').length
  return {
    'links-panel': shown,
    'links-rows': rows,
    sections: document.querySelectorAll('.nib-section').length,
    loaf: window.__marks.loaf.filter((one) => one.ms >= 50),
  }
}
"""


PARTS = {
    "launch": part_launch,
    "note": part_note,
    "shell": part_shell,
    "search": part_search,
    "links": part_links,
    "graph": part_graph,
    "canvas": part_canvas,
}


def settled(page: Page) -> None:
    """The launch's own passes finished: the index scanned, and a quiet moment after
    it. What is measured after this is the thing being measured."""
    page.wait_for_function(
        "() => !!window.nibApp && !window.nibApp.links.scanning && !!window.nibApp.links.rootOf()",
        timeout=180000,
    )
    page.wait_for_timeout(2500)


def ready(page: Page, lane: Lane) -> None:
    """The app up, on the space, with the file list showing."""
    if not page.evaluate("() => !!window.nibApp"):
        page.goto(lane.origin, wait_until="domcontentloaded")

    page.wait_for_function(LAUNCHED, timeout=120000)
    # A moment before anything is asked of the window. The app says it has a space
    # and paints the file list part way through reading its sitting back, and the
    # rest of that read writes the sidebar down again: a panel asked for inside that
    # window is undone by `applyLayout`, which is why this drive used to lose a whole
    # lane's search rounds to a panel that never opened.
    page.wait_for_timeout(600)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_selector("aside .row", timeout=60000)


# --------------------------------------------------------------------------- lanes


class Lane:
    """One build over one space, served and driven."""

    def __init__(self, tag: str, folder: str, space: str) -> None:
        self.tag = tag
        self.space = space
        self.name = f"{tag}/{space}"
        self.folder = APP / folder
        self.port = PORTS[(tag, space)]
        self.origin = f"http://127.0.0.1:{self.port}"
        self.root = "/Big" if space == "big" else "/Empty"
        self.rounds: dict[str, list[dict]] = {}
        self.lost: dict[str, int] = {}
        self.profiles: dict[str, list[str]] = {}
        self.notes: list[str] = []
        self.page: Page | None = None
        self.cdp = None

        handler = functools.partial(Quiet, directory=str(self.folder))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", self.port), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        (self.folder / "seed.html").write_text(SEED_PAGE, encoding="utf-8")
        self.thread.start()
        say(f"{self.name}: serving {self.folder.name} on {self.origin}")

    def stop(self) -> None:
        self.server.shutdown()

    def note(self, words: str) -> None:
        self.notes.append(f"{self.name}: {words}")

    def profile(self, what: str, entries: list[dict] | None) -> None:
        lines = blame(entries or [])
        if lines:
            self.profiles.setdefault(f"{self.name} - {what}", []).extend(lines)

    def ready(self, browser) -> None:
        """A seeded store, and a session as an app somebody has used before leaves
        one: which space was open, which note, and that the file list was the panel
        showing. Every launch measured after this is a launch of an app somebody has
        used before, which is the launch that happens every day."""
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            user_agent=DESKTOP_AGENT,
        )
        context.add_init_script(MARKS)
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"{self.name}: page error: {error}"))
        self.page = page
        self.cdp = context.new_cdp_session(page)

        page.goto(f"{self.origin}/seed.html", wait_until="domcontentloaded")
        plan = {
            "notes": NOTES if self.space == "big" else 0,
            "lines": LINES if self.space == "big" else 0,
            "strokes": STROKES if self.space == "big" else 0,
            "points": POINTS,
            "space": self.root,
        }
        seeded = page.evaluate(SEED, plan)
        say(f"{self.name}: {seeded['rows']} rows seeded into {seeded['stores']}")

        # Three launches before anything is timed, not one. Chrome keeps a compiled
        # copy of a script and writes it on the second or third visit, so the build
        # that has been served all afternoon comes up faster than the one built five
        # minutes ago - by three hundred milliseconds to the file list, which is more
        # than most changes worth making. Every asset of both builds is under a hash
        # of its own, so each needs its own warming.
        for _ in range(WARMING):
            page.goto(self.origin, wait_until="domcontentloaded")
            page.wait_for_function(LAUNCHED, timeout=180000)
            # Said every time: a first visit has no session behind it and opens on
            # whichever panel the app starts with.
            page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
            page.wait_for_selector("aside .row", timeout=60000)

        page.evaluate(OPEN_NOTE, f"{self.root}/{FIRST}")
        # The session is written as things settle, so give it the moment it takes.
        page.wait_for_timeout(2500)
        say(f"{self.name}: session written")

    def quiet(self) -> None:
        """A moment with nothing happening, before something is timed."""
        if self.page:
            self.page.wait_for_timeout(SETTLING)

    def sweep(self) -> None:
        """The collector, asked. A heap read with garbage still in it is a number
        about when the collector last ran."""
        if self.cdp:
            self.cdp.send("HeapProfiler.collectGarbage")

    def park(self) -> None:
        """Off the app and onto nothing, so a lane that is not being measured is
        not an app running beside the one that is."""
        if self.page:
            self.page.goto("about:blank", wait_until="domcontentloaded")

    def round(self, part: str) -> None:
        page = self.page
        if not page:
            return

        try:
            found = PARTS[part](self, page)
        except PlaywrightError as wrong:
            # One round that could not reach the thing it measures is one round
            # missing, said out loud, and not forty minutes of driving thrown away.
            # The rounds this does finish are still a number; a part that loses most
            # of them is said again at the end, where it cannot be missed.
            self.lost.setdefault(part, 0)
            self.lost[part] += 1
            self.note(f"{part} could not be reached: {str(wrong).splitlines()[0]}")
            return

        if not found:
            return

        self.rounds.setdefault(part, []).append(found)
        said = "  ".join(f"{key} {value:.0f}" for key, value in found.items())
        say(f"{self.name} {part} {len(self.rounds[part])}: {said}")

    def numbers(self) -> dict[str, float]:
        out: dict[str, float] = {}
        for rounds in self.rounds.values():
            for key in rounds[0]:
                out[key] = pick(rounds, key, UNIT.get(key, ""))
        return out

    def floors(self) -> dict[str, float]:
        """The same rows, as what each of them would be worth on another run."""
        out: dict[str, float] = {}
        for rounds in self.rounds.values():
            for key in rounds[0]:
                out[key] = floor(rounds, key, UNIT.get(key, ""))
        return out

    def middles(self) -> dict[str, float]:
        """The same rows, as their middle round.

        Beside the best because the two answer different questions, and a row where
        they disagree is the interesting kind. The best round says what the code
        costs when the machine leaves it alone, which is what two builds can be
        compared by. The middle round says what somebody actually waits for - and a
        wait that is sometimes four times its own best is a wait that comes and
        goes, which is worse to use than a slower one that never varies. The reading
        view read 258ms at best on both sides of a change that took its middle round
        from 683ms to 268ms: a change worth making that the best round could not see.
        """
        out: dict[str, float] = {}
        for rounds in self.rounds.values():
            for key in rounds[0]:
                found = [one[key] for one in rounds if key in one]
                out[key] = statistics.median(found) if found else 0.0
        return out

    def served(self) -> dict[str, int]:
        """What this lane's server was asked for over the whole run."""
        return SERVED.get(self.port, {"asked": 0, "sent": 0, "again": 0, "bytes": 0})


#: The numbers, in the order they are worth reading, and what each is in.
SAID = [
    ("paint", "launch: first paint", "ms"),
    ("tree", "launch: file list on screen", "ms"),
    ("editor", "launch: editor on screen", "ms"),
    ("settled", "launch: main thread quiet for 500ms", "ms"),
    ("worst", "launch: longest task after the editor", "ms"),
    ("tasks", "launch: tasks over 50ms after the editor", ""),
    ("memory", "launch: heap once settled", "MB"),
    ("note-open", "big note: opened", "ms"),
    ("type-paint", "big note: key down to paint", "ms"),
    ("type-worst", "big note: worst key down to paint", "ms"),
    ("type-handler", "big note: handlers per key", "ms"),
    ("reading", "big note: reading view, call to paint", "ms"),
    ("reading-render", "big note: the render itself", "ms"),
    ("tab-switch", "shell: other tab shown", "ms"),
    ("palette", "shell: palette on screen", "ms"),
    ("palette-rows", "shell: palette rows", ""),
    ("settings", "shell: settings sheet", "ms"),
    ("search-panel", "search: panel on screen", "ms"),
    ("search-tags", "search: the tag tree filled", "ms"),
    ("q-hit", "search: one hit", "ms"),
    ("q-hit-read", "search: rows read for it", ""),
    ("q-none", "search: no hits", "ms"),
    ("q-none-read", "search: rows read for it", ""),
    ("q-tag", "search: a tag", "ms"),
    ("q-tag-read", "search: rows read for it", ""),
    ("q-task", "search: a task", "ms"),
    ("q-task-read", "search: rows read for it", ""),
    ("links-panel", "links: what points here, on screen", "ms"),
    ("links-rows", "links: rows in the panel", ""),
    ("graph-open", "graph: opened", "ms"),
    ("graph-fps", "graph: frames a second, panned", "fps"),
    ("graph-worst", "graph: worst frame", "ms"),
    ("hover-fps", "graph: frames a second, hovered", "fps"),
    ("hover-worst", "graph: worst hover frame", "ms"),
    ("canvas-open", "canvas: opened", "ms"),
    ("canvas-fps", "canvas: frames a second, panned", "fps"),
    ("canvas-worst", "canvas: worst frame", "ms"),
    ("zoom-fps", "canvas: frames a second, zoomed", "fps"),
    ("zoom-worst", "canvas: worst zoom frame", "ms"),
    ("draw-fps", "canvas: frames a second, drawing", "fps"),
    ("draw-worst", "canvas: worst drawing frame", "ms"),
]


#: What each row is in, so `pick` knows which way is better. One list of rows.
UNIT = {key: unit for key, _, unit in SAID}


def waits(
    found: dict[str, dict[str, float]],
    middle: dict[str, dict[str, float]],
    moved: dict[str, dict[str, float]],
    names: list[str],
) -> None:
    """The rows whose middle round is well above their best.

    A row that reads the same every round is a wait somebody learns; a row that is
    sometimes four times itself is one they never stop noticing. The table above is
    best rounds, so this is where that shows - and it is where a change can be worth
    making without the table above moving at all. See `middles`.
    """
    loud = []
    for key, words, unit in SAID:
        if unit != "ms":
            continue

        for name in names:
            if key not in found[name]:
                continue

            best = found[name][key]
            mid = middle[name].get(key, best)
            # Twice its best and clear of what the row is worth to nobody, so an
            # eight millisecond row that read sixteen once is not news.
            if mid > best * 2 and mid - best > max(moved[name].get(key, 0.0), 20.0):
                loud.append(f"{words:44} {name:>14} best {best:5.0f}ms  middle {mid:5.0f}ms")

    if not loud:
        return

    print("rows whose middle round is well above their best, which is a wait that comes and goes:")
    for line in loud:
        say(line)
    print()


def prove(
    found: dict[str, dict[str, float]],
    moved: dict[str, dict[str, float]],
    names: list[str],
) -> None:
    """Whether a difference between two lanes is a difference at all.

    A row is worth something to nobody whatever the code is; how much is `floor`,
    which is the two halves of this run asked the same question. A gap between two
    lanes smaller than the floor is the machine, not the build. With the same build
    in both folders every row should read `same` - that is what makes this drive
    worth reading, and a row that says `differs` with identical builds is a fault in
    the rig rather than a number about the app.
    """
    if len(names) < 2:
        return

    print()
    print("lane against lane, each gap read against what the row is worth to nobody:")
    print(f"  {'':44} {'gap':>9} {'floor':>9}")

    loud = []
    for key, words, unit in SAID:
        seen = [name for name in names if key in found[name]]
        if len(seen) < 2:
            continue

        values = [found[name][key] for name in seen]
        gap = max(values) - min(values)
        sill = max(moved[name].get(key, 0.0) for name in seen)
        # A row that never moves at all still gets a millisecond, or an integer count
        # that is off by one reads as a difference.
        how = "same" if gap <= max(sill, 1.0) else "differs"
        if how == "differs":
            loud.append(f"{words} ({gap:.0f}{unit} on a floor of {sill:.0f})")
        print(f"  {words:44} {gap:8.0f}{unit:>4} {sill:8.0f}{unit:>4}  {how}")

    print()
    if loud:
        say(f"{len(loud)} rows differ by more than they are worth to nobody:")
        for words in loud:
            say(f"  {words}")
    else:
        say("every row agrees within what it is worth to nobody")


#: The two files whose one wall-clock bound is nobody's to assert but this drive's.
CLOCKED = [
    "src/lib/search/fuzzy.perf.test.ts",
    "src/lib/search/match.perf.test.ts",
]


def clocked() -> str:
    """The two search walks, timed rather than only counted.

    Both files count what the code did - lines folded, regions asked about, needles
    looked for - and those counts are the test: each is the same number on a machine
    running thirty files at once as on an idle one. Each also keeps one clock on its
    worst case, and that one is not: a walk descheduled halfway through says nothing
    about the walk, and one of them failed a gate at 3.9 seconds with every count
    right.

    So they ask for `NIB_PERF=1` before they believe their own clock, and this is the
    only thing in the repository that sets it. `pnpm test` never does, which is why
    a loaded machine cannot fail on it; a speed run does, because a speed run is
    somebody measuring rather than checking - and it is run first, before a browser
    is started, which is the quietest this machine gets.
    """
    npx = shutil.which("npx")
    if not npx:
        return "no npx, so the clocked bounds were not asked"

    asked = subprocess.run(
        [npx, "vitest", "run", *CLOCKED],
        cwd=APP,
        env={**os.environ, "NIB_PERF": "1"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    if asked.returncode == 0:
        return "the clocked bounds hold"

    # The lines that say which bound, so a failure here reads as a number rather
    # than as "something in a file".
    said = [
        line.strip()
        for line in (asked.stdout + asked.stderr).splitlines()
        if "AssertionError" in line or line.strip().startswith("FAIL")
    ]
    return "; ".join(["the clocked bounds do not hold", *said[:6]])


def main() -> int:
    ask = argparse.ArgumentParser(description=__doc__)
    ask.add_argument("parts", nargs="*", default=[], help=f"any of {', '.join(PARTS)}")
    ask.add_argument("--rounds", type=int, default=5)
    ask.add_argument("--space", default="", help="big or empty, for one of them alone")
    # Four lanes in one browser served by one Python process do not leave each other
    # alone: the launch moments in a four-lane run came out two and three times what
    # they are, and by lane rather than by turn. So a number that is about the launch
    # itself is taken one build at a time, and the two runs compared.
    ask.add_argument("--build", default="", help="before or after, for one of them alone")
    ask.add_argument(
        "--no-clock",
        action="store_true",
        help="skip the timed search bounds, for a run that is only about the browser",
    )
    ask.add_argument(
        "--as-was",
        action="store_true",
        help="serve as this file used to, to show what the lane bias was",
    )
    told = ask.parse_args()

    global AS_WAS  # noqa: PLW0603
    AS_WAS = told.as_was
    if AS_WAS:
        say("serving as this file used to: HTTP/1.0, no caching, the folders' own dates")

    parts = told.parts or list(PARTS)
    for part in parts:
        if part not in PARTS:
            say(f"no part called {part}")
            return 1

    spaces = [told.space] if told.space else ["big", "empty"]
    builds = [
        (tag, folder)
        for tag, folder in (("before", "dist-before"), ("after", "dist"))
        if not told.build or told.build == tag
    ]
    wanted = [Lane(tag, folder, space) for space in spaces for tag, folder in builds]
    lanes = [one for one in wanted if (one.folder / "index.html").exists()]
    if not lanes:
        say("nothing built")
        return 1

    # A whole number of rotations, so every lane goes first equally often; see the
    # rotation in the loop below.
    rounds = told.rounds + (-told.rounds % len(lanes))
    if rounds != told.rounds:
        say(f"{told.rounds} rounds over {len(lanes)} lanes is not a whole turn; {rounds} rounds")

    # The two timed search bounds first, before a browser exists: this is the
    # quietest the machine gets in a speed run, and they are the only thing that
    # asks for `NIB_PERF=1`. See `clocked`.
    clock = "" if told.no_clock else clocked()
    if clock:
        say(clock)

    for lane in lanes:
        lane.start()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(
                channel="chrome",
                # The heap, honestly: without this the number is bucketed into
                # steps too coarse to compare two builds by.
                args=["--enable-precise-memory-info"],
            )

            for lane in lanes:
                lane.ready(browser)

            # Turn and turn about, so whatever the machine is doing is done to all
            # of them, and one at a time, so none of them is what the machine is
            # doing - and in a different order every round, because the lane that
            # goes first pays for the browser waking up. Two identical builds driven
            # one after the other differed by half on a single round, which is more
            # than most changes worth making do.
            for part in parts:
                for turn_at in range(rounds):
                    # Rotated, not reversed. Reversing gives two orders however many
                    # lanes there are, so with four lanes the two on the ends took
                    # every turn at going first and the two in the middle took none -
                    # and going first is what pays for the browser waking up. Rotating
                    # by one a round, over a round count that is a whole number of
                    # rotations, puts every lane in every position the same number of
                    # times. With two lanes and five rounds the old order gave one of
                    # them three turns at going first and the other two, which is a
                    # lane bias in the median of a row that never moved.
                    at = turn_at % len(lanes)
                    turn = [*lanes[at:], *lanes[:at]]
                    for lane in turn:
                        for other in lanes:
                            if other is not lane:
                                other.park()
                        # Parking three pages tears three renderers down, and a
                        # launch measured in the same breath wore it: whichever lane
                        # went second in a round paid the best part of a second, and
                        # it flipped with the order. So the machine is given a moment
                        # to be quiet again before anything is timed.
                        lane.quiet()
                        lane.round(part)

            browser.close()
    finally:
        for lane in lanes:
            lane.stop()

    found = {lane.name: lane.numbers() for lane in lanes}
    moved = {lane.name: lane.floors() for lane in lanes}
    names = [lane.name for lane in lanes]

    print()
    print(
        f"{rounds} rounds, {NOTES} notes, {LINES} lines, {STROKES} strokes."
        " A time is the least disturbed round, a rate the best, a count the middle:"
    )
    print(f"  {'':44} {'  '.join(f'{name:>14}' for name in names)}")
    for key, words, unit in SAID:
        if not any(key in found[name] for name in names):
            continue
        row = "  ".join(
            f"{found[name][key]:10.0f}{unit:>4}" if key in found[name] else f"{'-':>14}"
            for name in names
        )
        print(f"  {words:44} {row}")

    for lane in lanes:
        for words in lane.notes:
            say(words)

    print()
    waits(found, {lane.name: lane.middles() for lane in lanes}, moved, names)

    for lane in lanes:
        for part, times in lane.lost.items():
            if times * 2 >= rounds:
                say(f"{lane.name}: {part} was reached {rounds - times} of {rounds} rounds")

    print("what each lane's server was asked for, over the whole run:")
    for lane in lanes:
        held = lane.served()
        say(
            f"{lane.name}: {held['asked']} requests, {held['sent']} sent,"
            f" {held['again']} already had, {held['bytes'] / 1e6:.1f}MB"
        )
    # Two lanes that fetched different amounts were not two launches of the same
    # shape, whatever the code in them was; this is the first thing to read when a
    # row looks like a change and is not one.
    counts = {(one["asked"], one["sent"]) for one in (lane.served() for lane in lanes)}
    if len(counts) > 1:
        say("the lanes were not served alike; the launch rows are not comparable")

    prove(found, moved, names)

    print()
    print("what the browser blamed for the long frames:")
    for lane in lanes:
        for what, lines in lane.profiles.items():
            print(f"  {what}")
            for line in dict.fromkeys(lines):
                print(f"    {line}")

    if clock:
        print()
        say(clock)

    print()
    print(json.dumps({name: {key: round(value, 1) for key, value in one.items()} for name, one in found.items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
