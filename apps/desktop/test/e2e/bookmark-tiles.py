"""Bookmarks as Zen's Essentials, and called that: the files kept at the top of the
sidebar are a grid of soft cards wearing their faces, the open one lifted, and
everything that is only words stays a row under them.

Pressed, a tile shows its file where a tab shows, with no tab in the strip, and comes
back to the same view after another tab has been in front. Seen at four widths of the
sidebar, in the built-in theme and in glass, light and dark,
and under a thumb; and used: a tile pressed opens its note, one dragged among the
others moves, a row of the file list dragged onto the grid is bookmarked where it was
let go of, a tab carried out of the strip onto the grid is too, the arrows walk the
grid, and the list comes back from Settings - a search for the old word, bookmarks,
finds it - and goes again.

Serves the built web app and drives it in Chromium. Run it from the repository root:

    python apps/desktop/test/e2e/bookmark-tiles.py

Set NIB_SKIP_BUILD=1 to reuse apps/desktop/dist from a previous run. Screenshots go
beside this file under `shots/bookmark-tiles/`.
"""

from __future__ import annotations

import json

from playwright.sync_api import Browser, Page

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot, wait_for = DRIVE.say, DRIVE.wrong, DRIVE.shot, DRIVE.wait_for

# A favicon the drive brings, so the web note wears a picture with no network.
FAVICON = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E"
    "%3Crect width='16' height='16' rx='3' fill='%23ff3e00'/%3E%3C/svg%3E"
)

FILES = {
    "Plan.md": "# Plan\n\nWhat we are doing.\n\n## Later\n\nSomething for later.\n",
    "Rocket.md": "---\nicon: 🚀\n---\n# Rocket\n\nLaunch day.\n",
    "Inbox.md": "# Inbox\n\nLoose ends.\n",
    "Board.canvas": '{"nodes":[],"edges":[]}',
    "Svelte docs.url": f"[InternetShortcut]\nURL=https://svelte.dev/\nNib-Icon={FAVICON}\n",
    "Loose.md": "# Loose\n\nNot bookmarked yet.\n",
}

SEED = """
async (files) => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root.replace(/\\/+$/, '')
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nib')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  const now = Date.now()
  await new Promise((resolve, reject) => {
    const change = db.transaction(['files', 'stats'], 'readwrite')
    for (const [name, content] of Object.entries(files)) {
      const path = `${root}/${name}`
      change.objectStore('files').put({ path, content, modified: now, created: now })
      change.objectStore('stats').put({ path, modified: now, created: now })
    }
    change.oncomplete = () => resolve()
    change.onerror = () => reject(change.error)
  })
  await ws.loadTree()
  const keep = ['Plan.md', 'Rocket.md', 'Svelte docs.url', 'Board.canvas', 'Inbox.md']
  for (const name of keep) {
    ws.bookmarks.toggle(ws.bookmarks.forEntry({ path: `${root}/${name}`, is_dir: false }))
  }
  ws.bookmarks.toggle(ws.bookmarks.forHeading('Plan.md', 'Later'))
  return ws.bookmarks.list.map((one) => `${one.kind}:${one.path}`)
}
"""

# After a launch, which is when a space's notes are read for what they say about
# themselves: the icon in the front matter, the favicon in the shortcut.
SHOW = """
async () => {
  const ws = window.nibApp.workspace
  if (ws.panel !== 'tree') ws.showPanel('tree')
}
"""

TILES = """
() => [...document.querySelectorAll('.tiles .tile')].map((tile) => {
  const box = tile.getBoundingClientRect()
  return {
    name: tile.getAttribute('aria-label'),
    title: tile.getAttribute('title'),
    on: tile.classList.contains('is-on'),
    letter: tile.querySelector('.nib-tile-letter')?.textContent ?? null,
    picture: !!tile.querySelector('img'),
    top: tile.offsetTop,
    width: Math.round(box.width),
    height: Math.round(box.height),
  }
})
"""

ROWS = """
() => [...document.querySelectorAll('.bookmarks .row .nib-row-label')].map((one) => one.textContent)
"""

ORDER = "() => window.nibApp.workspace.bookmarks.list.map((one) => one.path || one.text)"


#: The pages being reloaded right now; see `reload`.
RELOADING: set[Page] = set()


