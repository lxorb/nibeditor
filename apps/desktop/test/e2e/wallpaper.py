"""The wallpaper theme: a picture of the reader's own behind the frame, and every word
on the frame still read at four and a half to one.

A picture behind text is the classic way to make an app unreadable, so the drive puts
the worst ones there are under it - a bright one with white in it and a dark one with
a white moon in it - on both sides of the theme, and reads the result back off the
screenshot rather than off the app's own opinion of what it painted: the quietest ink
the chrome writes in, against the lightest (dark side) or darkest (light side) pixel
of the frame where no word is.

And the rest of what the theme promises: the note keeps its paper, nothing filters
anything on a frame, the Blur dial makes the picture again, the picture is on the
first frame of the next launch, and the theme with no picture wears its accent field.

Run it from the repository root:

    python apps/desktop/test/e2e/wallpaper.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go beside this file under
`shots/wallpaper/`, which is ignored; set NIB_SHOTS_TOO to a folder to copy them there.
"""

from __future__ import annotations

import io
import os
import shutil
from typing import Any

from PIL import Image

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = """# Under a picture

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com),
on the note's own paper whatever is behind the frame.

> A quote, in the muted colour.
"""

# Two pictures, drawn in the page and handed to the store as a file would be. Each has
# the extremes a photograph has: the bright one a white sun and clouds, the dark one a
# white moon and stars, so the floor is earned rather than given.
PICTURES = {
    "bright": """
      const g = c.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#7cc4ff'); g.addColorStop(0.6, '#e8f6ff'); g.addColorStop(1, '#ffe08a')
      c.fillStyle = g; c.fillRect(0, 0, w, h)
      c.fillStyle = '#ffffff'
      for (const [x, y, r] of [[0.2, 0.25, 0.12], [0.3, 0.22, 0.1], [0.7, 0.3, 0.14]]) {
        c.beginPath(); c.arc(x * w, y * h, r * w, 0, 7); c.fill()
      }
      c.fillStyle = '#fff6c0'; c.beginPath(); c.arc(0.85 * w, 0.12 * h, 0.06 * w, 0, 7); c.fill()
    """,
    "dark": """
      const g = c.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#02030a'); g.addColorStop(1, '#1b2350')
      c.fillStyle = g; c.fillRect(0, 0, w, h)
      c.fillStyle = '#ffffff'
      for (let i = 0; i < 400; i++) c.fillRect((i * 7919) % w, (i * 104729) % h, 3, 3)
      c.beginPath(); c.arc(0.15 * w, 0.2 * h, 0.07 * w, 0, 7); c.fill()
    """,
}

TAKE = """
async ([paint]) => {
  const w = 2400, h = 1500
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const c = canvas.getContext('2d')
  new Function('c', 'w', 'h', paint)(c, w, h)
  const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'))
  const started = performance.now()
  const taken = await window.nibApp.wallpaper.take(blob)
  return { taken, ms: Math.round(performance.now() - started), stored: localStorage.getItem('nib:wallpaper')?.length ?? 0 }
}
"""

SHEET = "document.getElementById('nib-user-theme')?.textContent ?? ''"

# Every filter that repaints what is behind it on every frame. The wallpaper spends none.
FILTERS = """
() => [...document.querySelectorAll('*')]
  .filter((one) => {
    const style = getComputedStyle(one)
    return (style.backdropFilter && style.backdropFilter !== 'none') || (style.filter && style.filter.includes('blur'))
  })
  .map((one) => one.tagName.toLowerCase() + '.' + [...one.classList].join('.'))
"""

# The boxes on the frame where no word is, in CSS pixels: a strip of the title bar
# between the tabs and the window's end, and the foot of the list under its rows.
EMPTY = """
() => {
  const bar = document.querySelector('[data-chrome="top"], .titlebar, header')?.getBoundingClientRect()
  const side = document.querySelector('.sidebar, aside')?.getBoundingClientRect()
  const tree = [...document.querySelectorAll('.nib-row')].map((one) => one.getBoundingClientRect())
  const lowest = Math.max(0, ...tree.filter((r) => side && r.left < side.right).map((r) => r.bottom))
  const ink = (name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const said = getComputedStyle(probe).color
    probe.remove()
    return said
  }
  const paper = document.querySelector('.cm-editor')?.getBoundingClientRect()
  return {
    bar: bar ? [bar.right - 260, bar.top + 4, bar.right - 160, bar.bottom - 4] : null,
    side: side ? [side.left + 8, lowest + 24, side.right - 8, side.bottom - 48] : null,
    paper: paper ? [paper.left + 4, paper.bottom - 60, paper.left + 60, paper.bottom - 10] : null,
    muted: ink('--muted'),
    bg: ink('--bg'),
  }
}
"""


def channels(said: str) -> tuple[int, int, int]:
    parts = [float(one) for one in said[said.index("(") + 1 : said.index(")")].replace(",", " ").split()[:3]]
    return (round(parts[0]), round(parts[1]), round(parts[2]))


def luminance(rgb: tuple[int, int, int]) -> float:
    def linear(c: float) -> float:
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(one) for one in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(one: tuple[int, int, int], two: tuple[int, int, int]) -> float:
    light, dark = sorted((luminance(one), luminance(two)), reverse=True)
    return round((light + 0.05) / (dark + 0.05), 2)


def worst(image: Image.Image, box: list[float], ink: tuple[int, int, int]) -> float:
    """The lowest ratio of the ink against any pixel in the box."""
    region = image.crop(tuple(round(one) for one in box)).convert("RGB")
    colours = {colour for _count, colour in region.getcolors(maxcolors=1 << 20) or []}
    return min(ratio(ink, colour) for colour in colours) if colours else 0.0


