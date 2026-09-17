"""The import sheet: a Notion zip and an Evernote file, read through the sheet.

What it photographs, on a desktop and on a phone: the drop zone, the preview of
what a Notion export would make, the notes after they have arrived, and the same
for an `.enex` with a picture and a checkbox list in it. Then it takes the import
back with one undo, which is the claim worth checking by machine rather than by
eye.

The fixtures are written here rather than kept in the repository: an export is
somebody's own notes, and a small one that a script writes says the same thing
about the reader as a large one that a person exported.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/import.py

Screenshots go beside this file under `shots/import/`, which is ignored. This is a
scratch drive rather than a test: it photographs the app and says what it saw.
"""

from __future__ import annotations

import base64
import functools
import http.server
import tempfile
import threading
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

# Above 1425, and not any other drive's port.
PORT = 18974
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

# The ids Notion sticks on the end of every name it writes.
PLAN = "1a2b3c4d5e6f78901a2b3c4d5e6f7890"
KIT = "aaaabbbbccccddddeeeeffff00001111"
TASKS = "99998888777766665555444433332222"
ROW = "11112222333344445555666677778888"

# A 1x1 PNG, so the picture in the Evernote note is a picture a browser can draw.
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)


def notion_zip(into: Path) -> Path:
    """A Notion export: a page with a page under it, a database, and a picture."""
    path = into / "Export-9f1c2d3e.zip"

    with zipfile.ZipFile(path, "w") as zip_file:
        zip_file.writestr(
            f"Plan {PLAN}.md",
            "# Plan\n"
            "Status: Done\n"
            "Created: January 2, 2026\n"
            "Tags: work, travel\n"
            "\n"
            f"The plan for the trip. See [Kit list](Plan%20{PLAN}/Kit%20list%20{KIT}.md).\n",
        )
        zip_file.writestr(
            f"Plan {PLAN}/Kit list {KIT}.md",
            f"# Kit list\n\nA tent and a stove.\n\n![](tent%20{KIT}.png)\n",
        )
        zip_file.writestr(f"Plan {PLAN}/tent {KIT}.png", PNG)
        zip_file.writestr(f"Tasks {TASKS}.csv", "Name,Status\nOne,Done\n")
        zip_file.writestr(
            f"Tasks {TASKS}_all.csv",
            "Name,Status,Notes\nOne,Done,Nothing left\nTwo,Doing,Still going\n",
        )
        zip_file.writestr(f"Tasks {TASKS}/One {ROW}.md", "# One\nStatus: Done\n\nThe first row.\n")

    return path


def enex(into: Path) -> Path:
    """An Evernote notebook: a note with a picture, a note with checkboxes."""
    path = into / "Travel.enex"
    hashed = __import__("hashlib").md5(PNG).hexdigest()
    encoded = base64.b64encode(PNG).decode()

    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n'
        '<en-export export-date="20260101T090000Z" application="Evernote">\n'
        "  <note>\n"
        "    <title>Trip to Iceland</title>\n"
        "    <content><![CDATA[<en-note><div>We flew on <b>Monday</b>.</div>"
        "<div><ul><li>Warm socks</li><li>A thermos</li></ul></div>"
        f'<div><en-media type="image/png" hash="{hashed}"/></div></en-note>]]></content>\n'
        "    <created>20260102T120000Z</created>\n"
        "    <updated>20260304T130000Z</updated>\n"
        "    <tag>travel</tag>\n"
        "    <tag>two words</tag>\n"
        "    <resource>\n"
        f"      <data encoding=\"base64\">{encoded}</data>\n"
        "      <mime>image/png</mime>\n"
        "      <resource-attributes><file-name>glacier.png</file-name></resource-attributes>\n"
        "    </resource>\n"
        "  </note>\n"
        "  <note>\n"
        "    <title>Packing</title>\n"
        "    <content><![CDATA[<en-note><div><en-todo checked=\"true\"/>Passport</div>"
        '<div><en-todo/>Socks</div></en-note>]]></content>\n'
        "    <created>20260105T080000Z</created>\n"
        "  </note>\n"
        "</en-export>\n",
        encoding="utf-8",
    )

    return path


