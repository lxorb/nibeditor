"""How big the layers in the middle of the window are, at the windows people have.

Emil, 2026-10-01, on a window of about 2000 by 1125: "settings have a strange size for
this screen size". The sheet was 56rem wide and 76vh tall, so a big window made it
taller and not wider - a portrait slab with Appearance's eight rows at the top of it -
and the Frame control broke "nibeditor's own" over two lines.

So this opens Settings at four windows (1280x720, 1920x1080, 2560x1440, 2000x1125) at
three system scales each (100, 125 and 150 per cent, which is a window of the same
pixels with fewer CSS pixels in it), walks every pane, and fails on:

  - a pane that makes the sheet a different size from the one before it;
  - a sheet taller than `--screen-tall`, or taller than it is wide where the window is
    wider than it is tall;
  - a sheet closer to the window's edge than `--screen-gutter`;
  - a control's words - a segmented half, a key, a button, a setting's name, a pane in
    the list - on more than one line, or cut off;
  - the same, for the other layers in the middle of the window: the palette, the
    theme picker, a question, the sync question, the icon picker, and
    the theme store, which has to stand inside the settings it is opened over.

With `--shots`, it photographs Settings and those layers at 1280x720 and 2000x1125 in
light and dark too.

From the repository root; the harness builds the app with its handle on the page the
first time and serves it (see harness.py):

    python apps/desktop/test/e2e/modal-size.py [--shots]

Screenshots go beside this file under `shots/modal-size/`, which is ignored.
"""

from __future__ import annotations

import sys

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

#: The windows, in the screen's own pixels.
WINDOWS = [(1280, 720), (1920, 1080), (2560, 1440), (2000, 1125)]
#: The system's scale: the same window holds fewer CSS pixels at 150 per cent.
SCALES = [1, 1.25, 1.5]
#: The two the shots are taken at.
PHOTOGRAPHED = [(1280, 720), (2000, 1125)]

