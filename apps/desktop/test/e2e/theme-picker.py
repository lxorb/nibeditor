"""The theme picker, driven the way a person uses it, and photographed.

Emil asked for a theme chooser that opens from a right click on the light and dark
switch or from the palette, tries a theme on the whole app while it is pointed at,
and keeps it on a click. This installs six themes from the store the way the
gallery does, then checks each of those promises in Chromium:

  - a right click on the switch opens the picker beside it;
  - pointing at a card puts that theme on the app and writes nothing down;
  - leaving the cards, Escape, and a press outside each put back what was there;
  - the arrows try each theme, Enter keeps one;
  - a click keeps a theme and closes;
  - the palette's row opens it where the palette stands;
  - typing narrows the cards and tries the first that answers;

and says how long a theme takes to be on the page once it is pointed at.

Run it from the repository root, after building (`npx vite build --mode drive` in
apps/desktop):

    python apps/desktop/test/e2e/theme-picker.py

Shots go beside this file under `shots/theme-picker/`, which is ignored, or into
NIB_SHOTS when that names a folder. Exits non-zero when a promise is not kept.
"""

from __future__ import annotations

import sys


from settling import HIDE_CARET, steady

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
failures = DRIVE.failures
ORIGIN = DRIVE.origin
SHOTS = DRIVE.shots
APP = harness.APP


#: Two with both sides, one dark only, one light only, and two more pairs, so the
#: grid holds every shape a card comes in.
INSTALL = ["github", "rose", "solar", "graphite", "newsprint", "mono"]

SEED = """
async () => {
  const ws = window.nibApp.workspace
  await ws.noteFrom('# Kestrel notes\\n\\nA kestrel hangs on the wind, and [a link](https://example.com) says where.\\n\\n- One thing\\n- Another\\n\\n```js\\nconst ink = "on glass"\\n```\\n')
  await ws.noteFrom('# Reading list\\n\\nA paper about ink.')
  await ws.noteFrom('# Journal\\n\\nThe morning.')
  await ws.loadTree()
  const first = ws.notes.find((one) => one.name.startsWith('Kestrel'))
  if (first) await ws.openEntry(first.path, { activate: true })
  return ws.files.length
}
"""

INSTALLING = """
async (ids) => {
  const store = window.nibApp.themeStore
  await store.load(true)
  for (const id of ids) {
    const one = store.themes.find((theme) => theme.id === id)
    if (one) await store.install(one)
  }
  const theme = window.nibApp.theme
  theme.select('default')
  theme.setScheme('dark')
  theme.setAccent('violet')
  return theme.files.map((one) => one.id)
}
"""

#: What is on the page and what is written down, which the promises are about.
STATE = """
() => ({
  id: window.nibApp.theme.id,
  scheme: document.documentElement.dataset.theme,
  kept: localStorage.getItem('nib:theme'),
  keptScheme: localStorage.getItem('nib:theme-scheme'),
  open: !!document.querySelector('[role="dialog"][aria-label="Themes"]'),
})
"""

#: How long pointing takes to become paint: the move is dispatched, and the page is
#: asked for the colour the window resolved to on the next two frames.
TIMED = """
async (name) => {
  const card = [...document.querySelectorAll('[role="option"]')].find((one) => one.textContent.includes(name))
  const start = performance.now()
  card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))
  getComputedStyle(document.body).backgroundColor
  const styled = performance.now() - start
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  return { styled, painted: performance.now() - start }
}
"""


def check(what: str, ok: bool) -> None:
    say(f"{'ok  ' if ok else 'FAIL'} {what}")
    if not ok:
        failures.append(what)


