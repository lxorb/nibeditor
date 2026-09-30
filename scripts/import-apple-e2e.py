"""Apple's two apps imported for real, in a browser, against the web build.

The unit tests measure the readers on plain objects. This measures the whole road:
the palette row somebody presses, the sheet that says what it found, the file
chooser the drop zone opens, and the notes that are in the space afterwards - read
back out of the app's own storage rather than out of the plan the sheet held.

Two exports go in, both built here from the shape Apple's own export and the
third-party exporters are documented to write:

  AppleJournalEntries.zip   Index.html, Entries/<date>_<id>.html, Resources/
  Apple Notes export.zip    a folder per notebook, a file per note, Apple's HTML

And one thing is checked by not being there: the row that reads the Mac's own
Notes database is a desktop-on-macOS row, and a browser must not offer it.

Run it with the repository's own Chromium:

    python scripts/import-apple-e2e.py

It builds nothing. `pnpm --filter @nib/desktop build` first, then this."""

import functools
import http.server
import json
import os
import pathlib
import shutil
import socket
import struct
import sys
import threading
import zipfile
import zlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "desktop" / "dist"
OUT = ROOT / "target" / "import-apple-e2e"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

# The range this repository's drives are allowed to listen on.
PORTS = range(19400, 19500)

# One note, so the space exists and the import has somewhere to land.
SEEDED = "/Notes/Already here.md"

PHOTO = "A1B2C3D4-1111-2222-3333-444455556666"
CLIP = "B2C3D4E5-1111-2222-3333-444455556666"
MOOD = "C3D4E5F6-1111-2222-3333-444455556666"


# ── The two exports ───────────────────────────────────────────────────

ENTRY = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="Generator" content="Cocoa HTML Writer">
<title>Journal</title>
<style>.pageHeader { font-size: 11px } .p2 { margin: 0 }</style>
</head>
<body>
<div class="pageHeader">Friday, September 4, 2026</div>
<div class="entry">
<div class="title"><span class="s1"></span><span class="s2">Evening on the lake</span></div>
<div class="gridItem assetType_photo" id="PHOTO">
<img src="../Resources/PHOTO.heic" alt="">
</div>
<div class="gridItem assetType_video" id="CLIP">
<video controls>
<source src="../Resources/CLIP.mov" type="video/quicktime">
</video>
</div>
<div class="gridItem assetType_stateOfMind" id="MOOD">
<span class="s2">Calm</span>
</div>
<div class="bodyText">
<p class="p2"><span class="s2">Swam at seven, then sat on the jetty.</span></p>
<p class="p2"><span class="s3">The water was warmer than the air.</span></p>
</div>
</div>
</body>
</html>
""".replace("PHOTO", PHOTO).replace("CLIP", CLIP).replace("MOOD", MOOD)

# A second entry the same day, with no title: what an entry somebody only wrote
# in looks like.
BARE = """<html><body>
<div class="pageHeader">Saturday, September 5, 2026</div>
<div class="bodyText"><p class="p2"><span class="s2">Rained all afternoon.</span></p></div>
</body></html>
"""

# What every Apple Notes exporter hands over, because every one of them asks the
# system for the note's rich text and macOS writes rich text this way.
EXPORTED = """<html>
<head><meta name="Generator" content="Cocoa HTML Writer"></head>
<body>
<p class="p1"><span class="s1" style="font: 24.0px '-apple-system-font'">TITLE</span></p>
<p class="p1"><span class="s1">BODY</span></p>
<p class="p1"><img src="file:///Users/emil/Exported/Notes/photo.png"></p>
</body>
</html>
"""


def png(width: int, height: int, tint: int) -> bytes:
    """A real PNG, so what arrives beside the notes is a picture."""

    def chunk(kind: bytes, body: bytes) -> bytes:
        return (
            struct.pack(">I", len(body))
            + kind
            + body
            + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
        )

    raw = b""
    for y in range(height):
        raw += b"\x00"
        for x in range(width):
            raw += bytes(((x * 9) % 256, (y * 9) % 256, tint))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def journal_export() -> pathlib.Path:
    """Journal's own export: entries as HTML, media and metadata beside them."""
    path = OUT / "AppleJournalEntries.zip"

    with zipfile.ZipFile(path, "w") as zip_:
        zip_.writestr(
            "AppleJournalEntries/Index.html",
            '<html><body><a href="Entries/2026-09-04_9E1C2D3E.html">one</a></body></html>',
        )
        zip_.writestr("AppleJournalEntries/Entries/2026-09-04_9E1C2D3E.html", ENTRY)
        zip_.writestr("AppleJournalEntries/Entries/2026-09-05_1F2A3B4C.html", BARE)
        # HEIC by name, since what matters here is that it is said out loud and
        # carried whole rather than what is inside it.
        zip_.writestr(f"AppleJournalEntries/Resources/{PHOTO}.heic", png(24, 16, 90))
        zip_.writestr(f"AppleJournalEntries/Resources/{CLIP}.mov", b"\x00\x00\x00\x14ftypqt  ")
        zip_.writestr(
            f"AppleJournalEntries/Resources/{PHOTO}.json",
            json.dumps({"date": 810172800, "placeName": "Zurichsee"}),
        )

    return path


