"""The AI panel's modes in the packaged app, against a provider of our own. Windows only.

docs/ai-sidebar.md 4.4: Agent never stops to ask, and Approve asks before every change.
What only the real crate can answer - the built-in grant, the policy, the questions it
raises and the window's verbs that move and delete files - is driven here, with a fake
OpenAI-compatible server that answers each message with the tool calls the step wants
and then a word. No key, no network, no bill.

* **Agent deletes and renames without a prompt.** One message, two calls: a note to
  Recently deleted and another renamed. Both happen on the disk, and no question is ever
  drawn in the thread.
* **Undo restores.** The changes bar lists both; its Undo brings the deleted note back
  and the renamed one back under its name.
* **Approve shows the inline approval.** A delete waits in its row, with Approve, Deny
  and Always, the note still on the disk; Approve and it goes.
* **Deny tells the model no.** A rename denied leaves the note where it is, and the
  model's next request carries the refusal.

The words are put in the field and Enter said through the page's own script over the
DevTools protocol, which presses nothing and brings nothing forward; see devtools.py.

    npx vite build --mode drive                     # in apps/desktop
    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.aimodes","version":"99.0.0",
                 "build":{"beforeBuildCommand":""},
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/ai-modes-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe

This wipes the probe identifier's settings folder and webview profile at the start of
every run. Screenshots go to `--shots` when given.
"""

from __future__ import annotations

import argparse
import base64
import http.server
import json
import os
import pathlib
import shutil
import sys
import threading
import time

from devtools import SWITCHES, Session, port, targets
from probe_app import close_app, run_probe, spaces_folder

IDENTIFIER = "ch.emilvinu.nib.probe.aimodes"

failures: list[str] = []

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    print(f"  WRONG: {words}", flush=True)


class Model(http.server.BaseHTTPRequestHandler):
    """An OpenAI-compatible provider: each message is answered with the next calls on
    `calls`, and the answer to those calls with one word."""

    calls: list[list[tuple[str, dict]]] = []
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
        body = json.dumps({"data": [{"id": "fake", "context_length": 100000}]}).encode()
        self.send_response(200)
        self._cors()
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(body)

    def _event(self, said: dict) -> None:
        self.wfile.write(f"data: {json.dumps(said)}\n\n".encode())
        self.wfile.flush()

    def do_POST(self) -> None:  # noqa: N802
        asked = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))) or b"{}")
        Model.seen.append(asked)
        messages = asked.get("messages", [])
        answered = bool(messages) and messages[-1].get("role") == "tool"
        self.send_response(200)
        self._cors()
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        if answered or not Model.calls:
            self._event({"model": "fake", "choices": [{"delta": {"content": "Done."}}]})
            self._event({"model": "fake", "choices": [{"delta": {}, "finish_reason": "stop"}]})
        else:
            for at, (name, args) in enumerate(Model.calls.pop(0)):
                call = {
                    "index": at,
                    "id": f"call_{len(Model.seen)}_{at}",
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(args)},
                }
                self._event({"model": "fake", "choices": [{"delta": {"tool_calls": [call]}}]})
            self._event({"model": "fake", "choices": [{"delta": {}, "finish_reason": "tool_calls"}]})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def serve() -> tuple[http.server.ThreadingHTTPServer, str]:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Model)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://localhost:{server.server_address[1]}"


def wiped(identifier: str) -> None:
    """The probe's settings and webview profile, gone: a grant from an earlier run is not
    this run's. Refused for a name that is not a probe's."""

    if ".probe." not in identifier:
        raise SystemExit(f"{identifier} is not a probe's identifier")
    for base in (os.environ["APPDATA"], os.environ["LOCALAPPDATA"]):
        shutil.rmtree(pathlib.Path(base) / identifier, ignore_errors=True)


