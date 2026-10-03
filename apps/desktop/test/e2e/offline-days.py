"""Days away: one machine offline while forty notes are written on both sides.

Sync v2's promise (docs/sync-v2.md sections 4, 5.4 and 12): a device that comes back
after days away merges what it wrote with what everybody else did, character by
character, and asks only where two people wrote the same sentence two ways. So this
plants exactly those, among forty notes, and checks that the question comes up on
exactly them:

    0  both machines write, in different paragraphs      merged, nothing asked
    1  only the machine that is away writes              taken, nothing asked
    2  only the machine that stayed writes               taken, nothing asked
    3  both rewrite the same paragraph, a sentence each  held for the question
    4  both change one word of the same paragraph        the newer word, nothing asked

and then that no `(from another device` file exists anywhere, that every merged note
says the same on both machines and on the account, that every word typed is in a note
- or, for the held ones, on the machine that typed it - and that answering "Keep
mine" sends the away machine's sentence up.

The real thing: the built web app, the Worker under `wrangler dev`, two browser
contexts. Run it from the repository root:

    python apps/desktop/test/e2e/offline-days.py
"""

from __future__ import annotations

import json
import sys
import time

from playwright.sync_api import Browser, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
#: Forty notes opened and written on two machines, and a pass over all of them.
BUDGET = 1200
say = DRIVE.say
SHOTS = DRIVE.shots
ORIGIN = harness.worker_origin()

EMAIL = "days-away@example.com"
SPACE = "Days away"
NOTES = 40
PATIENCE = 90
COPY = "(from another device"

wrong: list[str] = []


def failed(words: str) -> None:
    wrong.append(words)
    print(f"  WRONG: {words}", flush=True)


class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")


