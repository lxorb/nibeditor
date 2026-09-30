"""The sync light becoming words, and what that does to the page.

App.svelte turns `sync.status` into a line in the live region. This flips the
status the way a pass does and then asks the page to do something: if the region
has run away with the effect that feeds it, Svelte has thrown by now and nothing
on the page answers again.
"""

from __future__ import annotations

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
APP = harness.APP


DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)


def main() -> int:
    trouble: list[str] = []

    with DRIVE.session() as browser:
        context = browser.new_context(
            viewport={"width": 1440, "height": 900}, user_agent=DESKTOP_AGENT
        )
        page = context.new_page()
        page.set_default_timeout(15000)

        def hurt(words: str) -> None:
            trouble.append(words)
            say(words)

        page.on("pageerror", lambda error: hurt(f"PAGE ERROR: {error}"))
        page.on(
            "console",
            lambda one: hurt(f"console {one.type}: {one.text[:300]}")
            if one.type == "error"
            else None,
        )

        DRIVE.open(page)
        page.evaluate(
            """() => {
              const ws = window.nibApp.workspace
              if (ws.panel !== 'tree') ws.showPanel('tree')
            }"""
        )
        page.wait_for_timeout(1000)
        say(f"switcher before: {page.locator('aside .name').count()}")

        # One pass, as the loop reports it.
        page.evaluate("() => (window.nibApp.sync.status = 'syncing')")
        page.wait_for_timeout(1500)
        say(f"said: {page.evaluate('''() => document.querySelector('p[role=status]')?.textContent''')!r}")

        # And now something has to happen on the page. A switcher that does
        # not open is a page whose updates have stopped.
        page.locator("aside .name").first.click()
        page.wait_for_timeout(800)
        spaces = page.locator(".spaces")
        seen = bool(spaces.count()) and spaces.first.is_visible()
        say(f"after one pass, the switcher: layer={spaces.count()} seen={seen}")
        if not seen:
            hurt("THE SWITCHER DIED AFTER THE SYNC LIGHT SPOKE")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)

        # A pass that failed, twice, which is the same words twice.
        page.evaluate(
            """() => {
              const sync = window.nibApp.sync
              sync.lastError = 'the account refused that'
              sync.status = 'error'
            }"""
        )
        page.wait_for_timeout(600)
        page.evaluate("() => (window.nibApp.sync.status = 'idle')")
        page.wait_for_timeout(200)
        page.evaluate("() => (window.nibApp.sync.status = 'error')")
        page.wait_for_timeout(1200)

        rows = page.locator("aside .nib-row.row[data-path]")
        say(f"tree rows {rows.count()}")
        if rows.count():
            rows.first.click(button="right")
            page.wait_for_timeout(800)
            popup = page.locator("[role=menu].menu")
            there = bool(popup.count()) and popup.first.is_visible()
            say(f"after a failed pass, the note's menu: layer={popup.count()} seen={there}")
            if not there:
                hurt("THE NOTE'S MENU DIED AFTER THE SYNC LIGHT SPOKE TWICE")

    say("")
    if trouble:
        say(f"{len(trouble)} thing(s) went wrong:")
        for one in trouble:
            say(f"  {one}")
        return 1

    say("the page still answers after the sync light has spoken")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
