"""Every surface a thumb lands on, measured on a phone, on a tablet and on a
desktop, and photographed light and dark.

The touch scale in `tokens.css` says what a row, its words, its marks and its
gaps are on a touch screen. The unit test says every component reads it; this
says what that comes to in pixels on a real screen, which is the only place a
row is either comfortable or not. It also proves the other half of the bargain:
that a desktop is untouched, which is a number-for-number comparison of the same
run against the same build before the change.

Run it from the repository root, twice, with the change in between:

    python apps/desktop/test/e2e/touch-scale.py before
    python apps/desktop/test/e2e/touch-scale.py after

Each writes `shots/<label>.json` beside the screenshots and prints the table;
the second prints both columns side by side. `NIB_SKIP_BUILD=1` reuses
`apps/desktop/dist` from the last run.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "touch-scale"

# A port of this run's own. Never 1420, which is the dev server's, and not the
# ones the other runs here use either.
PORT = 18893
ORIGIN = f"http://127.0.0.1:{PORT}"

# How long anything is waited for before the run gives up and says what it saw.
PATIENCE = 40


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        local.glob("chromium-*/chrome-win*/chrome.exe"),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit(f"no chromium under {local}")
    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (APP / "dist" / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    # A production build hides the app's stores, and the run drives them.
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


class Pages:
    """The built page, served. No Worker: nothing here signs in."""

    def __init__(self) -> None:
        self.server: http.server.ThreadingHTTPServer | None = None

    def start(self) -> None:
        say(f"serving the build on {ORIGIN}")
        handler = functools.partial(
            http.server.SimpleHTTPRequestHandler, directory=str(APP / "dist")
        )
        handler.log_message = lambda *args, **kwargs: None  # type: ignore[assignment]
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if not self.server:
            return
        say("stopping the server")
        self.server.shutdown()
        self.server.server_close()
        self.server = None


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)
    raise SystemExit(f"gave up waiting for {what}")


# The os plugin's globals, so anything asking which platform this is gets an
# answer, and Android's own bars, so a sheet's bottom inset is a real number.
PREPARE = """
window.__TAURI_OS_PLUGIN_INTERNALS__ = {
  platform: 'android', family: 'unix', os_type: 'android',
  version: '15.0.0', arch: 'aarch64', exe_extension: '', eol: '\\n',
};
window.__NIB_SYSTEM__ = {
  insets: () => JSON.stringify({ top: 24, right: 0, bottom: 24, left: 0 }),
  bars: () => {},
};
"""

AS_DEVICE = """
([device, portrait, narrow]) => {
  const app = window.nibApp
  app.viewport.device = device
  app.viewport.portrait = portrait
  app.viewport.narrow = narrow
  const drawer = device === 'phone' || (device === 'tablet' && portrait)
  const root = document.documentElement
  root.dataset.device = device
  root.toggleAttribute('data-touch', device !== 'desktop')
  root.toggleAttribute('data-drawer', drawer)
  root.toggleAttribute('data-narrow', narrow)
  if (window.__nibInsets) window.__nibInsets()
}
"""

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  if (ws.panel !== 'tree') ws.showPanel('tree')

  await ws.noteFrom('# Deep work\\n\\n## Mornings\\n\\n### Before eight\\n\\nthe first line\\n', root)
  await ws.noteFrom('# Meeting notes\\n\\nwho said what, and a [[Deep work]] link\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nreading, #work and #work/nib\\n', at('Reading'))
  const paper = await ws.noteFrom('# paper\\n', at('Reading'))
  await ws.rename(paper, 'Deep Learning.pdf')
  await ws.noteFrom('# Archived\\n\\nolder words\\n', at('Reading/Archive'))
  // Named outright: with a name in hand the file is written at once, rather than a
  // row waiting to be typed into. See `createCanvas`.
  await ws.createCanvas(root, 'Roadmap.canvas')

  ws.bookmarks.toggle({ kind: 'note', path: 'Deep work.md', text: '' })
  ws.bookmarks.toggle({ kind: 'search', path: '', text: 'the' })

  ws.toggleFolder(at('Reading'))
  await ws.openEntry(at('Deep work.md'))
  return ws.tree.children.map((one) => one.name)
}
"""

