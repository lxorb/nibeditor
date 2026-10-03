"""The scratchpad and the quick question, driven with the keyboard.

What it proves, in order:

- the scratchpad: its glyph is in the sidebar's foot; Ctrl+Shift+X opens it as a tab,
  lit on the glyph, and what is typed into it is written down and there again after a
  reload; the key again goes back to the tab before it; the Search panel finds its
  words from the space; Move to space in its tab's menu makes it a note of the space,
  opened in its place, and leaves it empty;
- the quick question: with no provider, Ctrl twice says the one line and links to
  Settings > AI; with the fake provider, Ctrl twice over a selection opens the field
  with the selection as its chip, Enter streams the answer in place and the request
  carries the selection; a follow-up carries the turn before it; Add to note writes the
  answer under the selection's line and puts the field away; a chip taken off sends
  nothing of the note; Escape puts it away; with nothing in front, Add to note puts the
  answer on the end of the scratchpad.

A fake OpenAI-compatible server answers, streaming a word at a time. No key, no
network, no bill.

    python apps/desktop/test/e2e/quick-tools.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go under
`shots/quick-tools/`.
"""

from __future__ import annotations

import http.server
import json
import sys

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MODEL = "fake-small"
PLAN = "# Plan\n\nThe first line.\n\nThe heron line we ask about.\n\nThe last line.\n"

SETUP = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  if (!base) return ai.ready
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: '%s' })
  ai.setDefault(made.id)
  return ai.ready
}
""" % MODEL

ACTIVE = "() => window.nibApp.workspace.active?.path ?? ''"
TEXT = "() => window.nibApp.workspace.active?.note.latest ?? ''"
PAD_TEXT = """
async () => {
  const ws = window.nibApp.workspace
  const tab = ws.tabs.find((one) => /Scratchpad\\.md$/.test(one.path ?? ''))
  if (tab) return tab.note.latest
  return (await ws.noteText('/.nib/Scratchpad.md')) ?? ''
}
"""
FOCUS_NOTE = "() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()"


class Model(http.server.BaseHTTPRequestHandler):
    """An OpenAI-compatible provider that streams what the drive tells it to."""

    words: list[str] = ["A ", "heron ", "waits."]
    seen: list[dict] = []

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            Model.seen.append(json.loads(raw))
        except json.JSONDecodeError:
            Model.seen.append({})

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        try:
            for word in Model.words:
                event = {"choices": [{"delta": {"content": word}}]}
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return


#: Where the fake provider answers, on a port of this run's own.
MODEL_ORIGIN = DRIVE.side(Model)


def wait_for(page: Page, expression: str, what: str) -> bool:
    return DRIVE.waited(page, expression, what)


def twice_ctrl(page: Page) -> None:
    """Ctrl pressed twice on its own, the quick question's key."""
    page.keyboard.press("Control")
    page.keyboard.press("Control")


def last_messages() -> str:
    """Everything the last request said, as one string to look for words in."""
    if not Model.seen:
        return ""
    return json.dumps(Model.seen[-1].get("messages", []))


