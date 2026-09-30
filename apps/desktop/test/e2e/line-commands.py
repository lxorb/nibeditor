"""The editor's line and text commands, pressed in a real browser.

What only a browser can answer about them: that each key reaches its command
through the app's own keymap, that the palette rows run, that a paste event
carrying an address makes a link of the selected words and nothing else, and that
Alt+Enter in the find bar puts a cursor on every match.

  - an address pasted over selected words is `[words](address)`; in inline code it
    goes in as it stands;
  - Shift+Alt+Right grows the selection a step at a time, Shift+Alt+Left shrinks it;
  - Ctrl+Enter makes a task of a plain line, and ticks it on the next press;
  - Ctrl+Shift+Enter opens a line above, Ctrl+J joins the next line on;
  - Sort the lines, Upper case and Delete the line from the palette;
  - Alt+Enter in the find bar selects every match;
  - none of it reaches into front matter that is hidden.

Builds the web app, serves `dist` on an origin of its own, drives it, and stops
everything again. Run it from the repository root:

    python apps/desktop/test/e2e/line-commands.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run.
"""

from __future__ import annotations

import sys
import time

from playwright.sync_api import Page

import harness
from harness import Drive

DRIVE = Drive(__file__)
say = DRIVE.say
failures = DRIVE.failures
ORIGIN = DRIVE.origin
APP = harness.APP


PATIENCE = 40


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def check(fine: bool, what: str, got: object = None) -> None:
    if fine:
        say(f"ok   {what}")
    else:
        failures.append(what)
        say(f"WRONG {what}: {got!r}")


def wait_for(page: Page, script: str, what: str, arg: object = None):
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(50)
    raise SystemExit(f"gave up waiting for {what}")


#: A note of the drive's own, made the only tab and the active one, asked again
#: until the app's own sitting has been read back and left it so.
OPEN = """
async (text) => {
  const ws = window.nibApp.workspace
  const name = text.match(/^# (.*)$/m)?.[1] ?? ''
  let mine = ws.tabs.find((one) => (one.path ?? '').endsWith(name + '.md'))
  if (!mine) {
    const path = await ws.noteFrom(text, ws.activeSpace.root)
    await ws.openEntry(path, { activate: true })
    return false
  }
  if (ws.activeTabId !== mine.id) {
    ws.activeTabId = mine.id
    return false
  }
  for (const other of [...ws.tabs]) if (other.id !== mine.id) ws.close(other.id)
  if (ws.panel) ws.showPanel(null)
  return document.querySelectorAll('.cm-content').length === 1 && !!window.nib
}
"""

#: The note as the editor holds it, with `|` for the caret and `«»` round a
#: selection, and how many selections there are.
MARKED = """
() => {
  const view = window.nib
  const text = view.state.doc.toString()
  const { from, to } = view.state.selection.main
  const marked = from === to
    ? text.slice(0, from) + '|' + text.slice(from)
    : text.slice(0, from) + '«' + text.slice(from, to) + '»' + text.slice(to)
  return { marked, ranges: view.state.selection.ranges.length }
}
"""

#: Puts the selection at the offsets `[from, to]` and gives the editor the keyboard.
SELECT = """
([from, to]) => {
  const view = window.nib
  view.focus()
  view.dispatch({ selection: { anchor: from, head: to } })
}
"""

#: A paste event carrying text, as the browser raises one for Ctrl+V.
PASTE = """
(text) => {
  const data = new DataTransfer()
  data.setData('text/plain', text)
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
  // The editor the selection was made in, not the first one in the page: a tab keeps
  // its editor while another is in front, so the first `.cm-content` can be a note
  // nobody is looking at.
  window.nib.contentDOM.dispatchEvent(event)
}
"""


def marked(page: Page) -> str:
    return page.evaluate(MARKED)["marked"]


def open_note(page: Page, text: str) -> None:
    wait_for(page, OPEN, "the drive's note to be the one open", text)
    page.wait_for_timeout(150)


def select(page: Page, doc: str, words: str, caret_only: bool = False) -> None:
    at = doc.index(words)
    page.evaluate(SELECT, [at, at if caret_only else at + len(words)])


def palette(page: Page, label: str) -> None:
    page.keyboard.press("Control+Shift+p")
    page.wait_for_timeout(250)
    page.keyboard.type(label)
    page.wait_for_timeout(250)
    page.keyboard.press("Enter")
    page.wait_for_timeout(200)


def landed(page: Page, address: str) -> None:
    """Until the pasted address is in the note. What handles a paste is fetched the
    first time one arrives, so the frame after the event can still be the words as
    they were - and a drive that moved on then saw the address land in the next note."""
    wait_for(
        page,
        "(address) => window.nib.state.doc.toString().includes(address)",
        f"the pasted {address} to land",
        address,
    )


def pasting(page: Page) -> None:
    doc = "# Paste drive\n\nRead the docs first, and run `npm test` too.\n"
    open_note(page, doc)

    select(page, doc, "the docs")
    page.evaluate(PASTE, "https://example.com/docs")
    landed(page, "https://example.com/docs")
    check(
        "Read [the docs](https://example.com/docs)| first" in marked(page),
        "an address pasted over words links them",
        marked(page),
    )

    now = page.evaluate("() => window.nib.state.doc.toString()")
    select(page, now, "npm test")
    page.evaluate(PASTE, "https://example.com/npm")
    landed(page, "https://example.com/npm")
    check(
        "`https://example.com/npm|`" in marked(page),
        "in inline code the address goes in as it stands",
        marked(page),
    )