def page_error(page: Page, error: Exception) -> None:
    """A script error is a failure, but for the one a reload makes: the chunks the app
    fetches once it is up are cancelled by the reload, and WebKit reports each import
    that was waiting on one as `Importing a module script failed` from the page being
    left. Chromium says nothing. It is the drive's reload, not the app."""
    if page in RELOADING and "Importing a module script failed" in str(error):
        say(f"(a reload cancelled an import: {error})")
        return
    wrong(f"page error: {error}")


def reload(page: Page) -> None:
    RELOADING.add(page)
    try:
        page.reload(wait_until="domcontentloaded")
        DRIVE.ready(page)
    finally:
        RELOADING.discard(page)


def fresh(browser: Browser, label: str, scheme: str = "light", finger: bool = False) -> Page:
    options = (
        {
            "viewport": {"width": 420, "height": 880},
            "has_touch": True,
            "is_mobile": True,
            "user_agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
            " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
        }
        if finger
        else {"viewport": {"width": 1280, "height": 820}}
    )
    page = DRIVE.page(browser, errors=False, color_scheme=scheme, device_scale_factor=2, **options)
    page.on("pageerror", lambda error: page_error(page, error))
    page.on(
        "console",
        lambda message: wrong(f"[{label}] console error: {message.text}")
        if message.type == "error"
        else None,
    )
    DRIVE.open(page)
    say(f"[{label}] kept: {page.evaluate(SEED, FILES)}")
    reload(page)
    page.evaluate(SHOW)
    wait_for(page, "document.querySelectorAll('.tiles .tile').length > 0", "the tiles")
    page.locator(".tiles .tile").first.click()
    page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
    wait_for(page, "document.querySelectorAll('.tiles .tile').length === 5", f"[{label}] the tiles")
    # The press opens Plan in place, which is a module fetched the first time an
    # essential opens (essentials.svelte.ts) and so can take longer than the half a
    # second below; its tile is lifted once it has.
    wait_for(
        page,
        "/Plan\\.md$/.test(window.nibApp.workspace.active?.essential ?? '')",
        f"[{label}] Plan open in place",
    )
    page.wait_for_timeout(500)
    return page


def sidebar(page: Page, name: str) -> None:
    box = page.locator("aside").first.bounding_box()
    if box:
        shot(page, name, clip={"x": 0, "y": 0, "width": box["width"] + 1, "height": 320})


def widen(page: Page, width: int) -> None:
    page.evaluate(
        "(width) => document.querySelector('.column').style.setProperty('--panel-width', `${width}px`)",
        width,
    )
    page.wait_for_timeout(450)


