"""The find bar over a note being written in, and over a note being read.

CodeMirror's own search panel is gone; the bar is nib's own component now, and
all three surfaces draw the same one. What this run is for is the things only a
real browser can answer:

  - Ctrl+F puts the bar up, under the strip, with the word the caret was on;
  - the tally counts, and says which match the caret is on;
  - the three flags in the field change what matches;
  - Enter steps on, Shift+Enter steps back, and the matches are lit;
  - Ctrl+H opens the replace row, and Replace and Replace all do;
  - Escape closes it and hands the caret back to the note;
  - the same bar, with neither the flags nor the replace row, over a note being
    read, which is a surface that cannot honour either.

Builds the web app, serves `dist` on a port of its own, drives light and dark and
a phone, and stops everything again. Screenshots go beside this file under
`shots/find-bar/`.

Run it from the repository root:

    python apps/desktop/test/e2e/find-bar.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "find-bar"

# A port of this run's own, above the dev server's 1420 and clear of the others.
PORT = 18897
ORIGIN = f"http://127.0.0.1:{PORT}"

PATIENCE = 40

failures: list[str] = []

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(fine: bool, what: str) -> None:
    if fine:
        say(f"ok   {what}")
    else:
        failures.append(what)
        say(f"WRONG {what}")


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
        say("reusing the build that is there")
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
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


#: The app opens the space's first note by itself on a first visit, and the window is
#: already taking keys while it does. Seeding before that lands is a race with the
#: launch rather than anything to do with the find bar, so every scene waits for the
#: launch's own note first and then writes its own over the top of it.
LAUNCHED = "() => window.nibApp.workspace.tabs.length > 0"


def fresh(browser: Browser, label: str, viewport: dict[str, int], scheme: str) -> Page:
    context = browser.new_context(viewport=viewport, color_scheme=scheme)
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    return page


# A note with a word in it several times, in two cases, and once as part of a
# longer word: enough for the tally to count, for Match case to change the
# answer, and for Whole word to change it again.
NOTE = """# The wind