def growing(page: Page) -> None:
    doc = "# Grow drive\n\nSome **bold words** here.\n\nNext.\n"
    open_note(page, doc)
    select(page, doc, "old", caret_only=True)

    seen = []
    for _ in range(4):
        page.keyboard.press("Shift+Alt+ArrowRight")
        page.wait_for_timeout(60)
        text = marked(page)
        seen.append(text[text.index("«") + 1 : text.index("»")] if "«" in text else "")
    check(
        seen == ["bold", "bold words", "**bold words**", "Some **bold words** here."],
        "Shift+Alt+Right grows word, inside the marks, the marks, the paragraph",
        seen,
    )

    page.keyboard.press("Shift+Alt+ArrowLeft")
    page.wait_for_timeout(60)
    check("«**bold words**»" in marked(page), "Shift+Alt+Left shrinks a step", marked(page))


def tasks_and_lines(page: Page) -> None:
    doc = "# Lines drive\n\nmilk\ncheese\n  two\nfirst\nsecond\n"
    open_note(page, doc)

    select(page, doc, "milk", caret_only=True)
    page.keyboard.press("Control+Enter")
    page.wait_for_timeout(60)
    check("- [ ] |milk" in marked(page), "Ctrl+Enter makes a task of a plain line", marked(page))
    page.keyboard.press("Control+Enter")
    page.wait_for_timeout(60)
    check("- [x] " in marked(page), "and ticks it on the next press", marked(page))

    now = page.evaluate("() => window.nib.state.doc.toString()")
    select(page, now, "two", caret_only=True)
    page.keyboard.press("Control+Shift+Enter")
    page.wait_for_timeout(60)
    check("cheese\n  |\n  two" in marked(page), "Ctrl+Shift+Enter opens a line above", marked(page))

    now = page.evaluate("() => window.nib.state.doc.toString()")
    select(page, now, "first", caret_only=True)
    page.keyboard.press("Control+j")
    page.wait_for_timeout(60)
    check("first| second" in marked(page), "Ctrl+J joins the next line on", marked(page))


def from_the_palette(page: Page) -> None:
    doc = "# Palette drive\n\n- pear\n- apple\n- fig\n\nshout this\n\ngone\nstays\n"
    open_note(page, doc)

    select(page, doc, "apple", caret_only=True)
    palette(page, "Sort the lines")
    check(
        "«- apple\n- fig\n- pear»" in marked(page),
        "Sort the lines sorts the list the caret is in",
        marked(page),
    )

    now = page.evaluate("() => window.nib.state.doc.toString()")
    select(page, now, "shout this")
    palette(page, "Upper case")
    check("«SHOUT THIS»" in marked(page), "Upper case, from the palette", marked(page))

    now = page.evaluate("() => window.nib.state.doc.toString()")
    select(page, now, "gone", caret_only=True)
    palette(page, "Delete the line")
    check("\n|stays" in marked(page) and "gone" not in marked(page), "Delete the line", marked(page))


def every_match(page: Page) -> None:
    doc = "# Match drive\n\nwind and wind and more wind.\n"
    open_note(page, doc)
    select(page, doc, "and", caret_only=True)

    page.keyboard.press("Control+f")
    wait_for(page, "() => !!document.querySelector('.findbar input')", "the find bar")
    page.keyboard.type("wind")
    page.wait_for_timeout(300)
    page.keyboard.press("Alt+Enter")
    page.wait_for_timeout(200)

    state = page.evaluate(MARKED)
    bar = page.evaluate("() => !!document.querySelector('.findbar')")
    check(state["ranges"] == 3, "Alt+Enter in the find bar selects every match", state)
    check(not bar, "and the bar goes", bar)


def slash_menu(page: Page) -> None:
    """The `/` menu's rows are the command list's, handed over at the launch's last
    turn rather than carried into the first paint; a `/` typed after it still offers
    them."""
    doc = "# Slash drive\n\n"
    open_note(page, doc)
    page.evaluate(SELECT, [len(doc), len(doc)])
    page.keyboard.type("/quo")
    shown = wait_for(
        page,
        "() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((one) => one.textContent)",
        "the / menu",
    )
    check(any("Quote" in one for one in shown), "the / menu still offers the blocks", shown)
    page.keyboard.press("Escape")


def hidden_front_matter(page: Page) -> None:
    doc = "---\nicon: list-checks\n---\n# Hidden drive\nwords\n"
    open_note(page, doc)
    select(page, doc, "# Hidden", caret_only=True)

    page.keyboard.press("Control+Shift+Enter")
    page.keyboard.press("Alt+ArrowUp")
    page.wait_for_timeout(60)
    palette(page, "Delete the line")
    text = page.evaluate("() => window.nib.state.doc.toString()")
    check(text.startswith("---\nicon: list-checks\n---\n"), "hidden front matter stays whole", text)


def main() -> int:
    with DRIVE.session() as browser:
        context = browser.new_context(viewport={"width": 1280, "height": 860})
        page = context.new_page()
        page.on("pageerror", lambda error: say(f"page error: {error}"))
        page.goto(ORIGIN, wait_until="domcontentloaded")
        wait_for(page, "() => !!window.nibApp?.workspace?.activeSpace", "a space")
        wait_for(page, "() => window.nibApp.workspace.tabs.length > 0", "the launch")

        pasting(page)
        growing(page)
        tasks_and_lines(page)
        from_the_palette(page)
        every_match(page)
        slash_menu(page)
        hidden_front_matter(page)

    return DRIVE.verdict("the line and text commands answer their keys, the palette and a paste")


if __name__ == "__main__":
    sys.exit(main())
