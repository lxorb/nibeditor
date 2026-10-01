"""Every export, run in a real browser against the web build, and the file each
one produced opened again and looked at.

The unit tests measure the converters; this measures the whole road: the palette
row a person presses, the note the app holds, the pictures it reads out of its own
storage, and the file the browser is handed to save. A converter can be right and
the export still be wrong - a row that is not wired up, a picture the page never
fetched, a download with the wrong name - and none of that shows up in a unit
test.

Run it with the repository's own Chromium:

    python scripts/export-e2e.py

It builds nothing. `pnpm --filter @nib/desktop build` first, then this."""

import base64
import functools
import http.server
import json
import os
import pathlib
import re
import shutil
import socket
import sys
import threading
import zipfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "desktop" / "dist"
OUT = ROOT / "target" / "export-e2e"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

NOTE_PATH = "/Notes/Export corpus.md"
OTHER_PATH = "/Notes/Another note.md"
ASSET_PATH = "/Notes/assets/corpus.png"

NOTE_TEMPLATE = r"""---
title: Export corpus
author: Ada Lovelace
lang: en
date: 2026-09-08
---

# Export corpus

Prose with **bold**, *italic*, ~~struck~~, ==marked==, `inline code`, H~2~O,
x^2^, a [link](https://nibeditor.com), a footnote[^one] and inline maths
$E = mc^2$.

[^one]: The footnote's own words.

## A table

| Left | Middle | Right |
| :--- | :----: | ----: |
| one | alpha | 1 |
| two | beta | 22 |

## Code

```ts
const answer: number = 42
  const indented = true
```

## Display maths

$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$

## Pictures

![Pasted picture](assets/corpus.png)

![Remote picture](REMOTE_URL)

## Links and lists

A wikilink to [[Another note]] and one with an alias [[Another note|the other]].

- plain bullet
  - nested bullet
- [x] done
- [ ] open

1. first
2. second

> A blockquote, with **bold** inside it.

> [!NOTE]
> Careful with that.

<div style="page-break-after: always;"></div>

## Diagram

```mermaid
graph TD; A-->B
```
"""

OTHER = "# Another note\n\nSomewhere for the wikilink to point.\n"

# The nine formats plus PNG, by the label the palette shows and the file each is
# expected to hand over. PDF is not here: on the web it goes to the print dialog,
# which a headless browser has no way to answer. See `report` at the bottom.
DOWNLOADS = [
    ("txt", "Export as Plain text", "Export corpus.txt"),
    ("md", "Export as Markdown", "Export corpus.md"),
    ("textbundle", "Export as TextBundle", "Export corpus.textpack"),
    ("rtf", "Export as RTF", "Export corpus.rtf"),
    ("jpg", "Export as JPG", "Export corpus.jpg"),
    ("png", "Export as PNG", "Export corpus.png"),
    ("html", "Export as HTML", "Export corpus.html"),
    ("docx", "Export as Word", "Export corpus.docx"),
    ("epub", "Export as ePub", "Export corpus.epub"),
    ("md-assets", "Export as Markdown with the pictures", "Export corpus.zip"),
    ("html-bare", "Export as HTML without styles", "Export corpus.html"),
]