def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            color_scheme="dark",
            reduced_motion="reduce",
            device_scale_factor=2,
        )
        context.add_init_script(HIDE_CARET)
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"page error: {error}"))

        def shot(name: str) -> None:
            picture = steady(page, lambda: page.screenshot(), say, name)
            (SHOTS / f"{name}.png").write_bytes(picture)
            say(f"shot {name}")

        def state() -> dict:
            return page.evaluate(STATE)

        def card(name: str):
            return page.locator('[role="option"]', has_text=name).first

        DRIVE.open(page)
        page.evaluate(SEED)
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        installed = page.evaluate(INSTALLING, INSTALL)
        say(f"installed {', '.join(installed)}")
        check("the store installed the six themes", len(installed) == len(INSTALL))
        page.wait_for_timeout(300)

        # A right click on the switch in the panel's foot.
        switch = page.locator(".foot .acts button[aria-disabled]").first
        switch.click(button="right")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        box = page.locator('[role="dialog"][aria-label="Themes"]').bounding_box()
        near = switch.bounding_box()
        check(
            "a right click on the switch opens the picker beside it",
            box is not None
            and near is not None
            and box["y"] + box["height"] <= near["y"]
            and abs(box["x"] - near["x"]) < 400,
        )
        shot("1-open-from-switch")

        # Pointing at a card puts it on the whole app and writes nothing down.
        card("GitHub").hover()
        now = state()
        check("pointing at GitHub puts it on the app", now["id"] == "file:github")
        check("and writes nothing down", now["kept"] == "default")
        shot("2-pointing-github")

        card("Rose").hover()
        check("pointing at Rose tries Rose", state()["id"] == "file:rose")
        shot("3-pointing-rose")

        card("Newsprint").hover()
        now = state()
        check(
            "a light-only theme is shown in its light",
            now["id"] == "file:newsprint" and now["scheme"] == "light",
        )
        shot("4-pointing-newsprint")

        timing = page.evaluate(TIMED, "Solar")
        say(
            f"Solar styled {timing['styled']:.1f} ms after the pointer moved,"
            f" painted within {timing['painted']:.1f} ms"
        )
        check("a theme is on the page within two frames", timing["painted"] < 50)

        # Leaving the cards gives the kept one back.
        page.mouse.move(1200, 60)
        now = state()
        check(
            "moving off the cards gives the kept theme back",
            now["id"] == "default" and now["scheme"] == "dark" and now["open"],
        )

        # Escape, after trying a theme with the keys.
        page.keyboard.press("ArrowRight")
        check("the arrows try a theme", state()["id"] == "contrast")
        page.keyboard.press("ArrowDown")
        tried = state()["id"]
        page.keyboard.press("Escape")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        now = state()
        check(
            f"Escape after trying {tried} closes and puts back the kept theme",
            now["id"] == "default" and now["kept"] == "default" and not now["open"],
        )

        # A press outside.
        switch.click(button="right")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        card("Graphite").hover()
        page.mouse.click(1100, 400)
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        check("a press outside puts back the kept theme", state()["id"] == "default")

        # The scheme, tried from its mark.
        switch.click(button="right")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        page.locator('[role="radiogroup"] button[aria-label="Light"]').hover()
        now = state()
        check(
            "pointing at the light mark tries the light, and keeps nothing",
            now["scheme"] == "light" and now["keptScheme"] == "dark",
        )
        shot("5-pointing-light")
        card("Solar").hover()
        shot("6-pointing-solar")

        # A click keeps.
        card("Solar").click()
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        now = state()
        check(
            "a click keeps Solar, written down, and closes",
            now["id"] == "file:solar" and now["kept"] == "file:solar" and not now["open"],
        )
        shot("7-kept-solar")

        # The palette's row, which opens it where the palette stands.
        page.keyboard.press("Control+Shift+P")
        page.wait_for_selector('input[role="combobox"]')
        page.keyboard.type("Switch theme")
        page.wait_for_timeout(150)
        page.keyboard.press("Enter")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        box = page.locator('[role="dialog"][aria-label="Themes"]').bounding_box()
        check(
            "the palette's row opens it where the palette stands",
            box is not None and abs(box["x"] + box["width"] / 2 - 640) < 4,
        )
        shot("8-open-from-palette")

        # Typing narrows the cards and tries the first that answers.
        page.keyboard.type("gra")
        now = state()
        check("typing narrows to Graphite and tries it", now["id"] == "file:graphite")
        shot("9-typed")
        page.keyboard.press("Enter")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]', state="detached")
        check("and Enter keeps it", state()["kept"] == "file:graphite")

        # Back to the built-in, in the light, for the last picture.
        page.evaluate(
            "() => { window.nibApp.theme.select('default'); window.nibApp.theme.setScheme('light') }"
        )
        switch.click(button="right")
        page.wait_for_selector('[role="dialog"][aria-label="Themes"]')
        shot("10-light-open")
        page.keyboard.press("Escape")

    if failures:
        say(f"{len(failures)} failed: {'; '.join(failures)}")
        return 1

    say("every promise kept")
    return 0


if __name__ == "__main__":
    sys.exit(main())
