"""The whole app, reached with nothing but a keyboard.

Every step below is `page.keyboard`. Nothing is clicked, hovered, tapped or
scrolled, and the drive says at each step which element holds the focus, so a
region that cannot be reached shows up as a name that did not change rather than
as a screenshot somebody has to squint at.

What it proves, in order: F6 walks the regions and comes back round; Tab stops
once per list rather than once per row; the arrows walk a list and Enter opens a
note; the panel tabs and the strip of notes are each one stop with arrows inside
them; the four panels answer their own chords; every sheet and menu traps the
keyboard and hands it back to whatever opened it; and the focus ring is drawn in
both schemes.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/keyboard.py

Screenshots go beside this file under `shots/keyboard/`, which is ignored. This is
a scratch drive rather than a test: it drives the app and says what it saw.
"""

from __future__ import annotations

from pathlib import Path

from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin


DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
TABLET_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

# name, width, height, agent, finger, scheme
DEVICES = [
    ("desktop-light", 1440, 900, DESKTOP_AGENT, False, "light"),
    ("desktop-dark", 1440, 900, DESKTOP_AGENT, False, "dark"),
    # A tablet with a keyboard, which is a touch screen that still has to answer
    # every one of these.
    ("tablet-keys", 1194, 834, TABLET_AGENT, True, "light"),
]

