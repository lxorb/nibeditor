"""Renaming a space while one of its notes is open in a room, against the real Worker.

A space rename rewrites the path of every open note and keeps every id: the same
files, in a folder with another name. Nothing about the note the account holds
changes, and nothing about the room it is in changes either - so the one thing that
must not happen is the note going quiet.

It used to. The pairing of documents to rooms handed each room a question - is this
document still on the file the room was joined for? - and the question compared the
note's path. A rename made it answer no, for ever, so the binding refused every
change in both directions while the room went on telling the file sync that it held
the file. The note was mute on the room and mute on the sync at once, with the light
in the corner saying everything was fine, until the tab was closed and opened again.

Everything here is the real thing: the built web app, the Worker under `wrangler dev`
on workerd, a Durable Object holding the room, and two browser contexts with their own
storage that know nothing about each other. One of them renames the space. What is
asserted is that words still cross, both ways, and that they still reach the account.

Worth knowing what this does and does not catch. A rename is two halves - the folder
moves, and the mirror is re-keyed onto its new root - and between them the mirror does
not know the new path, so the pairing lets the room go and joins another one a moment
later. This run watches that happen: the renaming browser opens a second room socket.
So what it guards is the whole path including that rebuild, and the words typed across
it; the predicate itself is pinned by the unit tests in src/lib/rooms/following.test.ts,
where a path change reaches the pairing without the room being dropped in between -
which is the state a batched effect arrives at, and the state the predicate was wrong
about.

The last scene is the other half of the same mistake and does fail without its fix: a
session that says a canvas is a note. The app writes its own session down, the one
field is set back to what an older entry would have said, and the reload has to reach
the same answer from the file's name alone.

Run it from the repository root:

    python apps/desktop/test/e2e/space-rename.py

It builds the app, applies the migrations, starts the Worker, runs the browsers and
stops everything again. Nothing it makes outlives it but the screenshots, which go
beside it under `shots/`.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from playwright.sync_api import Browser, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
SERVICE = ROOT / "services" / "sync"
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots"

# A port of this test's own, well clear of the dev server's 1420.
PORT = 18871
ORIGIN = f"http://127.0.0.1:{PORT}"

EMAIL = "renamer@example.com"
SPACE = "Notes"
RENAMED = "Renamed"
NOTE = "together.md"
CANVAS = "Board.canvas"
OPENING = "# Together\n\nthe first line\n"

# How long anything is waited for before the test gives up and says what it saw.
PATIENCE = 40

# Every room socket each browser has opened, by label; see `signed_in`.
sockets: dict[str, list[str]] = {}


def npx(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    """A command from the repository's own node_modules."""
    executable = shutil.which("npx") or shutil.which("npx.cmd")
    if not executable:
        raise SystemExit("npx is not on the path")

    return subprocess.run(
        [executable, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def request(
    path: str, token: str | None = None, body: dict | None = None, method: str | None = None
):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(
        f"{ORIGIN}{path}",
        data=data,
        headers=headers,
        method=method or ("GET" if data is None else "POST"),
    )
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")


class Worker:
    """The Worker under wrangler dev, and the local database behind it."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        # Its output goes to a file rather than to a pipe. A pipe nobody reads fills
        # up, and a Worker whose output has nowhere to go stops answering.
        self.log = SHOTS.parent / "space-rename-worker.log"
        self.opened = None

    def build(self) -> None:
        say("building the web app against the local Worker")
        # `vite build` is a production build whatever mode it is given unless the
        # environment says otherwise, and a production build is the one with the
        # app's stores hidden. Both are set, so the built page keeps them.
        environment = {**os.environ, "VITE_NIB_API": ORIGIN, "NODE_ENV": "development"}
        built = subprocess.run(
            [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
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

    def clean(self) -> None:
        state = SERVICE / ".wrangler" / "state"
        if state.exists():
            say("clearing what the last run left")
            shutil.rmtree(state, ignore_errors=True)

    def migrate(self) -> None:
        say("applying the migrations to the local database")
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local", cwd=SERVICE)
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")

    def sql(self, statement: str) -> None:
        done = npx(
            "wrangler", "d1", "execute", "nib", "--local", f"--command={statement}", cwd=SERVICE
        )
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

    def start(self) -> None:
        say(f"starting the Worker on {ORIGIN}")
        self.log.parent.mkdir(parents=True, exist_ok=True)
        self.opened = self.log.open("wb")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                "--port",
                str(PORT),
                "--ip",
                "127.0.0.1",
                "--show-interactive-dev-session=false",
            ],
            cwd=SERVICE,
            stdout=self.opened,
            stderr=subprocess.STDOUT,
        )

        until = time.monotonic() + 90
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit(f"the Worker stopped before it answered:\n{self.said()}")
            try:
                if request("/health").get("ok"):
                    say("the Worker is answering")
                    return
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        """The last of what the Worker printed, for a failure to be read beside."""
        if self.opened:
            self.opened.flush()
        if not self.log.exists():
            return "(nothing)"

        return "\n".join(self.log.read_text("utf-8", errors="replace").splitlines()[-40:])

    def stop(self) -> None:
        if not self.process:
            return

        say("stopping the Worker")
        # The whole tree. `wrangler dev` is a wrapper around the runtime itself, and
        # stopping only the wrapper leaves the runtime holding the port.
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(self.process.pid)],
                capture_output=True,
                check=False,
            )
        else:
            self.process.terminate()

        try:
            self.process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            self.process.kill()

        self.process = None
        if self.opened:
            self.opened.close()
            self.opened = None

    def account(self) -> str:
        """An account with a live session, put straight into the database. Signing in
        needs an emailed code, and what is under test is not the sign-in."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, created_at) values ('{user}', '{EMAIL}', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )

        return token


def say(words_said: str) -> None:
    print(f"  {words_said}", flush=True)


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def signed_in(browser: Browser, token: str, label: str) -> Page:
    """A browser context with the session in its storage, on the app."""
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    # Every socket this page opens to a room. How many there have been says whether
    # a room was kept across something or thrown away and joined again, which is the
    # one thing about all of this that cannot be read off the words.
    sockets[label] = []
    page.on("websocket", lambda ws: sockets[label].append(ws.url))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    return page


def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")


def opened(page: Page, label: str, note_id: str) -> None:
    """Waits for the space and the note to come down, opens it, and waits for it to
    be in its room."""
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space to arrive",
    )

    listed = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        "  return walk(window.nibApp.workspace.tree)"
        f"    .includes('/{SPACE}/{NOTE}')"
        "}"
    )
    wait_for(page, listed, f"[{label}] the note to arrive")

    page.evaluate(f"() => window.nibApp.workspace.open('/{SPACE}/{NOTE}')")
    wait_for(page, "() => !!document.querySelector('.cm-content')", f"[{label}] the editor")
    wait_for(
        page,
        f"() => window.nibApp.rooms.joined.has({json.dumps(note_id)})",
        f"[{label}] the note to join its room",
    )