def drive_look(browser: Browser) -> None:
    page = fresh(browser, "look")

    tiles = page.evaluate(TILES)
    say(f"[look] tiles: {json.dumps(tiles, ensure_ascii=False)}")
    names = [one["name"] for one in tiles]
    if names != ["Plan", "Rocket", "Svelte docs", "Board", "Inbox"]:
        wrong(f"the tiles are not the bookmarked files in order: {names}")
    if any(one["title"] != one["name"] for one in tiles):
        wrong("a tile has no tooltip saying what it is")
    if [one["name"] for one in tiles if one["on"]] != ["Plan"]:
        wrong("the open note's tile is not the one lifted")
    by = {one["name"]: one for one in tiles}
    if by["Plan"]["letter"] != "P" or by["Inbox"]["letter"] != "I":
        wrong("a note with no icon does not wear its letter")
    if by["Rocket"]["letter"] is not None:
        wrong("a note with an icon wears a letter instead")
    if not by["Svelte docs"]["picture"]:
        wrong("the web note does not wear its favicon")
    if page.evaluate(ROWS) != ["Later"]:
        wrong(f"what is only words is not a row under the grid: {page.evaluate(ROWS)}")

    for width in (200, 252, 360, 480):
        widen(page, width)
        laid = page.evaluate(TILES)
        first = laid[0]["top"]
        across = len([one for one in laid if one["top"] == first])
        say(f"[look] {width}px: {across} to a row, {laid[0]['width']}x{laid[0]['height']}")
        if laid[0]["width"] < 44:
            wrong(f"at {width}px a tile is narrower than a row is tall: {laid[0]['width']}")
        sidebar(page, f"01-width-{width}")
    widen(page, 252)

    # Under the pointer, and pressed.
    page.locator(".tiles .tile").nth(1).hover()
    page.wait_for_timeout(250)
    sidebar(page, "02-hover")

    for theme in ("default", "glass"):
        for scheme in ("light", "dark"):
            page.evaluate(f"() => window.nibApp.theme.select('{theme}')")
            page.evaluate(f"() => window.nibApp.theme.setScheme('{scheme}')")
            page.wait_for_timeout(500)
            page.mouse.move(900, 600)
            sidebar(page, f"03-{theme}-{scheme}")
    page.evaluate("() => window.nibApp.theme.select('default')")
    page.evaluate("() => window.nibApp.theme.setScheme('light')")
    page.wait_for_timeout(300)

    # Pressed, it opens its note, and the lift moves with it.
    page.locator(".tiles .tile", has=page.locator(".nib-tile-letter", has_text="I")).click()
    page.wait_for_timeout(500)
    if page.evaluate("() => window.nibApp.workspace.active?.name") != "Inbox.md":
        wrong("pressing a tile did not open its note")
    lifted = [one["name"] for one in page.evaluate(TILES) if one["on"]]
    if lifted != ["Inbox"]:
        wrong(f"the lift did not follow the open note: {lifted}")
    sidebar(page, "04-opened")

    # In place, as Zen's Essentials are: no tab in the strip for it, and a tab opened
    # after it leaves it loaded, so pressing the tile again comes back to the same view.
    if page.locator(".tab", has_text="Inbox").count():
        wrong("pressing a tile put a tab in the strip")
    shown = page.evaluate("() => window.nibApp.workspace.active?.id")
    page.locator(".body [data-path$='Loose.md']").first.dblclick()
    page.wait_for_timeout(500)
    page.locator(".tiles .tile", has=page.locator(".nib-tile-letter", has_text="I")).click()
    page.wait_for_timeout(400)
    back = page.evaluate("() => window.nibApp.workspace.active?.id")
    if back != shown:
        wrong("pressing the tile again made a new view rather than coming back to its own")
    shot(page, "05-in-place")

    # A modifier asks for a tab of its own, as on any row.
    page.locator(".tiles .tile", has=page.locator(".nib-tile-letter", has_text="P")).click(modifiers=["Control"])
    page.wait_for_timeout(500)
    if not page.locator(".tab", has_text="Plan").count():
        wrong("Ctrl and a tile did not open a tab of its own")

    page.context.close()


