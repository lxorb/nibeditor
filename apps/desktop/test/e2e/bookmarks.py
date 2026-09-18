"""Bookmarks in groups, and a bookmark of one block, seen: a named group that
opens and shuts, a note inside it stepped in under its twist, and a block
bookmark that opens its note and says where it landed.

Serves the built web app and drives it in the machine's own Chrome. The build has
to be one a drive may steer - `--mode drive` - or `window.nib` and `window.nibApp`
are not there.

Run it from the repository root:

    python apps/desktop/test/e2e/bookmarks.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots
go beside this file under `shots/bookmarks/`.
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

from playwright.sync_api import Browser, Page, sync_playwright

HERE = Path(__file__).resolve().parent
APP = HERE.parent.parent
DIST = APP / "dist"
SHOTS = HERE / "shots" / "bookmarks"

# Not the dev server's 1420, and not the other drives' ports either.
PORT = 18965
ORIGIN = f"http://127.0.0.1:{PORT}"

PLAN = """# The plan

A first paragraph nobody points at.

The paragraph that gets a bookmark of its own.

## Later

Something for later.
"""

OTHER = "# Other\n\nA second note.\n"

SEED = """
async ([plan, other]) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom(plan, root)
  await ws.noteFrom(other, root)
  await ws.loadTree()
  return ws.notes.map((one) => one.name)
}
"""

ROWS = """
() => [...document.querySelectorAll('.body .line')].map((line) => {
  const row = line.querySelector('.row')
  return {
    label: row?.querySelector('.nib-row-label')?.textContent ?? '',
    note: row?.querySelector('.nib-row-meta')?.textContent ?? null,
    twist: !!line.querySelector('.twist'),
    open: line.querySelector('.twist')?.getAttribute('aria-expanded') ?? null,
    // Where the name starts, which is what the eye reads the nesting off.
    left: Math.round(
      row?.querySelector('.nib-row-label')?.getBoundingClientRect().left ?? 0,
    ),
  }
})
"""

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
    environment = {**os.environ, "NODE_ENV": "development"}
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


class Quiet(http.server.SimpleHTTPRequestHandler):
    """A file server that says nothing and is never cached."""

    def log_message(self, format: str, *args: object) -> None:
        return

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


class Strict(socketserver.TCPServer):
    """Never reuses the address, so a run cannot photograph the last one."""

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
    say(f"shot {name}.png")


def fresh(browser: Browser, label: str, finger: bool = False) -> Page:
    context = browser.new_context(
        viewport={"width": 1280, "height": 820} if not finger else {"width": 420, "height": 880},
        color_scheme="light",
        has_touch=finger,
        is_mobile=finger,
        **(
            {}
            if not finger
            else {
                "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
                " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
            }
        ),
    )
    page = context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "window.nibApp", f"[{label}] the app")
    wait_for(page, "window.nibApp.workspace.activeSpace", f"[{label}] a space")
    say(f"[{label}] the space holds {page.evaluate(SEED, [PLAN, OTHER])}")

    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name.startsWith('The plan'))
          await ws.openEntry(note.path, {})
          if (ws.panel !== 'tree') ws.showPanel('tree')
        }"""
    )
    wait_for(page, "window.nib && document.querySelector('.cm-content')", f"[{label}] the editor")
    page.wait_for_timeout(600)
    return page


def drive_groups(browser: Browser) -> None:
    page = fresh(browser, "groups")

    # Two notes bookmarked, and a group made from the row's own menu.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          for (const name of ['The plan.md', 'Other.md']) {
            const note = ws.notes.find((one) => one.name === name)
            ws.bookmarks.toggle(ws.bookmarks.forEntry({ path: note.path, is_dir: false }))
          }
          const group = ws.bookmarks.addGroup('Work')
          const plan = ws.bookmarks.list.find((one) => one.path.startsWith('The plan'))
          ws.bookmarks.moveInto(plan, group.path)
          ws.openGroup(group.path)
        }"""
    )
    page.wait_for_timeout(500)

    rows = page.evaluate(ROWS)
    say(f"[groups] the list: {json.dumps(rows, ensure_ascii=False)}")
    shot(page, "01-a-group")

    names = [row["label"] for row in rows]
    if names != ["Other", "Work", "The plan"]:
        wrong(f"the list does not read as a group holding a note: {names}")

    group = rows[1]
    inside = rows[2]
    if not group["twist"] or group["open"] != "true":
        wrong("the group has no twist that says it is open")
    if inside["left"] <= group["left"]:
        wrong(f"what is in the group does not step in: {inside['left']} vs {group['left']}")

    # Shut, and what is in it goes with it.
    page.locator(".body .twist").first.click()
    page.wait_for_timeout(400)
    shut = page.evaluate(ROWS)
    say(f"[groups] shut: {json.dumps([row['label'] for row in shut])}")
    shot(page, "02-shut")
    if [row["label"] for row in shut] != ["Other", "Work"]:
        wrong(f"shutting the group left its rows behind: {[row['label'] for row in shut]}")

    # And the group is remembered as shut on this machine, not on the account.
    kept = page.evaluate(
        """() => ({
          groups: JSON.parse(localStorage.getItem('nib:expanded-groups') ?? '{}'),
          list: JSON.parse(localStorage.getItem('nib:bookmarks') ?? '{}'),
        })"""
    )
    say(f"[groups] written down: {json.dumps(kept['groups'])}")
    if json.dumps(kept["list"]).find("parent") < 0:
        wrong("the group a bookmark is in did not travel with the bookmark")

    # Taking the group out keeps what was in it.
    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const group = ws.bookmarks.list.find((one) => one.kind === 'group')
          ws.bookmarks.remove(group)
        }"""
    )
    page.wait_for_timeout(400)
    left = [row["label"] for row in page.evaluate(ROWS)]
    say(f"[groups] after the group went: {json.dumps(left)}")
    shot(page, "03-group-gone")
    if sorted(left) != ["Other", "The plan"]:
        wrong(f"taking the group out took its bookmarks with it: {left}")

    page.context.close()


