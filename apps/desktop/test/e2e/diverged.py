"""Sync v2's one question, photographed: a note two devices rewrote while apart, held,
with the question over it once it is in front.

The engine is the fake one the effect tests use (sync2/fake-engine.svelte.ts), which a
drivable build puts on `window.nibApp.sync2`; everything else is the built app. What it
photographs and checks:

  - the sheet in light and dark, at a desktop's width and a phone's, and in Arabic,
    where the interface reads the other way and this device's card is on the right;
  - a canvas held, with the two versions of its contested cards drawn;
  - the keyboard on the newer version's Keep, Escape changing nothing, and the mark
    the held note wears on its row and its tab once the question is closed;
  - the toast a note that came back says itself in;
  - and axe-core on the sheet, which may report nothing serious that access.py does not
    already excuse.

Serves the built web app and drives it in Chromium, headless. The build
has to be one a drive may steer - `--mode drive` - or `window.nibApp` is not there.

Run it from the repository root:

    python apps/desktop/test/e2e/diverged.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/diverged/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from settling import HIDE_CARET, steady

import harness
from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP

AXE = APP / "node_modules" / "axe-core" / "axe.min.js"


DESKTOP = {"width": 1280, "height": 820}
PHONE = {"width": 390, "height": 844}
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

# The rules access.py already reports and says why; see KNOWN there.
KNOWN = {
    "scrollable-region-focusable": "the note is reached by being written in",
    "color-contrast": "the ink on an accent fill is a palette decision",
}

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nWe meet at noon on Friday, at the old station.\\n', root)
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === 'Plan.md')
  await ws.openEntry(note.path, { activate: true })
  if (ws.panel !== 'tree') ws.showPanel('tree')
  return note.path
}
"""

CANVAS = """
async () => {
  const ws = window.nibApp.workspace
  // Made and opened in front, the way the New canvas row makes one.
  await ws.createCanvas(ws.activeSpace.root, 'Launch')
  return ws.active.path
}
"""

# One held note, the way the engine hands it over, for whatever is in front.
HOLD = """
([path, name, kind, rtl]) => {
  const hour = 60 * 60 * 1000
  const now = Date.now()
  const card = (text, colour) => JSON.stringify({
    nodes: [
      { id: 'a', type: 'text', text: '# Launch', x: 0, y: 0, width: 220, height: 70 },
      { id: 'b', type: 'text', text, x: 0, y: 110, width: 220, height: 110, color: colour },
    ],
    edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }],
  })
  // Marked by the words that differ, the way `excerpt` in @nib/sync-core marks them.
  const marked = (text, words) => ({
    text,
    marks: words.map((word) => [text.indexOf(word), text.indexOf(word) + word.length]),
  })
  const words = rtl
    ? {
        mine: marked('نلتقي عند الظهر يوم الجمعة في المحطة القديمة.', ['عند الظهر', 'الجمعة', 'القديمة']),
        theirs: marked('نلتقي في الواحدة يوم السبت في المحطة الجديدة.', ['في الواحدة', 'السبت', 'الجديدة']),
      }
    : {
        mine: marked('We meet at noon on Friday, at the old station.', ['noon', 'Friday', 'old']),
        theirs: marked('We meet at one on Saturday, at the new station by the river.', ['one', 'Saturday', 'new', 'by the river']),
      }
  const side = (who, at) => ({
    device: who === 'mine' ? 'Laptop' : 'iPhone',
    at: now - at * hour,
    excerpt: words[who],
    ...(kind === 'canvas'
      ? { plane: card(who === 'mine' ? 'Ship on Friday, with the new prices.' : 'Ship next week; the prices stay.', who === 'mine' ? '4' : '5') }
      : {}),
  })
  window.__held = window.nibApp.sync2.connectFake([
    { id: 'held', path, name, mine: side('mine', 2), theirs: side('theirs', 1) },
  ])
}
"""

axe_table: dict[str, dict] = {}


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    (SHOTS / f"{name}.png").write_bytes(steady(page, page.screenshot, say, name))
    say(f"shot {name}.png")


def axe(page: Page, name: str) -> None:
    """axe-core on the page with the sheet up: nothing serious or critical that
    access.py does not already excuse by name."""
    DRIVE.inject(page, AXE)
    found = page.evaluate(
        """async () => {
          const found = await window.axe.run(document, { resultTypes: ['violations'] })
          const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 }
          const named = []
          for (const one of found.violations) {
            const impact = one.impact ?? 'minor'
            counts[impact] = (counts[impact] ?? 0) + one.nodes.length
            named.push({ id: one.id, impact, nodes: one.nodes.length,
              where: one.nodes.slice(0, 3).map((node) => node.target.join(' ')) })
          }
          return { counts, named }
        }"""
    )
    axe_table[name] = found
    say(f"axe on {name}: {json.dumps(found['counts'])}")
    for one in found["named"]:
        if one["impact"] in ("serious", "critical") and one["id"] not in KNOWN:
            wrong(f"axe on {name}: {one['impact']} {one['id']} x{one['nodes']} {one['where']}")


def window(browser: Browser, scheme: str, size: dict, phone: bool = False, language: str = "") -> Page:
    context = browser.new_context(
        viewport=size,
        color_scheme=scheme,
        reduced_motion="reduce",
        has_touch=phone,
        is_mobile=phone,
        **({"user_agent": PHONE_AGENT} if phone else {}),
    )
    page = context.new_page()
    page.add_init_script(HIDE_CARET)
    if language:
        page.add_init_script(f"localStorage.setItem('nib:language', {json.dumps(language)})")
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error" and "favicon" not in message.text
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded", timeout=60000)
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "the app", 40)
    wait_for(page, "window.nibApp.sync2", "the fake engine")
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    return page


