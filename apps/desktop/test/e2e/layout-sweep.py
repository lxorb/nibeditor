"""Whether anything on the app's big surfaces is laid out so a person cannot read it.

Settings > Account > Status drew "Clear after" one letter to a line, and it was not
the first time: Settings > Online terminal had done it with Restart, and Glasses with
the OpenAI key (issue 245). Each was a control at the end of a row of settings that
left the name beside it no width, and each passed every gate there is, because jsdom
has no layout - vitest.config.ts says so - and the one drive a push runs, smoke.py,
asks about a note and nothing else. They were found by Emil.

So this opens every pane of the settings, and every surface a person spends time on,
in a real browser at the widths people have, and holds what is drawn to the handful
of facts a layout has to keep whatever is on it:

  - no word is broken across lines: a box that splits "Clear" into "C l e a r" is a
    box too narrow for its words, which is the bug every one of these was
  - nothing reaches past the window's edge, and the page never scrolls sideways
  - nothing spills out of the box it is in, and no words are cut off at its edge
  - no two things side by side in a row are drawn over each other
  - no control is drawn at no size at all, and no empty field is invisible: a box
    with no border, no ground and no words in it is a row with nothing to press
  - a row of settings keeps a name a person can read beside its control

Every pane of the settings and every page behind one, signed out and with an
account, at 1280, 960 and 720 on a desktop and 390 on a phone, light and dark; and
beside them the new tab, the palette, the theme picker, the theme store, a question,
the sync question, the icon picker, the sign-in sheet, a row's menu, every panel of
the sidebars, the file list and the empty space.

The account is the browser's own: the session is a word in storage and every request
the app makes to the service is answered here, by `ACCOUNT`, the way the service
would answer an account that has just been made. Nothing leaves the machine, so the
drive needs no Worker and no network, and is cheap enough to run on every push.

A failure names the surface, the width, the scheme and the element, so it can be
found without running anything:

    [desktop 720 dark, signed in] settings/Account: "Clear" is broken across 5 lines
        in span.name < div.nib-setting.setting < div.card (8px wide)

From the repository root; the harness builds the app with its handle on the page the
first time and serves it (see harness.py):

    python apps/desktop/test/e2e/layout-sweep.py [--shots]

With `--shots`, every surface is photographed too, under `shots/layout-sweep/`. The
four kinds of browser - desktop and phone, signed out and in - are four pages of one
browser, run side by side.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from typing import Any

from harness import ANSWERED, LAUNCHED, Drive

DRIVE = Drive(__file__)
say, wrong = DRIVE.say, DRIVE.wrong

SHOTS_TOO = "--shots" in sys.argv

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Mobile Safari/537.36"
)

#: The widths a desktop window is held at, and the one phone. A desktop is resized in
#: place, which is what a person dragging the window's edge does; a phone is a device
#: of its own, which the app settles once from the machine (lib/viewport.svelte.ts).
DESKTOP_WIDTHS = (1280, 960, 720)
DESKTOP_HEIGHT = 800
PHONE = {"width": 390, "height": 844}
SCHEMES = ("light", "dark")

#: How long one wait for the app is given.
PATIENCE = 30

#: The account the service answers with, and what it answers for each route it is
#: asked; anything else is a refusal the app already has words for. Shaped after
#: lib/api/routes.ts.
NOW = int(time.time() * 1000)
USER = {
    "id": "sweep",
    "email": "someone.with.a.longer.address@example.com",
    "name": "Someone",
    "pronouns": None,
    "bio": None,
    "status": None,
    "accent": None,
    "avatar": None,
    "hidden": False,
    "webSync": False,
    "syncVersion": 1,
}
ACCOUNT: dict[str, Any] = {
    "/v1/me": {"user": USER},
    "/v1/spaces": {"spaces": [], "deleted": []},
    "/v1/usage": {"used": 3_400_000, "limit": 1_000_000_000},
    "/v1/second": {"on": False, "since": None, "codesLeft": 0, "possible": True},
    "/v1/sessions": {
        "sessions": [
            {"id": "a", "name": "Chrome on Windows", "createdAt": NOW - 86_400_000, "lastUsedAt": NOW, "current": True},
            {"id": "b", "name": "nib on an Android phone", "createdAt": NOW - 9 * 86_400_000, "lastUsedAt": NOW - 3_600_000, "current": False},
        ]
    },
    "/v1/settings": {"settings": {}, "key": {"set": False, "tail": None}},
    "/v1/trash": {"spaces": [], "notes": []},
    "/v1/shared": {"shared": []},
}

SEED = """
async () => {
  const ws = window.nibApp.workspace
  const root = ws.activeSpace.root
  await ws.noteFrom('# Plan\\n\\nWe meet at noon on Friday, at the old station.\\n\\n- [ ] Book the room\\n- [ ] Write to everybody\\n', root)
  await ws.noteFrom('# A note with a name long enough to be cut somewhere in a narrow list\\n\\nWords.\\n', root)
  await ws.noteFrom('# Groceries\\n\\nBread, milk.\\n', root)
  await ws.loadTree()
  const note = ws.notes.find((one) => one.name === 'Plan.md')
  await ws.openEntry(note.path, { activate: true })
  return note.path
}
"""

#: Every fact this drive holds a surface to, asked of whatever is drawn under `scope`
#: in one pass, and answered as a list of sentences. Written to be read without the
#: drive: each check says what it is about where it starts.
CHECK = r"""
(scope) => {
  const roots = scope ? [...document.querySelectorAll(scope)] : [document.body]
  const said = []
  const say = (text) => { if (!said.includes(text)) said.push(text) }
  const vw = document.documentElement.clientWidth
  const vh = innerHeight
  const styles = new Map()
  const css = (el) => {
    let s = styles.get(el)
    if (!s) { s = getComputedStyle(el); styles.set(el, s) }
    return s
  }

  // What a person reads in, and what is somebody's own writing: the note, a
  // drawing, a picture. Their layout is the note's, not the app's.
  const OWN = '.cm-editor, #write, .nib-write, canvas, svg, iframe, video, img, [aria-hidden="true"], [inert], .nib-scrim, .sr-only'
  const own = (el) => !!el.closest(OWN)

  // Where an element is a person can see: its box, cut by every ancestor that clips
  // what is outside it, up to the window's edge or to a fixed layer.
  const clipped = (el, withWindow = true) => {
    const r = el.getBoundingClientRect()
    let box = { l: r.left, t: r.top, r: r.right, b: r.bottom }
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const s = css(a)
      if (s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contain.includes('paint')) {
        const q = a.getBoundingClientRect()
        if (s.overflowX !== 'visible') { box.l = Math.max(box.l, q.left); box.r = Math.min(box.r, q.right) }
        if (s.overflowY !== 'visible') { box.t = Math.max(box.t, q.top); box.b = Math.min(box.b, q.bottom) }
      }
      if (s.position === 'fixed') break
    }
    if (withWindow) box = { l: Math.max(box.l, 0), t: Math.max(box.t, 0), r: Math.min(box.r, vw), b: Math.min(box.b, vh) }
    return box
  }

  // Drawn and somewhere a person could see it. A box squeezed to no width at all is
  // still drawn - its words spill out of it a letter to a line, which is the very
  // thing this drive is for - so it counts as shown when its edge is in view, and not
  // only when it has an area there.
  const shown = (el) => {
    if (own(el)) return false
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    const r = el.getBoundingClientRect()
    if (r.width < 1 && r.height < 1) return false
    const box = clipped(el)
    return box.r >= box.l && box.b >= box.t && (box.r > box.l || box.b > box.t)
  }

  // A name for an element a person can find: what it is, its classes without the
  // ones the compiler adds, its first words, and the two boxes it sits in.
  const named = (el) => {
    const one = (e) => {
      const classes = [...e.classList].filter((c) => !c.startsWith('svelte-')).slice(0, 3)
      const role = e.getAttribute('role')
      return e.tagName.toLowerCase() + classes.map((c) => '.' + c).join('') + (role && !classes.length ? `[role=${role}]` : '')
    }
    const trail = [one(el)]
    for (let a = el.parentElement, n = 0; a && n < 2 && a !== document.body; a = a.parentElement, n++) trail.push(one(a))
    const words = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 32)
    return `${trail.join(' < ')}${words ? ` "${words}"` : ''}`
  }
  const px = (n) => `${Math.round(n)}px`

  const elements = []
  for (const root of roots) {
    if (!root.checkVisibility()) continue
    elements.push(root, ...root.querySelectorAll('*'))
  }
  const visible = elements.filter(shown)
  const isShown = new Set(visible)

  // ── The page itself never scrolls sideways ─────────────────────────────
  const page = document.scrollingElement
  if (page.scrollWidth > page.clientWidth + 1)
    say(`the page scrolls sideways: ${page.scrollWidth}px of content in ${page.clientWidth}px`)

  // ── No word is broken across lines ─────────────────────────────────────
  // Word by word, off the boxes the browser drew each one in: a word on two tops is a
  // word split. Short words only - an address or a path longer than a line is allowed
  // to be broken where it has to be, and is not what this is about.
  const WORD = /[\p{L}\p{N}]{2,24}/gu
  for (const el of visible) {
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue
      const text = node.textContent
      const range = document.createRange()
      for (const m of text.matchAll(WORD)) {
        range.setStart(node, m.index)
        range.setEnd(node, m.index + m[0].length)
        const tops = []
        for (const rect of range.getClientRects()) {
          if (rect.width < 0.5 || rect.height < 1) continue
          if (!tops.some((top) => Math.abs(top - rect.top) < rect.height / 2)) tops.push(rect.top)
        }
        if (tops.length > 1) {
          say(`"${m[0]}" is broken across ${tops.length} lines in ${named(el)} (${px(el.getBoundingClientRect().width)} wide)`)
          break
        }
      }
    }
  }

  // ── Nothing reaches past the window, spills out of its box, or is cut off ──
  const flagged = new Set()
  const inFlow = (el) => {
    const s = css(el)
    return (s.position === 'static' || s.position === 'relative') && s.transform === 'none' && s.display !== 'contents'
  }
  for (const el of visible) {
    if (el === document.body) continue
    const r = el.getBoundingClientRect()
    const box = clipped(el, false)
    if (box.r - box.l < 1 || box.b - box.t < 1) continue
    const ancestorFlagged = (() => {
      for (let a = el.parentElement; a; a = a.parentElement) if (flagged.has(a)) return true
      return false
    })()

    // Past the window's edge, partly: wholly outside is a drawer parked out of sight.
    if (!ancestorFlagged && ((box.r > vw + 1 && box.l < vw - 1) || (box.l < -1 && box.r > 1))) {
      flagged.add(el)
      say(`${named(el)} reaches past the window's edge (${px(box.l)} to ${px(box.r)} of ${vw}px)`)
      continue
    }

    // Out of the box it is in, sideways, where that box shows what spills.
    const parent = el.parentElement
    if (!ancestorFlagged && parent && isShown.has(parent) && inFlow(el) && parent !== document.body) {
      const p = parent.getBoundingClientRect()
      const ps = css(parent)
      const s = css(el)
      const inner = { l: p.left + parseFloat(ps.borderLeftWidth), r: p.right - parseFloat(ps.borderRightWidth) }
      const bleeds = parseFloat(s.marginLeft) < 0 || parseFloat(s.marginRight) < 0
      if (!bleeds && ps.overflowX === 'visible' && ps.display !== 'inline' && (r.right > inner.r + 2 || r.left < inner.l - 2)) {
        flagged.add(el)
        say(`${named(el)} spills out of ${named(parent).split(' < ')[0]} by ${px(Math.max(r.right - inner.r, inner.l - r.left))}`)
        continue
      }
    }

    // Words cut off at the edge of a box that hides what does not fit, with nothing to
    // say there is more: an ellipsis says it, a bare edge does not.
    const s = css(el)
    const ownWords = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    // A fade says it too: a tab's name runs out under a mask rather than a full stop.
    const faded = (() => {
      for (let a = el, n = 0; a && n < 3; a = a.parentElement, n++) {
        const m = css(a).maskImage || css(a).webkitMaskImage
        if (m && m !== 'none') return true
      }
      return false
    })()
    if (ownWords && !faded && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
      say(`the words of ${named(el)} are cut off (${el.scrollWidth}px in ${el.clientWidth}px)`)
    }
  }

  // ── No two things in a row are drawn over each other ───────────────────
  for (const el of visible) {
    const s = css(el)
    if (!s.display.includes('flex') || s.flexDirection.startsWith('column')) continue
    const kids = [...el.children].filter((k) => isShown.has(k) && inFlow(k) && parseFloat(css(k).marginLeft) >= 0 && parseFloat(css(k).marginRight) >= 0)
    for (let i = 0; i < kids.length; i++) {
      const a = kids[i].getBoundingClientRect()
      if (a.width < 1 || a.height < 1) continue
      for (let j = i + 1; j < kids.length; j++) {
        const b = kids[j].getBoundingClientRect()
        if (b.width < 1 || b.height < 1) continue
        const across = Math.min(a.right, b.right) - Math.max(a.left, b.left)
        const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (across > 2 && down > 2) say(`${named(kids[i])} and ${named(kids[j])} overlap by ${px(across)} in ${named(el).split(' < ')[0]}`)
      }
    }
  }

  // ── Every control has a size, and an empty field can be seen ───────────
  const CONTROLS = 'input:not([type="hidden"]), select, textarea, button, [role="switch"], [role="slider"], [role="checkbox"], [role="radio"], [role="combobox"], [contenteditable="true"]'
  const clear = (colour) => colour === 'transparent' || /rgba?\([^)]*,\s*0\)$/.test(colour) || /\/\s*0\)$/.test(colour)
  for (const el of visible) {
    if (!el.matches(CONTROLS)) continue
    const r = el.getBoundingClientRect()
    // A control hidden on purpose for a reader that cannot see - a pixel square cut by
    // a clip - is not one drawn at no size.
    if (r.width <= 1 && r.height <= 1) continue
    if (r.width < 6 || r.height < 6) {
      say(`${named(el)} is drawn at ${px(r.width)} by ${px(r.height)}`)
      continue
    }
    const typed = el.matches('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], input[type="number"]')
    if (typed && document.activeElement !== el && !el.value && !el.placeholder) {
      const s = css(el)
      const edged = ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(s[`border${side}Width`]) > 0 && !clear(s[`border${side}Color`]))
      const ground = !clear(s.backgroundColor) && s.backgroundColor !== css(el.parentElement).backgroundColor
      if (!edged && !ground && s.boxShadow === 'none')
        say(`${named(el)} is an empty field with nothing to show where it is`)
    }
  }

  // ── A row of settings keeps a name a person can read ───────────────────
  for (const row of visible) {
    if (!row.classList.contains('nib-setting')) continue
    const name = row.querySelector(':scope > .name')
    if (!name || !isShown.has(name)) continue
    const width = name.getBoundingClientRect().width
    const em = parseFloat(css(name).fontSize)
    const words = name.textContent.trim()
    if (words && width < Math.min(4 * em, words.length * em * 0.5))
      say(`the name "${words.slice(0, 32)}" of a row of settings is left ${px(width)}`)
  }

  return said
}
"""

#: The panes of the settings by the names their list gives them, as drawn now.
PANES = """
() => [...document.querySelectorAll('[role="dialog"][aria-label="Settings"] nav .item')]
  .map((one) => one.textContent.trim()).filter(Boolean)
