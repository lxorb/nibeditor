"""The scratchpad as a switch and a card, never a tab, seen in light and dark.

Emil, 2026-10-05: "The scratchpad should never open as a tab. It should be basically a
thing in the top right that you can click, and then it is selected or it isn't." So the
glyph at the bar's top right shows a card docked under it, Escape and the glyph put it
away and give the keyboard back to the note, Ctrl+Shift+X calls it, a reload keeps it
up with its words, and nothing of it is ever in the tab strip. A phone's drawer shape
lays it over the note.

    python apps/desktop/test/e2e/scratchpad.py

Screenshots go beside this file under `shots/scratchpad/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PLAN = "# Plan\n\nWhat we are doing this week, and why it matters.\n"

GLYPH = "header button.pad"
CARD = "[data-scratchpad] .cm-content"

# A phone says so in its user agent, and only then is the layout a phone's: with the
# headless desktop agent, a narrow touch window is still a desktop with a strip of tabs.
# See `deviceFor` in viewport.svelte.ts.
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

# What is drawn in the middle of the card, so a card under something else is caught.
ON_TOP = """() => {
  const card = document.querySelector('[data-scratchpad]')?.getBoundingClientRect()
  if (!card || !card.width || !card.height) return false
  const at = document.elementFromPoint(card.x + card.width / 2, card.y + card.height / 2)
  return !!at?.closest('[data-scratchpad]')
}"""

STATE = """() => ({
  pressed: document.querySelector('header button.pad')?.getAttribute('aria-pressed'),
  card: !!document.querySelector('[data-scratchpad] .cm-content'),
  inCard: !!document.activeElement?.closest('[data-scratchpad]'),
  inNote: !!document.activeElement?.closest('[data-panes]'),
  tabs: window.nibApp.workspace.tabs.map((one) => one.name),
  words: document.querySelector('[data-scratchpad] .cm-content')?.textContent ?? null,
})"""


def opened(browser: Browser, scheme: str, phone: bool = False) -> Page:
    page = DRIVE.page(
        browser,
        viewport={"width": 420, "height": 880} if phone else {"width": 1280, "height": 800},
        color_scheme=scheme,
        has_touch=phone,
        is_mobile=phone,
        **({"user_agent": PHONE_AGENT} if phone else {}),
    )
    DRIVE.open(page)
    DRIVE.seed(page, PLAN)
    DRIVE.open_note(page, "Plan")
    return page


def no_tab(page: Page, where: str) -> None:
    tabs = page.evaluate(STATE)["tabs"]
    if any("Scratchpad" in one for one in tabs):
        wrong(f"[{where}] the scratchpad is in the tab strip: {tabs}")


def desktop(browser: Browser, scheme: str) -> None:
    page = opened(browser, scheme)
    shot(page, f"{scheme}/01-the-switch")
    if page.evaluate(STATE)["pressed"] != "false":
        wrong(f"[{scheme}] the switch reads as pressed before it is")

    page.locator(".cm-content").first.click()
    page.locator(GLYPH).click()
    wait_for(page, f"document.querySelector('{CARD}')", "the card")
    page.wait_for_timeout(350)
    state = page.evaluate(STATE)
    say(f"[{scheme}] shown: {state}")
    if state["pressed"] != "true" or not state["inCard"]:
        wrong(f"[{scheme}] the card did not come up with the keyboard in it: {state}")
    no_tab(page, scheme)

    page.keyboard.type("A thought before it has a home")
    page.wait_for_timeout(200)
    shot(page, f"{scheme}/02-the-card")

    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    state = page.evaluate(STATE)
    say(f"[{scheme}] after Escape: {state}")
    if state["card"] or state["pressed"] != "false" or not state["inNote"]:
        wrong(f"[{scheme}] Escape left the card up or the keyboard nowhere: {state}")
    shot(page, f"{scheme}/03-escape")

    page.keyboard.press("Control+Shift+X")
    wait_for(page, f"document.querySelector('{CARD}')", "the card from the key")
    page.wait_for_timeout(350)
    state = page.evaluate(STATE)
    if "A thought before it has a home" not in (state["words"] or ""):
        wrong(f"[{scheme}] the words did not come back with the card: {state}")
    if not state["inCard"]:
        wrong(f"[{scheme}] the key did not put the keyboard in the card")

    # A reload keeps the card up and its words, and puts no tab back.
    page.wait_for_timeout(1200)
    page.reload()
    DRIVE.ready(page)
    wait_for(page, f"document.querySelector('{CARD}')", "the card after a reload")
    page.wait_for_timeout(400)
    state = page.evaluate(STATE)
    say(f"[{scheme}] after a reload: {state}")
    if "A thought before it has a home" not in (state["words"] or ""):
        wrong(f"[{scheme}] the words were lost over a reload")
    no_tab(page, f"{scheme} reload")
    shot(page, f"{scheme}/04-after-a-reload")

    page.locator(GLYPH).click()
    page.wait_for_timeout(400)
    if page.evaluate(STATE)["card"]:
        wrong(f"[{scheme}] the switch did not put the card away")
    page.context.close()


def phone(browser: Browser) -> None:
    page = opened(browser, "light", phone=True)
    if page.evaluate("document.documentElement.dataset.device") != "phone":
        wrong("[phone] the page is not laid out as a phone")
    page.locator(GLYPH).tap()
    wait_for(page, f"document.querySelector('{CARD}')", "the card on a phone")
    page.wait_for_timeout(400)
    if not page.evaluate(ON_TOP):
        wrong("[phone] the card is up but something else is drawn over it")
    no_tab(page, "phone")
    shot(page, "light/05-a-phone")
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            desktop(browser, scheme)
        say("--- a phone ---")
        phone(browser)
    return DRIVE.verdict("the scratchpad is a switch and a card, never a tab")


if __name__ == "__main__":
    raise SystemExit(main())
