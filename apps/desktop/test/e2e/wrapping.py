"""A note hard wrapped in the file, exported: one paragraph, not the lines it was
typed on, and the break the writer asked for still a break.

Drives a real export out of the built app and reads the file that comes back.

Run it from the repository root:

    python apps/desktop/test/e2e/wrapping.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for
SHOTS = DRIVE.shots


NOTE = (
    "# Wrapping\n\n"
    "A paragraph that was hard wrapped in the file\n"
    "across three lines\n"
    "by whoever wrote it.\n\n"
    "A line that asks for a break  \nand the line under it.\n"
)

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const wrapped = ws.notes.find((one) => one.name.startsWith('Wrapping'))
  await ws.openEntry(wrapped.path, { activate: true })
  return wrapped.name
}
"""


def drive(browser: Browser) -> None:
    context = browser.new_context(
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
        accept_downloads=True,
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    DRIVE.open(page)
    # A first visit in a browser is given a welcome note, and the app opens it
    # after the space is there rather than with it; see `restore` in
    # workspace.svelte.ts. Seeding before that has happened wins the tab for a
    # moment and then loses it again, and the export below would be an export of
    # the welcome note. So the app is let finish opening its own note first.
    wait_for(page, "window.nibApp.workspace.active", "the app to open its own note")
    say(f"the space holds {page.evaluate(SEED, NOTE)}")
    # And the note this is about is the one showing, which is the condition the
    # export needs rather than a length of time.
    wait_for(
        page,
        "window.nib && document.querySelector('.cm-content')"
        " && window.nibApp.workspace.active?.note?.name?.startsWith('Wrapping')",
        "the wrapped note to be the one open",
    )
    shot(page, "01-written")

    # The palette, which is how an export is reached without a menu bar.
    page.keyboard.press("Control+p")
    page.wait_for_timeout(400)
    page.keyboard.type("> Plain text")
    page.wait_for_timeout(700)
    shot(page, "02-palette")

    with page.expect_download(timeout=20000) as caught:
        page.keyboard.press("Enter")
    download = caught.value

    SHOTS.mkdir(parents=True, exist_ok=True)
    where = SHOTS / "exported.txt"
    download.save_as(str(where))
    text = where.read_text(encoding="utf8")
    say(f"[exported] {json.dumps(text)}")

    if "A paragraph that was hard wrapped in the file across three lines by whoever wrote it." not in text:
        wrong("the wrapped paragraph did not come out as one paragraph")
    if "A line that asks for a break\nand the line under it." not in text:
        wrong("the break the writer asked for was flowed away with the rest")

    context.close()


def main() -> int:
    return DRIVE.run(drive, "a wrapped paragraph exports as a paragraph")


if __name__ == "__main__":
    raise SystemExit(main())