"""

SETTINGS = '[role="dialog"][aria-label="Settings"]'
#: The palette: the layer with the line typed into, and not the address field of a web
#: tab, which is a combobox too.
PALETTE = '[role="dialog"]:has(input[role="combobox"])'


class Browser:
    """One kind of browser - a desktop or a phone, signed out or with an account - and
    what it has found."""

    def __init__(self, kind: str, signed_in: bool) -> None:
        self.kind = kind
        self.signed_in = signed_in
        self.label = f"{kind}, {'signed in' if signed_in else 'signed out'}"
        self.found: list[str] = []
        self.surfaces = 0
        self.errors: list[str] = []
        #: The last surface checked, which is where a walk-out or a page error happened.
        self.at = "the launch"

    async def open(self, browser: Any) -> Any:
        phone = self.kind == "phone"
        context = await browser.new_context(
            viewport=PHONE if phone else {"width": DESKTOP_WIDTHS[0], "height": DESKTOP_HEIGHT},
            user_agent=PHONE_AGENT if phone else DESKTOP_AGENT,
            has_touch=phone,
            is_mobile=phone,
            device_scale_factor=2 if phone else 1,
            color_scheme="light",
            reduced_motion="reduce",
        )
        await context.add_init_script(ANSWERED)
        if self.signed_in:
            await context.add_init_script("try { localStorage.setItem('nib:session', 'sweep') } catch {}")
        await context.route(re.compile(r"^https?://(?!layout-sweep\.localhost)"), self.answer)
        with_sockets = getattr(context, "route_web_socket", None)
        if with_sockets:
            await with_sockets(re.compile(r"^wss?://"), lambda socket: None)
        page = await context.new_page()
        page.set_default_timeout(PATIENCE * 1000)
        page.on("pageerror", self.threw)
        await page.goto(DRIVE.origin, wait_until="domcontentloaded")
        for expression in (
            "window.nibApp",
            "window.nibApp.workspace.activeSpace",
            f"performance.getEntriesByName({json.dumps(LAUNCHED)}).length > 0",
            "window.nibApp.themeStore",
            "window.nibApp.workspace.active",
        ):
            await page.wait_for_function(expression, polling=50)
        if self.signed_in:
            await page.wait_for_function("window.nibApp.account.user", polling=50)
        self.path = await page.evaluate(SEED)
        await settle(page)
        return page

    def threw(self, error: Any) -> None:
        self.errors.append(f"{error} (after {self.at})")
        if os.environ.get("SWEEP_TRACE"):
            say(f"  {self.label} threw after {self.at}: {(error.stack or '')[:2500]}")

    async def answer(self, route: Any) -> None:
        """The service, for an account that has just been made: what `ACCOUNT` has for
        the route, and a refusal for anything else. Nothing goes out."""
        url = route.request.url
        path = re.sub(r"^https?://[^/]+", "", url).split("?", 1)[0]
        if self.signed_in and path in ACCOUNT:
            await route.fulfill(status=200, content_type="application/json", body=json.dumps(ACCOUNT[path]))
        elif "nibeditor.com" in url and path.startswith("/v1/"):
            await route.fulfill(status=503, content_type="application/json", body='{"error":"not in a sweep"}')
        else:
            await route.abort()

    async def check(self, page: Any, surface: str, width: int, scheme: str, scope: str | None = None) -> None:
        await settle(page)
        self.surfaces += 1
        self.at = f"{surface} at {width} {scheme}"
        if os.environ.get("SWEEP_TRACE"):
            say(f"  {self.label}: {self.at} {await page.evaluate('() => [location.href, history.length]')}")
        where = f"[{self.kind} {width} {scheme}, {'signed in' if self.signed_in else 'signed out'}] {surface}"
        said = await page.evaluate(CHECK, scope)
        for one in said:
            self.found.append(f"{where}: {one}")
        if SHOTS_TOO or said:
            await self.photograph(page, f"{width}-{scheme}-{surface}")

    async def through(self, page: Any, surface: str, width: int, scheme: str, scope: str, scroller: str) -> None:
        """A surface longer than the window, a window's height at a time: a row below the
        fold is a row somebody scrolls to, and is held to the same facts."""
        await self.check(page, surface, width, scheme, scope)
        for _ in range(12):
            moved = await page.evaluate(
                """(scroller) => {
                  const box = document.querySelector(scroller)
                  if (!box || box.scrollTop + box.clientHeight >= box.scrollHeight - 1) return false
                  box.scrollTop += Math.max(100, box.clientHeight * 0.85)
                  return true
                }""",
                scroller,
            )
            if not moved:
                return
            await self.check(page, surface, width, scheme, scope)

    async def photograph(self, page: Any, name: str) -> None:
        """The window, in this drive's shots: every surface with `--shots`, and every
        one that found something whether or not, which is what CI keeps of a run."""
        slug = re.sub(r"[^a-z0-9]+", "-", f"{self.kind}-{'in' if self.signed_in else 'out'}-{name}".lower())
        DRIVE.shots.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(DRIVE.shots / f"{slug.strip('-')}.png"))


async def given_back(page: Any) -> None:
    """A phone's layer gives its history entry back as it closes, a turn later; the
    next layer waits for that, the way a person's next tap does. See backstack.svelte.ts."""
    await page.wait_for_timeout(150)