def say(words: str) -> None:
    print(f"  {words}", flush=True)


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
    page.set_default_timeout(10000)
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
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(200)
    return context, page


NAMES = """
() => window.nibApp.workspace.files.map((one) => one.path.split('/').slice(-2).join('/'))
"""

TEXT_OF = """
async (ending) => {
  const ws = window.nibApp.workspace
  const found = ws.notes.find((one) => one.path.endsWith(ending))
  return found ? await ws.noteText(found.path) : null
}
"""


def bring_in(page, shot, tag: str, path: Path) -> dict:
    """One import, from the drop zone to the count that says it arrived."""
    page.evaluate("() => window.nibApp.importing.show()")
    page.wait_for_selector("button.drop")
    # After the sheet has flown in rather than during: on a phone it comes up from
    # the bottom, and a shot taken on the first frame is a shot of the motion.
    page.wait_for_timeout(450)
    shot(f"{tag}-waiting")

    with page.expect_file_chooser() as chooser:
        page.click("button.drop")
    chooser.value.set_files(str(path))

    page.wait_for_selector("button.primary", timeout=20000)
    page.wait_for_function("() => window.nibApp.importing.stage === 'ready'", timeout=30000)
    said = page.evaluate(
        """() => ({
          format: window.nibApp.importing.format,
          counts: window.nibApp.importing.counts,
          folder: window.nibApp.importing.folder,
          lost: (window.nibApp.importing.plan?.lost ?? []).map((one) => one.text),
        })"""
    )
    shot(f"{tag}-preview")

    page.click("button.primary")
    page.wait_for_function("() => window.nibApp.importing.stage === 'done'", timeout=60000)
    shot(f"{tag}-done")

    page.evaluate("() => window.nibApp.importing.close()")
    page.wait_for_timeout(300)
    return said


