"""An agent editing the note somebody is typing in, and nothing of theirs lost.

The reader types without stopping at the end of a paragraph while an agent makes
fifty anchored edits through the window's own interface (lib/agents/docs): most of
them in the paragraphs around it, many in the very paragraph being typed in, and the
last one right beside the caret, which waits for the typing to pause. Then:

- every keystroke is in the note, in order, where it was typed, and the caret is
  right after the last one: it never jumped;
- every edit landed, and the agent's caret was drawn where it wrote;
- Ctrl+Z walks back one step at a time, each step either one agent edit or some of
  the reader's typing and never both, newest first, down to the note as it was, and
  Ctrl+Y walks forward again;
- "Undo edits by" the agent takes back all fifty and keeps every character typed.

Serves the app from a Vite dev server of its own on its own origin, so it builds
nothing and leaves apps/desktop/dist alone, and drives it in headless Chromium. The
agents' interface is imported by its module path, which only a dev server answers.

Run it from the repository root:

    python apps/desktop/test/e2e/agent-edits.py

Screenshots go beside this file under `shots/agent-edits/`.
"""

from __future__ import annotations

import json
import re
import time

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot
ORIGIN = DRIVE.origin

AROUND = 20
MINE = 30
TYPED = " the quick brown fox jumps over the lazy dog" * 5


def tokens(prefix: str, count: int) -> str:
    return " ".join(f"{prefix}{at:02d}" for at in range(count))


NOTE = f"# Drive\n\n{tokens('a', AROUND)}\n\n{tokens('w', MINE)}\n\n{tokens('b', AROUND)}\n"

# Fifty edits, interleaved across the three paragraphs, the last one beside the caret.
EDITS: list[str] = []
for at in range(AROUND):
    EDITS += [f"a{at:02d}", f"w{at:02d}"] + ([f"b{at:02d}"] if at < 9 else [])
EDITS.append(f"w{MINE - 1:02d}")
assert len(EDITS) == 50

AGENT = {"id": "drive-agent", "name": "Drive agent"}

START_AGENT = """
async ([edits, agent]) => {
  const docs = await import('/src/lib/agents/docs/index.ts')
  window.__agent = { docs, done: [], failed: [], carets: 0 }
  const run = async () => {
    for (const word of edits) {
      const edit = [{ at: { quote: word }, replace: word.toUpperCase() }]
      docs.notes.editNote(agent, { path: 'Drive.md' }, edit).then(
        () => window.__agent.done.push(word),
        (error) => window.__agent.failed.push(`${word}: ${error.code ?? ''} ${error.message}`),
      )
      await new Promise((go) => setTimeout(go, 150))
      if (document.querySelector('.cm-nib-caret.is-passing')) window.__agent.carets++
    }
  }
  void run()
}
"""

VIEW = "window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)"

def wait_for(page: Page, expression: str, what: str, patience: float = 60) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)
    raise SystemExit(f"gave up waiting for {what}")


def text(page: Page) -> str:
    return page.evaluate(f"() => {VIEW}.state.doc.toString()")


def caret(page: Page) -> int:
    return page.evaluate(f"() => {VIEW}.state.selection.main.head")


def expected(upper: set[str]) -> str:
    """The note with these words made capitals and the typing where it was typed."""

    def paragraph(prefix: str, count: int) -> str:
        words = [f"{prefix}{at:02d}" for at in range(count)]
        return " ".join(word.upper() if word in upper else word for word in words)

    return (
        f"# Drive\n\n{paragraph('a', AROUND)}\n\n{paragraph('w', MINE)}{TYPED}"
        f"\n\n{paragraph('b', AROUND)}\n"
    )


def capitals(words: str) -> set[str]:
    return set(re.findall(r"\b[AWB]\d\d\b", words))


def lowered(words: str) -> str:
    return re.sub(r"\b([AWB])(\d\d)\b", lambda found: found.group(0).lower(), words)


def one_step(before: str, after: str) -> tuple[str, list[str]]:
    """What one Ctrl+Z took - one agent edit, some of the reader's typing, or both at
    once, which is the thing that must never happen - and which agent edits."""
    agent = sorted(word.lower() for word in capitals(before) - capitals(after))
    reader = lowered(before) != lowered(after)
    if len(agent) == 1 and not reader:
        return "agent", agent
    if not agent and reader:
        return "reader", agent
    return f"mixed ({len(agent)} agent edits, reader {reader})", agent


