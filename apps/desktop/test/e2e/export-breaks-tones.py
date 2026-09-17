"""A note exported with the line-break switch on, and with all six highlight
colours in it, onto the paper the settings ask for: the real files the app hands
over, read back.

Three claims, and all of them were wrong in the app before this drive:

  * "A single newline breaks the line" on, the plain text, the RTF and the Word
    document break where the note breaks. Word's own `<w:br/>`, RTF's `\\line`, a
    newline in the text file. The switch is the one the reading view reads, so
    turning it on in the app is all this does.
  * A `==\U0001F534 careful==` and a `==\U0001F7E2 good==` do not arrive the same colour. The
    RTF names a colour of the document's own for each of the six; the Word document
    names the nearest of the seventeen `w:highlight` allows.
  * Both go out on the paper the settings ask for. The Word document had no page
    properties at all, which is Word's own Letter, and the RTF had a Letter page
    with an inch of margin written into its header by hand - so nib's A4 default,
    A5, landscape, a 33 mm margin and the running text were all dropped on the way
    into a document, while the same note printed or published honoured every one.
    Checked three times over: the settings' own default, a setup changed in the
    app, and a note whose `export:` front matter overrules both.

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

# A second note, whose own front matter says what paper it goes on whatever the
# settings say. Seeded and opened the same way the first one is.
OVERRULING = (
    "---\n"
    "export:\n"
    "  paper: Legal\n"
    "  margin: 15mm\n"
    "---\n\n"
    "# Legally\n\n"
    "This one says its own paper.\n"
)

SEED_NAMED = """
async ([note, prefix]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const written = ws.notes.find((one) => one.name.startsWith(prefix))
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

# The page, set through the app's own settings store - the same call the rows in
# Settings > Export make - so an export reads it the way it would for a person.
PAGE = """
(patch) => {
  window.nibApp.settings.setPage(patch)
  return window.nibApp.settings.page
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
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
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


def the_rtf(page: Page) -> Path:
    where = exported(page, "Export as RTF", "exported.rtf")
    rtf = where.read_text(encoding="utf8")

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

    return where


def the_word_document(page: Page) -> Path:
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

    return where


def rtf_says(where: Path) -> str:
    return where.read_text(encoding="utf8")


def rtf_page(words: str) -> str:
    """The page an RTF names, for the record: the sheet, its four margins and the
    `\\landscape` if it is turned."""
    said = re.search(r"\\paperw\d+\\paperh\d+(?:\\marg[lrtb]\d+){4}(?:\\landscape)?", words)

    return said.group(0) if said else "nothing at all"


def docx_says(where: Path) -> tuple[str, list[str]]:
    """A Word document's body and the names of every part in the package, which is
    where a header and a footer show up as parts of their own."""
    with zipfile.ZipFile(where) as package:
        return package.read("word/document.xml").decode("utf8"), package.namelist()


def docx_page(xml: str) -> dict[str, str]:
    """The section's page properties, as the attributes they are written as."""
    size = re.search(r"<w:pgSz([^>]*)/>", xml)
    margin = re.search(r"<w:pgMar([^>]*)/>", xml)
    found = dict(re.findall(r'w:(\w+)="([^"]+)"', (size.group(1) if size else "")))
    found.update(
        {f"margin-{k}": v for k, v in re.findall(r'w:(\w+)="([^"]+)"', margin.group(1))}
        if margin
        else {}
    )
    return found


def the_paper_the_settings_default_to(rtf: Path, docx: Path) -> None:
    """A4 upright with a 20 mm margin: 11909 by 16834 twips, 1134 of margin. Letter,
    which is what both writers used to hand over, is 12240 by 15840."""
    words = rtf_says(rtf)
    say(f"[rtf] the page it names: {rtf_page(words)}")
    is_true("\\paperw11909\\paperh16834" in words, "the RTF did not go out on A4")
    is_true("\\margl1134" in words, "the RTF did not take the 20 mm margin")
    is_true("\\paperw12240\\paperh15840" not in words, "the RTF is still on Letter")
    is_true("\\landscape" not in words, "the RTF turned an upright page on its side")

    xml, parts = docx_says(docx)
    found = docx_page(xml)
    say(f"[docx] the page it names: {found}")
    is_true(found.get("w") == "11909", "the Word document did not go out on A4")
    is_true(found.get("h") == "16834", "the Word document's A4 is the wrong way up")
    is_true(found.get("margin-top") == "1134", "the Word document did not take the margin")
    is_true(
        not [one for one in parts if re.match(r"word/(header|footer)\d*\.xml", one)],
        "the Word document has a running text nobody asked for",
    )


def the_paper_the_settings_ask_for(page: Page) -> None:
    """A5 on its side with a 33 mm margin and both lines of running text, set in the
    app and then read off the two files it hands over."""
    said = page.evaluate(
        PAGE,
        {
            "paper": "A5",
            "orientation": "landscape",
            "margin": "33mm",
            "header": "${title}",
            "footer": "page of ${date}",
        },
    )
    say(f"the settings now say {said}")

    words = rtf_says(exported(page, "Export as RTF", "a5-landscape.rtf"))
    say(f"[rtf] the page it names: {rtf_page(words)}")
    # RTF says the sheet as it is printed, so a turned A5 is 11909 by 8395.
    is_true("\\paperw11909\\paperh8395" in words, "the RTF did not go out on A5 on its side")
    is_true("\\landscape" in words, "the RTF did not turn the page")
    is_true("\\margl1871" in words, "the RTF did not take the 33 mm margin")
    is_true("{\\header" in words, "the RTF has no running text across the top")
    is_true("{\\footer" in words, "the RTF has no running text across the foot")
    is_true("Breaking" in words, "the RTF header did not fill in the note's title")
    is_true("${title}" not in words, "the RTF carried the placeholder through unfilled")

    xml, parts = docx_says(exported(page, "Export as Word", "a5-landscape.docx"))
    found = docx_page(xml)
    say(f"[docx] the page it names: {found}")
    # OOXML says a turned page as it is printed too, with `orient` saying which way.
    is_true(found.get("w") == "11909", "the Word document did not go out on A5 on its side")
    is_true(found.get("h") == "8395", "the Word document's A5 is the wrong way round")
    is_true(found.get("orient") == "landscape", "the Word document did not turn the page")
    is_true(found.get("margin-left") == "1871", "the Word document did not take the margin")
    running = [one for one in parts if re.match(r"word/(header|footer)\d*\.xml", one)]
    say(f"[docx] the parts the running text made: {running}")
    is_true(len(running) >= 2, "the Word document has no header and footer parts")


def the_paper_a_note_asks_for(page: Page) -> None:
    """The note's own `export:` front matter over the top of the settings, which
    still say A5 on its side."""
    say(f"the space holds {page.evaluate(SEED_NAMED, [OVERRULING, 'Legally'])}")
    wait_for(
        page,
        "window.nibApp.workspace.active?.note?.name?.startsWith('Legally')",
        "the overruling note to be the one open",
    )
    page.wait_for_timeout(300)

    words = rtf_says(exported(page, "Export as RTF", "legal.rtf"))
    say(f"[rtf] the page it names: {rtf_page(words)}")
    # Legal is 8.5 by 14 inches and 15 mm is 850 twips. The note said nothing about
    # which way round the page goes, so the settings' landscape still stands: 20160
    # by 12240 printed. A note overrules what it names and no more.
    is_true("\\paperw20160\\paperh12240" in words, "the note's own paper was ignored")
    is_true("\\margl850" in words, "the note's own margin was ignored")
    is_true("\\landscape" in words, "the note's paper threw away the settings' orientation")
    is_true("Legally" in words, "the running text still names the note before it")

    xml, _ = docx_says(exported(page, "Export as Word", "legal.docx"))
    found = docx_page(xml)
    say(f"[docx] the page it names: {found}")
    is_true(found.get("w") == "20160", "the Word document ignored the note's own paper")
    is_true(found.get("h") == "12240", "the Word document ignored the note's own paper")
    is_true(found.get("orient") == "landscape", "the Word document dropped the orientation")
    is_true(found.get("margin-top") == "850", "the Word document ignored the note's own margin")


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
    rtf = the_rtf(page)
    docx = the_word_document(page)

    # The two files above went out with the settings as they arrived, so they are
    # what says whether the default paper reaches a document at all.
    the_paper_the_settings_default_to(rtf, docx)
    the_paper_the_settings_ask_for(page)
    the_paper_a_note_asks_for(page)

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

    print(
        "\nthe breaks, the six colours and the paper reach every document format",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
