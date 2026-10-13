"""Whether the browser build's notes come over from the old address to the new one.

The web build moved from nibeditor.com to orden.so, and a browser keeps each origin's
storage apart: notes written at the old address and never synced are not visible at
the new one (see src/lib/web/handoff.ts). The new address's first visit offers one
row, "Notes from nibeditor.com", which opens the old address's /handoff page as a
popup; that page hands over everything its origin holds, and the new address starts
again from it.

Both addresses are played by one build on two local origins, `rebrand-old.localhost`
and `rebrand-new.localhost` on this drive's port, which the build is told about
(`VITE_NIB_LEGACY_WEB`, `VITE_NIB_WEB`). Checked:

- the old address offers nothing of the kind, and a note written there is a note;
- at the new address the row is there, and pressing it brings the note, the session
  and the settings over, signed in as before, with the question answered;
- a browser that never used the old address is told "Nothing there";
- a page on any other origin that opens /handoff is handed nothing.

    python apps/desktop/test/e2e/handoff.py
"""

from __future__ import annotations

import os
import subprocess
import time
from typing import Any

from playwright.sync_api import Browser, Page

from harness import APP, BUILD_PATIENCE, Drive, Files, tool

FOLDER = APP / "dist-handoff"
DRIVE = Drive(__file__, folder=FOLDER)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

PORT = DRIVE.server.port if DRIVE.server else 0
OLD = f"http://rebrand-old.localhost:{PORT}"
NEW = f"http://rebrand-new.localhost:{PORT}"
ELSEWHERE = f"http://rebrand-elsewhere.localhost:{PORT}"

#: The row, by the words it shows.
ROW = '.nib-setting:has-text("Notes from nibeditor.com")'

#: After the harness has answered the first-visit question for every context: this
#: drive is about the first visit, so the question is asked again - on a tab's first
#: page only, so the answer the handoff writes outlives the page starting again.
UNANSWERED = (
    "try { if (!sessionStorage.getItem('drive-unanswered')) {"
    " sessionStorage.setItem('drive-unanswered', '1');"
    " localStorage.removeItem('nib:first-visit') } } catch {}"
)

#: A session token as the app keeps one (lib/account.svelte.ts). Nothing behind it
#: answers, which is the point: what is checked is that it arrives.
SESSION = "handed-over-token"


def built() -> None:
    """The drive build, told which two origins play the old address and the new."""
    if os.environ.get("NIB_SKIP_BUILD") and (FOLDER / "index.html").exists():
        say(f"reusing the build in {FOLDER.name}")
        return
    say(f"building the web app into {FOLDER.name} for {OLD} and {NEW}")
    environment = {**os.environ, "VITE_NIB_WEB": NEW, "VITE_NIB_LEGACY_WEB": OLD}
    environment.pop("NODE_ENV", None)
    environment.pop("VITE_NIB_API", None)
    done = subprocess.run(
        [*tool(APP, "vite"), "build", "--mode", "drive", "--outDir", str(FOLDER), "--emptyOutDir"],
        cwd=APP,
        env=environment,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=BUILD_PATIENCE,
        check=False,
    )
    if done.returncode != 0:
        raise SystemExit(f"the build failed:\n{done.stdout}\n{done.stderr}")


@DRIVE.answers
def handoff_page(request: Files) -> bool:
    """`/handoff` is `handoff.html`, the way the assets router answers it."""
    if request.path.split("?", 1)[0] != "/handoff":
        return False
    return request.reply((FOLDER / "handoff.html").read_bytes())


def context(browser: Browser) -> Any:
    # A new reader's browser: nothing in it but what the harness answers for every
    # drive, which is taken back below.
    made = browser.new_context(viewport={"width": 1100, "height": 760}, first_look=True)
    made.add_init_script(UNANSWERED)
    # The service is somebody else's; nothing here asks it anything that matters.
    made.route("https://orden.so/**", lambda route: route.abort())
    made.route("https://nibeditor.com/**", lambda route: route.abort())
    return made


def opened(made: Any, origin: str) -> Page:
    page = made.new_page()
    page.on("pageerror", lambda error: wrong(f"page error at {origin}: {error}"))
    DRIVE.open(page, origin=origin)
    return page


def chooser(page: Page) -> None:
    wait_for(page, "document.querySelector('.nib-screen [data-lands]')", "the first visit's question")


