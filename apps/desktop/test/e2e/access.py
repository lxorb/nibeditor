"""The whole app, walked with a keyboard and measured with axe-core.

Four windows - a desktop and a phone, each in the light and in the dark - and on
each of them every surface the app can put up: the panels, the palette, the menus,
the sheets, the settings, the note being read, the plane, a deck. Each surface is
asked three things:

  1. **axe-core**, on the page as it stands. Every violation is counted by impact
     and the serious and critical ones are named, because those are the ones that
     stop somebody rather than slow them down.
  2. **The ring.** Every element a key can land on is focused in turn and asked
     what it draws: the ring, or a border that turns instead. One that draws
     neither is a place the keyboard can be with nothing at all saying so, and the
     widths and colours are collected so a second answer shows up as a second
     number.
  3. **The name.** Every control with nothing in it but a drawing is asked what it
     is called.

Then, once per window: the keyboard walk itself - F6 round the regions and back,
Tab stopping once per list, the arrows and Home and End and a spelled name inside
one, every layer opened with a key, closed with Escape and handing the keyboard
back to whatever opened it - and four things about the window itself: 200% zoom
with nothing clipped or scrolling sideways, a system asking for more contrast, a
system asking for less movement, and every target under a thumb at the floor
`--touch-target` sets.

Run it from the repository root:

    python apps/desktop/test/e2e/access.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. NIB_DIST names another folder to
serve, and NIB_LABEL names the run, which is how the same drive measures the app
before a change and after it:

    NIB_DIST=dist-before NIB_LABEL=before python apps/desktop/test/e2e/access.py

Screenshots go beside this file under `shots/access/<label>/`, and the axe counts
are written to `shots/access/<label>/axe.json` so two runs can be compared.
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

from playwright.sync_api import Browser, sync_playwright

from settling import HIDE_CARET, steady

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / os.environ.get("NIB_DIST", "dist")
LABEL = os.environ.get("NIB_LABEL", "after")
SHOTS = HERE / "shots" / "access" / LABEL

# axe-core comes off the disk: the CDN is not reachable from here, and a drive
# that fetched its own measuring stick would be measuring the day's network.
AXE = APP / "node_modules" / "axe-core" / "axe.min.js"

# Above 1425, and not any other drive's port.
PORT = 18937
ORIGIN = f"http://127.0.0.1:{PORT}"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

# name, width, height, agent, finger, scheme
WINDOWS = [
    ("desktop-light", 1440, 900, DESKTOP_AGENT, False, "light"),
    ("desktop-dark", 1440, 900, DESKTOP_AGENT, False, "dark"),
    ("phone-light", 390, 844, PHONE_AGENT, True, "light"),
    ("phone-dark", 390, 844, PHONE_AGENT, True, "dark"),
]

# A small space, enough to have a folder, a note with headings, a canvas and a
# note nothing points at.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name)
  const folder = join(root, 'Field notes')

  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\n## What went in this week\\n\\n- Pressure on the pen\\n\\n### Wind\\n\\nThe wind was steady all week, and a [[Reading list]] came of it.\\n', undefined)
  await ws.noteFrom('# Read me\\n\\nA markdown editor that formats what you write as you write it.\\n', undefined)
  await ws.noteFrom('# Reading list\\n\\nA paper about ink, and one about wind.\\n', undefined)
  await ws.noteFrom('# Ledger\\n\\nWhat the wind cost.\\n', folder)
  await ws.noteFrom('# Sketches\\n\\nInk on paper.\\n', folder)

  ws.device.expand(folder)
  await ws.loadTree()

  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) {
    ws.bookmarks.toggle({ kind: 'note', path: first.name })
    await ws.openEntry(first.path, { activate: true })
  }
  const second = ws.notes.find((one) => one.name.startsWith('Read me'))
  if (second) await ws.openEntry(second.path, { activate: true })

  return ws.files.map((one) => one.name)
}
"""

# Everything a key can land on, which is the list focus.ts walks.
FOCUSABLE = (
    "button, a[href], input, select, textarea, summary,"
    " [tabindex]:not([tabindex='-1']), [contenteditable='true']"
)

