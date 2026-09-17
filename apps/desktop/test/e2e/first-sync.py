"""Signing in on a machine that holds none of the account's notes, over a slow line.

The moment the app has the least to show and the most to do: a session, an account
with a few hundred notes on it, and a connection that takes a third of a second to
say anything. What is measured is when each of three things happens, from the
navigation:

    names       every note the account holds has a row in the file list
    unblocked   the full-surface waiting state is gone and the app can be used
    words       every body has come down

Against the real Worker under `wrangler dev`, with its own database, so the pass is
the pass; the slowness is Chrome's own network emulation over it, which is what a
phone on a train has.

Run it once for each build, from the repository root:

    python apps/desktop/test/e2e/first-sync.py after

It builds the app itself, because the app has to be built against the Worker's
origin. Everything it leaves behind - the database, the Worker's state - it clears
on the way in. It prints numbers and nothing else: a scratch drive, not a test.

What it said on one laptop, two hundred notes on a three-hundred-millisecond line -
before the names came first, and after:

    every name on the tree           75695ms -> 5272ms
    the app usable, the overlay gone 75823ms -> 5372ms
    every body landed                75851ms -> 72588ms

Which is the whole of it: the same half minute of fetching, and a reader who is
reading their notes for all but five seconds of it instead of none of it.
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

from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SERVICE = ROOT / "services" / "sync"

# Above 1425, and not any other drive's port.
PORT = 18993
ORIGIN = f"http://127.0.0.1:{PORT}"

EMAIL = "first-sync@example.com"
SPACE = "Account"

#: How many notes the account holds. Enough that fetching them one at a time over a
#: slow line is the half minute the waiting state exists for.
NOTES = 200

#: What the line is like: a third of a second each way, and a phone's share of a
#: crowded cell. Chrome's own emulation rather than a delay in front of each route,
#: because a route handler that sleeps also stops the drive watching the page.
LATENCY = 300
DOWN = 1_500_000 / 8
UP = 750_000 / 8

PATIENCE = 240


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def npx(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [shutil.which("npx") or "npx", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def request(path: str, token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode()
    headers = {}
    if data is not None:
        headers["content-type"] = "application/json"
    if token:
        headers["authorization"] = f"Bearer {token}"

    call = urllib.request.Request(f"{ORIGIN}{path}", data=data, headers=headers)
    with urllib.request.urlopen(call, timeout=30) as answer:
        return json.loads(answer.read() or b"null")


class Worker:
    """The Worker under wrangler dev, the database behind it, and the built app it
    serves. Lifted from collaborate.py, which brings the same three up."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.log = APP / "test" / "e2e" / "shots" / "first-sync-worker.log"
        self.opened = None

    def build(self) -> None:
        say("building the app against the local Worker")
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
        say("applying the migrations")
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
        # To a file rather than a pipe: a pipe nobody drains fills, and a Worker
        # whose output has nowhere to go stops answering.
        self.opened = self.log.open("wb")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                # Every binding local, which is the only way it starts without a
                # Cloudflare token: the account's own Workers AI binding is remote
                # by nature, and nothing here asks anything of it.
                "--local",
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
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                time.sleep(1)

        raise SystemExit(f"the Worker never answered:\n{self.said()}")

    def said(self) -> str:
        if self.opened:
            self.opened.flush()
        if not self.log.exists():
            return "(nothing)"

        return "\n".join(self.log.read_text("utf-8", errors="replace").splitlines()[-40:])

    def stop(self) -> None:
        if not self.process:
            return

        say("stopping the Worker")
        # The whole tree: `wrangler dev` wraps the runtime, and stopping the wrapper
        # alone leaves the runtime holding the port.
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
        """An account with a live session, put straight into the database. Signing
        in needs an emailed code, and the sign-in is not what is being measured."""
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


def body(at: int) -> str:
    """A note with everything in it the index reads, so the pass is a real pass."""
    return (
        "---\nicon: rocket\nicon-color: violet\naliases:\n"
        f"  - note {at} elsewhere\n---\n\n"
        f"# Note {at}\n\n#wind and a line about the weather.\n\n"
        f"See [[note-{(at + 3) % NOTES:04d}]].\n\n"
        "## What went in\n\n- Pressure on the pen\n- Slides out of a note\n"
    )


