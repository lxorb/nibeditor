"""A `nib://` link, followed: a note opened by path, a heading landed on, a note
made with words in it, one appended to, a search opened on its query, and the three
things a link is not allowed to do refused.

Drives the browser build, which is the one place the whole router can be exercised
without an installer: a browser hands `web+nib://` back as `?nib=`, and that is the
same string the crate hands over on a desktop. See docs/automation.md.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be a development one or `window.nib` and `window.nibApp` are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/automation.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/automation/`.
"""

from __future__ import annotations

import functools
import http.server
import json
import os
import shutil
import socket
import socketserver
import subprocess
import threading
import time
from pathlib import Path
from urllib.parse import quote

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "automation"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 23303
ORIGIN = f"http://127.0.0.1:{PORT}"

PLAN = """# The plan

A first paragraph.

## Later

What happens later.
"""

OTHER = "# Other\n\nA second note, which nothing links to.\n"

SEED = """
async ([plan, other]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(plan, root)
  await ws.noteFrom(other, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

# What the app is showing, and whatever it had to say about a link.
#
# The caret comes off the editor rather than off `workspace.goto`, which is the ask
# rather than the answer: the window takes the ask down as soon as it has jumped, so
# a moment later there is nothing there to read. Where the caret ended up is the
# thing that was being asked about anyway.
STATE = """
() => {
  const caretLine = () => {
    const view = window.nib
    if (!view) return null
    return view.state.doc.lineAt(view.state.selection.main.head).number - 1
  }

  const ws = window.nibApp.workspace
  return {
    active: ws.active?.name ?? null,
    text: ws.active?.doc ?? null,
    caret: caretLine(),
    panel: ws.panel,
    tabs: ws.tabs.length,
    names: ws.notes.map((one) => one.name),
    trouble: window.nibApp.busy.trouble,
    query: window.nibApp.search.text,
    hits: window.nibApp.search.hits.length,
    address: window.location.search,
  }
}
"""

failures: list[str] = []

# What the browser says about the app's policy rather than about the app. The policy
# is delivered as a `<meta>` in the page because the web app has no server of ours
# to set a header, and `frame-ancestors` is meaningless there and deliberately left
# in for the header the installed app is served with. Chrome logs that at error
# level on every load; see apps/desktop/src/csp.ts.
EXPECTED = ["'frame-ancestors' is ignored when delivered via a <meta> element"]


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def heard(kind: str, text: str) -> None:
    """A line the page wrote. Anything the browser calls an error is a failure,
    except what it says about the policy rather than about the app."""
    if kind != "error":
        return
    if any(one in text for one in EXPECTED):
        return

    wrong(f"console error: {text}")


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address, so a run cannot photograph the last one."""

    allow_reuse_address = False


def serve() -> Strict:
    say(f"serving {DIST.name} on {ORIGIN}")
    handler = functools.partial(Quiet, directory=str(DIST))
    try:
        server = Strict(("127.0.0.1", PORT), handler)
    except OSError as error:
        raise SystemExit(f"something is already listening on {ORIGIN}: {error}") from error

    threading.Thread(target=server.serve_forever, daemon=True).start()

    until = time.monotonic() + 20
    while time.monotonic() < until:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                return server
        except OSError:
            time.sleep(0.2)

    raise SystemExit("the file server never answered")


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> None:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        if page.evaluate(f"() => !!({expression})"):
            return
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def shot(page: Page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))
    say(f"shot {name}.png")


def ready(page: Page, label: str) -> None:
    wait_for(page, "window.nibApp", f"[{label}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")


def fresh(browser: Browser) -> Page:
    """A context with two notes in it. Every link below is followed by reloading
    this same context with `?nib=`, which is exactly what a browser does when it
    hands a `web+nib://` link back to the page that registered it."""
    context = browser.new_context(
        viewport={"width": 1280, "height": 820},
        color_scheme="light",
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"page error: {error}"))
    page.on("console", lambda message: heard(message.type, message.text))

    page.goto(ORIGIN, wait_until="domcontentloaded")
    ready(page, "seed")
    say(f"the space holds {page.evaluate(SEED, [PLAN, OTHER])}")
    page.wait_for_timeout(300)
    return page


def follow(page: Page, uri: str, label: str) -> dict:
    """Opens the app with one link in the address, the way the protocol handler
    does, and answers what the app is showing once it has settled."""
    page.goto(f"{ORIGIN}/?nib={quote(uri, safe='')}", wait_until="domcontentloaded")
    ready(page, label)
    page.wait_for_timeout(900)
    return page.evaluate(STATE)


def drive_opening(page: Page) -> None:
    state = follow(page, "nib://open?path=The plan.md", "open")
    say(f"[open] {json.dumps({k: state[k] for k in ('active', 'address')})}")
    shot(page, "01-opened")

    if state["active"] != "The plan.md":
        wrong(f"a link to a note did not open it: {state['active']}")
    # The link comes off the address, so a reload does not follow it again.
    if "nib=" in state["address"]:
        wrong(f"the link is still in the address: {state['address']!r}")
    if state["trouble"]:
        wrong(f"a link that worked said something went wrong: {state['trouble']!r}")


def drive_heading(page: Page) -> None:
    state = follow(page, "nib://open?path=The plan.md&heading=Later", "heading")
    say(f"[heading] the caret is on line {state['caret']}")
    shot(page, "02-heading")

    if state["active"] != "The plan.md":
        wrong(f"the note did not open: {state['active']}")
    # `## Later` is the fifth line of the note, counting from zero.
    if state["caret"] != 4:
        wrong(f"the link did not land on the heading: line {state['caret']}")


