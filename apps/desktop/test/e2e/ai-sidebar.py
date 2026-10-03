"""The AI panel, driven against a provider of our own, in the light and in the dark.

What it proves, in order (docs/ai-sidebar.md 4 and 6.2, lane 4):

- Ctrl+Shift+A opens the panel with the keyboard in its field, Ask first;
- a message streams in with its thinking folded into one row, the ring fills from
  the provider's own count against the model's window, and the request carries the
  note in front;
- Escape stops an answer and keeps what arrived;
- Enter while an answer runs queues the message, and it goes once the answer is done;
- Ctrl+Enter sends words into the running answer, drawn as a steered message;
- Alt+P opens the model popover with the provider's list and its windows, a second
  model is picked by key and answers the next request; Alt+T steps the effort, which
  the chip says and the request carries; Shift+Tab steps the mode;
- `@` lists the space's notes and a chosen one goes along as a chip;
- `/` lists the commands, and `/new` starts a new thread;
- Ctrl+Shift+A pressed again in the field shows the thread list, which searches, opens
  with Enter, and archives with Delete;
- the ring's tray lists the bands.

A fake OpenAI-compatible server answers, a word at a time, with reasoning before the
words and its counts at the end. No key, no network, no bill.

    python apps/desktop/test/e2e/ai-sidebar.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go under
`shots/ai-sidebar/`.
"""

from __future__ import annotations

import http.server
import json
import sys
import time

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERONS = "# Herons\n\nA heron stands still in the shallows for a long time.\n\nThen it strikes.\n"
HOVERING = "# Hovering\n\nA kestrel hovers facing the wind over the verge.\n"


class Model(http.server.BaseHTTPRequestHandler):
    """An OpenAI-compatible provider: two models with their windows, reasoning before
    the words, and the counts at the end of every stream."""

    words: list[str] = ["Still."]
    thoughts: list[str] = []
    pause: float = 0.0
    seen: list[dict] = []

    def log_message(self, format: str, *args: object) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        body = {
            "data": [
                {
                    "id": "fake-small",
                    "name": "Fake Small",
                    "context_length": 32000,
                    "supported_parameters": ["reasoning_effort"],
                },
                {"id": "fake-large", "name": "Fake Large", "context_length": 200000},
            ]
        }
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _send(self, event: dict) -> bool:
        try:
            self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
            self.wfile.flush()
        except OSError:
            return False
        return True

    def do_POST(self) -> None:  # noqa: N802
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            asked = json.loads(raw)
        except json.JSONDecodeError:
            asked = {}
        Model.seen.append(asked)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self._cors()
        self.end_headers()
        model = asked.get("model", "fake-small")
        for thought in Model.thoughts:
            if not self._send({"model": model, "choices": [{"delta": {"reasoning": thought}}]}):
                return
            time.sleep(0.05)
        for word in Model.words:
            if not self._send({"model": model, "choices": [{"delta": {"content": word}}]}):
                return
            if Model.pause:
                time.sleep(Model.pause)
        sent = len(json.dumps(asked.get("messages", []))) // 4
        usage = {"prompt_tokens": sent + 4000, "completion_tokens": 3000}
        if not self._send({"model": model, "choices": [{"delta": {}, "finish_reason": "stop"}], "usage": usage}):
            return
        try:
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return


MODEL_ORIGIN = DRIVE.side(Model)