async def settle(page: Any) -> None:
    """Two painted frames and a beat: whatever the last step changed is drawn, and the
    sheets' short entrances - motion is reduced - are over. Or a fifth of a second,
    whichever is first: four pages share one browser here, and a page nobody is
    looking at can go without a frame for as long as it likes."""
    await page.evaluate(
        """() => new Promise((go) => {
          setTimeout(go, 200)
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 30)))
        })"""
    )


async def scheme_of(page: Any, scheme: str) -> None:
    await page.evaluate("(scheme) => window.nibApp.theme.setScheme(scheme)", scheme)
    await settle(page)


async def settings(one: Browser, page: Any, width: int, scheme: str) -> None:
    """Every pane, by the list's own names, and on a phone the list itself first."""
    phone = one.kind == "phone"
    await page.evaluate("() => window.nibApp.settings.show('general')")
    await page.wait_for_selector(SETTINGS)
    if phone:
        await page.evaluate("() => { window.nibApp.settings.listing = true }")
        await one.check(page, "settings", width, scheme, SETTINGS)
    for pane in await page.evaluate(PANES):
        if phone:
            await page.evaluate("() => { window.nibApp.settings.listing = true }")
            await settle(page)
        await page.locator(f"{SETTINGS} nav .item", has_text=pane).first.click()
        await one.through(page, f"settings/{pane}", width, scheme, SETTINGS, f"{SETTINGS} .body")
    await page.evaluate("() => { window.nibApp.settings.open = false }")
    await page.wait_for_selector(SETTINGS, state="detached")