MEASURE = """(specs) => {
  const round = (n) => Math.round(n * 10) / 10
  return specs.map(([name, sel]) => {
    let el = null
    try { el = document.querySelector(sel) } catch { el = null }
    if (!el) return [name, null]
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const num = (v) => (v === 'normal' ? 0 : parseFloat(v) || 0)
    const icon = el.querySelector('svg')
    const box = icon && icon.getBoundingClientRect()
    return [name, {
      w: round(r.width), h: round(r.height),
      font: num(cs.fontSize),
      gap: num(cs.columnGap),
      pl: num(cs.paddingLeft), pr: num(cs.paddingRight), pb: num(cs.paddingBottom),
      icon: box ? round(Math.max(box.width, box.height)) : null,
    }]
  })
}"""

# A phone the size of the one this was asked for, a tablet held both ways, and a
# desktop window: the name, the window, the pixel ratio, and the device class
# the app is told to be, since no window on this machine is a tablet.
PROFILES = [
    ("phone", 390, 844, 3, "phone", True, True),
    ("tablet-portrait", 820, 1180, 2, "tablet", True, False),
    ("tablet-landscape", 1180, 820, 2, "tablet", False, False),
    ("desktop", 1440, 900, 1, "desktop", False, False),
]

CHROME = [
    ["sidebar", "aside"],
    ["sidebar tabs strip", "aside .switch"],
    ["sidebar panel tab", "aside .switch button"],
    ["sidebar tab icon", "aside .switch button svg"],
    ["sidebar body", "aside .body"],
    # Every row of the file list is one row: a note, and a note that holds notes
    # wearing a twist at the far end of it. See docs/tree.md.
    ["tree row", "aside .row"],
    ["tree row twist", "aside .row .twist"],
    ["tree file mark", "aside .row .mark"],
    ["rail", "nav"],
    ["rail space square", "nav .space"],
    ["rail add", "nav .add"],
    ["rail foot glyph", "nav .foot .add svg"],
    ["titlebar", "header"],
    ["titlebar drawer toggle", "header .toggle"],
    ["titlebar title", "header .title"],
    ["titlebar more", "header .more"],
    ["status bar", "footer"],
    ["app menu button", "header .trigger"],
]

PANELS = {
    "outline": [["outline row", "aside .row.heading"]],
    "search": [
        ["search field", "aside .query"],
        ["search hit", "aside .hit"],
        ["search tick", "aside .tick"],
    ],
    "links": [["links hit", "aside .hit"], ["links line", "aside .hit-line"]],
}

TAGS = [
    ["tag row", "aside .line .row"],
    ["tag twist", "aside .twist"],
    ["search find bar row", "aside .find .row"],
    ["find bar field", ".findbar .nib-field"],
    ["find bar step", ".findbar .act"],
    ["find bar flag", ".findbar .flag"],
]
MARKS = [["bookmark row", "aside .row"], ["bookmark icon", "aside .row svg"]]

PALETTE = [
    ["palette", ".palette"],
    ["palette input", ".palette input"],
    ["palette row", ".palette ul li button"],
]

MENU = [
    ["app menu", ".menu"],
    ["app menu chip", ".menu .groups button"],
    ["app menu row", ".menu .rows button"],
    ["app menu rows box", ".menu .rows"],
]

CONTEXT = [
    ["context menu", ".menu"],
    ["context menu row", ".menu button"],
    ["context menu title", ".menu .title"],
]

SETTINGS = [
    ["settings sheet", ".sheet"],
    ["settings bar", ".sheet .bar"],
    ["settings bar icon", ".sheet .bar .icon"],
    ["settings search", ".sheet .search"],
    ["settings nav row", ".sheet .item"],
    ["settings nav glyph", ".sheet .item .glyph"],
    ["settings search field", ".sheet .search input"],
]

PRESS = """
(selector) => {
  const node = document.querySelector(selector)
  if (!node) return false
  const box = node.getBoundingClientRect()
  const at = { clientX: box.left + 20, clientY: box.top + box.height / 2 }
  const touch = new Touch({ identifier: 1, target: node, ...at })
  const send = (kind) =>
    node.dispatchEvent(new TouchEvent(kind, {
      touches: kind === 'touchend' ? [] : [touch],
      targetTouches: kind === 'touchend' ? [] : [touch],
      changedTouches: [touch], bubbles: true, cancelable: true,
    }))
  send('touchstart')
  window.__nibRelease = () => send('touchend')
  return true
}
"""


