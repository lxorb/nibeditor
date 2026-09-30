"""A new tab: what kind, where it comes from, and what it costs on disk.

What it proves, in order:

* **Ctrl+Shift+P** opens the palette already on the commands - a `>` in the field with
  the caret after it - from a note and from the file list alike, and a second press puts
  the mark in front of whatever is typed, once. Escape closes it.
* **Paragraph needs no chord**: Ctrl+1 on a line that is already a first-level heading
  turns it back into prose, and again makes it a heading. That is what freed
  Ctrl+Shift+P for the palette.
* **Ctrl+T held is Alt+Tab's shape**: Ctrl down and T pressed brings a dialog up in
  the middle of the window, standing on the web page, each further T steps it round,
  and letting Ctrl go makes the one that stands. Escape cancels, and the release after
  it makes nothing.
* **Ctrl+T tapped makes a web page outright**, with nothing drawn at all, which is the
  new tab a browser makes and what a fast hand is after.
* **Every kind opens as a tab and writes nothing**: a plane, a deck of pages and a
  website open with no file in the space and no row in the list.
* **A new tab waits for a place**: a new note typed into is still a tab with no file and a
  dot after its name; Ctrl+S asks where, in the layer under the tab, and Enter writes it
  there under its first line; Ctrl+S on a note with a file asks nothing; a web tab wears no
  dot, and Ctrl+S and Enter write its shortcut.
* **A pane with nothing open** shows those same kinds as buttons, with the keyboard on
  the first, and pressing one makes that kind; Ctrl+T over it is the same dialog.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/new-tabs.py

Screenshots go beside this file under `shots/new-tabs/`, which is ignored. It fails
loudly: anything wrong is printed at the end and the exit code says so.
"""

from __future__ import annotations

from playwright.sync_api import TimeoutError as PlaywrightTimeout

from harness import Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong
failures = DRIVE.failures
SHOTS = DRIVE.shots


DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.', undefined)
  const first = ws.files.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

# What the app is showing, as plainly as it can be asked.
STATE = """
() => {
  const ws = window.nibApp.workspace
  return {
    tabs: ws.tabs.map((one) => ({ kind: one.kind, path: one.path, shown: one.shown })),
    files: ws.files.map((one) => one.name),
    active: ws.active ? { kind: ws.active.kind, path: ws.active.path } : null,
  }
}
"""

# Whether the tab in front wears the dot a tab with no file wears; see UnsavedDot.svelte.
DOTTED = """
() => {
  const id = window.nibApp.workspace.active?.id
  return !!document.querySelector(`[data-tab="${id}"] .nib-unsaved`)
}
"""

# The line the caret is in, so a key that is the editor's can be seen to have been.
LINE = """
() => {
  const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
  if (!view) return ''
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  return line.text.slice(0, 40)
}
"""

# The palette's field and where the caret is in it, which is the whole of the design.
FIELD = """
() => {
  const input = document.querySelector('.palette input')
  return input ? { value: input.value, caret: input.selectionStart } : null
}
"""

SHEET = """
() => {
  const dialog = document.querySelector('[role="dialog"]')
  const name = (one) => one?.querySelector('.nib-row-label')?.textContent.trim() ?? null
  if (!dialog) return { cards: [], on: null, lit: null, middle: null }

  const box = dialog.getBoundingClientRect()
  return {
    cards: [...dialog.querySelectorAll('button')].map(name),
    on: name(document.activeElement),
    lit: name(dialog.querySelector('.is-on')),
    // How far the dialog's middle is from the window's, in pixels, across and down.
    middle: [
      Math.round(box.x + box.width / 2 - innerWidth / 2),
      Math.round(box.y + box.height / 2 - innerHeight / 2),
    ],
  }
}
"""

HERE = """
() => {
  const buttons = [...document.querySelectorAll('[data-new-here] button')]
  const round = (n) => Math.round(n * 100) / 100

  return {
    buttons: buttons.map((one) => one.textContent.trim()),
    on: document.activeElement ? document.activeElement.textContent.trim() : null,
    // Each mark's artwork in its own 24 unit grid: where it starts down the box and
    // how much of it it fills. Read off the drawing with `getBBox` rather than off
    // the screen, so it is the ink and not the stroke around it. This is twice the
    // size a row draws a mark at, which is where a mark that fills less of its grid
    // than the rest stops being invisible; see file-mark.ts.
    marks: buttons.map((one) => {
      const svg = one.querySelector('.mark svg')
      if (!svg) return null

      const box = svg.getBBox()
      return { top: round(box.y), tall: round(box.height), wide: round(box.width) }
    }),
  }
}
"""

