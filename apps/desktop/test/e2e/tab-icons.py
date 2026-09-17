"""One mark per open tab, measured.

Emil asked for an icon on every window: the file's own, for a note, a canvas, a
page note and a PDF, the space's own picture for the graph, and for a website the
site's own favicon. What a unit test cannot say is whether the seven of them come
out as one strip - the same box, in the same place inside the tab, at the same
weight - so that is what this measures, in a real browser, and photographs.

The proof that a tab and a row are one answer: `Plan.md` says `icon: rocket` in
its front matter, and the drive reads the row in the file list and the tab in the
strip out of the same window and holds them against each other. Emil, 2026-09-17:
*"for all note types, the tab icon and the explorer icon should always be the
same."* Then it chooses one in the picker, on a canvas that had none, and holds the
two against each other again - nothing tells the tab. And because the icon is the
whole of a pinned tab, one tab is pinned at the end of the run and measured again as
a chip.

Serves the built web app and drives it in the machine's own Chrome, and serves one
picture of its own for a website's favicon to point at. The build has to be a
development one or `window.nibApp` is not there.

Run it from the repository root:

    python apps/desktop/test/e2e/tab-icons.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/tab-icons/`.
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

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "tab-icons"

# Where a drive of this repository may listen; see docs/conventions.md. Not the dev
# server's 1420, and not the other drives' ports either.
PORT = 22431
ORIGIN = f"http://127.0.0.1:{PORT}"

# The picture a website points its `Nib-Icon` at, served from the app's own icon so
# the drive needs nothing off the network.
MARK = "/mark.png"

# A note that chose an icon of its own. The row in the list wears the rocket and so
# does the tab, because they are the same file and a file wears one mark.
DRESSED = "---\nicon: rocket\n---\n\n# Plan\n\nA note that chose an icon.\n"


def shortcut(url: str, title: str, icon: str | None) -> str:
    """A website as its file: the Windows Internet Shortcut the app writes, with nib's
    own keys in the same block. See apps/desktop/src/lib/web-tab/shortcut.ts."""

    rows = [f"URL={url}", f"Title={title}", "Nib-Added=2026-09-13T08:00:00.000Z"]
    if icon:
        rows.append(f"Nib-Icon={icon}")

    return "[InternetShortcut]\r\n" + "\r\n".join(rows) + "\r\n"


# The space these tabs come out of. A `.url` and a `.pages` are written by renaming a
# note onto the extension, which is how the drives already make a PDF: the words are the
# file, and the name is what the app reads the kind off.
SEED = """
async (site) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root

  for (const one of [...ws.tabs]) ws.close(one.id)

  const plan = await ws.noteFrom(site.dressed, root)
  const paper = await ws.noteFrom('# paper\\n', root)
  await ws.rename(paper, 'Deep Learning.pdf')
  const marked = await ws.noteFrom(site.marked, root)
  await ws.rename(marked, 'A site with a mark.url')
  const plain = await ws.noteFrom(site.plain, root)
  await ws.rename(plain, 'A site with no mark.url')
  await ws.loadTree()

  const at = (name) => ws.files.find((one) => one.name === name)?.path ?? null

  return {
    held: ws.files.map((one) => one.name),
    plan,
    pdf: at('Deep Learning.pdf'),
    marked: at('A site with a mark.url'),
    plain: at('A site with no mark.url'),
  }
}
"""

# Seven tabs, one of every kind a window can hold, in the order the strip keeps them.
OPEN = """
async (where) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root

  await ws.openEntry(where.plan, {})
  await ws.createCanvas(root, 'Roadmap.canvas')
  await ws.createPages(root, 'Lecture.pages')
  await ws.openEntry(where.pdf, {})
  ws.openGraph()
  await ws.openWeb(where.marked)
  await ws.openWeb(where.plain)

  return ws.tabs.map((one) => [one.kind, one.shown])
}
"""

# The strip, as the reader sees it: one mark per tab, its box, where it sits inside the
# tab, and the hairline it is drawn at.
#
# A stroke is in the units of the grid the drawing was made on, so the number in the
# stylesheet says nothing on its own: what reaches the screen is that number times the
# box over the viewBox, and that is the figure every mark has to agree on.
STRIP = """
() => {
  const hairline = (svg) => {
    const units = svg.viewBox?.baseVal?.width || 24
    const drawn = svg.getBoundingClientRect().width
    const said = parseFloat(getComputedStyle(svg).strokeWidth) || 0
    return Math.round((said * drawn / units) * 1000) / 1000
  }

  return [...document.querySelectorAll('.tab')].map((tab) => {
    const pick = tab.querySelector('.pick')
    const marks = [...pick.children].filter((one) => one.classList.contains('mark'))
    const mark = marks[0] ?? null
    const box = mark?.getBoundingClientRect() ?? null
    const seat = pick.getBoundingClientRect()
    const svg = mark?.querySelector('svg') ?? null
    const img = mark?.querySelector('img') ?? null

    return {
      name: tab.querySelector('.label')?.textContent ?? null,
      // A pinned tab is its mark alone, which is the one place the mark is the whole
      // of what the reader has to go on.
      pinned: tab.classList.contains('pinned'),
      shut: !!tab.querySelector('.shut'),
      marks: marks.length,
      kind: img ? 'picture' : svg ? 'stroke' : 'nothing',
      width: box ? Math.round(box.width * 100) / 100 : null,
      height: box ? Math.round(box.height * 100) / 100 : null,
      // Where the mark sits inside the tab's own button, which is what makes every
      // name in the strip start at the same place.
      at: box ? Math.round((box.left - seat.left) * 100) / 100 : null,
      middle: box ? Math.round((box.top + box.height / 2 - seat.top) * 100) / 100 : null,
      tab: Math.round(tab.getBoundingClientRect().width * 100) / 100,
      hairline: svg ? hairline(svg) : null,
      drawing: svg ? (svg.querySelector('path')?.getAttribute('d') ?? '').slice(0, 44) : null,
      src: img?.getAttribute('src') ?? null,
      // Whether the picture really arrived, rather than merely being asked for.
      arrived: img ? img.naturalWidth > 0 : null,
    }
  })
}
"""

# The note that chose an icon, pinned. Emil asked for both of these in one breath, and
# they are one thing: a pinned tab is reduced to its icon, so the icon it is reduced to
# had better be the one the file chose.
PIN = """
() => {
  const ws = window.nibApp.workspace
  const tab = ws.tabs.find((one) => (one.name ?? '').startsWith('Plan'))
  ws.togglePin(tab.id)
}
"""

# The picker, on the canvas, which is the one open file that chose nothing. A row's
# menu is what opens it in the app and a drive cannot reach that; see App.svelte.
CHOOSE = """
() => {
  const ws = window.nibApp.workspace
  const canvas = ws.files.find((one) => one.name === 'Roadmap.canvas')
  window.nibApp.iconChoice.file(canvas.path)
  return canvas.path
}
"""

# The mark the file list draws for the same file, which is where a chosen icon belongs.
ROWS = """
() =>
  Object.fromEntries(
    [...document.querySelectorAll('.nib-row.row')].map((row) => [
      row.querySelector('.nib-row-label')?.textContent ?? '',
      (row.querySelector('.mark svg path')?.getAttribute('d') ?? '').slice(0, 44),
    ]),
  )
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
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


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The build, plus a picture for each of the two addresses a mark is looked for at.

    `MARK` is where a website file points its `Nib-Icon`, which is what the tab strip
    reads. `/favicon.ico` is where the card under a page guesses, in a browser build
    that cannot frame the site until it is asked - a guess the built app has nothing to
    answer with, so without this the run is full of a 404 that says nothing about the
    strip. See web-tab/WebTab.svelte, which does the same thing in scripts/web-tab-e2e.py.
    """

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def do_GET(self) -> None:
        if self.path not in {MARK, "/favicon.ico"}:
            super().do_GET()
            return

        body = (DIST / "icon-256.png").read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class Strict(socketserver.TCPServer):
    """Never reuses the address, so a run cannot photograph the last one."""

    allow_reuse_address = False


def serve() -> Strict:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
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


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def shot(page: Page, name: str, selector: str | None = None) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    target = SHOTS / f"{name}.png"
    if selector:
        page.locator(selector).screenshot(path=str(target))
    else:
        page.screenshot(path=str(target))
    say(f"shot {name}.png")


def fresh(browser: Browser, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    page = context.new_page()
    # The PDF is a note renamed, which pdf.js cannot read and the pane says so in
    # words: "That PDF could not be opened". The refusal is the drive's own doing and
    # is the only thing on the console this run allows; see Pdf.svelte.
    page.on(
        "pageerror",
        lambda error: None
        if "pdf" in str(error).lower()
        else wrong(f"[{scheme}] page error: {error}"),
    )
    page.on(
        "console",
        lambda message: wrong(f"[{scheme}] console error: {message.text}")
        if message.type == "error" and "pdf" not in message.text.lower()
        else None,
    )
    # A mark that was asked for and never came is the one failure this drive exists to
    # catch, and "404" on the console does not say which address it was: so the address
    # is read off the answer itself.
    page.on(
        "response",
        lambda answer: wrong(f"[{scheme}] nothing at {answer.url}")
        if answer.status == 404
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{scheme}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{scheme}] a space")
    page.wait_for_timeout(300)
    return page


def website(path: str) -> str:
    return f"{ORIGIN}{path}"


def pinned(page: Page, scheme: str) -> None:
    """The dressed note, pinned: a chip with the icon it chose in it and nothing else.

    A pinned tab is its mark alone, so this is the one tab where the mark is the whole
    of what the reader has to go on - and the two things Emil asked for meet here."""

    page.evaluate(PIN)
    page.wait_for_timeout(700)

    strip = page.evaluate(STRIP)
    chip = strip[0] if strip else None
    beside = strip[1] if len(strip) > 1 else None
    say(f"[{scheme}] the pinned chip: {json.dumps(chip, ensure_ascii=False)}")
    shot(page, f"03-the-pinned-chip-{scheme}", ".strip")

    if not chip or not beside:
        wrong(f"[{scheme}] the strip lost its tabs when one of them was pinned")
        return

    if not chip["pinned"]:
        wrong(f"[{scheme}] the pinned tab is not at the head of the strip")
    if chip["name"] is not None:
        wrong(f"[{scheme}] a pinned tab still spells its name: {chip['name']!r}")
    if chip["shut"]:
        wrong(f"[{scheme}] a pinned tab offers a cross")
    if chip["tab"] > 48:
        wrong(f"[{scheme}] a pinned tab is as wide as a named one: {chip['tab']}px")

    # The mark it is reduced to: the one the row wears, in the box every other tab
    # keeps. A chip whose icon is not the file's own would be a chip nothing can be
    # told apart by.
    row = page.evaluate(ROWS).get("Plan", "")
    if chip["drawing"] != row:
        wrong(f"[{scheme}] the pinned chip wears {chip['drawing']!r} where the row wears {row!r}")
    if (chip["width"], chip["height"]) != (beside["width"], beside["height"]):
        wrong(f"[{scheme}] the chip's mark is not the box the other tabs keep: {chip}")


def chooses(page: Page, scheme: str) -> None:
    """An icon chosen the way somebody chooses one, and both surfaces taking it.

    Emil: *"if we set an explorer icon for a note, then it should also be the tab
    icon."* Nothing tells the tab - the row and the tab ask one reader the same
    question about one file, so the strip changes when the list does."""

    say(f"[{scheme}] choosing an icon for {page.evaluate(CHOOSE)}")
    page.locator(".sheet").wait_for(state="visible", timeout=30_000)
    page.locator('.nib-segmented button:has-text("Line")').click()
    page.locator(".sheet input.nib-field").fill("anchor")
    cell = page.locator('.sheet button[aria-label="anchor"]').first
    cell.wait_for(state="visible", timeout=30_000)
    cell.click()
    page.wait_for_timeout(900)
    page.evaluate("() => window.nibApp.iconChoice.close()")
    page.wait_for_timeout(400)

    strip = page.evaluate(STRIP)
    rows = page.evaluate(ROWS)
    tab = next((one for one in strip if one["name"] == "Roadmap"), None)
    row = rows.get("Roadmap", "")
    drawn = tab["drawing"] if tab else None
    say(f"[{scheme}] Roadmap now wears {row!r} in the list and {drawn!r} in the strip")
    shot(page, f"04-an-icon-chosen-{scheme}", ".strip")

    if not row:
        wrong(f"[{scheme}] the chosen icon never reached the row it was chosen on")
    elif drawn != row:
        wrong(f"[{scheme}] an icon chosen in the list did not reach the tab: {drawn!r}")


def drive(page: Page, scheme: str) -> list[dict]:
    where = page.evaluate(
        SEED,
        {
            "dressed": DRESSED,
            "marked": shortcut(f"{ORIGIN}/index.html", "A site with a mark", website(MARK)),
            "plain": shortcut(f"{ORIGIN}/index.html", "A site with no mark", None),
        },
    )
    say(f"[{scheme}] the space holds {json.dumps(where['held'], ensure_ascii=False)}")
    page.wait_for_timeout(600)

    opened = page.evaluate(OPEN, where)
    say(f"[{scheme}] the tabs: {json.dumps(opened, ensure_ascii=False)}")
    page.wait_for_timeout(2000)

    # The file list, so the rows and the tabs can be read against each other.
    page.keyboard.press("Control+Shift+e")
    page.wait_for_timeout(900)

    strip = page.evaluate(STRIP)
    say(f"[{scheme}] the strip: {json.dumps(strip, ensure_ascii=False)}")

    shot(page, f"01-the-strip-{scheme}", ".strip")
    shot(page, f"02-the-window-{scheme}")

    if len(strip) != 7:
        wrong(f"[{scheme}] the strip holds {len(strip)} tabs rather than seven")
        return strip

    for one in strip:
        if one["marks"] != 1:
            wrong(f"[{scheme}] {one['name']} wears {one['marks']} marks rather than one")
        if one["kind"] == "nothing":
            wrong(f"[{scheme}] {one['name']} wears no mark at all")

    # One box, and one place in the tab: which is what makes seven kinds read as a strip
    # and every name in it start at the same place.
    boxes = {(one["width"], one["height"]) for one in strip}
    seats = {(one["at"], one["middle"]) for one in strip}
    if len(boxes) != 1:
        wrong(f"[{scheme}] the marks are not one box: {sorted(boxes)}")
    if len(seats) != 1:
        wrong(f"[{scheme}] the marks do not sit in one place: {sorted(seats)}")
    say(f"[{scheme}] one box {boxes.pop()} at one place {seats.pop()}")

    # One weight, across the two grids the drawings come off.
    hairlines = {one["hairline"] for one in strip if one["hairline"] is not None}
    if max(hairlines) - min(hairlines) > 0.02:
        wrong(f"[{scheme}] the strokes are not one weight: {sorted(hairlines)}")
    say(f"[{scheme}] one hairline: {sorted(hairlines)}")

    # And no two kinds wear the same drawing.
    drawings = [one["drawing"] for one in strip if one["drawing"]]
    if len(set(drawings)) != len(drawings):
        wrong(f"[{scheme}] two tabs wear the same drawing: {drawings}")

    # A website with a mark shows the picture, and it really arrived.
    marked = next((one for one in strip if "with a mark" in (one["name"] or "")), None)
    plain = next((one for one in strip if "with no mark" in (one["name"] or "")), None)
    if not marked or marked["kind"] != "picture":
        wrong(f"[{scheme}] the site with a mark does not wear its favicon: {marked}")
    elif marked["src"] != website(MARK):
        wrong(f"[{scheme}] the favicon came from {marked['src']}")
    elif not marked["arrived"]:
        wrong(f"[{scheme}] the favicon was asked for and never arrived")
    if not plain or plain["kind"] != "stroke":
        wrong(f"[{scheme}] the site with no mark does not fall back to the globe: {plain}")

    # And the one that says a tab and a row are one answer: the same file, one mark.
    rows = page.evaluate(ROWS)
    tab = next((one for one in strip if one["name"] == "Plan"), None)
    row = rows.get("Plan", "")
    say(f"[{scheme}] Plan wears {row!r} in the list and {tab and tab['drawing']!r} in the strip")
    if not row:
        wrong(f"[{scheme}] there is no row for the note that chose an icon")
    elif tab and row != tab["drawing"]:
        wrong(f"[{scheme}] the tab wears {tab['drawing']!r} where the row wears {row!r}")

    pinned(page, scheme)
    chooses(page, scheme)
    return strip


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    measured: dict[str, list[dict]] = {}

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for scheme in ["light", "dark"]:
                    say(f"--- {scheme} ---")
                    page = fresh(browser, scheme)
                    try:
                        measured[scheme] = drive(page, scheme)
                    finally:
                        page.context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    # The same strip in both schemes, to the pixel: a scheme paints a mark and never
    # moves it.
    if len(measured) == 2:
        shapes = [
            [(one["name"], one["width"], one["at"], one["tab"]) for one in rows]
            for rows in measured.values()
        ]
        if shapes[0] != shapes[1]:
            wrong(f"the strip is not the same shape in both schemes: {shapes}")

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print(
        "\nseven kinds of tab, one mark each, one box, one weight, one place - and the"
        " file's own mark in the strip as in the list, down to the pinned chip",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
