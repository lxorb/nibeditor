"""The Tasks panel and the views over the rows, in the built app (docs/tasks.md 5.5, 5.9).

What this drives, against the real rows store and the real files:

  * The Tasks panel lists Inbox, Today and Upcoming with their counts, the projects
    and the labels; Today's count is in the danger tone while something is overdue.
  * Today holds what is overdue and what is due today and nothing later; Upcoming
    holds what is later and nothing of today.
  * A card carried to another column of a base's board writes the property the
    board is grouped by into the note.
  * A row carried to another day of the calendar writes its date.
  * A table cell edited writes the note, and Ctrl+Z in the view takes it back.
  * A ` ```base ` fence and an `![[Bugs.base#Board]]` embed are drawn as views inside
    the note.
  * The same at phone width: the list, the board and the calendar as an agenda.
  * A board of two thousand cards scrolled, measured: the frames it took and how many
    cards were ever mounted at once.

Run it from the repository root:

    python apps/desktop/test/e2e/tasks.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/tasks/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.wait_for


def shot(page: Page, name: str) -> None:
    quiet(page)
    DRIVE.shot(page, name)


# Every date is worked out in the page, on its own calendar: the views count days on
# the reader's wall clock, and so does this.
DAYS = """() => {
  const day = (n) => {
    const at = new Date()
    at.setDate(at.getDate() + n)
    const two = (v) => String(v).padStart(2, '0')
    return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
  }
  return { today: day(0), yesterday: day(-1), lastweek: day(-6), soon: day(2), later: day(5) }
}"""

ERRANDS = """# Errands

## Errands
- [ ] Call the bank [time:: 16:00] #admin ⏫ 📅 {yesterday}
  - [ ] Find the old card
- [ ] Water the plants 🔁 every 3 days when done 📅 {today}
## Shop
- [ ] Milk #shop 📅 {later}
- [x] Bread ✅ {yesterday}
"""

THESIS = """# Thesis

- [/] Draft the talk [duration:: 2h] ⏳ {soon}
- [ ] Renew passport 🔺 📅 {lastweek}
"""

SYNC = "---\nstatus: Doing\ndue: {soon}\npoints: 3\n---\n# Sync loses a rename\n"
GLASS = "---\nstatus: To do\ndue: {later}\npoints: 5\n---\n# Glass on Linux\n"

BASE = """filters: 'file.inFolder("Bugs")'
nib:
  properties:
    status:
      options:
        - { value: To do, tone: neutral }
        - { value: Doing, tone: info }
        - { value: Done, tone: success }
views:
  - type: table
    name: All
    order: [file.name, note.status, note.due, note.points]
  - type: kanban
    name: Board
    groupBy: { property: note.status, direction: ASC }
  - type: calendar
    name: Due
    nib: { date: note.due }
"""

DASHBOARD = """# Dashboard

The bugs, as a list:

```base
filters: 'file.inFolder("Bugs")'
views:
  - type: list
    name: Open
```

And as a board:

![[Bugs.base#Board]]

Words after them.
"""

WRITE = """async ([files]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
  for (const [path, text] of files) await window.nibApp.tasks.writeFile(`${root}/${path}`, text)
  await ws.loadTree()
}"""

def seed(page: Page) -> dict[str, str]:
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    days: dict[str, str] = page.evaluate(DAYS)
    files = [
        ["Errands.md", ERRANDS.format(**days)],
        ["Thesis.md", THESIS.format(**days)],
        ["Bugs/Sync.md", SYNC.format(**days)],
        ["Bugs/Glass.md", GLASS.format(**days)],
        ["Bugs.base", BASE],
        ["Dashboard.md", DASHBOARD],
    ]
    page.evaluate(WRITE, [files])
    wait_for(
        page,
        "() => window.nibApp.tasks.rows.of().some((one) => one.task?.text === 'Draft the talk')",
        "the seeded rows",
    )
    return days


def texts(page: Page, selector: str) -> list[str]:
    return page.evaluate(  # type: ignore[no-any-return]
        "(selector) => [...document.querySelectorAll(selector)].map((one) => one.textContent.trim())",
        selector,
    )


def the_panel(page: Page) -> None:
    page.evaluate("window.nibApp.workspace.showPanel('tasks')")
    wait_for(page, "document.querySelector('.tasks .nib-row')", "the Tasks panel")
    quiet(page)
    rows = texts(page, ".tasks .nib-row")
    say(f"[panel] {json.dumps(rows, ensure_ascii=False)}")
    for wanted in ["Inbox", "Today", "Upcoming", "Bugs", "Errands", "Thesis", "admin"]:
        if not any(one.startswith(wanted) for one in rows):
            wrong(f"the panel has no {wanted} row")
    late = page.evaluate("!!document.querySelector('.tasks .nib-row-meta.late')")
    if not late:
        wrong("Today's count is not in the danger tone while something is overdue")
    shot(page, "01-panel")


def open_builtin(page: Page, name: str) -> None:
    page.evaluate(f"window.nibApp.tasks.openBuiltin('{name}')")
    wait_for(page, "document.querySelector('.view-tab .list, .view-tab .upcoming')", f"the {name} view")
    quiet(page)


def today_and_upcoming(page: Page) -> None:
    open_builtin(page, "today")
    words = texts(page, ".view-tab .line .words")
    say(f"[today] {json.dumps(words, ensure_ascii=False)}")
    for wanted in ["Call the bank", "Water the plants", "Renew passport"]:
        if wanted not in words:
            wrong(f"Today does not hold {wanted}")
    for unwanted in ["Milk", "Bread", "Draft the talk"]:
        if unwanted in words:
            wrong(f"Today holds {unwanted}, which is not due by today")
    shot(page, "02-today")

    open_builtin(page, "upcoming")
    words = texts(page, ".view-tab .line .words")
    say(f"[upcoming] {json.dumps(words, ensure_ascii=False)}")
    for wanted in ["Milk", "Draft the talk"]:
        if wanted not in words:
            wrong(f"Upcoming does not hold {wanted}")
    if "Water the plants" in words:
        wrong("Upcoming holds a task of today")
    shot(page, "03-upcoming")


def open_base(page: Page, view: str) -> None:
    page.evaluate(
        """async (view) => {
          const ws = window.nibApp.workspace
          for (const tab of ws.tabs.filter((one) => one.kind === 'view' && one.path)) await ws.closeAsking(tab.id)
          const root = ws.activeSpace.root.replace(/[\\\\/]+$/, '')
          window.nibApp.tasks.openBaseFile(`${root}/Bugs.base`, {}, view)
        }""",
        view,
    )
    wait_for(
        page,
        f"document.querySelector('.view-tab .head .name')?.textContent.trim() === {json.dumps(view)}",
        f"the {view} view of Bugs.base",
    )
    quiet(page)


def carry(page: Page, source: str, target: str, steps: int = 12) -> None:
    """The pointer down on one thing, moved across in steps, and let go on another."""
    one = page.locator(source).first.bounding_box()
    two = page.locator(target).first.bounding_box()
    if not one or not two:
        wrong(f"nothing to carry from {source} to {target}")
        return
    page.mouse.move(one["x"] + one["width"] / 2, one["y"] + one["height"] / 2)
    page.mouse.down()
    page.mouse.move(one["x"] + one["width"] / 2 + 8, one["y"] + one["height"] / 2 + 8, steps=3)
    page.mouse.move(two["x"] + two["width"] / 2, two["y"] + min(60, two["height"] / 2), steps=steps)
    page.mouse.up()


def the_board(page: Page) -> None:
    open_base(page, "Board")
    heads = texts(page, ".view-tab .column .head .name")
    say(f"[board] {heads}")
    if heads != ["To do", "Doing", "Done"]:
        wrong(f"the board's columns are {heads}, not the status options with the empty one kept")
    shot(page, "04-board")
    carry(page, ".view-tab .card:has-text('Sync')", ".view-tab .column:has(.name:text-is('Done'))")
    if not DRIVE.waited(
        page,
        "() => window.nibApp.tasks.rows.of().find((one) => one.path === 'Bugs/Sync.md')?.note.status === 'Done'",
        "the card dropped on Done to write status: Done",
    ):
        return
    shot(page, "05-board-dropped")


def the_calendar(page: Page, days: dict[str, str]) -> None:
    open_base(page, "Due")
    target = days["today"]
    day = int(target[8:])
    carry(
        page,
        ".view-tab .event:has-text('Glass')",
        f".view-tab .day:not(.other):has(.number:text-is('{day}'))",
    )
    DRIVE.waited(
        page,
        f"() => window.nibApp.tasks.rows.of().find((one) => one.path === 'Bugs/Glass.md')?.note.due?.iso === {json.dumps(target)}",
        "the event dropped on a day to write that due date",
    )
    shot(page, "06-calendar")


def the_table(page: Page) -> None:
    open_base(page, "All")
    cell = ".view-tab .line:has-text('Glass') .cell:nth-child(2)"
    page.locator(cell).dblclick()
    wait_for(page, "document.querySelector('.view-tab .cell.on select')", "the status cell's menu")
    page.select_option(".view-tab .cell.on select", "Done")
    if not DRIVE.waited(
        page,
        "() => window.nibApp.tasks.rows.of().find((one) => one.path === 'Bugs/Glass.md')?.note.status === 'Done'",
        "the cell to write status: Done",
    ):
        return
    shot(page, "07-table-edited")
    page.locator(".view-tab .line:has-text('Glass') .cell:nth-child(1)").click()
    page.keyboard.press("Control+z")
    DRIVE.waited(
        page,
        "() => window.nibApp.tasks.rows.of().find((one) => one.path === 'Bugs/Glass.md')?.note.status === 'To do'",
        "Ctrl+Z to take the cell back",
    )


def the_note(page: Page) -> None:
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('Dashboard'))
          await ws.openEntry(note.path, { activate: true })
        }"""
    )
    if not DRIVE.waited(
        page,
        "document.querySelectorAll('.cm-content .nib-base-block .frame').length === 2",
        "the fence and the embed drawn as views in the note",
    ):
        return
    quiet(page)
    inside = texts(page, ".cm-content .nib-base-block .line .words, .cm-content .nib-base-block .card .words")
    say(f"[note] {json.dumps(inside, ensure_ascii=False)}")
    if not any("Glass" in one for one in inside):
        wrong("the base in the note shows no rows")
    shot(page, "08-note")


def the_big_board(browser: Browser) -> None:
    """Two thousand cards in one column, scrolled for a second: the frames it took and
    the most cards that were ever in the page at once."""
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    wait_for(page, "window.nibApp.tasks", "the views on the handle")
    lines = "\n".join(f"- [ ] Card number {at} #big" for at in range(2000))
    page.evaluate(WRITE, [[["Big.md", f"# Big\n\n{lines}\n"]]])
    wait_for(
        page,
        "() => window.nibApp.tasks.rows.of().filter((one) => one.task?.tags.includes('big')).length === 2000",
        "two thousand rows",
    )
    page.evaluate(
        """() => window.nibApp.tasks.openProject(window.nibApp.workspace.activeSpace.name, 'Big.md', 'kanban')"""
    )
    wait_for(page, "document.querySelector('.view-tab .card')", "the big board")
    quiet(page)
    measured = page.evaluate(
        """() => new Promise((done) => {
          const box = document.querySelector('.view-tab .column .scroll')
          const frames = []
          let most = 0
          let last = performance.now()
          const start = last
          const step = (now) => {
            frames.push(now - last)
            last = now
            box.scrollTop += 120
            most = Math.max(most, document.querySelectorAll('.view-tab .card').length)
            if (now - start < 1500 && box.scrollTop + box.clientHeight < box.scrollHeight) requestAnimationFrame(step)
            else {
              const sorted = [...frames].sort((a, b) => a - b)
              const mean = frames.reduce((a, b) => a + b, 0) / frames.length
              done({ frames: frames.length, mean, p95: sorted[Math.floor(sorted.length * 0.95)], most })
            }
          }
          requestAnimationFrame(step)
        })"""
    )
    say(
        f"[2,000 cards] {measured['frames']} frames, mean {measured['mean']:.1f} ms "
        f"({1000 / measured['mean']:.0f} fps), p95 {measured['p95']:.1f} ms, at most {measured['most']} cards mounted"
    )
    if measured["most"] > 80:
        wrong(f"the board mounted {measured['most']} cards at once rather than a window of them")
    if measured["p95"] > 50:
        wrong(f"scrolling the big board took {measured['p95']:.0f} ms frames at the 95th percentile")
    shot(page, "09-big-board")
    page.close()


# A phone says it is one in its user agent and under a finger; the width alone is a
# narrow desktop window (deviceFor in viewport.svelte.ts).
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)