def signed_in(browser: Browser, token: str, label: str) -> Page:
    context = browser.new_context(viewport={"width": 1100, "height": 700})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    page = context.new_page()
    page.set_default_timeout(30000)
    page.on("pageerror", lambda error: say(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "() => !!window.nibApp?.account.user", f"[{label}] the account")
    return page


def settled(page: Page, what: str) -> None:
    wait_for(page, "() => window.nibApp.sync.status !== 'syncing'", f"{what} to settle")
    page.wait_for_timeout(1200)


def name(index: int) -> str:
    return f"Day {index:02d}.md"


def opening(index: int) -> str:
    return (
        f"# Day {index}\n\n"
        f"Paragraph A of day {index}, about the morning and the trains.\n\n"
        f"Paragraph B of day {index}, about the meeting after lunch.\n\n"
        f"Paragraph C of day {index}, about the evening walk home.\n"
    )


def rewrite(index: int, who: str) -> str:
    """A sentence long enough that two of them over one paragraph are a question."""
    return (
        f"Paragraph B of day {index} rewritten on machine {who}: the meeting moved, the "
        f"agenda changed and everyone agreed on something else entirely, marker {who}{index}z."
    )


def edit(page: Page, note: str, old: str, new: str) -> bool:
    """Opens a note, replaces `old` with `new` through the editor, and writes it down
    the way a pause does."""
    opened = page.evaluate(
        """async ([space, name]) => {
          const ws = window.nibApp.workspace
          const found = ws.spaces.find((one) => one.name === space)
          if (!found) return false
          if (ws.activeSpaceId !== found.id) await ws.selectSpace(found.id)
          const note = ws.notes.find((one) => one.name === name)
          if (!note) return false
          await ws.openEntry(note.path, { activate: true })
          return true
        }""",
        [SPACE, note],
    )
    if not opened:
        return False
    page.wait_for_function(
        "(name) => window.nibApp.workspace.active?.name === name && !!window.nib",
        arg=note,
        timeout=15000,
    )
    done = page.evaluate(
        """([old, now]) => {
          const view = window.nib
          const at = view.state.doc.toString().indexOf(old)
          if (at < 0) return false
          view.dispatch({ changes: { from: at, to: at + old.length, insert: now } })
          return true
        }""",
        [old, new],
    )
    page.wait_for_timeout(150)
    page.evaluate("async () => { await window.nibApp.workspace.writeNow() }")
    return bool(done)


def notes_here(page: Page) -> dict[str, str]:
    return page.evaluate(
        """async (space) => {
          const ws = window.nibApp.workspace
          await ws.loadTree()
          const out = {}
          for (const note of ws.notes) out[note.name] = (await ws.noteText(note.path)) ?? ''
          return out
        }""",
        SPACE,
    )


def held_here(page: Page) -> list[str]:
    return page.evaluate("() => (window.nibApp.sync.engine?.heldNotes ?? []).map((one) => one.name)")


def notes_there(worker: Worker, token: str, space_id: str) -> dict[str, str]:
    listed = worker.request(f"/v1/spaces/{space_id}/changes?since=0", token=token)
    out: dict[str, str] = {}
    for one in listed.get("notes", []):
        if one.get("deleted"):
            continue
        held = worker.request(f"/v1/notes/{one['id']}", token=token)
        out[one["path"]] = held.get("content", "")
    return out


def main() -> int:
    worker = Worker()
    with DRIVE.session() as browser:
        worker.start()
        token = worker.account(EMAIL)
        worker.sql(f"update users set sync_version = 2 where email = '{EMAIL}'")

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
        owner.context.close()

        for index in range(NOTES):
            made = worker.request(
                f"/v1/spaces/{space_id}/notes",
                token=token,
                body={"path": name(index), "content": opening(index)},
            )
            if not made.get("note"):
                failed(f"note {index} could not be made: {made}")

        pages = {which: signed_in(browser, token, which) for which in ("away", "stays")}
        for which, page in pages.items():
            if page.evaluate("() => window.nibApp.sync.version") != 2:
                failed(f"[{which}] started v1 on an account on v2")
            wait_for(
                page,
                f"() => window.nibApp.workspace.spaces.some((one) => one.name === {json.dumps(SPACE)})",
                f"[{which}] the space",
            )
            page.evaluate(
                "async (name) => { const ws = window.nibApp.workspace;"
                " await ws.selectSpace(ws.spaces.find((one) => one.name === name).id) }",
                SPACE,
            )
            wait_for(
                page,
                f"async () => (await window.nibApp.workspace.loadTree(), window.nibApp.workspace.notes.length >= {NOTES})",
                f"[{which}] all {NOTES} notes",
            )
            settled(page, f"[{which}] the first pass")

        away, stays = pages["away"], pages["stays"]
        DRIVE.preload(away, harness.WORKER_DIST)
        away.context.set_offline(True)
        say(f"machine away is offline; writing in {NOTES} notes on both sides")

        typed: dict[int, dict[str, str]] = {}
        for index in range(NOTES):
            kind = index % 5
            para_a = f"Paragraph A of day {index}, about the morning and the trains."
            para_b = f"Paragraph B of day {index}, about the meeting after lunch."
            para_c = f"Paragraph C of day {index}, about the evening walk home."
            words: dict[str, str] = {}
            if kind == 0:
                words["away"] = f"{para_a} Away wrote mka{index}z."
                words["stays"] = f"{para_c} Stays wrote mks{index}z."
                edit(away, name(index), para_a, words["away"])
                edit(stays, name(index), para_c, words["stays"])
            elif kind == 1:
                words["away"] = f"{para_a} Away wrote mka{index}z."
                edit(away, name(index), para_a, words["away"])
            elif kind == 2:
                words["stays"] = f"{para_c} Stays wrote mks{index}z."
                edit(stays, name(index), para_c, words["stays"])
            elif kind == 3:
                words["away"] = rewrite(index, "away")
                words["stays"] = rewrite(index, "stays")
                edit(away, name(index), para_b, words["away"])
                edit(stays, name(index), para_b, words["stays"])
            else:
                edit(away, name(index), "the meeting after", "the meeting before")
                edit(stays, name(index), "the meeting after", "the meeting during")
            typed[index] = words

        for page in pages.values():
            page.evaluate("() => { for (const tab of [...window.nibApp.workspace.tabs]) window.nibApp.workspace.close(tab.id) }")
        stays.evaluate("() => window.nibApp.sync.nudge()")
        settled(stays, "the machine that stayed")

        # Back after days away.
        began = time.monotonic()
        away.context.set_offline(False)
        away.wait_for_timeout(1500)
        away.evaluate("() => window.nibApp.sync.nudge()")
        settled(away, "the machine that came back")
        for page in pages.values():
            page.evaluate("() => window.nibApp.sync.nudge()")
            page.wait_for_timeout(4000)
            settled(page, "the last pass")
        say(f"the machine that came back settled in {time.monotonic() - began:.1f}s")

        planted = sorted(name(index) for index in range(NOTES) if index % 5 == 3)
        held = sorted(held_here(away))
        say(f"held for the question on the machine that came back: {held}")
        if held != planted:
            failed(f"the question came up on {held}, and the planted overlaps are {planted}")
        if held_here(stays):
            failed(f"the machine that stayed holds {held_here(stays)}")

        here = {which: notes_here(page) for which, page in pages.items()}
        there = notes_there(worker, token, space_id)
        for where, notes in [*here.items(), ("the account", there)]:
            copies = [one for one in notes if COPY in one]
            if copies:
                failed(f"{where} has a copy beside a note: {copies}")

        for index in range(NOTES):
            note = name(index)
            if note in planted:
                if typed[index]["away"] not in here["away"].get(note, ""):
                    failed(f"{note}: the away machine's sentence is gone from it")
                if typed[index]["stays"] not in there.get(note, ""):
                    failed(f"{note}: the account lost the other machine's sentence")
                continue
            texts = {here["away"].get(note), here["stays"].get(note), there.get(note)}
            if len(texts) != 1:
                failed(f"{note}: the machines and the account disagree: {json.dumps(sorted(map(str, texts)))[:300]}")
            for words in typed[index].values():
                if words not in (there.get(note) or ""):
                    failed(f"{note}: lost {words!r}")

        # Keep mine, on every held note: the away machine's sentence goes up.
        for note in held:
            away.evaluate(
                """(name) => {
                  const engine = window.nibApp.sync.engine
                  const one = engine.heldNotes.find((held) => held.name === name)
                  return one ? engine.answer(one.id, 'mine') : null
                }""",
                note,
            )
        away.evaluate("() => window.nibApp.sync.nudge()")
        away.wait_for_timeout(4000)
        settled(away, "the answers")
        there = notes_there(worker, token, space_id)
        for index in range(NOTES):
            if index % 5 == 3 and typed[index]["away"] not in there.get(name(index), ""):
                failed(f"{name(index)}: Keep mine did not send the away machine's sentence up")
        if held_here(away):
            failed(f"still held after every answer: {held_here(away)}")

        for which, page in pages.items():
            page.screenshot(path=str(SHOTS / f"{which}.png"))
            status = page.evaluate("() => window.nibApp.sync.status")
            if status == "error":
                failed(f"[{which}] sync is in error: {page.evaluate('() => window.nibApp.sync.lastError')}")

    if wrong:
        print(f"\n{len(wrong)} thing(s) wrong:", flush=True)
        for one in wrong:
            print(f"  - {one}", flush=True)
        return 1
    print("\nthe question came up on exactly the planted overlaps, and nothing was lost", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