AXE_RUN = """
async () => {
  const found = await window.axe.run(document, {
    resultTypes: ['violations'],
    // The plane keeps its own keyboard, which is what `role="application"` is
    // for, and the rule that objects to one cannot tell that from a mistake.
    rules: { 'landmark-one-main': { enabled: true } },
  })

  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
  const named = []
  const quieter = []

  for (const one of found.violations) {
    const impact = one.impact ?? 'minor'
    counts[impact] = (counts[impact] ?? 0) + one.nodes.length
    const said = {
      id: one.id,
      impact,
      nodes: one.nodes.length,
      where: one.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }
    // The serious and the critical are what a run is judged on; the rest are
    // written down so a number that grows can be accounted for.
    if (impact === 'critical' || impact === 'serious') named.push(said)
    else quieter.push({ id: one.id, impact, nodes: one.nodes.length })
  }

  return { counts, named, quieter }
}
"""

# Every element a key can land on, at rest and then with the keyboard on it, so
# what each of them says can be read as the difference between the two: the ring,
# or the border turning, or the halo arriving. Measured rather than assumed,
# because a rule that draws nothing and a rule that draws something invisible are
# the same thing to look at and not the same thing to fix.
#
# `:focus-visible` is asked of the browser rather than guessed at: a key press
# before this puts the window in keyboard modality, and programmatic focus keeps it
# there.
RINGS = f"""
() => {{
  const within = (node) => node.getClientRects().length > 0 && !node.closest('[inert]')
  const found = [...document.querySelectorAll("{FOCUSABLE}")].filter(within)
  const was = document.activeElement

  const reads = (node) => {{
    const style = getComputedStyle(node)
    const width = parseFloat(style.outlineWidth) || 0
    return {{
      ring: style.outlineStyle !== 'none' && width > 0
        ? `${{style.outlineWidth}} ${{style.outlineStyle}} ${{style.outlineColor}}`
        : null,
      shadow: style.boxShadow,
      border: `${{style.borderColor}} ${{style.borderWidth}}`,
      background: style.backgroundColor,
    }}
  }}

  // At rest, all of them, before anything is focused: a style read after the focus
  // has moved on is the style of something else.
  const resting = new Map(found.map((node) => [node, reads(node)]))
  const out = []

  for (const node of found) {{
    try {{ node.focus({{ preventScroll: true }}) }} catch {{ continue }}
    if (document.activeElement !== node) continue

    const before = resting.get(node)
    const now = reads(node)
    // A box with a caret in it says so with the caret as well, which is the one
    // answer no stylesheet draws and no measurement can see.
    const caret =
      node.isContentEditable ||
      node.tagName === 'TEXTAREA' ||
      (node.tagName === 'INPUT' &&
        !['range', 'checkbox', 'radio', 'color', 'file', 'button', 'submit'].includes(node.type))

    out.push({{
      tag: node.tagName.toLowerCase(),
      cls: (node.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2).join('.'),
      said: node.getAttribute('aria-label') ?? (node.textContent ?? '').trim().slice(0, 24),
      keyed: node.matches(':focus-visible'),
      ring: now.ring,
      turned: before.border !== now.border,
      haloed: before.shadow !== now.shadow,
      lit: before.background !== now.background,
      caret,
    }})
  }}

  if (was instanceof HTMLElement) {{ try {{ was.focus({{ preventScroll: true }}) }} catch {{}} }}
  return out
}}
"""

# A control with nothing in it but a drawing, and whether it is called anything.
UNNAMED = f"""
() => {{
  const within = (node) => node.getClientRects().length > 0 && !node.closest('[inert]')
  const wordless = (node) => (node.textContent ?? '').trim().length === 0

  return [...document.querySelectorAll("{FOCUSABLE}")]
    .filter(within)
    .filter(wordless)
    .filter((node) => {{
      if (node.getAttribute('aria-label')?.trim()) return false
      if (node.getAttribute('aria-labelledby')) return false
      if (node.getAttribute('title')?.trim()) return false
      // A field says what it is with its placeholder where it has no label, which
      // axe counts and so does this.
      if (node.getAttribute('placeholder')?.trim()) return false
      return true
    }})
    .map((node) => {{
      const cls = (node.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2)
      return `${{node.tagName.toLowerCase()}}.${{cls.join('.')}}`
    }})
}}
"""

# Every heading in the page, in order, so the outline can be read down.
HEADINGS = """
() => [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
  .filter((one) => one.getClientRects().length > 0 || one.classList.contains('nib-said'))
  .map((one) => `${one.tagName.toLowerCase()} ${(one.textContent ?? '').trim().slice(0, 28)}`)
"""

