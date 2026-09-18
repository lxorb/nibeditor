"""Two browsers writing in one note at the same time, against the real Worker.

Everything in this test is the real thing: the built web app, the Worker running
under `wrangler dev` on workerd, a Durable Object holding the room, and two
browser contexts with their own storage that know nothing about each other.
What it asserts is the promise the room makes - both sides end up with every
word, and each can see where the other is - and it measures how long that takes.

Run it from the repository root:

    python apps/desktop/test/e2e/collaborate.py

It builds the app, applies the migrations, starts the Worker, runs the browsers
and stops everything again. Nothing it makes outlives it but the screenshots,
which go beside it under `shots/`.

The app is built `--mode drive` on purpose. That leaves the app's own
stores reachable from the page, so the test opens a note by asking the workspace
for it rather than by hunting for a row in a file list - which is a test of the
sidebar, not of writing together. Everything after that is real: real keystrokes
into the real editor, and the words read back out of the document every pane is
a view onto.
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
SHOTS = Path(__file__).resolve().parent / "shots" / "collaborate"

# A port of this test's own. Never 1420, which is the dev server's.
PORT = 18844
ORIGIN = f"http://127.0.0.1:{PORT}"

EMAIL = "together@example.com"
SPACE = "Notes"
NOTE = "together.md"
OPENING = "# Together\n\nthe first line\n"

# How long anything is waited for before the test gives up and says what it saw.
PATIENCE = 40

# What a word crossing has to stay under here. The budget the design is held to is
# 150 ms on a normal connection; this is the ceiling past which something is
# actually wrong rather than merely busy. See the note where it is used.
CEILING = 1500


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


def request(path: str, token: str | None = None, body: dict | None = None, method: str | None = None):
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
        # Its output goes to a file rather than to a pipe. A pipe nobody reads
        # fills up, and a Worker whose output has nowhere to go stops answering.
        self.log = SHOTS.parent / "worker.log"
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
        """Everything the last run left: the database, the blobs, and the rooms'
        own storage. A test that starts from yesterday's state is a test of
        yesterday."""
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
            "wrangler",
            "d1",
            "execute",
            "nib",
            "--local",
            f"--command={statement}",
            cwd=SERVICE,
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
        # The whole tree. `wrangler dev` is a wrapper around the runtime itself,
        # and stopping only the wrapper leaves the runtime holding the port - which
        # the next run then waits ninety seconds for and gives up on.
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
        """An account with a live session, put straight into the database.

        Signing in needs an emailed code, and what is under test is not the
        sign-in. Everything after this goes through the API the app uses.
        """
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


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def long_note() -> str:
    """About a hundred kilobytes of markdown, which is a long note by any measure:
    a whole chapter, or a year of a journal in one file."""
    paragraph = (
        "The room holds the note as one document, so two devices that both wrote "
        "end up with the same words and neither is asked to choose.\n\n"
    )

    words = "# A long note\n\n"
    at = 0
    while len(words) < 100 * 1024:
        words += f"## Part {at}\n\n{paragraph}"
        at += 1

    return words


def fresh(browser: Browser, token: str, label: str) -> Page:
    """A browser that has never held this account's notes, so nothing it opens is
    warm."""
    page = signed_in(browser, token, label)
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space to arrive",
    )
    return page


def signed_in(browser: Browser, token: str, label: str) -> Page:
    """A browser context with the session in its storage, on the app."""
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    return page


def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")


def opened(page: Page, label: str, note_id: str) -> None:
    """Waits for the account's space to come down, opens the note in it, and waits
    for that note to be in its room."""
    wait_for(
        page,
        f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
        f"[{label}] the space to arrive",
    )

    # The file list of the open space, which a sync reloads once a note lands.
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
        "() => { window.nibApp.workspace.flush(); return window.nibApp.workspace.active?.doc ?? '' }"
    )


def place(page: Page, at: int) -> None:
    """Puts the caret where the words should go, and gives the editor the keys."""
    page.click(".cm-content")
    page.evaluate(
        "(at) => {"
        "  window.nib.dispatch({ selection: { anchor: Math.min(at, window.nib.state.doc.length) } });"
        "  window.nib.focus()"
        "}",
        at,
    )


def type_at(page: Page, at: int, said: str) -> None:
    """Types into the real editor, at a place in the note. Real keystrokes: the
    caret is put where the words should go and the keyboard does the rest."""
    place(page, at)
    page.keyboard.type(said, delay=12)


def echo(one: Page, two: Page, at: int, said: str, label: str) -> float:
    """One keystroke in one browser, and how long it takes to reach the other.

    Both ends of the measurement are taken inside the pages, by the wall clock
    they share, because asking a page a question over the debugging protocol costs
    more than the thing being measured. The waiting browser watches for the letter
    a frame at a time - which is as often as anybody could see it arrive - and
    writes down when it saw it.
    """
    # A timer rather than a frame: a page the browser is not showing is given
    # frames at about one a second, and what is being measured is the room.
    two.evaluate(
        "(wanted) => {"
        "  window.__arrived = null;"
        "  const look = () => {"
        "    window.nibApp.workspace.flush();"
        "    if ((window.nibApp.workspace.active?.doc ?? '').includes(wanted)) {"
        "      window.__arrived = Date.now();"
        "      return"
        "    }"
        "    setTimeout(look, 1)"
        "  };"
        "  look()"
        "}",
        said,
    )

    place(one, at)
    # Taken before the keystroke rather than after it, so what the keystroke
    # itself costs to deliver counts against the budget rather than for it.
    sent = one.evaluate("() => Date.now()")
    one.keyboard.type(said)

    until = time.monotonic() + PATIENCE
    while time.monotonic() < until:
        arrived = two.evaluate("() => window.__arrived")
        if arrived:
            took = arrived - sent
            say(f"{label}: {took} ms")
            return float(took)
        two.wait_for_timeout(10)

    raise SystemExit(f"{label} never arrived. one says {words(one)!r}, two says {words(two)!r}")


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
        say(f"the account holds {SPACE}/{NOTE} as {note_id}")

        with sync_playwright() as playwright:
            # One browser, two contexts: two devices as far as the app and the
            # account are concerned, since a context has its own storage and its
            # own session. The three flags matter - a browser slows down a page it
            # is not showing, and a page waiting to hear from the room is exactly
            # that page.
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

                # Each sees the other.
                for page, label in ((one, "one"), (two, "two")):
                    wait_for(
                        page,
                        "() => Object.values(window.nibApp.rooms.present).some((n) => n > 0)",
                        f"[{label}] the other device to appear",
                    )
                say("each browser can see that the other is there")

                # One writes a letter, the other hears it. Five times each way, so
                # what is reported is a normal crossing rather than the first one.
                # Digits, because the letter watched for must not already be in
                # the note: a watcher looking for one that is there answers before
                # the keystroke that was meant to send it.
                crossings = [
                    echo(one, two, len(OPENING) + turn, str(turn + 1), "one to two")
                    for turn in range(5)
                ]
                coming_back = [
                    echo(two, one, turn, str(turn + 6), "two to one") for turn in range(5)
                ]
                there = sorted(crossings)[len(crossings) // 2]
                returning = sorted(coming_back)[len(coming_back) // 2]
                say(f"a letter crosses in {there:.0f} ms and comes back in {returning:.0f} ms")

                # And now both at once, in the same paragraph, before either has
                # heard the other.
                type_at(one, len(words(one)), "at the same time from one\n")
                type_at(two, 0, "at the same time from two\n")

                until = time.monotonic() + PATIENCE
                while time.monotonic() < until:
                    if words(one) == words(two) and "from one" in words(one):
                        break
                    one.wait_for_timeout(20)

                here, over_there = words(one), words(two)
                if here != over_there:
                    failures.append(f"the two never agreed:\n{here!r}\n{over_there!r}")
                else:
                    say("both browsers hold the same words")

                for expected in (
                    "12345",
                    "678910",
                    "at the same time from one",
                    "at the same time from two",
                ):
                    if expected not in here:
                        failures.append(f"{expected!r} was lost")

                # The budget for a word crossing on a normal connection is 150 ms,
                # and the number reported above is what it took here. What this
                # fails on is far looser, because "here" is one machine running the
                # Worker's runtime, the browser and the test at once: a ceiling
                # this high is still a real failure - a word not crossing, a socket
                # that fell over - while a busy laptop is not.
                for took, way in ((there, "to cross"), (returning, "to come back")):
                    if took > CEILING:
                        failures.append(f"a letter took {took:.0f} ms {way}, past {CEILING} ms")

                # The remote caret. The second browser's caret moves, and the
                # first is photographed with its name beside it.
                two.evaluate("() => { window.nib.dispatch({ selection: { anchor: 3 } }); window.nib.focus() }")
                one.wait_for_selector(".cm-nib-caret", timeout=10_000)
                one.wait_for_timeout(120)
                one.locator(".cm-editor").first.screenshot(path=str(SHOTS / "remote-caret.png"))
                say(f"the remote caret is in {SHOTS / 'remote-caret.png'}")

                # And the name fades, leaving the bar.
                one.wait_for_timeout(1800)
                one.locator(".cm-editor").first.screenshot(path=str(SHOTS / "remote-caret-settled.png"))

                # The tab's presence dots.
                one.locator(".strip").first.screenshot(path=str(SHOTS / "presence-dots.png"))

                # A long note joining a room: the object waking, reading the note
                # out of the store, and saying what it holds. Measured on a note
                # this browser has never opened, so nothing about it is warm.
                long = request(
                    f"/v1/spaces/{space['id']}/notes",
                    token,
                    {"path": "long.md", "content": long_note()},
                )["note"]
                say(f"a {len(long_note()) // 1024} KB note is on the account")

                joining = fresh(browser, token, "three")
                wait_for(
                    joining,
                    "() => {"
                    "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
                    f"  return walk(window.nibApp.workspace.tree).includes('/{SPACE}/long.md')"
                    "}",
                    "[three] the long note to arrive",
                )

                started = time.perf_counter()
                joining.evaluate(f"() => window.nibApp.workspace.open('/{SPACE}/long.md')")
                wait_for(
                    joining,
                    f"() => window.nibApp.rooms.joined.has({json.dumps(long['id'])})",
                    "[three] the long note to join its room",
                )
                took = (time.perf_counter() - started) * 1000
                say(f"a long note joined its room in {took:.0f} ms")
                if took > CEILING * 4:
                    failures.append(f"joining took {took:.0f} ms, past {CEILING * 4} ms")

                # What the account ends up holding, once the room has settled it.
                until = time.monotonic() + PATIENCE
                settled = ""
                while time.monotonic() < until:
                    settled = request(f"/v1/notes/{note_id}", token)["content"]
                    if settled == here:
                        break
                    time.sleep(0.2)

                if settled != here:
                    failures.append(f"the account holds something else:\n{settled!r}")
                else:
                    say("the account holds what both browsers hold")
            finally:
                browser.close()
    finally:
        worker.stop()

    if failures:
        print("\nFAILED", flush=True)
        for one_of_them in failures:
            print(f"  - {one_of_them}", flush=True)
        return 1

    print("\nboth browsers wrote in one note and neither lost a word", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