def until(test, what: str, seconds: float = 60.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        found = test()
        if found:
            return found
        time.sleep(0.25)
    wrong(f"gave up waiting for {what}")
    return None


def main_page() -> Session | None:
    web = pathlib.Path(os.environ["LOCALAPPDATA"]) / IDENTIFIER / "EBWebView"

    def found():
        if not port(web):
            return None
        return next(
            (
                one
                for one in targets(port(web))
                if one.get("type") == "page" and "tauri.localhost" in str(one.get("url", ""))
            ),
            None,
        )

    page = until(found, "the app's page")
    return Session(page) if page else None


SETUP = """
(async (base) => {
  const ai = window.nibApp.ai
  for (const one of [...ai.providers]) ai.remove(one.id)
  const made = ai.add('compatible')
  ai.update(made.id, { name: 'Fake', baseUrl: base, model: 'fake' })
  ai.setDefault(made.id)
  window.nibApp.workspace.showPanel('ask')
  // Whether a question was ever drawn in the thread, however briefly.
  window.__asked = 0
  new MutationObserver(() => {
    if (document.querySelector('.approval')) window.__asked++
  }).observe(document.body, { childList: true, subtree: true })
  return made.id
})(%s)
"""

FIELD = "document.querySelector('.ask textarea')"


def key(page: Session, name: str, shift: bool = False) -> None:
    page.value(
        f"{FIELD}.dispatchEvent(new KeyboardEvent('keydown', "
        f"{{ key: {json.dumps(name)}, shiftKey: {json.dumps(shift)}, bubbles: true, cancelable: true }}))"
    )


def mode(page: Session) -> str:
    return str(page.value("document.querySelector('.ask .mode')?.textContent?.trim() ?? ''"))


def to_mode(page: Session, wanted: str) -> None:
    for _ in range(4):
        if mode(page) == wanted:
            return
        key(page, "Tab", shift=True)
        time.sleep(0.2)
    if mode(page) != wanted:
        wrong(f"Shift+Tab never reached {wanted}: the chip says {mode(page)!r}")


def send(page: Session, words: str) -> None:
    page.value(
        f"(() => {{ const f = {FIELD}; f.value = {json.dumps(words)}; "
        "f.dispatchEvent(new Event('input', { bubbles: true })) })()"
    )
    time.sleep(0.2)
    key(page, "Enter")


def running(page: Session) -> bool:
    return bool(page.value("!!document.querySelector('.ask .go[aria-label=\"Stop\"]')"))


def shot(page: Session, folder: pathlib.Path | None, name: str) -> None:
    if folder is None:
        return
    said = page.call("Page.captureScreenshot", {"format": "png"})
    data = said.get("data")
    if data:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{name}.png").write_bytes(base64.b64decode(data))


def agent_acts_and_undo_restores(page: Session, space: pathlib.Path, shots: pathlib.Path | None) -> None:
    print("Agent: a delete and a rename, nothing asked, and Undo", flush=True)
    to_mode(page, "Agent")
    Model.calls = [
        [
            ("trash_file", {"path": "Herons.md"}),
            ("move_file", {"path": "Plan.md", "to": "Roadmap.md"}),
        ]
    ]
    send(page, "Tidy up")
    until(lambda: not (space / "Herons.md").exists(), "Herons.md to go")
    until(lambda: (space / "Roadmap.md").exists(), "Plan.md renamed Roadmap.md")
    until(lambda: not running(page) and len(Model.seen) >= 2, "the answer to end")
    if page.value("window.__asked"):
        wrong("Agent mode drew a question in the thread")
    else:
        say("deleted and renamed, and no question was drawn")
    bar = until(lambda: page.value("!!document.querySelector('.bar')"), "the changes bar")
    shot(page, shots, "agent-changes")
    if bar:
        page.value("document.querySelector('.bar .what').click()")
        listed = until(
            lambda: page.value("document.querySelectorAll('.changes .line').length >= 2"),
            "the moved and the deleted note listed",
            10,
        )
        shot(page, shots, "agent-listed")
        if listed:
            say("the changes list holds the rename and the delete")
        page.value(
            "[...document.querySelectorAll('.bar .nib-chip')].find((one) => one.textContent.trim() === 'Undo').click()"
        )
    back = until(
        lambda: (space / "Herons.md").exists()
        and (space / "Plan.md").exists()
        and not (space / "Roadmap.md").exists(),
        "Undo to bring Herons.md back and Plan.md back under its name",
        20,
    )
    if back:
        say("Undo brought the deleted note back and put the name back")


def approve_asks_inline(page: Session, space: pathlib.Path, shots: pathlib.Path | None) -> None:
    print("Approve: the delete waits in its row", flush=True)
    to_mode(page, "Approve")
    page.value("window.__asked = 0")
    Model.calls = [[("trash_file", {"path": "Gulls.md"})]]
    before = len(Model.seen)
    send(page, "Delete the gulls")
    asked = until(lambda: page.value("!!document.querySelector('.approval')"), "the question in the row")
    if not asked:
        return
    answers = page.value("[...document.querySelectorAll('.approval button')].map((one) => one.textContent.trim())")
    say(f"the row asks with {answers}")
    if answers != ["Approve", "Deny", "Always"]:
        wrong(f"the question's answers are {answers!r}")
    time.sleep(1)
    if not (space / "Gulls.md").exists():
        wrong("the note went before anybody approved")
    if len(Model.seen) != before + 1:
        wrong("the model was answered before the reader")
    shot(page, shots, "approve-asking")
    page.value("document.querySelector('.approval button').click()")
    if until(lambda: not (space / "Gulls.md").exists(), "Gulls.md to go once approved", 20):
        say("approved, and it went")
    until(lambda: not running(page) and len(Model.seen) >= before + 2, "the answer to end")

    print("Approve: a rename denied", flush=True)
    Model.calls = [[("move_file", {"path": "Herons.md", "to": "Egrets.md"})]]
    before = len(Model.seen)
    send(page, "Rename the herons")
    if not until(lambda: page.value("!!document.querySelector('.approval')"), "the second question"):
        shot(page, shots, "deny-missing")
        roles = [one.get("role") for one in Model.seen[-1].get("messages", [])] if Model.seen else []
        say(f"{len(Model.seen) - before} requests since; the last ends {roles[-3:]}")
        say(json.dumps(Model.seen[-1].get("messages", [])[-2:])[:600] if Model.seen else '')
        return
    page.value("document.querySelectorAll('.approval button')[1].click()")
    until(lambda: not running(page) and len(Model.seen) >= before + 2, "the answer to end")
    if (space / "Egrets.md").exists() or not (space / "Herons.md").exists():
        wrong("a denied rename happened")
    told = json.dumps(Model.seen[-1].get("messages", [])[-1:])
    if "said no" not in told:
        wrong(f"the model was not told no: {told}")
    else:
        say("denied: the note stayed, and the model was told no")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--shots", type=pathlib.Path)
    given = parser.parse_args()

    wiped(IDENTIFIER)
    spaces = spaces_folder("ai-modes")
    space = spaces / "Probe"
    space.mkdir()
    for name, words in {
        "Herons.md": "# Herons\n\nA heron stands still.\n",
        "Plan.md": "# Plan\n\n- [ ] Birds\n",
        "Gulls.md": "# Gulls\n\nLoud.\n",
    }.items():
        (space / name).write_text(words, encoding="utf-8")

    server, origin = serve()
    env = {**os.environ, "NIB_SPACES_DIR": str(spaces), "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": SWITCHES}
    app = run_probe(given.exe, env=env, quiet=True)
    try:
        page = main_page()
        if page is None:
            return 1
        until(
            lambda: page.value("!!window.nibApp?.ai && !!window.nibApp.workspace.activeSpace"),
            "the space and the AI store",
        )
        page.value(SETUP % json.dumps(origin))
        until(lambda: page.value(f"!!{FIELD}"), "the AI panel's field")
        if mode(page) != "Approve":
            wrong(f"a first thread starts in {mode(page)!r}, not Approve")
        agent_acts_and_undo_restores(page, space, given.shots)
        approve_asks_inline(page, space, given.shots)
        page.close()
    finally:
        if not close_app(app):
            # Ours, by its handle: never anything by name.
            app.kill()
        server.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    print("FAILED" if failures else "OK", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