def chrome() -> pathlib.Path:
    """The newest Chromium the repository's Playwright has fetched."""
    found = sorted(CHROME_HOME.glob("chromium-1*/chrome-win*/chrome.exe"))
    if not found:
        raise SystemExit(f"no Chromium under {CHROME_HOME}")

    return found[-1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class Quiet(http.server.SimpleHTTPRequestHandler):
    """The build, served without a line per request."""

    def log_message(self, *_args):
        pass

    def do_GET(self):  # noqa: N802
        # The note names one picture the app has to fetch rather than read out of
        # its own storage, which is what proves a remote picture reaches the file.
        if self.path == "/remote.png":
            body = (ROOT / "target" / "export-e2e" / "remote.png").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()


def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server


def png(width: int, height: int, tint: int) -> bytes:
    """A real PNG of a given size, so what comes out can be measured."""
    import struct
    import zlib

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


SEED = """
async ([notePath, note, otherPath, other, assetPath, assetData]) => {
  // Whatever version the app made, rather than a number this script would have to
  // keep in step with web/store.ts: the page has already opened the database by the
  // time this runs, so the stores are there.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const put = (store, row) => new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(row)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })

  // Two rows per note, because the app keeps the listing apart from the words:
  // `files` is what a note is read from and `stats` is what the file list walks.
  // See web/store.ts.
  const seedNote = (path, content, now) => new Promise((resolve, reject) => {
    const change = db.transaction(['files', 'stats'], 'readwrite')
    change.objectStore('files').put({ path, content, modified: now, created: now })
    change.objectStore('stats').put({ path, modified: now, created: now })
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })

  const now = Date.now()
  await seedNote(notePath, note, now)
  await seedNote(otherPath, other, now)
  await put('assets', { path: assetPath, type: 'image/png', data: assetData, modified: now })
  return true
}
"""

# The palette's rows. They are `.nib-row` now, the same row the file list is made
# of, and the words in one are its `.nib-row-label`; the palette had a row shape of
# its own with a `.text` in it when this was written. See Palette.svelte.
ROWS = """() =>
  [...document.querySelectorAll('.palette .nib-row .nib-row-label')]
    .map((row) => row.textContent.trim())
"""


def open_note(page, name: str) -> None:
    page.keyboard.press("Control+o")
    page.wait_for_timeout(300)
    page.keyboard.type(name)
    page.wait_for_timeout(700)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1800)


def palette(page, term: str) -> list[str]:
    page.keyboard.press("Control+o")
    page.wait_for_timeout(250)
    page.keyboard.type(">" + term)
    page.wait_for_timeout(700)

    return page.evaluate(ROWS)


def run_export(page, key: str, label: str) -> tuple[str, pathlib.Path] | None:
    """Runs one export row and saves what the browser was handed.

    Each in a folder of its own: two rows hand over a file of the same name - the
    page with its styles and the page without them are both `.html` - and one
    folder would leave only whichever ran last."""
    page.keyboard.press("Control+o")
    page.wait_for_timeout(250)
    page.keyboard.type(">" + label)
    page.wait_for_timeout(700)

    rows = page.evaluate(ROWS)
    if not rows or rows[0] != label:
        page.keyboard.press("Escape")
        return None

    with page.expect_download(timeout=60000) as caught:
        page.keyboard.press("Enter")

    download = caught.value
    folder = OUT / key
    folder.mkdir(exist_ok=True)
    target = folder / download.suggested_filename
    download.save_as(str(target))

    return download.suggested_filename, target


# ── What each file has to hold ────────────────────────────────────────

WANTED_TEXT = [
    "Export corpus",
    "Prose with bold, italic, struck, marked, inline code",
    # The paragraph wraps in the source, and a plain text export keeps the
    # note's own line breaks rather than reflowing them.
    "link (https://nibeditor.com)",
    "const answer: number = 42",
    "  const indented = true",
    "- [x] done",
    "- [ ] open",
    "> Note",
    "[Pasted picture]",
    # The columns line up, and the right hand one is right aligned.
    "Left  Middle  Right",
    "one   alpha       1",
    "two   beta       22",
    "[one] The footnote's own words.",
]


