"""Glass and Wallpaper, every dial: what each one does, and every word still read.

The two translucent themes offer a dial for everything a reader asked for - a sharp
picture, a desk with no blur, a frame all the way to opaque, a note and a terminal the
material shows through - and every one of them stops where words would stop reading.
So the drive turns each dial to its ends, over the worst pictures and desks there are,
in both schemes, and reads the result back off the screenshots rather than off the
app's own opinion of what it painted:

  - the quietest word on the frame, `--muted`, against the frame where no word is:
    four and a half to one, over a sharp picture six;
  - body text, `--text`, against the note's paper where no word is: seven to one, and
    `--muted` four and a half - at Opaque, Tinted and Clear alike.

And what the dials promise besides: Opaque is the paper as it always was, a dial being
dragged shows at once and keeps nothing until it is let go of, the Opacity dial's track
is grey below its floor, a web page paints its own page, and nothing filters anything on
a frame. Then the cost: a long note scrolled and typed into on the built-in theme, on
glass and on the wallpaper with the note see-through.

Run it from the repository root:

    python apps/desktop/test/e2e/theme-options.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go beside this file under
`shots/theme-options/`, which is ignored; set NIB_SHOTS_TOO to a folder to copy them
there as well.
"""

from __future__ import annotations

import io
import json
import os
import shutil
from typing import Any

from PIL import Image

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

NOTE = """# Under a picture

Ordinary words, and *some* of them `marked up`, with a [link](https://example.com),
and a bit of **weight** in the middle of a sentence that runs on long enough to be read
rather than glanced at.

> A quote, in the muted colour - the first thing a wash takes.

> [!note] A callout
> Keeps a fill of its own.

| A table | with rows |
| --- | --- |
| one | two |

```js
const code = 'keeps its own block'
```
"""

LONG = "# A long note\n\n" + "\n\n".join(
    f"Paragraph {n}: ordinary words that run on long enough to wrap at least once in a pane "
    f"of ordinary width, so that scrolling has something to lay out and paint." for n in range(400)
)

# The worst pictures there are, drawn in the page: a bright one with white in it, a dark
# one with a white moon in it, and a sharp checkerboard of black and white.
PICTURES = {
    "bright": """
      const g = c.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#7cc4ff'); g.addColorStop(0.6, '#e8f6ff'); g.addColorStop(1, '#ffe08a')
      c.fillStyle = g; c.fillRect(0, 0, w, h)
      c.fillStyle = '#ffffff'
      for (const [x, y, r] of [[0.2, 0.25, 0.12], [0.3, 0.22, 0.1], [0.7, 0.3, 0.14]]) {
        c.beginPath(); c.arc(x * w, y * h, r * w, 0, 7); c.fill()
      }
    """,
    "dark": """
      const g = c.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, '#02030a'); g.addColorStop(1, '#1b2350')
      c.fillStyle = g; c.fillRect(0, 0, w, h)
      c.fillStyle = '#ffffff'
      for (let i = 0; i < 400; i++) c.fillRect((i * 7919) % w, (i * 104729) % h, 3, 3)
      c.beginPath(); c.arc(0.15 * w, 0.2 * h, 0.07 * w, 0, 7); c.fill()
    """,
    "checks": """
      for (let y = 0; y < h; y += 40) for (let x = 0; x < w; x += 40) {
        c.fillStyle = ((x + y) / 40) % 2 ? '#ffffff' : '#000000'; c.fillRect(x, y, 40, 40)
      }
    """,
}

TAKE = """
async ([paint, side]) => {
  const w = 2400, h = 1500
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const c = canvas.getContext('2d')
  new Function('c', 'w', 'h', paint)(c, w, h)
  const blob = await new Promise((done) => canvas.toBlob(done, 'image/png'))
  return window.nibApp.wallpaper.take(blob, side ?? 'light')
}
"""

