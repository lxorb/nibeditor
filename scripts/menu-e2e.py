"""The menu bar and a rich paste, in a real browser against the web build.

Two things a unit test cannot see. The menu's shape is data and is tested as data,
but whether a person can actually reach Export under File, and whether the rows are
legible in both schemes, is a picture; and a paste is a browser event carrying two
flavours of clipboard at once, which is exactly the part no state-level test has.

So this opens the built app, pastes a page of HTML into a note and reads back the
markdown that landed, then photographs all six menus in the light scheme and again
in the dark one.

Run it with the repository's own Chromium:

    python scripts/menu-e2e.py

It builds nothing. `pnpm --filter @nib/desktop build` first, then this."""

import functools
import http.server
import json
import os
import pathlib
import shutil
import socket
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "apps" / "desktop" / "dist"
OUT = ROOT / "target" / "menu-e2e"

CHROME_HOME = pathlib.Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"

NOTE_PATH = "/Notes/Menus.md"
NOTE = "# Menus\n\nA note for the pictures below.\n"

# The groups the menu bar holds, by the word each one shows.
GROUPS = ["File", "Edit", "Paragraph", "Format", "View", "Help"]

# A page as a browser puts it on the clipboard: a whole document, head and all,
# with everything the converter has an opinion about.
PASTED_HTML = """<html><head><title>A tab nobody wants</title>
<style>p { color: red }</style></head><body>
<h2>Pasted heading</h2>
<p><strong>bold</strong> and <em>italic</em>, <del>struck</del>, <mark>marked</mark>,
and a <a href="https://nibeditor.com">link</a>.</p>
<ul><li>one</li><li>two<ul><li>under</li></ul></li></ul>
<ol start="3"><li>three</li></ol>
<table><thead><tr><th>Left</th><th>Right</th></tr></thead>
<tbody><tr><td>a</td><td>1</td></tr></tbody></table>
<pre><code class="language-ts">const x: number = 1</code></pre>
<p><img src="https://nibeditor.com/one.png" alt="a picture"></p>
<script>window.mischief = 1</script>
</body></html>"""

# What has to be in the note afterwards, and what must not.
WANTED = [
    "## Pasted heading",
    "**bold** and *italic*",
    "~~struck~~",
    "==marked==",
    "[link](https://nibeditor.com)",
    "- one",
    "- two",
    "  - under",
    "3. three",
    "| Left | Right |",
    "| a | 1 |",
    "```ts",
    "const x: number = 1",
    "![a picture](https://nibeditor.com/one.png)",
]

UNWANTED = [
    "A tab nobody wants",
    "color: red",
    "window.mischief",
    # Turndown's own three spaces after a bullet, which the app does not write.
    "-   one",
    "<strong>",
    # Ctrl+/ is source mode. CodeMirror binds its own comment toggle to the same
    # chord underneath, and both used to fire: reading the note back wrapped the
    # line the caret was on in a comment. See `claim` in the editor's keymap.
    "<!--",
]

SEED = """
async ([path, text]) => {
  // Whatever version the app made, rather than a number this script would have to
  // keep in step with web/store.ts: the page has already opened the database by the
  // time this runs, so the stores are there.
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const now = Date.now()
  await new Promise((resolve, reject) => {
    // Two rows for the one file, because the app keeps the listing apart from the
    // words: `files` is what a note is read from and `stats` is what the file list
    // walks. See web/store.ts.
    const change = db.transaction(['files', 'stats'], 'readwrite')
    change.objectStore('files').put({ path, content: text, modified: now, created: now })
    change.objectStore('stats').put({ path, modified: now, created: now })
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })
  return true
}
"""

# A paste as the browser raises one: both flavours on one event, aimed at the
# writing surface, which is where CodeMirror listens.
PASTE = """
(html) => {
  const surface = document.querySelector('.cm-content')
  if (!surface) return 'no editor on the page'

  surface.focus()
  const data = new DataTransfer()
  data.setData('text/html', html)
  data.setData('text/plain', 'the plain half, which is not what should land')

  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
  surface.dispatchEvent(event)
  return 'sent'
}
"""