async def layer(one: Browser, page: Any, surface: str, width: int, scheme: str, opened: str, selector: str, closed: str) -> None:
    """A layer over the app: opened by the app's own call, checked, and put away."""
    try:
        await page.evaluate(opened)
        await page.wait_for_selector(selector, timeout=8000)
    except Exception as error:  # noqa: BLE001 - a surface that did not come up is said, not raised
        one.found.append(f"[{one.kind} {width} {scheme}] {surface}: did not come up ({type(error).__name__})")
        await one.photograph(page, f"missing-{width}-{scheme}-{surface}")
        return
    await one.check(page, surface, width, scheme, selector)
    await page.evaluate(closed)
    await page.wait_for_selector(selector, state="detached", timeout=8000)
    await given_back(page)


async def palette(one: Browser, page: Any, width: int, scheme: str, typed: str = "") -> None:
    await page.keyboard.press("Control+Shift+P")
    await page.wait_for_selector(PALETTE)
    if typed:
        await page.keyboard.type(typed)
    await one.check(page, f"palette{' / ' + typed if typed else ''}", width, scheme, PALETTE)
    await shut(page, PALETTE)


async def shut(page: Any, selector: str) -> None:
    """Escape until the layer is gone: a palette with words in it takes one to clear
    them and one to close."""
    for _ in range(3):
        await page.keyboard.press("Escape")
        try:
            await page.wait_for_selector(selector, state="detached", timeout=1500)
            await given_back(page)
            return
        except Exception:  # noqa: BLE001 - one more press
            continue
    raise RuntimeError(f"{selector} did not close")


