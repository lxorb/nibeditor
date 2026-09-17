"""Signing in, end to end, against the real Worker.

The question this answers is the one somebody asks the first time they sign in on
a new machine: their account already holds spaces and notes, and until the first
pass has brought them down the app has nothing of theirs to show. It must say so,
it must not let them type into what is not there yet, and the notes must arrive
without anybody reloading the page.

Everything here is the real thing: the built web app, the Worker under
`wrangler dev` on workerd, the D1 migrations, and the mailer writing where a mail
would have gone - which is where the six digits are read from.

Run it from the repository root:

    python apps/desktop/test/e2e/signin.py

It builds the app, applies the migrations, starts the Worker, runs the browser and
stops everything again. Nothing it makes outlives it but the screenshots, which go
beside it under `shots/`.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
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
SHOTS = Path(__file__).resolve().parent / "shots" / "signin"

# A port of this test's own. Never 1420, which is the dev server's, and not the
# ones the collaboration and sharing runs use either.
PORT = 18866
ORIGIN = f"http://127.0.0.1:{PORT}"

PERSON = "reader@example.com"

# Two spaces and enough notes that the first pass is worth watching.
SPACES = {"Journal": 9, "Uni": 12}

PATIENCE = 60


def say(words: str) -> None:
    print(f"  {words}", flush=True)


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


def free_the_port() -> None:
    """Kills whatever is listening on this run's port, if anything still is.

    Called before the Worker starts and after it stops, because a runtime left
    over from an earlier run answers on the same port with an earlier run's
    database - and the run that meets it fails for reasons that are not in it."""
    if os.name != "nt":
        return

    listing = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, errors="replace", check=False
    ).stdout

    for line in listing.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[3] != "LISTENING":
            continue
        if not parts[1].endswith(f":{PORT}"):
            continue

        say(f"a server was still on {PORT}; stopping it")
        subprocess.run(
            ["taskkill", "/T", "/F", "/PID", parts[4]], capture_output=True, check=False
        )


def request(path: str, token: str | None = None, body: dict | None = None):
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
        method="GET" if data is None else "POST",
    )
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")


class Worker:
    """The Worker under wrangler dev, the local database behind it, and the log
    that stands in for a mailbox."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        # Its output goes to a file rather than to a pipe. A pipe nobody reads
        # fills up, and a Worker whose output has nowhere to go stops answering.
        self.log = SHOTS.parent / "signin-worker.log"
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
        """Everything the last run left. A test that starts from yesterday's
        state is a test of yesterday."""
        state = SERVICE / ".wrangler" / "state"
        if state.exists():
            say("clearing what the last run left")
            shutil.rmtree(state, ignore_errors=True)
        if self.log.exists():
            self.log.unlink()

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
        free_the_port()
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

        until = time.monotonic() + 120
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit(f"the Worker stopped before it answered:\n{self.said()}")
            try:
                if request("/health").get("ok"):
                    say("the Worker is answering")
                    return
            # A runtime still coming up answers, and what it answers is not always
            # JSON. Only "it said ok" counts as up.
            except (
                urllib.error.URLError,
                TimeoutError,
                ConnectionError,
                OSError,
                ValueError,
            ):
                time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        """Everything the Worker has printed."""
        if self.opened:
            self.opened.flush()
        if not self.log.exists():
            return ""

        return self.log.read_text("utf-8", errors="replace")

    def mail_to(self, address: str, after: int = 0) -> str:
        """The last message the Worker handed to the mail binding for this
        address: its subject, and the words of it. `after` skips what the log
        already held, so an older message to the same person cannot be read as
        the answer to a newer request."""
        lines = self.said()[after:].splitlines()
        found = [at for at, line in enumerate(lines) if line.strip() == f"To: {address}"]
        if not found:
            return ""

        message = ""
        for line in lines[found[-1] : found[-1] + 6]:
            if line.startswith("Subject: "):
                message += line[len("Subject: ") :] + "\n"
            if line.startswith("Text: "):
                path = Path(line[len("Text: ") :].strip())
                if path.exists():
                    message += path.read_text("utf-8", errors="replace")

        return message

    def waits_for_mail(self, address: str, pattern: str, what: str, after: int = 0) -> re.Match[str]:
        """A message to somebody, once one has been sent that says this.

        `after` is how much the log already held when the message was asked for.
        Without it a second browser signing in as the same person reads the code
        from the first browser's message, and types one the server has spent."""
        until = time.monotonic() + PATIENCE
        while time.monotonic() < until:
            found = re.search(pattern, self.mail_to(address, after))
            if found:
                return found
            time.sleep(0.3)

        raise SystemExit(
            f"gave up waiting for {what}. the last message to {address} was:\n"
            f"{self.mail_to(address, after)!r}"
        )

    def stop(self) -> None:
        if not self.process:
            return

        say("stopping the Worker")
        # The whole tree. `wrangler dev` is a wrapper around the runtime itself,
        # and stopping only the wrapper leaves the runtime holding the port.
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

        # And whatever is still on the port. A runtime whose wrapper has already
        # gone is not in the tree that was just killed, and one left behind
        # answers the next run's health check with somebody else's state - which
        # is a failure nobody would think to look for here.
        free_the_port()

    def account(self, email: str) -> str:
        """An account with a live session, put straight into the database, so the
        spaces can be seeded through the API before any browser exists."""
        token = uuid.uuid4().hex + uuid.uuid4().hex
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())

        self.sql(
            f"insert into users (id, email, name, created_at)"
            f" values ('{user}', '{email}', 'Emil', {now});"
            f"insert into sessions (token_hash, user_id, created_at, expires_at)"
            f" values ('{digest}', '{user}', {now}, {now + 86_400_000});"
        )

        return token


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def note_console(label: str, message) -> None:
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {message.text[:200]}")


