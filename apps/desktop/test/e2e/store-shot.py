"""The one screenshot the app stores show, taken from the real editor.

Flathub, and every catalogue that reads an AppStream file, fetches the image the
metainfo points at on every build, so it has to be a file in this repository
rather than a link to an upload that expires. This writes it: the built web app
in a browser at the size Flathub asks for, in the light theme, a space with a
few notes in it, and one note open with everything the editor formats as it is
typed.

Run it from the repository root:

    python apps/desktop/test/e2e/store-shot.py

Unlike everything else beside it, what this writes is meant to outlive the run:
it goes to docs/media/screenshot.png, which is committed and which
packaging/flathub/ch.emilvinu.nib.metainfo.xml points at by commit.
"""

from __future__ import annotations

import sys

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
ORIGIN = DRIVE.origin
APP = harness.APP
ROOT = harness.ROOT

SHOT = ROOT / "docs" / "media" / "screenshot.png"


# What a catalogue shows. Flathub asks for a window of 1000x700 or smaller so
# that the text is still legible in a card, or twice that for a sharp one, which
# is what the doubled scale below makes: a 2000x1400 image of a 1000x700 window.
SIZE = {"width": 1000, "height": 700}
SCALE = 2

# The note in the window. Everything in it is something the editor gives its
# final shape while it is being typed, which is the whole point of the picture.
NOTE = """# Kestrel notes

A **markdown editor** that formats what you write *as you write it*.

## What went in this week

- [x] Pressure on the pen, so a stroke thins where the hand lifts
- [ ] Slides straight out of a note

| Platform | Sync | Publish |
| --- | :-: | :-: |
| Desktop | yes | yes |

The area of a circle is $A = \\pi r^2$, set as it is typed.

```python
def kestrel(wind):
    return sum(w ** 2 for w in wind) / len(wind)
```
"""

# The notes around it, so the file list is a file list rather than one row.
SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  await ws.noteFrom('# Reading list\\n\\nwhat is next\\n', root)
  await ws.noteFrom('# Chapter one\\n\\nthe opening\\n', at('Book'))
  await ws.noteFrom('# Standup\\n\\nwho said what\\n', root)
  const open = await ws.noteFrom(note, root)
  await ws.rename(open, 'Kestrel notes.md')

  if (ws.panel !== 'tree') ws.showPanel('tree')
  await ws.openEntry(at('Kestrel notes.md'), { activate: true })
  return ws.tree.children.map((one) => one.name)
}
"""


def shoot(browser: Browser) -> None:
    context = browser.new_context(
        viewport=SIZE, device_scale_factor=SCALE, color_scheme="light"
    )
    page: Page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))
    DRIVE.open(page)
    say(f"the space holds {page.evaluate(SEED, NOTE)}")

    # The table and the formula are set by the editor itself, so the shot waits
    # for them rather than for a length of time.
    page.wait_for_function(
        "() => document.querySelector('.cm-editor table') && document.querySelector('.cm-editor .katex')",
        timeout=40000,
    )
    # Past the transitions: a ticked task strikes itself through over a moment,
    # and half a line drawn is what a shot taken too early photographs.
    page.wait_for_timeout(2500)

    SHOT.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT))
    say(f"wrote {SHOT.relative_to(ROOT)}")
    context.close()


def main() -> int:
    return DRIVE.run(shoot)


if __name__ == "__main__":
    sys.exit(main())