async def through_palette(one: Browser, page: Any, command: str, surface: str, selector: str, width: int, scheme: str) -> None:
    await page.keyboard.press("Control+Shift+P")
    await page.wait_for_selector(PALETTE)
    await page.keyboard.type(command)
    await page.wait_for_timeout(120)
    await page.keyboard.press("Enter")
    try:
        await page.wait_for_selector(selector, timeout=8000)
    except Exception:  # noqa: BLE001
        one.found.append(f"[{one.kind} {width} {scheme}] {surface}: did not come up through the palette")
        await page.keyboard.press("Escape")
        return
    await one.check(page, surface, width, scheme, selector)
    await shut(page, selector)


#: Every panel a browser has: the agents' needs the installed app's crate, and its tab is
#: not drawn here (see Sidebar.svelte).
PANELS = ("tree", "outline", "search", "tasks", "chats", "links", "footnotes", "properties", "ask")


async def panels(one: Browser, page: Any, width: int, scheme: str) -> None:
    """Every panel of the sidebars, each shown the way its tab shows it, and the
    window around it."""
    for panel in PANELS:
        try:
            await page.evaluate("(panel) => window.nibApp.workspace.showPanel(panel)", panel)
        except Exception:  # noqa: BLE001 - a panel this build does not have
            continue
        await page.wait_for_timeout(60)
        await one.check(page, f"panel/{panel}", width, scheme)
    await page.evaluate("() => window.nibApp.workspace.showPanel('tree')")