# The note as written, read off the surface. Only correct in source mode, where
# nothing is concealed and every line of the document is a line in the page.
LINES = """() =>
  [...document.querySelectorAll('.cm-content .cm-line')].map((line) => line.textContent).join('\\n')
"""


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


def serve() -> tuple[str, http.server.ThreadingHTTPServer]:
    port = free_port()
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", port), functools.partial(Quiet, directory=str(DIST))
    )
    threading.Thread(target=server.serve_forever, daemon=True).start()

    return f"http://127.0.0.1:{port}/", server


def open_note(page, name: str) -> None:
    page.keyboard.press("Control+o")
    page.wait_for_timeout(300)
    page.keyboard.type(name)
    page.wait_for_timeout(700)
    page.keyboard.press("Enter")
    page.wait_for_timeout(1500)


def paste_a_page(page) -> list[str]:
    """Pastes the HTML above and answers what is wrong with what landed."""
    page.click(".cm-content")
    page.wait_for_timeout(200)
    # At the end of the note, so the paste has the whole document to itself below.
    page.keyboard.press("Control+End")
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)

    if page.evaluate(PASTE, PASTED_HTML) != "sent":
        return ["the editor was not on the page"]

    page.wait_for_timeout(600)

    # Source mode, where the markdown is the markdown: live preview replaces the
    # syntax it hides, and replaced text is not in the page to read.
    page.keyboard.press("Control+/")
    page.wait_for_timeout(600)
    text = page.evaluate(LINES)
    page.keyboard.press("Control+/")
    page.wait_for_timeout(400)

    (OUT / "pasted.md").write_text(text, encoding="utf-8")

    bad = [f"missing {wanted!r}" for wanted in WANTED if wanted not in text]
    bad += [f"still holds {junk!r}" for junk in UNWANTED if junk in text]
    return bad


def photograph(page, scheme: str) -> list[str]:
    """One picture per menu, and one of Export inside File."""
    shots: list[str] = []

    def shoot(name: str) -> None:
        target = OUT / f"{name}-{scheme}.png"
        page.locator(".menu").screenshot(path=str(target))
        shots.append(target.name)

    page.click('button[aria-label="Menu"]')
    page.wait_for_timeout(400)

    for group in GROUPS:
        page.click(f".groups button:text-is('{group}')")
        page.wait_for_timeout(250)
        shoot(f"menu-{group.lower()}")

        if group == "File":
            page.click(".rows button.row:has-text('Export')")
            page.wait_for_timeout(250)
            shoot("menu-file-export")
            page.click(".rows button.back")
            page.wait_for_timeout(250)

    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    return shots


def main() -> int:
    if not DIST.is_dir():
        raise SystemExit(f"no build at {DIST}; run pnpm --filter @nib/desktop build")

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)

    url, server = serve()
    report: dict[str, object] = {}
    failures: list[str] = []

    with sync_playwright() as play:
        browser = play.chromium.launch(executable_path=str(chrome()))

        try:
            for scheme in ["light", "dark"]:
                context = browser.new_context(
                    color_scheme=scheme, viewport={"width": 1400, "height": 900}
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
                    page.evaluate(SEED, [NOTE_PATH, NOTE])
                    page.reload()
                    page.wait_for_timeout(2500)
                    open_note(page, "Menus")

                    on = page.evaluate("() => document.documentElement.dataset.scheme ?? ''")
                    dark = page.evaluate(
                        "() => getComputedStyle(document.body).colorScheme"
                    )
                    report[f"{scheme}: the app says"] = {"scheme": on, "colorScheme": dark}

                    if scheme == "light":
                        faults = paste_a_page(page)
                        report["a page pasted as markdown"] = faults or "as written"
                        failures += [f"paste: {one}" for one in faults]

                    report[f"{scheme}: screenshots"] = photograph(page, scheme)
                    report[f"{scheme}: page problems"] = problems[:10]
                    failures += [f"{scheme}: {one}" for one in problems[:10]]
                finally:
                    context.close()
        finally:
            browser.close()
            server.shutdown()
            server.server_close()

    print(json.dumps(report, indent=2, ensure_ascii=False))
    if failures:
        print("\nFAILED:")
        for one in failures:
            print(f"  {one}")
        return 1

    print(f"\nall good; the pictures are in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
