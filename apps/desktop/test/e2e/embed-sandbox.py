"""What an embed still does without `allow-same-origin`, measured against the real
providers.

The question this answers is not a regression: it is a decision. Every one of the nine
hand-written provider rows in packages/markdown/src/providers.ts asks for
`allow-same-origin`, and the comment beside it says why that is not the hole it reads
as - with a cross-origin `src` the token grants the frame *its own* origin rather than
the page's. The broad list behind those nine asks for no such thing: a row nobody has
driven gets `allow-scripts` and nothing else, which is what this drive is the argument
for. That is true, and it
leaves one case: a frame whose address is the app's own origin. On the web app,
`https://<the app's own host>/anything` is a card a note can write, and a frame that
is same-origin with the page *and* holds `allow-scripts allow-same-origin` is not
sandboxed at all - it can reach the app's DOM, its storage and its session.

There are two ways out and they cost different things. Refusing a frame whose origin
is the app's own costs nothing and no provider notices. Dropping the token costs
whatever the providers need it for, which nobody has measured - hence this drive.

So: the four subjects, twice each.

    YouTube     provider card, allow-scripts allow-same-origin allow-presentation
    Vimeo       the same sandbox
    CodePen     allow-scripts allow-same-origin
    example.com an `<iframe>` the note wrote by hand, which already gets
                allow-scripts and nothing else - the control, and the proof that
                this drive can tell a frame that loaded from one that did not

The first pass is the app exactly as it ships. The second is the same app with one
token taken out of every frame on its way to the DOM, before it loads: nothing in
`dist` is edited, and the drive reads the attribute back off each frame so a pass
that did not actually remove anything says so rather than reporting a result.

What is measured, per frame: whether the document inside loaded at all, what it
says, whether a `<video>` reached a playing state after the provider's own play
button was pressed, and every console message the frame logged - which is where an
opaque origin shows up, as a SecurityError about storage.

This drive talks to YouTube, Vimeo and CodePen over the network. It is not part of
`run-all.py` for that reason: it is evidence for a decision, run when the decision
is being made.

Run it from the repository root:

    python apps/desktop/test/e2e/embed-sandbox.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/embed-sandbox/`.
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

from playwright.sync_api import Browser, ConsoleMessage, Frame, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "embed-sandbox"

# In the range this machine keeps for an agent's own servers, and nowhere near the
# dev server's 1420 or the other drives' ports.
PORT = 22141
ORIGIN = f"http://127.0.0.1:{PORT}"

# A video that has been the example in every embed test since embeds were invented,
# a Vimeo staff pick that has been up for a decade, and a pen of Chris Coyier's.
YOUTUBE = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
VIMEO = "https://vimeo.com/76979871"
CODEPEN = "https://codepen.io/chriscoyier/pen/gfdDu"
PLAIN = "https://example.com/"

NOTE = f"""# Embeds, sandboxed

![]({YOUTUBE})

![]({VIMEO})

![]({CODEPEN})

