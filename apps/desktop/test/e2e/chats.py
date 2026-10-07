"""A chat, against a store in memory, in light and dark and at a phone's width.

The chats' client store is another lane's (docs/chats.md 6.2, lane 4); until a Worker
drive of two browsers stands on it, the surfaces are driven against the store in memory
(lib/chats/view/fixture.svelte.ts), which applies every event with the same reducer the
account does. The drive opens a team's chat seeded with every kind of message and:

- photographs the chat: the head, day lines, groups, the New line, markdown, code, a
  poll, a pin, a gallery, a voice message, a file, a preview, reactions, receipts;
- sends a message with a mention and checks it lands, drawn as a mention;
- puts a reaction on through the hover bar's picker and takes it back;
- opens a message's replies, and replies;
- opens the lightbox and walks it;
- hears an arrival at the bottom;
- opens a chat of 100,000 messages and scrolls through it, counting frames;
- draws all of it again at a phone's width.

Serves the app from a Vite dev server of its own, since the modules are imported by
their paths, and drives it in headless Chromium.

    python apps/desktop/test/e2e/chats.py

Screenshots go beside this file under `shots/chats/`.
"""

from __future__ import annotations

import sys

from playwright.sync_api import Page

from harness import Drive

DRIVE = Drive(__file__, dev=True)
say, wrong = DRIVE.say, DRIVE.wrong
ORIGIN = DRIVE.origin

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

THESIS = "/spaces/Team/thesis.chat"

START = """
async () => {
  const { seeded } = await import('/src/lib/chats/view/seed.ts')
  const { useStore } = await import('/src/lib/chats/view/source.svelte.ts')
  const made = seeded()
  useStore(made.store)
  window.__chats = made
}
"""

OPEN = """
async (path) => {
  const { openChat } = await import('/src/lib/chats/view/open.ts')
  openChat(path)
}
"""


def wait_for(page: Page, expression: str, what: str, patience: float = 30) -> bool:
    return DRIVE.waited(page, expression, what, patience)


def shot(page: Page, name: str) -> None:
    DRIVE.settled(page)
    DRIVE.shot(page, name)


def rows(page: Page) -> int:
    return page.evaluate("() => document.querySelectorAll('.chat-tab .message').length")  # type: ignore[no-any-return]


def composer_type(page: Page, words: str) -> None:
    page.click(".chat-tab .composer .cm-content")
    page.keyboard.type(words, delay=10)


def desktop(page: Page, scheme: str) -> None:
    DRIVE.open(page)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.evaluate(START)
    page.evaluate("() => window.nibApp.workspace.showPanel('chats')")
    page.evaluate(OPEN, THESIS)
    if not wait_for(page, "document.querySelectorAll('.chat-tab .message').length > 4", "the chat's rows"):
        return
    wait_for(page, "document.querySelector('.chat-tab .new')", "the New line")
    wait_for(page, "document.querySelector('.chats .entry')", "the Chats panel's rows")
    shot(page, f"{scheme}-01-chat")

    # Up through the history: the gallery, the poll, the code.
    page.evaluate("() => { const box = document.querySelector('.chat-tab .scroller'); box.scrollTop = 0 }")
    DRIVE.settled(page)
    page.wait_for_timeout(300)
    shot(page, f"{scheme}-02-history")
    for what, selector in [
        ("a poll", ".chat-tab .poll"),
        ("a pinned message's reactions", ".chat-tab .reactions"),
        ("code", ".chat-tab .body pre"),
        ("a mention of a note", ".chat-tab .body"),
    ]:
        if not page.query_selector(selector):
            wrong(f"no {what} in the chat")

    # A message with a mention.
    page.evaluate("() => { const box = document.querySelector('.chat-tab .scroller'); box.scrollTop = box.scrollHeight }")
    composer_type(page, "Thanks @Lu")
    wait_for(page, "document.querySelector('.mentions')", "the mention menu")
    shot(page, f"{scheme}-03-mention")
    page.keyboard.press("Enter")
    page.keyboard.type("I'll read it **today**", delay=5)
    page.keyboard.press("Enter")
    if wait_for(
        page,
        "[...document.querySelectorAll('.chat-tab .message .body')].some((one) => one.textContent.includes('read it today'))",
        "the message to land",
    ):
        mention = page.evaluate(
            "() => [...document.querySelectorAll('.chat-tab .message .mention')].map((one) => one.textContent)"
        )
        if "@Lucile" not in mention:
            wrong(f"the mention is not drawn as one: {mention}")
        bold = page.evaluate(
            "() => [...document.querySelectorAll('.chat-tab .message .body strong')].some((one) => one.textContent === 'today')"
        )
        if not bold:
            wrong("the markdown was not drawn")
    wait_for(page, "!document.querySelector('.chat-tab .message.pending')", "the post to be placed")

    # The hover bar, and a reaction through the picker.
    last = page.query_selector_all(".chat-tab .message")[-1]
    last.hover()
    wait_for(page, "document.querySelector('.chat-tab .bar[role=toolbar]')", "the hover bar")
    shot(page, f"{scheme}-04-hover")
    page.click(".chat-tab .bar[role=toolbar] button[aria-label='Add reaction']")
    wait_for(page, "document.querySelector('.float .picker .cell')", "the emoji picker")
    page.keyboard.type("rocket", delay=10)
    wait_for(page, "document.querySelector('.float .picker .cell.lit')", "a found emoji")
    shot(page, f"{scheme}-05-picker")
    page.keyboard.press("Enter")
    if not wait_for(
        page,
        "[...document.querySelectorAll('.chat-tab .reactions .emoji')].some((one) => one.textContent === '🚀')",
        "the rocket on the message",
    ):
        return
    page.click(".chat-tab .reactions .chip.mine")
    wait_for(
        page,
        "![...document.querySelectorAll('.chat-tab .reactions .emoji')].some((one) => one.textContent === '🚀')",
        "the rocket taken back",
    )

    # Replies.
    page.evaluate("() => { const box = document.querySelector('.chat-tab .scroller'); box.scrollTop = 0 }")
    DRIVE.settled(page)
    if wait_for(page, "document.querySelector('.chat-tab .message .replies')", "a message with replies"):
        page.click(".chat-tab .message .replies")
        wait_for(page, "document.querySelectorAll('aside.replies .message').length >= 3", "the replies")
        page.keyboard.type("On it", delay=10)
        page.keyboard.press("Enter")
        wait_for(
            page,
            "[...document.querySelectorAll('aside.replies .message .body')].some((one) => one.textContent.includes('On it'))",
            "the reply",
        )
        shot(page, f"{scheme}-06-replies")
        page.keyboard.press("Escape")
        wait_for(page, "!document.querySelector('aside.replies')", "the replies to close")

    # The lightbox.
    if wait_for(page, "document.querySelector('.chat-tab .grid .cell')", "a gallery"):
        page.query_selector(".chat-tab .grid .cell").scroll_into_view_if_needed()
        page.click(".chat-tab .grid .cell")
        wait_for(page, "document.querySelector('.lightbox img')", "the lightbox")
        page.keyboard.press("ArrowRight")
        shot(page, f"{scheme}-07-lightbox")
        page.keyboard.press("Escape")
        wait_for(page, "!document.querySelector('.lightbox')", "the lightbox to close")

    # An arrival at the bottom.
    page.evaluate("() => { const box = document.querySelector('.chat-tab .scroller'); box.scrollTop = box.scrollHeight }")
    DRIVE.settled(page)
    page.evaluate(
        "() => window.__chats.store.speak(window.__chats.thesis, 'user:mia', 'Arrived just now')"
    )
    if wait_for(
        page,
        "[...document.querySelectorAll('.chat-tab .message .body')].some((one) => one.textContent.includes('Arrived just now'))",
        "the arrival",
    ):
        bottom = page.evaluate(
            "() => { const box = document.querySelector('.chat-tab .scroller'); return box.scrollHeight - box.scrollTop - box.clientHeight }"
        )
        if bottom > 8:
            wrong(f"an arrival at the bottom left the reader {bottom}px above it")