def settles(page, condition: str, patience: int = 2000) -> bool:
    """Whether `condition` comes true within `patience` milliseconds.

    A layer on its way out is still in the page while it plays its way out
    (`LAYER.rise`, 190 ms, in src/lib/motion.ts), so a flat sleep a little longer than
    that races it: the palette measured 218 to 235 ms from Escape to gone on an idle
    machine, and a busy one lost to the 260 ms this used to sleep about one run in
    three. So the drive waits for the thing itself, as settling.py says."""
    try:
        page.wait_for_function(condition, timeout=patience)
    except PlaywrightTimeout:
        return False
    return True


def palette(page) -> None:
    """Ctrl+Shift+P, from a note and from the file list."""
    say("--- Ctrl+Shift+P ---")

    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field != {"value": ">", "caret": 1}:
        wrong(f"Ctrl+Shift+P did not open the palette on the commands: {field}")
    else:
        say("from a note            -> '>' with the caret after it")
    page.screenshot(path=str(SHOTS / "commands.png"))

    page.keyboard.type("fold")
    page.wait_for_timeout(200)
    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field != {"value": ">fold", "caret": 5}:
        wrong(f"a second press did not put the mark in front, once: {field}")
    else:
        say("pressed again          -> '>fold', the caret at the end")

    page.keyboard.press("Escape")
    if not settles(page, f"() => ({FIELD})() === null"):
        wrong("Escape did not close the palette")

    # The file list is a surface with keys of its own, and this chord is the app's: it
    # is read off the window, so it answers there too.
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(400)
    row = page.locator(".nib-row").first
    if row.count():
        row.click()
        page.wait_for_timeout(250)

    page.keyboard.press("Control+Shift+KeyP")
    page.wait_for_timeout(300)
    field = page.evaluate(FIELD)
    if field is None or field["value"] != ">":
        wrong(f"the chord did not answer in the file list: {field}")
    else:
        say("from the file list     -> '>' as well")
    page.keyboard.press("Escape")
    if not settles(page, f"() => ({FIELD})() === null"):
        wrong("Escape did not close the palette over the file list")


def heading_key(page) -> None:
    """The key that made a heading unmakes it, which is why Paragraph needs no chord."""
    say("--- the heading key undoes itself ---")

    page.evaluate(
        """() => {
          const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
          view?.dispatch({ selection: { anchor: 6 } })
          view?.focus()
        }"""
    )
    page.wait_for_timeout(250)
    heading = page.evaluate(LINE)

    page.keyboard.press("Control+Digit1")
    page.wait_for_timeout(300)
    if page.evaluate(LINE).startswith("#"):
        wrong(f"Ctrl+1 on a first-level heading did not make it prose: {page.evaluate(LINE)!r}")
    else:
        say(f"Control+1              -> {page.evaluate(LINE)!r}")

    page.keyboard.press("Control+Digit1")
    page.wait_for_timeout(300)
    if page.evaluate(LINE) != heading:
        wrong(f"Ctrl+1 did not make it a heading again: {page.evaluate(LINE)!r}")
    else:
        say(f"Control+1 again        -> {page.evaluate(LINE)!r}")