def at_phone_width(browser: Browser) -> None:
    page = DRIVE.page(
        browser,
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
    )
    DRIVE.open(page)
    seed(page)
    open_builtin(page, "today")
    words = texts(page, ".view-tab .line .words")
    if "Call the bank" not in words:
        wrong(f"Today at phone width holds {words}")
    shot(page, "10-phone-today")
    open_base(page, "Board")
    if not page.evaluate("document.querySelectorAll('.view-tab .column').length >= 3"):
        wrong("the board at phone width has no columns")
    shot(page, "11-phone-board")
    open_base(page, "Due")
    if not page.evaluate("!!document.querySelector('.view-tab .agenda')"):
        wrong("the calendar at phone width is not an agenda")
    if page.evaluate("!!document.querySelector('.view-tab .head [aria-label=Timeline]')"):
        wrong("the timeline is offered at phone width")
    shot(page, "12-phone-agenda")
    page.close()


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
    DRIVE.open(page)
    days = seed(page)
    the_panel(page)
    today_and_upcoming(page)
    the_board(page)
    the_calendar(page, days)
    the_table(page)
    the_note(page)
    page.close()
    at_phone_width(browser)
    the_big_board(browser)


if __name__ == "__main__":
    raise SystemExit(
        DRIVE.run(drive, "the panel, Today, Upcoming, a board, a calendar, a table and a base in a note all held")
    )
