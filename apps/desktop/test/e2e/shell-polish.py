"""The shell's own pixels: the row across the top, and both ends of the panel.

All of it is a pixel or a glyph rather than a behaviour, so the run measures rather
than clicks:

  - the title bar's label for the open space wears the space's own mark;
  - every mark in a badge is centred in it, optically, emoji and stroke alike;
  - a shared space and a shared note wear a shared mark, not a dot;
  - the sidebar button is one glyph whichever state it is in - the same shapes in
    the same places, measured as they are drawn rather than as they are written,
    because the two states differing by a transform is exactly what an audit of the
    markup cannot see;
  - the space switcher spans the panel, less whatever else is in its head;
  - the two switches at the foot of the panel each have their mark centred, are the
    same square, and sit on the row's own centre line;
  - the formatting bar on a phone sits on the keyboard, follows it, and leaves with
    it - nothing of it is left in the middle of the screen;
  - and every mark on that bar reads on one line, measured as ink rather than as the
    cell it sits in: a quotation mark is cut for running text and draws at the top of
    its em box, which a rule that centres the cell cannot see;
  - the bar is one row: the menu, the button, the space label and the first tab
    all sit on one centre line, inside `--header-height`;
  - the segmented control's chosen half reads raised in both schemes - lighter than
    the groove it sits in, with the shadow that says so - which one pair of the
    palette's surfaces cannot say on both sides.

Builds the web app, serves `dist` on a port of its own, measures and shoots on a
desktop 1180 wide and a phone 420 wide, each in both schemes, and stops everything
again. Screenshots go beside this file under `shots/shell-polish/`.

Run it from the repository root:

    python apps/desktop/test/e2e/shell-polish.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "shell-polish"

# A port of this run's own, above the dev server's 1420 and clear of the others.
# It was 18896, which another drive on this machine was found serving from its own
# `dist`: the server below writes nothing to the console, so the page that loaded
# was somebody else's app and the run gave up waiting for a handle it was never
# going to get. `free` refuses to start on a port that is answering, and the number
# moved into this batch's own range.
PORT = 19655
ORIGIN = f"http://127.0.0.1:{PORT}"

PATIENCE = 40

# How far off centre a mark may sit before it is a mark that looks wrong. Half a
# pixel is what rounding costs; anything past one is visible.
SLACK = 1.0

failures: list[str] = []

# A badge may hold an emoji, and this console is code page 1252.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(fine: bool, what: str) -> None:
    if fine:
        say(f"ok   {what}")
    else:
        failures.append(what)
        say(f"WRONG {what}")


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") == "1":
        say("reusing the build that is there")
        return

    say("building the web app")
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


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def fresh(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    # A first visit in a browser is given a welcome note, and the app opens it
    # after the space is there rather than with it; see `restore` in
    # workspace.svelte.ts. A panel opened before that has happened is shut again
    # underneath whatever was about to be photographed.
    wait_for(page, "() => !!window.nibApp.workspace.active", f"[{label}] the app's own note")
    return page


# Three spaces, so the switcher has rows to compare: the one that is open wearing
# a stroked mark, one wearing an emoji, and one shared with somebody.
#
# Sharing is an account fact, and this build has no account, so the two things the
# app reads are stood in for: `sync.remoteIdFor` and `account.spaces`. That is the
# only way a drive with no Worker behind it can see a shared row at all.
SEED = """
async () => {
  const app = window.nibApp
  const ws = app.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\nthe first line\\n', root)
  // Not `users`: a note wearing the shared mark as the icon it chose for itself
  // is a picture nobody could read.
  await ws.noteFrom('---\\nicon: notebook-pen\\n---\\n\\n# With Nina\\n\\nours\\n', root)
  await ws.openEntry(at('Deep work.md'))

  // The open space wears a stroked mark, which is the one Emil measured.
  ws.setIcon(ws.activeSpaceId, 'square-check-big')
  return { root, spaces: ws.spaces.map((one) => one.name), icon: ws.iconFor(ws.activeSpaceId) }
}
"""

# A second and a third space in the list, and one of them shared.
MORE_SPACES = """
() => {
  const app = window.nibApp
  const ws = app.workspace
  const here = ws.activeSpace

  const added = [
    { id: 'space-emoji', name: 'Journal', root: '/Journal' },
    { id: 'space-shared', name: 'With Nina', root: '/With Nina' },
  ]
  for (const one of added) {
    if (!ws.spaces.some((space) => space.id === one.id)) ws.spaces.push({ ...one })
  }

  ws.setIcon('space-emoji', '\\u{1F4D3}')
  ws.setIcon('space-shared', 'notebook-pen')

  // `isShared` asks two things: which remote space a folder mirrors, and what
  // the account holds for it. There is no Worker behind this run, so both are
  // stood in for; it is the only way a drive can see a shared row at all.
  //
  // A whole mirror each, not just the id: every row in the file list asks
  // `sync.tracked` whether it is a file shared on its own, and that walks the
  // mirrors and reads each one's root. A mirror without one threw, and an
  // exception in a row takes the whole sidebar with it. See newMirror in
  // sync/mirror.ts for the shape.
  const stand = (spaceId, root) => ({
    spaceId,
    root,
    cursor: 0,
    notes: {},
    files: {},
    shared: true,
  })

  app.sync.mirrors = {
    ...app.sync.mirrors,
    '/With Nina': stand('remote-nina', '/With Nina'),
    [here.root]: stand('remote-here', here.root),
  }
  app.account.spaces = [
    { id: 'remote-nina', name: 'With Nina', role: 'write', shared: true },
    { id: 'remote-here', name: here.name, role: 'owner', shared: true },
  ]

  return {
    here: here.name,
    spaces: ws.spaces.map((one) => one.name),
    roots: ws.spaces.map((one) => one.root),
  }
}
"""

# Where each of the marks in the switcher sits inside its badge, and where each
# thing in the title bar sits inside the bar. Boxes rather than a screenshot,
# because a pixel of drift is not something an eye reads off a picture.
BADGES = """
() => {
  const centre = (box) => box.top + box.height / 2
  const round = (value) => Math.round(value * 100) / 100
  const out = []

  for (const badge of document.querySelectorAll('.spaces .nib-badge')) {
    const box = badge.getBoundingClientRect()

    // Down to what is really drawn. A box that is centred can still hold a glyph
    // that is not: an svg is an inline element, so it sits on the text baseline of
    // whatever wraps it and the line box's descender pushes it off centre. That is
    // the pixel Emil saw, and it is only visible at the innermost element.
    let drawn = badge
    for (;;) {
      const next = drawn.querySelector(':scope > svg, :scope > .glyph, :scope > span')
      if (!next) break
      drawn = next
    }

    const inner = drawn.getBoundingClientRect()
    // Where the ink is, which for a stroked mark is tighter than its box.
    const ink = drawn.tagName.toLowerCase() === 'svg' ? drawn.getBBox?.() : null
    out.push({
      row: badge.closest('.nib-row')?.textContent.trim() ?? '?',
      kind: drawn === badge ? 'letter' : drawn.tagName.toLowerCase(),
      badge: [round(box.width), round(box.height)],
      mark: [round(inner.width), round(inner.height)],
      box_off: round(centre(inner) - centre(box)),
      ink: ink ? [round(ink.y), round(ink.height)] : null,
      line: getComputedStyle(drawn.parentElement ?? drawn).lineHeight,
      display: getComputedStyle(drawn).display,
      vertical: getComputedStyle(drawn).verticalAlign,
    })
  }

  return out
}
"""

BAR = """
() => {
  const header = document.querySelector('header')
  if (!header) return null

  const centre = (box) => box.top + box.height / 2
  const box = header.getBoundingClientRect()
  const parts = []

  const want = [
    ['the menu', 'header > :first-child button, header > button:first-child'],
    ['the sidebar button', 'header .toggle'],
    ['the space label', 'header .space'],
    ['the first tab', 'header .tab, header [role=tab], header .strip button'],
  ]

  for (const [name, selector] of want) {
    const found = header.querySelector(selector)
    if (!found) { parts.push({ name, missing: true }); continue }

    const one = found.getBoundingClientRect()
    parts.push({
      name,
      top: Math.round(one.top * 100) / 100,
      height: Math.round(one.height * 100) / 100,
      off: Math.round((centre(one) - centre(box)) * 100) / 100,
    })
  }

  return {
    height: Math.round(box.height * 100) / 100,
    token: getComputedStyle(document.documentElement).getPropertyValue('--header-height').trim(),
    parts,
  }
}
"""

# The label beside the sidebar button: does it carry the space's own mark.
LABEL = """
() => {
  const label = document.querySelector('header .space')
  if (!label) return null

  return {
    text: label.textContent.trim(),
    marks: label.querySelectorAll('svg, .glyph, .nib-badge').length,
    html: label.innerHTML.slice(0, 200),
  }
}
"""

# The sidebar button's glyph, in both states: the same shapes in the same places,
# or two drawings.
#
# The rendered box of each shape, and not only its `d`, because the markup being
# identical is what an audit reads and is not what an eye reads: the edge was
# being slid three and a half units into the frame's own border while the markup
# said one rect and one path either way, and a shut panel came out as a window
# with a thick left side - a different icon. Each box is measured against the
# button's own, so a button that moved between the two states does not read as a
# glyph that did.
TOGGLE = """
() => {
  // Wherever it is drawn: the title bar on a desktop, the drawer's own head under
  // a thumb. One component, drawn once; see mobile-header.test.ts.
  const button = document.querySelector('.toggle')
  if (!button) return null

  const seat = button.getBoundingClientRect()
  const shapes = [...button.querySelectorAll('svg *')].map((one) => {
    const style = getComputedStyle(one)
    const box = one.getBoundingClientRect()
    return {
      tag: one.tagName.toLowerCase(),
      d: one.getAttribute('d') ?? one.getAttribute('x') ?? '',
      fill: style.fill,
      opacity: style.opacity,
      transform: style.transform,
      x: Math.round((box.left - seat.left) * 10) / 10,
      y: Math.round((box.top - seat.top) * 10) / 10,
      width: Math.round(box.width * 10) / 10,
    }
  })

  return { pressed: button.getAttribute('aria-pressed'), shapes }
}
"""

# The head of the panel: how much of the row the switcher takes.
#
# The list of spaces is the width of the panel, so the control that opens it is
# too. Measured as the room left on either side of it rather than as a width
# against a width: the row also holds the drawer's own button and, under a thumb,
# the plus, and what is asked is that nothing but those and the row's own gap is
# left over. An empty spacer holding the plus at the end is exactly what that
# catches - it is room the switcher is not taking.
HEAD = """
() => {
  const head = document.querySelector('aside .head')
  const name = head?.querySelector('.name')
  if (!head || !name) return null

  const style = getComputedStyle(head)
  const gap = parseFloat(style.gap) || 0

  const row = head.getBoundingClientRect()
  const box = name.getBoundingClientRect()
  const inner = {
    left: row.left + (parseFloat(style.paddingLeft) || 0),
    right: row.right - (parseFloat(style.paddingRight) || 0),
  }

  const others = [...head.children]
    .filter((one) => one !== name)
    .map((one) => {
      const seen = one.getBoundingClientRect()
      return {
        what: one.className || one.tagName.toLowerCase(),
        width: Math.round(seen.width),
        left: seen.left,
        right: seen.right,
      }
    })

  // What stands between the switcher and each end of the row, whichever way the
  // row is laid out: the nearest thing on that side, or the row's own padding.
  const before = others.filter((one) => one.right <= box.left + 1)
  const after = others.filter((one) => one.left >= box.right - 1)
  const leftOf = before.length ? Math.max(...before.map((one) => one.right)) : inner.left
  const rightOf = after.length ? Math.min(...after.map((one) => one.left)) : inner.right

  return {
    row: Math.round(row.width),
    name: Math.round(box.width),
    height: Math.round(box.height),
    others: others.map((one) => ({ what: one.what, width: one.width })),
    gap: Math.round(gap),
    spare: Math.round((box.left - leftOf + (rightOf - box.right)) * 10) / 10,
    grow: getComputedStyle(name).flexGrow,
  }
}
"""

# The foot of the panel: the two switches, the glyph inside each, and the row.
#
# Three things in one measurement, because they fail together: the mark centred in
# its button, the buttons the same size, and both of them on the row's own centre
# line. A component rule written as `button` out-specifies the shared `.nib-glyph`
# - a scoped selector is a class and an element - and when it did, the grid that
# centres a mark lost to a flex row and both marks sat against the left of their
# button.
FOOT = """
() => {
  const foot = document.querySelector('aside .foot')
  if (!foot) return null

  const row = foot.getBoundingClientRect()
  const middle = row.top + row.height / 2

  const acts = [...foot.querySelectorAll('.act')].map((one) => {
    const box = one.getBoundingClientRect()
    const mark = one.querySelector('svg')?.getBoundingClientRect() ?? box
    return {
      name: one.getAttribute('aria-label'),
      display: getComputedStyle(one).display,
      width: Math.round(box.width),
      height: Math.round(box.height),
      off: Math.round((box.top + box.height / 2 - middle) * 10) / 10,
      markX: Math.round((mark.left + mark.right - box.left - box.right) / 2 * 10) / 10,
      markY: Math.round((mark.top + mark.bottom - box.top - box.bottom) / 2 * 10) / 10,
    }
  })

  const who = foot.querySelector('.who')?.getBoundingClientRect()
  return {
    height: Math.round(row.height),
    acts,
    who: who ? Math.round((who.top + who.height / 2 - middle) * 10) / 10 : null,
  }
}
"""

# The formatting bar on a phone, wherever it is: the strip over the keyboard, or
# the callout that belongs to a pointer.
FORMAT_BAR = """
() => {
  const docked = document.querySelector('.nib-bar.docked')
  const callout = document.querySelector('.nib-bar-at')
  const one = docked ?? callout
  if (!one) return { none: true }

  const box = one.getBoundingClientRect()
  return {
    none: false,
    docked: !!docked,
    top: Math.round(box.top),
    bottom: Math.round(box.bottom),
    left: Math.round(box.left),
    right: Math.round(box.right),
    page: window.innerHeight,
    keyboard: window.nibApp.viewport.keyboard,
    typing: window.nibApp.viewport.typing,
  }
}
"""

# The keyboard, stood in for.
#
# A headless run has no soft keyboard, and what the page reads is the visual
# viewport, which nothing in a browser window can shrink. So the two fields the
# platform writes are written here instead - they are the whole of what the page
# ever sees of a keyboard - and the arithmetic that gets them there from the visual
# viewport, in a browser and in the app, is measured in src/lib/viewport.test.ts.
KEYS = """
(pixels) => {
  const seen = window.nibApp.viewport
  seen.keyboard = pixels
  seen.typing = pixels > 0
  return { keyboard: seen.keyboard, typing: seen.typing }
}
"""

# A few words held, so the bar has something to be about - and so the callout that
# used to be left behind has every reason to appear.
SELECT = """
() => {
  const view = window.nib
  if (!view) return null

  const to = Math.min(12, view.state.doc.length)
  view.dispatch({ selection: { anchor: 2, head: to } })
  view.focus()
  return view.state.sliceDoc(2, to)
}
"""

# What says a space is shared: a bare dot, or a mark. Both are looked for, so a
# run says which of the two it found rather than only whether it found one.
SHARED = """
() => {
  const seen = []
  const found = document.querySelectorAll('.with, .shared')
  for (const one of found) {
    const style = getComputedStyle(one)
    seen.push({
      where: one.closest('.nib-row, .row, .name')?.textContent.trim() ?? '?',
      tag: one.tagName.toLowerCase(),
      klass: one.className,
      marks: one.querySelectorAll('svg').length,
      radius: style.borderRadius,
      width: style.width,
      background: style.backgroundColor,
      colour: style.color,
      label: one.getAttribute('aria-label'),
    })
  }

  return seen
}
"""


# What makes the window a phone. A headless browser has no touch screen for the
# app to recognise, so the device is set the way the other drives set it, along
# with the attributes the tokens read for the touch scale.
AS_PHONE = """
() => {
  const app = window.nibApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  app.viewport.narrow = true

  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""


# Somebody else in the open note, which is what puts the shared mark on its row
# in the file list. There is no second device behind this run, so the count the
# rooms keep is written by hand; the mark and the rule that draws it are real.
WITH_SOMEBODY = """
() => {
  const app = window.nibApp
  const tab = app.workspace.tabs.find((one) => one.path && one.path.endsWith('.md'))
  if (!tab) return null

  app.rooms.present = { ...app.rooms.present, [tab.note.key]: 1 }
  return tab.path
}
"""

# Which rows in the file list wear it.
TREE_MARKS = """
() => [...document.querySelectorAll('aside .row')].map((row) => ({
  row: row.textContent.trim(),
  shared: row.querySelectorAll('.shared').length,
}))
"""


# The segmented control, read as light rather than looked at: the surface of the
# half that is chosen, the surface of the groove it sits in, and how far apart the
# two are. Raised means lighter than what it sits in, and it has to mean that on
# both sides of the palette.
#
# It could not. The surfaces step away from the page - lighter as they go in the
# dark scheme, darker in the light one - so the thumb at `--surface` inside a
# `--surface-2` track was a step up out of a light card and a step down into a dark
# one: 1.075 the wrong way round in the dark, against 1.067 the right way in the
# light. See `--segment-raised` in base.css.
SEGMENTED = """
() => {
  const track = document.querySelector('.nib-segmented')
  if (!track) return { none: true }

  // The surface belongs to the thumb wherever one slides, and to the chosen
  // button where none does; see `.nib-segmented.has-thumb button.on`.
  const raised = track.querySelector('.nib-segmented-thumb') ?? track.querySelector('button.on')
  if (!raised) return { none: true }

  const lit = (css) => {
    const [r, g, b] = (css.match(/[\\d.]+/g) ?? [0, 0, 0]).slice(0, 3).map(Number)
    const one = (v) => {
      const x = v / 255
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * one(r) + 0.7152 * one(g) + 0.0722 * one(b)
  }

  const over = getComputedStyle(raised).backgroundColor
  const under = getComputedStyle(track).backgroundColor
  const hi = Math.max(lit(over), lit(under))
  const lo = Math.min(lit(over), lit(under))

  return {
    none: false,
    thumb: over,
    track: under,
    lighter: lit(over) > lit(under),
    ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 1000) / 1000,
    shadow: getComputedStyle(raised).boxShadow !== 'none',
  }
}
"""


# Every mark on the formatting bar, and where its ink sits in the button.
#
# The bar is a row of one-character marks read across the middle, and a quotation
# mark is not cut for that: it is set where quotes go in running text, hard against
# the top of its own em box, so it sat high in its cell while every letter beside it
# was level. What is measured is the ink rather than the line box - the box is
# centred either way, which is exactly why an audit of the rule could not see this -
# and each mark is compared with the others rather than with an absolute, so whatever
# this font's metrics are, the row either reads as one row or it does not.
#
# `measureText` gives both: `fontBoundingBox*` is the em box the text was laid out in,
# which is what puts the baseline on screen, and `actualBoundingBox*` is what the
# glyph actually covers.
FORMAT_MARKS = """
() => {
  const bar = document.querySelector('.nib-bar.docked') ?? document.querySelector('.nib-bar-at')
  if (!bar) return { none: true }

  const ink = document.createElement('canvas').getContext('2d')

  const marks = [...bar.querySelectorAll('button')].map((one) => {
    const box = one.getBoundingClientRect()
    const middle = box.top + box.height / 2
    const name = one.getAttribute('aria-label') ?? '?'

    const glyph = one.querySelector('svg')
    if (glyph) {
      const seen = glyph.getBoundingClientRect()
      return {
        name,
        as: 'glyph',
        off: Math.round((seen.top + seen.height / 2 - middle) * 10) / 10,
        size: Math.round(seen.height * 10) / 10,
      }
    }

    // The `.low` span where there is one, which is the element the transform is on,
    // so its own box is where the letter ended up.
    const held = one.querySelector('span') ?? one
    const text = (held.textContent ?? '').trim()
    if (!text) return { name, as: 'nothing', off: null, size: null }

    const style = getComputedStyle(held)
    ink.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    ink.textBaseline = 'alphabetic'
    const cut = ink.measureText(text)

    let line = held.getBoundingClientRect()
    if (held === one) {
      const range = document.createRange()
      range.selectNodeContents(one)
      line = range.getBoundingClientRect()
    }

    const lead = (line.height - (cut.fontBoundingBoxAscent + cut.fontBoundingBoxDescent)) / 2
    const baseline = line.top + lead + cut.fontBoundingBoxAscent
    const above = (cut.actualBoundingBoxAscent - cut.actualBoundingBoxDescent) / 2

    return {
      name,
      as: 'letter',
      text,
      off: Math.round((baseline - above - middle) * 10) / 10,
      size: Math.round((cut.actualBoundingBoxAscent + cut.actualBoundingBoxDescent) * 10) / 10,
    }
  })

  return { none: false, marks }
}
"""


# Where the drawer is, so a shot of nothing is a reading rather than a puzzle.
ASIDE_AT = """
() => {
  const aside = document.querySelector('aside')
  if (!aside) return null

  const box = aside.getBoundingClientRect()
  return { left: Math.round(box.left), width: Math.round(box.width) }
}
"""


def same_glyph(label: str, shut: dict | None, opened: dict | None) -> None:
    """The sidebar button, measured in both states: the same shapes, in the same
    places, at the same size. One glyph means one drawing, and the state is said in
    words - `aria-pressed` and the tooltip - rather than by redrawing the mark."""
    if not shut or not opened:
        check(False, f"[{label}] there is a sidebar button to measure")
        return

    check(
        [one["tag"] for one in shut["shapes"]] == [one["tag"] for one in opened["shapes"]],
        f"[{label}] the sidebar button is made of the same shapes in both states",
    )
    check(
        shut["pressed"] != opened["pressed"],
        f"[{label}] and says which state it is in ({shut['pressed']} then {opened['pressed']})",
    )

    for one, other in zip(shut["shapes"], opened["shapes"]):
        moved = max(abs(one["x"] - other["x"]), abs(one["y"] - other["y"]))
        check(
            moved <= SLACK and abs(one["width"] - other["width"]) <= SLACK,
            f"[{label}] the {one['tag']} is in the same place in both states"
            f" (moved {moved}px: {one} then {other})",
        )

    # The shut state is the one that has twice come out as a different icon: first
    # the edge was faded away, then it was slid into the frame's own border.
    for state, seen in (("shut", shut), ("open", opened)):
        faint = [one for one in seen["shapes"] if float(one["opacity"]) < 0.95]
        check(
            not faint,
            f"[{label}] every part of the sidebar button is drawn while it is {state} ({faint})",
        )


def panel_ends(page: Page, label: str) -> None:
    """The two ends of the panel: the switcher across the head, and the two
    switches centred in the foot. One function, because the answer has to be the
    same on a desktop and under a thumb."""
    head = page.evaluate(HEAD)
    say(f"[{label}] the head: {head}")
    if not head:
        check(False, f"[{label}] the panel has a head to measure")
    else:
        # One gap on each side of it, at most, and nothing else: the gap is the
        # row's own, between the switcher and whatever it stands beside.
        room = 2 * head["gap"] + SLACK
        check(
            head["spare"] <= room,
            f"[{label}] the space switcher spans the panel ({head['name']}px wide, with"
            f" {head['spare']}px spare beside {head['others']})",
        )
        check(
            head["grow"] != "0",
            f"[{label}] and takes the width rather than being given the word's ({head['grow']})",
        )

    foot = page.evaluate(FOOT)
    say(f"[{label}] the foot: {foot}")
    if not foot:
        check(False, f"[{label}] the panel has a foot to measure")
        return

    check(len(foot["acts"]) == 2, f"[{label}] the foot holds the theme and the settings")
    for one in foot["acts"]:
        check(
            abs(one["markX"]) <= SLACK and abs(one["markY"]) <= SLACK,
            f"[{label}] the {one['name']!r} mark is centred in its button"
            f" (off {one['markX']}px across, {one['markY']}px down)",
        )
        check(
            abs(one["off"]) <= SLACK,
            f"[{label}] and {one['name']!r} sits on the row's centre line"
            f" (off by {one['off']}px)",
        )

    sizes = {(one["width"], one["height"]) for one in foot["acts"]}
    check(len(sizes) == 1, f"[{label}] both switches are the same square ({sizes})")

    if foot["who"] is not None:
        check(
            abs(foot["who"]) <= SLACK,
            f"[{label}] and the account row is on that line too (off by {foot['who']}px)",
        )


def on_phone(browser: Browser, scheme: str = "light") -> None:
    """The same two surfaces under a thumb. The bar says the note's name there
    rather than the space's, so what is checked is the drawer's own head: the
    same switcher, the same badges, at the touch scale."""
    label = f"phone {scheme}"
    width = 420
    page = fresh(browser, label, {"width": width, "height": 880}, scheme)
    try:
        page.evaluate(AS_PHONE)
        page.wait_for_timeout(200)
        say(f"[{label}] {page.evaluate(SEED)}")
        say(f"[{label}] {page.evaluate(MORE_SPACES)}")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)

        page.locator("header").first.screenshot(path=str(SHOTS / f"bar-phone-{scheme}.png"))
        say(f"[{label}] wrote bar-phone-{scheme}.png")

        # The screen, which at this width is the note with the bar over it: the
        # list is a drawer behind it, and the note is the layer a thumb slides
        # aside to uncover it. A headless run has no thumb, so what the phone pass
        # is really for is the numbers below - the badges are drawn at the touch
        # scale whether or not a picture can be taken of them.
        page.screenshot(path=str(SHOTS / f"screen-phone-{scheme}.png"))
        say(f"[{label}] wrote screen-phone-{scheme}.png")
        say(f"[{label}] the drawer sits at {page.evaluate(ASIDE_AT)}")

        # The drawer's own button, in both states, measured the way the desktop's
        # is. The drawer itself slides, so each shape is measured against its own
        # button and the layer's transform comes out in the wash.
        opened_button = page.evaluate(TOGGLE)
        say(f"[{label}] the drawer's own button, open: {opened_button}")
        page.evaluate("() => window.nibApp.workspace.showPanel(null)")
        page.wait_for_timeout(600)
        shut_button = page.evaluate(TOGGLE)
        say(f"[{label}] the drawer's own button, shut: {shut_button}")
        same_glyph(label, shut_button, opened_button)

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(600)

        # Both ends of the drawer: the switcher across its head, the two switches in
        # its foot. The same two measurements the desktop's panel gets.
        panel_ends(page, label)
        page.locator("aside .head").first.screenshot(path=str(SHOTS / f"head-phone-{scheme}.png"))
        page.locator("aside .foot").first.screenshot(path=str(SHOTS / f"foot-phone-{scheme}.png"))
        say(f"[{label}] wrote head-phone-{scheme}.png and foot-phone-{scheme}.png")

        # ── The formatting bar, which rides the keyboard ──
        page.evaluate("() => window.nibApp.workspace.showPanel(null)")
        page.wait_for_timeout(400)
        say(f"[{label}] holding {page.evaluate(SELECT)!r}")

        # Up: the strip sits on the keys and spans the screen.
        say(f"[{label}] the keys come up: {page.evaluate(KEYS, 320)}")
        page.wait_for_timeout(400)
        up = page.evaluate(FORMAT_BAR)
        say(f"[{label}] the bar with the keys up: {up}")
        page.screenshot(path=str(SHOTS / f"format-bar-up-{scheme}.png"))
        check(not up["none"] and up["docked"], f"[{label}] the bar over the keys is the strip")
        if not up["none"]:
            check(
                abs(up["bottom"] - (up["page"] - 320)) <= SLACK,
                f"[{label}] and it sits on them ({up['bottom']}px of {up['page']}px)",
            )
            # And every mark in it reads on one line: the ink of each, measured, not
            # the cell it is centred in - which was centred all along.
            found = page.evaluate(FORMAT_MARKS)
            for one in found.get("marks", []):
                say(f"[{label}]   {one}")

            letters = [one for one in found.get("marks", []) if one["as"] == "letter"]
            glyphs = [one for one in found.get("marks", []) if one["as"] == "glyph"]
            check(len(letters) >= 5, f"[{label}] the bar's marks were read ({len(letters)})")
            check(
                any(one["name"] == "Link" for one in glyphs),
                f"[{label}] Link is a glyph rather than a character that means a tag",
            )

            if letters:
                level = sorted(one["off"] for one in letters)[len(letters) // 2]
                for one in letters + glyphs:
                    check(
                        abs(one["off"] - level) <= 1.5,
                        f"[{label}] {one['name']} reads on the row's own line"
                        f" (ink {one['off']}px against {level}px)",
                    )

            check(
                up["left"] <= SLACK and abs(up["right"] - width) <= SLACK,
                f"[{label}] and spans the screen ({up['left']} to {up['right']} of {width})",
            )

        # Half way: a keyboard of another height, because a bar placed once is a bar
        # that only looks right on the keyboard it was placed for.
        page.evaluate(KEYS, 180)
        page.wait_for_timeout(300)
        lower = page.evaluate(FORMAT_BAR)
        say(f"[{label}] and with a shallower keyboard: {lower}")
        check(
            not lower["none"] and abs(lower["bottom"] - (lower["page"] - 180)) <= SLACK,
            f"[{label}] the bar follows the keys rather than staying where it was put",
        )

        # Down: nothing is left. This is what was reported - the strip goes with the
        # keyboard and the callout meant for a pointer caught what fell through,
        # leaving a bar in the middle of the screen with a selection still held.
        say(f"[{label}] the keys go down: {page.evaluate(KEYS, 0)}")
        page.wait_for_timeout(400)
        down = page.evaluate(FORMAT_BAR)
        say(f"[{label}] the bar with the keys down: {down}")
        page.screenshot(path=str(SHOTS / f"format-bar-down-{scheme}.png"))
        check(
            down["none"],
            f"[{label}] nothing of the bar is left once the keyboard goes ({down})",
        )

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(500)

        # The drawer is a layer that slides, so the button in it is only a target
        # once it has arrived. Pressed through the page rather than aimed at, for
        # the same reason: a headless run has no finger to open the drawer with.
        page.evaluate("() => document.querySelector('aside .name')?.click()")
        page.wait_for_timeout(600)
        page.locator(".spaces").first.screenshot(path=str(SHOTS / f"switcher-phone-{scheme}.png"))
        say(f"[{label}] wrote switcher-phone-{scheme}.png")

        for one in page.evaluate(BADGES):
            say(f"[{label}]   {one}")
            check(
                abs(one["box_off"]) <= SLACK,
                f"[{label}] the mark on {one['row']!r} is centred in its badge"
                f" (off by {one['box_off']}px)",
            )

        shared = page.evaluate(SHARED)
        say(f"[{label}] what says shared: {[one['klass'] for one in shared]}")
        for one in shared:
            check(
                one["marks"] >= 1 and one["radius"] != "50%",
                f"[{label}] {one['where']!r} says shared with a mark rather than a dot",
            )
    finally:
        page.context.close()


def drive(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> None:
    page = fresh(browser, label, viewport, scheme)
    try:
        say(f"[{label}] {page.evaluate(SEED)}")
        say(f"[{label}] {page.evaluate(MORE_SPACES)}")
        page.wait_for_timeout(400)

        # ── The bar, with the panel shut, which is when it carries the label ──
        page.evaluate("() => window.nibApp.workspace.showPanel(null)")
        page.wait_for_timeout(400)

        bar = page.evaluate(BAR)
        say(f"[{label}] the bar is {bar['height']}px, token {bar['token']}")
        for part in bar["parts"]:
            say(f"[{label}]   {part}")

        header = page.locator("header").first
        header.screenshot(path=str(SHOTS / f"bar-{label}.png"))
        say(f"[{label}] wrote bar-{label}.png")

        placed = [one for one in bar["parts"] if not one.get("missing")]
        check(
            len(placed) >= 3,
            f"[{label}] the bar holds the menu, the button, the label and a tab",
        )
        for one in placed:
            check(
                abs(one["off"]) <= SLACK,
                f"[{label}] {one['name']} is on the bar's centre line (off by {one['off']}px)",
            )

        label_seen = page.evaluate(LABEL)
        say(f"[{label}] the space label: {label_seen}")
        if label_seen:
            check(
                label_seen["marks"] >= 1,
                f"[{label}] the space label wears the space's own mark",
            )

        shut = page.evaluate(TOGGLE)
        say(f"[{label}] the sidebar button shut: {shut}")
        page.locator(".toggle").first.screenshot(path=str(SHOTS / f"toggle-shut-{label}.png"))

        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_timeout(500)
        opened = page.evaluate(TOGGLE)
        say(f"[{label}] the sidebar button open: {opened}")
        page.locator(".toggle").first.screenshot(path=str(SHOTS / f"toggle-open-{label}.png"))
        say(f"[{label}] wrote toggle-shut-{label}.png and toggle-open-{label}.png")

        same_glyph(label, shut, opened)

        # ── Both ends of the panel: the switcher, and the two switches ──
        panel_ends(page, label)
        page.locator("aside .head").first.screenshot(path=str(SHOTS / f"head-{label}.png"))
        page.locator("aside .foot").first.screenshot(path=str(SHOTS / f"foot-{label}.png"))
        say(f"[{label}] wrote head-{label}.png and foot-{label}.png")

        # ── The switcher, open, which is where the badges are ──
        page.locator("aside .name").first.click()
        page.wait_for_timeout(500)
        page.locator(".spaces").first.screenshot(path=str(SHOTS / f"switcher-{label}.png"))
        say(f"[{label}] wrote switcher-{label}.png")

        for one in page.evaluate(BADGES):
            say(f"[{label}]   {one}")
            check(
                abs(one["box_off"]) <= SLACK,
                f"[{label}] the mark on {one['row']!r} is centred in its badge"
                f" (off by {one['box_off']}px)",
            )

        shared = page.evaluate(SHARED)
        say(f"[{label}] what says shared: {shared}")
        check(len(shared) >= 2, f"[{label}] the shared spaces say so at all")
        page.evaluate("() => document.querySelector('.catch')?.click()")
        page.wait_for_timeout(400)

        # The file list's half of the same mark: a note somebody else is in.
        say(f"[{label}] somebody else joined {page.evaluate(WITH_SOMEBODY)}")
        page.wait_for_timeout(400)
        rows = page.evaluate(TREE_MARKS)
        for one in rows:
            say(f"[{label}]   {one}")

        marked = [one["row"] for one in rows if one["shared"]]
        check(
            len(marked) == 1,
            f"[{label}] one note wears the mark and no other row does ({marked})",
        )
        page.locator("aside").screenshot(path=str(SHOTS / f"tree-{label}.png"))
        say(f"[{label}] wrote tree-{label}.png")
        for one in shared:
            check(
                one["marks"] >= 1 and one["radius"] != "50%",
                f"[{label}] {one['where']!r} says shared with a mark rather than a dot"
                f" ({one['klass']}, radius {one['radius']})",
            )
            check(
                bool(one["label"]),
                f"[{label}] and says it in a word too ({one['label']!r})",
            )

        # ── The segmented control, where a raised surface has to read raised ──
        # Appearance, because it is the pane that has one in it, and because which
        # scheme is in force is chosen on exactly this control.
        page.evaluate("() => window.nibApp.settings.show()")
        page.wait_for_timeout(600)
        page.evaluate(
            "() => { window.nibApp.settings.section = 'appearance';"
            " window.nibApp.settings.listing = false }"
        )
        page.wait_for_timeout(700)
        segment = page.evaluate(SEGMENTED)
        say(f"[{label}] the segmented control: {segment}")
        check(not segment["none"], f"[{label}] the appearance pane draws a segmented control")
        if not segment["none"]:
            page.locator(".nib-segmented").first.screenshot(
                path=str(SHOTS / f"segmented-{label}.png")
            )
            say(f"[{label}] wrote segmented-{label}.png")
            check(
                segment["lighter"],
                f"[{label}] the chosen half is lighter than the groove it sits in"
                f" ({segment['thumb']} over {segment['track']})",
            )
            check(
                segment["ratio"] >= 1.05,
                f"[{label}] and lifted far enough out of it to see ({segment['ratio']})",
            )
            check(segment["shadow"], f"[{label}] and casts the shadow that says so")
        page.evaluate(
            "() => window.nibApp.settings.hide?.() ?? (window.nibApp.settings.open = false)"
        )
        page.wait_for_timeout(300)
    finally:
        page.context.close()


def free() -> None:
    """Nothing else on this port. The server below is started with its output
    thrown away, so a port already in use fails silently and the run measures
    whatever page the other server answers with."""
    with socket.socket() as one:
        one.settimeout(2)
        if one.connect_ex(("127.0.0.1", PORT)) == 0:
            raise SystemExit(f"something is already answering on {ORIGIN}")


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    free()
    build()

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                drive(browser, "light", {"width": 1180, "height": 760}, "light")
                drive(browser, "dark", {"width": 1180, "height": 760}, "dark")
                on_phone(browser, "light")
                on_phone(browser, "dark")
            finally:
                browser.close()
    finally:
        say("stopping the server")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        else:
            server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    if failures:
        print("\nwhat is still wrong:", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe bar is one row and every mark is centred", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