def drive(page: Page) -> None:
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space", 120)

    page.evaluate(
        """async (note) => {
          const ws = window.nibApp.workspace
          await ws.noteFrom(note, ws.activeSpace.root)
          await ws.loadTree()
          const found = ws.notes.find((one) => one.name.startsWith('Drive'))
          await ws.openEntry(found.path, { activate: true })
        }""",
        NOTE,
    )
    wait_for(page, f"{VIEW} && {VIEW}.state.doc.toString().startsWith('# Drive')", "the note")

    # The caret at the end of the middle paragraph, and the editor focused.
    end_of_mine = NOTE.index(f"w{MINE - 1:02d}") + 3
    page.evaluate(
        f"""(at) => {{
          const view = {VIEW}
          view.dispatch({{ selection: {{ anchor: at }} }})
          view.focus()
        }}""",
        end_of_mine,
    )
    page.wait_for_timeout(300)

    page.evaluate(START_AGENT, [EDITS, AGENT])
    page.wait_for_timeout(200)
    shot(page, "01-agent-writing")
    page.keyboard.type(TYPED, delay=35)
    say(f"typed {len(TYPED)} characters")

    wait_for(page, "window.__agent.done.length + window.__agent.failed.length === 50", "the edits", 60)
    agent = page.evaluate("() => window.__agent")
    say(f"edits landed: {len(agent['done'])}, refused: {len(agent['failed'])}, caret seen {agent['carets']} times")
    for failure in agent["failed"]:
        wrong(f"an edit was refused: {failure}")
    if agent["carets"] < 10:
        wrong(f"the agent's caret was seen only {agent['carets']} times")
    if agent["done"][-1] != EDITS[-1]:
        wrong(f"the edit beside the caret did not wait for the typing: {agent['done'][-5:]}")

    after = text(page)
    if TYPED not in after:
        wrong("a keystroke was lost or landed apart from the rest")
    if after != expected(set(EDITS)):
        wrong(f"the note is not what fifty edits and the typing make:\n{after!r}")
    if caret(page) != after.index(TYPED) + len(TYPED):
        wrong(f"the caret is at {caret(page)}, not after the last keystroke")
    shot(page, "02-all-landed")

    # One more of the agent's, then Ctrl+Z all the way down, one step at a time.
    page.evaluate(
        """async (agent) => {
          await window.__agent.docs.notes.editNote(agent, { path: 'Drive.md' }, [
            { at: { end: true }, insert_after: 'AGENT LAST' },
          ])
        }""",
        AGENT,
    )
    full = text(page)
    page.keyboard.press("Control+z")
    page.wait_for_timeout(100)
    if text(page) != after:
        wrong("the first Ctrl+Z did not take back exactly the agent's last edit")

    steps: list[str] = []
    undone: list[str] = []
    before = text(page)
    for _ in range(400):
        page.keyboard.press("Control+z")
        now = text(page)
        if now == before:
            break
        kind, words = one_step(before, now)
        steps.append(kind)
        if kind.startswith("mixed"):
            wrong(f"one Ctrl+Z took the agent's and the reader's words at once: {kind}")
        undone += words
        before = now

    say(f"Ctrl+Z took {steps.count('agent')} agent edits and {steps.count('reader')} typing steps")
    if before != NOTE:
        wrong(f"Ctrl+Z all the way down did not reach the note as it was:\n{before!r}")
    if undone != list(reversed(agent["done"])):
        wrong("Ctrl+Z took the agent's edits back in some other order than newest first")

    for _ in range(400):
        page.keyboard.press("Control+y")
        now = text(page)
        if now == before:
            break
        before = now
    if before != full:
        wrong("Ctrl+Y did not bring everything back")

    # And "Undo edits by" the agent: all of them, every keystroke kept.
    undone_all = page.evaluate(
        """async (agent) => window.__agent.docs.notes.undoAgent(agent, { path: 'Drive.md' })""",
        AGENT,
    )
    say(f"undo the agent's edits: {json.dumps(undone_all)}")
    if text(page) != expected(set()):
        wrong(f"undoing the agent did not leave exactly the note and the typing:\n{text(page)!r}")
    shot(page, "03-agent-undone")


def main() -> int:
    with DRIVE.session() as browser:
        page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
        drive(page)

    return DRIVE.verdict("all good")


if __name__ == "__main__":
    raise SystemExit(main())
