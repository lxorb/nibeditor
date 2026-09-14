"""The order the file list is read in: all seven of them, and the drag that makes
the seventh.

A space of sixty files in nested folders, photographed in each order, then
rearranged by hand - once with a mouse, which is the drag the platform starts, and
once with a finger at phone width, which is the only gesture a touch screen has.
The browser is relaunched against the same profile afterwards, so the order
somebody arranged is proved to have survived being closed rather than merely
redrawn.

No Worker and no account: the browser build seeds its own space, and the rows are
written through `window.nibApp.workspace`. Builds the web app, serves `dist`
statically on a port of its own, shoots the panel, and stops everything again.
Nothing it makes outlives it but the screenshots, which go beside it under
`shots/`.

Run it from the repository root:

    python apps/desktop/test/e2e/tree-order.py

`NIB_SKIP_BUILD=1` reuses whatever is in `apps/desktop/dist`, which is what
run-all.py sets.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import BrowserContext, Page, sync_playwright

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
SHOTS = Path(__file__).resolve().parent / "shots" / "tree-order"

# A port of this run's own, well clear of the dev server's and of every other
# drive's.
PORT = 23641
ORIGIN = f"http://127.0.0.1:{PORT}"

# How long anything is waited for before the run gives up and says what it saw.
PATIENCE = 60

# What the seven rows of the order menu are called, in the order the menu offers
# them, and the word the store keeps each under.
ORDERS = [
    ("Name, A to Z", "name"),
    ("Name, Z to A", "name-desc"),
    ("Modified, newest first", "modified-desc"),
    ("Modified, oldest first", "modified-asc"),
    ("Created, newest first", "created-desc"),
    ("Created, oldest first", "created-asc"),
    ("Manual", "manual"),
]

problems: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    problems.append(words)
    print(f"  WRONG: {words}", flush=True)


def chromium() -> str:
    """The newest chromium Playwright has downloaded."""
    local = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    found = sorted(
        (path for path in local.glob("chromium-*/chrome-win*/chrome.exe")),
        key=lambda path: int(path.parents[1].name.split("-")[1]),
    )
    if not found:
        raise SystemExit("no chromium under %s" % local)

    return str(found[-1])


def build() -> None:
    if os.environ.get("NIB_SKIP_BUILD") == "1":
        say("reusing the build already in dist")
        return

    say("building the web app")
    # A production build hides the app's stores, and the rows below are written
    # through them.
    environment = {**os.environ, "NODE_ENV": "development"}
    built = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
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


def wait_for(page: Page, script: str, what: str, patience: int = PATIENCE):
    """Polls a page until the script answers with something truthy."""
    until = time.monotonic() + patience
    while time.monotonic() < until:
        answer = page.evaluate(script)
        if answer:
            return answer
        page.wait_for_timeout(50)

    raise SystemExit(f"gave up waiting for {what}")


def opened(context: BrowserContext, label: str) -> Page:
    page = context.pages[0] if context.pages else context.new_page()
    page.on("pageerror", lambda error: wrong(f"[{label}] page error: {error}"))
    page.goto(ORIGIN, wait_until="domcontentloaded")

    wait_for(page, "() => !!window.nibApp", f"[{label}] the app to start")
    wait_for(page, "() => !!window.nibApp.workspace.activeSpace", f"[{label}] a space")
    page.evaluate("() => { const ws = window.nibApp.workspace; if (ws.panel !== 'tree') ws.showPanel('tree') }")
    return page


# Sixty files in five folders, written in an order that is not their names' so that
# "created, oldest first" and "Name, A to Z" cannot be the same answer by accident.
# `Note 2` and `Note 10` are in there for the one thing a name order has to get
# right: the digits are counted, not spelled.
SEED = """
async (many) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)

  const write = async (name, folder) => {
    const made = await ws.noteFrom(`# ${name}\\n\\nwritten for the drive\\n`, folder)
    if (!made) throw new Error(`nothing written for ${name}`)
    return made
  }

  // Deliberately not in name order: zeta first, Note 12 before Note 2.
  const top = ['zeta', 'Note 12', 'Note 2', 'Note 10', 'Alpha', 'Note 1', 'beta', 'Note 3']
  for (const name of top) await write(name, root)

  for (const [folder, names] of Object.entries(many)) {
    for (const name of names) await write(name, at(folder))
  }

  await ws.createCanvas(root, 'Roadmap.canvas')
  await ws.loadTree()

  return ws.files.length
}
"""

# Which notes get written in again, so that the last-modified order is not the
# order they were made in. Through the document the editor writes, which is the
# only path that touches a file the way typing in it does.
TOUCH = """
async (names) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  const at = (name) => (root.endsWith('/') ? root + name : root + '/' + name)
  const done = []

  for (const name of names) {
    const path = at(`${name}.md`)
    await ws.openEntry(path)
    const doc = ws.documents.find((one) => one.path === path)
    if (!doc) continue

    doc.replace(`${doc.text}\\nwritten in again\\n`, true)
    await doc.flush()
    done.push(name)
  }

  await ws.loadTree()
  return done
}
"""

# The whole order, which is the app's own answer rather than the rows that happen to
# be mounted: the window draws twenty of sixty. Names only, and only the top of the
# space, which is what the shots show.
TOP_NAMES = """
() => {
  const ws = window.nibApp.workspace
  const root = ws.shownTree
  return root ? root.children.map((one) => one.name) : []
}
"""

# And the rows actually in the page, so a shot is never the only record.
DRAWN = """
() => [...document.querySelectorAll('aside .row[data-path]')].map((row) =>
  row.querySelector('.nib-row-label')?.textContent?.trim() ?? '')