def chooser(page) -> None:
    """Ctrl+T held, which is Alt+Tab's shape, and Ctrl+T tapped, which is a browser's."""
    say("--- Ctrl+T held ---")

    # Ctrl down, T pressed and let go, Ctrl still down: the dialog comes up once the
    # hold has outlasted the beat. See BEAT in src/lib/new-kind-chord.ts.
    page.keyboard.down("Control")
    page.keyboard.press("KeyT")
    page.wait_for_timeout(500)
    sheet = page.evaluate(SHEET)
    if sheet["cards"] != ["New note", "New canvas", "New web note", "New page note"]:
        wrong(f"the held chord did not offer the kinds: {sheet['cards']}")
    else:
        say(f"the dialog             -> {sheet['cards']}")
    if sheet["on"] != "New web note" or sheet["lit"] != "New web note":
        wrong(f"the dialog did not stand on the web page: {sheet['on']!r}, lit {sheet['lit']!r}")
    else:
        say("the keyboard           -> on New web note, lit and ringed")
    if any(abs(one) > 2 for one in sheet["middle"] or [99]):
        wrong(f"the dialog is not in the middle of the window: {sheet['middle']}")
    else:
        say("where                  -> the middle of the window")
    page.screenshot(path=str(SHOTS / "chooser.png"))

    # Each further T steps one along while the modifier stays down, round the end.
    page.keyboard.press("KeyT")
    page.wait_for_timeout(200)
    if page.evaluate(SHEET)["on"] != "New page note":
        wrong("a second T did not step the dialog")
    else:
        say("T again                -> New page note")
    page.keyboard.press("KeyT")
    page.wait_for_timeout(200)
    if page.evaluate(SHEET)["on"] != "New note":
        wrong("a third T did not step round the end")
    else:
        say("T again                -> New note, round the end")

    # And Shift steps back, which is what every switcher under a held modifier does.
    page.keyboard.press("Shift+KeyT")
    page.wait_for_timeout(200)
    if page.evaluate(SHEET)["on"] != "New page note":
        wrong("Shift did not step the dialog back")
    else:
        say("Shift+T                -> New page note")

    # The arrows walk it too, with the modifier still down.
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(200)
    if page.evaluate(SHEET)["on"] != "New web note":
        wrong("an arrow did not step the dialog")
    else:
        say("ArrowLeft              -> New web note")

    # The pointer moves the selection, so the card lit under it is the card the
    # release will choose rather than a second lit card that loses.
    page.locator('[role="dialog"] button:has-text("New canvas")').first.hover()
    page.wait_for_timeout(250)
    if page.evaluate(SHEET)["on"] != "New canvas":
        wrong("hovering a card did not move the selection onto it")
    else:
        say("hover New canvas       -> the selection follows the pointer")

    before = len(page.evaluate(STATE)["tabs"])
    page.keyboard.up("Control")
    page.wait_for_timeout(800)
    state = page.evaluate(STATE)
    if len(state["tabs"]) != before + 1 or state["active"] != {"kind": "canvas", "path": None}:
        wrong(f"letting Ctrl go did not make the kind that stood: {state['active']}")
    else:
        say("Ctrl let go            -> a plane, with no file")
    if not settles(page, f"() => ({SHEET})().cards.length === 0"):
        wrong("the dialog stayed up after the release")

    # Escape closes it and makes nothing, like every other layer the app puts up - and
    # the release that follows must not make one either.
    say("--- Escape ---")
    before = len(page.evaluate(STATE)["tabs"])
    page.keyboard.down("Control")
    page.keyboard.press("KeyT")
    page.wait_for_timeout(500)
    page.keyboard.press("Escape")
    if not settles(page, f"() => ({SHEET})().cards.length === 0"):
        wrong("Escape did not close the dialog")
    page.keyboard.up("Control")
    page.wait_for_timeout(600)
    if len(page.evaluate(STATE)["tabs"]) != before:
        wrong("the release after an Escape made a tab anyway")
    else:
        say("Escape then Ctrl up    -> closed, and nothing made")

    # Tapped rather than held: nothing is drawn and a web page is made, which is the tab
    # a browser makes - whatever was made last, which was the plane above.
    say("--- Ctrl+T tapped ---")
    before = len(page.evaluate(STATE)["tabs"])
    page.keyboard.press("Control+KeyT")
    page.wait_for_timeout(600)
    state = page.evaluate(STATE)
    if page.evaluate(SHEET)["cards"]:
        wrong("a tap of the chord drew the dialog")
    if len(state["tabs"]) != before + 1 or state["active"] != {"kind": "web", "path": None}:
        wrong(f"a tap did not make a web page: {state['active']}")
    else:
        say("Control+T              -> a web page at once, nothing drawn")


