"""Two machines, one note, and one of them offline while both are written in.

The promise docs/sync.md makes is that nothing anybody typed is ever gone. This
drives the one case that can break it: two devices with the same note open - so
both are in its room - one of them taken off the network, and a line typed on each
side while they are apart. Then the offline one comes back.

Every one of the three conflict rules is driven, in both directions - the first
machine offline, then the second - and after each the words are looked for
everywhere they could be: in the note on either machine, in a copy beside it, and
in what the account holds. A run where any of the six cases cannot find a line
somebody typed is a run that lost writing, and it says which.

Everything here is the real thing: the built web app, the Worker under
`wrangler dev` on workerd, a Durable Object holding the room, and two browser
contexts with their own storage that know nothing about each other.

Run it from the repository root:

    python apps/desktop/test/e2e/conflict.py

With `--v2` the account is moved to sync v2 first (docs/sync-v2.md), where there is no
rule to choose: the two sides are merged, or held for the question when they rewrote
the same words. Then no `(from another device` file may exist anywhere, and every
line must be in the note on both machines and on the account, or - for a note held
for the question - on the machine that typed it.

It builds the app, applies the migrations, starts the Worker, runs the browsers
and stops everything again. Nothing it makes outlives it but the screenshots,
which go beside it under `shots/conflict/`.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
#: Eighteen cases of a minute or more each: the longest drive in the folder.
BUDGET = 2400
say = DRIVE.say
SHOTS = DRIVE.shots
#: The Worker's own address, which is also where the app it serves is loaded from.
ORIGIN = harness.worker_origin()


EMAIL = "two-hands@example.com"
SPACE = "Two hands"
OPENING = "# Plan\n\nthe line both of them start from\n"

# How long anything is waited for before the drive gives up and says what it saw.
PATIENCE = 60

#: Sync v2 rather than v1: see the docstring.
V2 = "--v2" in sys.argv

# The eighteen cases: each rule, each side taken off the network, each way of
# being away. See `run_case`. Under v2 there is no rule, so six.
RULES = ("v2",) if V2 else ("both", "newest", "ask")

#: What says the note is in its room, by the note's id on the account: v1's rooms, or
#: under v2 the room carrying the engine's document (sync2/carry.ts).
IN_ROOM = (
    "(id) => [...window.nibApp.rooms.carried.values()].some((one) => one.room.settled)"
    if V2
    else "(id) => window.nibApp.rooms.carries(id)"
)

#: The name every copy beside a note carries; under v2 there must be none.
COPY = "(from another device"
SIDES = ("one", "two")
WAYS = ("network", "restart", "noroom")

wrong: list[str] = []


def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)


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
    try:
        with urllib.request.urlopen(call, timeout=30) as answer:
            return json.loads(answer.read() or b"null")
    except urllib.error.HTTPError as refused:
        said = refused.read().decode()
        return {"status": refused.code, **(json.loads(said) if said else {})}


class Worker(harness.Worker):
    """The real Worker, with this drive's account in it; see harness.py."""

    def __init__(self) -> None:
        super().__init__(DRIVE)

    def account(self) -> str:  # type: ignore[override]
        return super().account(EMAIL)


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(60)

    raise SystemExit(f"gave up waiting for {what}")


def signed_in(browser: Browser, token: str, label: str) -> Page:
    """A browser context with the session in its storage, on the app."""
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")

    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("console", lambda message: heard(label, message))
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.account.user", f"[{label}] the account")
    return page


def heard(label: str, message) -> None:
    text = message.text[:400]
    if message.type in ("error", "warning"):
        say(f"[{label}] {message.type}: {text}")
    elif text.startswith("nib/"):
        # What the boundaries say about themselves while a case runs. See `trace`
        # in apps/desktop/src/lib/sync/mirror.ts.
        say(f"[{label}] {text}")


def settled(page: Page, what: str) -> None:
    wait_for(page, "() => window.nibApp.sync.status !== 'syncing'", f"{what} to settle")
    page.wait_for_timeout(1200)


def tree(page: Page) -> list[str]:
    return page.evaluate(
        "() => { const walk = (e) => e ? [e.path, ...(e.children ?? []).flatMap(walk)] : [];"
        " return walk(window.nibApp.workspace.tree) }"
    )