# The same space every other drive reads, small enough to walk by name.
SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const join = (dir, name) => (dir.endsWith('/') ? dir + name : dir + '/' + name)

  // A folder with no note of its own, which is the one kind nib does not make:
  // it is here because notes are written into it, the way a vault's folders are.
  const folder = join(root, 'Field notes')

  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind above the field.\\n\\n## What went in this week\\n\\n- Pressure on the pen\\n\\n### Wind\\n\\nThe wind was steady all week.', undefined)
  await ws.noteFrom('# Read me\\n\\nA markdown editor that formats what you write as you write it.', undefined)
  await ws.noteFrom('# Reading list\\n\\nA paper about ink, and one about wind.', undefined)
  await ws.noteFrom('# Ledger\\n\\nWhat the wind cost.', folder)
  await ws.noteFrom('# Sketches\\n\\nInk on paper.', folder)

  ws.device.expand(folder)
  await ws.loadTree()

  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) {
    ws.bookmarks.toggle({ kind: 'note', path: first.name })
    await ws.openEntry(first.path, { activate: true })
  }
  const second = ws.notes.find((one) => one.name.startsWith('Read me'))
  if (second) await ws.openEntry(second.path, { activate: true })

  return ws.files.map((one) => one.name)
}
"""

# What has the keyboard, as one line: the region it is in, the element, and enough
# of its words to tell one row from another.
WHERE = """
() => {
  const at = document.activeElement
  if (!at) return 'nothing'

  const region = at.closest('[data-region]')?.dataset.region ?? '-'
  const tag = at.tagName.toLowerCase()
  const named =
    at.getAttribute('aria-label') ??
    at.getAttribute('title') ??
    (at.textContent ?? '').trim().slice(0, 32)
  const cls = (at.className ?? '').toString().split(' ').filter(Boolean).slice(0, 3).join('.')
  const stops = document.querySelectorAll('[data-region="list"] [tabindex="0"]').length

  return `${region} | ${tag}.${cls} | ${JSON.stringify(named)} | list stops: ${stops}`
}
"""

# Whether a ring is actually being drawn on what holds the keyboard, which is the
# one thing a screenshot is for and the one thing it cannot be asked about.
RING = """
() => {
  const at = document.activeElement
  if (!(at instanceof HTMLElement)) return 'no element'

  const style = getComputedStyle(at)
  const visible = at.matches(':focus-visible')
  return `${visible ? 'ring' : 'no ring'}: ${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`
}
"""


def drive(browser, out: Path, name, width, height, agent, finger, scheme) -> None:
    out.mkdir(parents=True, exist_ok=True)

    context = browser.new_context(
        viewport={"width": width, "height": height},
        user_agent=agent,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        device_scale_factor=2,
    )
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    DRIVE.open(page)
    page.evaluate("() => { for (let i = 0; i < 12; i++) history.pushState({ spare: i }, '') }")
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.wait_for_timeout(200)
    say(f"[{name}] the space holds {page.evaluate(SEED)}")
    page.wait_for_timeout(700)

    def shot(tag: str) -> None:
        page.screenshot(path=str(out / f"{name}-{tag}.png"))
        say(f"    shot {name}-{tag}.png")

    def press(key: str, wait: int = 260) -> str:
        page.keyboard.press(key)
        page.wait_for_timeout(wait)
        return page.evaluate(WHERE)

    def step(key: str, wait: int = 260) -> None:
        say(f"    {key:<18} -> {press(key, wait)}")

    def region() -> str:
        return page.evaluate("() => document.activeElement?.closest('[data-region]')?.dataset.region ?? '-'")

    def open_panel() -> None:
        """The sidebar, which a fresh profile starts without."""
        if not page.evaluate("() => !!window.nibApp.workspace.panel"):
            page.keyboard.press("Control+Shift+L")
            page.wait_for_timeout(400)

    say(f"[{name}] --- the regions, walked with F6 ---")
    open_panel()
    # From the note outwards, which is where a reader starts.
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.wait_for_timeout(200)
    say(f"    the note has it     -> {page.evaluate(WHERE)}")

    walked = []
    for _ in range(8):
        step("F6")
        walked.append(region())
    say(f"    F6 went round: {' -> '.join(walked)}")
    shot("region-ring")

    say(f"[{name}] --- Tab stops once per list, not once per row ---")
    page.keyboard.press("Control+Shift+E")
    page.wait_for_timeout(500)
    say(f"    Ctrl+Shift+E        -> {page.evaluate(WHERE)}")
    say(f"    {page.evaluate(RING)}")
    shot("list-ring")
    for _ in range(4):
        step("Tab")
    say("    (four presses of Tab; a space of six notes did not eat them)")

    def into_tree() -> None:
        """The file tree, which is the second list in the panel: the bookmarks above
        it are a composite of their own and one Tab away from it.

        The chord is only pressed from outside the list, because inside it the same
        chord is the way back to the note."""
        if region() != "list":
            page.keyboard.press("Control+Shift+E")
            page.wait_for_timeout(450)
        for _ in range(3):
            # A row of the file list and of no other list in the panel: every row
            # there is a note, and the path it stands for is written on it. See
            # docs/tree.md.
            if page.evaluate("() => !!document.activeElement?.matches('.row[data-path]')"):
                return
            page.keyboard.press("Tab")
            page.wait_for_timeout(200)

    say(f"[{name}] --- the list, walked with the arrows ---")
    into_tree()
    say(f"    into the tree       -> {page.evaluate(WHERE)}")
    for key in ["ArrowDown", "ArrowDown", "ArrowUp", "Home", "End"]:
        step(key)
    say("    spelling a name:")
    page.keyboard.type("re", delay=60)
    page.wait_for_timeout(300)
    say(f"    typed 're'          -> {page.evaluate(WHERE)}")
    shot("typeahead-ring")

    say(f"[{name}] --- a folder, opened and stepped into ---")
    page.keyboard.press("Home")
    page.wait_for_timeout(200)
    say(f"    Home                -> {page.evaluate(WHERE)}")
    for key in ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowLeft"]:
        step(key)

    say(f"[{name}] --- Enter opens a note and the caret follows ---")
    into_tree()
    page.keyboard.press("End")
    page.wait_for_timeout(200)
    before = page.evaluate("() => window.nibApp.workspace.active?.name ?? '-'")
    step("Enter", 700)
    after = page.evaluate("() => window.nibApp.workspace.active?.name ?? '-'")
    say(f"    the note went from {before!r} to {after!r}")

    say(f"[{name}] --- Escape hands the keyboard back to the note ---")
    into_tree()
    step("ArrowDown")
    step("Escape")
    step("Escape")

    say(f"[{name}] --- the four panels, each on its own chord ---")
    for chord, panel in [
        ("Control+Shift+E", "tree"),
        ("Control+Shift+O", "outline"),
        ("Control+Shift+F", "search"),
        ("Control+Shift+B", "links"),
    ]:
        page.keyboard.press(chord)
        page.wait_for_timeout(500)
        # On whichever side the panel lives: the Outline and the Links are the right's.
        showing = page.evaluate(
            "(one) => window.nibApp.workspace.openOn(window.nibApp.workspace.sideOf(one))", panel
        )
        say(f"    {chord:<18} -> panel {showing!r} (wanted {panel!r}), {page.evaluate(WHERE)}")
    shot("panels-links")

    say(f"[{name}] --- the panel tabs: left and right, changing on arrival ---")
    for _ in range(9):
        if region() == "panels":
            break
        page.keyboard.press("F6")
        page.wait_for_timeout(200)
    say(f"    F6 to the tabs      -> {page.evaluate(WHERE)}")
    for key in ["ArrowRight", "ArrowRight", "ArrowLeft", "End", "Home"]:
        page.keyboard.press(key)
        page.wait_for_timeout(320)
        panel = page.evaluate("() => window.nibApp.workspace.panel")
        say(f"    {key:<18} -> panel {panel!r}")
    shot("panel-tabs-ring")

    say(f"[{name}] --- the outline of a note that has headings ---")
    into_tree()
    page.keyboard.type("k", delay=60)
    page.wait_for_timeout(300)
    say(f"    spelled 'k'         -> {page.evaluate(WHERE)}")
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)
    page.keyboard.press("Control+Shift+O")
    page.wait_for_timeout(600)
    say(f"    Ctrl+Shift+O        -> {page.evaluate(WHERE)}")
    for key in ["ArrowDown", "ArrowDown", " "]:
        step(key, 400)
    shot("outline-ring")

    if not finger:
        say(f"[{name}] --- the strip: one stop, arrows inside it ---")
        # Round the regions until the strip has it, which is what F6 is for.
        for _ in range(8):
            if region() == "tabs":
                break
            page.keyboard.press("F6")
            page.wait_for_timeout(200)
        say(f"    F6 to the strip     -> {page.evaluate(WHERE)}")
        shot("tabs-ring")
        for key in ["ArrowRight", "ArrowRight", "ArrowLeft", "Enter"]:
            step(key, 400)
        say(f"    the note in front is {page.evaluate('() => window.nibApp.workspace.active?.name')!r}")

        say(f"[{name}] --- Ctrl+Tab round the strip ---")
        for _ in range(2):
            page.keyboard.press("Control+Tab")
            page.wait_for_timeout(400)
            say(f"    Ctrl+Tab            -> {page.evaluate('() => window.nibApp.workspace.active?.name')!r}")

    say(f"[{name}] --- the layers: opened, trapped, closed, and given back ---")
    layers = [
        ("Control+O", "the palette"),
        ("Control+Shift+Slash", "the keyboard list in the settings"),
        ("Control+Comma", "the settings"),
        ("Control+Space", "the space switcher"),
        ("Control+Shift+Space", "the space switcher, by its second key"),
    ]
    for chord, what in layers:
        into_tree()
        page.keyboard.press("ArrowDown")
        page.wait_for_timeout(200)
        from_here = page.evaluate(WHERE)

        page.keyboard.press(chord)
        page.wait_for_timeout(600)
        inside = page.evaluate(WHERE)
        depth = page.evaluate("() => window.nibApp.overlays?.depth ?? -1")
        # Tab has to stay inside it.
        page.keyboard.press("Tab")
        page.wait_for_timeout(200)
        held = page.evaluate(
            "() => { const at = document.activeElement; const box = at?.closest('[role=dialog], .sheet, .panel, .palette, [role=menu]'); return box ? 'held' : 'escaped' }"
        )
        say(f"    {chord:<18} {what}: {inside}")
        say(f"        overlays {depth}, Tab {held}")
        shot(f"layer-{chord.replace('+', '-').lower()}")

        page.keyboard.press("Escape")
        page.wait_for_timeout(700)
        back = page.evaluate(WHERE)
        say(f"        Escape -> {back}")
        say(f"        opened from {from_here.split(' | ')[2] if ' | ' in from_here else from_here}")

    say(f"[{name}] --- a row's own menu, on the key a keyboard has for it ---")
    into_tree()
    step("Shift+F10", 600)
    say(f"    menu open: {page.evaluate('() => !!document.querySelector(\"[role=menu]\")')}")
    shot("row-menu-ring")
    for key in ["ArrowDown", "ArrowDown", "End", "Escape"]:
        step(key, 400)

    say(f"[{name}] --- and the bar under the note, which had no way in at all ---")
    for _ in range(9):
        if region() == "status":
            break
        page.keyboard.press("F6")
        page.wait_for_timeout(200)
    say(f"    F6 to the bar       -> {page.evaluate(WHERE)}")
    say(f"    {page.evaluate(RING)}")
    say(f"    counts showing: {page.evaluate('() => !!document.querySelector(\"footer.looking\")')}")
    shot("status-ring")

    context.close()


def main() -> int:
    out = DRIVE.shots
    with DRIVE.session() as browser:
        for one in DEVICES:
            say(f"=== {one[0]} ===")
            drive(browser, out, *one)

    return DRIVE.verdict(f"shots in {out}")


if __name__ == "__main__":
    raise SystemExit(main())