MENU = """
(selector) => {
  const row = [...document.querySelectorAll(selector)].find((one) => one.checkVisibility())
  if (!row) return false
  const r = row.getBoundingClientRect()
  row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + r.height / 2, button: 2 }))
  return true
}
"""


async def menus(one: Browser, page: Any, width: int, scheme: str) -> None:
    """A row's own menu in the file list, and a tab's."""
    for surface, selector in (("menu/file", ".nib-row:has(.nib-row-label)"), ("menu/tab", '[role="tab"]')):
        if not await page.evaluate(MENU, selector):
            continue
        try:
            await page.wait_for_selector('[role="menu"]', timeout=4000)
        except Exception:  # noqa: BLE001 - a row with no menu on this device
            continue
        await one.check(page, surface, width, scheme, '[role="menu"]')
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(80)


HOLD = """
(path) => {
  const now = Date.now()
  const side = (who, at, text) => ({ device: who === 'mine' ? 'Laptop' : 'Pixel 9', at: now - at * 3600000, excerpt: { text, marks: [] } })
  window.__held = window.nibApp.sync2.connectFake([{
    id: 'held', path, name: 'Plan.md',
    mine: side('mine', 2, 'We meet at noon on Friday, at the old station.'),
    theirs: side('theirs', 1, 'We meet at one on Saturday, at the new station by the river.'),
  }])
}
"""


