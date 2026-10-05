"""The AI panel, driven against a provider of our own, in the light and in the dark.

What it proves, in order (docs/ai-sidebar.md 4 and 6.2, lane 4):

- Ctrl+Shift+A opens the panel with the keyboard in its field, Approve first;
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
- `/` lists the commands, `/status` writes its lines into the thread, `/goal` puts its
  chip over the field and the chip's cross clears it, and `/new` starts a new thread;
- Ctrl+Shift+A pressed again in the field shows the thread list, which searches, opens
  with Enter, and archives with Delete;
- the ring's tray lists the bands;
- and the whole of it in one thread: Approve answers, Agent mode edits a note as the
  provider's agent while its answer runs, the changes bar keeps one edit and undoes the
  other, the clock on a message rewinds notes and conversation to before it, and Up
  on the empty field sends an edited message again, which leaves arrows between the
  two branches.

And ChatGPT's shape, which the panel copies (docs/ai-sidebar.md 4.1), in the light and
the dark: an empty thread is the greeting with the composer in the middle, which settles
to the foot as the first message goes; the reader's words are a bubble at the end of the
line and the answer runs the width; a code block wears its language and a copy button;
"+" holds the modes; Ask again asks another model; the round arrow goes back down a long
thread; "Open in new tab" puts the conversation in a pane with the threads down its left
by age; and the quick question is the small composer, whose Continue carries it on in
the panel.

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

# A dev server of its own, since the flow below edits a note as the provider's agent
# through the window's own interface, which only a dev server answers by its path.
DRIVE = Drive(__file__, dev=True)
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
  return made.id
}
"""

EDIT = """
async ([provider, quote, replace]) => {
  const docs = await import('/src/lib/agents/docs/index.ts')
  await docs.notes.editNote({ id: `nib-${provider}`, name: 'Fake' }, { path: 'Herons.md' }, [
    { at: { quote }, replace },
  ])
}
"""

NOTE_TEXT = "() => window.nibApp.workspace.active?.note?.latest ?? ''"

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
    if mode.strip() != "Approve":
        wrong(f"a new thread does not start in Approve: {mode!r}")
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
    if page.locator(".ask .controls .mode").inner_text().strip() != "Agent":
        wrong("Shift+Tab did not step Approve to Agent")
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

    # A command's own lines, and a goal's chip that its cross clears.
    page.locator(FIELD).click()
    page.keyboard.type("/status")
    page.keyboard.press("Enter")
    waited(page, "document.querySelector('.ask .notice.said')", "the command's lines")
    Model.words = ['{"verdict": "not_yet", "reason": "still going"}']
    page.locator(FIELD).click()
    page.keyboard.type("/goal every bird note names its bird")
    page.keyboard.press("Enter")
    waited(page, "document.querySelector('.ask .goal')", "the goal's chip")
    page.wait_for_timeout(300)
    shot(page, f"{tag}08-goal")
    page.locator(".ask .goal .drop").click()
    waited(page, "!document.querySelector('.ask .goal')", "the goal cleared")
    idle(page)

    # Ctrl+Shift+A again: the thread list.
    page.locator(FIELD).click()
    page.keyboard.press("Control+Shift+A")
    waited(page, "document.querySelector('.ask .threads')", "the thread list")
    titles = page.locator(".ask .threads .row .title").all_inner_texts()
    if not titles or "What does a heron do?" not in titles[0]:
        wrong(f"the thread list does not name the thread: {titles}")
    shot(page, f"{tag}09-threads")
    page.keyboard.press("Escape")

    # `/new` starts a thread of its own; the list then holds both.
    page.locator(FIELD).click()
    page.keyboard.type("/ne")
    waited(page, "document.querySelector('.ask .suggest .row')", "the command list")
    page.wait_for_timeout(300)
    shot(page, f"{tag}10-commands")
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
    waited(page, "document.querySelector('.ask .threads .group.archived')", "the archived group")
    shot(page, f"{tag}11-archived")
    page.keyboard.press("Escape")
    page.context.close()