<iframe src="{PLAIN}" height="240"></iframe>
"""

SEED = """
async (note) => {
  const ws = window.nibApp.workspace
  await ws.noteFrom(note, ws.activeSpace.root)
  await ws.loadTree()
  const found = ws.notes.find((one) => one.name.startsWith('Embeds'))
  await ws.openEntry(found.path, { activate: true })
  return found.name
}
"""

# One token out of every frame, before the browser loads it. Patched on the
# prototypes rather than in the app, so what runs is the built app: an element the
# app hands a sandbox to is an element the app built, whichever way it sets it.
WITHOUT_SAME_ORIGIN = """
(() => {
  const drop = (value) =>
    String(value)
      .split(/\\s+/)
      .filter((one) => one && one !== 'allow-same-origin')
      .join(' ')

  const setAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'sandbox') {
      return setAttribute.call(this, name, drop(value))
    }
    return setAttribute.call(this, name, value)
  }

  const add = DOMTokenList.prototype.add
  DOMTokenList.prototype.add = function (...tokens) {
    return add.apply(
      this,
      tokens.filter((one) => one !== 'allow-same-origin'),
    )
  }

  const sandbox = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'sandbox')
  if (sandbox?.set) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'sandbox', {
      ...sandbox,
      set(value) {
        sandbox.set.call(this, drop(value))
      },
    })
  }
})()
"""

# Whatever is inside the frame, as far as the frame will say.
INSIDE = """
() => {
  const video = document.querySelector('video')
  const words = (document.body?.innerText ?? '').trim().replace(/\\s+/g, ' ')

  // What the token actually buys the frame, asked directly. With it the frame has
  // its own origin and its own storage; without it the origin is opaque and the
  // first line of somebody's player bundle throws.
  const reaching = (read) => {
    try {
      read()
      return 'ok'
    } catch (error) {
      return error instanceof Error ? error.name : 'threw'
    }
  }

  return {
    title: document.title,
    words: words.slice(0, 200),
    storage: reaching(() => localStorage.length),
    cookies: reaching(() => document.cookie),
    video: !!video,
    ready: video?.readyState ?? null,
    time: video ? Math.round(video.currentTime * 100) / 100 : null,
    paused: video?.paused ?? null,
    duration: video && Number.isFinite(video.duration) ? Math.round(video.duration) : null,
    // What a player puts where the video should be when it will not play.
    broken: [
      ...document.querySelectorAll('.ytp-error, .vp-sidedock .error, [class*="error-message"]'),
    ]
      .map((one) => one.textContent?.trim().slice(0, 120))
      .filter(Boolean),
  }
}
"""

SUBJECTS = [
    ("youtube", "YouTube", ".ytp-large-play-button, .ytp-play-button, button.ytp-cued-thumbnail-overlay-image"),
    ("vimeo", "Vimeo", "button[data-play-button], .vp-controls .play, button[aria-label*='Play']"),
    ("codepen", "CodePen", None),
    ("page", "a plain iframe", None),
]

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(what: str) -> None:
    say(f"FAILED: {what}")
    failures.append(what)


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") and (DIST / "index.html").exists():
        say("reusing the build that is there")
        return

    say("building the web app")
    shutil.rmtree(DIST, ignore_errors=True)
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "drive"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if built.returncode != 0:
        raise SystemExit(f"the build failed:\n{built.stdout}\n{built.stderr}")


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
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


def opened(browser: Browser, same_origin: bool, logs: list[str]) -> Page:
    """The app, with the note in it, either as it ships or one token short."""
    context = browser.new_context(viewport={"width": 1180, "height": 900}, color_scheme="light")
    page = context.new_page()

    def heard(message: ConsoleMessage) -> None:
        where = message.location.get("url", "") or ""
        if ORIGIN in where:
            return
        logs.append(f"[{message.type}] {message.text[:180]}")

    page.on("console", heard)
    if not same_origin:
        page.add_init_script(WITHOUT_SAME_ORIGIN)

    page.goto(ORIGIN, wait_until="domcontentloaded")
    wait_for(page, "window.nibApp", "the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", "a space")
    page.evaluate(SEED, NOTE)
    wait_for(page, "window.nib && document.querySelector('.cm-content')", "the editor")

    # The reading view, where all four cards are laid out at once.
    page.evaluate("() => window.nibApp.workspace.toggleReading()")
    page.wait_for_timeout(1200)
    return page


def frame_of(page: Page, provider: str) -> Frame | None:
    """The frame a card holds, found by the element it was built into."""
    handle = page.query_selector(f'.embed-web[data-provider="{provider}"] iframe')
    return handle.content_frame() if handle else None


def measure(page: Page, provider: str, name: str, play: str | None, logs: list[str]) -> dict:
    """One card: pressed, framed, and asked what it managed to do."""
    card = f'.embed-web[data-provider="{provider}"]'
    if not page.query_selector(card):
        wrong(f"{name}: the note has no card for it")
        return {"provider": provider, "card": False}

    page.eval_on_selector(card, "(one) => one.scrollIntoView({ block: 'center' })")
    page.click(card)
    page.wait_for_timeout(1500)

    said = page.eval_on_selector(
        card,
        """(one) => {
          const frame = one.querySelector('iframe')
          return frame
            ? {
                src: frame.getAttribute('src'),
                sandbox: frame.getAttribute('sandbox'),
                asked: one.dataset.sandbox ?? '',
              }
            : null
        }""",
    )
    if not said:
        wrong(f"{name}: a click on the card loaded no frame")
        return {"provider": provider, "card": True, "frame": False}

    out: dict = {
        "provider": provider,
        "card": True,
        "frame": True,
        "src": said["src"],
        "sandbox": said["sandbox"],
        "asked": said["asked"],
    }

    inner = frame_of(page, provider)
    if inner is None:
        out["loaded"] = False
        return out

    # The document inside, once it has had time to be one. A cross-origin frame is
    # still a frame Playwright can ask, whatever its origin is.
    try:
        inner.wait_for_load_state("domcontentloaded", timeout=20000)
    except Exception as error:  # noqa: BLE001 - what is wanted is the reason, as words
        out["load_error"] = str(error)[:160]

    before = len(logs)
    if play:
        # The provider's own button, which is what a reader presses. A frame that
        # will not play at all is a frame where this finds nothing, and that is an
        # answer rather than a failure of the drive.
        try:
            inner.wait_for_selector(play, timeout=15000, state="visible")
            inner.click(play, timeout=5000)
        except Exception as error:  # noqa: BLE001
            out["play_error"] = str(error)[:160]

        page.wait_for_timeout(6000)
    else:
        page.wait_for_timeout(4000)

    try:
        out.update(inner.evaluate(INSIDE))
    except Exception as error:  # noqa: BLE001
        out["inside_error"] = str(error)[:160]

    out["said"] = logs[before:][:6]
    return out


def pass_over(browser: Browser, same_origin: bool) -> list[dict]:
    logs: list[str] = []
    page = opened(browser, same_origin, logs)
    which = "as it ships" if same_origin else "without allow-same-origin"
    say(f"--- {which} ---")

    found: list[dict] = []
    for provider, name, play in SUBJECTS:
        seen = measure(page, provider, name, play, logs)
        found.append(seen)

        # What arrived against what the card asked for: the shipped pass must change
        # nothing, and the other must differ by exactly one token. A card that never
        # asked for `allow-same-origin` - a page nobody vouched for - is the same
        # sandbox in both passes, which is the control this drive needs.
        if seen.get("sandbox") is not None:
            asked = (seen.get("asked") or "").split()
            want = asked if same_origin else [one for one in asked if one != "allow-same-origin"]
            if (seen["sandbox"] or "").split() != want:
                wrong(
                    f"{name}: the frame's sandbox is {seen['sandbox']!r} where the card asked"
                    f" for {seen.get('asked')!r} - this pass wanted {' '.join(want)!r}"
                )

        say(f"{name}: {json.dumps({k: v for k, v in seen.items() if k != 'said'})}")
        for line in seen.get("said", []):
            say(f"    {line}")

    shot(page, "shipped" if same_origin else "without")
    page.context.close()
    return found


def plays(seen: dict) -> str:
    """One line for what the frame managed, read off what it said."""
    if not seen.get("frame"):
        return "no frame"
    if not seen.get("title") and not seen.get("words"):
        return "nothing loaded"
    if seen.get("broken"):
        return f"refused: {seen['broken'][0]}"

    store = f"storage {seen.get('storage')}"
    if seen.get("video"):
        moving = (seen.get("time") or 0) > 0 and seen.get("paused") is False
        if moving:
            return f"a player, playing ({seen['time']}s in), {store}"
        return f"a player, not playing (readyState {seen.get('ready')}), {store}"

    if not (seen.get("words") or "").strip():
        return f"the document, no player built, {store}"

    return f"loaded: {(seen.get('title') or '')[:40]}, {store}"


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                shipped = pass_over(browser, same_origin=True)
                without = pass_over(browser, same_origin=False)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    print("\n  what each embed did:")
    print(f"    {'':<16}{'as it ships':<56}without allow-same-origin")
    for (provider, name, _), left, right in zip(SUBJECTS, shipped, without, strict=True):
        print(f"    {name:<16}{plays(left):<56}{plays(right)}")

    if failures:
        print(f"\n  {len(failures)} thing(s) the drive itself could not do:")
        for one in failures:
            print(f"    - {one}")

    print(
        "\n  This drive reports; it decides nothing. Whether the token comes off the"
        "\n  provider table is Emil's, and the cheaper half of the same question -"
        "\n  refusing a frame whose origin is the app's own - costs no provider"
        "\n  anything at all."
    )
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