def notes_export() -> pathlib.Path:
    """What a third-party exporter writes: a folder per notebook, at the top."""
    path = OUT / "Apple Notes export.zip"

    with zipfile.ZipFile(path, "w") as zip_:
        zip_.writestr(
            "Notes/Groceries.html",
            EXPORTED.replace("TITLE", "Groceries").replace("BODY", "Milk and eggs"),
        )
        zip_.writestr("Notes/photo.png", png(20, 12, 200))
        zip_.writestr(
            "Work/Ideas.html",
            EXPORTED.replace("TITLE", "Ideas").replace("BODY", "A folder per notebook"),
        )

    return path


# ── The app ───────────────────────────────────────────────────────────


def chrome() -> pathlib.Path:
    """The newest Chromium the repository's Playwright has fetched."""
    found = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))
    if not found:
        raise SystemExit(f"no Chromium under {CHROME_HOME}")

    return found[-1]


def free_port() -> int:
    """A port in this repository's own range, so two drives at once do not
    collide and neither of them takes the dev server's."""
    for port in PORTS:
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port

    raise SystemExit(f"no free port in {PORTS.start}-{PORTS.stop - 1}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The build, served without a line per request."""

    def log_message(self, *_args):
        pass


def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server


SEED = """
async ([notePath, note]) => {
  // No version: the app has opened this database already and made its stores,
  // and asking for a version behind the one it made is an error rather than an
  // upgrade. So this is a row in a store that is there.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  if (!db.objectStoreNames.contains('files')) throw new Error('no files store yet')

  const now = Date.now()
  await new Promise((resolve, reject) => {
    const request = db
      .transaction('files', 'readwrite')
      .objectStore('files')
      .put({ path: notePath, content: note, modified: now, created: now })
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

  return true
}
"""

STORED = """
async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const all = (name) => new Promise((resolve) => {
    if (!db.objectStoreNames.contains(name)) return resolve([])
    const request = db.transaction(name).objectStore(name).getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve([])
  })

  const files = await all('files')
  const assets = await all('assets')

  return {
    notes: Object.fromEntries(files.map((one) => [one.path, one.content])),
    assets: Object.fromEntries(assets.map((one) => [one.path, (one.data ?? '').length])),
  }
}
"""

ROWS = """() =>
  [...document.querySelectorAll('#nib-palette-list .nib-row-label')].map((row) =>
    row.textContent.trim(),
  )
"""

SHEET = """() => {
  const sheet = document.querySelector('.sheet')
  return sheet ? sheet.innerText : ''
}
"""


def open_import(page) -> list[str]:
    """The palette's own Import row, pressed."""
    page.keyboard.press("Control+p")
    page.wait_for_timeout(250)
    page.keyboard.type(">Import")
    page.wait_for_timeout(700)

    rows = page.evaluate(ROWS)
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)

    return rows


def hand_over(page, export: pathlib.Path) -> None:
    """The export, handed to the drop zone's own file chooser."""
    with page.expect_file_chooser(timeout=20000) as caught:
        page.click(".sheet button.drop")

    caught.value.set_files(str(export))
    page.wait_for_timeout(2500)


def press_import(page) -> None:
    # The sheet's buttons are the app's one button shape now (`nib-button`), so the
    # press is found by what it says rather than by a class it no longer has.
    page.locator(".sheet").get_by_role("button", name="Import", exact=True).click()
    page.wait_for_timeout(2500)


def one_import(page, export: pathlib.Path, key: str, report: dict) -> str:
    """One whole import: the sheet, the press, and what the sheet said."""
    open_import(page)
    hand_over(page, export)

    said = page.evaluate(SHEET)
    page.screenshot(path=str(OUT / f"{key}-the-sheet.png"))
    report[f"{key}: what the sheet said"] = said

    press_import(page)
    report[f"{key}: what it said after"] = page.evaluate(SHEET)
    page.screenshot(path=str(OUT / f"{key}-written.png"))

    # Done, so the sheet closes and the next import starts clean.
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)

    return said