def drive_hands(browser: Browser) -> None:
    page = fresh(browser, "hands")

    # A tile dragged past the middle of the third lands after it.
    third = page.locator(".tiles .tile").nth(2).bounding_box()
    assert third
    page.locator(".tiles .tile").first.drag_to(
        page.locator(".tiles .tile").nth(2),
        target_position={"x": third["width"] * 0.8, "y": third["height"] / 2},
    )
    page.wait_for_timeout(400)
    order = page.evaluate(ORDER)
    say(f"[hands] after the drag: {order}")
    if order[:3] != ["Rocket.md", "Svelte docs.url", "Plan.md"]:
        wrong(f"the dragged tile did not land after the third: {order}")

    # A row of the file list dragged onto the front of the grid is bookmarked there.
    loose = page.locator(".body [data-path$='Loose.md']").first
    loose.drag_to(page.locator(".tiles .tile").first, target_position={"x": 4, "y": 10})
    page.wait_for_timeout(400)
    order = page.evaluate(ORDER)
    say(f"[hands] after the file list drag: {order}")
    if order[0] != "Loose.md":
        wrong(f"the note dragged from the file list was not kept where it landed: {order}")
    sidebar(page, "10-dragged-in")

    # The arrows: right along the grid, down a row of it.
    page.locator(".tiles .tile").first.focus()
    page.keyboard.press("ArrowRight")
    along = page.evaluate("() => document.activeElement?.getAttribute('aria-label')")
    page.keyboard.press("ArrowDown")
    below = page.evaluate("() => document.activeElement?.getAttribute('aria-label')")
    tiles = page.evaluate(TILES)
    across = len([one for one in tiles if one["top"] == tiles[0]["top"]])
    say(f"[hands] keys: right to {along}, down to {below}, {across} to a row")
    if along != tiles[1]["name"]:
        wrong(f"ArrowRight did not walk to the next tile: {along}")
    expected = tiles[1 + across]["name"] if 1 + across < len(tiles) else tiles[-1]["name"]
    if below != expected:
        wrong(f"ArrowDown did not walk down the grid: {below}, not {expected}")

    # The list, from Settings, found by the word it went by before, and back.
    page.evaluate("() => window.nibApp.settings.show()")
    page.wait_for_timeout(600)
    page.fill(".sheet .search input", "bookmarks")
    page.wait_for_timeout(500)
    found = page.locator(".sheet .nib-segmented button", has_text="List")
    if not found.count():
        wrong("a settings search for the old word does not find the Essentials")
    else:
        shot(page, "11-settings")
        found.first.click()
        page.wait_for_timeout(300)
    page.evaluate("() => (window.nibApp.settings.open = false)")
    page.wait_for_timeout(500)
    listed = page.evaluate(ROWS)
    say(f"[hands] as a list: {listed}")
    if page.locator(".tiles").count() or len(listed) != 7:
        wrong(f"the list did not come back: {listed}")
    sidebar(page, "12-as-a-list")
    page.evaluate("() => localStorage.setItem('nib:essentials-look', 'tiles')")
    reload(page)
    page.evaluate(SHOW)
    wait_for(page, "document.querySelectorAll('.tiles .tile').length > 0", "the tiles")
    page.locator(".tiles .tile").first.click()
    page.wait_for_timeout(600)
    if page.locator(".tiles .tile").count() != 6:
        wrong("the tiles did not come back from the list")
    if page.locator("p.nib-section", has_text="Essentials").count() != 1:
        wrong("the rows under the tiles are not headed Essentials")

    # A tab carried out of the strip onto the grid is bookmarked where it was let go.
    page.evaluate("() => window.nibApp.workspace.bookmarks.toggle(window.nibApp.workspace.bookmarks.list[0])")
    page.locator(".body [data-path$='Loose.md']").first.dblclick()
    page.wait_for_timeout(500)
    tab = page.locator(".tab", has_text="Loose").first.bounding_box()
    target = page.locator(".tiles .tile").nth(1).bounding_box()
    if tab and target:
        page.mouse.move(tab["x"] + tab["width"] / 2, tab["y"] + tab["height"] / 2)
        page.mouse.down()
        for step in range(1, 16):
            page.mouse.move(
                tab["x"] + (target["x"] + 6 - tab["x"]) * step / 15,
                tab["y"] + (target["y"] + target["height"] / 2 - tab["y"]) * step / 15,
            )
            page.wait_for_timeout(20)
        page.wait_for_timeout(150)
        sidebar(page, "13-tab-over-grid")
        page.mouse.up()
        page.wait_for_timeout(500)
        order = page.evaluate(ORDER)
        say(f"[hands] after the tab drag: {order}")
        if order[1:2] != ["Loose.md"]:
            wrong(f"the tab let go of over the grid was not bookmarked there: {order}")

    page.context.close()


def drive_finger(browser: Browser) -> None:
    page = fresh(browser, "phone", finger=True)
    # The press that opened Plan put the drawer away, as a press on a phone does - once
    # the note has opened, which can be after the press. Asked for before then, the file
    # list is still the panel showing, so showing it again is nothing, and then the
    # drawer goes.
    wait_for(page, "window.nibApp.workspace.panel === null", "the drawer put away")
    page.evaluate("() => window.nibApp.workspace.showPanel('tree')")
    page.wait_for_timeout(500)
    tiles = page.evaluate(TILES)
    say(f"[phone] tiles: {json.dumps(tiles)}")
    for one in tiles:
        if one["height"] < 48 or one["width"] < 48:
            wrong(f"a tile is smaller than a thumb: {one['name']} {one['width']}x{one['height']}")
    shot(page, "20-phone")

    page.locator(".tiles .tile").nth(2).tap()
    page.wait_for_timeout(600)
    if page.evaluate("() => window.nibApp.workspace.active?.name") != "Svelte docs.url":
        say("[phone] a tap on the web tile opened something else (a web build cannot open a site)")
    page.context.close()


def main() -> int:
    with DRIVE.session() as browser:
        say("--- the look ---")
        drive_look(browser)
        say("--- by hand ---")
        drive_hands(browser)
        say("--- a finger ---")
        drive_finger(browser)

    return DRIVE.verdict("bookmarks are tiles, the open one lifted, and they move by hand")


if __name__ == "__main__":
    raise SystemExit(main())