def measure(page: Page, specs) -> dict:
    return dict(page.evaluate(MEASURE, specs))


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


def open_drawer(page: Page) -> None:
    page.evaluate("() => { const ws = window.nibApp.workspace; if (!ws.panel) ws.showPanel('tree') }")
    page.wait_for_timeout(350)


def shut_drawer(page: Page) -> None:
    """Both drawers away, and the one scrim they share with them.

    On a phone that scrim is over the whole window, the titlebar included, so
    anything in the bar has to be reached with the drawers shut."""
    page.evaluate(
        "() => { const ws = window.nibApp.workspace; ws.closePanel(); ws.closePanel('right') }"
    )
    page.wait_for_timeout(400)


def run(label: str) -> int:
    build()
    pages = Pages()
    found: dict[str, dict] = {}

    try:
        pages.start()
        with sync_playwright() as play:
            browser = play.chromium.launch(executable_path=chromium(), headless=True)
            try:
                for name, width, height, scale, device, portrait, narrow in PROFILES:
                    # Both schemes, because the run photographs both; the
                    # measurements are the same either way, so the dark pass is
                    # the one that is kept.
                    for scheme in ("dark", "light"):
                        say(f"[{name}] {width}x{height} at {scale}x, a {device}, {scheme}")
                        seen = one(
                            browser,
                            label,
                            name,
                            width,
                            height,
                            scale,
                            device,
                            portrait,
                            narrow,
                            scheme,
                        )
                        if scheme == "dark":
                            found[name] = seen
            finally:
                browser.close()
    finally:
        pages.stop()

    SHOTS.mkdir(parents=True, exist_ok=True)
    (SHOTS / f"{label}.json").write_text(json.dumps(found, indent=2), encoding="utf8")
    say(f"wrote {label}.json")
    report(label)
    return 0


