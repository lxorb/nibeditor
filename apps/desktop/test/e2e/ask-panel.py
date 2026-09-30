"""The right side: where its panels live, the Ask panel against a provider of our own,
and the Properties panel writing a note's front matter.

What it proves, in order:

- a window opens with the note in front's panels homed on the right and the right
  side shut, its button in the bar; Ctrl+Alt+B opens it on its first panel and shuts
  it again; Ctrl+Shift+O opens the Outline there and puts the keyboard in it, and
  the same key gives the note the keyboard back;
- with no provider the Ask panel says one line and links to Settings > AI, which the
  link opens;
- with the fake provider a question is asked from the field with Enter, streams in,
  and the request carries the note in front and the matching passage of another note
  and nothing of an archived one; a citation opens its note at its passage, and the
  sources row names it; Stop keeps what arrived; Insert puts the answer at the caret
  with the citation written as a wikilink; the pen starts the conversation again;
- the Properties panel draws a note's front matter as rows, and a changed value, a
  ticked box, a chip taken off, a key renamed, a key added and a key removed are each
  one edit of exactly those characters, and Ctrl+Z in the note takes the last back.

A fake OpenAI-compatible server answers, streaming a word at a time. No key, no
network, no bill.

    python apps/desktop/test/e2e/ask-panel.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist. Screenshots go under
`shots/ask-panel/`.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "ask-panel"

PORT = 19973
MODEL_PORT = 19974
ORIGIN = f"http://127.0.0.1:{PORT}"
MODEL_ORIGIN = f"http://127.0.0.1:{MODEL_PORT}"
MODEL = "fake-small"

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERONS = "# Herons\n\nA heron stands still in the shallows for a long time.\n\nThen it strikes.\n"
HOVERING = (
    "# Hovering\n\n"
    + "".join(f"Filler line {one}.\n\n" for one in range(6))
    + "A kestrel hovers facing the wind over the verge.\n"
)
ARCHIVED = "# Old kestrels\n\nThe secret kestrel roost is behind the mill.\n"
CARD = "---\nstatus: draft\ntags: [birds, notes]\ndone: false\n---\n# Card\n\nWords.\n"

SEED = """
async (notes) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  for (const text of notes) await ws.noteFrom(text, root)
  await ws.loadTree()
  const old = ws.notes.find((one) => one.name.startsWith('Old kestrels'))
  await ws.archive.change(root, [old.path.slice(root.length + 1)], [])
  return ws.notes.map((one) => one.name)
}
"""

OPEN = """
async (name) => {
  const ws = window.nibApp.workspace
  const note = ws.notes.find((one) => one.name.startsWith(name))
  await ws.openEntry(note.path, { activate: true })
}
"""

SETUP = """
async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: '%s' })
  ai.setDefault(made.id)
  return ai.ready
}
""" % MODEL

SIDES = """
() => {
  const ws = window.nibApp.workspace
  return { right: [...ws.right], left: ws.panel, open: ws.rightPanel }
}
"""

WHERE = """
() => {
  const at = document.activeElement
  return {
    region: at?.closest('[data-region]')?.dataset.region ?? null,
    panel: at?.closest('[data-panel]')?.dataset.panel ?? null,
    tag: at?.tagName.toLowerCase() ?? null,
  }
}
"""

TEXT = "() => window.nib?.state.doc.toString() ?? ''"

LINE = """
() => {
  const state = window.nib.state
  return state.doc.lineAt(state.selection.main.head).number - 1
}
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.ThreadingTCPServer):
    # A development build asks for hundreds of modules at once; a backlog of five
    # refuses some of them and the app never starts.
    allow_reuse_address = False
    daemon_threads = True
    request_queue_size = 256


class Model(http.server.BaseHTTPRequestHandler):
    """An OpenAI-compatible provider that streams what the drive tells it to."""

    words: list[str] = ["Still."]
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
        for word in Model.words:
            event = {"choices": [{"delta": {"content": word}}]}
            try:
                self.wfile.write(f"data: {json.dumps(event)}\n\n".encode())
                self.wfile.flush()
            except OSError:
                return
            if Model.pause:
                time.sleep(Model.pause)
        try:
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except OSError:
            return