"""

WHAT_IS_KEPT = """
() => {
  const ws = window.nibApp.workspace
  return {
    mode: ws.sortMode,
    arranged: ws.arranged.of(ws.activeSpace.root),
    stored: JSON.parse(localStorage.getItem('nib:list-order') ?? 'null'),
  }
}
"""


GLYPH = "aside button[aria-label='Order of the files']"


def open_menu(page: Page) -> None:
    page.locator(GLYPH).first.click()
    page.wait_for_selector("[role=menu] [role=menuitem]", timeout=PATIENCE * 1000)


def chosen(page: Page, label: str, mode: str) -> None:
    """Presses the glyph at the end of the panel's header and then the row for one
    order, which is the control a reader uses rather than the store behind it."""
    open_menu(page)
    page.locator("[role=menu] [role=menuitem]", has_text=label).first.click()
    page.wait_for_timeout(250)

    now = page.evaluate("() => window.nibApp.workspace.sortMode")
    if now != mode:
        wrong(f"pressing {label!r} left the order as {now!r} rather than {mode!r}")


def ticked(page: Page) -> list[str]:
    """The rows of the open menu, with a mark against the one in force."""
    return page.evaluate(
        """() => [...document.querySelectorAll('[role=menu] [role=menuitem]')].map((row) =>
             `${row.querySelector('.nib-row-label')?.textContent?.trim()}`
             + (row.querySelector('.tick') ? ' [tick]' : ''))"""
    )


def row(page: Page, name: str):
    """One row, by the path written on it. Never by the words in it: `Note 1` is a
    substring of `Note 10`, and the label may be the name without its ending."""
    return page.locator(f'aside .row[data-path$="/{name}"]').first


def rowbox(page: Page, name: str):
    box = row(page, name).bounding_box()
    if not box:
        raise SystemExit(f"no row on screen for {name}")
    return box


def desktop(playwright, profile: Path) -> list[str]:
    """The seven orders photographed, and one row dragged with a mouse."""
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=str(profile),
        executable_path=chromium(),
        headless=True,
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
    )
    try:
        page = opened(context, "desktop")

        held = page.evaluate(
            SEED,
            {
                "Reading": ["Chapter two", "Chapter one", "Notes on it", "Later", "Earlier"],
                "Reading/Deep": ["Attention", "Residuals", "Scaling", "Tokens"],
                "Work": ["Q3 plan", "Budget", "Hiring", "Retro", "Offsite", "Standup"],
                "Work/Q3": ["Week 2", "Week 10", "Week 1", "Week 20"],
                "Archive": ["Last year", "Older still", "Oldest of all"],
                # Enough to fill the window and then some: a panel shows about twenty
                # rows, so what is measured is a list the window is a slice of.
                "Archive/2025": [f"Day {index + 1}" for index in range(28)],
            },
        )
        say(f"the space holds {held} files in six folders")
        if held < 55:
            wrong(f"the seed made only {held} files, which is not a list worth windowing")

        written = page.evaluate(TOUCH, ["Note 12", "Alpha"])
        say(f"written in again, so the modified order is not the created one: {written}")

        # The menu itself, with the tick against the order in force. The default,
        # which Emil asked for by name.
        open_menu(page)
        for one in ticked(page):
            say(f"menu: {one}")
        page.screenshot(path=str(SHOTS / "order-menu.png"))
        say("wrote order-menu.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)

        orders: dict[str, list[str]] = {}
        for label, mode in ORDERS:
            chosen(page, label, mode)
            names = page.evaluate(TOP_NAMES)
            orders[mode] = names
            say(f"{mode}: {' | '.join(names)}")
            page.locator("aside").screenshot(path=str(SHOTS / f"order-{mode}.png"))

        # The one thing a name order has to get right.
        by_name = orders["name"]
        if by_name.index("Note 2.md") > by_name.index("Note 10.md"):
            wrong("Note 10 sorted before Note 2, so the digits were spelled rather than counted")

        deep = len(FOLDERS)
        for mode, names in orders.items():
            if sorted(names[:deep]) != sorted(FOLDERS):
                wrong(f"{mode} did not put the folders first: {names[:deep]}")

        # The folders are first in both name orders, so each group reverses rather
        # than the whole list.
        if orders["name-desc"][:deep] != list(reversed(by_name[:deep])) or orders["name-desc"][
            deep:
        ] != list(reversed(by_name[deep:])):
            wrong("Z to A was not A to Z backwards within each group")
        if orders["modified-asc"][deep:] != list(reversed(orders["modified-desc"][deep:])):
            wrong("the two modified orders were not each other backwards")
        if orders["created-asc"][deep:] != list(reversed(orders["created-desc"][deep:])):
            wrong("the two created orders were not each other backwards")
        if orders["modified-desc"] == orders["created-desc"]:
            wrong("the modified order and the created order were the same list")
        if orders["created-asc"] == by_name:
            wrong("the created order was name order, so the seed proved nothing")
        if orders["manual"] != by_name:
            wrong("Manual did not start out as name order for a space nobody has arranged")

        # And the drag. Manual is in force from the loop above.
        before = page.evaluate(TOP_NAMES)
        moving, onto = "Roadmap.canvas", "Note 1.md"
        say(f"dragging {moving} above {onto}")
        row(page, moving).drag_to(row(page, onto), target_position={"x": 40, "y": 2})
        page.wait_for_timeout(500)

        after = page.evaluate(TOP_NAMES)
        say(f"after the drag: {' | '.join(after)}")
        if after == before:
            wrong("the drag moved nothing")
        elif after.index(moving) != after.index(onto) - 1:
            wrong(f"{moving} did not land above {onto}: {after}")

        page.locator("aside").screenshot(path=str(SHOTS / "order-dragged.png"))
        kept = page.evaluate(WHAT_IS_KEPT)
        say(f"kept: {json.dumps(kept, ensure_ascii=False)}")
        if not kept["arranged"]:
            wrong("the drag wrote no arranged order for the space")
        if kept["stored"] is None or "manual" not in json.dumps(kept["stored"]):
            wrong(f"the chosen order was not written down per space: {kept['stored']}")

        # The list only runs as far as the drag reached.
        for folder, names in kept["arranged"].items():
            say(f"arranged {folder!r}: {names}")

        return after
    finally:
        context.close()


def relaunched(playwright, profile: Path, want: list[str]) -> None:
    """The same profile again, opened from cold: the order somebody arranged is a
    fact about the space rather than a redraw."""
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=str(profile),
        executable_path=chromium(),
        headless=True,
        viewport={"width": 1180, "height": 820},
        color_scheme="light",
    )
    try:
        page = opened(context, "relaunch")
        wait_for(page, "() => window.nibApp.workspace.files.length > 10", "the space to be read")
        page.wait_for_timeout(400)

        mode = page.evaluate("() => window.nibApp.workspace.sortMode")
        names = page.evaluate(TOP_NAMES)
        say(f"after a relaunch the order is {mode!r}: {' | '.join(names)}")

        if mode != "manual":
            wrong(f"the chosen order did not survive the relaunch: {mode!r}")
        if names != want:
            wrong(f"the arranged order did not survive the relaunch:\n  was {want}\n  now {names}")

        page.locator("aside").screenshot(path=str(SHOTS / "order-relaunched.png"))
        say("wrote order-relaunched.png")
    finally:
        context.close()


def phone(playwright, profile: Path) -> None:
    """The same design at phone width, through the only gesture a touch screen has:
    a press, a short hold, and a move."""
    context = playwright.chromium.launch_persistent_context(
        user_data_dir=str(profile),
        executable_path=chromium(),
        headless=True,
        viewport={"width": 390, "height": 844},
        has_touch=True,
        is_mobile=True,
        color_scheme="light",
    )
    try:
        page = opened(context, "phone")
        held = page.evaluate(
            SEED,
            {"Reading": ["Chapter two", "Chapter one"], "Work": ["Q3 plan", "Budget"]},
        )
        say(f"[phone] the space holds {held} files")

        # The drawer, so the list is on screen at all at this width; the same call
        # every other phone drive opens it with.
        page.evaluate(
            "() => { const ws = window.nibApp.workspace; if (!ws.panel) ws.showPanel('tree') }"
        )
        page.wait_for_timeout(400)
        page.locator("aside .row[data-path]").first.wait_for(state="visible", timeout=10000)

        chosen(page, "Manual", "manual")

        before = page.evaluate(TOP_NAMES)
        say(f"[phone] before: {' | '.join(before)}")
        page.screenshot(path=str(SHOTS / "order-phone.png"))

        moving, onto = "zeta.md", "Alpha.md"
        source = rowbox(page, moving)
        target = rowbox(page, onto)
        say(f"[phone] lifting {moving} with a finger and dropping it above {onto}")

        cdp = context.new_cdp_session(page)

        def touch(kind: str, x: float, y: float) -> None:
            points = [] if kind == "touchEnd" else [{"x": x, "y": y}]
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

        start_x = source["x"] + 40
        start_y = source["y"] + source["height"] / 2
        end_y = target["y"] + 2

        touch("touchStart", start_x, start_y)
        # Past the short hold that lifts the row, and not past the half second the
        # row's own menu waits.
        page.wait_for_timeout(320)
        if not page.evaluate("() => !!document.querySelector('.row.carried')"):
            wrong("[phone] the hold did not lift the row")

        steps = 14
        for step in range(1, steps + 1):
            touch("touchMove", start_x, start_y + (end_y - start_y) * step / steps)
            page.wait_for_timeout(20)
            # Half way, which is where a picture of a lift is worth taking: the copy is
            # under the finger, the row it came from is hollow where it was, and the gap
            # has opened where it would land.
            if step == steps // 2:
                page.wait_for_timeout(220)
                page.screenshot(path=str(SHOTS / "order-phone-lifted.png"))
                held = page.evaluate(
                    "() => ({ carried: !!document.querySelector('.row.carried'),"
                    " hollow: document.querySelectorAll('.row.is-lifted').length })"
                )
                say(f"[phone] in the air: {held}")
                if not held["carried"] or not held["hollow"]:
                    wrong(f"[phone] the lift was not drawn as one: {held}")

        page.wait_for_timeout(200)
        touch("touchEnd", start_x, end_y)
        page.wait_for_timeout(500)

        after = page.evaluate(TOP_NAMES)
        say(f"[phone] after: {' | '.join(after)}")
        if after == before:
            wrong("[phone] the lift moved nothing")
        elif after.index(moving) != after.index(onto) - 1:
            wrong(f"[phone] {moving} did not land above {onto}: {after}")

        if page.evaluate("() => !!document.querySelector('.row.carried')"):
            wrong("[phone] the copy under the finger was left behind")

        page.screenshot(path=str(SHOTS / "order-phone-dragged.png"))
        say("wrote the phone shots")
    finally:
        context.close()


FOLDERS: list[str] = []


def main() -> int:
    global FOLDERS
    SHOTS.mkdir(parents=True, exist_ok=True)
    build()

    profiles = Path(ROOT / "target" / "tree-order-profiles")
    if profiles.exists():
        shutil.rmtree(profiles, ignore_errors=True)
    desk = profiles / "desktop"
    hand = profiles / "phone"
    desk.mkdir(parents=True, exist_ok=True)
    hand.mkdir(parents=True, exist_ok=True)

    # The five folders the seed makes, which every order has to put first.
    FOLDERS = sorted(["Archive", "Reading", "Work"])

    say(f"serving {APP / 'dist'} on {ORIGIN}")
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"],
        cwd=APP / "dist",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        with sync_playwright() as playwright:
            arranged = desktop(playwright, desk)
            relaunched(playwright, desk, arranged)
            phone(playwright, hand)
    finally:
        say("stopping the server")
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(server.pid)],
                capture_output=True,
                check=False,
            )
        else:
            server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()

    if problems:
        print("\n%d thing(s) were wrong:" % len(problems), flush=True)
        for one in problems:
            print(f"  - {one}", flush=True)
        return 1

    print("\nthe seven orders read as they should, and Manual held a drag", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