def held_up(page: Page, path: str, name: str, kind: str = "note", rtl: bool = False) -> None:
    page.evaluate(HOLD, [path, name, kind, rtl])
    wait_for(page, "document.querySelector('[role=dialog] .sides')", f"the question about {name}")


def sheet(page: Page, name: str, phone: bool = False) -> None:
    """The plain case: a note held, in front, the question over it, photographed."""
    path = page.evaluate(SEED)
    if phone:
        # The list is a drawer over the note on a phone, and the question waits for it.
        page.evaluate("() => window.nibApp.workspace.closePanel()")
    held_up(page, path, "Plan")
    shot(page, name)
    axe(page, name)


def desktop(browser: Browser) -> None:
    page = window(browser, "light", DESKTOP)
    path = page.evaluate(SEED)
    wait_for(page, "document.querySelector('.cm-content')", "the editor")
    held_up(page, path, "Plan")
    shot(page, "desktop-light")
    axe(page, "desktop-light")

    # The keyboard is on the newer version: the other device wrote an hour after this one.
    focused = page.evaluate(
        "() => [...document.querySelectorAll('.keep')].indexOf(document.activeElement)"
    )
    if focused != 1:
        wrong(f"the keyboard is not on the newer version's Keep: {focused}")
    page.keyboard.press("ArrowLeft")
    moved = page.evaluate(
        "() => [...document.querySelectorAll('.keep')].indexOf(document.activeElement)"
    )
    if moved != 0:
        wrong(f"Left did not go to the other card: {moved}")
    shot(page, "desktop-light-keyboard")

    # Escape: nothing answered, and the note wears the mark on its row and its tab.
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('[role=dialog] .sides')", "the question to close")
    answered = page.evaluate("() => window.__held.engine.held.answered")
    if answered:
        wrong(f"Escape answered: {answered}")
    marks = page.evaluate(
        """() => ({
          row: !!document.querySelector('.row[data-path$="/Plan.md"] [aria-label="Waiting for you"]'),
          tab: !!document.querySelector('.tab [aria-label="Waiting for you"]'),
        })"""
    )
    say(f"the held note's marks: {json.dumps(marks)}")
    if not marks["row"] or not marks["tab"]:
        wrong(f"the held note does not wear its mark on both its row and its tab: {marks}")
    shot(page, "desktop-light-marked")

    # A note this device deleted that another was writing in.
    page.evaluate(
        "() => window.__held.engine.emit('resurrected', { id: 'held', name: 'Plan', device: 'iPhone' })"
    )
    wait_for(page, "[...document.querySelectorAll('.toast p')].some((one) => one.textContent.includes('is back'))", "the toast")
    # Held under the pointer, as a reader half way through it holds it, so the shot is
    # not raced by its six seconds.
    page.locator(".toast", has_text="is back").hover()
    shot(page, "desktop-light-toast")

    page.evaluate("() => { window.__held.stop() }")
    page.context.close()


def dark(browser: Browser) -> None:
    page = window(browser, "dark", DESKTOP)
    sheet(page, "desktop-dark")
    page.context.close()


def phone(browser: Browser) -> None:
    for scheme in ("light", "dark"):
        page = window(browser, scheme, PHONE, phone=True)
        sheet(page, f"phone-{scheme}", phone=True)
        stacked = page.evaluate(
            """() => {
              const [one, two] = [...document.querySelectorAll('.side')].map((card) => card.getBoundingClientRect())
              return two.top >= one.bottom
            }"""
        )
        if not stacked:
            wrong(f"phone-{scheme}: the two cards are not one over the other")
        page.context.close()


def arabic(browser: Browser) -> None:
    page = window(browser, "light", DESKTOP, language="ar")
    wait_for(page, "document.documentElement.dir === 'rtl'", "the interface reading right to left")
    path = page.evaluate(SEED)
    held_up(page, path, "Plan", rtl=True)
    shot(page, "desktop-arabic")
    axe(page, "desktop-arabic")
    order = page.evaluate(
        """() => {
          const [mine, theirs] = [...document.querySelectorAll('.side')].map((card) => card.getBoundingClientRect())
          return { mine: mine.left, theirs: theirs.left }
        }"""
    )
    if order["mine"] <= order["theirs"]:
        wrong(f"arabic: this device's card is not on the right: {order}")
    page.context.close()


def canvas(browser: Browser) -> None:
    page = window(browser, "light", DESKTOP)
    page.evaluate(SEED)
    path = page.evaluate(CANVAS)
    held_up(page, path, "Launch", kind="canvas")
    wait_for(page, "document.querySelectorAll('.side .plane svg').length === 2", "both cards drawn")
    shot(page, "desktop-canvas")
    page.context.close()


def main() -> int:
    if not AXE.exists():
        raise SystemExit(f"axe-core is not here: {AXE}. Run pnpm install.")
    with DRIVE.session() as browser:
        desktop(browser)
        dark(browser)
        phone(browser)
        arabic(browser)
        canvas(browser)

    (SHOTS / "axe.json").write_text(json.dumps(axe_table, indent=2), encoding="utf-8")

    return DRIVE.verdict("the question comes up over the held note, reads either way, and says nothing it need not")


if __name__ == "__main__":
    raise SystemExit(main())
