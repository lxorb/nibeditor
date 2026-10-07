"""A chat between people, in browsers of their own, against the real Worker.

Emil owns a space and shares it: Lucile may write in it and Mia may only read. In
three browsers, each signed in as one of them:

- Emil makes a chat in the space, with the Chats panel's own road;
- it arrives on Lucile's and Mia's devices by its pointer, and opens;
- Emil posts, Lucile replies in the message's replies, Lucile reacts, Emil edits and
  deletes - and each is seen live on the other side, timed;
- Lucile leaves the chat, Emil calls her by name, and her Chats panel shows the chat
  unread with a mention badge;
- Lucile goes offline, posts, comes back: the message is placed exactly once, and Emil
  sees it once;
- Mia's chat has no composer, and the account refuses her post.

Everything is the real thing: the built web app, the Worker under `wrangler dev` on
workerd, the chat's `ChatLog` and each account's hub as Durable Objects, D1 with every
migration, and each browser's own outbox, socket and store.

Run it from the repository root:

    python apps/desktop/test/e2e/chats-live.py
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any

from playwright.sync_api import Browser, BrowserContext, Page

import harness
from harness import Drive

DRIVE = Drive(__file__, served=False)
say, wrong = DRIVE.say, DRIVE.wrong
ORIGIN = harness.worker_origin()

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

OWNER, MEMBER, READER = "emil@example.com", "lucile@example.com", "mia@example.com"
NAMES = {OWNER: "Emil", MEMBER: "Lucile", READER: "Mia"}
SPACE = "Team"

#: How long anything live is given to arrive on the other side.
LIVE = 15
#: How long a pointer is given to sync to another device.
SYNCED = 60


class Worker(harness.Worker):
    def __init__(self) -> None:
        super().__init__(DRIVE)


# ---------------------------------------------------------------- in a page


def wait(page: Page, script: str, what: str, arg: object = None, patience: float = LIVE) -> Any:
    """Until the script answers something, polled; what it answered, or out."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script, arg)
        if answer:
            return answer
        page.wait_for_timeout(100)
    raise SystemExit(f"gave up waiting for {what}")


def came(page: Page, script: str, what: str, arg: object = None, patience: float = LIVE) -> float | None:
    """How many seconds it took the script to answer something, or None, counted as a
    failure, when it never did."""
    start = time.monotonic()
    try:
        wait(page, script, what, arg, patience)
    except SystemExit:
        wrong(f"gave up waiting for {what}")
        return None
    return time.monotonic() - start