def running(page: Page) -> bool:
    return waited(page, "document.querySelector('.ask .go[aria-label=\"Stop\"]')", "the answer to start")


def flow(browser: Browser) -> None:
    """Approve answers, then an agent's edits kept and undone, a rewind, and a message sent again."""
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme="light")
    DRIVE.open(page)
    DRIVE.seed(page, HERONS)
    provider = page.evaluate(SETUP, MODEL_ORIGIN)
    DRIVE.open_note(page, "Herons")
    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control+Shift+A")
    waited(page, f"document.querySelector('{FIELD}')", "the field")

    # Approve answers with citations, as Ask did.
    Model.thoughts = []
    Model.words = ["It ", "stands ", "still ", "[1]."]
    Model.pause = 0
    type_and_send(page, "What does a heron do?")
    waited(page, "document.querySelector('.ask .answer a[href=\"#cite-1\"]')", "a cited answer")
    idle(page)

    # Agent mode, and two edits made as the provider's agent while the answer runs.
    page.locator(FIELD).click()
    page.keyboard.press("Shift+Tab")
    if page.locator(".ask .controls .mode").inner_text().strip() != "Agent":
        wrong("Shift+Tab did not reach Agent")
    Model.words = [f"done{one} " for one in range(25)]
    Model.pause = 0.08
    type_and_send(page, "Shout the heron's verbs")
    running(page)
    page.evaluate(EDIT, [provider, "strikes", "STRIKES"])
    page.evaluate(EDIT, [provider, "stands still", "STANDS STILL"])
    idle(page)
    waited(page, "document.querySelector('.ask .bar .what')", "the changes bar")
    page.wait_for_timeout(300)
    shot(page, "flow/01-changes")
    page.locator(".ask .bar .what").click()
    waited(page, "document.querySelectorAll('.ask .changes .change').length === 2", "two changes listed")
    shot(page, "flow/02-listed")
    page.locator(".ask .changes .change").first.locator(".nib-chip:not(.is-quiet)").click()
    page.wait_for_timeout(300)
    page.locator(".ask .changes .change").first.locator(".nib-chip.is-quiet").click()
    page.wait_for_timeout(600)
    text = page.evaluate(NOTE_TEXT)
    kept = ["STRIKES" in text, "STANDS STILL" in text]
    say(f"after Keep and Undo the note says {text!r}")
    if kept.count(True) != 1:
        wrong(f"one change was not kept and the other undone: {kept}")
    waited(page, "!document.querySelector('.ask .bar .what')", "the bar to empty")

    # A third edit, then the clock on that message rewinds notes and conversation.
    Model.words = [f"loud{one} " for one in range(20)]
    type_and_send(page, "Name the bird loudly")
    running(page)
    page.evaluate(EDIT, [provider, "A heron", "A HERON"])
    idle(page)
    said = page.locator(".ask .said").count()
    page.locator(".ask .said").last.hover()
    page.locator(".ask .said").last.locator('.tools button[aria-label="Rewind"]').click()
    waited(page, "document.querySelector('.ask .rewind')", "the rewind sheet")
    page.wait_for_timeout(300)
    shot(page, "flow/03-rewind")
    page.locator(".ask .rewind .nib-row", has_text="Restore notes and conversation").click()
    waited(page, f"document.querySelectorAll('.ask .said').length === {said - 1}", "the message rewound")
    page.wait_for_timeout(400)
    if "A HERON" in page.evaluate(NOTE_TEXT):
        wrong("the rewind did not take the note's edit back")

    # The rewound message is back in the field, to send again or let go.
    back = page.locator(FIELD).input_value()
    if back != "Name the bird loudly":
        wrong(f"the rewound message is not back in the field: {back!r}")

    # Up on the empty field: the last message, changed, and sent again.
    Model.words = ["Again."]
    Model.pause = 0
    page.locator(FIELD).fill("")
    page.locator(FIELD).click()
    page.keyboard.press("ArrowUp")
    waited(page, "document.querySelector('.ask .editing')", "the message to edit")
    field = page.locator(FIELD).input_value()
    if field != "Shout the heron's verbs":
        wrong(f"Up did not put the last message in the field: {field!r}")
    page.keyboard.press("End")
    page.keyboard.type(" quietly")
    page.keyboard.press("Enter")
    idle(page)
    page.wait_for_timeout(400)
    if "quietly" not in last_sent():
        wrong("the edited message was not sent")
    if page.locator(".ask .branches").count() < 1:
        wrong("an edited message has no arrows to the other branch")
    shot(page, "flow/04-resent")
    page.context.close()


