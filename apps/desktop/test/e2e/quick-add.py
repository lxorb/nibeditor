"""Quick add from the palette into the Inbox, and a chip pressed back into words.

docs/tasks.md 5.6. The palette's Add task row turns into the quick add field. Typed
words become chips as they are recognised - a day, a tag, a priority - and the row of
controls under the field says what was understood. A chip pressed is words again
(Todoist's undo of a misread), and stays words. Enter writes the task into the space's
Inbox, made the first time, and keeps the field up for the next one; Escape puts it
away. The Inbox then shows each task as its words and a row of chips, the fields hidden
the way marks are (5.7).

    python apps/desktop/test/e2e/quick-add.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/quick-add/`.
"""

from __future__ import annotations

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, wait_for, shot = DRIVE.say, DRIVE.wrong, DRIVE.wait_for, DRIVE.shot

FIELD = ".sheet .quick input.field"
CHIPS = "() => [...document.querySelectorAll('.sheet .quick [data-chip]')].map((one) => one.textContent)"


def chips(page: Page) -> list[str]:
    return page.evaluate(CHIPS)  # type: ignore[no-any-return]


def typed(page: Page, words: str) -> None:
    page.locator(FIELD).fill("")
    page.keyboard.type(words, delay=15)
    page.wait_for_timeout(150)


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n")
    DRIVE.open_note(page, "Plan")

    # The palette, and its Add task row.
    page.keyboard.press("Control+o")
    wait_for(page, "!!document.querySelector('.palette input')", "the palette")
    page.keyboard.type("add task", delay=15)
    wait_for(
        page,
        "[...document.querySelectorAll('.palette .nib-row')].some((one) => one.textContent.includes('Add task'))",
        "the Add task row",
    )
    page.keyboard.press("Enter")
    wait_for(page, f"!!document.querySelector('{FIELD}')", "the quick add field")
    if page.evaluate("() => document.activeElement?.matches('.quick input.field')") is not True:
        wrong("the quick add field did not take the keyboard")

    # Words become chips as they are typed.
    typed(page, "Call mum tomorrow #family p1")
    said = chips(page)
    say(f"chips: {said}")
    if said != ["tomorrow", "#family", "p1"]:
        wrong(f"the chips are {said}, not tomorrow, #family and p1")
    shot(page, "01-chips")

    # A chip pressed is words again, and the date control forgets the date.
    box = page.locator(".sheet .quick [data-chip='when']").bounding_box()
    if box is None:
        wrong("the day's chip is not on screen")
    else:
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(150)
        said = chips(page)
        say(f"after the press: {said}")
        if "tomorrow" in said:
            wrong("the pressed chip is still a chip")
        if page.locator(".sheet .quick .controls .control.set").count() == 0:
            wrong("the priority control does not show p1")
    shot(page, "02-words-again")

    page.keyboard.press("End")
    page.keyboard.press("Enter")
    wait_for(page, f"document.querySelector('{FIELD}')?.value === ''", "the field empty again")

    # The field stays up for the next one.
    typed(page, "Pay rent friday p2")
    page.keyboard.press("Enter")
    wait_for(page, f"document.querySelector('{FIELD}')?.value === ''", "the second task added")
    page.keyboard.press("Escape")
    wait_for(page, f"!document.querySelector('{FIELD}')", "quick add put away")

    # The Inbox holds both, as the Tasks plugin writes them.
    page.evaluate("() => window.nibApp.workspace.loadTree()")
    DRIVE.open_note(page, "Inbox")
    text = page.evaluate("() => window.nib.state.doc.toString()")
    say(f"Inbox: {text!r}")
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines or lines[0] != "- [ ] Call mum tomorrow #family 🔺":
        wrong(f"the first task is {lines[:1]}, not the words kept and the priority written")
    if len(lines) < 2 or not lines[1].startswith("- [ ] Pay rent ⏫ 📅 "):
        wrong(f"the second task is {lines[1:2]}, not Pay rent with its day and priority")

    # And a task's fields are chips in the note, with the caret elsewhere.
    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: 0 } }); view.focus() }"
    )
    # The caret is on the first, which shows its source; the second wears its chips.
    wait_for(page, "document.querySelectorAll('.nib-task-chips').length === 1", "the chips in the note")
    drawn = page.evaluate("() => document.querySelector('.nib-task-chips').textContent")
    words = page.evaluate("() => document.querySelectorAll('.cm-line')[1].textContent")
    say(f"the second task reads {words!r}")
    if not drawn.endswith("⏫") or "📅" in words:
        wrong(f"the second task's fields are not hidden behind its chips: {words!r}")
    shot(page, "03-inbox")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "quick add wrote two tasks into the Inbox"))