def words(page: Page) -> str:
    return page.evaluate(
        "() => { window.nibApp.workspace.flush();"
        " return window.nibApp.workspace.active?.doc ?? '' }"
    )


def type_at(page: Page, at: int, said: str) -> None:
    """Types into the real editor, at a place in the note. Real keystrokes: the caret
    is put where the words should go and the keyboard does the rest."""
    page.click(".cm-content")
    page.evaluate(
        "(at) => {"
        "  window.nib.dispatch({ selection: { anchor: Math.min(at, window.nib.state.doc.length) } });"
        "  window.nib.focus()"
        "}",
        at,
    )
    page.keyboard.type(said, delay=12)


def crosses(one: Page, two: Page, said: str, label: str) -> None:
    """Words typed in one browser, and the wait for them to show up in the other."""
    type_at(one, len(words(one)), said)

    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        if said.strip() in words(two):
            say(f"{label}: arrived")
            return
        two.wait_for_timeout(25)

    raise SystemExit(
        f"{label}: never arrived."
        f"\n  the one who typed holds {words(one)!r} and {state(one)}"
        f"\n  the one waiting holds {words(two)!r} and {state(two)}"
    )


def state(page: Page) -> str:
    """What the page says about the room it is in, for a failure to be read beside."""
    return page.evaluate(
        "() => {"
        "  const rooms = window.nibApp.rooms;"
        "  return `path ${window.nibApp.workspace.active?.path ?? '-'},"
        " joined [${[...rooms.joined].join(' ')}], present ${JSON.stringify(rooms.present)}`"
        "}"
    )


def reaches_the_account(token: str, note_id: str, said: str) -> None:
    """And the words reach the account, which is the other half of what went quiet:
    the room settles the note into the store a moment after the typing stops."""
    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        held = request(f"/v1/notes/{note_id}", token).get("content") or ""
        if said.strip() in held:
            say("the account has them too")
            return
        time.sleep(0.5)

    held = request(f"/v1/notes/{note_id}", token).get("content") or ""
    raise SystemExit(f"the account never got them. it holds {held!r}")


