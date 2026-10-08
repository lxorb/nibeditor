"""A new tab: what kind, where it comes from, and what it costs on disk.

What it proves, in order:

* **Ctrl+Shift+P** opens the palette already on the commands - a `>` in the field with
  the caret after it - from a note and from the file list alike, and a second press puts
  the mark in front of whatever is typed, once. Escape closes it.
* **Paragraph needs no chord**: Ctrl+1 on a line that is already a first-level heading
  turns it back into prose, and again makes it a heading. That is what freed
  Ctrl+Shift+P for the palette.
* **Ctrl+T is a new tab** (Emil, issue #213): a web tab whose address field has the
  keyboard, and under it the kinds a tab can be, in three lines, each with its letter.
  A letter typed is the address field's; once Escape has let go of the field, the letter
  makes its kind, in the new tab's place. The plus makes the same tab, and hangs no menu.
* **Every kind opens as a tab and writes nothing**: a plane, a deck of pages and a
  website open with no file in the space and no row in the list.
* **A new tab waits for a place**: a new note typed into is still a tab with no file and a
  dot after its name; Ctrl+S asks where, in the layer under the tab, and Enter writes it
  there under its first line; Ctrl+S on a note with a file asks nothing; a web tab wears no
  dot, and Ctrl+S and Enter write its shortcut.
* **A pane with nothing open** shows those same kinds as cards, with the keyboard on
  the first, and pressing one or its letter makes that kind; Ctrl+T over it is a new tab.

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

# The new tab in front: whether it is one, where the keyboard is, and the cards under it,
# line by line.
NEW_TAB = """
() => {
  const ws = window.nibApp.workspace
  const tab = ws.active
  const pane = document.querySelector(`[data-pane="${ws.panes.focusedId}"]`)
  const here = pane?.querySelector('[data-new-here]')
  const name = (one) => one.querySelector('.nib-row-label')?.textContent.trim()
  const at = document.activeElement
  return {
    newTab: !!tab && ws.isNewTab(tab),
    typing: at?.getAttribute('aria-label') === 'Address',
    typed: at instanceof HTMLInputElement ? at.value : null,
    lines: here ? [...here.querySelectorAll('.line')].map((line) => [...line.querySelectorAll('.kind')].map(name)) : [],
    letters: here ? [...here.querySelectorAll('.kind kbd')].map((one) => one.textContent) : [],
    menu: !!document.querySelector('.menu'),
  }
}
"""

HERE = """
() => {
  const buttons = [...document.querySelectorAll('[data-new-here] button')]
  const round = (n) => Math.round(n * 100) / 100

  return {
    buttons: buttons.map((one) => one.querySelector('.nib-row-label')?.textContent.trim()),
    on: document.activeElement?.querySelector('.nib-row-label')?.textContent.trim() ?? null,
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


# The kinds a browser build offers, line by line: no shell of its own, so the middle line
# is the online terminal alone, and no private tab.
LINES = [["New note", "New canvas", "New page note"], ["Online terminal"], ["New web note"]]


def chooser(page) -> None:
    """Ctrl+T, a new tab: its address field, and the kinds under it (issue #213)."""
    say("--- Ctrl+T ---")

    before = len(page.evaluate(STATE)["tabs"])
    page.keyboard.press("Control+KeyT")
    if not settles(page, f"() => ({NEW_TAB})().lines.length > 0"):
        wrong(f"Ctrl+T drew no kinds under its address field: {page.evaluate(NEW_TAB)}")
    new = page.evaluate(NEW_TAB)
    state = page.evaluate(STATE)
    if len(state["tabs"]) != before + 1 or not new["newTab"]:
        wrong(f"Ctrl+T did not make a new tab: {state['active']}")
    else:
        say("Control+T              -> a new tab")
    if not new["typing"]:
        wrong("the new tab's address field did not take the keyboard")
    else:
        say("the keyboard           -> in the address field")
    if new["lines"] != LINES:
        wrong(f"the kinds are not in Emil's lines: {new['lines']}")
    else:
        say(f"the lines              -> {new['lines']}")
    if new["letters"] != ["N", "C", "P", "O", "W"]:
        wrong(f"the cards do not wear their letters: {new['letters']}")
    page.screenshot(path=str(SHOTS / "new-tab.png"))

    # A letter typed is the address's, and makes nothing.
    page.keyboard.press("KeyC")
    page.wait_for_timeout(300)
    new = page.evaluate(NEW_TAB)
    if new["typed"] != "c" or len(page.evaluate(STATE)["tabs"]) != before + 1:
        wrong(f"a letter in the address field did something else: {new}")
    else:
        say("C in the field         -> the address's, nothing made")
    page.keyboard.press("Backspace")

    # Escape lets go of the field, and the letter is then the card's: a plane, in the new
    # tab's place, with no empty web tab left behind it.
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    page.keyboard.press("KeyC")
    if not settles(page, "() => window.nibApp.workspace.active?.kind === 'canvas'"):
        wrong(f"C after Escape made no plane: {page.evaluate(STATE)['active']}")
    state = page.evaluate(STATE)
    if len(state["tabs"]) != before + 1 or any(one["kind"] == "web" for one in state["tabs"]):
        wrong(f"the plane did not take the new tab's place: {state['tabs']}")
    else:
        say("Escape, C              -> a plane, where the new tab was")

    # The plus: the same new tab, and no menu hung from it.
    say("--- the plus ---")
    before = len(page.evaluate(STATE)["tabs"])
    page.locator(".strip button.new").first.click()
    if not settles(page, f"() => ({NEW_TAB})().lines.length > 0"):
        wrong("the plus made no new tab")
    new = page.evaluate(NEW_TAB)
    if new["menu"]:
        wrong("the plus still hangs a menu")
    if not new["newTab"] or len(page.evaluate(STATE)["tabs"]) != before + 1:
        wrong(f"the plus did not make a new tab: {page.evaluate(STATE)['active']}")
    else:
        say("the plus               -> a new tab, no menu")

    # A press on a card is the same as its letter: a web note makes a fresh new tab in
    # this one's place, the address field taking the keyboard again.
    page.locator('[data-new-here] .kind:has-text("New web note")').first.click()
    page.wait_for_timeout(400)
    state = page.evaluate(STATE)
    if len(state["tabs"]) != before + 1 or not page.evaluate(NEW_TAB)["typing"]:
        wrong(f"a web note chosen on a new tab was not a new tab in its place: {state['tabs']}")
    else:
        say("New web note pressed   -> a new tab in its place")
    page.keyboard.press("Control+KeyW")
    page.wait_for_timeout(300)


def unsaved(page) -> None:
    """Each kind, as a tab with nothing behind it."""
    say("--- a tab of each kind, and nothing on disk ---")

    files = page.evaluate(STATE)["files"]
    for kind, row in (
        ("canvas", "New canvas"),
        ("pages", "New page note"),
        ("web", "New web note"),
    ):
        # A new tab, and the card pressed on it.
        page.keyboard.press("Control+KeyT")
        page.locator(f'[data-new-here] .kind:has-text("{row}")').first.click()
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
    if here["buttons"] != [one for line in LINES for one in line]:
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
        # The file marks, which is what file-mark.ts holds to one height: the online
        # terminal wears a drawing of its own (a cloud is wider than it is tall).
        files = [one for one, name in zip(marks, here["buttons"]) if name != "Online terminal"]
        sizes = {(one["top"], one["tall"]) for one in files}
        if len(sizes) != 1:
            wrong(f"the marks do not fill the same height of their grid: {sorted(sizes)}")
        else:
            say(f"one height             -> {sizes.pop()} of 24")

    page.screenshot(path=str(SHOTS / "nothing-open.png"))

    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(250)
    if page.evaluate(HERE)["on"] != "New web note":
        wrong("the arrows do not walk the buttons, or do not wrap")
    else:
        say("ArrowLeft              -> New web note, round the end")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(250)
    if page.evaluate(HERE)["on"] != "New page note":
        wrong("the arrows do not walk the buttons across the lines")

    page.keyboard.press("Enter")
    page.wait_for_timeout(900)
    state = page.evaluate(STATE)
    if state["active"] != {"kind": "pages", "path": None}:
        wrong(f"pressing the button did not make a page note: {state['active']}")
    else:
        say("Enter                  -> an unsaved page note")

    held_over_the_buttons(page)


def held_over_the_buttons(page) -> None:
    """Ctrl+T over a pane with nothing open: a new tab, as anywhere, and a letter on the
    empty pane's own cards makes its kind straight away."""
    say("--- Ctrl+T over an empty pane ---")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)

    # The keyboard is on the first card already, so a letter is the card's.
    page.keyboard.press("KeyP")
    if not settles(page, "() => window.nibApp.workspace.active?.kind === 'pages'"):
        wrong(f"P over an empty pane made no page note: {page.evaluate(STATE)['active']}")
    else:
        say("P                      -> a page note")

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )
    page.wait_for_timeout(800)
    page.keyboard.press("Control+KeyT")
    if not settles(page, f"() => ({NEW_TAB})().newTab"):
        wrong("Ctrl+T over an empty pane made no new tab")
    else:
        say("Control+T              -> a new tab, as anywhere")
    page.screenshot(path=str(SHOTS / "over-nothing-open.png"))


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
