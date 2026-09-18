"""What a code block says it is, seen: the words after the language in a fence's
own line, drawn on the block's top row in the editor and over the block on a
rendered page, with the language still doing the language's job.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/captions.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/captions/`.
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
SHOTS = HERE / "shots" / "captions"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18960
ORIGIN = f"http://127.0.0.1:{PORT}"

NOTE = """# Blocks that say what they are

```ts src/main.ts
const answer = 41 + 1
```

Some words between them.

```js title="setup.js"
run()
```

```py
print('nothing to say')
```
"""

SEED = """
async ([note]) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  return ws.notes.map((one) => one.path)
}
"""

# Every caption on the page, against the block it belongs to: where it starts,
# whether it is on the block's first row, and what it says.
CAPTIONS = """
() => [...document.querySelectorAll('.cm-line.nib-code-open')].map((line) => {
  const box = line.getBoundingClientRect()
  const said = line.querySelector('.nib-fence-caption')
  const language = line.querySelector('.nib-fence-language')
  const mark = said?.getBoundingClientRect() ?? null
  const style = getComputedStyle(line)

  return {
    text: said?.textContent ?? null,
    language: language?.textContent ?? null,
    // Where the code itself starts, so a caption can be level with it.
    inset: mark ? Math.round(mark.left - box.left - Number.parseFloat(style.paddingLeft)) : null,
    into: mark ? Math.round(mark.top + mark.height / 2 - box.top) : null,
    source: line.textContent.includes('```'),
  }
})
"""

READ = """
() => [...document.querySelectorAll('#write figure.code')].map((figure) => ({
  caption: figure.querySelector('figcaption')?.textContent ?? null,
  language: figure.querySelector('code')?.className ?? null,
  first: figure.firstElementChild?.tagName ?? null,
}))
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
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


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


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fresh(browser: Browser, label: str, finger: bool = False) -> Page:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820} if not finger else {"width": 420, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {}
            if not finger
            else {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, [NOTE])}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Blocks'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page


def source(page: Page) -> str:
    return page.evaluate("() => window.nib.state.doc.toString()")


def drive_editor(browser: Browser) -> None:
    page = fresh(browser, "desktop")

    blocks = page.evaluate(CAPTIONS)
    say(f"[desktop] the blocks: {json.dumps(blocks, ensure_ascii=False)}")
    shot(page, "01-captions")

    if len(blocks) != 3:
        wrong(f"the note holds three fences, and the page drew {len(blocks)}")

    first, second, third = blocks
    if first["text"] != "src/main.ts":
        wrong(f"the block does not say what it is: {first['text']!r}")
    if first["language"] != "ts":
        wrong(f"the language is more than a language: {first['language']!r}")
    if second["text"] != "setup.js":
        wrong(f"a caption written the other way is not read: {second['text']!r}")
    if second["language"] != "js":
        wrong(f"the language is more than a language: {second['language']!r}")
    if third["text"] is not None:
        wrong(f"a fence that says only its language got a caption: {third['text']!r}")

    for one in blocks[:2]:
        if one["inset"] not in (0, 1, -1):
            wrong(f"a caption does not start where the code does: {one['inset']}px off")
        if one["into"] is None or not 0 <= one["into"] <= 40:
            wrong(f"a caption is not on the block's top row: {one['into']}px into it")

    # The caret in the block brings the fence's own line back, and the caption
    # steps aside rather than being drawn over it.
    page.evaluate(
        """() => {
          const at = window.nib.state.doc.toString().indexOf('const answer')
          window.nib.dispatch({ selection: { anchor: at + 3 } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(400)
    inside = page.evaluate(CAPTIONS)
    say(f"[desktop] with the caret in the first block: {json.dumps(inside, ensure_ascii=False)}")
    shot(page, "02-caret-in-the-block")
    if not inside[0]["source"]:
        wrong("the fence did not show its own line with the caret in the block")
    if inside[0]["text"] is not None:
        wrong("the caption was drawn over the fence's own words")
    if inside[1]["text"] != "setup.js":
        wrong("a caret in one block took the caption off another")

    # And away again.
    page.evaluate(
        """() => {
          window.nib.dispatch({ selection: { anchor: 0 } })
          window.nib.focus()
        }"""
    )
    page.wait_for_timeout(400)
    back = page.evaluate(CAPTIONS)
    if back[0]["text"] != "src/main.ts":
        wrong(f"the caption did not come back: {back[0]['text']!r}")
    shot(page, "03-caret-away-again")

    # Line numbers take room at the left of the block; the caption keeps clear.
    page.evaluate("() => window.nibApp.modes.toggleLineNumbers(window.nib)")
    page.wait_for_timeout(500)
    numbered = page.evaluate(CAPTIONS)
    say(f"[desktop] with line numbers: {json.dumps(numbered, ensure_ascii=False)}")
    shot(page, "04-line-numbers")
    for one in numbered[:2]:
        if one["inset"] not in (0, 1, -1):
            wrong(f"a caption is not level with the numbered code: {one['inset']}px off")
    page.evaluate("() => window.nibApp.modes.toggleLineNumbers(window.nib)")
    page.wait_for_timeout(300)

    # Retyping the language leaves the caption where it was: what a block is and
    # which language it is in are two things.
    page.locator(".nib-fence-language").first.click()
    page.wait_for_timeout(300)
    page.keyboard.type("tsx")
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    text = source(page)
    say(f"[desktop] the fence line is now {text.splitlines()[2]!r}")
    shot(page, "05-language-retyped")
    if "```tsx src/main.ts" not in text:
        wrong("retyping the language took the caption with it")

    page.context.close()


def drive_reading(browser: Browser) -> None:
    page = fresh(browser, "reading")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(700)

    read = page.evaluate(READ)
    say(f"[reading] the page: {json.dumps(read, ensure_ascii=False)}")
    shot(page, "10-reading")

    if len(read) != 2:
        wrong(f"the page framed {len(read)} blocks, not the two that say what they are")
    if read and read[0]["caption"] != "src/main.ts":
        wrong(f"the page does not say what the block is: {read[0]['caption']!r}")
    if read and read[0]["first"] != "FIGCAPTION":
        wrong("what the block is comes after the block rather than over it")
    if read and read[0]["language"] != "language-ts":
        wrong(f"the block is not coloured as its language: {read[0]['language']!r}")

    page.context.close()


def drive_finger(browser: Browser) -> None:
    page = fresh(browser, "phone", finger=True)
    blocks = page.evaluate(CAPTIONS)
    say(f"[phone] the blocks: {json.dumps(blocks, ensure_ascii=False)}")
    shot(page, "20-phone")

    if blocks and blocks[0]["text"] != "src/main.ts":
        wrong("a phone does not say what the block is")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- the editor ---")
                drive_editor(browser)
                say("--- the page ---")
                drive_reading(browser)
                say("--- a finger ---")
                drive_finger(browser)
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

    print("\na code block says what it is, in the editor and on the page", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