# A desk behind a translucent window, done by hand as glass.py does it: painted where
# the material would be composited, and the root told what it stands on.
STAND_ON = """
([desk, material]) => {
  document.getElementById('nib-desk')?.remove()
  const style = document.createElement('style')
  style.id = 'nib-desk'
  style.textContent = `html { background: ${desk} !important; background-attachment: fixed !important; }`
  document.head.append(style)
  if (material) document.documentElement.dataset.translucent = material
  else delete document.documentElement.dataset.translucent
}
"""

# Each desk with both of its worst corners in it, the way a photograph has them. Mica
# keeps its own brightness, so on Mica the desk is the band that side's Mica can be
# (glass.py measures the same band): its two flat colours and a wallpaper's tint of it.
DESKS = {
    "white": "#ffffff",
    "black": "#000000",
    "busy": "linear-gradient(90deg, #000 0 25%, #fff 25% 50%, #e3342f 50% 75%, #3490dc 75%)",
}
MICA = {
    "dark": "linear-gradient(90deg, #000 0 33%, #3a3a3a 33% 66%, #1d2338 66%)",
    "light": "linear-gradient(90deg, #c0c0c0 0 33%, #fff 33% 66%, #d9dde8 66%)",
}

# Every filter that repaints what is behind it on every frame. Neither theme spends one.
FILTERS = """
() => [...document.querySelectorAll('*')]
  .filter((one) => {
    const style = getComputedStyle(one)
    return (style.backdropFilter && style.backdropFilter !== 'none') || (style.filter && style.filter.includes('blur'))
  })
  .map((one) => one.tagName.toLowerCase() + '.' + [...one.classList].join('.'))
"""

