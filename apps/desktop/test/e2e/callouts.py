"""Callouts, seen: the thirteen types and their other names, the icons they
wear, a title of the writer's own, a type nothing knows dressed by a theme's own
rule, and the same note as it reads.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be a development one or `window.nib` and `window.nibApp` are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/callouts.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/callouts/`.
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
SHOTS = HERE / "shots" / "callouts"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18952
ORIGIN = f"http://127.0.0.1:{PORT}"

#: The thirteen looks, which are Obsidian's thirteen. `important` and `caution` are
#: not among them: nib had those two as GitHub alert kinds before it had any of the
#: others, and they were folded in as aliases so that a file reads the same in the
#: editor it was written for and in the one it travels to. They are checked below
#: with the other aliases; see the head of packages/markdown/src/callouts.ts.
KINDS = [
    "note",
    "abstract",
    "info",
    "todo",
    "tip",
    "success",
    "question",
    "warning",
    "failure",
    "danger",
    "bug",
    "example",
    "quote",
]

ALIASES = [
    "summary",
    "tldr",
    "hint",
    "check",
    "done",
    "help",
    "faq",
    "attention",
    "fail",
    "error",
    "important",
    "caution",
]

NOTE = "# Callouts\n\n" + "".join(f"> [!{kind}]\n> The {kind} one.\n\n" for kind in KINDS)

ALIAS_NOTE = "# Other names\n\n" + "".join(f"> [!{one}]\n> Also known.\n\n" for one in ALIASES)

ODD_NOTE = (
    "# The odd ones\n\n"
    "> [!tip] Mind the gap\n> A title of the writer's own.\n\n"
    "> [!recipe]\n> A type nothing knows.\n\n"
    "> Just a quote, with **bold** in it.\n"
)

FOLD_NOTE = (
    "# Folding\n\n"
    "> [!warning]- Shut to begin with\n> Behind the sign.\n> And more behind it.\n\n"
    "> [!info]+ Open to begin with\n> In front of the sign.\n\n"
    "> [!note] No sign at all\n> Always in front.\n"
)

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const one of notes) await ws.noteFrom(one, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
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
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=True)
    say(f"shot {name}.png")


def fresh(browser: Browser, scheme: str) -> Page:
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    say(f"the space holds {page.evaluate(SEED, [NOTE, ALIAS_NOTE, ODD_NOTE, FOLD_NOTE])}")
    page.wait_for_timeout(400)
    return page


def open_note(page: Page, starts: str) -> None:
    page.evaluate(
        """async (starts) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith(starts))
          await ws.openEntry(note.path, { activate: true })
        }""",
        starts,
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")
    page.wait_for_timeout(700)


WRITTEN = """
() => {
  const lines = [...document.querySelectorAll('.cm-content .cm-line[data-callout]')]
  const seen = new Map()
  for (const line of lines) {
    const type = line.dataset.callout
    if (seen.has(type)) continue
    const label = line.querySelector('.nib-callout-label')
    seen.set(type, {
      look: [...line.classList].find((one) => one.startsWith('nib-callout-')) ?? null,
      accent: getComputedStyle(line).borderLeftColor,
      icon: !!line.querySelector('.callout-icon'),
      words: label ? label.textContent : null,
    })
  }
  return Object.fromEntries(seen)
}
"""

READ = """
() => {
  const found = [...document.querySelectorAll('.callout')]
  return found.map((one) => ({
    type: one.dataset.callout,
    look: [...one.classList].find((name) => name.startsWith('callout-') && name !== 'callout-title'),
    icon: !!one.querySelector('.callout-icon'),
    title: one.querySelector('.callout-title')?.textContent?.trim(),
    accent: getComputedStyle(one).borderLeftColor,
  }))
}
"""


def swept(page: Page) -> dict:
    """Everything the editor marked, gathered a screenful at a time.

    The live preview only decorates what is in view, so a note longer than the
    window has to be read through rather than read once."""
    found: dict = {}
    seen = -1

    while True:
        for name, one in page.evaluate(WRITTEN).items():
            found.setdefault(name, one)

        at = page.evaluate(
            """() => {
              const box = document.querySelector('.cm-scroller')
              const was = box.scrollTop
              box.scrollTop = was + box.clientHeight * 0.8
              return box.scrollTop
            }"""
        )
        page.wait_for_timeout(350)
        if at == seen:
            return found
        seen = at


def drive(browser: Browser, scheme: str) -> None:
    page = fresh(browser, scheme)
    open_note(page, "Callouts")
    shot(page, f"01-written-{scheme}")

    written = swept(page)
    say(f"[{scheme}] written: {len(written)} types marked")
    for kind in KINDS:
        one = written.get(kind)
        if not one:
            wrong(f"{kind} is not marked as a callout in the editor")
            continue
        if one["look"] != f"nib-callout-{kind}":
            wrong(f"{kind} wears {one['look']}")
        if not one["icon"]:
            wrong(f"{kind} has no icon")

    accents = {kind: written[kind]["accent"] for kind in KINDS if kind in written}
    say(f"[{scheme}] accents: {json.dumps(accents)}")
    if len(set(accents.values())) < 6:
        wrong(f"the looks barely differ: {sorted(set(accents.values()))}")

    # The odd ones: a title of the writer's own, and a type nothing knows.
    open_note(page, "The odd ones")
    odd = swept(page)
    say(f"[{scheme}] the odd ones: {json.dumps(odd)}")
    shot(page, f"02-odd-{scheme}")

    unknown = odd.get("recipe")
    if not unknown:
        wrong("a type nothing knows is not a callout at all")
    elif unknown["look"] is not None:
        wrong(f"a type nothing knows was given a look: {unknown['look']}")
    elif unknown["icon"]:
        wrong("a type nothing knows was given an icon")

    titled = odd.get("tip")
    if not titled:
        wrong("a callout with a title of its own is not a callout")
    elif (titled["words"] or "").strip():
        wrong(f"a callout with a title of its own also shows the type: {titled['words']!r}")

    # A theme's own rule, which is the whole of "custom callout types".
    page.evaluate(
        """() => {
          const sheet = document.createElement('style')
          sheet.textContent = "[data-callout='recipe']{--callout-accent:#c2410c}"
          document.head.append(sheet)
        }"""
    )
    page.wait_for_timeout(400)
    dressed = page.evaluate(
        "() => getComputedStyle(document.querySelector(\"[data-callout='recipe']\")).borderLeftColor"
    )
    say(f"[{scheme}] a theme dresses it: {dressed}")
    if dressed != "rgb(194, 65, 12)":
        wrong(f"a theme could not reach an unknown type through data-callout: {dressed}")
    shot(page, f"03-theme-dressed-{scheme}")

    # The other names for the same looks.
    open_note(page, "Other names")
    others = swept(page)
    say(f"[{scheme}] other names: {json.dumps({k: v['look'] for k, v in others.items()})}")
    shot(page, f"04-aliases-{scheme}")
    expected = {
        "summary": "nib-callout-abstract",
        "tldr": "nib-callout-abstract",
        "hint": "nib-callout-tip",
        "check": "nib-callout-success",
        "done": "nib-callout-success",
        "help": "nib-callout-question",
        "faq": "nib-callout-question",
        "attention": "nib-callout-warning",
        "fail": "nib-callout-failure",
        "error": "nib-callout-danger",
        # The two GitHub alert kinds, folded in with the rest; see KINDS above.
        "important": "nib-callout-tip",
        "caution": "nib-callout-warning",
    }
    for name, look in expected.items():
        if others.get(name, {}).get("look") != look:
            wrong(f"{name} does not wear {look}: {others.get(name)}")

    # And the same notes as they read.
    open_note(page, "Callouts")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1400)
    shot(page, f"05-reading-{scheme}")
    read = page.evaluate(READ)
    say(f"[{scheme}] read: {len(read)} callouts")
    if len(read) != len(KINDS):
        wrong(f"the reading view drew {len(read)} callouts, not {len(KINDS)}")
    for one in read:
        if one["look"] != f"callout-{one['type']}":
            wrong(f"{one['type']} reads as {one['look']}")
        if not one["icon"]:
            wrong(f"{one['type']} has no icon in the reading view")
        if one["title"] != one["type"].capitalize():
            wrong(f"{one['type']} is called {one['title']!r} in the reading view")

    open_note(page, "The odd ones")
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1400)
    shot(page, f"06-reading-odd-{scheme}")
    odd_read = page.evaluate(READ)
    say(f"[{scheme}] the odd ones, read: {json.dumps(odd_read)}")
    if len(odd_read) != 2:
        wrong(f"the reading view drew {len(odd_read)} of the odd ones, not 2")
    if not any(one["title"] == "Mind the gap" for one in odd_read):
        wrong("the reading view lost the writer's own title")
    if next((one for one in odd_read if one["type"] == "recipe"), {}).get("icon"):
        wrong("a type nothing knows was given an icon in the reading view")

    fold(page, scheme)
    page.context.close()


FOLDED = """
() => ({
  marks: document.querySelectorAll('.nib-folded').length,
  shown: [...document.querySelectorAll('.cm-content .cm-line')]
    .map((line) => line.textContent.trim())
    .filter((text) => text.length),
})
"""

DISCLOSED = """
() => [...document.querySelectorAll('.callout')].map((one) => ({
  type: one.dataset.callout,
  tag: one.tagName.toLowerCase(),
  open: one.tagName.toLowerCase() === 'details' ? one.open : null,
  chevron: !!one.querySelector('.callout-fold'),
  title: one.querySelector('.callout-title')?.textContent?.trim(),
  behind: one.querySelector('.callout-body')?.textContent?.trim(),
}))
"""


def fold(page: Page, scheme: str) -> None:
    """The `-` and `+` a writer puts in the file, in both faces of the note."""
    open_note(page, "Folding")
    written = page.evaluate(FOLDED)
    say(f"[{scheme}] written: {written['marks']} marks")
    shot(page, f"07-fold-written-{scheme}")
    if written["marks"] != 1:
        wrong(f"the note's own fold sign did not fold anything: {written['marks']} marks")
    if any("Behind the sign" in one for one in written["shown"]):
        wrong("what the sign shut is still on the page")
    if not any("In front of the sign" in one for one in written["shown"]):
        wrong("a plus shut a callout it should have left open")

    # And the chevron opens it, like anything else that folds.
    page.locator(".cm-line[data-callout] .nib-fold-hinge").first.click()
    page.wait_for_timeout(500)
    opened = page.evaluate(FOLDED)
    say(f"[{scheme}] after the chevron: {opened['marks']} marks")
    shot(page, f"08-fold-opened-{scheme}")
    if opened["marks"]:
        wrong("the chevron did not open a callout the note said was shut")

    # As it reads: a sign makes it a details, and no sign makes it a plain box.
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1400)
    shot(page, f"09-fold-reading-{scheme}")
    disclosed = page.evaluate(DISCLOSED)
    say(f"[{scheme}] read: {json.dumps(disclosed)}")

    shut = next((one for one in disclosed if one["type"] == "warning"), None)
    ajar = next((one for one in disclosed if one["type"] == "info"), None)
    plain = next((one for one in disclosed if one["type"] == "note"), None)

    if not shut or shut["tag"] != "details" or shut["open"] is not False:
        wrong(f"a minus did not read as a shut details: {json.dumps(shut)}")
    if not shut or not shut["chevron"]:
        wrong("a foldable callout has no mark saying so")
    if shut and shut["title"] != "Shut to begin with":
        wrong(f"the shut one lost its title: {shut['title']!r}")
    if not ajar or ajar["tag"] != "details" or ajar["open"] is not True:
        wrong(f"a plus did not read as an open details: {json.dumps(ajar)}")
    if not plain or plain["tag"] != "div" or plain["chevron"]:
        wrong(f"a callout with no sign was made foldable anyway: {json.dumps(plain)}")

    # And it opens where it is read, with nothing running behind it.
    page.locator("details.callout > summary").first.click()
    page.wait_for_timeout(500)
    after = page.evaluate(DISCLOSED)
    shot(page, f"10-fold-reading-opened-{scheme}")
    if next((one for one in after if one["type"] == "warning"), {}).get("open") is not True:
        wrong("a press on the title did not open the callout in the reading view")


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for scheme in ("light", "dark"):
                    say(f"--- {scheme} ---")
                    drive(browser, scheme)
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

    print("\nevery kind of callout is drawn, named and coloured", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