#: How long one surface is given, from opening it to putting it away. A step that
#: takes longer is said and the walk goes on to the next, so one surface that will
#: not open costs a line and not the run.
STEP = 45


async def step(one: Browser, page: Any, name: str, width: int, scheme: str, work: Any) -> None:
    """One surface's walk, held to `STEP`; a surface that stalls or throws is said,
    and whatever it left open is put away before the next."""
    try:
        await asyncio.wait_for(work, STEP)
    except Exception as error:  # noqa: BLE001 - said, and the walk goes on
        words = str(error).splitlines()[0] if str(error) else type(error).__name__
        one.found.append(f"[{one.kind} {width} {scheme}] {name}: could not be walked: {words}")
        await one.photograph(page, f"stalled-{width}-{scheme}-{name}")
        for _ in range(3):
            await page.keyboard.press("Escape")
        await page.evaluate(
            "() => { const app = window.nibApp; app.settings.open = false; app.account.open = false;"
            " if (app.themeStore) app.themeStore.open = false; app.iconChoice.close?.() }"
        )
        await settle(page)


async def new_tab(one: Browser, page: Any, width: int, scheme: str) -> None:
    """The new tab, and the tab it replaced back afterwards."""
    before = await page.evaluate("() => { const ws = window.nibApp.workspace; const was = ws.active?.id; ws.newTab(); return was }")
    await page.wait_for_timeout(120)
    await one.check(page, "new tab", width, scheme)
    await page.evaluate(
        """(before) => {
          const ws = window.nibApp.workspace
          const made = ws.active?.id
          if (made && made !== before) ws.close(made, false)
          if (before) ws.activate(before)
          document.activeElement?.blur?.()
        }""",
        before,
    )
    await page.wait_for_timeout(60)


async def sync_question(one: Browser, page: Any, width: int, scheme: str) -> None:
    if one.kind == "phone":
        # Either side is a drawer over the note on a phone, and the question waits for
        # the note to be in view.
        await page.evaluate("() => window.nibApp.workspace.closePanel('left')")
        await given_back(page)
        await page.evaluate("() => window.nibApp.workspace.closePanel('right')")
        await given_back(page)
    await layer(
        one, page, "sync question", width, scheme,
        f"() => {{ ({HOLD})({json.dumps(one.path)}) }}",
        '[role="dialog"][aria-label="Plan.md"]',
        "() => { window.__held?.stop() }",
    )