def scratchpad(page: Page) -> None:
    # A fresh window in a browser opens with the file list away; the foot is its.
    if not page.locator("[data-region=foot]").count():
        page.evaluate("() => window.nibApp.workspace.toggleSidebar()")
        wait_for(page, "document.querySelector('[data-region=foot]')", "the sidebar's foot")
    glyph = page.locator('.foot button[aria-label="Scratchpad"]')
    if glyph.count() != 1:
        wrong("the scratchpad's glyph is not in the sidebar's foot")

    DRIVE.open_note(page, "Plan")
    page.evaluate(FOCUS_NOTE)
    page.keyboard.press("Control+Shift+X")
    if not wait_for(page, "/Scratchpad\\.md$/.test(window.nibApp.workspace.active?.path ?? '')", "the scratchpad"):
        return
    wait_for(page, "document.querySelector('.cm-content')", "its editor")
    if glyph.get_attribute("aria-pressed") != "true":
        wrong("the glyph is not lit while the scratchpad is in front")

    page.evaluate(FOCUS_NOTE)
    page.keyboard.type("call Anna about the heron count")
    wait_for(page, "window.nibApp.workspace.active && !window.nibApp.workspace.active.dirty", "it written down")
    shot(page, "01-scratchpad")

    page.reload(wait_until="domcontentloaded")
    DRIVE.ready(page)
    after = page.evaluate(PAD_TEXT)
    say(f"after a reload it says {after!r}")
    if "heron count" not in after:
        wrong(f"the scratchpad lost its words over a reload: {after!r}")

    wait_for(page, "/Scratchpad\\.md$/.test(window.nibApp.workspace.active?.path ?? '')", "its tab put back")
    page.evaluate(FOCUS_NOTE)
    page.keyboard.press("Control+Shift+X")
    wait_for(page, "!/Scratchpad\\.md$/.test(window.nibApp.workspace.active?.path ?? '')", "the tab before it")
    say(f"the key again went back to {page.evaluate(ACTIVE)}")

    page.keyboard.press("Control+Shift+F")
    wait_for(page, "document.querySelector('.find input')", "the search field")
    page.locator(".find input").fill("heron count")
    found = wait_for(
        page,
        "[...document.querySelectorAll('.find ~ * *, .find *')].some((one) => /Scratchpad/.test(one.textContent ?? ''))"
        " || /Scratchpad/.test(document.querySelector('[data-panel=search]')?.textContent ?? '')",
        "a row of the scratchpad's in the search",
    )
    shot(page, "02-search")
    if not found:
        wrong("the search does not find the scratchpad's words")
    page.keyboard.press("Escape")

    page.evaluate(FOCUS_NOTE)
    page.keyboard.press("Control+Shift+X")
    wait_for(page, "/Scratchpad\\.md$/.test(window.nibApp.workspace.active?.path ?? '')", "the scratchpad again")
    tab = page.locator("[data-region=tabs] .tab.active").first
    tab.click(button="right")
    row = page.get_by_role("menuitem", name="Move to space")
    if row.count() == 0:
        row = page.locator(".menu button", has_text="Move to space")
    if row.count() == 0:
        wrong("the scratchpad's tab offers no Move to space")
        page.keyboard.press("Escape")
        return
    row.first.click()
    wait_for(page, "document.querySelector('.sheet .found-row')", "the spaces to choose from")
    shot(page, "03-move-to-space")
    page.keyboard.press("Enter")
    wait_for(
        page,
        "window.nibApp.workspace.notes.some((one) => one.name.startsWith('call Anna'))",
        "a note made of it in the space",
    )
    wait_for(page, "(window.nibApp.workspace.active?.path ?? '').includes('call Anna')", "the note in front")
    left = page.evaluate(PAD_TEXT)
    if left.strip():
        wrong(f"the scratchpad was not emptied: {left!r}")
    if page.evaluate("window.nibApp.workspace.tabs.some((one) => /Scratchpad\\.md$/.test(one.path ?? ''))"):
        wrong("the scratchpad's tab stayed beside the note it became")
    shot(page, "04-moved")


def nothing_set_up(page: Page) -> None:
    page.evaluate(SETUP, "")
    DRIVE.open_note(page, "Plan")
    page.evaluate(FOCUS_NOTE)
    twice_ctrl(page)
    if not wait_for(page, "document.querySelector('.quick')", "the quick question"):
        return
    words = page.locator(".quick").inner_text()
    if "Add an AI provider" not in words:
        wrong(f"with no provider it does not say where to add one: {words!r}")
    shot(page, "05-nothing-set-up")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.quick')", "it put away")