SETUP = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake-small' })
  ai.setDefault(made.id)
  return ai.ready
}
"""

WHERE = """
() => {
  const at = document.activeElement
  return { panel: at?.closest('[data-panel]')?.dataset.panel ?? null, tag: at?.tagName.toLowerCase() ?? null }
}
"""

FIELD = ".ask textarea"


def last_sent() -> str:
    return json.dumps(Model.seen[-1] if Model.seen else {})


def waited(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    return DRIVE.waited(page, expression, what, patience)


def idle(page: Page) -> bool:
    return waited(page, "!document.querySelector('.ask .go[aria-label=\"Stop\"]')", "the answer to end")


def type_and_send(page: Page, words: str, key: str = "Enter") -> None:
    page.locator(FIELD).click()
    page.keyboard.type(words)
    page.keyboard.press(key)


def drive(browser: Browser, scheme: str) -> None:
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    DRIVE.open(page)
    DRIVE.seed(page, HERONS, HOVERING)
    page.evaluate(SETUP, MODEL_ORIGIN)
    DRIVE.open_note(page, "Herons")
    tag = f"{scheme}/"

    # The panel, on its key, with the keyboard in its field.
    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control+Shift+A")
    waited(page, f"document.querySelector('{FIELD}')", "the field")
    page.wait_for_timeout(300)
    where = page.evaluate(WHERE)
    if where != {"panel": "ask", "tag": "textarea"}:
        wrong(f"Ctrl+Shift+A did not put the keyboard in the field: {where}")
    mode = page.locator(".ask .controls .mode").inner_text()
    if mode.strip() != "Ask":
        wrong(f"a new thread does not start in Ask: {mode!r}")
    shot(page, f"{tag}01-empty")

    # A message: thinking folded, words streamed, the ring from the provider's count.
    Model.seen.clear()
    Model.thoughts = ["Looking ", "at the note."]
    Model.words = ["A heron ", "waits, ", "then ", "strikes ", "[1]."]
    Model.pause = 0.05
    type_and_send(page, "What does a heron do?")
    waited(page, "document.querySelectorAll('.ask .answer').length === 1", "an answer")
    idle(page)
    page.wait_for_timeout(300)
    if "stands still in the shallows" not in last_sent():
        wrong("the note in front did not go with the message")
    rows = page.locator(".ask .row .verb").all_inner_texts()
    if "Thought" not in rows:
        wrong(f"the thinking is not a folded row: {rows}")
    answer = page.locator(".ask .answer").first.inner_text()
    if "strikes" not in answer:
        wrong(f"the answer did not stream in: {answer!r}")
    if page.locator('.ask .answer a[href="#cite-1"]').count() != 1:
        wrong("Ask's citation is not a link to its passage")
    used = page.evaluate(
        "() => document.querySelector('.ask .knob .arc-used')?.getAttribute('stroke-dasharray') ?? ''"
    )
    if not used or used.startswith("0 "):
        wrong(f"the ring did not fill from the provider's count: {used!r}")
    shot(page, f"{tag}02-answered")

    # The thinking row opens to what the provider said of it.
    page.locator(".ask .row .line").first.click()
    page.wait_for_timeout(250)
    if "at the note" not in page.locator(".ask .row .detail").first.inner_text():
        wrong("the thinking row does not open to the summary")

    # Escape stops an answer; what arrived stays.
    Model.thoughts = []
    Model.words = [f"word{one} " for one in range(60)]
    Model.pause = 0.08
    type_and_send(page, "Count slowly")
    waited(page, "document.querySelectorAll('.ask .answer')[1]?.textContent.includes('word2')", "a second answer")
    page.locator(FIELD).press("Escape")
    idle(page)
    kept = page.locator(".ask .answer").nth(1).inner_text()
    if "word0" not in kept or "word59" in kept:
        wrong(f"Escape did not stop and keep what had arrived: {kept[:60]!r}")
    if "Stopped" not in kept:
        wrong("a stopped answer does not say it stopped")

    # Enter while it runs queues; the queued message goes once the answer is done.
    Model.words = [f"slow{one} " for one in range(20)]
    Model.pause = 0.08
    before = len(Model.seen)
    type_and_send(page, "First of two")
    waited(page, "document.querySelector('.ask .go[aria-label=\"Stop\"]')", "the answer to start")
    type_and_send(page, "Second of two")
    waited(page, "document.querySelectorAll('.ask .queued').length === 1", "the queued message")
    shot(page, f"{tag}03-queued")
    Model.pause = 0.02
    waited(page, f"document.querySelectorAll('.ask .said').length >= 4", "the queued message to go")
    idle(page)
    if len(Model.seen) - before != 2 or "Second of two" not in last_sent():
        wrong(f"the queued message was not sent after the answer: {len(Model.seen) - before}")

    # Ctrl+Enter sends into the running answer.
    Model.words = [f"long{one} " for one in range(30)]
    Model.pause = 0.08
    type_and_send(page, "Tell me about kestrels")
    waited(page, "document.querySelector('.ask .go[aria-label=\"Stop\"]')", "the answer to start")
    type_and_send(page, "and their eyes", "Control+Enter")
    waited(page, "document.querySelector('.ask .said.steered')", "the steered message")
    Model.pause = 0.01
    idle(page)
    if "and their eyes" not in last_sent():
        wrong("the steered words did not reach the model")
    shot(page, f"{tag}04-steered")

    # Alt+P: the provider's list, a second model taken by key.
    page.locator(FIELD).click()
    page.keyboard.press("Alt+p")
    waited(page, "document.querySelectorAll('.ask .pop .model').length === 2", "the model list")
    windows = page.locator(".ask .pop .window").all_inner_texts()
    say(f"the popover lists windows {windows}")
    if sorted(windows) != ["200K", "32K"]:
        wrong(f"the models' windows are not listed: {windows}")
    page.wait_for_timeout(300)
    shot(page, f"{tag}05-models")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.wait_for_timeout(250)
    chip = page.locator(".ask .picker .chip").inner_text()
    if "Fake Large" not in chip:
        wrong(f"the model chip does not say the model picked: {chip!r}")
    Model.words = ["Large ", "says ", "hello."]
    Model.pause = 0
    type_and_send(page, "Who are you?")
    idle(page)
    if Model.seen[-1].get("model") != "fake-large":
        wrong(f"the next request did not ask the model picked: {Model.seen[-1].get('model')}")
    if page.locator(".ask .notice.model").count() < 1:
        wrong("a model switch is not marked between the messages")

    # Back to the small one, whose effort Alt+T steps.
    page.locator(FIELD).click()
    page.keyboard.press("Alt+p")
    waited(page, "document.querySelector('.ask .pop')", "the model popover")
    page.locator(".ask .pop .model", has_text="Fake Small").click()
    page.wait_for_timeout(200)
    page.locator(FIELD).click()
    page.keyboard.press("Alt+t")
    page.wait_for_timeout(150)
    chip = page.locator(".ask .picker .chip").inner_text()
    if "Minimal" not in chip:
        wrong(f"Alt+T did not step the effort: {chip!r}")
    type_and_send(page, "Briefly")
    idle(page)
    if Model.seen[-1].get("reasoning_effort") != "minimal":
        wrong(f"the effort did not go with the request: {Model.seen[-1].get('reasoning_effort')}")

    # Shift+Tab steps the mode.
    page.locator(FIELD).click()
    page.keyboard.press("Shift+Tab")
    page.wait_for_timeout(150)
    if page.locator(".ask .controls .mode").inner_text().strip() != "Plan":
        wrong("Shift+Tab did not step Ask to Plan")
    page.keyboard.press("Shift+Tab")
    page.keyboard.press("Shift+Tab")

    # The ring's tray.
    page.locator(".ask .knob").click()
    waited(page, "document.querySelector('.ask .tray')", "the tray")
    bands = page.locator(".ask .tray .band .what").all_inner_texts()
    if bands != ["Instructions", "Attached", "Conversation", "Next message"]:
        wrong(f"the tray does not list the bands: {bands}")
    page.wait_for_timeout(300)
    shot(page, f"{tag}06-tray")
    page.keyboard.press("Escape")

    # `@` and a note as a chip that goes along.
    page.locator(FIELD).click()
    page.keyboard.type("Compare @Hov")
    waited(page, "document.querySelector('.ask .suggest .row')", "the mention list")
    page.wait_for_timeout(300)
    shot(page, f"{tag}07-mention")
    page.keyboard.press("Enter")
    page.wait_for_timeout(150)
    chips = page.locator(".ask .chips .chip .name").all_inner_texts()
    if "Hovering" not in chips:
        wrong(f"the mention did not become a chip: {chips}")
    Model.words = ["Both ", "birds."]
    page.keyboard.type(" with this")
    page.keyboard.press("Enter")
    idle(page)
    if "facing the wind over the verge" not in last_sent():
        wrong("the mentioned note did not go with the message")

    # Ctrl+Shift+A again: the thread list.
    page.locator(FIELD).click()
    page.keyboard.press("Control+Shift+A")
    waited(page, "document.querySelector('.ask .threads')", "the thread list")
    titles = page.locator(".ask .threads .row .title").all_inner_texts()
    if not titles or "What does a heron do?" not in titles[0]:
        wrong(f"the thread list does not name the thread: {titles}")
    shot(page, f"{tag}08-threads")
    page.keyboard.press("Escape")

    # `/new` starts a thread of its own; the list then holds both.
    page.locator(FIELD).click()
    page.keyboard.type("/ne")
    waited(page, "document.querySelector('.ask .suggest .row')", "the command list")
    page.wait_for_timeout(300)
    shot(page, f"{tag}09-commands")
    page.keyboard.press("Enter")
    page.wait_for_timeout(250)
    if page.locator(".ask .said").count():
        wrong("/new did not start a new thread")
    Model.words = ["New."]
    type_and_send(page, "A fresh one")
    idle(page)
    page.locator(FIELD).click()
    page.keyboard.press("Control+Shift+A")
    waited(page, "document.querySelectorAll('.ask .threads .row').length === 2", "two threads")
    page.keyboard.type("heron")
    page.wait_for_timeout(200)
    found = page.locator(".ask .threads .row .title").all_inner_texts()
    if found != ["What does a heron do?"]:
        wrong(f"the list's search does not find the thread by its words: {found}")
    page.keyboard.press("Enter")
    waited(page, "document.querySelectorAll('.ask .said').length > 3", "the old thread open")
    page.locator(FIELD).click()
    page.keyboard.press("Control+Shift+A")
    waited(page, "document.querySelector('.ask .threads')", "the thread list again")
    page.keyboard.press("Delete")
    waited(page, "document.querySelector('.ask .threads .group')", "the archived group")
    shot(page, f"{tag}10-archived")
    page.keyboard.press("Escape")
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
    return DRIVE.verdict("the AI panel sends, stops, queues, steers, switches and lists")


if __name__ == "__main__":
    raise SystemExit(main())