def one(
    browser: Browser, label, name, width, height, scale, device, portrait, narrow, scheme
) -> dict:
    touch = device != "desktop"
    context = browser.new_context(
        viewport={"width": width, "height": height},
        device_scale_factor=scale,
        has_touch=touch,
        is_mobile=touch,
        color_scheme=scheme,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    context.add_init_script(PREPARE)
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{name}] the app")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{name}] a space")
    # Every layer that opens over the note takes a history entry and gives it
    # back on closing; see backstack.svelte.ts. A tab opened straight onto the
    # app has one entry behind it, so a run that opens and shuts a dozen layers
    # can walk off the end of its own history and out of the page. These are the
    # floor under that, and nothing but the browser's own history sees them.
    page.evaluate("() => { for (let i = 0; i < 8; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(AS_DEVICE, [device, portrait, narrow])
    page.wait_for_timeout(200)
    say(f"[{name}] the space holds {page.evaluate(SEED)}")
    page.evaluate(AS_DEVICE, [device, portrait, narrow])
    # Opening a note shuts the drawer on a phone, so the tree is asked for again.
    open_drawer(page)
    wait_for(page, "() => document.querySelectorAll('aside .row').length >= 2", "the rows")
    page.wait_for_timeout(500)

    rows: dict = {
        "device": page.evaluate("() => document.documentElement.dataset.device"),
        "touch": page.evaluate("() => document.documentElement.hasAttribute('data-touch')"),
        "tokens": page.evaluate(
            "() => Object.fromEntries(['--touch-target','--touch-row','--touch-text',"
            "'--touch-icon','--touch-mark','--touch-gap','--touch-pad','--touch-indent',"
            "'--touch-bottom','--swipe-edge'].map((k) => "
            "[k, getComputedStyle(document.documentElement).getPropertyValue(k).trim()]))"
        ),
    }

    open_drawer(page)
    rows.update(measure(page, CHROME))
    rows.update(measure(page, MARKS))
    rows["tree indent step"] = page.evaluate(
        "() => { const rows = [...document.querySelectorAll('aside .row')];"
        " const at = (r) => parseFloat(getComputedStyle(r).paddingLeft);"
        " const deep = rows.filter((r) => at(r) > at(rows[0]));"
        " return deep.length ? at(deep[0]) - at(rows[0]) : null }"
    )
    shot(page, f"{label}-{name}-tree-{scheme}")

    for panel, specs in PANELS.items():
        page.evaluate("(p) => window.nibApp.workspace.showPanel(p)", panel)
        page.wait_for_timeout(500)
        if panel == "search":
            # An empty search offers the space's own tags, which is the only
            # place the tag rows are ever drawn.
            rows.update(measure(page, TAGS))
            page.evaluate("() => { window.nibApp.search.replacing = true }")
            page.evaluate("() => window.nibApp.search.ask('the')")
            page.wait_for_timeout(900)
        rows.update(measure(page, specs))
        if panel == "search":
            shot(page, f"{label}-{name}-search-{scheme}")
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)

    page.keyboard.press("Control+p")
    page.wait_for_timeout(400)
    page.keyboard.type(">")
    page.wait_for_timeout(700)
    rows.update(measure(page, PALETTE))
    shot(page, f"{label}-{name}-palette-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # The bars in the titlebar, which is what opens the app menu; see AppMenu.svelte.
    # With the drawer shut first, because on a phone the drawer's scrim lies over the
    # whole row and a press on a scrim is a press that shuts the drawer.
    shut_drawer(page)
    page.click("header .trigger")
    page.wait_for_timeout(600)
    rows.update(measure(page, MENU))
    shot(page, f"{label}-{name}-menu-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    open_drawer(page)
    page.wait_for_timeout(200)
    if touch:
        if page.evaluate(PRESS, "aside .row"):
            page.wait_for_selector('[role="menu"]:visible', timeout=5000)
            page.evaluate("() => window.__nibRelease?.()")
            page.wait_for_timeout(300)
    else:
        page.locator("aside .row").first.click(button="right")
        page.wait_for_timeout(400)
    rows.update(measure(page, CONTEXT))
    shot(page, f"{label}-{name}-context-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    page.evaluate("() => window.nibApp.settings.show()")
    # The sheet is fetched the first time it is asked for rather than carried into the
    # first paint; measuring before it lands measures nothing and reads as a pass. See
    # surfaces.svelte.ts.
    page.wait_for_selector(".nib-screen.sheet", timeout=15000)
    page.wait_for_timeout(900)
    rows.update(measure(page, SETTINGS))
    shot(page, f"{label}-{name}-settings-{scheme}")
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    context.close()
    return rows


# What is not a measurement of a surface, and so is not a row of the table.
ASIDE = {"device", "touch", "tokens", "tree indent step"}


def cell(seen) -> str:
    """One surface in one profile: its box, its type, its icon and its gaps."""
    if not seen:
        return "-"
    icon = f" i{seen['icon']:g}" if seen.get("icon") is not None else ""
    return f"{seen['w']:g}x{seen['h']:g} f{seen['font']:g}{icon} g{seen['gap']:g} p{seen['pl']:g}"


def report(label: str) -> None:
    """The run just finished, beside the other one if it is there. Two columns
    is the whole point: what a surface was, and what it is."""
    runs = {label: json.loads((SHOTS / f"{label}.json").read_text(encoding="utf8"))}
    other = "after" if label == "before" else "before"
    if (SHOTS / f"{other}.json").exists():
        runs = {
            name: json.loads((SHOTS / f"{name}.json").read_text(encoding="utf8"))
            for name in (("before", "after") if other == "before" else (label, other))
        }

    order: list[str] = []
    for one_run in runs.values():
        for profile in one_run.values():
            for key in profile:
                if key not in ASIDE and key not in order:
                    order.append(key)

    for column in [name for name, *_ in PROFILES]:
        print(f"\n### {column}")
        print(f"{'surface':<24}" + "".join(f"{name:<30}" for name in runs))
        for key in order:
            cells = "".join(f"{cell(runs[n].get(column, {}).get(key)):<30}" for n in runs)
            print(f"{key:<24}{cells}")

    print("\n### the device, the step per level of the tree, and the scale")
    for column in [name for name, *_ in PROFILES]:
        for name, one_run in runs.items():
            seen = one_run.get(column, {})
            kind = "touch" if seen.get("touch") else "pointer"
            print(f"{column:<18} {name:<8} {seen.get('device')} {kind}, indent {seen.get('tree indent step')}")
    for name, one_run in runs.items():
        print(name, json.dumps(one_run["phone"]["tokens"]))


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else "before"))
