"""The space search: the operators, the rows, the papers, and how long it takes.

Three runs in one. The first is a small space photographed on a desktop and on a
phone: the field finishing an operator, tasks found and ticked from the rows, front
matter held against a number, the order menu, a folder left out of the search and
dimmed in the tree, and a ` ```query ` fence answered in the editor and in the
reading view. The second is the papers: one opened and searched, the page reloaded,
and the same search answered out of what was written down - plus a paper nobody
ever opened, which the idle pass reads by itself. The third is five thousand notes,
timed, to say what a query costs against the hundred milliseconds a keystroke has.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/search.py

Screenshots go beside this file under `shots/search/`, which is ignored. This is a
scratch drive rather than a test: it photographs the app, times it, and says what
it saw.
"""

from __future__ import annotations

import functools
import http.server
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# Above 1425, and not any other drive's port.
PORT = 18972
ORIGIN = f"http://127.0.0.1:{PORT}"

PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)
DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

# name, width, height, agent, finger, scheme
DEVICES = [
    ("desktop", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("phone", 390, 844, PHONE_AGENT, True, "light"),
]

# A space with something for every operator to find: tasks in both states, front
# matter holding a number and a date, tags, an archive to leave out, and a note
# with a query fence in it.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const note = (text) => ws.noteFrom(text, undefined)

  await note('# This week\\n\\n#work\\n\\n- [ ] write the plan\\n- [x] read the paper\\n- [ ] send the ledger\\n\\nThe plan is the plan.')
  await note('---\\npages: 150\\ndue: 2026-09-01\\nstatus: done\\n---\\n\\n# Ink\\n\\n#work/nib\\n\\nA study of ink, and the plan behind it.')
  await note('---\\npages: 420\\ndue: 2026-12-24\\n---\\n\\n# Paper\\n\\n#later\\n\\nAbout paper, and the wear of ink on it.')
  await note('# Kestrel\\n\\n#later\\n\\n- [ ] watch the kestrel again\\n\\nA kestrel hangs on the wind above the field.')
  await note('# Everything open\\n\\nWhat is still to do, everywhere:\\n\\n```query\\ntask-todo:\\n```\\n\\nAnd the long papers:\\n\\n```query\\n[pages:>200]\\n```')

  // The archive is a note, because that is all a folder is: moving something into
  // it is what makes it one, and `moveMany` nests the note first. See
  // folder-notes.ts.
  await note('# Archive\\n\\nWhat is done with.')
  await note('# Old plan\\n\\nThe plan as it was, with a kestrel in it.')
  await ws.loadTree()

  // The last note into the archive, so there is something to leave out.
  const old = ws.notes.find((one) => one.name.startsWith('Old plan'))
  if (old) await ws.moveMany([old.path], ws.activeSpace.root + '/Archive')
  await ws.loadTree()

  return ws.notes.length
}
"""

# Five thousand notes with words in them, written straight into the browser's own
# store: `noteFrom` writes a file, loads the tree and finds a free name for each
# one, which is nineteen seconds a thousand and worse as it goes. The search reads
# the store, so this is the space it would read.
SEED_MANY = """
async ({ count, root }) => {
  // No version: the app has already opened the database at whichever one it is at,
  // and asking for an older one is a VersionError rather than a seed.
  const open = indexedDB.open('nib')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })

  const began = performance.now()
  const made = Date.now()
  let bytes = 0

  for (let batch = 0; batch < count; batch += 500) {
    await new Promise((resolve, reject) => {
      // The listing is a store of its own now, and a note written without its
      // stat is a note the file list cannot see; see web/store.ts.
      const write = db.transaction(['files', 'stats'], 'readwrite')
      const store = write.objectStore('files')
      const listing = write.objectStore('stats')

      for (let one = batch; one < Math.min(batch + 500, count); one++) {
        const content = [
          '---',
          'pages: ' + (100 + (one % 400)),
          'due: 2026-0' + (1 + (one % 9)) + '-1' + (one % 10),
          '---',
          '',
          '# Note ' + one,
          '',
          '#work/' + (one % 20),
          '',
          '- [' + (one % 3 === 0 ? 'x' : ' ') + '] a task on note ' + one,
          '',
          'The quarter plan for note ' + one + ', and the wind above the field.',
          'A second line about ink, paper and the wear of one on the other.',
          'A third line so a note is a note rather than a sentence.',
        ].join('\\n')

        bytes += content.length
        const row = {
          path: root + '/Note ' + one + '.md',
          content,
          modified: made - one * 1000,
          created: made - one * 2000,
        }
        store.put(row)
        listing.put({ path: row.path, modified: row.modified, created: row.created })
      }

      write.oncomplete = () => resolve()
      write.onerror = () => reject(write.error)
    })
  }

  await window.nibApp.workspace.loadTree()

  // The rows went in behind the app's back, so they are called out the way the
  // store would have called them out: the search worker holds the space between
  // two searches and hears about every row that is written. See web/store.ts.
  const rows = await new Promise((resolve, reject) => {
    const ask = db.transaction('files', 'readonly').objectStore('files').getAll()
    ask.onsuccess = () => resolve(ask.result)
    ask.onerror = () => reject(ask.error)
  })
  new BroadcastChannel('nib:rows').postMessage({ rows, gone: [] })

  return { ms: Math.round(performance.now() - began), bytes }
}
"""

# Two PDFs, written straight into the browser's own store the way the notes are.
# A paper is an asset row and a listing row, which is what `save_asset` writes and
# what the file tree draws a `.pdf` from.
SEED_PAPERS = """
async ({ root, papers }) => {
  const open = indexedDB.open('nib')
  const db = await new Promise((resolve, reject) => {
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })

  const made = Date.now()
  await new Promise((resolve, reject) => {
    const write = db.transaction(['assets', 'stats'], 'readwrite')
    const store = write.objectStore('assets')
    const listing = write.objectStore('stats')

    for (const [name, data] of papers) {
      const path = root + '/' + name
      store.put({ path, type: 'application/pdf', data, modified: made })
      listing.put({ path, modified: made, created: made })
    }

    write.oncomplete = () => resolve()
    write.onerror = () => reject(write.error)
  })

  await window.nibApp.workspace.loadTree()
  return window.nibApp.workspace.files.filter((one) => one.name.endsWith('.pdf')).length
}
"""

# How long a query takes, from the keystroke to the last note having answered.
# The field waits `WAIT` milliseconds before it asks anything - a word typed at
# speed is one search - so that is taken off: what is left is the search.
TIMED = """
async ({ source, wait }) => {
  const search = window.nibApp.search
  const began = performance.now()
  search.ask(source)

  await new Promise((resolve) => {
    const look = () => {
      if (!search.running) resolve()
      else setTimeout(look, 4)
    }
    setTimeout(look, 4)
  })

  return {
    ms: Math.round((performance.now() - began - wait) * 10) / 10,
    hits: search.hits.length,
  }
}
"""


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def searching(page) -> None:
    """The search panel showing, whether it already was or not."""
    page.evaluate("() => window.nibApp.workspace.showPanel('search')")


def held_text(page) -> str:
    """What the search says it is holding, off the panel's own diagnostics."""
    return str(
        page.evaluate("() => document.querySelector('.find')?.getAttribute('data-search')")
    )


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The same server, without a line per asset."""

    def log_message(self, *args: object) -> None:  # noqa: D102
        return


class Pages:
    """The built page, served."""

    def __init__(self) -> None:
        handler = functools.partial(Quiet, directory=str(APP / "dist"))
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()
        say(f"serving {APP / 'dist'} on {ORIGIN}")

    def stop(self) -> None:
        self.server.shutdown()


def opened(browser, width, height, agent, finger, scheme, name):
    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.on(
        "console",
        lambda one: say(f"[{name}] console {one.type}: {one.text}")
        if one.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    page.evaluate("() => { for (let i = 0; i < 12; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(200)
    return context, page


def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    context, page = opened(browser, width, height, agent, finger, scheme, name)

    def shot(tag: str) -> None:
        page.screenshot(path=str(shots / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    def ask(source: str, pause: int = 900) -> None:
        field = page.locator("aside input.query")
        field.click()
        field.fill(source)
        page.wait_for_timeout(pause)

    say(f"[{name}] the space holds {page.evaluate(SEED)} notes")
    page.evaluate("() => window.nibApp.workspace.showPanel('search')")
    page.wait_for_timeout(500)
    shot("panel")

    # The field finishing an operator, which is the whole of the hint: what is typed
    # could still become one, so the names it could become are offered.
    ask("ta", 500)
    shot("operators")
    say(
        f"[{name}] typing 'ta' offers"
        f" {page.evaluate('() => [...document.querySelectorAll(String.raw`aside .suggest button`)].map((one) => one.textContent.trim())')}"
    )

    # Tasks, with their boxes live.
    ask("task-todo:")
    shot("tasks")
    boxes = page.locator("aside .hit input[type=checkbox]")
    say(f"[{name}] {boxes.count()} rows have a box")

    if boxes.count():
        before = page.evaluate(
            "() => window.nibApp.workspace.notes.length && window.nibApp.search.hits.length"
        )
        boxes.first.click(force=True)
        page.wait_for_timeout(1200)
        say(
            f"[{name}] a box ticked: {before} rows became"
            f" {page.evaluate('() => window.nibApp.search.hits.length')}"
        )
        shot("ticked")

    # Front matter held against a number, and a date.
    ask("[pages:>200]")
    shot("pages")
    say(f"[{name}] [pages:>200] found {page.evaluate('() => window.nibApp.search.hits.length')}")

    ask("[due:<2026-10-01]")
    say(
        f"[{name}] [due:<2026-10-01] found"
        f" {page.evaluate('() => window.nibApp.search.hits.length')}"
    )

    # The order the results are read in, on the tab that shows them.
    ask("plan")
    tab = page.locator("aside [role=tab]").nth(2)
    if tab.count():
        tab.click(button="right", force=True)
        page.wait_for_timeout(400)
        shot("order")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    # A folder left out of the search, and what the tree says about it.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.excluded.toggle(ws.activeSpace.root + '/Archive')
        }"""
    )
    ask("kestrel")
    say(
        f"[{name}] with the archive left out, kestrel finds"
        f" {page.evaluate('() => window.nibApp.search.hits.map((one) => one.name)')}"
    )
    shot("excluded")

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.device.expand(ws.activeSpace.root + '/Archive')
          return ws.loadTree()
        }"""
    )
    page.wait_for_timeout(600)
    shot("tree-dimmed")

    # And the row's own menu, which is the way in. The archive by name rather than
    # by a class: a row that holds notes is a note like any other now, and what says
    # this one holds the thing being left out is its name. See folder-notes.ts.
    rows = page.locator("aside .row").filter(has_text="Archive")
    if rows.count():
        rows.first.click(button="right", force=True)
        page.wait_for_timeout(400)
        shot("row-menu")
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          ws.excluded.toggle(ws.activeSpace.root + '/Archive')
        }"""
    )

    # A query fence, answered where it stands: in the editor, and in the reading
    # view of the same note.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Everything open'))
          if (note) await ws.openEntry(note.path, { activate: true })
          ws.closePanel()
        }"""
    )
    page.wait_for_timeout(1600)
    shot("fence-editing")
    say(
        f"[{name}] the fence drew {page.evaluate('() => document.querySelectorAll(String.raw`.nib-query .nib-row`).length')} rows"
        f" under {page.evaluate('() => document.querySelectorAll(String.raw`.nib-query .nib-section`).length')} names"
    )

    page.evaluate(
        "() => window.nibApp.workspace.toggleReading(window.nibApp.workspace.active?.id)"
    )
    page.wait_for_timeout(1800)
    shot("fence-reading")
    say(
        f"[{name}] and in the reading view"
        f" {page.evaluate('() => document.querySelectorAll(String.raw`.nib-query .nib-row`).length')} rows"
    )

    # A box in a fence, pressed: the note is written where it stands, so the fence
    # answers again with one row fewer. This is the one path `pressRow` takes that
    # a test under node cannot: it reads the markup with `closest`.
    box = page.locator(".nib-query input[data-task]")
    if box.count():
        was = box.count()
        box.first.click(force=True)
        page.wait_for_timeout(2000)
        say(
            f"[{name}] a box ticked in the fence: {was} open tasks became"
            f" {page.locator('.nib-query input[data-task]').count()}"
        )
        shot("fence-ticked")
    else:
        say(f"[{name}] no box in the fence to press")

    context.close()


def measure(browser, out: Path, count: int) -> None:
    """Five thousand notes, and what a query costs against the budget."""
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    name = "many"
    context, page = opened(browser, 1440, 900, DESKTOP_AGENT, False, "dark", name)

    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root")
    seeded = page.evaluate(SEED_MANY, {"count": count, "root": root})
    held = page.evaluate("() => window.nibApp.workspace.notes.length")
    say(
        f"[{name}] {held} notes, {round(seeded['bytes'] / 1_000_000, 1)} MB,"
        f" written in {seeded['ms']} ms"
    )

    page.evaluate("() => window.nibApp.workspace.showPanel('search')")
    page.wait_for_timeout(400)

    # The budget a keystroke has. The field waits this long before asking, so it is
    # taken off every figure below: what is reported is the search.
    wait = 140
    asked = [
        "quarter",
        "quarter plan",
        '"wind above the field"',
        "tag:work/7",
        "task-todo:quarter",
        "[pages:>400]",
        "[due:<2026-03-01]",
        "path:Note 4",
        "quater",
        "zzzqx",
    ]

    # What the search is holding before a word has been typed: the worker reads the
    # space at the search stage of the launch, so the first query is already warm.
    # See search/warmth.ts for what the line says.
    say(f"[{name}] holding {held_text(page)}")

    for source in asked:
        # The first run and the best of several. A clock only ever says what the
        # machine was doing at the time, so the best run is the one where it was
        # doing this; the first is kept beside it because a cache that only looked
        # good on the second ask would not be worth having.
        runs = [page.evaluate(TIMED, {"source": source, "wait": wait}) for _ in range(5)]
        best = min(runs, key=lambda one: one["ms"])
        first = runs[0]
        say(
            f"[{name}] {source!r}: {best['ms']} ms best, {first['ms']} ms first,"
            f" {best['hits']} rows"
        )

    say(f"[{name}] holding {held_text(page)}")

    page.screenshot(path=str(shots / f"{name}-searched.png"))
    say(f"shot {name}-searched.png")

    # And with a third of the space left out, which is what leaving it out is for.
    page.evaluate(
        """({ root }) => {
          const ws = window.nibApp.workspace
          for (let one = 0; one < 1700; one++) ws.excluded.toggle(root + '/Note ' + one + '.md')
        }""",
        {"root": root},
    )
    page.wait_for_timeout(400)
    left = page.evaluate("() => window.nibApp.workspace.excluded.here.length")
    held = [page.evaluate(TIMED, {"source": "quarter", "wait": wait}) for _ in range(5)]
    quickest = min(held, key=lambda one: one["ms"])
    say(f"[{name}] with {left} notes left out: {quickest['ms']} ms, {quickest['hits']} rows")

    context.close()


def paper(words: str) -> str:
    """A one page PDF with `words` printed on it, as base64.

    Written out here rather than kept as a fixture: it is a dozen objects, and a
    drive that makes its own paper cannot drift from the paper it opens. Real
    enough that pdf.js reads the words back out of it, which is the whole point.
    """
    import base64

    stream = f"BT /F1 18 Tf 20 100 Td ({words}) Tj ET"
    body = "\n".join(
        [
            "%PDF-1.4",
            "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
            "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
            "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R"
            "/Resources<</Font<</F1 5 0 R>>>>>>endobj",
            f"4 0 obj<</Length {len(stream)}>>stream",
            stream,
            "endstream",
            "endobj",
            "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
            "trailer<</Root 1 0 R/Size 6>>",
            "%%EOF",
        ]
    )

    return base64.b64encode(body.encode("latin-1")).decode("ascii")


def kept_papers(page) -> int:
    """How many papers the store is holding words for."""
    return page.evaluate(
        """async () => {
          const open = indexedDB.open('nib')
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result)
            open.onerror = () => reject(open.error)
          })

          const keys = await new Promise((resolve, reject) => {
            const ask = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys()
            ask.onsuccess = () => resolve(ask.result)
            ask.onerror = () => reject(ask.error)
          })

          return keys.filter((key) => String(key).startsWith('papers/')).length
        }"""
    )


def papers(browser, out: Path) -> None:
    """The papers: a paper opened answers, and it still answers after a restart.

    Two of them, and only one is ever opened. The other is what the idle pass at the
    search stage reads by itself, which is what makes a space of papers answerable
    without anybody having opened any of them.
    """
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    name = "papers"
    context, page = opened(browser, 1440, 900, DESKTOP_AGENT, False, "dark", name)

    root = page.evaluate("() => window.nibApp.workspace.activeSpace.root")
    listed = page.evaluate(
        SEED_PAPERS,
        {
            "root": root,
            "papers": [
                ["Kestrel study.pdf", paper("the kestrel hangs above the field")],
                ["Ink study.pdf", paper("a study of ink and its wear on paper")],
            ],
        },
    )
    say(f"[{name}] the space holds {listed} papers")

    # One of them read, the way a reader reads one: opened, and its pages drawn.
    page.evaluate(
        "(path) => window.nibApp.workspace.openPdf(path, 1)",
        f"{root}/Kestrel study.pdf",
    )
    # The viewer is fetched the first time a paper is opened rather than carried into
    # the first paint - it brings pdf.js with it - so the pane is empty until it lands.
    # Waited for, and then the pages it draws. See surfaces.svelte.ts.
    page.wait_for_selector(".pdf", timeout=20000)
    page.wait_for_timeout(2500)
    searching(page)
    page.wait_for_timeout(400)
    say(f"[{name}] holding {held_text(page)}")
    say(f"[{name}] the store keeps {kept_papers(page)} paper")
    page.screenshot(path=str(shots / f"{name}-read.png"))

    def ask(source: str, pause: int = 1200) -> list:
        field = page.locator("aside input.query")
        field.click()
        field.fill(source)
        page.wait_for_timeout(pause)
        return page.evaluate(
            "() => window.nibApp.search.hits.map((one) => one.name + ' p' + (one.page ?? 0))"
        )

    say(f"[{name}] 'kestrel' finds {ask('kestrel')}")

    # The restart. The store is the same store; nothing is in memory.
    page.reload(wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=20000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=20000)
    searching(page)
    page.wait_for_timeout(1500)

    say(f"[{name}] after a restart: 'kestrel' finds {ask('kestrel')}")
    say(f"[{name}] holding {held_text(page)}")
    page.screenshot(path=str(shots / f"{name}-after-restart.png"))

    # And the paper nobody has ever opened, which the idle pass reads by itself.
    page.wait_for_timeout(4000)
    say(f"[{name}] the paper nobody opened: 'ink' finds {ask('ink')}")
    say(f"[{name}] the store keeps {kept_papers(page)} papers, holding {held_text(page)}")
    page.screenshot(path=str(shots / f"{name}-unopened.png"))

    context.close()


def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 5000
    out = Path(__file__).resolve().parent / "shots" / "search"

    pages = Pages()
    pages.start()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for one in DEVICES:
                    say(f"--- {one[0]} ---")
                    drive(browser, out, *one)

                say("--- papers ---")
                papers(browser, out)

                say(f"--- {count} notes ---")
                measure(browser, out, count)
            finally:
                browser.close()
    finally:
        pages.stop()

    say(f"shots in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
