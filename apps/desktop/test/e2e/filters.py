"""Todoist's filters and labels in the Tasks panel, in the built app.

What this drives, against the real rows store and the real files:

  * The panel's Filters has a plus: a name and a Todoist query, the count of what it
    finds as it is typed, the field marked where the grammar cannot read it, and Save
    writes `Filters/<name>.base` and opens it with what it finds.
  * The filter is listed with its count; its menu edits it as it was typed.
  * A label's menu renames it in every note.
  * Completed is in the panel, Todoist's name for it.

    python apps/desktop/test/e2e/filters.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Shots go under `shots/filters/`.
"""

from __future__ import annotations

from playwright.sync_api import Page, Browser

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for


def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)


DAYS = """() => {
  const day = (n) => {
    const at = new Date()
    at.setDate(at.getDate() + n)
    const two = (v) => String(v).padStart(2, '0')
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  }
  return { today: day(0), yesterday: day(-1) }
}"""

ERRANDS = """# Errands

- [ ] Call the bank #admin 🔺 📅 {yesterday}
- [ ] Pay rent #admin 🔺 📅 {today}
- [ ] Water the plants 📅 {today}
- [ ] Read a book
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

READ = """async (name) => {
  const ws = window.nibApp.workspace
  const found = ws.files.find((one) => one.name === name)
  return found ? await ws.noteText(found.path) : null
}"""

SHEET = "[role=dialog][aria-label]"


def seed(page: Page) -> None:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    page.evaluate("async () => { window.tasks = await window.nibApp.tasks() }")
    days = page.evaluate(DAYS)
    page.evaluate(WRITE, [[["Errands.md", ERRANDS.format(**days)]]])
    wait_for(
        page,
        "() => window.tasks.rows.of().some((one) => one.task?.text === 'Read a book')",
        "the seeded rows",
    )
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .nib-row')", "the panel")
    quiet(page)


def add_filter(page: Page) -> None:
    rows = page.locator(".tasks .nib-row").all_inner_texts()
    if not any("Completed" in one for one in rows):
        wrong("the panel has no Completed")
    page.locator(".tasks .plus[aria-label='Add filter']").click()
    wait_for(page, f"document.querySelector('{SHEET} input')", "the filter's sheet")
    page.keyboard.type("Urgent", delay=10)
    page.locator(f"{SHEET} input.query").click()
    page.keyboard.type("p1 & (", delay=10)
    wait_for(page, f"document.querySelector('{SHEET} input.query')?.getAttribute('aria-invalid') === 'true'", "the query marked")
    if page.locator(f"{SHEET} button[type=submit]").is_enabled():
        wrong("a query that cannot be read can be saved")
    for _ in range(4):
        page.keyboard.press("Backspace")
    wait_for(page, f"document.querySelector('{SHEET} .count')?.textContent.trim() === '2'", "two found")
    shot(page, "01-sheet")
    page.keyboard.press("Enter")
    wait_for(page, f"async () => (await ({READ})('Urgent.base'))?.includes('todoist')", "the filter written")
    wait_for(
        page,
        "() => { const words = [...document.querySelectorAll('.view-tab .task .words')].map((one) => one.textContent.trim()); return words.length === 2 && words.includes('Pay rent') }",
        "the filter opened with what it finds",
    )
    wait_for(
        page,
        "() => [...document.querySelectorAll('.tasks .nib-row')].some((one) => one.textContent.includes('Urgent') && one.textContent.includes('2'))",
        "the filter in the panel with its count",
    )
    shot(page, "02-opened")


def edit_filter(page: Page) -> None:
    page.locator(".tasks .nib-row", has_text="Urgent").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Edit filter").click()
    wait_for(page, f"document.querySelector('{SHEET} input.query')?.value === 'p1'", "the query as it was typed")
    page.locator(f"{SHEET} input.query").fill("p1 & today")
    wait_for(page, f"document.querySelector('{SHEET} .count')?.textContent.trim() === '1'", "one found")
    page.locator(f"{SHEET} button[type=submit]").click()
    wait_for(page, f"async () => (await ({READ})('Urgent.base'))?.includes('p1 & today')", "the filter changed")


def labels(page: Page) -> None:
    page.locator(".tasks .nib-row", has_text="admin").click(button="right")
    page.locator(".menu [role=menuitem]", has_text="Rename").click()
    # The Rename dialog's own field: the filter's sheet from the step before may still
    # be on its way out, with its two fields, in a page that is not drawing frames.
    field = page.get_by_role("dialog", name="Rename").locator("input")
    field.wait_for()
    field.fill("office")
    page.keyboard.press("Enter")
    wait_for(
        page,
        "() => window.tasks.rows.of().filter((one) => one.task?.tags.includes('office')).length === 2",
        "the label renamed in the note",
    )
    shot(page, "03-label")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    seed(page)
    add_filter(page)
    edit_filter(page)
    labels(page)
    page.close()


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the filters and the labels held"))