def fresh(browser: Browser, label: str, theme: str = "light") -> Page:
    """A browser that has never held anything: its own storage, its own session,
    and the welcome note a first visit opens."""
    context = browser.new_context(viewport={"width": 1180, "height": 760}, color_scheme=theme)
    page = context.new_page()
    page.on("console", lambda message: note_console(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    return page


def on_a_bad_line(page: Page) -> None:
    """Emil's connection. The whole point of what is under test is the half minute
    a first sync takes on one of these, so the test runs on one: over a local
    Worker the pass is done in a second and there is nothing to photograph."""
    session = page.context.new_cdp_session(page)
    session.send("Network.enable")
    session.send(
        "Network.emulateNetworkConditions",
        {
            "offline": False,
            "latency": 400,
            "downloadThroughput": 50 * 1024,
            "uploadThroughput": 50 * 1024,
        },
    )


def tree_paths(page: Page) -> list[str]:
    """Every path the file list is showing, whichever space is open."""
    return page.evaluate(
        "() => {"
        "  const walk = (entry) => (entry ? [entry.path, ...(entry.children ?? []).flatMap(walk)] : []);"
        "  return walk(window.nibApp.workspace.tree)"
        "}"
    )


def space_names(page: Page) -> list[str]:
    return page.evaluate("() => window.nibApp.workspace.spaces.map((one) => one.name)")


def surface(page: Page) -> str:
    """How much of the window the state covers, and what it says. The whole point
    of it is that there is nothing else to look at, so the box is the assertion."""
    return page.evaluate(
        "() => {"
        "  const node = document.querySelector('.arriving');"
        "  if (!node) return 'not there';"
        "  const box = node.getBoundingClientRect();"
        "  const style = getComputedStyle(node);"
        "  return JSON.stringify({"
        "    width: Math.round(box.width),"
        "    height: Math.round(box.height),"
        "    said: node.innerText.trim(),"
        "    over: style.position,"
        "    shut: document.querySelector('main')?.inert === true,"
        "  })"
        "}"
    )


def state(page: Page) -> str:
    """What the stores say, for a failure to be readable without a screenshot."""
    return page.evaluate(
        "() => {"
        "  const app = window.nibApp;"
        "  return JSON.stringify({"
        "    signedIn: app.account.signedIn,"
        "    settling: app.account.settling,"
        "    error: app.account.error,"
        "    step: app.account.step,"
        "    open: app.account.open,"
        "    sync: app.sync.status,"
        "    showing: app.arriving?.showing ?? 'no store',"
        "    total: app.arriving?.total ?? null,"
        "    done: app.arriving?.done ?? null,"
        "  })"
        "}"
    )


# What the store said and what the page was showing, sampled inside the page so
# that nothing this test does can be what makes it draw.
WATCH = """
() => {
  window.__nib = []
  const tick = () => {
    const store = window.nibApp.arriving
    window.__nib.push([
      Math.round(performance.now()),
      store.showing ? 1 : 0,
      document.querySelector('.arriving') ? 1 : 0,
      window.nibApp.account.signedIn ? 1 : 0,
      window.nibApp.account.settling ? 1 : 0,
      window.nibApp.sync.status,
    ])
    if (window.__nib.length < 200) setTimeout(tick, 200)
  }
  tick()
}
"""


def watched(page: Page) -> str:
    """The trace, as short lines: only the moments something changed."""
    rows = page.evaluate("() => window.__nib ?? []")
    out: list[str] = []
    last = None
    for row in rows:
        shape = tuple(row[1:])
        if shape != last:
            out.append(f"{row[0]:>6}ms showing={row[1]} drawn={row[2]} in={row[3]} settling={row[4]} sync={row[5]}")
            last = shape

    return "\n    ".join(out) or "nothing recorded"


def sign_in(page: Page, worker: Worker, label: str, address: str) -> None:
    """The emailed code, typed for real."""
    page.locator("input[type=email]").fill(address)

    # Where the mailbox stands before the code is asked for; see `mail_to`.
    already = len(worker.said())
    page.get_by_role("button", name="Continue").click()

    code = worker.waits_for_mail(
        address, r"(\d{6}) is your Nib code", f"[{label}] the sign-in code", already
    ).group(1)
    say(f"[{label}] the code in the mail is {code}")

    page.locator(".digits input").first.fill(code)


def keep_local_notes(page: Page, label: str) -> None:
    """A browser that has never held this account has the welcome note in it, and
    signing in asks what should become of it. Keeping it loses nothing."""
    keep = page.get_by_role("button", name="Keep them")
    try:
        keep.wait_for(timeout=15_000)
        keep.click()
        say(f"[{label}] kept the notes already here")
    except Exception:
        say(f"[{label}] nothing here to ask about")


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    worker = Worker()
    failures: list[str] = []

    def wrong(what: str) -> None:
        say(f"FAILED: {what}")
        failures.append(what)

    try:
        worker.build()
        worker.clean()
        worker.migrate()
        worker.start()

        token = worker.account(PERSON)
        wanted: set[str] = set()
        for name, count in SPACES.items():
            space = request("/v1/spaces", token, {"name": name})["space"]
            for index in range(count):
                path = f"note-{index + 1}.md"
                request(
                    f"/v1/spaces/{space['id']}/notes",
                    token,
                    {"path": path, "content": f"# {name} {index + 1}\n\nsomething written\n"},
                )
                wanted.add(f"/{name}/{path}")
        say(f"the account holds {len(SPACES)} spaces and {len(wanted)} notes")

        with sync_playwright() as playwright:
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
                page = fresh(browser, "reader")
                on_a_bad_line(page)

                page.evaluate(WATCH)
                page.evaluate("() => (window.nibApp.account.open = true)")
                page.locator("input[type=email]").wait_for(timeout=10_000)
                sign_in(page, worker, "reader", PERSON)

                # ── It says so, from the moment the code is accepted ────────
                # Where it says it depends on whether there is anything to say it
                # over. This browser holds the welcome note, so it has a space and
                # a file list already, and the pass reports as a count in the
                # panel's foot rather than over the whole surface: the full
                # surface is for a machine with nothing of the account's to show
                # at all. See `nothingToShow` in workspace.svelte.ts and the head
                # of arriving.svelte.ts.
                say("waiting for the state to go up")
                try:
                    wait_for(page, "() => window.nibApp.arriving.showing", "the state", 30)
                except SystemExit:
                    raise SystemExit(
                        f"the state never went up. the app says: {state(page)}\n"
                        f"    {watched(page)}"
                    )
                say("it went up before the account had been asked anything")
                say(f"the surface is {surface(page)}")

                # And the app stays reachable, because the list beside it is
                # already right: the names land a request in, and a row whose body
                # has not arrived says so when it is clicked.
                if page.evaluate("() => document.querySelector('main')?.inert === true"):
                    wrong("the app was shut off while there was already a list to use")

                # The question about the notes already here.
                keep_local_notes(page, "reader")

                # The foot of the list panel, which is where the pass reports.
                page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
                page.wait_for_selector("aside .foot", timeout=10_000)
                page.wait_for_timeout(300)
                page.screenshot(path=str(SHOTS / "signing-in-light.png"))
                say("photographed the state, light")

                # The count, once the pass has asked the account how much there is.
                counted = wait_for(
                    page,
                    "() => {"
                    "  const said = document.querySelector('aside .foot .coming')?.innerText ?? '';"
                    "  return /\\d+\\s*of\\s*\\d+/.test(said) ? said : null"
                    "}",
                    "the count",
                    patience=30,
                )
                say(f"the state counts: {counted!r}")
                page.screenshot(path=str(SHOTS / "signing-in-counting.png"))

                # ── And it goes on its own, with nobody reloading ───────────
                say("waiting for the state to go")
                wait_for(
                    page,
                    "() => !window.nibApp.arriving.showing",
                    "the state to go",
                    patience=90,
                )
                say("it went on its own, and the app is reachable again")

                if page.evaluate("() => document.querySelector('main')?.inert === true"):
                    wrong("the app was left unreachable after the pass finished")

                names = space_names(page)
                for name in SPACES:
                    if name not in names:
                        wrong(f"{name} never reached the rail: {names!r}")
                say(f"the rail holds {names!r}")

                page.wait_for_timeout(200)
                page.screenshot(path=str(SHOTS / "signed-in.png"))
                say("photographed the app once the state had lifted")

                # It counted every note the account holds, and none twice.
                counted = page.evaluate("() => window.nibApp.arriving.done")
                if counted != len(wanted):
                    wrong(f"the state counted {counted} of the {len(wanted)} notes")
                else:
                    say(f"it counted all {counted} notes down")

                # Every space the account holds, filled, without a reload having
                # happened anywhere above.
                for name in SPACES:
                    page.evaluate(
                        "(wanted) => {"
                        "  const space = window.nibApp.workspace.spaces.find((one) => one.name === wanted);"
                        "  if (space) window.nibApp.workspace.showSpace(space.id)"
                        "}",
                        name,
                    )
                    # The file list, not the choice: picking a space sets which one
                    # is open before it has read the folder.
                    wait_for(
                        page,
                        "() => window.nibApp.workspace.tree?.path === "
                        + json.dumps(f"/{name}"),
                        f"{name}'s file list",
                    )
                    listed = tree_paths(page)
                    theirs = {path for path in wanted if path.startswith(f"/{name}/")}
                    missing = sorted(one for one in theirs if one not in listed)
                    if missing:
                        wrong(f"{name} arrived empty: missing {missing!r}")
                    else:
                        say(f"{name} holds all {len(theirs)} of its notes, with no reload")

                # ── Later passes stay quiet ────────────────────────────────
                page.evaluate("() => window.nibApp.sync.nudge()")
                page.wait_for_timeout(1500)
                # Neither over the surface nor in the foot: a later pass is one
                # nobody is waiting on, so the sync light is the whole report.
                if page.locator(".arriving").count() or page.evaluate(
                    "() => window.nibApp.arriving.showing"
                ):
                    wrong("a later pass put the state back up")
                else:
                    say("a later pass says nothing: the sync light is the whole report")

                # ── Signing out resets it ─────────────────────────────────
                page.evaluate("() => window.nibApp.account.signOut()")
                wait_for(page, "() => !window.nibApp.account.signedIn", "the sign-out")
                page.wait_for_timeout(400)
                if page.locator(".arriving").count():
                    wrong("signing out left the state up")
                else:
                    say("signing out cleared it")
            finally:
                browser.close()

            # ── The same state in the dark, and the way out ────────────────
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                page = fresh(browser, "dark", theme="dark")
                on_a_bad_line(page)
                page.evaluate("() => (window.nibApp.account.open = true)")
                page.locator("input[type=email]").wait_for(timeout=10_000)
                sign_in(page, worker, "dark", PERSON)
                wait_for(page, "() => window.nibApp.arriving.showing", "the state", 30)
                keep_local_notes(page, "dark")
                page.wait_for_timeout(300)
                page.screenshot(path=str(SHOTS / "signing-in-dark.png"))
                say("photographed the state, dark")
            finally:
                browser.close()

            # ── A connection that never comes back never traps anybody ─────
            browser = playwright.chromium.launch(executable_path=chromium(), headless=True)
            try:
                page = fresh(browser, "offline")
                page.evaluate("() => (window.nibApp.account.open = true)")
                page.locator("input[type=email]").wait_for(timeout=10_000)
                sign_in(page, worker, "offline", PERSON)
                wait_for(page, "() => window.nibApp.arriving.showing", "the state", 30)

                # The radio goes the moment the code has been accepted, which is
                # the case that used to leave somebody looking at nothing forever.
                session = page.context.new_cdp_session(page)
                session.send("Network.enable")
                session.send(
                    "Network.emulateNetworkConditions",
                    {
                        "offline": True,
                        "latency": 0,
                        "downloadThroughput": 0,
                        "uploadThroughput": 0,
                    },
                )
                keep_local_notes(page, "offline")

                # A radio that has gone answers at once, so the pass ends at once
                # and the wait ends with it. Nobody is held behind a wait for
                # something that is not coming, and what was already here is here.
                say("waiting for the wait to end on its own")
                wait_for(
                    page,
                    "() => !window.nibApp.arriving.showing",
                    "the state to let go of a dead connection",
                    30,
                )
                if page.evaluate("() => document.querySelector('main')?.inert === true"):
                    wrong("a dead connection left the app unreachable")
                elif not tree_paths(page):
                    wrong("a dead connection took the notes that were already here")
                else:
                    say("it let go, and the notes that were here are still here")

                # And the way out itself, for the other kind of bad connection: one
                # that neither answers nor fails. Nothing can be asked of a socket
                # that hangs, so the state is driven rather than emulated - it is
                # the real surface, waiting the way it waits.
                #
                # The full surface is only drawn while there is nothing of the
                # account's to draw it over, which is the machine this is about: a
                # first sign-in that has not landed anything yet. So the browser is
                # emptied to be that machine. See `nothingToShow` in
                # workspace.svelte.ts.
                page.evaluate(
                    """() => {
                         const ws = window.nibApp.workspace
                         ws.spaces = []
                         ws.tree = null
                       }"""
                )
                page.evaluate("() => window.nibApp.arriving.begin()")
                out = page.get_by_role("button", name="Continue")
                out.wait_for(timeout=15_000)
                page.wait_for_timeout(250)
                page.screenshot(path=str(SHOTS / "signing-in-offline.png"))
                say("photographed the way out")

                out.click()
                wait_for(
                    page,
                    "() => !window.nibApp.arriving.showing",
                    "the way out to let go",
                )
                if page.evaluate("() => document.querySelector('main')?.inert === true"):
                    wrong("the way out left the app unreachable")
                else:
                    say("the way out let go of the app")
            finally:
                browser.close()
    finally:
        worker.stop()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nsigning in said so, counted, lifted on its own, and never trapped anybody", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