# The end of a row under the pointer, past its words: the ground a quiet word on a
# hovered row stands on.
HOVERED = """
() => {
  const row = [...document.querySelectorAll('aside .nib-row')].find((one) => !one.classList.contains('is-on'))
  if (!row) return null
  const box = row.getBoundingClientRect()
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, box: [box.right - 30, box.top + 3, box.right - 6, box.bottom - 3] }
}
"""


def measure(page: Any, name: str) -> None:
    boxes = page.evaluate(EMPTY)
    image = Image.open(io.BytesIO(page.screenshot()))
    ink = channels(boxes["muted"])
    row = page.evaluate(HOVERED)
    if row:
        page.mouse.move(row["x"], row["y"])
        page.wait_for_timeout(250)
        lit = Image.open(io.BytesIO(page.screenshot()))
        found = worst(lit, row["box"], ink)
        (say if found >= 4.5 else wrong)(f"{name}: quiet ink on a row under the pointer, worst pixel {found}:1")
        page.mouse.move(1200, 700)
        page.wait_for_timeout(250)
    for where in ("bar", "side"):
        if not boxes[where]:
            wrong(f"{name}: no {where} to measure")
            continue
        found = worst(image, boxes[where], ink)
        (say if found >= 4.5 else wrong)(f"{name}: quiet ink on the {where}, worst pixel {found}:1")
    if boxes["paper"]:
        region = image.crop(tuple(round(one) for one in boxes["paper"])).convert("RGB")
        colours = {colour for _count, colour in region.getcolors(maxcolors=1 << 16) or []}
        bg = channels(boxes["bg"])
        if colours != {bg}:
            wrong(f"{name}: the note's paper is not opaque {bg}: {sorted(colours)[:4]}")
        else:
            say(f"{name}: the note keeps its paper {bg}")


def keep_shot(page: Any, name: str) -> None:
    path = shot(page, name)
    also = os.environ.get("NIB_SHOTS_TOO")
    if also:
        os.makedirs(also, exist_ok=True)
        shutil.copy(path, os.path.join(also, f"{name}.png"))


def drive(browser: Any) -> None:
    for scheme in ("dark", "light"):
        page = DRIVE.page(browser, viewport={"width": 1240, "height": 760}, color_scheme=scheme, reduced_motion="reduce")
        DRIVE.open(page)
        DRIVE.seed(page, NOTE)
        DRIVE.open_note(page, "Under a picture")
        page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        wait_for(page, "window.nibApp.wallpaper", "the wallpaper store on the handle")

        page.evaluate("() => window.nibApp.theme.select('wallpaper')")
        wait_for(page, f"{SHEET}.includes('--wallpaper-field')", "the wallpaper's sheet")
        page.wait_for_timeout(300)
        keep_shot(page, f"field-{scheme}")
        measure(page, f"{scheme}, the accent field")

        for picture, paint in PICTURES.items():
            result = page.evaluate(TAKE, [paint])
            if not result["taken"]:
                wrong(f"{scheme}: the {picture} picture was not taken")
                continue
            say(f"{scheme}, {picture}: taken in {result['ms']} ms, {result['stored']} characters kept")
            wait_for(page, f"{SHEET}.includes('--wallpaper-picture:')", "the picture in the sheet")
            page.wait_for_timeout(300)
            keep_shot(page, f"{picture}-{scheme}")
            measure(page, f"{scheme}, {picture}")

        # A pane with nothing open shows the picture, as a browser's new tab does.
        page.evaluate("() => window.nibApp.workspace.closeMany(window.nibApp.workspace.tabs.map((tab) => tab.id))")
        page.wait_for_timeout(500)
        keep_shot(page, f"empty-{scheme}")
        DRIVE.open_note(page, "Under a picture")

        filters = page.evaluate(FILTERS)
        if filters:
            wrong(f"{scheme}: something filters on every frame: {filters[:5]}")
        else:
            say(f"{scheme}: nothing filters anything on a frame")

        # The dial: the picture is made again at another blur, and kept once it rests.
        if scheme == "dark":
            before = page.evaluate("() => window.nibApp.wallpaper.held.picture.length")
            page.evaluate("() => window.nibApp.theme.set('blur', 56)")
            wait_for(page, "window.nibApp.wallpaper.held?.blur === 56", "the picture made at the new blur")
            wait_for(
                page,
                "JSON.parse(localStorage.getItem('nib:wallpaper')).blur === 56",
                "the new blur kept once the dial rests",
            )
            after = page.evaluate("() => window.nibApp.wallpaper.held.picture.length")
            say(f"blur 28 -> 56: the kept picture went from {before} to {after} characters")
            keep_shot(page, "dark-blur-56")
            measure(page, "dark, dark picture at blur 56")

            # The next launch: its first frame with the app in it already has the picture.
            page.add_init_script(
                """
                (() => {
                  const look = () => {
                    const app = document.getElementById('app')
                    if (!app || !app.childElementCount) return requestAnimationFrame(look)
                    const sheet = document.getElementById('nib-user-theme')
                    window.__firstFramePicture = !!sheet && sheet.textContent.includes('--wallpaper-picture:')
                  }
                  requestAnimationFrame(look)
                })()
                """
            )
            page.reload(wait_until="domcontentloaded")
            DRIVE.ready(page)
            if page.evaluate("() => window.__firstFramePicture") is True:
                say("the next launch's first frame wears the picture")
            else:
                wrong("the next launch's first frame did not wear the picture")

        page.context.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