def signed_in(browser: Browser, token: str, label: str) -> tuple[BrowserContext, Page]:
    context = browser.new_context(viewport={"width": 1180, "height": 760})
    context.add_init_script(f"localStorage.setItem('nib:session', {json.dumps(token)})")
    page = context.new_page()
    page.on(
        "console",
        lambda message: say(f"[{label}] {message.type}: {message.text[:240]}")
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait(page, "() => !!window.nibApp && window.nibApp.account.signedIn", f"[{label}] the session", patience=40)
    return context, page


def show_space(page: Page, label: str, space_id: str) -> str:
    """The space shown, by its account id; answers its folder's name on this device."""
    name = wait(
        page,
        "(id) => { const space = window.nibApp.workspace.spaces.find("
        "  (one) => window.nibApp.sync.remoteIdFor(one.root) === id);"
        " if (!space) return null; window.nibApp.workspace.showSpace(space.id); return space.name }",
        f"[{label}] the shared space",
        space_id,
        patience=SYNCED,
    )
    return str(name)


CHAT_PATH = """
async (name) => {
  const { chats } = await window.nibApp.chats()
  const entry = chats.list.find((one) => one.name === name && one.path)
  return entry ? { id: entry.id, path: entry.path } : null
}
"""

OPEN = "async (path) => { const one = await window.nibApp.chats(); one.openChat(path) }"


def open_chat(page: Page, label: str, name: str) -> dict[str, str]:
    """The chat, found by its pointer once that has synced here, and opened."""
    try:
        found = wait(page, CHAT_PATH, f"[{label}] the chat's pointer", name, patience=SYNCED)
    except SystemExit:
        said = page.evaluate(
            "async () => { const { chats } = await window.nibApp.chats();"
            " const walk = (e) => e ? [e.path, ...(e.children ?? []).flatMap(walk)] : [];"
            " return { list: chats.list.map((e) => [e.id, e.root, e.path, e.name]), ready: chats.ready,"
            " tree: walk(window.nibApp.workspace.tree), spaces: window.nibApp.workspace.spaces.map((s) => s.root) } }"
        )
        say(f"[{label}] holds {json.dumps(said)}")
        again = page.evaluate(
            "async () => { const { chats } = await window.nibApp.chats(); await chats.lookAgain();"
            " const one = chats.list.map((e) => [e.id, e.path]); await chats.reconnected();"
            " return [one, chats.list.map((e) => [e.id, e.path]), window.nibApp.account.user?.email] }"
        )
        say(f"[{label}] looked again: {json.dumps(again)}")
        raise
    page.evaluate(OPEN, found["path"])
    wait(page, "() => !!document.querySelector('.chat-tab .timeline, .chat-tab .waiting, .chat-tab .main')", f"[{label}] the chat's tab")
    return found  # type: ignore[no-any-return]


def rows_with(page: Page, words: str) -> int:
    return page.evaluate(  # type: ignore[no-any-return]
        "(words) => [...document.querySelectorAll('.chat-tab .main .message .body')]"
        ".filter((one) => one.textContent.includes(words)).length",
        words,
    )


def has_row(words: str) -> str:
    return (
        "() => [...document.querySelectorAll('.chat-tab .main .message .body')]"
        f".some((one) => one.textContent.includes({json.dumps(words)}))"
    )


def type_in(page: Page, words: str, where: str = ".chat-tab .main .composer .cm-content") -> None:
    page.click(where)
    page.keyboard.type(words, delay=8)
    page.keyboard.press("Enter")


def row_of(page: Page, words: str):  # noqa: ANN201 - a locator
    return page.locator(".chat-tab .main .message", has=page.locator(".body", has_text=words)).first


# ---------------------------------------------------------------- the drive


def main() -> int:
    worker = Worker()
    with DRIVE.session(
        args=[
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
        ],
    ) as browser:
        worker.start()

        tokens = {email: worker.account(email) for email in NAMES}
        for email, name in NAMES.items():
            worker.request("/v1/me", tokens[email], {"name": name}, method="PATCH")
        space = worker.request("/v1/spaces", tokens[OWNER], {"name": SPACE})["space"]
        for email, role in ((MEMBER, "write"), (READER, "read")):
            worker.request(
                f"/v1/spaces/{space['id']}/share/invite", tokens[OWNER], {"email": email, "role": role}
            )
            link = worker.waits_for_mail(email, r"/join/([a-f0-9]+)", f"{email}'s invitation").group(1)
            worker.request(f"/v1/join/{link}", tokens[email], {})
        say(f"{SPACE} is shared with Lucile to write and Mia to read")

        _, owner = signed_in(browser, tokens[OWNER], "Emil")
        member_context, member = signed_in(browser, tokens[MEMBER], "Lucile")
        _, reader = signed_in(browser, tokens[READER], "Mia")

        # ── Emil makes a chat ────────────────────────────────────────────
        show_space(owner, "Emil", space["id"])
        wait(owner, "async () => (await window.nibApp.chats()).chats.ready", "[Emil] the chats' store", patience=40)
        owner.evaluate("async () => (await window.nibApp.chats()).makeChat()")
        chat = open_chat(owner, "Emil", "Chat")
        say(f"Emil made {chat['id']} at {chat['path']}")
        made = worker.query(f"select space_id, file_id from chats where id = '{chat['id']}'")
        if not made or made[0]["space_id"] != space["id"]:
            wrong(f"the account holds the chat as {made}")

        show_space(member, "Lucile", space["id"])
        open_chat(member, "Lucile", "Chat")
        show_space(reader, "Mia", space["id"])
        open_chat(reader, "Mia", "Chat")
        say("the chat is on all three devices")

        # ── Emil posts, Lucile sees it ───────────────────────────────────
        type_in(owner, "Hello **team**, the draft is up")
        took = came(member, has_row("Hello team, the draft is up"), "[Lucile] Emil's message")
        if took is not None:
            say(f"Lucile saw Emil's message after {took:.2f}s")
        came(reader, has_row("Hello team, the draft is up"), "[Mia] Emil's message")

        # ── Lucile replies, Emil sees the count ──────────────────────────
        row_of(member, "Hello team").hover()
        member.locator(".chat-tab [role=toolbar] button[aria-label='Reply']").click()
        wait(member, "() => !!document.querySelector('.chat-tab .replies .composer .cm-content')", "[Lucile] the replies pane")
        type_in(member, "Reading it tonight", ".chat-tab .replies .composer .cm-content")
        took = came(
            owner,
            "() => [...document.querySelectorAll('.chat-tab .main .message .replies .count')]"
            ".some((one) => one.textContent.trim() === '1')",
            "[Emil] the reply's count",
        )
        if took is not None:
            say(f"Emil saw the reply after {took:.2f}s")
        DRIVE.shot(member, "lucile-replies")

        # ── Lucile reacts, Emil sees it ──────────────────────────────────
        row_of(member, "Hello team").hover()
        emoji = member.locator(".chat-tab [role=toolbar] button.emoji").first
        picked = emoji.get_attribute("aria-label") or ""
        emoji.click()
        took = came(
            owner,
            "(emoji) => [...document.querySelectorAll('.chat-tab .main .reactions button')]"
            ".some((one) => one.textContent.includes(emoji))",
            "[Emil] Lucile's reaction",
            picked,
        )
        if took is not None:
            say(f"Emil saw {picked} after {took:.2f}s")

        # ── Emil edits, Lucile sees it ───────────────────────────────────
        owner.click(".chat-tab .main .composer .cm-content")
        owner.keyboard.press("ArrowUp")
        wait(owner, "() => !!document.querySelector('.chat-tab .main .composer .box.editing')", "[Emil] the edit")
        owner.keyboard.press("Control+a")
        owner.keyboard.type("Hello team, the second draft is up", delay=8)
        owner.keyboard.press("Enter")
        took = came(
            member,
            "() => [...document.querySelectorAll('.chat-tab .main .message .body')]"
            ".some((one) => one.textContent.includes('the second draft') && one.querySelector('.edited'))",
            "[Lucile] the edit, marked edited",
        )
        if took is not None:
            say(f"Lucile saw the edit after {took:.2f}s")

        # ── Emil deletes, Lucile sees it go ──────────────────────────────
        type_in(owner, "this one was a mistake")
        came(member, has_row("this one was a mistake"), "[Lucile] the mistake")
        row_of(owner, "this one was a mistake").click(button="right")
        owner.get_by_role("menuitem", name="Delete").click()
        took = came(
            member,
            "() => ![...document.querySelectorAll('.chat-tab .main .message .body')]"
            ".some((one) => one.textContent.includes('this one was a mistake'))",
            "[Lucile] the mistake gone",
        )
        if took is not None:
            say(f"Lucile saw it deleted after {took:.2f}s")
        DRIVE.shot(owner, "emil-chat")
        DRIVE.shot(member, "lucile-chat")

        # ── Unread and a mention, in Lucile's Chats panel ───────────────
        member.evaluate("() => window.nibApp.workspace.closeActive()")
        member.evaluate("() => window.nibApp.workspace.showPanel('chats')")
        wait(member, "() => !!document.querySelector('.chats .entry')", "[Lucile] the Chats panel")
        type_in(owner, "@Lucile could you look at the figures")
        took = came(
            member,
            "() => [...document.querySelectorAll('.chats .entry')].some((one) =>"
            " one.classList.contains('unread') && one.querySelector('.badge')?.textContent.trim() === '1')",
            "[Lucile] the chat unread, with a mention badge",
        )
        if took is not None:
            say(f"Lucile's panel showed the mention after {took:.2f}s")
        DRIVE.shot(member, "lucile-panel-mention")

        # ── Lucile offline, then back ────────────────────────────────────
        open_chat(member, "Lucile", "Chat")
        came(member, has_row("could you look at the figures"), "[Lucile] the mention, in the chat")
        member.bring_to_front()
        took = came(
            member,
            "() => [...document.querySelectorAll('.chats .entry')].every((one) =>"
            " !one.classList.contains('unread') && !one.querySelector('.badge'))",
            "[Lucile] the chat read, once it is open in front",
        )
        if took is not None:
            say(f"Lucile's panel showed the chat read after {took:.2f}s")
        member_context.set_offline(True)
        member.evaluate("() => window.dispatchEvent(new Event('offline'))")
        type_in(member, "Sent while offline")
        came(
            member,
            "() => [...document.querySelectorAll('.chat-tab .main .message.pending')]"
            ".some((one) => one.textContent.includes('Sent while offline'))",
            "[Lucile] the message waiting, with its clock",
        )
        DRIVE.shot(member, "lucile-offline")
        member.wait_for_timeout(3000)
        member_context.set_offline(False)
        member.evaluate("() => window.dispatchEvent(new Event('online'))")
        took = came(owner, has_row("Sent while offline"), "[Emil] the message sent offline", patience=40)
        if took is not None:
            say(f"Emil saw the offline message {took:.2f}s after Lucile came back")
        came(
            member,
            "() => !document.querySelector('.chat-tab .main .message.pending')",
            "[Lucile] the clock gone",
            patience=40,
        )
        owner.wait_for_timeout(2000)
        state = worker.request(f"/v2/chats/{chat['id']}/state", tokens[OWNER])
        placed = [one for one in state["messages"] if one["body"] == "Sent while offline"]
        if len(placed) != 1:
            wrong(f"the account placed the offline message {len(placed)} times")
        else:
            say("the account placed it exactly once")
        for page, label in ((owner, "Emil"), (member, "Lucile")):
            if rows_with(page, "Sent while offline") != 1:
                wrong(f"[{label}] draws the offline message {rows_with(page, 'Sent while offline')} times")

        # ── Mia only reads ───────────────────────────────────────────────
        came(reader, has_row("Sent while offline"), "[Mia] the conversation")
        if reader.locator(".chat-tab .main .composer").count():
            wrong("[Mia] has a composer in a chat she may only read")
        row_of(reader, "Hello team").hover()
        if reader.locator(".chat-tab [role=toolbar] button[aria-label='Reply']").count():
            wrong("[Mia] is offered Reply")
        refused = worker.request(
            f"/v2/chats/{chat['id']}/events",
            tokens[READER],
            {"events": [{"kind": "post", "id": "01MIA000000000000000000001", "message": "01MIA000000000000000000002", "body": "let me in"}]},
        )
        result = (refused.get("results") or [{}])[0]
        if "refused" not in result:
            wrong(f"the account placed Mia's post: {result}")
        else:
            say(f"the account refused Mia's post: {result['refused']}")
        DRIVE.shot(reader, "mia-reads")

    return DRIVE.verdict("a chat made, written in, reacted to, edited and deleted live between three browsers")


if __name__ == "__main__":
    sys.exit(main())