def check_txt(path: pathlib.Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    bad = [f"missing {wanted!r}" for wanted in WANTED_TEXT if wanted not in text]
    for mark in ["**", "==", "~~", "[[", "](", "#"]:
        if mark in text:
            bad.append(f"still holds {mark!r}")

    return bad


def check_md(path: pathlib.Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    bad = []
    if not text.startswith("---\ntitle: Export corpus"):
        bad.append("front matter missing")
    if "[[" in text:
        bad.append("a wikilink was left as brackets")
    if "[Another note](Another%20note.md)" not in text:
        bad.append("a wikilink did not become a relative link")
    if "[the other](Another%20note.md)" not in text:
        bad.append("an aliased wikilink lost its words")
    if "**bold**" not in text:
        bad.append("the note itself was changed")

    return bad


def check_html(path: pathlib.Path, standalone: bool) -> list[str]:
    text = path.read_text(encoding="utf-8")
    bad = []

    if "<title>Export corpus</title>" not in text:
        bad.append("no title")
    if "<table>" not in text:
        bad.append("no table")
    if "katex" not in text:
        bad.append("no rendered maths")
    if "<svg" not in text:
        bad.append("the diagram was not drawn")
    if "footnotes" not in text:
        bad.append("no footnotes")
    if "checkbox" not in text:
        bad.append("no task list")

    pictures = re.findall(r'<img\b[^>]*?\bsrc="([^"]*)"', text)
    if len(pictures) < 2:
        bad.append(f"only {len(pictures)} pictures")

    if standalone:
        if "@font-face" not in text:
            bad.append("the maths fonts were not carried")
        if "hl-keyword" not in text and "<span class=" not in text:
            bad.append("the code was not coloured")
        remote = [src for src in pictures if not src.startswith("data:")]
        if remote:
            bad.append(f"not offline-complete: {remote}")
    else:
        # A drawn diagram carries a `<style>` of its own inside its SVG, so what
        # says the page is bare is the absence of the theme, not of the tag.
        if "--bg:" in text or "@page" in text:
            bad.append("the bare page carries the theme")
        if not any(src.startswith("assets/") for src in pictures):
            bad.append("the bare page lost the path the note wrote")

    return bad


def check_rtf(path: pathlib.Path) -> list[str]:
    text = path.read_text(encoding="latin-1")
    bad = []

    if not text.startswith("{\\rtf1"):
        bad.append("does not open as RTF")
    if text.count("{") != text.count("}"):
        bad.append("braces do not balance")
    for wanted in ["\\fonttbl", "\\colortbl", "\\pngblip", "\\trowd", "\\cell", "\\footnote"]:
        if wanted not in text:
            bad.append(f"no {wanted}")
    if "HYPERLINK" not in text or "nibeditor.com" not in text:
        bad.append("the link did not survive")
    if "\\u" not in text:
        bad.append("nothing was escaped as Unicode")
    if "Export corpus" not in text:
        bad.append("no title")

    return bad


def check_docx(path: pathlib.Path) -> list[str]:
    bad = []
    with zipfile.ZipFile(path) as zip_:
        names = zip_.namelist()
        for wanted in [
            "[Content_Types].xml",
            "word/document.xml",
            "word/styles.xml",
            "word/numbering.xml",
            "word/footnotes.xml",
            "docProps/core.xml",
        ]:
            if wanted not in names:
                bad.append(f"no {wanted}")

        document = zip_.read("word/document.xml").decode("utf-8")
        core = zip_.read("docProps/core.xml").decode("utf-8")
        rels = zip_.read("word/_rels/document.xml.rels").decode("utf-8")

        media = [name for name in names if name.startswith("word/media/") and name[-1] != "/"]
        if len(media) != 2:
            bad.append(f"{len(media)} pictures in the package, wanted 2")

        # Every relationship the document names has to resolve.
        declared = set(re.findall(r'Id="([^"]+)"', rels))
        used = set(re.findall(r'r:(?:id|embed)="([^"]+)"', document))
        if used - declared:
            bad.append(f"unresolved relationships: {sorted(used - declared)}")

        for wanted, what in [
            ("<m:oMath>", "the maths as OMML"),
            ("<w:tbl>", "the table"),
            ("<w:tblHeader/>", "a repeating header row"),
            ("<w:footnoteReference", "a footnote reference"),
            ("<w:numPr>", "real numbering"),
            ("☑", "a ticked checkbox"),
            ("☐", "an empty checkbox"),
            ("const answer: number = 42", "the code"),
        ]:
            if wanted not in document:
                bad.append(f"no {what}")

        if "Export corpus" not in core:
            bad.append("no title in the properties")
        if "Ada Lovelace" not in core:
            bad.append("no author in the properties")

    return bad


def check_epub(path: pathlib.Path) -> list[str]:
    bad = []
    with zipfile.ZipFile(path) as zip_:
        names = zip_.namelist()

        if names[0] != "mimetype":
            bad.append(f"the first entry is {names[0]!r}, not mimetype")
        if zip_.read("mimetype") != b"application/epub+zip":
            bad.append("the mimetype is not exactly right")
        if zip_.getinfo("mimetype").compress_type != zipfile.ZIP_STORED:
            bad.append("the mimetype is compressed")

        for wanted in ["META-INF/container.xml", "OEBPS/package.opf", "OEBPS/nav.xhtml"]:
            if wanted not in names:
                bad.append(f"no {wanted}")

        opf = zip_.read("OEBPS/package.opf").decode("utf-8")
        if "Export corpus" not in opf:
            bad.append("no title in the package")
        if "Ada Lovelace" not in opf:
            bad.append("no author in the package")
        if "dcterms:modified" not in opf:
            bad.append("no modified date, which EPUB 3 requires")

        # Every manifest href has to be a part that is actually there, and every
        # spine idref a manifest item.
        hrefs = dict(re.findall(r'id="([^"]+)"[^>]*?href="([^"]+)"', opf))
        for one, href in hrefs.items():
            if f"OEBPS/{href}" not in names:
                bad.append(f"{one} points at {href}, which is not in the book")

        for idref in re.findall(r'idref="([^"]+)"', opf):
            if idref not in hrefs:
                bad.append(f"the spine names {idref}, which the manifest does not")

        sections = [name for name in names if re.search(r"section-\d+\.xhtml$", name)]
        if not sections:
            bad.append("no sections")

        pictures = [
            name for name in names if name.startswith("OEBPS/images/") and name[-1] != "/"
        ]
        if len(pictures) != 2:
            bad.append(f"{len(pictures)} pictures in the book, wanted 2")

        body = "".join(zip_.read(name).decode("utf-8") for name in sections)
        if "../images/" not in body:
            bad.append("the pictures were not pointed at the package")
        if "katex" not in body:
            bad.append("no rendered maths")
        if "<table" not in body:
            bad.append("no table")

    return bad


def check_textpack(path: pathlib.Path) -> list[str]:
    bad = []
    with zipfile.ZipFile(path) as zip_:
        names = zip_.namelist()
        tops = {name.split("/")[0] for name in names}
        if len(tops) != 1:
            bad.append(f"more than one folder at the top: {sorted(tops)}")

        folder = next(iter(tops))
        info = json.loads(zip_.read(f"{folder}/info.json"))
        if info.get("version") != 2:
            bad.append(f"version {info.get('version')!r}, wanted 2")
        if info.get("type") != "net.daringfireball.markdown":
            bad.append(f"type {info.get('type')!r}")

        text = zip_.read(f"{folder}/text.md").decode("utf-8")
        if "![Pasted picture](assets/corpus.png)" not in text:
            bad.append("the local picture was not pointed at assets/")
        if "![Remote picture](assets/remote.png)" not in text:
            bad.append("the remote picture was not brought into the bundle")

        assets = [name for name in names if "/assets/" in name and name[-1] != "/"]
        if len(assets) != 2:
            bad.append(f"{len(assets)} pictures in the bundle, wanted 2")

    return bad


def check_zip_beside(path: pathlib.Path) -> list[str]:
    bad = []
    with zipfile.ZipFile(path) as zip_:
        names = zip_.namelist()
        if "Export corpus.md" not in names:
            bad.append(f"the note is not in it: {names}")
        if "info.json" in names:
            bad.append("it carries a bundle's metadata, which this is not")
        beside = [name for name in names if name.startswith("assets/") and name[-1] != "/"]
        if len(beside) != 2:
            bad.append(f"pictures: {names}")

    return bad


def check_picture(path: pathlib.Path, kind: str) -> list[str]:
    raw = path.read_bytes()
    bad = []

    if kind == "png":
        if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            bad.append("not a PNG")
        else:
            import struct

            width, height = struct.unpack(">II", raw[16:24])
            bad += size_notes(width, height)
    else:
        if not raw.startswith(b"\xff\xd8"):
            bad.append("not a JPEG")
        else:
            width, height = jpeg_size(raw)
            bad += size_notes(width, height)

    if len(raw) < 5000:
        bad.append(f"only {len(raw)} bytes, which is not a page of a note")

    return bad


def size_notes(width: int, height: int) -> list[str]:
    bad = []
    # Two device pixels per CSS pixel, over a page a good deal taller than wide.
    if width < 1200:
        bad.append(f"only {width} pixels wide, so it is not drawn at 2x")
    if height < width:
        bad.append(f"{width}x{height} is not the shape of a note")

    return bad


def jpeg_size(raw: bytes) -> tuple[int, int]:
    at = 2
    while at < len(raw) - 9:
        if raw[at] != 0xFF:
            at += 1
            continue

        marker = raw[at + 1]
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            height = int.from_bytes(raw[at + 5 : at + 7], "big")
            width = int.from_bytes(raw[at + 7 : at + 9], "big")
            return width, height

        at += 2 + int.from_bytes(raw[at + 2 : at + 4], "big")

    return 0, 0


CHECKS = {
    "txt": check_txt,
    "md": check_md,
    "textbundle": check_textpack,
    "rtf": check_rtf,
    "jpg": lambda path: check_picture(path, "jpg"),
    "png": lambda path: check_picture(path, "png"),
    "html": lambda path: check_html(path, True),
    "docx": check_docx,
    "epub": check_epub,
    "md-assets": check_zip_beside,
    "html-bare": lambda path: check_html(path, False),
}


def main() -> int:
    if not DIST.is_dir():
        raise SystemExit(f"no build at {DIST}; run pnpm --filter @nib/desktop build")

    # Emptied rather than removed: a document still open in a word processor
    # holds its folder, and a run that cannot start is worse than a stale file.
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "remote.png").write_bytes(png(160, 90, 40))
    (OUT / "corpus.png").write_bytes(png(48, 32, 200))

    url, server = serve()
    report: dict[str, object] = {}
    failures: list[str] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))
        context = browser.new_context(
            accept_downloads=True, viewport={"width": 1400, "height": 900}
        )
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
            page.evaluate(
                SEED,
                [
                    NOTE_PATH,
                    NOTE_TEMPLATE.replace("REMOTE_URL", f"{url}remote.png"),
                    OTHER_PATH,
                    OTHER,
                    ASSET_PATH,
                    base64.b64encode((OUT / "corpus.png").read_bytes()).decode(),
                ],
            )
            page.reload()
            page.wait_for_timeout(2500)
            open_note(page, "Export corpus")
            page.screenshot(path=str(OUT / "00-the-note.png"))

            rows = palette(page, "Export as")
            report["rows the palette offers"] = rows
            page.keyboard.press("Escape")
            page.wait_for_timeout(200)

            for key, label, expected in DOWNLOADS:
                got = run_export(page, key, label)
                if got is None:
                    report[key] = {"failed": "no such row in the palette"}
                    failures.append(f"{key}: no such row")
                    continue

                name, path = got
                faults = CHECKS[key](path)
                report[key] = {
                    "row": label,
                    "file": name,
                    "bytes": path.stat().st_size,
                    "faults": faults,
                }

                if name != expected:
                    faults.append(f"named {name!r}, wanted {expected!r}")
                if faults:
                    failures.append(f"{key}: {'; '.join(faults)}")

                page.wait_for_timeout(300)

            report["page problems"] = problems[:10]
        finally:
            context.close()
            browser.close()
            server.shutdown()

    (OUT / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))

    # PDF is the one row this cannot press: on the web it opens the browser's own
    # print dialog, which is the only place "Save as PDF" lives there, and a
    # headless browser has nothing to answer it with. The desktop build writes the
    # file itself through the webview's print engine; see pdf.rs.
    print("\nnot exercised here: PDF, which on the web is the browser's print dialog")

    if failures:
        print("\nFAILED")
        for one in failures:
            print(" -", one)
        return 1

    print("\nevery export produced a file that opens and holds what the note said")
    return 0


if __name__ == "__main__":
    sys.exit(main())