SHOTS_TOO = "--shots" in sys.argv

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Plan\\n\\nWe meet at noon on Friday, at the old station.\\n', ws.activeSpace.root)
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === 'Plan.md')
  await ws.openEntry(note.path, { activate: true })
  return note.path
}
"""

#: Every piece of words in a layer that is a control or names one, and how many lines
#: each takes: a word broken onto a second line, or cut off at the edge, is what this
#: drive is about. Counted off the text's own boxes, so a padded button with one line
#: of words in it is one line whatever its height.
WRAPPED = """
(selector) => {
  const root = document.querySelector(selector)
  if (!root) return { missing: true, wrapped: [] }

  const LABELS = [
    'button',
    '[role="switch"] .name .what',
    '.nib-setting .name .what',
    '.nib-segmented button',
    '.key',
    '.nib-row-label',
    '.nib-button',
    '.nib-action',
    'select',
    'kbd',
  ].join(',')

  // Per run of words rather than per element: a card's name and the letter in its
  // corner are two runs on two lines by design, and one name on two lines is a wrap.
  const lines = (element) => {
    let most = 0
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const tops = []
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue
        if (!tops.some((top) => Math.abs(top - rect.top) < rect.height / 2)) tops.push(rect.top)
      }
      most = Math.max(most, tops.length)
    }
    return most
  }

  // A row that is itself a button holds a name and a control, each of which is
  // judged on its own; the row is allowed its two lines of name and value.
  const isRow = (element) =>
    element.matches('button.setting, button.nib-setting, .nib-row:has(.nib-row-label)')

  const wrapped = []
  for (const element of root.querySelectorAll(LABELS)) {
    if (!element.offsetParent || isRow(element)) continue
    const text = element.textContent.trim().replace(/\\s+/g, ' ')
    if (!text) continue
    const count = lines(element)
    const cut = element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflow !== 'visible'
    if (count > 1 || cut) wrapped.push(`${text.slice(0, 40)} (${cut ? 'cut off' : count + ' lines'})`)
  }

  return { missing: false, wrapped }
}
"""

#: Where the layer is and how big, with the window and the tokens it is held to.
BOX = """
(selector) => {
  const root = document.querySelector(selector)
  if (!root) return null
  const box = root.getBoundingClientRect()
  const style = getComputedStyle(document.documentElement)
  const rem = parseFloat(style.fontSize)
  const length = (name) => {
    const probe = document.createElement('div')
    probe.style.position = 'absolute'
    probe.style.width = `var(${name})`
    document.body.append(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  }
  return {
    x: box.x, y: box.y, width: box.width, height: box.height,
    vw: innerWidth, vh: innerHeight,
    tall: length('--screen-tall') || 42 * rem,
    gutter: length('--screen-gutter') || 24,
  }
}
"""

SETTINGS = '[role="dialog"][aria-label="Settings"]'

#: Appearance's Frame row, which only a desktop build draws: a browser tab has no frame
#: of its own. Its two words are the longest a segmented setting holds in English and
#: the ones Emil saw broken, so where the build leaves it out the Mode row stands in for
#: it, copied with the component's own classes and given Frame's two halves.
FRAME = """
() => {
  const body = document.querySelector('[role="dialog"][aria-label="Settings"] .body')
  const rows = [...body.querySelectorAll('.nib-setting')]
  if (rows.some((row) => row.textContent.includes('nibeditor’s own'))) return 'real'
  const mode = rows.find((row) => row.querySelector('.nib-segmented'))
  if (!mode) return null
  const row = mode.cloneNode(true)
  row.dataset.stand = 'frame'
  // The sliding surface is the action's, which a copy does not have: without it the
  // chosen half draws its own, which is what a control without the action looks like.
  row.querySelector('.nib-segmented-thumb')?.remove()
  row.querySelector('.nib-segmented')?.classList.remove('has-thumb')
  row.querySelector('.name .what').firstChild.textContent = 'Frame'
  const halves = [...row.querySelectorAll('.nib-segmented button')]
  halves.slice(2).forEach((one) => one.remove())
  halves[0].textContent = 'nibeditor’s own'
  halves[1].textContent = 'The system’s'
  mode.after(row)
  return 'stood in'
}
"""

#: Whether the list of panes has to be scrolled to reach its last row.
NAV_SCROLLS = """
() => {
  const nav = document.querySelector('[role="dialog"][aria-label="Settings"] nav')
  return nav ? nav.scrollHeight > nav.clientHeight + 1 : null
}
"""

PANES = """
() => [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] nav .item')]
  .map((one) => one.textContent.trim())
"""


def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)


def inside(name: str, box: dict | None) -> None:
    """The layer is in the window with the gutter round it."""
    if box is None:
        wrong(f"{name}: not there")
        return
    room = box["gutter"] - 1
    check(
        f"{name}: inside the window with the gutter "
        f"({box['x']:.0f},{box['y']:.0f} {box['width']:.0f}x{box['height']:.0f} in {box['vw']}x{box['vh']})",
        box["x"] >= room
        and box["y"] >= room
        and box["x"] + box["width"] <= box["vw"] - room
        and box["y"] + box["height"] <= box["vh"] - room,
    )


def unwrapped(page, name: str, selector: str) -> None:
    said = page.evaluate(WRAPPED, selector)
    if said["missing"]:
        wrong(f"{name}: not there")
        return
    check(f"{name}: no control's words wrap{': ' + '; '.join(said['wrapped']) if said['wrapped'] else ''}", not said["wrapped"])


def settings(page, label: str) -> None:
    """Every pane, one after another: the same size, and nothing in any of them on two
    lines."""
    page.evaluate("() => window.nibApp.settings.show('general')")
    page.wait_for_selector(SETTINGS)
    quiet(page)

    first = page.evaluate(BOX, SETTINGS)
    inside(f"[{label}] settings", first)
    if first:
        check(
            f"[{label}] settings is no taller than --screen-tall ({first['height']:.0f} <= {first['tall']:.0f})",
            first["height"] <= first["tall"] + 1,
        )
        if first["vw"] > first["vh"]:
            check(
                f"[{label}] settings is wider than tall ({first['width']:.0f}x{first['height']:.0f})",
                first["width"] > first["height"],
            )

    sizes = set()
    for pane in page.evaluate(PANES):
        page.locator(f"{SETTINGS} nav .item", has_text=pane).first.click()
        quiet(page, 40)
        box = page.evaluate(BOX, SETTINGS)
        if box:
            sizes.add((round(box["width"]), round(box["height"])))
        said = page.evaluate(WRAPPED, f"{SETTINGS} .body")
        if said["wrapped"]:
            wrong(f"[{label}] {pane}: words wrap: {'; '.join(said['wrapped'])}")

    check(f"[{label}] one size across every pane {sorted(sizes)}", len(sizes) == 1)
    unwrapped(page, f"[{label}] the list of panes", f"{SETTINGS} nav")
    if first and first["vh"] >= 720:
        check(f"[{label}] the list of panes fits without scrolling", page.evaluate(NAV_SCROLLS) is False)

    page.locator(f"{SETTINGS} nav .item", has_text="Appearance").first.click()
    quiet(page, 40)
    frame = page.evaluate(FRAME)
    if frame is None:
        wrong(f"[{label}] Appearance has no segmented row to stand in for Frame")
    else:
        unwrapped(page, f"[{label}] Frame ({frame})", f"{SETTINGS} .body")
    page.keyboard.press("Escape")
    page.wait_for_selector(SETTINGS, state="detached")


def palette(page, label: str, photograph: str | None) -> None:
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector('input[role="combobox"]')
    quiet(page)
    selector = '[role="dialog"]:has(input[role="combobox"])'
    inside(f"[{label}] palette", page.evaluate(BOX, selector))
    if photograph:
        shot(page, f"{photograph}-palette")
    page.keyboard.press("Escape")
    page.wait_for_selector('input[role="combobox"]', state="detached")


def picker(page, label: str, photograph: str | None) -> None:
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector('input[role="combobox"]')
    page.keyboard.type("Switch theme")
    page.wait_for_timeout(150)
    page.keyboard.press("Enter")
    selector = '[role="dialog"][aria-label="Themes"]'
    page.wait_for_selector(selector)
    quiet(page)
    inside(f"[{label}] theme picker", page.evaluate(BOX, selector))
    unwrapped(page, f"[{label}] theme picker", selector)
    if photograph:
        shot(page, f"{photograph}-themes")
    page.keyboard.press("Escape")
    page.wait_for_selector(selector, state="detached")


def question(page, label: str, photograph: str | None) -> None:
    """Convert syntax asks where, in the one small modal every question is asked in."""
    page.keyboard.press("Control+Shift+P")
    page.wait_for_selector('input[role="combobox"]')
    page.keyboard.type("Convert syntax")
    page.wait_for_timeout(150)
    page.keyboard.press("Enter")
    selector = '[role="dialog"]:has(form)'
    page.wait_for_selector(selector)
    quiet(page)
    inside(f"[{label}] question", page.evaluate(BOX, selector))
    unwrapped(page, f"[{label}] question", selector)
    if photograph:
        shot(page, f"{photograph}-question")
    page.keyboard.press("Escape")
    page.wait_for_selector(selector, state="detached")


def store(page, label: str, photograph: str | None) -> None:
    """The theme store over the settings: a gutter inside them on every side, and the
    same middle, so the sheet underneath is still visibly there."""
    page.evaluate("() => { window.nibApp.settings.show('appearance'); window.nibApp.themeStore.open = true }")
    selector = '[role="dialog"][aria-label="Themes"]'
    page.wait_for_selector(selector)
    quiet(page)
    over = page.evaluate(BOX, selector)
    under = page.evaluate(BOX, SETTINGS)
    inside(f"[{label}] theme store", over)
    if over and under:
        check(
            f"[{label}] the theme store stands inside the settings",
            over["x"] > under["x"] + 8
            and over["y"] > under["y"] + 8
            and over["x"] + over["width"] < under["x"] + under["width"] - 8
            and over["y"] + over["height"] < under["y"] + under["height"] - 8,
        )
    if photograph:
        shot(page, f"{photograph}-store")
    page.evaluate("() => { window.nibApp.themeStore.open = false; window.nibApp.settings.open = false }")
    page.wait_for_selector(SETTINGS, state="detached")


def icons(page, path: str, label: str, photograph: str | None) -> None:
    page.evaluate("(path) => window.nibApp.iconChoice.file(path)", path)
    selector = '[role="dialog"][aria-label="Choose an icon"]'
    page.wait_for_selector(selector)
    quiet(page)
    inside(f"[{label}] icon picker", page.evaluate(BOX, selector))
    unwrapped(page, f"[{label}] icon picker", selector)
    if photograph:
        shot(page, f"{photograph}-icons")
    page.evaluate("() => window.nibApp.iconChoice.close()")
    page.wait_for_selector(selector, state="detached")


HOLD = """
(path) => {
  const hour = 60 * 60 * 1000
  const now = Date.now()
  const marked = (text, words) => ({
    text,
    marks: words.map((word) => [text.indexOf(word), text.indexOf(word) + word.length]),
  })
  const side = (who, at, excerpt) => ({ device: who === 'mine' ? 'Laptop' : 'iPhone', at: now - at * hour, excerpt })
  window.__held = window.nibApp.sync2.connectFake([
    {
      id: 'held',
      path,
      name: 'Plan.md',
      mine: side('mine', 2, marked('We meet at noon on Friday, at the old station.', ['noon', 'Friday', 'old'])),
      theirs: side('theirs', 1, marked('We meet at one on Saturday, at the new station by the river.', ['one', 'Saturday', 'new'])),
    },
  ])
}
"""


def diverged(page, path: str, label: str, photograph: str | None) -> None:
    page.evaluate(HOLD, path)
    selector = '[role="dialog"][aria-label="Plan.md"]'
    try:
        page.wait_for_selector(selector, timeout=8000)
    except Exception:
        wrong(f"[{label}] the sync question did not come up")
        return
    quiet(page)
    inside(f"[{label}] sync question", page.evaluate(BOX, selector))
    unwrapped(page, f"[{label}] sync question", selector)
    if photograph:
        shot(page, f"{photograph}-diverged")
    page.keyboard.press("Escape")
    page.evaluate("() => window.__held?.stop()")
    page.wait_for_timeout(300)


def drive(browser) -> None:
    for scale in SCALES:
        page = DRIVE.page(
            browser,
            viewport={"width": 1280, "height": 720},
            device_scale_factor=scale,
            user_agent=DESKTOP_AGENT,
            color_scheme="light",
            reduced_motion="reduce",
        )
        page.set_default_timeout(10000)
        DRIVE.open(page)
        DRIVE.wait_for(page, "window.nibApp.sync2", "the sync question's store")
        path = page.evaluate(SEED)
        quiet(page)

        for width, height in WINDOWS:
            viewport = {"width": round(width / scale), "height": round(height / scale)}
            page.set_viewport_size(viewport)
            label = f"{width}x{height}@{round(scale * 100)}%"
            say(f"--- {label}: {viewport['width']}x{viewport['height']} CSS pixels")
            settings(page, label)
            palette(page, label, None)
            picker(page, label, None)
            question(page, label, None)
            diverged(page, path, label, None)
            store(page, label, None)
            icons(page, path, label, None)

        if scale == 1 and SHOTS_TOO:
            for width, height in PHOTOGRAPHED:
                page.set_viewport_size({"width": width, "height": height})
                for scheme in ("light", "dark"):
                    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
                    name = f"{width}x{height}-{scheme}"
                    page.evaluate("() => window.nibApp.settings.show('appearance')")
                    page.wait_for_selector(SETTINGS)
                    quiet(page)
                    page.evaluate(FRAME)
                    quiet(page)
                    shot(page, f"{name}-settings")
                    page.evaluate("() => window.nibApp.settings.show('general')")
                    quiet(page)
                    shot(page, f"{name}-settings-general")
                    page.keyboard.press("Escape")
                    page.wait_for_selector(SETTINGS, state="detached")
                    palette(page, name, name)
                    picker(page, name, name)
                    question(page, name, name)
                    diverged(page, path, name, name)
                    store(page, name, name)
                    icons(page, path, name, name)
            page.evaluate("() => window.nibApp.theme.setScheme('light')")

        page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
