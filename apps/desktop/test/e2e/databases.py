"""A base doing the work of a database, in the built app (docs/tasks.md 4, 5.12, 5.13).

What this drives, against the real rows store, the real files and the real runner:

  * A rollup counts: a projects base shows, on each project, how many task notes link
    to it through their `project` property (a reverse relation, counted).
  * A button sets a property: pressing Done on a row writes `status: Done` into the
    note, and the base's automation (status becomes Done -> finished is today) writes
    its date beside it, once.
  * One Ctrl+Z takes the press and what the automation wrote back together.
  * A form makes a note: a name and a status typed into the form's fields and sent
    make a note in the base's folder with that status, and the form empties itself.
  * The table wears the base's colour, row height and frozen column.

Run it from the repository root:

    python apps/desktop/test/e2e/databases.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/databases/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for


def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)


THESIS = "---\nstatus: Doing\n---\n# Thesis\n"
GARDEN = "---\nstatus: To do\n---\n# Garden\n"
INTRO = '---\nproject: "[[Thesis]]"\nhours: 3\n---\n# Intro\n'
DATA = '---\nproject: "[[Thesis]]"\nhours: 5\n---\n# Data\n'
BEDS = '---\nproject: "[[Garden]]"\nhours: 2\n---\n# Beds\n'

BASE = """filters: 'file.inFolder("Projects")'
formulas:
  Tasks: 'file.backlinks.filter(list(value.asFile().properties.project).contains(file))'
  Tasks_count: list(formula.Tasks).length
nib:
  properties:
    status:
      options:
        - { value: To do, tone: '1' }
        - { value: Doing, tone: '5' }
        - { value: Done, tone: '4' }
  buttons:
    Done:
      set: { status: Done }
  automations:
    - when: { property: status, is: Done }
      set: { finished: "{{date}}" }
views:
  - type: table
    name: All
    order: [file.name, note.status, formula.Tasks_count, button.Done]
    nib:
      lines: 2
      freeze: 1
      colour: 'if(status == "Done", "4", null)'
  - type: form
    name: New
    order: [file.name, note.status]
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

ROW = "(path) => window.tasks.rows.of().find((one) => one.path === path)"


def note(page: Page, path: str) -> dict[str, object]:
    return page.evaluate(f"({ROW})({json.dumps(path)})?.note ?? null")  # type: ignore[no-any-return]


def seed(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    files = [
        ["Projects/Thesis.md", THESIS],
        ["Projects/Garden.md", GARDEN],
        ["Tasks/Intro.md", INTRO],
        ["Tasks/Data.md", DATA],
        ["Tasks/Beds.md", BEDS],
        ["Projects.base", BASE],
    ]
    page.evaluate(WRITE, [files])
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.path === 'Tasks/Beds.md')",
        "the seeded rows",
    )


def open_view(page: Page, view: str) -> None:
    page.evaluate(
        """async (view) => {
          const ws = window.nibApp.workspace
          for (const tab of ws.tabs.filter((one) => one.kind === 'view' && one.path)) await ws.closeAsking(tab.id)
          const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
          window.tasks.openBaseFile(`${root}/Projects.base`, {}, view)
        }""",
        view,
    )
    wait_for(
        page,
        f"document.querySelector('.view-tab .head .name')?.textContent.trim() === {json.dumps(view)}",
        f"the {view} view of Projects.base",
    )
    quiet(page)


def cell(page: Page, row: str, column: int) -> str:
    return page.evaluate(  # type: ignore[no-any-return]
        """([row, column]) => {
          const line = [...document.querySelectorAll('.view-tab .line')].find((one) => one.textContent.includes(row))
          return line?.querySelectorAll('.cell')[column]?.textContent.trim() ?? null
        }""",
        [row, column],
    )


def the_rollup(page: Page) -> None:
    open_view(page, "All")
    if not DRIVE.waited(
        page,
        "() => [...document.querySelectorAll('.view-tab .line')].some((one) => one.textContent.includes('Thesis'))",
        "the projects in the table",
    ):
        return
    thesis, garden = cell(page, "Thesis", 2), cell(page, "Garden", 2)
    say(f"[rollup] Thesis {thesis}, Garden {garden}")
    if thesis != "2" or garden != "1":
        wrong(f"the rollup counts {thesis} and {garden} tasks, not 2 and 1")
    if not page.evaluate("!!document.querySelector('.view-tab .table.wraps .head.stuck')"):
        wrong("the table is not two lines tall with its first column frozen")
    shot(page, "01-rollup")