#: Everything worth saying about where the app has got to, for a wait that ends in
#: nothing rather than in the moment it was watching for.
STATE = """
() => {
  const ws = window.nibApp?.workspace
  if (!ws) return { app: false }

  return {
    spaces: ws.spaces.map((one) => one.name),
    open: ws.activeSpace?.name ?? null,
    notes: ws.notes.length,
    coming: window.nibApp.arriving.coming?.size ?? null,
    rows: document.querySelectorAll('aside .row').length,
    // How many rows the tree has, as against how many of them are drawn: the list
    // draws the ones that fit. See Tree.svelte.
    onTree: Number(
      document.querySelector('aside li[aria-setsize]')?.getAttribute('aria-setsize') ?? 0,
    ),
    waiting: !!document.querySelector('.arriving'),
    sync: window.nibApp.sync.status,
  }
}
"""


def when(page: Page, script: str, what: str) -> float:
    """The moment a page first agrees, in milliseconds since its navigation."""
    try:
        page.wait_for_function(script, timeout=PATIENCE * 1000)
    except Exception:
        say(f"gave up waiting for {what}: {page.evaluate(STATE)}")
        raise

    taken = page.evaluate("() => performance.now()")
    say(f"{what}: {taken:.0f}ms  {page.evaluate(STATE)}")
    return taken


def slow(page: Page) -> None:
    """A line like a phone's on a train, from here on."""
    session = page.context.new_cdp_session(page)
    session.send("Network.enable")
    session.send(
        "Network.emulateNetworkConditions",
        {
            "offline": False,
            "latency": LATENCY,
            "downloadThroughput": DOWN,
            "uploadThroughput": UP,
        },
    )


def drive(browser, token: str) -> dict[str, float]:
    context = browser.new_context(viewport={"width": 1280, "height": 860})
    page = context.new_page()
    page.on("pageerror", lambda error: say(f"page error: {error}"))

    # A device with the file list open and nothing whatever in it: no space, no
    # note, nothing of anybody's. That is the moment the whole waiting state exists
    # for, and the one the app used to spend on a blank screen - a browser that has
    # been introduced and then had its notes erased, which is the answer somebody
    # gives on signing in when they want only what the account holds.
    page.goto(ORIGIN, wait_until="domcontentloaded")
    page.wait_for_function("() => !!window.nibApp", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.evaluate("async () => await window.nibApp.workspace.eraseLocalSpaces()")
    page.wait_for_function("() => window.nibApp.workspace.spaces.length === 0", timeout=60000)
    page.wait_for_timeout(1500)

    # And now there is a session, and the line is what it is.
    page.evaluate(f"() => localStorage.setItem('nib:session', {json.dumps(token)})")
    slow(page)

    page.reload(wait_until="commit")

    names = when(
        page,
        # The list draws the rows that fit and no others, so counting the rows in the
        # page counts the window rather than the names: two hundred names are thirty
        # or so rows. `aria-setsize` is the tree's own word for how many rows it has,
        # which is the number this is about, and it is on every row. See Tree.svelte.
        "() => Number(document.querySelector('aside li[aria-setsize]')"
        f"?.getAttribute('aria-setsize') ?? 0) >= {NOTES}",
        "every name on the tree",
    )
    unblocked = when(
        page,
        "() => !!window.nibApp && !document.querySelector('.arriving')",
        "the app to be usable",
    )
    # The rows the build after the change draws for a note that has not landed are
    # not files, so both halves are asked for: the files on the disk, and nothing
    # still on its way. The build before the change has no second half.
    words = when(
        page,
        f"() => window.nibApp.workspace.notes.length >= {NOTES}"
        " && (window.nibApp.arriving.coming?.size ?? 0) === 0",
        "every body to land",
    )

    context.close()
    return {"names": names, "unblocked": unblocked, "words": words}


def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "now"

    worker = Worker()
    worker.build()
    worker.clean()
    worker.migrate()
    worker.start()

    try:
        token = worker.account()
        space = request("/v1/spaces", token, {"name": SPACE})["space"]
        for at in range(NOTES):
            request(
                f"/v1/spaces/{space['id']}/notes",
                token,
                {"path": f"note-{at:04d}.md", "content": body(at)},
            )
        say(f"the account holds {NOTES} notes in {SPACE}")

        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                taken = drive(browser, token)
            finally:
                browser.close()
    finally:
        worker.stop()

    print()
    print(f"{tag}, signing in to {NOTES} notes on a {LATENCY}ms line:")
    for key, words in [
        ("names", "every name on the tree"),
        ("unblocked", "the app usable, the overlay gone"),
        ("words", "every body landed"),
    ]:
        print(f"  {words:44} {taken[key]:7.0f}ms")

    print()
    print(json.dumps({key: round(value) for key, value in taken.items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