BIG = """
async () => {
  const { bigChat } = await import('/src/lib/chats/view/seed.ts')
  const { useStore } = await import('/src/lib/chats/view/source.svelte.ts')
  const made = bigChat(100000)
  useStore(made.store)
  const { openChat } = await import('/src/lib/chats/view/open.ts')
  const started = performance.now()
  openChat('/spaces/Team/big.chat')
  await new Promise((go) => {
    const look = () => document.querySelectorAll('.chat-tab .message').length > 5 ? go() : requestAnimationFrame(look)
    look()
  })
  return performance.now() - started
}
"""

SCROLL = """
async () => {
  const box = document.querySelector('.chat-tab .scroller')
  const frames = []
  let last = performance.now()
  const until = last + 3000
  await new Promise((go) => {
    const step = (now) => {
      frames.push(now - last)
      last = now
      box.scrollTop -= 240
      if (now < until) requestAnimationFrame(step)
      else go()
    }
    requestAnimationFrame(step)
  })
  const sorted = frames.slice(5).sort((a, b) => a - b)
  return {
    frames: frames.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    rows: document.querySelectorAll('.chat-tab .message').length,
  }
}
"""


def big(page: Page) -> None:
    DRIVE.open(page)
    took = page.evaluate(BIG)
    say(f"a chat of 100,000 messages drew its rows in {took:.0f} ms")
    measured = page.evaluate(SCROLL)
    say(f"scrolling: {measured}")
    if measured["rows"] > 120:
        wrong(f"{measured['rows']} rows in the page; the window should hold about sixty")
    if measured["median"] > 20:
        wrong(f"a median frame of {measured['median']:.1f} ms while scrolling")


def phone(page: Page, scheme: str) -> None:
    DRIVE.open(page)
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    page.evaluate(START)
    page.evaluate(OPEN, THESIS)
    if not wait_for(page, "document.querySelectorAll('.chat-tab .message').length > 4", "the chat's rows"):
        return
    shot(page, f"{scheme}-08-phone")
    page.evaluate("() => { const box = document.querySelector('.chat-tab .scroller'); box.scrollTop = 0 }")
    if wait_for(page, "document.querySelector('.chat-tab .message .replies')", "a message with replies"):
        page.click(".chat-tab .message .replies")
        wait_for(page, "document.querySelectorAll('aside.replies .message').length >= 3", "the replies")
        shot(page, f"{scheme}-09-phone-replies")


def main() -> int:
    with DRIVE.session() as browser:
        for scheme in ("light", "dark"):
            say(f"-- {scheme}")
            page = DRIVE.page(
                browser,
                viewport={"width": 1280, "height": 820},
                color_scheme=scheme,
                reduced_motion="reduce",
            )
            desktop(page, scheme)
            page.context.close()
            page = DRIVE.page(
                browser,
                viewport={"width": 390, "height": 844},
                color_scheme=scheme,
                reduced_motion="reduce",
                has_touch=True,
                is_mobile=True,
            )
            phone(page, scheme)
            page.context.close()
        say("-- 100,000 messages")
        page = DRIVE.page(browser, viewport={"width": 1280, "height": 820})
        big(page)
        page.context.close()
    return DRIVE.verdict("all good")


if __name__ == "__main__":
    raise SystemExit(main())