the wind came up in the night, and the Wind
dropped again before morning. a windmill
turned once. wind, Wind, windward.
"""

SEED = """
async (text) => {
  const ws = window.nibApp.workspace
  const path = await ws.noteFrom(text, ws.activeSpace.root)
  // Activated, not merely opened - and see `SHOWING`, which is what makes it stay
  // activated through the sitting being read back.
  await ws.openEntry(path, { activate: true })
  if (ws.panel) ws.showPanel(null)
  return path
}
"""

# What the bar is showing: the query, the tally, which flags are on, whether the
# replace row is out, and how many matches are lit in the document.
BAR = """
() => {
  const bar = document.querySelector('.findbar')
  if (!bar) return null

  return {
    query: bar.querySelector('input')?.value ?? null,
    tally: bar.querySelector('.tally')?.textContent?.trim() ?? '',
    flags: bar.querySelectorAll('.flag').length,
    steps: bar.querySelectorAll('.act').length,
    replacing: bar.querySelectorAll('input').length > 1,
    lit: document.querySelectorAll('.cm-searchMatch').length,
    here: document.querySelectorAll('.cm-searchMatch-selected').length,
    field: bar.querySelector('input')?.className ?? '',
    focused: document.activeElement?.tagName ?? '',
  }
}
"""

WHERE = "() => document.activeElement?.className ?? document.activeElement?.tagName ?? ''"
#: The note that is open, off the workspace rather than off `window.nib`.
#:
#: `window.nib` is whichever editor was made last - Editor.svelte assigns it on
#: every view it creates - so it is the focused pane's editor only until something
#: else makes one. Reading the document through it was this drive's own race: the
#: caret steps below went to the second word of a note nobody was looking at, Ctrl+F
#: came up on a word this note does not hold, and all fourteen checks after that
#: read as bugs in the find bar. The workspace knows which note is open.
DOC = "() => window.nibApp.workspace.active.doc"
#: How many gales the note holds, which is what a replacement can be waited for by.
GALE = "(window.nibApp.workspace.active.doc.match(/gale/g) || []).length"
#: Which note the pane is on, how many editors there are, and what is selected.
CARET = """
() => ({
  active: window.nibApp.workspace.active?.path ?? null,
  tabs: window.nibApp.workspace.tabs.length,
  editors: document.querySelectorAll('.cm-content').length,
  windmill: (window.nibApp.workspace.active?.doc ?? '').includes('windmill'),
  picked: (getSelection()?.toString() ?? '').slice(0, 24),
  focused: document.activeElement?.className?.slice?.(0, 40) ?? '',
})
"""

#: The note the drive wrote, made the one the window is on - asked for again until
#: it stays that way.
#:
#: Three things have to be true at once and none of them was reliably. The note has
#: to be the *active* tab, because the find bar searches the pane with the keyboard
#: in it. It has to be the *only* tab, because `.cm-content` is picked by document
#: order and another pane's editor can come first. And both have to survive the
#: app's own sitting being read back, which lands after the app says it has a space
#: and sets which tab is active: seeded once, the note was replaced a moment later
#: by whichever note the space opened on - `Read me.md`, whose second word is `to`
#: and which has no wind in it at all. That is the whole of why this drive failed
#: about one run in three, and why every check after the first seven then read as a
#: bug in the find bar rather than in the drive.
#:
#: So it is not asked once. `wait_for` polls this, and each poll puts the window back
#: on the note if something has moved it, which is what carries it through the
#: restore.
SHOWING = """
() => {
  const ws = window.nibApp.workspace
  const mine = ws.tabs.find((one) => (one.path ?? '').endsWith('The wind.md'))
  if (!mine) return false

  if (ws.activeTabId !== mine.id) {
    ws.activeTabId = mine.id
    return false
  }

  for (const other of [...ws.tabs]) if (other.id !== mine.id) ws.close(other.id)

  return (ws.active?.doc ?? '').includes('windmill')
    && document.querySelectorAll('.cm-content').length === 1
}
"""
# No CodeMirror panel anywhere: the one thing this rework must be able to prove.
PANEL = "() => document.querySelectorAll('.cm-panel, .cm-panels').length"


# What makes the window a phone. A headless browser has no touch screen for the
# app to recognise, so the device is set the way the other drives set it, along
# with the attributes the tokens read for the touch scale.
AS_PHONE = """
() => {
  const app = window.nibApp
  app.viewport.device = 'phone'
  app.viewport.portrait = true
  app.viewport.narrow = true

  const root = document.documentElement
  root.dataset.device = 'phone'
  root.toggleAttribute('data-touch', true)
  root.toggleAttribute('data-drawer', true)
  root.toggleAttribute('data-narrow', true)
}
"""

# Every target in the bar, measured. The bar draws no number of its own: the
# field is `--row-height` and each button is a row square, so a thumb gets 56px
# where a pointer gets 28 without this component knowing which it is on.
SIZES = """
() => {
  const out = []
  for (const [what, selector] of [
    ['the field', '.findbar .nib-field'],
    ['a step', '.findbar .act'],
    ['a flag', '.findbar .flag'],
  ]) {
    const one = document.querySelector(selector)
    if (!one) { out.push({ what, missing: true }); continue }

    const box = one.getBoundingClientRect()
    out.push({ what, width: Math.round(box.width), height: Math.round(box.height) })
  }

  return out
}
"""

# A row a finger has to land on, from this size up: the same number
# touch-scale.test.ts holds the stylesheets to.
FINGER = 40


def on_phone(browser: Browser) -> None:
    """The same bar under a thumb. Nothing about it is a phone's own drawing, so
    what is checked is that every target came out finger-sized."""
    label = "phone"
    page = fresh(browser, label, {"width": 390, "height": 844}, "light")
    try:
        page.evaluate(AS_PHONE)
        page.wait_for_timeout(200)
        wait_for(page, LAUNCHED, f"[{label}] the launch's own note")
        say(f"[{label}] wrote {page.evaluate(SEED, NOTE)}")
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
        wait_for(page, SHOWING, f"[{label}] the note to be the document")

        page.locator(".cm-content").first.click()
        page.keyboard.press("Control+f")
        page.wait_for_selector(".findbar", state="visible", timeout=8000)

        bar = page.evaluate(BAR)
        check(bar is not None, f"[{label}] Ctrl+F puts the bar up")
        if not bar:
            return

        page.locator(".findbar input").first.fill("wind")
        page.wait_for_timeout(300)
        page.locator(".findbar").first.screenshot(path=str(SHOTS / "bar-phone.png"))
        say(f"[{label}] wrote bar-phone.png")

        for one in page.evaluate(SIZES):
            say(f"[{label}]   {one}")
            if one.get("missing"):
                check(False, f"[{label}] {one['what']} is drawn")
                continue

            check(
                one["height"] >= FINGER,
                f"[{label}] {one['what']} is a finger's target ({one['height']}px)",
            )
    finally:
        page.context.close()


def drive(browser: Browser, label: str, scheme: str) -> None:
    page = fresh(browser, label, {"width": 1180, "height": 760}, scheme)
    try:
        wait_for(page, LAUNCHED, f"[{label}] the launch's own note")
        say(f"[{label}] wrote {page.evaluate(SEED, NOTE)}")
        wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
        # And the note itself in it, which is not the same thing: an editor exists
        # before the note it is going to show arrives, and the caret used to go to
        # the second word of whichever document was there. `windmill` is in this note
        # and in nothing else in the space. Waited for once, because the sitting
        # being read back no longer takes the active tab off a note somebody opened
        # while it was arriving; see applyLayout in workspace.svelte.ts.
        wait_for(page, SHOWING, f"[{label}] the note to be the document")

        # ── Ctrl+F, with a word under the caret ──
        content = page.locator(".cm-content").first
        content.click()
        page.keyboard.press("Control+Home")
        # Onto the word "wind" in the heading, then select it.
        page.keyboard.press("Control+ArrowRight")
        page.keyboard.press("Control+ArrowRight")
        page.keyboard.press("Control+Shift+ArrowRight")
        # What the keys found, said out loud: which note the pane is on, how many
        # editors are on the page, and what the caret has hold of. A drive that
        # cannot say this is a drive whose failures all look the same.
        say(f"[{label}] before Ctrl+F: {page.evaluate(CARET)}")
        page.keyboard.press("Control+f")
        page.wait_for_selector(".findbar", state="visible", timeout=8000)

        bar = page.evaluate(BAR)
        say(f"[{label}] the bar: {bar}")
        check(bar is not None, f"[{label}] Ctrl+F puts the bar up")
        if not bar:
            return

        check(page.evaluate(PANEL) == 0, f"[{label}] and no library panel with it")
        check(
            "nib-field" in bar["field"],
            f"[{label}] the query sits in one .nib-field ({bar['field']})",
        )
        check(bar["flags"] == 3, f"[{label}] with three flags inside it ({bar['flags']})")
        check(bar["query"].strip().lower() == "wind", f"[{label}] on the word the caret was on")
        check(bar["lit"] >= 4, f"[{label}] and the matches are lit ({bar['lit']})")

        page.locator(".findbar").first.screenshot(path=str(SHOTS / f"bar-{label}.png"))
        say(f"[{label}] wrote bar-{label}.png")

        # ── The tally, and what the flags do to it ──
        def tally(unlike: str | None = None) -> str:
            """What the bar says it found, once it has finished saying it.

            A sleep was what this used to be, and the flags below are pressed one
            after another with nothing between them: a quarter of a second is
            usually enough for the field to be read and the tally rewritten, and
            once in three runs it was not. So the tally is waited for - for a
            different answer where one is expected, and for any answer otherwise."""
            until = time.monotonic() + PATIENCE
            said = ""
            while time.monotonic() < until:
                said = page.evaluate(BAR)["tally"]
                if said and (unlike is None or said != unlike):
                    return said
                page.wait_for_timeout(30)

            return said

        def flag(label: str, on: bool) -> None:
            """A flag pressed, and seen to have taken.

            `aria-pressed` is the flag's own answer about itself, so this is the
            state the next step depends on rather than the click that asked for it.
            A click that went astray used to leave a flag on, and a flag left on is
            a query with nothing to replace - which is how the Replace button came
            to be disabled when the run below clicked it, for thirty seconds."""
            page.locator(f'.findbar .flag[aria-label="{label}"]').click()
            page.wait_for_selector(
                f'.findbar .flag[aria-label="{label}"][aria-pressed="{str(on).lower()}"]',
                timeout=8000,
            )

        field = page.locator(".findbar input").first
        field.fill("wind")
        loose = tally()
        say(f"[{label}] 'wind' is {loose!r}")
        # Seven: the heading, two in the second line, windmill, and the three on
        # the last line. Case is ignored until Match case is pressed.
        check("of 7" in loose, f"[{label}] finds every wind, however written ({loose!r})")

        flag("Match case", True)
        cased = tally(unlike=loose)
        say(f"[{label}] with Match case: {cased!r}")
        check(cased != loose, f"[{label}] Match case changes the answer")

        flag("Match case", False)
        flag("Whole word", True)
        whole = tally(unlike=loose)
        say(f"[{label}] with Whole word: {whole!r}")
        check(whole != loose, f"[{label}] Whole word changes the answer")

        flag("Whole word", False)
        flag("Regular expression", True)
        field.fill("w[a-z]+d")
        regex = tally()
        say(f"[{label}] as a regular expression: {regex!r}")
        check(bool(regex) and "0" not in regex[:2], f"[{label}] a regular expression matches")
        flag("Regular expression", False)

        # ── Enter and Shift+Enter ──
        field.fill("wind")
        first = tally()
        field.press("Enter")
        second = tally(unlike=first)
        say(f"[{label}] Enter took {first!r} to {second!r}")
        check(first != second, f"[{label}] Enter steps on")

        field.press("Shift+Enter")
        back = tally(unlike=second)
        say(f"[{label}] Shift+Enter took {second!r} to {back!r}")
        check(back == first, f"[{label}] and Shift+Enter steps back")

        check(
            page.evaluate(BAR)["here"] == 1,
            f"[{label}] and the match the caret is on is the one picked out",
        )

        # ── The replace row ──
        page.locator('.findbar .act[aria-label="Replace"]').click()
        # The row itself, which is the second field appearing in the bar.
        page.wait_for_function(
            "() => document.querySelectorAll('.findbar input').length > 1", timeout=8000
        )
        open_bar = page.evaluate(BAR)
        say(f"[{label}] with the replace row: {open_bar}")
        check(open_bar["replacing"], f"[{label}] the chevron opens the replace row")

        page.locator(".findbar").first.screenshot(path=str(SHOTS / f"replace-{label}.png"))
        say(f"[{label}] wrote replace-{label}.png")

        page.locator(".findbar input").nth(1).fill("gale")
        # Replace is disabled while nothing is found, so what this step waits for is
        # something to replace. Clicking into the wait was a thirty second timeout on
        # a button that was never going to be enabled.
        page.wait_for_selector(".findbar .apply:not([disabled])", timeout=8000)
        page.locator(".findbar .apply").first.click()
        # The replacement landing in the document, which is the thing the next line
        # asserts about. Counted rather than compared whole: the note is a page of
        # prose and a string of it does not belong in a selector.
        wait_for(page, f"() => {GALE} >= 1", "the first replacement")
        once = page.evaluate(DOC)
        say(f"[{label}] after one Replace: {once.count('gale')} gale, {once.count('wind')} wind")
        check(once.count("gale") == 1, f"[{label}] Replace changes one match")

        page.locator(".findbar .apply").nth(1).click()
        wait_for(page, f"() => {GALE} > 1", "the rest of the replacements")
        all_done = page.evaluate(DOC)
        say(f"[{label}] after Replace all: {all_done.count('gale')} gale")
        check(all_done.count("gale") > 1, f"[{label}] and Replace all changes the rest")

        # ── Escape ──
        page.locator(".findbar input").first.press("Escape")
        # The bar going, rather than four hundred milliseconds: this is the check
        # that failed on its own, one run in three.
        page.wait_for_selector(".findbar", state="detached", timeout=8000)
        say(f"[{label}] the keyboard landed on {page.evaluate(WHERE)!r}")
        check(page.evaluate(BAR) is None, f"[{label}] Escape closes the bar")
        check(
            "cm-content" in page.evaluate(WHERE),
            f"[{label}] and hands the caret back to the note",
        )
        check(
            page.evaluate("() => document.querySelectorAll('.cm-searchMatch').length") == 0,
            f"[{label}] and the matches go with it",
        )

        # ── The same bar over a note being read ──
        page.evaluate("() => window.nibApp.workspace.toggleReading?.()")
        page.wait_for_timeout(200)
        reading = page.evaluate(
            "() => { const ws = window.nibApp.workspace; const tab = ws.active;"
            " if (tab) tab.reading = true; return !!tab?.reading }"
        )
        page.wait_for_timeout(600)
        if reading and page.locator(".read").count():
            page.locator(".read").first.click()
            page.keyboard.press("Control+f")
            page.wait_for_timeout(400)
            read_bar = page.evaluate(BAR)
            say(f"[{label}] the reader's bar: {read_bar}")
            if read_bar:
                check(
                    read_bar["flags"] == 0,
                    f"[{label}] a note being read gets no flags it cannot honour",
                )
                check(
                    not read_bar["replacing"],
                    f"[{label}] and nothing to replace with",
                )
                page.locator(".findbar").first.screenshot(path=str(SHOTS / f"reading-{label}.png"))
                say(f"[{label}] wrote reading-{label}.png")
            else:
                say(f"[{label}] the reader's bar did not open; nothing checked there")
        else:
            say(f"[{label}] could not switch to reading; nothing checked there")
    finally:
        page.context.close()


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    build()

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                drive(browser, "light", "light")
                drive(browser, "dark", "dark")
                on_phone(browser)
            finally:
                browser.close()
    finally:
        say("stopping the server")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        else:
            server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    if failures:
        print("\nwhat is still wrong:", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe find bar is nib's own, and it finds, steps and replaces", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