BOX = """
(selector) => {
  const box = document.querySelector(selector)?.getBoundingClientRect()
  return box ? { top: box.top, bottom: box.bottom, left: box.left, right: box.right } : null
}
"""

QUICK = "() => import('/src/lib/ai/quick-door.ts').then((door) => door.askQuickly())"


def menu_row(page: Page, words: str):
    return page.locator(".menu [role=menuitem]").filter(has_text=words).first


def shape(browser: Browser, scheme: str) -> None:
    """ChatGPT's layout, at the side's width and a tab's, with the shots to hold it to."""
    page = DRIVE.page(browser, viewport={"width": 1280, "height": 820}, color_scheme=scheme)
    DRIVE.open(page)
    DRIVE.seed(page, HERONS, HOVERING)
    page.evaluate(SETUP, MODEL_ORIGIN)
    DRIVE.open_note(page, "Herons")
    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control+Shift+A")
    waited(page, f"document.querySelector('{FIELD}')", "the field")
    tag = f"shape/{scheme}/"

    # Empty: the greeting, and the composer in the middle of the panel.
    waited(page, "document.querySelector('.ask .hello')", "the greeting")
    page.wait_for_timeout(400)
    panel = page.evaluate(BOX, ".ask")
    foot = page.evaluate(BOX, ".ask .composer")
    middle = (panel["top"] + panel["bottom"]) / 2
    if not foot or not (panel["top"] + 80 < foot["top"] < middle + 80):
        wrong(f"an empty thread's composer is not in the middle: {foot} in {panel}")
    shot(page, f"{tag}01-empty-side")

    # The first message: the composer settles to the foot, the words a bubble at the end.
    Model.thoughts = ["Reading ", "the note."]
    Model.words = ["A heron ", "waits.\n\n", "```py\n", "print('strike')\n", "```\n"]
    Model.pause = 0.02
    type_and_send(page, "What does a heron do?")
    idle(page)
    page.wait_for_timeout(500)
    foot = page.evaluate(BOX, ".ask .composer")
    if page.locator(".ask .hello").count():
        wrong("the greeting stayed after the first message")
    if not foot or foot["bottom"] < panel["bottom"] - 40:
        wrong(f"the composer did not settle to the foot: {foot} in {panel}")
    bubble = page.evaluate(BOX, ".ask .said .bubble")
    if not bubble or bubble["right"] < panel["right"] - 40 or bubble["left"] < panel["left"] + 30:
        wrong(f"the message is not a bubble at the end of the line: {bubble} in {panel}")
    language = page.locator(".ask .answer .code-bar span").first.inner_text()
    if language != "py" or page.locator(".ask .answer .code-copy").count() != 1:
        wrong(f"the code block wears no bar with its language and copy: {language!r}")
    if page.locator(".ask .answer.last .acts button").count() < 3:
        wrong("the last answer has no row of actions under it")
    shot(page, f"{tag}02-answered-side")

    # "+" holds the modes; one picked is the chip beside it.
    page.locator(".ask .plus").click()
    waited(page, "document.querySelector('.menu [role=menuitem]')", "the + menu")
    rows = page.locator(".menu [role=menuitem] .nib-row-label").all_inner_texts()
    for row in ("Add photos and files", "Plan", "Agent", "Web search", "Mention", "Commands"):
        if row not in rows:
            wrong(f"the + menu has no {row!r}: {rows}")
    shot(page, f"{tag}03-plus")
    menu_row(page, "Plan").click()
    page.wait_for_timeout(200)
    if page.locator(".ask .controls .mode").inner_text().strip() != "Plan":
        wrong("a mode picked under + is not the chip beside it")
    page.locator(".ask .controls .mode").click()
    menu_row(page, "Ask").click()

    # Ask again, with another model from its menu.
    Model.thoughts = []
    Model.words = ["Large ", "answers."]
    page.locator('.ask .answer.last .acts button[aria-label="Ask again"]').click()
    waited(page, "document.querySelectorAll('.menu [role=menuitem]').length >= 3", "the models under Ask again")
    menu_row(page, "Fake Large").click()
    idle(page)
    if Model.seen[-1].get("model") != "fake-large":
        wrong(f"Ask again did not ask the model picked: {Model.seen[-1].get('model')}")

    # A long thread: scrolled up, the round arrow goes back down.
    Model.words = [f"line {one}\n\n" for one in range(40)]
    Model.pause = 0
    type_and_send(page, "Count to forty")
    idle(page)
    page.evaluate(
        "() => { const t = document.querySelector('.ask .talk'); t.scrollTop = 0; t.dispatchEvent(new Event('scroll')) }"
    )
    waited(page, "document.querySelector('.ask .down')", "the arrow back down")
    shot(page, f"{tag}04-scrolled-side")
    page.locator(".ask .down").click()
    waited(page, "!document.querySelector('.ask .down')", "the end again")

    # Open in new tab: the conversation in a pane, the threads down its left by age.
    page.locator(".ask .title").click()
    menu_row(page, "Open in new tab").click()
    waited(page, "document.querySelector('.ask.wide .shelf .threads')", "the conversation in a tab")
    page.wait_for_timeout(500)
    if page.evaluate("() => window.nibApp.workspace.openOn('right')") == "ask":
        wrong("the side stayed open beside the tab")
    groups = page.locator(".ask.wide .threads .group").all_inner_texts()
    if not groups or groups[0].strip() != "Today":
        wrong(f"the rail does not file the threads by age: {groups}")
    column = page.evaluate(BOX, ".ask.wide .composer")
    if not column or (column["right"] - column["left"]) > 48 * 16 + 40:
        wrong(f"the tab's composer is not ChatGPT's column: {column}")
    shot(page, f"{tag}05-tab")
    page.locator(".ask.wide .threads .new").click()
    waited(page, "document.querySelector('.ask.wide .hello')", "a new thread in the tab")
    page.wait_for_timeout(400)
    shot(page, f"{tag}06-tab-empty")

    # The quick question, ChatGPT's small composer, carried on in the panel.
    page.evaluate(QUICK)
    waited(page, "document.querySelector('.quick textarea')", "the quick question")
    Model.words = ["Herons ", "fish."]
    page.locator(".quick textarea").fill("What do herons eat?")
    page.locator(".quick textarea").press("Enter")
    waited(page, "document.querySelector('.quick .acts')", "the quick answer")
    page.wait_for_timeout(300)
    shot(page, f"{tag}07-quick")
    page.locator('.quick .acts button[aria-label="Continue in the panel"]').click()
    waited(page, "!document.querySelector('.quick')", "the quick question put away")
    waited(
        page,
        "[...document.querySelectorAll('.ask.wide .said .bubble')].some((one) => one.textContent.includes('What do herons eat?'))",
        "the quick thread in the panel",
    )
    if "Herons fish." not in page.locator(".ask.wide .answer").last.inner_text():
        wrong("the quick answer did not come along into the panel")
    page.wait_for_timeout(300)
    shot(page, f"{tag}08-continued")
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"--- {scheme} ---")
            drive(browser, scheme)
            say(f"--- ChatGPT's shape, {scheme} ---")
            shape(browser, scheme)
        say("--- the whole flow ---")
        flow(browser)
    return DRIVE.verdict(
        "the AI panel is ChatGPT's shape, and sends, stops, queues, steers, switches, lists,"
        " reviews, rewinds and resends"
    )


if __name__ == "__main__":
    raise SystemExit(main())
