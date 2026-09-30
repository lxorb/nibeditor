"""Settings > Agents, over the crate's stand-in, in light, dark and Arabic.

A browser has no crate, so the drive puts `agents/settings/fake.ts` in front of the
pane (`window.nibApp.agents.standIn()`), filled the way a week of use would be: two
of the reader's own clients and a script given a token. Then, in each of the three
looks, it opens the pane and photographs the list, one agent from the top to the
foot, and one session opened as its calls.

What it checks on the way, and fails on: the trifecta line is on the agent that reads
notes and browses, and not on the one that does not; a switch pressed is in the
crate's grant, and so is what it needs; a site typed as an address is kept as its
site; a right-to-left language turns the pane round.

Build first, with the app's own handle on the page:

    NODE_ENV=development pnpm --filter @nib/desktop exec vite build --mode drive

Then, from the repository root:

    python apps/desktop/test/e2e/agents-settings.py

Screenshots go beside this file under `shots/agents-settings/`, which is ignored.
"""

from __future__ import annotations

import functools
import http.server
import os
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from settling import quiet  # noqa: E402

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = APP / "test" / "e2e" / "shots" / "agents-settings"

# Above 18000, and not a port any other drive here uses.
PORT = 23871
ORIGIN = f"http://127.0.0.1:{PORT}"

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)

# The three looks: the scheme, and the language the interface is in.
LOOKS = [("light", "en"), ("dark", "en"), ("light", "ar")]

OPEN = """
async () => {
  window.agentsFake = window.nibApp.agents.standIn()
  window.nibApp.settings.show('agents')
}
"""

GRANT = """
(id) => JSON.parse(JSON.stringify(window.agentsFake.grants.find((one) => one.id === id)))
"""

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(what: str, held: bool) -> None:
    say(f"{'ok  ' if held else 'FAIL'} {what}")
    if not held:
        failures.append(what)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: object) -> None:  # noqa: D102
        return


class Server(http.server.ThreadingHTTPServer):
    # A page asks for every chunk of its first paint at once, and Windows refuses a
    # connection past the listening queue rather than holding it: the default of five
    # turned a busy machine's load into a page that never started.
    request_queue_size = 256


class Pages:
    """The built page, served."""

    def __init__(self) -> None:
        handler = functools.partial(Quiet, directory=str(APP / "dist"))
        self.server = Server(("127.0.0.1", PORT), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self) -> None:
        self.thread.start()
        say(f"serving {APP / 'dist'} on {ORIGIN}")

    def stop(self) -> None:
        self.server.shutdown()


def body_to(page, where: str) -> None:
    """Scrolls the pane's column to the top, the middle or the foot."""
    page.evaluate(
        """(where) => {
          const body = document.querySelector('.sheet .body')
          if (!body) return
          const end = body.scrollHeight - body.clientHeight
          body.scrollTop = where === 'top' ? 0 : where === 'middle' ? end / 2 : end
        }""",
        where,
    )
    quiet(page)


def look(browser, scheme: str, language: str) -> None:
    name = f"{scheme}-{language}"
    context = browser.new_context(
        viewport={"width": 1280, "height": 860},
        user_agent=DESKTOP_AGENT,
        color_scheme=scheme,
        reduced_motion="reduce",
        device_scale_factor=2,
    )
    context.add_init_script(f"localStorage.setItem('nib:language', {language!r})")
    page = context.new_page()
    page.set_default_timeout(8000)
    page.on("pageerror", lambda error: say(f"[{name}] page error: {error}"))
    page.on("console", lambda said: say(f"[{name}] {said.type}: {said.text[:200]}") if said.type == "error" else None)
    page.goto(ORIGIN, wait_until="domcontentloaded")
    try:
        page.wait_for_function("() => !!window.nibApp", timeout=60000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"{name}-stuck.png"))
        raise
    page.wait_for_function("() => !!window.nibApp.workspace.activeSpace", timeout=60000)
    page.wait_for_function("() => !!window.nibApp.agents", timeout=60000)

    page.evaluate(OPEN)
    page.wait_for_selector(".agents .agent")
    quiet(page)

    def shot(tag: str) -> None:
        path = SHOTS / f"{name}-{tag}.png"
        page.screenshot(path=str(path))
        say(f"[{name}] {path.name}")

    rows = page.locator(".agents .agent").count()
    check(f"[{name}] the list holds the three agents", rows == 3)
    direction = page.evaluate("() => document.documentElement.dir || 'ltr'")
    check(
        f"[{name}] the interface reads {'right to left' if language == 'ar' else 'left to right'}",
        direction == ("rtl" if language == "ar" else "ltr"),
    )
    shot("list")

    # Codex was granted no browser: no trifecta.
    page.locator(".agents .agent", has_text="Codex").click()
    page.wait_for_selector(".agents .who")
    quiet(page)
    check(f"[{name}] no trifecta line on an agent with no browser", page.locator(".trifecta").count() == 0)
    page.locator(".agents .back").click()
    page.wait_for_selector(".agents .agent")
    quiet(page)

    page.locator(".agents .agent", has_text="Claude Code").click()
    page.wait_for_selector(".agents .who")
    quiet(page)
    check(f"[{name}] the trifecta line is on the agent that reads and browses", page.locator(".trifecta").count() == 1)
    body_to(page, "top")
    shot("agent-top")

    page.locator(".agents .session").first.click()
    page.wait_for_selector(".agents .calls li")
    quiet(page)
    shot("session")
    page.locator(".agents .session").first.click()
    quiet(page)

    if language == "en":
        # A switch pressed is in the crate, with what it needs: scripts need a browser,
        # and Claude Code's is on, so scripts alone come on.
        page.locator(".agents [role=switch]", has_text="Run scripts in pages").click()
        page.wait_for_timeout(200)
        grant = page.evaluate(GRANT, "claude-code")
        check(f"[{name}] a switch pressed is in the crate's grant", "browser.script" in grant["scopes"])

        # Turning the reader's tabs off takes their cookies with them.
        page.locator(".agents [role=switch]", has_text="Read your cookies").click()
        page.wait_for_timeout(200)
        page.locator(".agents [role=switch]", has_text="Act in your tabs").click()
        page.wait_for_timeout(200)
        grant = page.evaluate(GRANT, "claude-code")
        check(
            f"[{name}] what needed a scope goes with it",
            "browser.reader" not in grant["scopes"] and "browser.storage" not in grant["scopes"],
        )

        # A site typed as an address from the bar is kept as its site.
        field = page.locator(".agents .card .add").nth(1)
        field.press_sequentially("https://login.bank2.example/sign-in?next=/")
        field.press("Enter")
        page.wait_for_function(
            "() => !!window.agentsFake.grants.find((one) => one.id === 'claude-code').sites['bank2.example']"
        )
        grant = page.evaluate(GRANT, "claude-code")
        check(f"[{name}] a typed address is kept as its site", grant["sites"].get("bank2.example") == "deny")

    body_to(page, "middle")
    shot("agent-middle")
    body_to(page, "foot")
    shot("agent-foot")

    context.close()


def main() -> int:
    if not (APP / "dist" / "index.html").exists() and not os.environ.get("NIB_SKIP_BUILD"):
        raise SystemExit("build the app first; see the top of this file")

    SHOTS.mkdir(parents=True, exist_ok=True)
    pages = Pages()
    pages.start()
    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                for scheme, language in LOOKS:
                    look(browser, scheme, language)
            finally:
                browser.close()
    finally:
        pages.stop()

    say(f"shots in {SHOTS}")
    if failures:
        say(f"{len(failures)} failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