def drive_block(browser: Browser) -> None:
    page = fresh(browser, "block")

    # The block's own mark, and the row it offers.
    line = page.locator(".cm-line", has_text="The paragraph that gets a bookmark").first
    line.hover()
    page.wait_for_timeout(250)
    line.locator(".nib-block-handle").click()
    page.wait_for_timeout(500)

    labels = page.evaluate(
        "() => [...document.querySelectorAll('.rows .nib-row')].map((row) => row.textContent.trim())"
    )
    say(f"[block] the menu: {json.dumps(labels[:8], ensure_ascii=False)}")
    shot(page, "10-the-menu")
    if not any("Bookmark this block" in one for one in labels):
        wrong("the block's menu does not offer to bookmark it")

    page.locator(".rows .nib-row", has_text="Bookmark this block").first.click()
    page.wait_for_timeout(600)

    kept = page.evaluate(
        """() => (window.nibApp.workspace.bookmarks.list.find((one) => one.kind === 'block') ?? null)"""
    )
    say(f"[block] the bookmark: {json.dumps(kept, ensure_ascii=False)}")
    shot(page, "11-bookmarked")

    if not kept:
        wrong("pressing the row kept nothing")
    elif not kept["path"].startswith("The plan.md#^"):
        wrong(f"the bookmark does not point into the note: {kept['path']}")
    elif kept["text"] != "The paragraph that gets a bookmark of its own.":
        wrong(f"the bookmark cannot be read in a list: {kept['text']!r}")

    if "^" not in page.evaluate("() => window.nib.state.doc.toString()"):
        wrong("the block was not given a name to point at")

    # Away to another note, then back through the bookmark: it lands on the block
    # and says so.
    page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name === 'Other.md')
          await ws.openEntry(note.path, {})
        }"""
    )
    page.wait_for_timeout(600)

    page.locator(".body .row", has_text="The paragraph that gets").first.click()
    page.wait_for_timeout(900)

    landed = page.evaluate(
        """() => ({
          note: window.nibApp.workspace.active?.name ?? null,
          line: window.nibApp.workspace.active?.line ?? null,
          marked: [...document.querySelectorAll('.cm-line.nib-landed')].map((one) =>
            one.textContent.trim().slice(0, 40),
          ),
        })"""
    )
    say(f"[block] where it landed: {json.dumps(landed, ensure_ascii=False)}")
    shot(page, "12-landed")

    if landed["note"] != "The plan.md":
        wrong(f"the bookmark did not open its note: {landed['note']}")
    if not landed["marked"]:
        wrong("nothing says which block it landed on")
    elif "The paragraph that gets a bookmark" not in landed["marked"][0]:
        wrong(f"the mark is on the wrong block: {landed['marked']}")

    page.wait_for_timeout(1600)
    if page.evaluate("() => document.querySelectorAll('.cm-line.nib-landed').length"):
        wrong("the mark is still there long after it was seen")
    shot(page, "13-mark-gone")

    page.context.close()


def drive_finger(browser: Browser) -> None:
    """A group under a thumb: the rows are a thumb tall and a tap opens one."""
    page = fresh(browser, "phone", finger=True)

    page.evaluate(
        """() => {
          const ws = window.nibApp.workspace
          const note = ws.notes.find((one) => one.name === 'The plan.md')
          ws.bookmarks.toggle(ws.bookmarks.forEntry({ path: note.path, is_dir: false }))
          const group = ws.bookmarks.addGroup('Work')
          const plan = ws.bookmarks.list.find((one) => one.path.startsWith('The plan'))
          ws.bookmarks.moveInto(plan, group.path)
          ws.openGroup(group.path)
          if (ws.panel !== 'tree') ws.showPanel('tree')
        }"""
    )
    page.wait_for_timeout(700)

    sizes = page.evaluate(
        """() => [...document.querySelectorAll('.body .line')].map((line) => ({
          label: line.querySelector('.nib-row-label')?.textContent ?? '',
          tall: Math.round(line.getBoundingClientRect().height),
          twist: Math.round(line.querySelector('.twist')?.getBoundingClientRect().height ?? 0),
        }))"""
    )
    say(f"[phone] the rows: {json.dumps(sizes, ensure_ascii=False)}")
    shot(page, "20-phone")

    for row in sizes:
        if row["tall"] < 44:
            wrong(f"a row is not a thumb tall: {row['label']!r} at {row['tall']}px")

    page.locator(".body .twist").first.tap()
    page.wait_for_timeout(500)
    left = page.evaluate(
        "() => [...document.querySelectorAll('.body .line .nib-row-label')]"
        ".map((one) => one.textContent)"
    )
    say(f"[phone] after the tap: {json.dumps(left, ensure_ascii=False)}")
    shot(page, "21-phone-shut")
    if "The plan" in left:
        wrong("a tap on the twist did not shut the group")

    page.context.close()


def main() -> int:
    build()
    shutil.rmtree(SHOTS, ignore_errors=True)
    server = serve()

    try:
        with sync_playwright() as play:
            browser = play.chromium.launch(channel="chrome")
            try:
                say("--- groups ---")
                drive_groups(browser)
                say("--- a block ---")
                drive_block(browser)
                say("--- a finger ---")
                drive_finger(browser)
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()

    if failures:
        print("\nFAILED", flush=True)
        for one in failures:
            print(f"  - {one}", flush=True)
        return 1

    print("\nbookmarks can be sorted into groups, and one can point at a block", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