LANDMARKS = """
() => [...document.querySelectorAll('main, header, footer, nav, aside, article, [role]')]
  .filter((one) => ['main', 'header', 'footer', 'nav', 'aside', 'article'].includes(one.tagName.toLowerCase()))
  .map((one) => {
    const name = one.getAttribute('aria-label') ?? one.getAttribute('aria-labelledby') ?? ''
    return `${one.tagName.toLowerCase()}${name ? ` "${name.slice(0, 24)}"` : ' (unnamed)'}`
  })
"""

# What has the keyboard, as one line.
WHERE = """
() => {
  const at = document.activeElement
  if (!at) return 'nothing'

  const region = at.closest('[data-region]')?.dataset.region ?? '-'
  const named =
    at.getAttribute('aria-label') ?? (at.textContent ?? '').trim().slice(0, 28)
  const cls = (at.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2).join('.')

  return `${region} | ${at.tagName.toLowerCase()}.${cls} | ${JSON.stringify(named)}`
}
"""

# Whether the window scrolls sideways, and whether anything is cut off the side of
# it. At 200% the second is what actually loses somebody a button.
CLIPPED = """
() => {
  const root = document.documentElement
  const sideways = root.scrollWidth - root.clientWidth
  const over = []

  for (const node of document.querySelectorAll('button, a[href], input, [role=tab]')) {
    const box = node.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    if (box.right > root.clientWidth + 1 || box.left < -1) {
      const cls = (node.className ?? '').toString().split(' ').filter(Boolean)[0] ?? ''
      over.push(`${node.tagName.toLowerCase()}.${cls}`)
    }
  }

  return { sideways, over: [...new Set(over)].slice(0, 8) }
}
"""

# Every target a thumb has to hit, against the floor the tokens set.
TARGETS = """
() => {
  const floor = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--touch-target'),
  )
  const small = []

  for (const node of document.querySelectorAll('button, a[href], [role=tab], input')) {
    const box = node.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    // The row in a list is the target, not the mark inside it.
    if (node.closest('[aria-hidden=true]')) continue
    if (box.height < floor - 0.5 || box.width < floor - 0.5) {
      const cls = (node.className ?? '').toString().split(' ').filter(Boolean).slice(0, 2).join('.')
      small.push(`${node.tagName.toLowerCase()}.${cls} ${Math.round(box.width)}x${Math.round(box.height)}`)
    }
  }

  return { floor, small: [...new Set(small)] }
}
"""

STILL = """
() => {
  const style = getComputedStyle(document.documentElement)
  const tokens = ['--dur-instant', '--dur-fast', '--dur-slow']
  const said = Object.fromEntries(tokens.map((one) => [one, style.getPropertyValue(one).trim()]))
  return { said, asked: window.matchMedia('(prefers-reduced-motion: reduce)').matches }
}
"""

# The catalogue lives behind nibeditor.com and this run is not about reaching it.
TOLERATED = ("nibeditor.com", "Failed to load resource", "net::ERR", "favicon")

# The two axe-core rules this run still reports, each with the reason it is still
# reported rather than fixed. Named here rather than switched off, so the count
# stays in the table and a third one cannot join them quietly.
KNOWN = {
    # The note's own scroller. axe asks that a box which scrolls be reachable by
    # keyboard, and looks for a tabindex on the box: the thing inside this one is a
    # `role="textbox"` the keyboard lives in and the arrows scroll, so the box is
    # reached by being written in. A tabindex on the scroller would put a second
    # stop in the sequence that does nothing the first does not.
    "scrollable-region-focusable": "the note is reached by being written in",
    # White on the accent. 5.95:1 on the light scheme's accent and 3.98:1 on the
    # dark scheme's, 3.25:1 on its hover shade - so the app's filled button is
    # under the floor on one side of the theme. The ink on an accent fill wants a
    # token of its own, per scheme, which is a palette decision rather than a
    # markup one; see the report. `.active.item` in the settings is the same
    # question asked of `--accent-soft`.
    "color-contrast": "the ink on an accent fill is a palette decision",
}

failures: list[str] = []
axe_table: dict[str, dict] = {}


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say(f"reusing the build in {DIST.name}")
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