def unsaved(page) -> None:
    """Each kind, as a tab with nothing behind it."""
    say("--- a tab of each kind, and nothing on disk ---")

    files = page.evaluate(STATE)["files"]
    for kind, row in (
        ("canvas", "New canvas"),
        ("pages", "New page note"),
        ("web", "New web note"),
    ):
        # Held rather than tapped, because a tap makes a web page and never draws a
        # card to press. The click chooses and lets go of the chord with it, so the
        # release afterwards makes nothing.
        page.keyboard.down("Control")
        page.keyboard.press("KeyT")
        page.wait_for_timeout(500)
        page.locator(f'[role="dialog"] button:has-text("{row}")').first.click()
        page.keyboard.up("Control")
        page.wait_for_timeout(800)

        state = page.evaluate(STATE)
        if state["active"] != {"kind": kind, "path": None}:
            wrong(f"{row} did not open an unsaved {kind}: {state['active']}")
        else:
            say(f"{row:<22} -> a {kind} tab, path null")
        if state["files"] != files:
            wrong(f"{row} wrote something into the space: {state['files']}")

    say(f"the strip              -> {[one['shown'] for one in page.evaluate(STATE)['tabs']]}")
    page.screenshot(path=str(SHOTS / "unsaved-tabs.png"))


def saving(page) -> None:
    """A new tab waits for a place: typed into, it is still a tab with a dot; Ctrl+S asks
    where, Enter writes it; a note with a file asks nothing; a web tab wears no dot and
    is saved the same way."""
    say("--- saving: a place for a new tab, Ctrl+S, a web tab ---")

    # Ctrl+S on a plane nobody has drawn on: the layer that asks where, and nothing
    # written until it is answered. Escape leaves it as it was.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.kind === 'canvas')
          if (tab) ws.activate(tab.id)
        }"""
    )
    page.wait_for_timeout(400)
    files = page.evaluate(STATE)["files"]
    page.keyboard.press("Control+KeyS")
    if not DRIVE.waited(page, "() => !!document.querySelector('[role=\"dialog\"] input')", "the layer"):
        wrong("Ctrl+S on an untouched plane did not ask where it goes")
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    if page.evaluate(STATE)["files"] != files:
        wrong("Ctrl+S on an untouched plane wrote a file before it was answered")
    else:
        say("Control+S on a plane   -> asked where, nothing written")

    # A new note, typed into: still a tab, with the dot after its name.
    page.evaluate("() => window.nibApp.workspace.openBlank()")
    page.wait_for_timeout(400)
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.type("Plan for Monday")
    page.wait_for_timeout(1200)

    state = page.evaluate(STATE)
    if (state["active"] or {}).get("path") is not None or "Plan for Monday.md" in state["files"]:
        wrong(f"typing into a new tab made it a file: {state['active']}")
    elif not page.evaluate(DOTTED):
        wrong("the new note wears no dot")
    else:
        say("typed into a new tab   -> still a tab, with its dot")
    page.screenshot(path=str(SHOTS / "typed-new-tab.png"))

    page.keyboard.press("Control+KeyS")
    DRIVE.wait_for(page, "() => !!document.querySelector('[role=\"dialog\"] input')", "the layer")
    offered = page.locator('[role="dialog"] input').first.input_value()
    page.screenshot(path=str(SHOTS / "save-layer.png"))
    page.keyboard.press("Enter")
    DRIVE.wait_for(
        page,
        "() => (window.nibApp.workspace.active?.path ?? '').endsWith('/Plan for Monday.md')",
        "the note saved",
    )
    say(f"Control+S, Enter       -> {offered!r} saved as Plan for Monday.md")

    page.keyboard.press("Control+KeyS")
    page.wait_for_timeout(500)
    if page.locator('[role="dialog"] input').count():
        wrong("Ctrl+S on a note with a file asked something")
    else:
        say("Control+S on a note    -> nothing asked")

    # A web tab: no dot, and Ctrl+S and Enter write its shortcut.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const tab = ws.tabs.find((one) => one.kind === 'web' && one.path === null)
          if (tab) ws.activate(tab.id)
        }"""
    )
    page.wait_for_timeout(400)
    if page.evaluate(DOTTED):
        wrong("a web tab wears the dot")
    page.keyboard.press("Control+KeyS")
    DRIVE.wait_for(page, "() => !!document.querySelector('[role=\"dialog\"] input')", "the layer")
    page.keyboard.press("Enter")
    DRIVE.wait_for(
        page,
        "() => (window.nibApp.workspace.active?.path ?? '').endsWith('.url')",
        "the web tab saved",
    )
    say(f"Control+S on a web tab -> {page.evaluate(STATE)['active']['path']}")