# Where no word is: a strip of the title bar, the foot of the list, and the paper under
# the last line of the note. And the inks, as the page resolves them.
BOXES = """
() => {
  const bar = document.querySelector('[data-chrome="top"], .titlebar, header')?.getBoundingClientRect()
  const side = document.querySelector('.sidebar, aside')?.getBoundingClientRect()
  const tree = [...document.querySelectorAll('.nib-row')].map((one) => one.getBoundingClientRect())
  const lowest = Math.max(0, ...tree.filter((r) => side && r.left < side.right).map((r) => r.bottom))
  const lines = [...document.querySelectorAll('.cm-line')].map((one) => one.getBoundingClientRect())
  const editor = document.querySelector('.cm-editor')?.getBoundingClientRect()
  const last = Math.max(0, ...lines.map((r) => r.bottom))
  // Each ink as the part it is written on resolves it: under glass a part of the frame
  // may wear the other scheme's words.
  const ink = (name, where = document.body) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    where.append(probe)
    const said = getComputedStyle(probe).color
    probe.remove()
    return said
  }
  const barNode = document.querySelector('[data-chrome="top"], .titlebar, header') ?? document.body
  const sideNode = document.querySelector('.sidebar, aside') ?? document.body
  return {
    bar: bar ? [bar.right - 260, bar.top + 4, bar.right - 160, bar.bottom - 4] : null,
    side: side ? [side.left + 8, lowest + 24, side.right - 8, side.bottom - 48] : null,
    paper: editor ? [editor.left + 24, last + 24, editor.right - 24, Math.min(editor.bottom - 12, last + 200)] : null,
    muted: ink('--muted'),
    barMuted: ink('--muted', barNode),
    sideMuted: ink('--muted', sideNode),
    text: ink('--text'),
    bg: ink('--bg'),
    alpha: getComputedStyle(document.documentElement).getPropertyValue('--content-alpha').trim(),
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


def keep_shot(page: Any, name: str) -> None:
    path = shot(page, name)
    also = os.environ.get("NIB_SHOTS_TOO")
    if also:
        os.makedirs(also, exist_ok=True)
        shutil.copy(path, os.path.join(also, f"{name}.png"))


def holds(what: str, found: float, floor: float) -> None:
    (say if found >= floor else wrong)(f"{what}: {found}:1 (at least {floor})")


def measure(page: Any, name: str, frame: float = 4.5, opaque: bool = False) -> None:
    """Every word on the frame and the paper, worst pixel by worst pixel."""
    boxes = page.evaluate(BOXES)
    image = Image.open(io.BytesIO(page.screenshot()))
    muted, text = channels(boxes["muted"]), channels(boxes["text"])
    for where in ("bar", "side"):
        if boxes[where]:
            ink = channels(boxes[f"{where}Muted"])
            holds(f"{name}: quiet ink on the {where}", worst(image, boxes[where], ink), frame)
    if not boxes["paper"]:
        wrong(f"{name}: no paper to measure")
        return
    holds(f"{name}: body text on the paper", worst(image, boxes["paper"], text), 7)
    holds(f"{name}: quiet ink on the paper", worst(image, boxes["paper"], muted), 4.5)
    if opaque:
        region = image.crop(tuple(round(one) for one in boxes["paper"])).convert("RGB")
        colours = {colour for _count, colour in region.getcolors(maxcolors=1 << 16) or []}
        bg = channels(boxes["bg"])
        (say if colours == {bg} else wrong)(f"{name}: Opaque is the paper as it was {bg}: {sorted(colours)[:3]}")


def dial(page: Any, id: str, value: Any) -> None:
    page.evaluate(f"() => window.nibApp.theme.set({json.dumps(id)}, {json.dumps(value)})")
    page.wait_for_timeout(700)


def fresh(browser: Any, scheme: str, note: str = NOTE, name: str = "Under a picture") -> Any:
    page = DRIVE.page(browser, viewport={"width": 1240, "height": 760}, color_scheme=scheme, reduced_motion="reduce")
    DRIVE.open(page)
    DRIVE.seed(page, note)
    DRIVE.open_note(page, name)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    return page


def wallpaper(browser: Any, scheme: str) -> None:
    page = fresh(browser, scheme)
    wait_for(page, "window.nibApp.wallpaper", "the wallpaper store on the handle")
    page.evaluate("() => window.nibApp.theme.select('wallpaper')")
    wait_for(page, "window.nibApp.theme.settings.some((one) => one.id === 'content')", "the wallpaper's dials")

    for picture, paint in PICTURES.items():
        if not page.evaluate(TAKE, [paint, "light"]):
            wrong(f"{scheme}: the {picture} picture was not taken")
            continue
        page.wait_for_timeout(500)
        for level in ("tinted", "opaque", "clear"):
            dial(page, "content", level)
            keep_shot(page, f"wallpaper-{scheme}-{picture}-{level}")
            measure(page, f"wallpaper {scheme} {picture} {level}", opaque=level == "opaque")

        # The ends of every dial, one at a time, back where it started after.
        if picture != "checks":
            continue
        for id, ends, start in (
            ("blur", (0, 60), 28),
            ("dim", (0, 90), 10),
            ("saturation", (0, 200), 100),
            ("tint", (100,), 0),
            ("grain", (100,), 0),
        ):
            for value in ends:
                dial(page, id, value)
                page.wait_for_timeout(600)
                keep_shot(page, f"wallpaper-{scheme}-{id}-{value}")
                sharp = id == "blur" and value == 0
                measure(page, f"wallpaper {scheme} {id} {value}", frame=6 if sharp else 4.5)
            dial(page, id, start)

        for fit in ("fit", "tile", "centre"):
            dial(page, "fit", fit)
            keep_shot(page, f"wallpaper-{scheme}-fit-{fit}")
            measure(page, f"wallpaper {scheme} fit {fit}")
        dial(page, "fit", "fill")

    # A dial being dragged is shown at once and kept nowhere until it is let go of.
    before = page.evaluate("() => localStorage.getItem('nib:theme-settings')")
    page.evaluate("() => window.nibApp.theme.try('dim', 70)")
    page.wait_for_timeout(200)
    shown = page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--nib-dim').trim()")
    after = page.evaluate("() => localStorage.getItem('nib:theme-settings')")
    (say if shown == "70%" and before == after else wrong)(
        f"wallpaper {scheme}: a dial being dragged shows {shown} and keeps nothing ({before == after})"
    )
    page.evaluate("() => window.nibApp.theme.set('dim', 10)")

    # The dark side's own picture: the light side keeps the one it had.
    page.evaluate(TAKE, [PICTURES["dark"], "dark"])
    page.wait_for_timeout(600)
    sheet = page.evaluate("() => document.getElementById('nib-user-theme')?.textContent ?? ''")
    (say if ":root[data-theme='dark']" in sheet else wrong)(f"wallpaper {scheme}: the dark side has a picture of its own")
    keep_shot(page, f"wallpaper-{scheme}-own-dark")

    # The pictures the Appearance pane shows, and the dials under them; a drag on a
    # thumbnail moves its picture's focal point and a press without one keeps it.
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    page.wait_for_timeout(600)
    page.evaluate("() => document.querySelector('.sheet .pictures')?.scrollIntoView({ block: 'start' })")
    page.wait_for_timeout(300)
    box = page.evaluate(
        "() => { const one = document.querySelector('.sheet .picture .thumb'); if (!one) return null;"
        " const b = one.getBoundingClientRect(); return [b.left, b.top, b.width, b.height] }"
    )
    if box:
        left, top, width, height = box
        page.mouse.move(left + width / 2, top + height / 2)
        page.mouse.down()
        page.mouse.move(left + width * 0.6, top + height * 0.6, steps=4)
        page.mouse.move(left + width * 0.15, top + height * 0.85, steps=6)
        page.mouse.up()
        page.wait_for_timeout(500)
        focus = page.evaluate("() => window.nibApp.wallpaper.held.main?.focus")
        kept = page.evaluate("() => JSON.parse(localStorage.getItem('nib:wallpaper') || '{}').focus")
        near = focus and abs(focus[0] - 0.15) < 0.05 and abs(focus[1] - 0.85) < 0.05
        (say if near and kept == focus else wrong)(f"wallpaper {scheme}: a drag on the thumbnail moved the focal point to {focus}, kept {kept}")
    else:
        wrong(f"wallpaper {scheme}: no thumbnail to drag")
    keep_shot(page, f"wallpaper-{scheme}-settings")
    page.evaluate("() => { window.nibApp.settings.open = false }")
    page.wait_for_timeout(300)

    filters = page.evaluate(FILTERS)
    (wrong if filters else say)(f"wallpaper {scheme}: filters on a frame: {filters[:5]}")
    page.context.close()


def glass(browser: Any, scheme: str) -> None:
    page = fresh(browser, scheme)
    page.evaluate("() => window.nibApp.theme.select('glass')")
    wait_for(page, "getComputedStyle(document.documentElement).getPropertyValue('--glass-chrome')", "glass's sheet")

    for material in ("mica", "acrylic", "clear"):
        desks = {"band": MICA[scheme]} if material == "mica" else DESKS
        for desk, paint in desks.items():
            page.evaluate(STAND_ON, [paint, material])
            wait_for(page, "window.nibApp.theme.settings.some((one) => one.id === 'content')", "glass's dials")
            for level in ("tinted", "opaque", "clear"):
                dial(page, "content", level)
                keep_shot(page, f"glass-{scheme}-{material}-{desk}-{level}")
                measure(
                    page,
                    f"glass {scheme} {material} {desk} {level}",
                    frame=6 if material == "clear" else 4.5,
                    opaque=level == "opaque",
                )

    # The ends of the frame's own dials, over the busy desk on Acrylic.
    page.evaluate(STAND_ON, [DESKS["busy"], "acrylic"])
    page.wait_for_timeout(400)
    for id, value in (("opacity", 0), ("opacity", 100), ("tint", 0), ("follow", False), ("tab", False)):
        dial(page, id, value)
        keep_shot(page, f"glass-{scheme}-{id}-{value}")
        measure(page, f"glass {scheme} {id} {value}")
    for id, value in (("opacity", 50), ("tint", 100), ("follow", True), ("tab", True)):
        dial(page, id, value)

    # The Opacity dial over a desk that needs most of a wash: its track is grey below the
    # floor, and the knob cannot be put there.
    page.evaluate("() => window.nibApp.settings.show('appearance')")
    page.wait_for_timeout(600)
    floored = page.evaluate(
        "() => { const one = document.querySelector('.sheet input.slider.floored'); "
        "if (!one) return null; one.scrollIntoView({ block: 'center' }); "
        "return { least: one.getAttribute('aria-valuemin'), value: one.value } }"
    )
    (say if floored else wrong)(f"glass {scheme}: the Opacity dial says its floor: {floored}")
    page.wait_for_timeout(300)
    keep_shot(page, f"glass-{scheme}-settings")
    page.evaluate("() => { window.nibApp.settings.open = false }")

    filters = page.evaluate(FILTERS)
    (wrong if filters else say)(f"glass {scheme}: filters on a frame: {filters[:5]}")
    page.context.close()


# Frames while a long note scrolls by itself, and while it is typed into: what a
# see-through note costs is the one thing a screenshot cannot answer.
SCROLL = """
() => new Promise((done) => {
  const scroller = document.querySelector('.cm-scroller')
  if (!scroller) return done(null)
  scroller.scrollTop = 0
  const frames = []
  let last = performance.now()
  const step = () => {
    const now = performance.now()
    frames.push(now - last)
    last = now
    scroller.scrollTop += 24
    if (frames.length < 120) requestAnimationFrame(step)
    else done(frames.slice(2))
  }
  requestAnimationFrame(step)
})
"""

def summary(frames: list[float]) -> str:
    ordered = sorted(frames)
    median = ordered[len(ordered) // 2]
    return f"{len(frames)} frames, median {median:.1f} ms, p95 {ordered[int(len(ordered) * 0.95)]:.1f} ms, worst {ordered[-1]:.1f} ms"


def cost(browser: Any) -> None:
    results: dict[str, dict[str, str]] = {}
    for look in ("default", "glass-clear", "wallpaper-clear"):
        page = fresh(browser, "dark", LONG, "A long note")
        if look.startswith("glass"):
            page.evaluate("() => window.nibApp.theme.select('glass')")
            page.evaluate(STAND_ON, [DESKS["busy"], "mica"])
            wait_for(page, "window.nibApp.theme.settings.some((one) => one.id === 'content')", "glass's dials")
            dial(page, "content", "clear")
        elif look.startswith("wallpaper"):
            page.evaluate("() => window.nibApp.theme.select('wallpaper')")
            wait_for(page, "window.nibApp.theme.settings.some((one) => one.id === 'content')", "the wallpaper's dials")
            page.evaluate(TAKE, [PICTURES["dark"], "light"])
            dial(page, "content", "clear")
        page.wait_for_timeout(600)
        scrolled = page.evaluate(SCROLL) or []
        page.click(".cm-content")
        page.keyboard.press("Control+End")
        page.evaluate("() => { window.__typing = null }")
        page.evaluate(
            "() => { const frames = []; let last = performance.now(); window.__typing = frames;"
            " const step = () => { const now = performance.now(); frames.push(now - last); last = now;"
            " if (window.__typing === frames) requestAnimationFrame(step) }; requestAnimationFrame(step) }"
        )
        page.keyboard.type("the quick brown fox jumps over the lazy dog " * 3, delay=16)
        typed = page.evaluate("() => { const frames = window.__typing.slice(2); window.__typing = null; return frames }")
        results[look] = {"scroll": summary(scrolled), "typing": summary(typed)}
        say(f"cost on {look}: scrolling {results[look]['scroll']}; typing {results[look]['typing']}")
        page.context.close()

    out = os.environ.get("NIB_SHOTS_TOO")
    if out:
        with open(os.path.join(out, "cost.json"), "w", encoding="utf-8") as file:
            json.dump(results, file, indent=2)


def drive(browser: Any) -> None:
    for scheme in ("dark", "light"):
        wallpaper(browser, scheme)
        glass(browser, scheme)
    cost(browser)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive))