def serve(port: int, handler: object, what: str) -> Strict:
    say(f"serving {what} on http://127.0.0.1:{port}")
    try:
        server = Strict(("127.0.0.1", port), handler)  # type: ignore[arg-type]
    except OSError as error:
        raise SystemExit(f"something is already listening on {port}: {error}") from error
    threading.Thread(target=server.serve_forever, daemon=True).start()
    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)
    raise SystemExit(f"{what} never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 45) -> bool:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return True
        page.wait_for_timeout(50)
    wrong(f"gave up waiting for {what}")
    return False


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def fresh(browser: Browser) -> Page:
    context = browser.new_context(viewport={"width": 1280, "height": 820}, color_scheme="light")
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on(
        "console",
        lambda message: say(f"console: {message.text[:200]}") if message.type == "error" else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace", "a space")
    wait_for(page, "window.nibApp.ai", "the providers")
    say(f"the space holds {page.evaluate(SEED, [HERONS, HOVERING, ARCHIVED, CARD])}")
    page.evaluate(OPEN, "Herons")
    page.wait_for_timeout(500)
    return page


def the_sides(page: Page) -> None:
    sides = page.evaluate(SIDES)
    say(f"the sides as the window opens: {sides}")
    if sides["right"] != ["outline", "links", "properties", "footnotes", "ask"] or sides["open"]:
        wrong(f"the right side does not start homed and shut: {sides}")
    if page.locator("button.toggle.right").count() != 1:
        wrong("the right side's button is not in the bar")

    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.press("Control+Alt+b")
    page.wait_for_timeout(400)
    if page.evaluate(SIDES)["open"] != "outline":
        wrong(f"Ctrl+Alt+B did not open the right side on its first panel: {page.evaluate(SIDES)}")
    shot(page, "01-right-side")
    page.keyboard.press("Control+Alt+b")
    page.wait_for_timeout(400)
    if page.evaluate(SIDES)["open"] is not None:
        wrong("Ctrl+Alt+B did not shut the right side again")

    page.keyboard.press("Control+Shift+O")
    page.wait_for_timeout(500)
    where = page.evaluate(WHERE)
    say(f"Ctrl+Shift+O put the keyboard in {where}")
    if page.evaluate(SIDES)["open"] != "outline" or where["panel"] != "outline":
        wrong(f"Ctrl+Shift+O did not reach the Outline on the right: {where}")
    page.keyboard.press("Control+Shift+O")
    page.wait_for_timeout(300)
    if page.evaluate(WHERE)["region"] != "editor":
        wrong(f"the Outline's key did not give the note the keyboard back: {page.evaluate(WHERE)}")


def nothing_set_up(page: Page) -> None:
    page.evaluate("() => { for (const one of [...window.nibApp.ai.providers]) window.nibApp.ai.remove(one.id) }")
    page.keyboard.press("Control+Shift+A")
    wait_for(page, "document.querySelector('.ask')", "the Ask panel")
    page.wait_for_timeout(300)
    said = page.evaluate("() => document.querySelector('.ask .empty-text')?.textContent?.trim() ?? null")
    say(f"with no provider it says {said!r}")
    shot(page, "02-no-provider")
    if not said or "Settings" not in said:
        wrong(f"the panel does not say where to set a provider up: {said!r}")
    if page.locator(".ask textarea").count():
        wrong("the field is offered with nothing to ask")
    where = page.evaluate(WHERE)
    if where["panel"] != "ask" or where["tag"] != "button":
        wrong(f"the keyboard did not land on the way to Settings: {where}")
    page.locator(".ask .empty-text .link").click()
    page.wait_for_timeout(400)
    opened = page.evaluate("() => [window.nibApp.settings.open, window.nibApp.settings.section]")
    if opened != [True, "ai"]:
        wrong(f"the link did not open Settings > AI: {opened}")
    page.evaluate("() => { window.nibApp.settings.open = false }")
    page.wait_for_timeout(300)


def asked(page: Page) -> None:
    page.evaluate(SETUP, MODEL_ORIGIN)
    page.evaluate(OPEN, "Herons")
    page.wait_for_timeout(300)
    page.evaluate("() => window.nibApp.workspace.closePanel('right')")
    page.wait_for_timeout(300)
    page.evaluate("() => window.nibApp.views.of(window.nibApp.workspace.panes.focusedId)?.focus()")
    page.keyboard.press("Control+Shift+A")
    wait_for(page, "document.querySelector('.ask textarea')", "the field")
    page.wait_for_timeout(300)
    where = page.evaluate(WHERE)
    if where["tag"] != "textarea":
        wrong(f"Ctrl+Shift+A did not put the keyboard in the field: {where}")

    Model.seen.clear()
    Model.words = ["It ", "faces ", "the ", "wind ", "[2]", "."]
    page.locator(".ask textarea").click()
    page.keyboard.type("Which way does a kestrel face?")
    page.keyboard.press("Enter")
    wait_for(page, "document.querySelector('.ask .answer a[href=\"#cite-2\"]')", "a cited answer")
    page.wait_for_timeout(400)
    shot(page, "03-answered")

    sent = json.dumps(Model.seen[-1].get("messages", []) if Model.seen else [])
    if "stands still in the shallows" not in sent:
        wrong("the note in front did not go with the question")
    if "facing the wind" not in sent:
        wrong("the passage of the space that answers it was not sent")
    if "Filler line 0." in sent:
        wrong("the whole of the other note was sent rather than its passage")
    if "secret kestrel roost" in sent:
        wrong("an archived note was sent")
    sources = page.evaluate("() => [...document.querySelectorAll('.ask .source')].map((one) => one.textContent)")
    say(f"the sources row: {sources}")
    if sources != ["Hovering"]:
        wrong(f"the sources row does not name the note cited: {sources}")

    page.locator('.ask .answer a[href="#cite-2"]').click()
    page.wait_for_timeout(700)
    active = page.evaluate("() => window.nibApp.workspace.active?.path ?? ''")
    line = page.evaluate(LINE)
    say(f"the citation opened {active} at line {line}")
    shot(page, "04-citation-opened")
    if not active.endswith("Hovering.md"):
        wrong(f"the citation did not open its note: {active}")
    if line < 6:
        wrong(f"the citation did not land at its passage: line {line}")

    # Stopped half way: what arrived stays, and nothing says it failed.
    Model.words = [f"word{one} " for one in range(40)]
    Model.pause = 0.15
    page.locator(".ask textarea").click()
    page.keyboard.type("And a heron?")
    page.keyboard.press("Enter")
    wait_for(page, "document.querySelectorAll('.ask .answer').length === 2", "the second answer")
    page.wait_for_timeout(600)
    page.locator(".ask .go").click()
    page.wait_for_timeout(500)
    Model.pause = 0
    kept = page.evaluate("() => document.querySelectorAll('.ask .answer')[1]?.textContent ?? ''")
    running = page.evaluate("() => !!document.querySelector('.ask .go[aria-label=\"Stop\"]')")
    say(f"stopped with {len(kept.split())} words kept")
    if "word0" not in kept or "word39" in kept or running:
        wrong(f"Stop did not keep what had arrived and stop: {kept[:80]!r}")
    if page.locator(".ask .wrong").count():
        wrong("stopping was reported as a failure")

    # The first answer, into the note at the caret, its citation a link.
    page.evaluate(OPEN, "Herons")
    page.wait_for_timeout(300)
    page.evaluate(
        "() => { const view = window.nib; view.dispatch({ selection: { anchor: view.state.doc.length } }); view.focus() }"
    )
    page.locator(".ask .answer").first.hover()
    page.locator(".ask .answer").first.locator('.act[aria-label="Insert at the caret"]').click()
    page.wait_for_timeout(300)
    text = page.evaluate(TEXT)
    say(f"the note after Insert ends {text[-40:]!r}")
    if "It faces the wind [[Hovering]]." not in text:
        wrong(f"Insert did not write the answer with its citation as a link: {text[-60:]!r}")

    page.locator(".fresh").click()
    page.wait_for_timeout(300)
    if page.locator(".ask .answer").count():
        wrong("the pen did not start the conversation again")
    shot(page, "05-new-chat")


def properties(page: Page) -> None:
    page.evaluate(OPEN, "Card")
    page.wait_for_timeout(300)
    page.evaluate("() => window.nibApp.workspace.showPanel('properties')")
    wait_for(page, "document.querySelector('.props .prop')", "the property rows")
    page.wait_for_timeout(300)
    keys = page.evaluate("() => [...document.querySelectorAll('.props .prop')].map((one) => one.dataset.key)")
    say(f"the rows: {keys}")
    shot(page, "06-properties")
    if keys != ["status", "tags", "done"]:
        wrong(f"the rows are not the note's front matter: {keys}")

    def expect(text: str, what: str) -> None:
        page.wait_for_timeout(250)
        got = page.evaluate(TEXT)
        if got != text:
            wrong(f"{what}: {got!r}")

    field = page.locator('.prop[data-key="status"] .value input')
    field.fill("final")
    field.press("Enter")
    expect(CARD.replace("draft", "final"), "a value typed into a row")

    page.locator('.prop[data-key="done"] input[type="checkbox"]').check()
    expect(CARD.replace("draft", "final").replace("false", "true"), "a box ticked")

    page.locator('.prop[data-key="tags"] .chip', has_text="notes").hover()
    page.locator('.prop[data-key="tags"] .chip', has_text="notes").locator(".chip-off").click()
    after_chip = CARD.replace("draft", "final").replace("false", "true").replace("[birds, notes]", "[birds]")
    expect(after_chip, "a chip taken off")

    page.locator('.prop[data-key="status"] .key').dblclick()
    page.wait_for_timeout(200)
    page.locator(".prop .rename").fill("state")
    page.locator(".prop .rename").press("Enter")
    renamed = after_chip.replace("status:", "state:")
    expect(renamed, "a key renamed")

    page.locator(".props .adder").click()
    page.locator(".props .new").fill("due")
    page.locator(".props .new").press("Enter")
    page.wait_for_timeout(300)
    added = page.evaluate(TEXT)
    if not re.search(r"\ndue: ?(''|\"\")?\n---\n", added):
        wrong(f"a key added is not the last line of the block: {added!r}")

    page.locator('.prop[data-key="tags"]').click(button="right")
    wait_for(page, "document.querySelector('.rows .nib-row')", "the row's menu")
    page.locator(".rows .nib-row", has_text="Remove").first.click()
    page.wait_for_timeout(300)
    removed = page.evaluate(TEXT)
    if "tags:" in removed or "birds" in removed:
        wrong(f"the row's Remove did not take the key away: {removed!r}")
    shot(page, "07-properties-edited")

    page.evaluate("() => window.nib.focus()")
    page.keyboard.press("Control+z")
    page.wait_for_timeout(300)
    if "tags: [birds]" not in page.evaluate(TEXT):
        wrong(f"Ctrl+Z in the note did not take the removal back: {page.evaluate(TEXT)!r}")


PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)


def on_a_phone(browser: Browser) -> None:
    """The right side as a drawer: its button in the bar, Ask in it, and a citation
    that puts the drawer away to show its passage."""
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        user_agent=PHONE_AGENT,
        has_touch=True,
        is_mobile=True,
        color_scheme="light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[phone] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp && window.nibApp.workspace.activeSpace && window.nibApp.ai", "a space")
    page.evaluate(SEED, [HERONS, HOVERING, ARCHIVED, CARD])
    page.evaluate(SETUP, MODEL_ORIGIN)
    page.evaluate(OPEN, "Herons")
    page.wait_for_timeout(500)

    page.locator("button.toggle.right").first.click(force=True)
    page.wait_for_timeout(600)
    page.evaluate("() => window.nibApp.workspace.showPanel('ask')")
    wait_for(page, "document.querySelector('.ask textarea')", "[phone] the field")
    Model.words = ["It ", "faces ", "the ", "wind ", "[2]", "."]
    page.locator(".ask textarea").fill("Which way does a kestrel face?")
    page.locator(".ask .go").click()
    wait_for(page, "document.querySelector('.ask .answer a[href=\"#cite-2\"]')", "[phone] a cited answer")
    page.wait_for_timeout(400)
    shot(page, "08-phone-answered")

    page.locator('.ask .answer a[href="#cite-2"]').click()
    page.wait_for_timeout(900)
    after = page.evaluate(SIDES)
    active = page.evaluate("() => window.nibApp.workspace.active?.path ?? ''")
    shot(page, "09-phone-passage")
    if after["open"] is not None or not active.endswith("Hovering.md"):
        wrong(f"[phone] the citation did not put the drawer away on its note: {after}, {active}")
    context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    files = serve(PORT, functools.partial(Quiet, directory=str(DIST)), DIST.name)
    model = serve(MODEL_PORT, Model, "a fake OpenAI-compatible provider")

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                page = fresh(browser)
                say("--- the sides ---")
                the_sides(page)
                say("--- nothing set up ---")
                nothing_set_up(page)
                say("--- asked ---")
                asked(page)
                say("--- properties ---")
                properties(page)
                say("--- on a phone ---")
                on_a_phone(browser)
            finally:
                browser.close()
    finally:
        for server in (files, model):
            server.shutdown()
            server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe right side opens where it should; Ask cites and opens; Properties writes", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
