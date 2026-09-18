"""Getting into a block that draws itself, with the four arrow keys.

A formula, a diagram and a `[toc]` are drawn by replacing the lines they are
written on, and a replacement is atomic: the caret cannot stand inside one, so
every press that would put it there puts it past the whole block instead. What
saves that from being a wall is that arriving at either edge of the block reveals
it - the lines come back as text, and the next press is an ordinary press in
ordinary text.

So the rule this asks about, for each block and each of the four arrows: **one
press opens it, it does not skip past it**. A reader coming down the note with the
keyboard must be able to reach the inside of their own formula, which is what Emil
reported of the horizontal case - *"if I'm for example at the right of it and press
arrow to the left then it just skips the entire thing"* - and the vertical case was
never asked. The table answers this with a navigation of its own; see
table/keymap.ts. Everything else answers it by revealing, and revealing is what is
measured here: after the press, the block's widget is gone and the caret is on one
of the lines it was drawn from.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/caret-blocks.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run, which is what
run-all.py sets. Screenshots go beside this file under `shots/caret-blocks/`.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "caret-blocks"

# A port of this run's own, well clear of the dev server's and of every other
# drive's.
PORT = 23663
ORIGIN = f"http://127.0.0.1:{PORT}"

# How long anything is waited for before the run gives up and says what it saw.
PATIENCE = 60

problems: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    problems.append(words)
    print(f"  WRONG: {words}", flush=True)


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") == "1":
        say("reusing the build already in dist")
        return

    say("building the web app")
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


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def opened(context: BrowserContext) -> Page:
    page = context.pages[0] if context.pages else context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", "the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", "a space")
    return page


# One note, with the three blocks that draw themselves and a paragraph above and
# below each - so every press below has somewhere to come from and somewhere it
# would land if it skipped. The headings are there for `[toc]` to have something to
# list; a `[toc]` with nothing under it draws an empty shell and is a different row
# of the same question.
NOTE = """# Getting about

above the formula

$$
E = mc^2
$$

below the formula, above the diagram

```mermaid
graph TD
  A --> B
```

below the diagram, above the contents

[toc]

below the contents

## One

first section

## Two