def serve() -> socketserver.TCPServer:
    say(f"serving {DIST} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
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


class Window:
    """One window, opened and seeded, with the measurements on it."""

    def __init__(self, browser: Browser, name: str, width: int, height: int,
                 agent: str, finger: bool, scheme: str, **extra: object) -> None:
        self.name = name
        self.finger = finger
        self.width = width
        self.height = height
        self.context = browser.new_context(
            viewport={"width": width, "height": height},
            user_agent=agent,
            has_touch=finger,
            is_mobile=finger,
            color_scheme=scheme,
            # This drive is about what a reader can reach and what the contrast
            # comes to, not about how a surface arrives. Motion is the one thing a
            # picture cannot hold still: a sheet caught half way through its slide
            # differs from the same sheet by more than half the pixels on the screen.
            # What the motion looks like is touch-move.py and motion.test.ts.
            #
            # A default rather than a fixture, because the window that is about
            # reduced motion already says so for itself; see `still` below.
            **{"reduced_motion": "reduce", **extra},  # type: ignore[arg-type]
        )
        self.page = self.context.new_page()
        self.page.set_default_timeout(9000)
        # The caret blinks, so the picture of it depends on the millisecond the shot
        # was taken at and nothing else; see settling.py.
        self.page.add_init_script(HIDE_CARET)
        self.listen()
        # Its own patience, because this machine runs more than one suite at a
        # time: the page is a built bundle off a local file server and 9 seconds is
        # plenty until something else is compiling.
        self.page.goto(ORIGIN, wait_until="domcontentloaded", timeout=60000)
        self.page.wait_for_function("() => !!window.nibApp", timeout=25000)
        self.page.wait_for_function(
            "() => !!window.nibApp.workspace.activeSpace", timeout=25000
        )
        # Spare history entries, because Escape on a phone is also the back
        # gesture: the app pops one entry per layer it closes, and a window with
        # nothing behind it walks off the page and takes `window.nibApp` with it.
        self.page.evaluate(
            "() => { for (let i = 0; i < 24; i++) history.pushState({ spare: i }, '') }"
        )
        self.page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
        self.page.wait_for_timeout(200)
        say(f"[{name}] the space holds {len(self.page.evaluate(SEED))} files")
        self.page.wait_for_timeout(700)
        self.page.add_script_tag(path=str(AXE))
        self.page.wait_for_function("() => !!window.axe", timeout=20000)

    def listen(self) -> None:
        self.page.on("pageerror", lambda error: wrong(f"[{self.name}] page error: {error}"))
        self.page.on(
            "console",
            lambda message: wrong(f"[{self.name}] console error: {message.text}")
            if message.type == "error" and not any(one in message.text for one in TOLERATED)
            else None,
        )

    def close(self) -> None:
        self.context.close()

    # ── the three questions ──────────────────────────────────────────

    def shot(self, tag: str) -> None:
        """One picture, once the surface has stopped moving.

        Four things, which are the four `shell.py` needed: motion reduced and the
        caret hidden above, the page asked whether it has finished anything it
        declared, and then the same picture twice running - which catches what the
        page never declared at all, a face that arrived in between or an image
        decoding. See the Drives section of docs/conventions.md."""
        SHOTS.mkdir(parents=True, exist_ok=True)
        picture = steady(self.page, self.page.screenshot, say, f"[{self.name}] {tag}")
        (SHOTS / f"{self.name}-{tag}.png").write_bytes(picture)

    def axe(self, surface: str) -> dict:
        found = self.page.evaluate(AXE_RUN)
        counts = found["counts"]
        key = f"{self.name}/{surface}"
        axe_table[key] = found

        line = " ".join(f"{kind[0]}{counts[kind]}" for kind in
                        ("critical", "serious", "moderate", "minor"))
        say(f"[{self.name}] {surface:<18} axe {line}")

        left = 0
        for one in found["named"]:
            excused = KNOWN.get(one["id"])
            mark = f" - {excused}" if excused else ""
            say(f"      {one['impact']:<8} {one['id']} x{one['nodes']} {one['where']}{mark}")
            if not excused:
                left += one["nodes"]

        if left:
            wrong(f"[{self.name}] {surface}: {left} serious or critical")

        return found

    def rings(self, surface: str) -> None:
        """Every place the keyboard can be, and what says so. One press of Tab
        first, so the browser is in keyboard modality and `:focus-visible`
        answers the way it would for somebody navigating by key."""
        self.page.keyboard.press("Tab")
        self.page.wait_for_timeout(60)
        found = self.page.evaluate(RINGS)

        def answers(one: dict) -> bool:
            if one["ring"] or one["turned"] or one["haloed"] or one["lit"]:
                return True
            # The caret is the answer a box you type into has always given, and no
            # measurement of a stylesheet can see it.
            return bool(one["caret"])

        blind = [
            f"{one['tag']}.{one['cls']} {one['said']!r}"
            for one in found
            if one["keyed"] and not answers(one)
        ]
        if blind:
            wrong(f"[{self.name}] {surface}: nothing says the keyboard is here: {blind[:6]}")

        rings = sorted({one["ring"] for one in found if one["ring"]})
        if len(rings) > 1:
            wrong(f"[{self.name}] {surface}: more than one ring: {rings}")

        # What each kind of answer was given to, so a surface where the ring has
        # quietly become a halo shows up as a number rather than as a photograph.
        kinds = {
            "ring": sum(1 for one in found if one["ring"]),
            "border": sum(1 for one in found if one["turned"] and not one["ring"]),
            "caret only": sum(
                1
                for one in found
                if one["caret"]
                and not (one["ring"] or one["turned"] or one["haloed"] or one["lit"])
            ),
        }
        say(f"[{self.name}] {surface:<18} {len(found)} stops, {kinds}, ring {rings or ['-']}")

    def unnamed(self, surface: str) -> None:
        found = self.page.evaluate(UNNAMED)
        if found:
            wrong(f"[{self.name}] {surface}: controls with no name: {found[:8]}")

    def look(self, surface: str) -> None:
        """All three, and a photograph of what was measured."""
        self.axe(surface)
        self.unnamed(surface)
        self.rings(surface)
        self.shot(surface)


def press(window: Window, key: str, wait: int = 300) -> str:
    window.page.keyboard.press(key)
    window.page.wait_for_timeout(wait)
    return window.page.evaluate(WHERE)


def region(window: Window) -> str:
    return window.page.evaluate(
        "() => document.activeElement?.closest('[data-region]')?.dataset.region ?? '-'"
    )


def open_panel(window: Window) -> None:
    if not window.page.evaluate("() => !!window.nibApp.workspace.panel"):
        window.page.keyboard.press("Control+Shift+L")
        window.page.wait_for_timeout(450)


def into_tree(window: Window) -> bool:
    """The keyboard on a row of the file list.

    Ctrl+Shift+E is pressed only from outside the list, because inside it the same
    chord is the way back to the note - one key there and one key back, which is
    the whole point of it and which a drive that presses it twice undoes. Then Tab
    along to the tree: the bookmarks above it are a composite of their own."""
    page = window.page
    if region(window) != "list":
        page.keyboard.press("Control+Shift+E")
        page.wait_for_timeout(550)

    for _ in range(4):
        if page.evaluate("() => !!document.activeElement?.matches('.row[data-path]')"):
            return True
        page.keyboard.press("Tab")
        page.wait_for_timeout(220)

    return page.evaluate("() => !!document.activeElement?.matches('.row[data-path]')")


# ── The surfaces ──────────────────────────────────────────────────────────────


def opens(window: Window, how: str, wait: int = 600) -> bool:
    """Runs a line of JavaScript that puts something on screen. False where the
    build has no handle for it, so a surface the drive cannot reach is skipped
    and said to be rather than silently missed."""
    try:
        window.page.evaluate(how)
    except Exception as error:  # noqa: BLE001 - a surface this build has not got
        say(f"[{window.name}] skipped: {str(error).splitlines()[0][:90]}")
        return False

    window.page.wait_for_timeout(wait)
    return True


# Whether anything is still over the note. Read off the page rather than off the
# overlay stack, which the app does not hand a drive: what matters here is what a
# reader would still be walking through, and that is the page.
STILL_UP = """
() => {
  const up = [...document.querySelectorAll(
    '[role=dialog], [role=menu], .nib-screen, .sheet, .palette',
  )].filter((node) => node.getClientRects().length > 0)

  return up.map((node) => (node.className ?? '').toString().split(' ')[0] || node.tagName)
}
"""


def shut(window: Window, times: int = 5) -> None:
    """Escape, through the stack, newest first, and then the note has it."""
    for _ in range(times):
        if not window.page.evaluate(STILL_UP):
            return
        window.page.keyboard.press("Escape")
        window.page.wait_for_timeout(320)

    left = window.page.evaluate(STILL_UP)
    if left:
        wrong(f"[{window.name}] {times} presses of Escape left these up: {left}")


def layer(window: Window, surface: str, how: str, wait: int = 600) -> None:
    """One layer: opened, measured, photographed, and closed with Escape.

    The layer is waited for before it is measured. The settings sheet is fetched the
    first time it is asked for rather than carried into the first paint, so the store
    saying it is open is a moment ahead of it being on screen; a walk that measured
    the gap would find nothing wrong with a surface that is not there. See
    surfaces.svelte.ts."""
    if not opens(window, how, wait):
        return

    try:
        window.page.wait_for_selector(
            "[role=dialog], [role=menu], .nib-screen, .sheet, .palette",
            state="visible",
            timeout=15000,
        )
    except Exception:  # noqa: BLE001 - said below rather than walked out on
        say(f"[{window.name}] {surface}: nothing came up to look at")
        return

    window.look(surface)
    shut(window)


def drive(browser: Browser, name: str, width: int, height: int,
          agent: str, finger: bool, scheme: str) -> None:
    window = Window(browser, name, width, height, agent, finger, scheme)
    page = window.page

    try:
        say(f"[{name}] --- the shell ---")
        say(f"[{name}] landmarks: {page.evaluate(LANDMARKS)}")
        say(f"[{name}] headings:  {page.evaluate(HEADINGS)}")
        window.look("launch")

        # ── The four panels, each on its own chord ────────────────────────
        for chord, panel in [
            ("Control+Shift+E", "files"),
            ("Control+Shift+O", "outline"),
            ("Control+Shift+F", "search"),
            ("Control+Shift+B", "links"),
        ]:
            page.keyboard.press(chord)
            page.wait_for_timeout(600)
            showing = page.evaluate("() => window.nibApp.workspace.panel")
            if showing is None:
                say(f"[{name}] {panel}: the chord opened nothing")
                continue
            window.look(f"panel-{panel}")

        # ── The layers ───────────────────────────────────────────────────
        say(f"[{name}] --- the layers ---")
        open_panel(window)

        page.keyboard.press("Control+P")
        page.wait_for_timeout(600)
        window.look("palette")
        page.keyboard.type(">", delay=40)
        page.wait_for_timeout(500)
        window.look("palette-commands")
        shut(window)

        # A row's own menu, on the key a keyboard has for it.
        if not into_tree(window):
            say(f"[{name}] row-menu: the keyboard never reached a row of the tree")
        page.keyboard.press("Shift+F10")
        page.wait_for_timeout(600)
        if page.evaluate("() => !!document.querySelector('[role=menu]')"):
            window.look("row-menu")
        else:
            say(f"[{name}] row-menu: Shift+F10 opened nothing")
        shut(window)

        page.keyboard.press("Control+Shift+Space")
        page.wait_for_timeout(650)
        if page.evaluate("() => !!document.querySelector('[role=menu]')"):
            window.look("spaces")
        shut(window)

        layer(window, "settings", "() => window.nibApp.settings.show()")
        layer(window, "shortcuts", "() => window.nibApp.settings.show('shortcuts')")
        layer(window, "appearance", "() => window.nibApp.settings.show('appearance')")
        layer(
            window,
            "themes",
            "() => { window.nibApp.settings.show('appearance'); window.nibApp.themeStore.open = true }",
            900,
        )
        layer(
            window,
            "icons",
            """() => {
              const ws = window.nibApp.workspace
              const note = ws.notes.find((one) => one.name.startsWith('Kestrel'))
              window.nibApp.iconChoice.file(note?.path ?? ws.notes[0].path)
            }""",
        )
        layer(window, "import", "() => (window.nibApp.importing.open = true)")
        layer(
            window,
            "share",
            """async () => {
              const ws = window.nibApp.workspace
              await window.nibApp.share.show(ws.activeSpaceId, null)
            }""",
            900,
        )

        # ── The three surfaces that are read rather than stood on ─────────
        say(f"[{name}] --- what is read ---")
        if opens(window, "() => window.nibApp.workspace.toggleReading()", 900):
            window.look("reading")
            say(f"[{name}] reading headings: {page.evaluate(HEADINGS)}")
            say(f"[{name}] reading landmarks: {page.evaluate(LANDMARKS)}")
            opens(window, "() => window.nibApp.workspace.toggleReading()", 600)

        if opens(window, "() => void window.nibApp.workspace.createCanvas()", 1400):
            # A canvas is made and then named, and the plane is not on screen until
            # the name is committed: Escape leaves the row as it is and gets on. Then
            # the plane itself, which is fetched the first time a tab of its kind is
            # opened rather than carried into the first paint; see surfaces.svelte.ts.
            page.keyboard.press("Escape")
            try:
                page.wait_for_selector("[role=application]", state="visible", timeout=20000)
            except Exception:  # noqa: BLE001 - said below rather than walked out on
                pass
            page.wait_for_timeout(1200)
            if page.evaluate("() => !!document.querySelector('[role=application]')"):
                window.look("canvas")
                said = page.evaluate(
                    "() => document.querySelector('[role=application]')"
                    "?.getAttribute('aria-label')"
                )
                say(f"[{name}] the plane says: {said!r}")
            else:
                say(f"[{name}] canvas: the plane never came up")

        window.close()
    except Exception:
        window.close()
        raise


# ── The keyboard walk, and the four things about the window ───────────────────


def walk(browser: Browser) -> None:
    """The whole model in docs/keyboard.md, on one window, with nothing but keys."""
    window = Window(browser, "walk", 1440, 900, DESKTOP_AGENT, False, "dark")
    page = window.page

    try:
        open_panel(window)
        page.evaluate(
            "() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()"
        )
        page.wait_for_timeout(250)

        say("--- F6 round the regions and back ---")
        forwards = []
        for _ in range(9):
            press(window, "F6")
            forwards.append(region(window))
        say(f"    forwards: {' -> '.join(forwards)}")
        if len(set(forwards)) < 4:
            wrong(f"F6 walked {len(set(forwards))} regions: {forwards}")
        if forwards[0] not in forwards[1:]:
            wrong("F6 never came back round to where it started")

        backwards = []
        for _ in range(4):
            press(window, "Shift+F6")
            backwards.append(region(window))
        say(f"    backwards: {' -> '.join(backwards)}")
        if backwards == forwards[:4]:
            wrong("Shift+F6 walks the same way round as F6")

        say("--- Tab stops once per list, not once per row ---")
        page.keyboard.press("Control+Shift+E")
        page.wait_for_timeout(600)
        stops = page.evaluate(
            "() => document.querySelectorAll('[data-region=\"list\"] [tabindex=\"0\"]').length"
        )
        say(f"    the panel holds {stops} tab stops")
        if stops > 4:
            wrong(f"the open panel puts {stops} things in the tab sequence")

        say("--- the arrows, the ends and a spelled name ---")
        if not into_tree(window):
            wrong("the keyboard never reached a row of the file list")

        landed = []
        for key in ["ArrowDown", "ArrowDown", "ArrowUp", "End", "Home"]:
            landed.append(f"{key}={press(window, key).split(' | ')[-1]}")
        say(f"    {'  '.join(landed)}")
        if len({one.split('=')[1] for one in landed}) < 3:
            wrong(f"the arrows moved nowhere in the list: {landed}")

        page.keyboard.type("re", delay=70)
        page.wait_for_timeout(400)
        spelled = page.evaluate(WHERE)
        say(f"    typed 're' -> {spelled}")
        if "re" not in spelled.lower():
            wrong(f"spelling a name landed on {spelled}")

        say("--- every layer hands the keyboard back to what opened it ---")
        for chord, what in [
            ("Control+P", "the palette"),
            ("Control+Shift+Slash", "the shortcuts pane"),
            ("Control+Comma", "the settings"),
            ("Control+Shift+Space", "the space switcher"),
        ]:
            into_tree(window)
            from_here = page.evaluate(WHERE)

            page.keyboard.press(chord)
            page.wait_for_timeout(700)
            inside = page.evaluate(WHERE)
            depth = page.evaluate("() => window.nibApp.overlays?.depth ?? -1")

            page.keyboard.press("Tab")
            page.wait_for_timeout(250)
            held = page.evaluate(
                "() => !!document.activeElement?.closest("
                "'[role=dialog], .sheet, .panel, .palette, [role=menu]')"
            )
            if not held:
                wrong(f"{what}: Tab walked out of it")

            page.keyboard.press("Escape")
            page.wait_for_timeout(800)
            back = page.evaluate(WHERE)
            say(f"    {chord:<20} {what}: depth {depth}, {inside.split(' | ')[1]}")
            say(f"        Escape -> {back.split(' | ')[1]} (opened from {from_here.split(' | ')[1]})")

            if page.evaluate("() => document.activeElement === document.body"):
                wrong(f"{what}: Escape left the keyboard on nothing")

        window.close()
    except Exception:
        window.close()
        raise


def extras(browser: Browser) -> None:
    """Zoom, contrast, movement and a thumb's target."""
    walk(browser)

    say("--- 200% zoom, which is half the room ---")
    window = Window(browser, "zoom", 720, 450, DESKTOP_AGENT, False, "light")
    try:
        open_panel(window)
        window.page.wait_for_timeout(500)
        found = window.page.evaluate(CLIPPED)
        say(f"    sideways {found['sideways']}px, off the side: {found['over']}")
        window.shot("zoom-200")
        if found["sideways"] > 1:
            wrong(f"at 200% the window scrolls {found['sideways']}px sideways")
        if found["over"]:
            wrong(f"at 200% these are off the side of it: {found['over']}")
        window.axe("zoom-200")
    finally:
        window.close()

    say("--- a system asking for more contrast ---")
    window = Window(
        browser, "contrast", 1440, 900, DESKTOP_AGENT, False, "dark", contrast="more"
    )
    try:
        open_panel(window)
        window.page.wait_for_timeout(500)
        window.look("contrast-more")
    finally:
        window.close()

    say("--- a system asking for less movement ---")
    window = Window(
        browser, "still", 1440, 900, DESKTOP_AGENT, False, "light", reduced_motion="reduce"
    )
    try:
        found = window.page.evaluate(STILL)
        say(f"    asked {found['asked']}, tokens {found['said']}")
        if not found["asked"]:
            wrong("the window was not asked for less movement")
        moving = [one for one, value in found["said"].items() if value not in ("0ms", "0s", "0")]
        if moving:
            wrong(f"these durations still move under reduced motion: {moving}")
        window.shot("reduced-motion")
    finally:
        window.close()

    say("--- every target a thumb has to hit ---")
    window = Window(browser, "thumb", 390, 844, PHONE_AGENT, True, "light")
    try:
        open_panel(window)
        window.page.wait_for_timeout(600)
        found = window.page.evaluate(TARGETS)
        say(f"    the floor is {found['floor']}px; under it: {found['small'] or 'nothing'}")
        window.shot("touch-targets")

        # The one that is under it on purpose, and says so where it is drawn: the
        # chevron that folds a block lives in the gutter beside the writing column,
        # which on a phone is the column's own padding and is narrower than the
        # floor. It is a thumb's height; making it a thumb's width as well would put
        # an invisible button over the first characters of every line. See
        # `.nib-fold-hinge` under `@media (hover: none)` in editor.css.
        left = [one for one in found["small"] if "nib-fold-hinge" not in one]
        if left:
            wrong(f"under the touch floor: {left[:8]}")
    finally:
        window.close()


def main() -> int:
    if not AXE.exists():
        raise SystemExit(f"axe-core is not here: {AXE}. Run pnpm install.")

    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                # One window going wrong is one window's worth of findings lost,
                # not the run: the other three still have something to say.
                for one in WINDOWS:
                    say(f"=== {one[0]} ===")
                    try:
                        drive(browser, *one)
                    except Exception as error:  # noqa: BLE001
                        wrong(f"[{one[0]}] the walk stopped: {str(error).splitlines()[0][:120]}")

                say("=== the window itself ===")
                try:
                    extras(browser)
                except Exception as error:  # noqa: BLE001
                    wrong(f"[extras] stopped: {str(error).splitlines()[0][:120]}")
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    SHOTS.mkdir(parents=True, exist_ok=True)
    (SHOTS / "axe.json").write_text(json.dumps(axe_table, indent=2), encoding="utf-8")
    say(f"axe counts in {SHOTS / 'axe.json'}")

    if failures:
        print(f"\nFAILED ({len(failures)})", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nevery surface answers a keyboard, and axe finds nothing serious", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