async def surfaces(one: Browser, page: Any, width: int, scheme: str) -> None:
    """Everything but the settings, at one width in one scheme."""
    walks = [
        ("the window", one.check(page, "the window", width, scheme)),
        ("panels", panels(one, page, width, scheme)),
        ("menus", menus(one, page, width, scheme)),
        ("palette", palette(one, page, width, scheme)),
        ("palette / theme", palette(one, page, width, scheme, "theme")),
        ("theme picker", through_palette(one, page, "Switch theme", "theme picker", '[role="dialog"][aria-label="Themes"]', width, scheme)),
        ("question", through_palette(one, page, "Convert syntax", "question", '[role="dialog"]:has(form)', width, scheme)),
        ("theme store", layer(
            one, page, "theme store", width, scheme,
            "() => { window.nibApp.settings.show('appearance'); window.nibApp.themeStore.open = true }",
            '[role="dialog"][aria-label="Themes"]',
            "() => { window.nibApp.themeStore.open = false; window.nibApp.settings.open = false }",
        )),
        ("icon picker", layer(
            one, page, "icon picker", width, scheme,
            f"() => {{ window.nibApp.iconChoice.file({json.dumps(one.path)}) }}",
            '[role="dialog"][aria-label="Choose an icon"]',
            "() => { window.nibApp.iconChoice.close() }",
        )),
        ("sync question", sync_question(one, page, width, scheme)),
        ("new tab", new_tab(one, page, width, scheme)),
    ]
    if not one.signed_in:
        walks.append(("sign in", layer(
            one, page, "sign in", width, scheme,
            "() => { window.nibApp.account.open = true }",
            '[role="dialog"]:has(input[type="email"])',
            "() => { window.nibApp.account.open = false }",
        )))
    for name, work in walks:
        await step(one, page, name, width, scheme, work)


async def empty(one: Browser, page: Any, width: int, scheme: str) -> None:
    """A space with nothing in it: the file list's and the window's empty states."""
    made = await page.evaluate(
        """async () => {
          const ws = window.nibApp.workspace
          try { await ws.addSpace('Empty') } catch { return false }
          await ws.loadTree()
          return ws.activeSpace?.name === 'Empty'
        }"""
    )
    if not made:
        return
    await page.wait_for_timeout(200)
    await one.check(page, "an empty space", width, scheme)


async def sweep_one(one: Browser, browser: Any) -> None:
    page = await one.open(browser)
    widths = (PHONE["width"],) if one.kind == "phone" else DESKTOP_WIDTHS
    if "--widths" in sys.argv and one.kind != "phone":
        widths = tuple(int(w) for w in sys.argv[sys.argv.index("--widths") + 1].split(","))
    for width in widths:
        if one.kind != "phone":
            await page.set_viewport_size({"width": width, "height": DESKTOP_HEIGHT})
        for scheme in SCHEMES:
            say(f"{one.label}: {width} {scheme}, {one.surfaces} surfaces so far")
            await scheme_of(page, scheme)
            await step(one, page, "settings", width, scheme, settings(one, page, width, scheme))
            await surfaces(one, page, width, scheme)
    await empty(one, page, widths[-1], SCHEMES[-1])
    await page.context.close()


async def sweep() -> list[Browser]:
    from playwright.async_api import async_playwright

    kinds = [Browser(kind, signed_in) for kind in ("desktop", "phone") for signed_in in (False, True)]
    # `--only desktop-out` and the like, for a run at one desk: the four are
    # desktop-out, desktop-in, phone-out and phone-in.
    if "--only" in sys.argv:
        wanted = sys.argv[sys.argv.index("--only") + 1].split(",")
        kinds = [one for one in kinds if f"{one.kind}-{'in' if one.signed_in else 'out'}" in wanted]
    async with async_playwright() as play:
        browser = await play.chromium.launch(channel=os.environ.get("NIB_BROWSER", "chromium"))
        try:
            results = await asyncio.gather(*(sweep_one(one, browser) for one in kinds), return_exceptions=True)
        finally:
            await browser.close()
    for one, result in zip(kinds, results, strict=True):
        if isinstance(result, BaseException):
            wrong(f"[{one.label}] the sweep stopped after {one.at}: {type(result).__name__}: {str(result).splitlines()[0]}")
    return kinds


def main() -> int:
    started = time.monotonic()
    with DRIVE.session(browser=False):
        kinds = asyncio.run(sweep())

    for one in kinds:
        say(f"{one.label}: {one.surfaces} surfaces, {len(one.found)} faults")
        for error in dict.fromkeys(one.errors):
            # Signed in, the service is this drive's stand-in and its refusals are its
            # own; signed out, a page error is the app's.
            if one.signed_in:
                say(f"  page error (stand-in service): {error.splitlines()[0]}")
            else:
                wrong(f"[{one.label}] page error: {error.splitlines()[0]}")
        for fault in dict.fromkeys(one.found):
            wrong(fault)
    say(f"swept in {time.monotonic() - started:.0f}s")
    return DRIVE.verdict()


if __name__ == "__main__":
    raise SystemExit(main())