def drive_making(page: Page) -> None:
    made = follow(page, "nib://new?name=From a link&content=# From a link%0A%0AWords.", "new")
    say(f"[new] {json.dumps({k: made[k] for k in ('active', 'names')})}")
    shot(page, "03-made")

    if made["active"] != "From a link.md":
        wrong(f"a link did not make the note: {made['active']}")
    if "Words." not in (made["text"] or ""):
        wrong(f"the words the link carried are not in the note: {made['text']!r}")

    added = follow(
        page,
        "nib://new?path=From a link.md&content=More words.&append",
        "append",
    )
    shot(page, "04-appended")

    if (added["text"] or "").count("From a link") != 1:
        wrong("appending wrote a second note instead of adding to the one that is there")
    if "More words." not in (added["text"] or ""):
        wrong(f"appending did not add the words: {added['text']!r}")
    if "Words." not in (added["text"] or ""):
        wrong(f"appending lost what the note already said: {added['text']!r}")


def drive_appending(page: Page) -> None:
    """`nib://append`, which is what a shortcut filing a line into today's note asks for.

    Two roads and both of them matter: the note that is there is added to, and the note
    that is not is made. A caller with a link in a watch face has no way of knowing
    which of the two it is, which is the whole reason the action exists.
    """
    added = follow(
        page,
        "nib://append?path=From a link.md&content=A line from a link.",
        "append",
    )
    shot(page, "04b-appended-by-its-own-action")

    if added["active"] != "From a link.md":
        wrong(f"appending did not open the note it added to: {added['active']}")
    if (added["text"] or "").count("From a link") != 1:
        wrong("appending wrote a second note instead of adding to the one that is there")
    if "A line from a link." not in (added["text"] or ""):
        wrong(f"appending did not add the words: {added['text']!r}")
    if "Words." not in (added["text"] or ""):
        wrong(f"appending lost what the note already said: {added['text']!r}")
    if added["trouble"]:
        wrong(f"appending said something went wrong: {added['trouble']!r}")

    # And the note that is not there yet, which is the day's note on the first morning
    # somebody uses the link.
    fresh_note = follow(
        page,
        "nib://append?path=inbox/Not there yet.md&content=The first line.",
        "append-new",
    )
    shot(page, "04c-appended-into-a-new-note")

    if fresh_note["active"] != "Not there yet.md":
        wrong(f"appending did not make the note: {fresh_note['active']}")
    if "The first line." not in (fresh_note["text"] or ""):
        wrong(f"the made note is missing the words: {fresh_note['text']!r}")


def drive_searching(page: Page) -> None:
    state = follow(page, "nib://search?query=happens", "search")
    say(f"[search] panel {state['panel']}, {state['hits']} hits for {state['query']!r}")
    shot(page, "05-searched")

    if state["panel"] != "search":
        wrong(f"a search link did not open the search panel: {state['panel']}")
    if state["query"] != "happens":
        wrong(f"the panel is not asking what the link asked: {state['query']!r}")
    if state["hits"] < 1:
        wrong("the search found nothing in a space that says the word")


def drive_refusals(page: Page) -> None:
    """The three noes: a path that leaves the space, a verb a link may not ask for,
    and an address that is not ours at all. Each has to say so rather than doing
    nothing, and none of them may touch a note."""
    before = page.evaluate("() => window.nibApp.workspace.notes.length")

    outside = follow(page, "nib://open?path=../../secrets.md", "outside")
    shot(page, "06-refused-path")
    if not outside["trouble"]:
        wrong("a link pointing out of the space said nothing at all")
    if outside["active"] == "secrets.md":
        wrong("a link pointing out of the space opened something")

    declined = follow(page, "nib://files.delete?path=Other.md&yes=true", "declined")
    shot(page, "07-declined")
    if not declined["trouble"]:
        wrong("a link asking to delete a note said nothing at all")
    if "Other.md" not in declined["names"]:
        wrong("a link deleted a note, which no link may do")

    written = follow(page, "nib://files.write?path=Other.md&content=gone&yes=true", "write")
    if "A second note" not in (page.evaluate(READ_OTHER) or ""):
        wrong("a link wrote over a note, which no link may do")
    if not written["trouble"]:
        wrong("a link asking to write over a note said nothing at all")

    # And a note that is already there is not written over by `new` either.
    again = follow(page, "nib://new?path=Other.md&content=gone", "again")
    if "A second note" not in (page.evaluate(READ_OTHER) or ""):
        wrong("`new` wrote over a note that was already there")
    if not again["trouble"]:
        wrong("`new` on a note that exists said nothing at all")

    after = page.evaluate("() => window.nibApp.workspace.notes.length")
    if after != before:
        wrong(f"the refusals changed how many notes there are: {before} became {after}")

    say(f"[refusals] {after} notes, untouched")


READ_OTHER = """
async () => {
  const ws = window.nibApp.workspace
  const found = ws.notes.find((one) => one.name === 'Other.md')
  return found ? await ws.noteText(found.path) : null
}
"""


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                page = fresh(browser)
                say("--- a link that opens a note ---")
                drive_opening(page)
                say("--- a link that lands on a heading ---")
                drive_heading(page)
                say("--- a link that makes a note, and one that adds to it ---")
                drive_making(page)
                say("--- a link that adds to a note ---")
                drive_appending(page)
                say("--- a link that searches ---")
                drive_searching(page)
                say("--- what a link may not do ---")
                drive_refusals(page)
                page.context.close()
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\na nib:// link opens, makes, appends and searches, and is refused where it should be")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