def nothing_open(page) -> None:
    """Closing everything, and the buttons that answer."""
    say("--- nothing open ---")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)

    state = page.evaluate(STATE)
    if state["tabs"]:
        wrong(f"closing every tab left something open: {state['tabs']}")
    else:
        say("every tab closed       -> nothing open, and nothing made")

    here = page.evaluate(HERE)
    if here["buttons"] != ["New note", "New canvas", "New web note", "New page note"]:
        wrong(f"the empty pane does not offer the kinds: {here['buttons']}")
    else:
        say(f"the buttons            -> {here['buttons']}")
    if here["on"] != "New note":
        wrong(f"the keyboard did not land on the first button: {here['on']!r}")
    else:
        say("the keyboard           -> on New note, the first")

    # One set, at one size. Emil, 2026-09-17: *"the icons in these buttons are not
    # properly aligned"* - and every one of them was centred: what differed was how
    # much of its grid each drawing filled, which at this size reads as the canvas
    # sitting oddly. A width may differ, because a page is a portrait shape; the
    # height and where it starts may not. See file-mark.ts.
    marks = here["marks"]
    say(f"the marks              -> {marks}")
    if any(one is None for one in marks):
        wrong(f"a button wears no mark at all: {marks}")
    else:
        sizes = {(one["top"], one["tall"]) for one in marks}
        if len(sizes) != 1:
            wrong(f"the marks do not fill the same height of their grid: {sorted(sizes)}")
        else:
            say(f"one height             -> {sizes.pop()} of 24")

    page.screenshot(path=str(SHOTS / "nothing-open.png"))

    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(250)
    if page.evaluate(HERE)["on"] != "New page note":
        wrong("the arrows do not walk the buttons, or do not wrap")
    else:
        say("ArrowLeft              -> New page note, round the end")

    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    state = page.evaluate(STATE)
    if state["active"] != {"kind": "pages", "path": None}:
        wrong(f"pressing the button did not make a page note: {state['active']}")
    else:
        say("Enter                  -> an unsaved page note")

    held_over_the_buttons(page)


def held_over_the_buttons(page) -> None:
    """The same chord over a pane with nothing open: the same dialog, on the web page.

    One gesture, one surface: Ctrl+T is the dialog wherever the keyboard is, so a hand
    never has to know whether the pane under it happens to be empty."""
    say("--- the chord over an empty pane ---")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)

    page.keyboard.down("Control")
    page.keyboard.press("KeyT")
    page.wait_for_timeout(500)
    if page.evaluate(SHEET)["on"] != "New web note":
        wrong(f"the chord over an empty pane did not stand on the web page: {page.evaluate(SHEET)}")
    else:
        say("Ctrl held, T           -> the dialog, on New web note")
    page.screenshot(path=str(SHOTS / "over-nothing-open.png"))

    page.keyboard.press("KeyT")
    page.wait_for_timeout(250)
    page.keyboard.up("Control")
    page.wait_for_timeout(900)
    state = page.evaluate(STATE)
    if state["active"] != {"kind": "pages", "path": None}:
        wrong(f"letting Ctrl go did not make the card that stood: {state['active']}")
    else:
        say("T, Ctrl let go         -> a page note, with no file")


def drive(browser) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        user_agent=DESKTOP_AGENT,
        color_scheme="dark",
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    page.wait_for_timeout(800)

    say(f"{page.evaluate(SEED)} file(s) in the space")
    page.wait_for_timeout(500)
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.wait_for_timeout(200)

    palette(page)
    heading_key(page)
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    chooser(page)
    unsaved(page)
    saving(page)
    nothing_open(page)

    page.screenshot(path=str(SHOTS / "after.png"))
    context.close()


def main() -> int:
    with DRIVE.session() as browser:
        drive(browser)

    return DRIVE.verdict("everything the drive checked was right")


if __name__ == "__main__":
    raise SystemExit(main())