def files(page: Page) -> list[str]:
    return page.evaluate(  # type: ignore[no-any-return]
        "async () => { await window.nibApp.workspace.loadTree(); return window.nibApp.workspace.notes.map((one) => one.name) }"
    )


def brought(browser: Browser) -> None:
    made = context(browser)

    say("the old address: a first visit, a note written, a session kept")
    old = opened(made, OLD)
    chooser(old)
    if old.locator(ROW).count():
        wrong("the old address offers to bring notes from itself")
    old.locator(".nib-screen [data-lands]").click()
    wait_for(old, "!document.querySelector('.nib-screen')", "the question to be answered")
    DRIVE.seed(old, "# Carried over\n\nWritten at the old address.\n")
    old.evaluate("(session) => localStorage.setItem('nib:session', session)", SESSION)
    old.evaluate("() => localStorage.setItem('nib:font-size', '19')")
    before = files(old)
    if not any(name.startswith("Carried over") for name in before):
        wrong(f"the note was never written at the old address: {before}")
    old.close()

    say("the new address: the row, pressed")
    new = opened(made, NEW)
    chooser(new)
    row = new.locator(ROW)
    if not row.count():
        wrong("the new address does not offer the old address's notes")
        shot(new, "01-no-row")
        return
    shot(new, "01-row")

    with new.expect_popup() as asked:
        row.locator("button").click()
    popup = asked.value
    if not popup.url.startswith(f"{OLD}/handoff"):
        wrong(f"the popup went to {popup.url}")

    # The page starts again once the notes are written: the handle it had is gone and
    # a new one comes up.
    wait_for(new, "localStorage.getItem('nib:font-size') === '19' && !window.nibApp", "the page to start again")
    DRIVE.ready(new)
    wait_for(new, "!document.querySelector('.nib-screen')", "the question to stay answered")

    after = files(new)
    if not any(name.startswith("Carried over") for name in after):
        wrong(f"the note did not come over: {after}")
    session = new.evaluate("() => localStorage.getItem('nib:session')")
    if session != SESSION:
        wrong(f"the session did not come over: {session}")
    if new.evaluate("() => localStorage.getItem('nib:font-size')") != "19":
        wrong("the settings did not come over")
    if new.evaluate("() => localStorage.getItem('nib:first-visit')") != "answered":
        wrong("the first visit's question is not answered after the handoff")
    shot(new, "02-brought")
    made.close()


def nothing(browser: Browser) -> None:
    say("a browser that never used the old address")
    made = context(browser)
    new = opened(made, NEW)
    chooser(new)
    with new.expect_popup():
        new.locator(ROW).locator("button").click()
    said = new.locator(ROW).locator(".value")
    said.wait_for(timeout=30_000)
    if said.text_content() != "Nothing there":
        wrong(f"the row said {said.text_content()!r} for an old address that held nothing")
    if any(name.startswith("Carried over") for name in files(new)):
        wrong("notes came from an old address that held none")
    shot(new, "03-nothing")
    made.close()


def elsewhere(browser: Browser) -> None:
    say("a page on another origin opens /handoff")
    made = context(browser)

    # Something at the old address worth taking.
    old = opened(made, OLD)
    old.evaluate("(session) => localStorage.setItem('nib:session', session)", SESSION)
    old.close()

    page = made.new_page()
    page.goto(f"{ELSEWHERE}/seed.html")
    page.evaluate(
        """(old) => {
          window.heard = []
          addEventListener('message', (event) => window.heard.push(event.origin))
          const button = document.createElement('button')
          button.textContent = 'open'
          button.onclick = () => window.open(`${old}/handoff`, 'x', 'popup')
          document.body.append(button)
        }""",
        OLD,
    )
    with page.expect_popup() as asked:
        page.click("button")
    asked.value.wait_for_event("close", timeout=15_000)
    time.sleep(1)
    heard = page.evaluate("() => window.heard")
    if heard:
        wrong(f"a page on another origin was handed the old address's storage: {heard}")
    made.close()


def drive(browser: Browser) -> None:
    brought(browser)
    nothing(browser)
    elsewhere(browser)


if __name__ == "__main__":
    built()
    raise SystemExit(DRIVE.run(drive, passed="the notes come over, and only to the new address"))