def notes_here(page: Page, about: str) -> dict[str, str]:
    """Every note this machine holds about one case - the note itself and any copy
    beside it - by name. Every case leaves its notes behind, so the name is what
    keeps one case's answer from being read as another's."""
    return page.evaluate(
        """async (about) => {
          const ws = window.nibApp.workspace
          const out = {}
          for (const note of ws.notes) {
            if (!note.name.startsWith(about)) continue
            out[note.name] = (await ws.noteText(note.path)) ?? ''
          }
          return out
        }""",
        about,
    )


def history_here(page: Page, about: str) -> list[str]:
    """Every version this machine kept of every note about one case.

    Which is where the `newest` rule deliberately puts what loses: it is the rule
    that says "put the later one in front of me", and what it promises is not a second
    file but that the other copy is still somewhere. Every write that replaces a note
    with words from elsewhere keeps one first - see `writeDown` in sync/write-down.ts - so
    this is the other half of that promise, read back the way the history sheet reads
    it."""
    return page.evaluate(
        """(about) => new Promise((resolve, reject) => {
          // The browser's own store, where a version this device kept lives; see
          // `snapshots` in src/lib/web/store.ts. Read here rather than through the
          // app because the history sheet reads it with a command a page cannot
          // call, and what is being checked is that the words are on the device.
          const open = indexedDB.open('nib')
          open.onerror = () => reject(new Error('no store'))
          open.onsuccess = () => {
            const rows = open.result.transaction('snapshots').objectStore('snapshots').getAll()
            rows.onerror = () => reject(new Error('no versions'))
            rows.onsuccess = () => {
              resolve(
                rows.result
                  .filter((row) => String(row.notePath ?? '').includes(about))
                  .map((row) => String(row.content ?? '')),
              )
            }
          }
        })""",
        about,
    )


def clashes_here(page: Page, about: str) -> list[str]:
    """The other copy of every note about one case that is waiting for an answer.

    Where the `ask` rule puts it: the note is left exactly as it is, and the copy is
    held whole in the sync pane until somebody says what to do with it. Read out of
    the device's own storage, which is where the pane reads it; see
    sync/record.svelte.ts. Under v2, the notes held for the question, with the other
    side's words as the question shows them."""
    if V2:
        return page.evaluate(
            """(about) => (window.nibApp.sync.engine?.heldNotes ?? [])
              .filter((one) => one.name.startsWith(about))
              .map((one) => String(one.theirs?.excerpt?.text ?? ''))""",
            about,
        )
    return page.evaluate(
        """(about) => {
          try {
            const held = JSON.parse(localStorage.getItem('nib:sync-log') ?? '{}')
            return (held.clashes ?? [])
              .filter((one) => String(one.path ?? '').includes(about))
              .map((one) => String(one.theirs ?? ''))
          } catch {
            return []
          }
        }""",
        about,
    )


def notes_there(token: str, space_id: str, about: str) -> dict[str, str]:
    """The same, as the account holds it, by path."""
    page = request(f"/v1/spaces/{space_id}/changes?since=0", token)
    out: dict[str, str] = {}
    for one in page.get("notes", []):
        if one.get("deleted") or not one["path"].startswith(about):
            continue
        held = request(f"/v1/notes/{one['id']}", token)
        out[one["path"]] = held.get("content", "")

    return out


def write_line(page: Page, said: str) -> None:
    """A line typed at the end of the note, through the real editor, and the note
    written down the way a pause does."""
    page.evaluate(
        "(text) => { const view = window.nib;"
        " view.dispatch({ changes: { from: view.state.doc.length, insert: text } }) }",
        said,
    )
    page.wait_for_timeout(400)
    page.evaluate(
        "async () => { await window.nibApp.workspace.writeNow() }"
    )
    page.wait_for_timeout(900)


def open_note(page: Page, name: str) -> bool:
    return bool(
        page.evaluate(
            """async ([space, name]) => {
              const ws = window.nibApp.workspace
              const found = ws.spaces.find((one) => one.name === space)
              if (!found) return false
              if (ws.activeSpaceId !== found.id) await ws.selectSpace(found.id)
              await ws.loadTree()
              const note = ws.notes.find((one) => one.name === name)
              if (!note) return false
              await ws.openEntry(note.path, { activate: true })
              return true
            }""",
            [SPACE, name],
        )
    )


