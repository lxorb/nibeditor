"""A note exported with the line-break switch on, and with all six highlight
colours in it: the real files the app hands over, read back.

Two claims, and both of them were wrong in the app before this drive:

  * "A single newline breaks the line" on, the plain text, the RTF and the Word
    document break where the note breaks. Word's own `<w:br/>`, RTF's `\\line`, a
    newline in the text file. The switch is the one the reading view reads, so
    turning it on in the app is all this does.
  * A `==\U0001F534 careful==` and a `==\U0001F7E2 good==` do not arrive the same colour. The
    RTF names a colour of the document's own for each of the six; the Word document
    names the nearest of the seventeen `w:highlight` allows.

Every file here is the one the app downloaded, not a string built in a test:
`wrapping.py` next door is the same road with the switch off.

Run it from the repository root:

    python apps/desktop/test/e2e/export-breaks-tones.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. The files it
saved stay under `shots/export-breaks-tones/` for reading afterwards.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import subprocess
import threading
import time
import zipfile
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "export-breaks-tones"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 23200
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = (
    "# Breaking\n\n"
    "A paragraph the writer typed\n"
    "on three lines\n"
    "and meant on three lines.\n\n"
    "A ==plain== one, a ==\U0001F534 red== one, a ==\U0001F7E0 orange== one, a ==\U0001F7E2 green== one,\n"
    "a ==\U0001F535 blue== one and a ==\U0001F7E3 violet== one.\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const written = ws.notes.find((one) => one.name.startsWith('Breaking'))
  await ws.openEntry(written.path, { activate: true })
  return written.name
}
"""

# The switch, turned the way the reading view reads it. The app's own toggle, so
# nothing here has a second answer to the same question.
BREAKS = """
() => {
  if (!window.nibApp.modes.hardBreaks) window.nibApp.modes.toggleHardBreaks()
  return window.nibApp.modes.hardBreaks
}
"""

# The five colours Obsidian encodes. A word of the note is never one of these, so
# finding one in an exported file is the emoji having leaked out of the mark.
EMOJI = ["\U0001F534", "\U0001F7E0", "\U0001F7E2", "\U0001F535", "\U0001F7E3"]

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def is_true(claim: bool, what: str) -> None:
    if not claim:
        wrong(what)


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
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
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


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def exported(page: Page, row: str, name: str) -> Path:
    """One export, run the way somebody would run it: the palette, the row's own
    words, Enter. What comes back is saved and handed over as a file."""
    page.keyboard.press("Control+p")
    page.wait_for_timeout(400)
    page.keyboard.type(f"> {row}")
    page.wait_for_timeout(700)

    with page.expect_download(timeout=40000) as caught:
        page.keyboard.press("Enter")

    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / name
    caught.value.save_as(str(where))
    say(f"[{name}] {where.stat().st_size} bytes")
    return where


def the_plain_text(page: Page) -> None:
    text = exported(page, "Export as Plain text", "exported.txt").read_text(encoding="utf8")
    say(f"[txt] {json.dumps(text[:200])}")

    is_true(
        "A paragraph the writer typed\non three lines\nand meant on three lines." in text,
        "the plain text joined the lines the writer meant to keep",
    )
    for emoji in EMOJI:
        is_true(emoji not in text, f"the plain text carries the {emoji} out of a highlight")


def the_rtf(page: Page) -> None:
    rtf = exported(page, "Export as RTF", "exported.rtf").read_text(encoding="utf8")

    is_true("typed\\line on three lines" in rtf, "the RTF joined the lines with a space")

    tones = [int(one) for one in re.findall(r"\\highlight(\d+) ", rtf)]
    say(f"[rtf] the highlights it names: {tones}")
    is_true(len(tones) == 6, f"the RTF has {len(tones)} highlights rather than six")
    is_true(len(set(tones)) == 6, "two highlights in the RTF came out the same colour")

    table = re.search(r"\{\\colortbl;([^}]*)\}", rtf)
    said = [one for one in (table.group(1) if table else "").split(";") if one.strip()]
    say(f"[rtf] the colour table holds {len(said)} colours")
    is_true(len(said) == 10, "the RTF colour table has no colour of its own for each tone")
    for emoji in EMOJI:
        is_true(emoji not in rtf, f"the RTF carries the {emoji} out of a highlight")


def the_word_document(page: Page) -> None:
    where = exported(page, "Export as Word", "exported.docx")
    with zipfile.ZipFile(where) as package:
        xml = package.read("word/document.xml").decode("utf8")

    is_true("<w:br/>" in xml, "the Word document has no break in it at all")
    is_true("typed on three lines" not in xml, "the Word document joined the lines")

    tones = re.findall(r'<w:highlight w:val="([a-zA-Z]+)"/>', xml)
    say(f"[docx] the highlights it names: {tones}")
    is_true(len(tones) == 6, f"the Word document has {len(tones)} highlights rather than six")
    is_true(len(set(tones)) == 6, "two highlights in the Word document came out the same colour")
    is_true("yellow" in tones, "the plain highlight is no longer Word's yellow")
    for emoji in EMOJI:
        is_true(emoji not in xml, f"the Word document carries the {emoji} out of a highlight")


def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    # A first visit is given a welcome note and the app opens it after the space
    # rather than with it, so the note this drive is about is seeded once that has
    # happened; see `restore` in workspace.svelte.ts and wrapping.py next door.
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    wait_for(
        page,
        "window.nib && document.querySelector('.cm-content')"
        " && window.nibApp.workspace.active?.note?.name?.startsWith('Breaking')",
        "the note to be the one open",
    )

    say(f"the line-break switch is on: {page.evaluate(BREAKS)}")
    page.wait_for_timeout(400)
    shot(page, "01-written")

    the_plain_text(page)
    the_rtf(page)
    the_word_document(page)

    context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                drive(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe breaks and the six colours reach every document format", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