def asked(page: Page) -> None:
    page.evaluate(SETUP, MODEL_ORIGIN)
    DRIVE.open_note(page, "Plan")
    page.evaluate(
        """() => {
          const view = window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)
          const text = view.state.doc.toString()
          const from = text.indexOf('heron line')
          view.dispatch({ selection: { anchor: from, head: from + 'heron line'.length } })
          view.focus()
        }"""
    )
    twice_ctrl(page)
    if not wait_for(page, "document.querySelector('.quick textarea')", "the field"):
        return
    wait_for(page, "document.activeElement?.closest('.quick')", "the keyboard in it")
    chip = page.locator(".quick .chip")
    if chip.count() != 1 or "heron line" not in chip.inner_text():
        wrong(f"the selection is not the chip: {chip.all_inner_texts()}")

    page.keyboard.type("What is this?")
    page.keyboard.press("Enter")
    wait_for(page, "/heron waits/.test(document.querySelector('.quick .words')?.textContent ?? '')", "the answer")
    shot(page, "06-answered")
    if "<selection>" not in last_messages() or "heron line" not in last_messages():
        wrong(f"the request did not carry the selection: {last_messages()[:300]}")

    Model.words = ["Then ", "it ", "strikes."]
    page.keyboard.type("And then?")
    page.keyboard.press("Enter")
    wait_for(page, "/strikes/.test(document.querySelector('.quick .talk')?.textContent ?? '')", "the follow-up")
    said = last_messages()
    if "What is this?" not in said or "A heron waits." not in said:
        wrong(f"the follow-up did not carry the turn before it: {said[:400]}")

    page.locator('.quick button[aria-label="Add to note"]').click()
    wait_for(page, "!document.querySelector('.quick')", "the field put away")
    text = page.evaluate(TEXT)
    say(f"the note now says {text!r}")
    if "The heron line we ask about.\n\nThen it strikes.\n\nThe last line." not in text:
        wrong(f"the answer is not under the selection's line: {text!r}")

    Model.words = ["Plain."]
    page.evaluate(FOCUS_NOTE)
    twice_ctrl(page)
    wait_for(page, "document.querySelector('.quick .chip')", "the chip again")
    page.locator(".quick .chip .drop").click()
    page.keyboard.type("Hello?")
    page.keyboard.press("Enter")
    wait_for(page, "/Plain/.test(document.querySelector('.quick .words')?.textContent ?? '')", "an answer")
    if "<note>" in last_messages() or "<selection>" in last_messages():
        wrong("a chip taken off still sent the note")
    page.keyboard.press("Escape")
    wait_for(page, "!document.querySelector('.quick')", "Escape putting it away")

    # Nothing in front: the tab put down, and the answer goes on the scratchpad's end.
    page.evaluate(FOCUS_NOTE)
    page.keyboard.press("Control+D")
    wait_for(page, "!window.nibApp.workspace.active", "nothing in front")
    Model.words = ["Jotted."]
    twice_ctrl(page)
    wait_for(page, "document.querySelector('.quick textarea')", "the field")
    if page.locator(".quick .chip").count():
        wrong("with nothing in front the question still has a chip")
    page.keyboard.type("Anything?")
    page.keyboard.press("Enter")
    wait_for(page, "/Jotted/.test(document.querySelector('.quick .words')?.textContent ?? '')", "an answer")
    page.locator('.quick button[aria-label="Add to note"]').click()
    wait_for(page, "!document.querySelector('.quick')", "the field put away")
    pad = page.evaluate(PAD_TEXT)
    if "Jotted." not in pad:
        wrong(f"the answer did not go on the scratchpad's end: {pad!r}")


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme="light")
    DRIVE.open(page)
    say(f"the space holds {DRIVE.seed(page, PLAN)}")
    say("--- the scratchpad ---")
    scratchpad(page)
    say("--- nothing set up ---")
    nothing_set_up(page)
    say("--- asked ---")
    asked(page)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the scratchpad keeps, finds and moves; the quick question answers in place"))