def close_note(page: Page) -> None:
    """The tab holding the note, closed. Which is what takes the note out of its
    room: the room is joined for what is open and left when the last tab holding it
    goes, and the document it held goes with it."""
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const tab of [...ws.tabs]) ws.close(tab.id)
        }"""
    )


def refuse_sockets(page: Page) -> None:
    """Every WebSocket this page opens from now on is refused, while everything it
    fetches carries on working. Which is a coffee shop, a hotel, and every corporate
    proxy that allows HTTPS and knows nothing about the other protocol - the case
    door.ts is written against, where the file is the only way words travel."""
    page.evaluate(
        """() => {
          const Refused = class {
            constructor() {
              this.readyState = 3
              setTimeout(() => this.onclose?.({ code: 1006 }), 0)
            }
            send() {}
            close() {}
          }
          Refused.OPEN = 1
          Refused.CLOSED = 3
          window.WebSocket = Refused
        }"""
    )


def note_id(page: Page, name: str) -> str | None:
    return page.evaluate(
        """([space, name]) => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name === name)
          return note ? (window.nibApp.sync.tracked(note.path)?.id ?? null) : null
        }""",
        [SPACE, name],
    )


def run_case(browser: Browser, token: str, space_id: str, rule: str, away: str, how: str) -> None:
    """One rule, with one of the two machines taken off the network.

    `how` is what being away means, and there are three of them:

        network   the connection goes and comes back with the note open, which the
                  room's own socket rides out: the two documents are merged
                  character by character the moment it returns
        restart   the app is closed and opened again while away - a lid shut on a
                  train, a tab reopened in a tunnel. Nothing of the room survives
                  it, so the device comes back holding a file and joins a room that
                  has moved on
        noroom    the device can reach the account but never its room, which is
                  every network that allows HTTPS and blocks WebSockets. The file
                  is the only way its words travel, while the other device's words
                  travel through the room

    The last two are the ones the room cannot merge by itself, and they are what
    this drive is about.

    Each case has a note of its own, so what it proves cannot be muddled with what
    another case left behind.
    """
    name = f"Plan {rule} {away} {how}.md"
    # What this case's notes are called, the copy beside the note included.
    about = f"Plan {rule} {away} {how}"
    label = f"{rule}/{away}/{how}"
    say(f"--- the rule is {rule!r}, machine {away} goes away by {how} ---")

    # The note, put on the account directly: what is under drive is the two
    # machines meeting, not the first one pushing.
    made = request(
        f"/v1/spaces/{space_id}/notes", token, {"path": f"{name}", "content": OPENING}
    )
    if not made.get("note"):
        failed(f"[{label}] the note could not be made: {made}")
        return

    pages: dict[str, Page] = {}
    for which in SIDES:
        page = signed_in(browser, token, f"{label}/{which}")
        if not V2:
            page.evaluate("(rule) => window.nibApp.modes.setConflicts(rule)", rule)
        elif page.evaluate("() => window.nibApp.sync.version") != 2:
            failed(f"[{label}/{which}] the account is on v2 and this machine started v1")
        wait_for(
            page,
            f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
            f"[{label}/{which}] the space",
        )
        settled(page, f"[{label}/{which}] the first pass")
        if not open_note(page, name):
            failed(f"[{label}/{which}] never got the note")
            for one in pages.values():
                one.context.close()
            page.context.close()
            return

        pages[which] = page

    first, second = pages["one"], pages["two"]
    held = note_id(first, name)
    if not held:
        failed(f"[{label}] the first machine does not know the note's id")
    else:
        for which, page in pages.items():
            wait_for(
                page,
                f"() => ({IN_ROOM})({json.dumps(held)})",
                f"[{label}/{which}] the note to join its room",
            )

    # One of them goes off the network, and a line is typed on each side. The one
    # that is away is written in first, so the room hears the other one while it
    # cannot hear this.
    gone = pages[away]
    stays = pages["two" if away == "one" else "one"]

    # A network that allows HTTPS and blocks WebSockets: the socket is refused from
    # here on, and the note is put back into the tab so that the refusal is what it
    # meets. Everything else about this device works.
    if how == "noroom":
        refuse_sockets(gone)
        close_note(gone)
        gone.wait_for_timeout(600)
        if not open_note(gone, name):
            failed(f"[{label}] the note is not there with its room refused")
            for one in pages.values():
                one.context.close()
            return
        gone.wait_for_timeout(1500)
    else:
        # Every chunk of the app into the page first: a desktop that loses its
        # connection still has its own files, and a question sheet it has never
        # opened is one of them. See `preload` in harness.py.
        DRIVE.preload(gone, harness.WORKER_DIST)
        gone.context.set_offline(True)
        gone.wait_for_timeout(600)

    away_line = f"written on machine {away} while away, rule {rule}"
    stays_line = f"written on the other machine, rule {rule}"
    if V2:
        # Two lines appended at one point are both kept and nothing is asked - unless
        # they share more than a line of words, when they are one passage written twice
        # (docs/sync-v2.md 5.4). v1's two lines are alike enough to be that; these are
        # two different things two people wrote.
        away_line = f"Machine {away}, from the train: the platform moved to track nine."
        stays_line = "Meanwhile at the desk we drafted the budget for spring."
    write_line(gone, f"\n{away_line}\n")
    write_line(stays, f"\n{stays_line}\n")

    # The note closed while away, and opened again when the connection came back.
    if how == "restart":
        close_note(gone)
        gone.wait_for_timeout(1000)
        say(
            f"[{label}] the note is closed on machine {away}:"
            f" in its room={gone.evaluate(f'() => ({IN_ROOM})({json.dumps(held)})')}"
            f" open={gone.evaluate('() => window.nibApp.workspace.openNotes.length')}"
        )

    for which, page in pages.items():
        say(
            f"[{label}/{which}] while apart: in its room={page.evaluate(f'() => ({IN_ROOM})({json.dumps(held)})')}"
            f" words={json.dumps(read_words(page))[:150]}"
        )

    settled(stays, f"[{label}] the machine that stayed")

    # And back. The pass is nudged rather than waited for: what is under drive is
    # the meeting, not the timer. The device whose room is refused never comes back
    # to it; the file is the whole of how its words travel.
    if how != "noroom":
        gone.context.set_offline(False)
        gone.wait_for_timeout(1500)

    # The note opened again, before anything else. A socket comes back on a wait
    # that doubles and a pass on a longer timer, so the room is what a device that
    # has just woken up reaches first, and that order is the one worth driving.
    if how == "restart":
        if not open_note(gone, name):
            failed(f"[{label}] the note is not there after being closed")
            for one in pages.values():
                one.context.close()
            return
        gone.wait_for_timeout(4000)

    gone.evaluate("() => window.nibApp.sync.nudge()")
    gone.wait_for_timeout(7000)
    settled(gone, f"[{label}] the machine that came back")

    stays.evaluate("() => window.nibApp.sync.nudge()")
    stays.wait_for_timeout(5000)
    settled(stays, f"[{label}] the machine that stayed, after")

    # And the person who never left keeps typing, because that is what they were
    # doing. A room settles a moment after the last keystroke, so this is the settle
    # that writes the room's words over whatever landed in the note store while
    # nobody was looking - which is the other half of the same promise.
    after_line = f"and one more line after all that, rule {rule}"
    write_line(stays, f"\n{after_line}\n")
    stays.wait_for_timeout(3000)

    # A second round on each, because a copy written on one side is a note the
    # other has not been handed yet.
    for page in (gone, stays):
        page.evaluate("() => window.nibApp.sync.nudge()")
        page.wait_for_timeout(4000)
        settled(page, f"[{label}] the last pass")

    # Which line was typed where, because that is what the promise is about: nothing
    # anybody typed is gone from the machine they typed it on.
    stayed = "two" if away == "one" else "one"
    typed = {
        "the words written while away": (away_line, away),
        "the other machine's words": (stays_line, stayed),
        "the line typed after all that": (after_line, stayed),
    }

    words: dict[str, str] = {}
    kept: dict[str, str] = {}
    waiting: dict[str, list[str]] = {}
    for which, page in pages.items():
        page.evaluate("async () => window.nibApp.workspace.loadTree()")
        page.wait_for_timeout(1200)
        held_here = notes_here(page, about)
        say(f"[{label}/{which}] holds {sorted(held_here)}")
        for one, said in held_here.items():
            say(f"[{label}/{which}]   {one}: {json.dumps(said)[:170]}")

        words[which] = " ".join(held_here.values())
        # The words this machine still has somewhere: in a note, in a version it kept
        # on the way past, or in a copy waiting in the sync pane for an answer.
        waiting[which] = clashes_here(page, about)
        kept[which] = " ".join([*history_here(page, about), *waiting[which]])
        page.screenshot(path=str(SHOTS / f"{rule}-{away}-{how}-{which}.png"))

    there = notes_there(token, space_id, about)
    say(f"[{label}] the account holds {sorted(there)}")
    account = " ".join(there.values())

    for what, (line, who) in typed.items():
        # Every rule promises this one, and it is the promise the bug broke: the words
        # were gone from the disk of the machine that typed them, with nothing said.
        if line not in words[who] and line not in kept[who]:
            failed(f"[{label}] {what} are gone from machine {who}, which typed them")

        # Under v2: the same everywhere, unless the note is held for the question.
        if rule == "v2":
            if waiting["one"] or waiting["two"]:
                continue
            if line not in account:
                failed(f"[{label}] the account lost {what}")
            for which in SIDES:
                if line not in words[which]:
                    failed(f"[{label}] machine {which} lost {what}")
            continue

        # And then what each rule says beyond that. `both` writes the other copy
        # beside the note, so both machines and the account end up holding every line
        # as a note. `ask` holds the copy in the pane until somebody answers, and
        # `newest` lets the later copy stand with the other kept where it was written -
        # so for those two, a line the account does not hold has to be somewhere on the
        # machine that wrote it, which is what was just checked.
        if rule != "both":
            continue

        if line not in account:
            failed(f"[{label}] the account lost {what}")
        for which in SIDES:
            if line not in words[which]:
                failed(f"[{label}] machine {which} lost {what}")

    # And the rule said something rather than settling it quietly, which is the other
    # half of what went wrong: two copies were made one, and nothing anywhere said so.
    if rule == "both":
        copies = [one for one in there if one != name]
        say(f"[{label}] the copy beside the note is {copies}")
        if words["one"] != words["two"] and not copies:
            failed(f"[{label}] the two machines disagree and no copy was kept beside the note")

    if rule == "v2":
        # Two different lines added at the end: nothing to ask about.
        if waiting["one"] or waiting["two"]:
            failed(f"[{label}] the question came up over two lines added side by side")
        copies = [one for one in [*there, *notes_here(gone, about), *notes_here(stays, about)] if COPY in one]
        if copies:
            failed(f"[{label}] a copy was made beside the note under v2: {copies}")
        say(f"[{label}] held for the question: one={len(waiting['one'])} two={len(waiting['two'])}")

    if rule == "ask":
        say(f"[{label}] waiting in the pane: one={len(waiting['one'])} two={len(waiting['two'])}")
        if words["one"] != words["two"] and not waiting["one"] and not waiting["two"]:
            failed(f"[{label}] the two machines disagree and the pane is not waiting on anything")

    for which, page in pages.items():
        said = page.evaluate(
            "() => ({ status: window.nibApp.sync.status,"
            " lastError: window.nibApp.sync.lastError ?? null })"
        )
        say(f"[{label}/{which}] sync says {json.dumps(said)}")
        if said["status"] == "error":
            failed(f"[{label}/{which}] sync is in error: {json.dumps(said)}")

    for page in pages.values():
        page.context.close()


def read_words(page: Page) -> str:
    return page.evaluate(
        "() => { window.nibApp.workspace.flush(); return window.nibApp.workspace.active?.doc ?? '' }"
    )


def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account()
        if V2:
            worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")

        # The space, made once by a machine of its own so that every case below
        # starts from an account that already holds it.
        owner = signed_in(browser, token, "owner")
        wait_for(owner, "() => !!window.nibApp.workspace.activeSpace", "a space")
        owner.evaluate(
            "async (name) => { const ws = window.nibApp.workspace; await ws.addSpace(name);"
            " const space = ws.spaces.find((one) => one.name === name);"
            " await ws.selectSpace(space.id) }",
            SPACE,
        )
        space_id = wait_for(
            owner,
            "() => window.nibApp.sync.remoteIdFor(window.nibApp.workspace.activeSpace.root)",
            "the space to reach the account",
        )
        settled(owner, "the first push")
        say(f"the space is {space_id} on the account")
        owner.context.close()

        words = [one for one in sys.argv[1:] if not one.startswith("--")]
        only = words[0] if words else ""
        for rule in RULES:
            for away in SIDES:
                for how in WAYS:
                    if only and only not in f"{rule}/{away}/{how}":
                        continue
                    try:
                        run_case(browser, token, space_id, rule, away, how)
                    except SystemExit as gave_up:
                        failed(f"[{rule}/{away}/{how}] gave up: {gave_up}")

    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1

    print("\nevery case kept every line somebody typed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