def drive(browser, out: Path, fixtures: Path, name, width, height, agent, finger, scheme) -> None:
    shots = out
    shots.mkdir(parents=True, exist_ok=True)
    context, page = opened(browser, width, height, agent, finger, scheme, name)

    def shot(tag: str) -> None:
        page.screenshot(path=str(shots / f"{name}-{tag}.png"))
        say(f"shot {name}-{tag}.png")

    # ── Notion ─────────────────────────────────────────────────────────────
    said = bring_in(page, shot, "notion", notion_zip(fixtures))
    say(f"[{name}] Notion: {said['format']}, {said['counts']}, into {said['folder']!r}")
    for line in said["lost"]:
        say(f"[{name}] worth knowing: {line}")

    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)
    shot("notion-tree")

    paths = page.evaluate(NAMES)
    say(f"[{name}] the space holds {len(paths)} files")
    for one in sorted(paths):
        say(f"[{name}]   {one}")

    plan = page.evaluate(TEXT_OF, "Plan.md")
    say(f"[{name}] the page links as: {[line for line in (plan or '').splitlines() if '[[' in line]}")
    say(f"[{name}] and carries: {[line for line in (plan or '').splitlines() if ':' in line][:4]}")

    table = page.evaluate(TEXT_OF, "Tasks.md")
    say(f"[{name}] the database reads: {[line for line in (table or '').splitlines() if '|' in line]}")

    # ── Evernote ───────────────────────────────────────────────────────────
    said = bring_in(page, shot, "enex", enex(fixtures))
    say(f"[{name}] Evernote: {said['format']}, {said['counts']}, into {said['folder']!r}")

    trip = page.evaluate(TEXT_OF, "Trip to Iceland.md")
    say(f"[{name}] the note says: {[line for line in (trip or '').splitlines() if line][:6]}")

    packing = page.evaluate(TEXT_OF, "Packing.md")
    say(f"[{name}] the boxes: {[line for line in (packing or '').splitlines() if '- [' in line]}")

    # The picture really arrived, which is what an `<img>` in the reading view says.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.path.endsWith('Trip to Iceland.md'))
          if (note) await ws.open(note.path)
        }"""
    )
    page.wait_for_timeout(700)
    shot("enex-note")

    # The bytes are in the browser's own asset store, which is where a pasted
    # picture goes too. Drawing one in the browser build is another matter: an
    # `<img>` beside a note resolves to a path on the page's own origin there,
    # which is a 404 for a pasted picture as much as for an imported one.
    held = page.evaluate(
        """async () => {
          // No version asked for: the page's own store decides which it is on, and
          // asking for an older one is an error that never resolves.
          const open = indexedDB.open('nib')
          const db = await new Promise((resolve, reject) => {
            open.onsuccess = () => resolve(open.result)
            open.onerror = () => reject(open.error)
          })
          const rows = await new Promise((resolve) => {
            const ask = db.transaction('assets').objectStore('assets').getAll()
            ask.onsuccess = () => resolve(ask.result)
            ask.onerror = () => resolve([])
          })
          return rows.map((one) => ({ path: one.path, type: one.type, bytes: one.data.length }))
        }"""
    )
    say(f"[{name}] the asset store holds: {held}")

    # ── A bare table, which is the one choice the sheet offers ─────────────
    books = fixtures / "Books.csv"
    books.write_text(
        "Name,Status,Pages,Created\n"
        'Dune,Read,412,"January 2, 2026"\n'
        'Ubik,Reading,224,"March 4, 2026"\n',
        encoding="utf-8",
    )

    page.evaluate("() => window.nibApp.importing.show()")
    page.wait_for_selector("button.drop")
    with page.expect_file_chooser() as chooser:
        page.click("button.drop")
    chooser.value.set_files(str(books))
    page.wait_for_function("() => window.nibApp.importing.stage === 'ready'", timeout=20000)
    page.wait_for_timeout(300)
    shot("table-preview")

    say(f"[{name}] as a table: {page.evaluate('() => window.nibApp.importing.counts')}")
    # By index rather than by position in the markup: the groove draws a thumb of
    # its own as a child, so the second button is not the second child.
    # Inside the sheet: the shell has grooves of its own, and the class is shared.
    choices = page.locator('[role="dialog"] .nib-segmented button')
    say(f"[{name}] the groove has {choices.count()} choices")
    choices.nth(1).click()
    page.wait_for_function(
        "() => window.nibApp.importing.rows === 'notes' && window.nibApp.importing.stage === 'ready'"
    )
    page.wait_for_timeout(300)
    shot("table-rows")
    say(f"[{name}] one note per row: {page.evaluate('() => window.nibApp.importing.counts')}")

    page.click("button.primary")
    page.wait_for_function("() => window.nibApp.importing.stage === 'done'", timeout=30000)
    page.evaluate("() => window.nibApp.importing.close()")
    page.wait_for_timeout(300)

    row = page.evaluate(TEXT_OF, "Dune.md")
    say(f"[{name}] a row reads: {[line for line in (row or '').splitlines() if line][:6]}")

    # ── One undo ───────────────────────────────────────────────────────────
    before = len(page.evaluate(NAMES))
    label = page.evaluate("() => window.nibApp.workspace.undoLabel")
    page.evaluate("async () => { await window.nibApp.workspace.undoFileAction() }")
    page.wait_for_timeout(900)
    after = len(page.evaluate(NAMES))
    say(f"[{name}] undo said {label!r}: {before} files became {after}")
    shot("undone")

    context.close()


def main() -> int:
    out = Path(__file__).resolve().parent / "shots" / "import"

    pages = Pages()
    pages.start()
    try:
        with tempfile.TemporaryDirectory(prefix="nib-import-") as held:
            fixtures = Path(held)
            with sync_playwright() as play:
                browser = play.chromium.launch(channel="chrome")
                try:
                    for one in DEVICES:
                        say(f"--- {one[0]} ---")
                        drive(browser, out, fixtures, *one)
                finally:
                    browser.close()
    finally:
        pages.stop()

    say(f"shots in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
