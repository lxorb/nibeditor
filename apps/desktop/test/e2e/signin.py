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
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say = DRIVE.say
SHOTS = DRIVE.shots
#: The Worker's own address, which is also where the app it serves is loaded from.
ORIGIN = harness.worker_origin()


PERSON = "reader@example.com"

# Two spaces and enough notes that the first pass is worth watching.
SPACES = {"Journal": 9, "Uni": 12}

PATIENCE = 60


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


class Worker(harness.Worker):
    """The real Worker, with the owner's account in it; see harness.py. Everybody
    else signs in for real, with the code the Worker mails them."""

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self, email: str) -> str:
        """An account with a live session, put straight into the database. The
        owner is not what is under test here; everybody else signs in for real.
        """
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
      // What the foot actually said, which is the thing under test: the store
      // being right and the row being wrong are two different failures.
      (document.querySelector('aside .foot .coming')?.innerText ?? '').trim(),
    ])
    if (window.__nib.length < 600) setTimeout(tick, 200)
  }
  tick()
}
"""


#: A count in the foot: "3 of 21".
COUNT = re.compile(r"\d+\s*of\s*\d+")


def counted_in(page: Page, patience: float = 30) -> str:
    """What the foot counted - now, or at any moment since the sampler started.

    The row and the trace, because the row on its own cannot answer the question.
    What is under test is that somebody signing in sees the count while their notes
    come down, and against a Worker on this machine that whole pass is over in a
    second or two: a line that looks afterwards finds the row gone and has learned
    nothing about whether it was ever there. The sampler has been reading that same
    row every 200ms since before the code was typed, so it can say."""
    until = time.monotonic() + patience
    while True:
        live = page.evaluate(
            "() => (document.querySelector('aside .foot .coming')?.innerText ?? '').trim()"
        )
        if COUNT.search(live):
            return live

        seen = [row[6] for row in page.evaluate("() => window.__nib ?? []") if COUNT.search(row[6])]
        if seen:
            return f"{seen[0]} up to {seen[-1]}"

        if time.monotonic() >= until:
            return ""

        page.wait_for_timeout(200)


def watched(page: Page) -> str:
    """The trace, as short lines: only the moments something changed."""
    rows = page.evaluate("() => window.__nib ?? []")
    out: list[str] = []
    last = None
    for row in rows:
        shape = tuple(row[1:])
        if shape != last:
            out.append(
                f"{row[0]:>6}ms showing={row[1]} drawn={row[2]} in={row[3]}"
                f" settling={row[4]} sync={row[5]} foot={row[6]!r}"
            )
            last = shape

    return "\n    ".join(out) or "nothing recorded"


def sign_in(page: Page, worker: Worker, label: str, address: str) -> None:
    """The emailed code, typed for real."""
    page.locator("input[type=email]").fill(address)

    # Where the mailbox stands before the code is asked for; see `mail_to`.
    already = len(worker.written())
    page.get_by_role("button", name="Continue").click()

    code = worker.waits_for_mail(
        address, r"(\d{6}) is your nibeditor code", f"[{label}] the sign-in code", already
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
    worker = Worker()
    failures: list[str] = []

    def wrong(what: str) -> None:
        say(f"FAILED: {what}")
        failures.append(what)

    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    ) as browser:
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

        page = fresh(browser, "reader")
        on_a_bad_line(page)

        # The foot of the list panel, which is where the pass reports, open
        # before any of this begins: the sampler below reads the row out of
        # the page, and a row on a panel nobody has opened yet is a row it
        # cannot see. This used to be opened after the sign-in, which is
        # after the pass it is there to watch had started.
        page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
        page.wait_for_selector("aside .foot", timeout=10_000)

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

        # The question about the notes already here. A browser holding only
        # the welcome note is not asked - an untouched seed is not writing,
        # see `hasLocalContent` - so this is usually a wait for nothing.
        keep_local_notes(page, "reader")

        page.wait_for_timeout(300)
        page.screenshot(path=str(SHOTS / "signing-in-light.png"))
        say("photographed the state, light")

        # The count, once the pass has asked the account how much there is.
        counted = counted_in(page)
        if not counted:
            raise SystemExit(
                f"the count never appeared. the app says: {state(page)}\n"
                f"    {watched(page)}"
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

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nsigning in said so, counted, lifted on its own, and never trapped anybody", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