def restores_a_canvas(browser: Browser, token: str, failures: list[str]) -> None:
    """A session written down and read back, with the one field that used to decide
    everything taken out of it.

    What a tab holds is the file's, not the entry's. An entry written before there
    were canvases, one whose kind was lost, or one naming a kind this version has
    never heard of came back as a note whatever it was called - and a note's tab over
    a canvas file joins the room of a file the service is serving as a plane, which is
    the two ends of one file building different documents for it.

    So the app writes its own session here, and then the one field is set back to what
    an older one would have said. The reload has to reach the same answer from the
    name alone.
    """
    page = signed_in(browser, token, "restored")

    # A browser that has never seen this account makes a space of its own to start in,
    # so the one the account sent down has to be brought up before its files are what
    # the tree shows.
    wait_for(
        page,
        "() => window.nibApp.workspace.spaces.some("
        f"  (one) => one.name === {json.dumps(RENAMED)})",
        "[restored] the account’s space to arrive",
    )
    page.evaluate(
        "async () => {"
        "  const workspace = window.nibApp.workspace;"
        f"  const space = workspace.spaces.find((one) => one.name === {json.dumps(RENAMED)});"
        "  await workspace.showSpace(space.id)"
        "}"
    )

    # Whatever the space is called by the time this browser downloads it, and wherever
    # it puts it: the path is read off the tree rather than guessed at.
    looking = (
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        f"  return walk(window.nibApp.workspace.tree).find((path) => path.endsWith('/{CANVAS}')) ?? ''"
        "}"
    )

    until = time.monotonic() + PATIENCE
    board = ""
    while time.monotonic() < until:
        board = page.evaluate(looking)
        if board:
            break
        page.wait_for_timeout(100)

    if not board:
        seen = page.evaluate(
            "() => {"
            "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
            "  return JSON.stringify({"
            "    spaces: window.nibApp.workspace.spaces.map((one) => one.root),"
            "    active: window.nibApp.workspace.activeSpaceId,"
            "    tree: walk(window.nibApp.workspace.tree)"
            "  })"
            "}"
        )
        failures.append(f"the canvas never came down to a fresh browser: {seen}")
        return

    say(f"[restored] the canvas came down as {board}")

    # `openEntry` is what a row in the file list opens with, and the one that routes a
    # name to the kind of tab it wants; `open` is the note opener underneath it.
    page.evaluate(f"async () => {{ await window.nibApp.workspace.openEntry({json.dumps(board)}) }}")
    wait_for(
        page,
        f"() => window.nibApp.workspace.active?.path === {json.dumps(board)}"
        " && window.nibApp.workspace.active?.kind === 'canvas'",
        "[restored] the canvas to open as one",
    )

    # The session is written a moment after anything changes, so it is waited for
    # rather than asked for.
    wait_for(
        page,
        "() => (localStorage.getItem('nib:workspace') ?? '').includes"
        f"({json.dumps(CANVAS)})",
        "[restored] the session to be written down",
    )

    # And now it says what an older one would have said. Everything with a path and a
    # kind, wherever the shape keeps it, so this does not depend on which field of the
    # session the tab was written into.
    page.evaluate(
        "() => {"
        "  const held = JSON.parse(localStorage.getItem('nib:workspace'));"
        "  const walk = (value) => {"
        "    if (Array.isArray(value)) { value.forEach(walk); return }"
        "    if (!value || typeof value !== 'object') return;"
        "    if (typeof value.path === 'string' && value.path.endsWith('.canvas') && value.kind) {"
        "      value.kind = 'note'"
        "    }"
        "    Object.values(value).forEach(walk)"
        "  };"
        "  walk(held);"
        "  localStorage.setItem('nib:workspace', JSON.stringify(held))"
        "}"
    )

    page.reload(wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp", "[restored] the app to start again")
    wait_for(
        page,
        f"() => !!window.nibApp.workspace.documents.find((one) => one.path === {json.dumps(board)})",
        "[restored] the canvas tab to come back",
    )

    kind = page.evaluate(
        "() => window.nibApp.workspace.documents.find("
        f"  (one) => one.path === {json.dumps(board)}).kind"
    )
    if kind != "canvas":
        failures.append(f"a canvas came back from the session as {kind!r}")
    else:
        say("a canvas whose entry said otherwise still comes back as a canvas")

    page.screenshot(path=str(SHOTS / "space-rename-restored.png"))


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    worker = Worker()
    failures: list[str] = []

    try:
        worker.build()
        worker.clean()
        worker.migrate()
        worker.start()

        token = worker.account()
        space = request("/v1/spaces", token, {"name": SPACE})["space"]
        note = request(
            f"/v1/spaces/{space['id']}/notes", token, {"path": NOTE, "content": OPENING}
        )["note"]
        note_id = note["id"]
        request(f"/v1/spaces/{space['id']}/notes", token, {"path": CANVAS, "content": "{}"})
        say(f"the account holds {SPACE}/{NOTE} as {note_id}, and {SPACE}/{CANVAS} beside it")

        with sync_playwright() as playwright:
            # One browser, two contexts: two devices as far as the app and the account
            # are concerned. The flags matter - a browser slows down a page it is not
            # showing, and a page waiting to hear from the room is exactly that page.
            browser = playwright.chromium.launch(
                executable_path=chromium(),
                headless=True,
                args=[
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                ],
            )
            try:
                one = signed_in(browser, token, "one")
                opened(one, "one", note_id)
                two = signed_in(browser, token, "two")
                opened(two, "two", note_id)
                say("both browsers are in the room")

                # Before the rename, so that what follows is about the rename and not
                # about the room ever having worked.
                crosses(one, two, "\nbefore the rename\n", "before the rename, one to two")

                # The rename itself, through the app: the space's folder is renamed and
                # every open note's path is rewritten under the new root, with every id
                # left alone. This is the moment the note used to go quiet.
                #
                # Both halves of it, because a rename is both: the workspace moves the
                # folder and the mirror is re-keyed onto its new root. That pair is what
                # `commitSpaceName` in lib/space-actions.ts does when the field in the
                # header is committed, and it is spelled out here rather than typed into
                # that field because the field is a component - what this drive is about
                # is the room, not the sidebar. Without the second half the mirror still
                # answers about the old root, and the note is not one the account knows
                # a path for at all.
                which = one.evaluate(
                    "() => window.nibApp.workspace.spaces.find("
                    f"  (one) => one.name === {json.dumps(SPACE)}).id"
                )
                one.evaluate(
                    "async ([id, name]) => {"
                    "  const workspace = window.nibApp.workspace;"
                    "  const space = workspace.spaces.find((one) => one.id === id);"
                    "  const from = space.root;"
                    "  await workspace.renameSpace(id, name);"
                    "  await window.nibApp.sync.renamed(from, space.root, space.name)"
                    "}",
                    [which, RENAMED],
                )
                wait_for(
                    one,
                    "() => window.nibApp.workspace.spaces.some("
                    f"  (one) => one.name === {json.dumps(RENAMED)})",
                    "[one] the space to be renamed",
                )
                moved = one.evaluate("() => window.nibApp.workspace.active?.path ?? ''")
                say(f"the space is renamed and the open note is now at {moved}")
                say(f"the renamer has opened {len(sockets['one'])} room sockets so far")
                if f"/{RENAMED}/" not in moved:
                    failures.append(f"the open note was not moved with its space: {moved!r}")

                # The note is still in its room - which is what makes the file sync
                # right to stand back from it.
                if not one.evaluate(
                    f"() => window.nibApp.rooms.joined.has({json.dumps(note_id)})"
                ):
                    failures.append("the renamed note left its room")

                # And the whole point: words still cross, both ways.
                crosses(one, two, "\nafter the rename\n", "after the rename, one to two")
                crosses(two, one, "\nand back again\n", "after the rename, two to one")

                # Both sides hold the same note.
                until = time.monotonic() + PATIENCE
                while time.monotonic() < until:
                    if words(one) == words(two):
                        break
                    one.wait_for_timeout(25)

                here, over_there = words(one), words(two)
                if here != over_there:
                    failures.append(f"the two never agreed:\n{here!r}\n{over_there!r}")
                else:
                    say("both browsers hold the same words")

                for expected in ("before the rename", "after the rename", "and back again"):
                    if expected not in here:
                        failures.append(f"{expected!r} was lost")

                # The other channel: the room settles the note into the account.
                reaches_the_account(token, note_id, "after the rename")

                one.screenshot(path=str(SHOTS / "space-rename-one.png"))
                two.screenshot(path=str(SHOTS / "space-rename-two.png"))

                # And the other half of the same mistake, in a browser of its own: a
                # session that says a canvas is a note.
                restores_a_canvas(browser, token, failures)
            finally:
                browser.close()
    finally:
        worker.stop()

    if failures:
        print("\nFAILED")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("\nPASSED: a space rename leaves the note writing in both directions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