def the_button(page: Page) -> None:
    page.locator(".view-tab .line:has-text('Thesis') .press").click()
    if not DRIVE.waited(
        page,
        "() => window.tasks.rows.of().find((one) => one.path === 'Projects/Thesis.md')?.note.status === 'Done'",
        "the button to write status: Done",
    ):
        return
    if not DRIVE.waited(
        page,
        "() => !!window.tasks.rows.of().find((one) => one.path === 'Projects/Thesis.md')?.note.finished",
        "the automation to write the day it was finished",
    ):
        return
    say(f"[button] {json.dumps(note(page, 'Projects/Thesis.md'), ensure_ascii=False)}")
    if not page.evaluate("!!document.querySelector('.view-tab .line.toned')"):
        wrong("the row that is Done is not in its conditional colour")
    shot(page, "02-button")

    # One undo for the press and what it set off.
    page.locator(".view-tab .line:has-text('Garden') .cell").first.click()
    page.keyboard.press("Control+z")
    if DRIVE.waited(
        page,
        "() => window.tasks.rows.of().find((one) => one.path === 'Projects/Thesis.md')?.note.status === 'Doing'",
        "one Ctrl+Z to take the press back",
    ):
        after = note(page, "Projects/Thesis.md") or {}
        if "finished" in after:
            wrong("the automation's write stayed after the undo: it was not one undo with the press")
        say(f"[undo] {json.dumps(after, ensure_ascii=False)}")


def menu_row(page: Page, label: str) -> None:
    page.locator(f".menu [role=menuitem]:has-text({json.dumps(label)})").first.click()


def the_builders(page: Page) -> None:
    """The layers lane 7 adds over a view, each opened from where a reader finds it,
    and a locked view turning a change away."""
    open_view(page, "All")
    page.locator(".view-tab .heads .head:has-text('status')").first.click(button="right")
    menu_row(page, "Options")
    wait_for(page, "document.querySelectorAll('.view-tab .pop .tone').length === 3", "the status options")
    shot(page, "05-options")
    page.keyboard.press("Escape")

    for label, name in [("Automations", "06-automations"), ("Colour", "07-colour")]:
        page.locator(".view-tab .head .name").first.click()
        menu_row(page, label)
        wait_for(page, "document.querySelector('.view-tab .pop')", f"the {label} layer")
        shot(page, name)
        page.keyboard.press("Escape")
        wait_for(page, "!document.querySelector('.view-tab .pop')", f"the {label} layer shut")

    page.locator(".view-tab .heads .head:has-text('Tasks_count')").first.click(button="right")
    menu_row(page, "Add a column")
    wait_for(page, "document.querySelector('[role=menu].menu')?.getAttribute('aria-label') === 'Add a column'", "the columns to add")
    quiet(page)
    menu_row(page, "Rollup")
    wait_for(page, "document.querySelector('.view-tab .pop .rows')", "the rollup picker")
    shot(page, "08-rollup-picker")
    page.keyboard.press("Escape")

    page.locator(".view-tab .head .name").first.click()
    menu_row(page, "Lock view")
    wait_for(page, "document.querySelector('.view-tab .lock')", "the padlock of a locked view")
    page.locator(".view-tab .heads .head:has-text('status') .name").first.click()
    wait_for(page, "document.querySelector('.view-tab .lock.shake')", "the padlock answering a change")
    if page.evaluate("!!document.querySelector('.view-tab .head .arrow')"):
        wrong("a locked view was sorted")
    shot(page, "09-locked")
    page.locator(".view-tab .lock").click()
    wait_for(page, "!document.querySelector('.view-tab .lock')", "the view unlocked")


def the_form(page: Page) -> None:
    open_view(page, "New")
    wait_for(page, "document.querySelector('.view-tab form.form')", "the form")
    page.locator(".view-tab form.form .title").fill("Orchard")
    page.locator(".view-tab form.form .field").first.locator("button").click()
    page.locator("[role=listbox] [role=option]:has-text('Doing')").first.click()
    wait_for(page, "!document.querySelector('[role=listbox]')", "the choice made and its list shut")
    shot(page, "10-form-filled")
    page.locator(".view-tab form.form button[type=submit]").click()
    if not DRIVE.waited(
        page,
        "() => window.tasks.rows.of().find((one) => one.path === 'Projects/Orchard.md')?.note.status === 'Doing'",
        "the form to make Projects/Orchard.md with status: Doing",
    ):
        return
    DRIVE.waited(page, "document.querySelector('.view-tab form.form .title')?.value === ''", "the form to empty itself after sending")
    shot(page, "11-form-sent")


def drive(browser) -> None:  # type: ignore[no-untyped-def]
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    seed(page)
    the_rollup(page)
    the_button(page)
    the_builders(page)
    the_form(page)
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "a rollup counted, a button set a property, a form made a note"))