def faults_journal(said: str, stored: dict) -> list[str]:
    """What the Journal import has to have done."""
    bad = []
    notes = stored["notes"]

    if "Apple Journal" not in said:
        bad.append("the sheet did not name the format")
    if "Journal" not in said:
        bad.append("the import was not named after the app")
    for wanted in ["HEIC", "mood and activity"]:
        if wanted not in said:
            bad.append(f"the sheet did not say {wanted!r}")

    first = "/Notes/Journal/2026-09-04 Evening on the lake.md"
    if first not in notes:
        return bad + [f"no note at {first}: {sorted(notes)}"]

    text = notes[first]
    if not text.startswith("---\ndate: 2026-09-04\n---\n"):
        bad.append(f"front matter: {text[:60]!r}")
    if "# Evening on the lake" not in text:
        bad.append("no heading")
    if "Swam at seven" not in text or "Calm" not in text:
        bad.append("the words or the mood did not come over")
    if f"![](assets/{PHOTO}.heic)" not in text:
        bad.append("the picture is not pointed at")
    if f"assets/{CLIP}.mov" not in text:
        bad.append("the video is not pointed at")
    if "Friday, September 4, 2026" in text:
        bad.append("the date line is in the words as well as the front matter")

    second = "/Notes/Journal/2026-09-05.md"
    if second not in notes:
        bad.append(f"the untitled entry is not at {second}")

    for asset in [f"/Notes/Journal/assets/{PHOTO}.heic", f"/Notes/Journal/assets/{CLIP}.mov"]:
        if asset not in stored["assets"] and asset not in notes:
            bad.append(f"no file at {asset}")

    if any(path.endswith(".json") for path in notes):
        bad.append("Journal's own JSON came in as a note")
    if any("Index" in path for path in notes):
        bad.append("the export's index came in as a note")

    return bad


def faults_notes(said: str, stored: dict) -> list[str]:
    """And what the exporter's folder has to have done."""
    bad = []
    notes = stored["notes"]

    if "Apple Notes" not in said:
        bad.append("the sheet did not name the format")

    # Named after the file that was picked, which is the rule for every import.
    first = "/Notes/Apple Notes export/Notes/Groceries.md"
    if first not in notes:
        return bad + [f"no note at {first}: {sorted(notes)}"]

    text = notes[first]
    if "Groceries" not in text or "Milk and eggs" not in text:
        bad.append("the words did not come over")
    if "![](photo.png)" not in text:
        bad.append(f"the attachment's own address was not followed: {text!r}")

    if "/Notes/Apple Notes export/Work/Ideas.md" not in notes:
        bad.append("the second notebook did not arrive as a folder")

    return bad


def main() -> int:
    if not DIST.is_dir():
        raise SystemExit(f"no build at {DIST}; run pnpm --filter @nib/desktop build")

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    journal = journal_export()
    exported = notes_export()

    url, server = serve()
    report: dict[str, object] = {}
    failures: list[str] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))
        context = browser.new_context(viewport={"width": 1400, "height": 950})
        page = context.new_page()

        problems: list[str] = []
        page.on("pageerror", lambda error: problems.append(f"page error: {error}"))
        page.on(
            "console",
            lambda message: problems.append(f"console: {message.text}")
            if message.type == "error"
            else None,
        )

        try:
            page.goto(url)
            page.wait_for_timeout(2500)
            page.evaluate(SEED, [SEEDED, "# Already here\n"])
            page.reload()
            page.wait_for_timeout(2500)

            rows = open_import(page)
            report["rows the palette offers"] = rows
            if not rows or rows[0] != "Import":
                failures.append(f"the palette has no Import row: {rows}")

            # The Mac's own database is a desktop row on macOS, so a browser must
            # not offer it however the sheet is opened.
            waiting = page.evaluate(SHEET)
            report["the sheet before anything is picked"] = waiting
            if "this Mac" in waiting:
                failures.append("a browser offered to read the Mac's own notes")
            if "Apple Journal exports itself" not in waiting:
                failures.append(f"the sheet does not say what Apple's apps need: {waiting!r}")

            page.keyboard.press("Escape")
            page.wait_for_timeout(500)

            said = one_import(page, journal, "journal", report)
            stored = page.evaluate(STORED)
            report["journal: what is in the space"] = sorted(stored["notes"])
            bad = faults_journal(said, stored)
            report["journal: faults"] = bad
            failures += [f"journal: {one}" for one in bad]

            said = one_import(page, exported, "notes", report)
            stored = page.evaluate(STORED)
            report["notes: what is in the space"] = sorted(stored["notes"])
            bad = faults_notes(said, stored)
            report["notes: faults"] = bad
            failures += [f"notes: {one}" for one in bad]

            report["page problems"] = problems[:10]
        finally:
            context.close()
            browser.close()
            server.shutdown()

    (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))

    print(
        "\nnot exercised here: the Mac's own Notes database, which is a macOS"
        " command and has the crate's own tests over a fixture database"
    )

    if failures:
        print("\nFAILED")
        for one in failures:
            print(" -", one)
        return 1

    print("\nboth of Apple's exports arrived whole, through the sheet a reader presses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