second section
"""

WRITE = """
async (text) => {
  const ws = window.nibApp.workspace
  const made = await ws.noteFrom(text, ws.activeSpace.root)
  if (!made) throw new Error('nothing written')
  await ws.loadTree()
  await ws.openEntry(made)
  return made
}
"""

# Where each block stands in the document, read off the text rather than off the
# decorations: the decorations are the thing being measured.
SPANS = """
() => {
  const doc = window.nib.state.doc
  const lines = []
  for (let at = 1; at <= doc.lines; at++) lines.push(doc.line(at))

  const spanOf = (first, last) => ({ from: first.from, to: last.to })
  const found = {}

  const dollars = lines.filter((one) => one.text.trim() === '$$')
  if (dollars.length === 2) found.formula = spanOf(dollars[0], dollars[1])

  const fences = lines.filter((one) => one.text.startsWith('```'))
  if (fences.length === 2) found.diagram = spanOf(fences[0], fences[1])

  const toc = lines.find((one) => one.text.trim() === '[toc]')
  if (toc) found.contents = spanOf(toc, toc)

  return found
}
"""

# What the editor is showing and where the caret is, in one reading.
STATE = """
() => ({
  head: window.nib.state.selection.main.head,
  widgets: {
    formula: document.querySelectorAll('.nib-math-block').length,
    diagram: document.querySelectorAll('.nib-diagram').length,
    contents: document.querySelectorAll('.nib-toc').length,
  },
})
"""

#: Each block, the class of the widget drawn for it, and the four presses. A press
#: is where the caret starts - a document position worked out from the block's own
#: span - and the key. The two vertical ones start on the line above and the line
#: below; the two horizontal ones start immediately beside it.
BLOCKS = ["formula", "diagram", "contents"]

PRESSES = [
    ("from above", "ArrowDown"),
    ("from below", "ArrowUp"),
    ("from in front", "ArrowRight"),
    ("from behind", "ArrowLeft"),
]


def caret_at(page: Page, at: int) -> None:
    page.evaluate(
        "(at) => window.nib.dispatch({ selection: { anchor: at }, scrollIntoView: true })", at
    )
    page.wait_for_timeout(120)


def start_of(page: Page, span: dict, where: str) -> int:
    """The position a press starts from, in the document as it stands."""
    doc_end = page.evaluate("() => window.nib.state.doc.length")
    if where == "from above":
        # The end of the line before the block, which is where a reader coming down
        # the note with the keyboard is standing.
        return page.evaluate(
            "(at) => window.nib.state.doc.lineAt(Math.max(0, at - 1)).to", span["from"]
        )
    if where == "from below":
        return page.evaluate(
            "(at) => window.nib.state.doc.lineAt(Math.min(window.nib.state.doc.length, at + 1)).from",
            span["to"],
        )
    if where == "from in front":
        return max(0, span["from"] - 1)

    return min(doc_end, span["to"] + 1)


def drive(playwright, profile: Path) -> None:
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=str(profile),
        executable_path=chromium(),
        headless=True,
        viewport={"width": 1180, "height": 900},
        color_scheme="light",
    )
    try:
        page = opened(context)
        made = page.evaluate(WRITE, NOTE)
        say(f"wrote {made}")

        wait_for(page, "() => !!window.nib", "the editor")
        # The diagram is drawn by a library fetched when the first one appears, so
        # the three widgets are not all there on the first frame.
        wait_for(
            page,
            "() => document.querySelectorAll('.nib-math-block').length === 1"
            " && document.querySelectorAll('.nib-diagram').length === 1"
            " && document.querySelectorAll('.nib-toc').length === 1",
            "the three blocks to be drawn",
        )
        page.locator(".cm-content").first.screenshot(path=str(SHOTS / "drawn.png"))
        say("wrote drawn.png")

        spans = page.evaluate(SPANS)
        say(f"blocks: {json.dumps(spans)}")
        for name in BLOCKS:
            if name not in spans:
                raise SystemExit(f"the note has no {name} in it, so nothing was measured")

        for name in BLOCKS:
            span = spans[name]
            for where, key in PRESSES:
                # Every press starts from the note as it was drawn, not from wherever
                # the press before left the caret. Nothing here types, so the spans
                # read above hold for the whole run.
                caret_at(page, 0)
                caret_at(page, start_of(page, span, where))
                page.keyboard.press(key)
                page.wait_for_timeout(200)

                now = page.evaluate(STATE)
                head = now["head"]
                inside = span["from"] <= head <= span["to"]
                opened_up = now["widgets"][name] == 0
                say(f"{name} {where}: caret {head} in {span['from']}..{span['to']}, "
                    f"{name} widgets {now['widgets'][name]}")

                if not inside:
                    wrong(f"{key} {where} skipped the {name}: caret {head}, "
                          f"block {span['from']}..{span['to']}")
                elif not opened_up:
                    wrong(f"{key} {where} put the caret in the {name} without opening it")

        # And the way out again: the block closes behind a caret that leaves it, or
        # the note would open up block by block and never draw itself again.
        caret_at(page, 0)
        page.wait_for_timeout(200)
        closed = page.evaluate(STATE)
        if any(closed["widgets"][name] != 1 for name in BLOCKS):
            wrong(f"a block did not close behind the caret: {json.dumps(closed['widgets'])}")
        else:
            say("and every block closed again behind the caret")

        page.locator(".cm-content").first.screenshot(path=str(SHOTS / "closed.png"))
        say("wrote closed.png")
    finally:
        context.close()


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    build()

    profile = Path(ROOT / "target" / "caret-blocks-profile")
    if profile.exists():
        shutil.rmtree(profile, ignore_errors=True)
    profile.mkdir(parents=True, exist_ok=True)

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            drive(playwright, profile)
    finally:
        say("stopping the server")
        server.terminate()
        server.wait(timeout=10)

    if problems:
        print("\n".join(f"WRONG: {one}" for one in problems), flush=True)
        return 1

    print("\nevery block opens to an arrow rather than standing in its way", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
