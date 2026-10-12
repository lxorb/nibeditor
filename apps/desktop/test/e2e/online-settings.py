"""Settings > Online terminal, for a machine in the cloud and for a server of its own, at
three widths of a window, in light and dark, and on a phone.

Issue 245: the machine's Start, Stop or Restart was the card's full-width action rather
than the small one at the end of a row, so it took the whole row and left the row's name
no width at all - `Machine`, its state and its server drawn one letter to a line, down
past the bottom of the window, with `Restart` floating half way down beside them.

The account is answered here: `GET /v2/online/machine` with each of the two machines, and
everything else the app would ask of nibeditor.com refused. What it checks, at every
width and in every look, and fails on:

  - the machine's row is one row: its name as wide as its words, the row no taller than
    its name, its state and its server's line;
  - the action is the small one at the row's end, not a line across it;
  - every meter's name and numbers share a line, and the bar is as wide as the card;
  - nothing in the pane is wider than the pane;
  - every session on the machine is a row of its own, called by what runs in it, in the
    order they last printed, with End the small action at its end; and End, once asked
    and said yes to, ends that session on the account and takes its row away.

From the repository root; the harness builds the app with its handle on the page the
first time and serves it (see harness.py):

    python apps/desktop/test/e2e/online-settings.py

Screenshots go beside this file under `shots/online-settings/`, which is ignored.
"""

from __future__ import annotations

import json
import time

from playwright.sync_api import Browser, Page, Route

from harness import Drive
from settling import quiet

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot

DESKTOP_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)"
    " Chrome/140.0.0.0 Safari/537.36"
)
PHONE_AGENT = (
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36"
)

GB = 1_000_000_000
HOUR = 3600

#: The month, as the Worker counts it, a little over half way through.
ALLOWANCE = {"awakeS": 20 * HOUR, "cpuS": 10 * HOUR, "homeBytes": 5 * GB, "egressBytes": 20 * GB}
USED = {"awakeS": 17 * HOUR, "cpuS": 2 * HOUR, "homeBytes": int(1.4 * GB), "egressBytes": 3 * GB}

#: The two machines a person can have: one in the cloud that sleeps, and a server of its
#: own that is always on (docs/online-terminal.md 4.15), the one the issue's screenshot
#: was taken of.
MACHINES = {
    "cloud": {
        "id": "m-cloud",
        "state": "asleep",
        "held": False,
        "host": "cloudflare",
        "server": None,
        "disk": None,
    },
    "server": {
        "id": "m-server",
        "state": "awake",
        "held": False,
        "host": "hetzner",
        "server": {
            "type": "cx43",
            "location": "fsn1",
            "cores": 8,
            "memoryGb": 16,
            "diskGb": 160,
            "price": 16.49,
            "currency": "EUR",
        },
        "disk": {"used": 131 * GB, "total": 160 * GB},
    },
}

#: The machine's sessions, as `GET /v2/online/terms` answers them: an agent at work, an
#: editor, and a shell no file names any more, each with what the machine says of it.
SESSIONS = [
    {
        "term": "note-agent",
        "session": "s_agent",
        "typing": "owner",
        "createdAt": 1_790_000_000_000,
        "space": "space-1",
        "path": "Build/Terminal.term",
        "trashed": False,
        "program": "claude",
        "title": "Fix the flaky upload test and the build that goes with it",
        "alive": True,
        "at": 1_790_000_900_000,
    },
    {
        "term": "note-editor",
        "session": "s_editor",
        "typing": "owner",
        "createdAt": 1_790_000_100_000,
        "space": "space-1",
        "path": "Notes/Terminal 2.term",
        "trashed": False,
        "program": "vim",
        "title": None,
        "alive": True,
        "at": 1_790_000_500_000,
    },
    {
        "term": None,
        "session": "s_orphan",
        "typing": "owner",
        "createdAt": None,
        "space": None,
        "path": None,
        "trashed": False,
        "program": None,
        "title": None,
        "alive": True,
        "at": None,
    },
]

#: Their rows' names, in the order the pane lists them.
NAMES = ["Fix the flaky upload test and the build that goes with it", "vim", "Terminal"]

#: Every session's row: its name, how tall the row is, and its actions, the last of which
#: should sit at the row's end.
ROWS = """
() => {
  const box = (one) => one.getBoundingClientRect()
  return [...document.querySelectorAll('.online .nib-setting')].slice(1).map((row) => {
    const name = row.querySelector('.name')
    const chips = [...row.querySelectorAll('button')]
    return {
      name: name.firstChild.textContent.trim(),
      height: box(row).height,
      width: box(row).width,
      nameWidth: box(name).width,
      chips: chips.map((chip) => ({
        label: chip.textContent.trim(),
        chip: chip.classList.contains('nib-chip'),
        width: box(chip).width,
      })),
      lastRight: chips.length ? box(chips.at(-1)).right : 0,
      end: box(row).right - parseFloat(getComputedStyle(row).paddingRight),
    }
  })
}
"""


class Account:
    """The account's sessions, kept as the routes change them: `DELETE` ends one."""

    def __init__(self) -> None:
        self.sessions = [dict(one) for one in SESSIONS]
        self.ended: list[str] = []

    def answer(self, route: Route) -> None:
        if route.request.method == "DELETE":
            ended = route.request.url.rsplit("/", 1)[-1]
            self.ended.append(ended)
            self.sessions = [one for one in self.sessions if (one["term"] or one["session"]) != ended]
            route.fulfill(status=200, content_type="application/json", body='{"ok": true}')
            return
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"terms": self.sessions}))


#: Every look: what the window is, how wide, and in which scheme.
LOOKS = [
    ("desktop", 1280, 860, "light"),
    ("desktop", 960, 760, "light"),
    ("desktop", 720, 720, "dark"),
    ("desktop", 1280, 860, "dark"),
    ("phone", 390, 844, "light"),
    ("phone", 390, 844, "dark"),
]

# A session, put straight into the store, as recording.py does: signing in properly is
# signin.py's drive, and the pane only asks that there is an account.
SIGNED_IN = """
() => {
  const app = window.nibApp
  app.account.token = 'a-drive-session'
  app.account.user = { id: 'drive', email: 'drive@example.com', name: 'Drive' }
  app.account.settling = false
  return !!app.account.accountToken
}
"""

#: What the pane draws, measured: the machine's row and what is in it, every meter, and
#: whether anything in the pane runs past its side.
MEASURE = """
() => {
  const box = (one) => one ? one.getBoundingClientRect() : null
  const pane = document.querySelector('.sheet .body')
  const online = document.querySelector('.online')
  const row = online?.querySelector('.nib-setting')
  const name = row?.querySelector('.name')
  const action = row?.querySelector('button')
  const meters = [...(online?.querySelectorAll('.meter') ?? [])].map((meter) => {
    const line = meter.querySelector('.line')
    const words = [...line.children].map(box)
    return {
      label: line.children[0]?.textContent.trim() ?? '',
      oneLine: words.length === 2 && Math.abs(words[0].top - words[1].top) < 2,
      track: box(meter.querySelector('[role=meter]')).width,
      wide: box(meter).width,
    }
  })
  const past = [...(online?.querySelectorAll('*') ?? [])].filter(
    (one) => box(one).right > box(pane).right + 0.5 || box(one).left < box(pane).left - 0.5,
  )
  return {
    row: box(row) && {
      width: box(row).width,
      height: box(row).height,
      end: box(row).right - parseFloat(getComputedStyle(row).paddingRight),
    },
    name: box(name) && {
      width: box(name).width,
      height: box(name).height,
      words: name.scrollWidth,
      lines: [...name.childNodes].filter((one) => one.textContent.trim()).length,
    },
    action: box(action) && {
      width: box(action).width,
      height: box(action).height,
      right: box(action).right,
      label: action.textContent.trim(),
      chip: action.classList.contains('nib-chip'),
    },
    meters,
    past: past.map((one) => one.className || one.tagName),
    scrolls: pane.scrollWidth > pane.clientWidth,
  }
}
"""


def check(what: str, held: bool) -> None:
    if held:
        say(f"ok   {what}")
    else:
        wrong(what)


def answering(machine: dict[str, object]):
    """The account's answer about its machine and its month."""

    def answer(route: Route) -> None:
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "allowed": True,
                    "machine": machine,
                    "used": USED,
                    "limit": ALLOWANCE,
                    "resetAt": int((time.time() + 12 * 86400) * 1000),
                }
            ),
        )

    return answer


def look(browser: Browser, kind: str, width: int, height: int, scheme: str) -> None:
    finger = kind == "phone"
    page = DRIVE.page(
        browser,
        viewport={"width": width, "height": height},
        user_agent=PHONE_AGENT if finger else DESKTOP_AGENT,
        has_touch=finger,
        is_mobile=finger,
        color_scheme=scheme,
        reduced_motion="reduce",
        device_scale_factor=2,
    )
    # Playwright tries the newest route first, so the refusal goes in before the answer.
    page.route("https://nibeditor.com/**", lambda route: route.abort())
    account = Account()
    page.route("**/v2/online/terms**", account.answer)
    for machine, about in MACHINES.items():
        page.unroute("**/v2/online/machine")
        page.route("**/v2/online/machine", answering(about))
        if machine == "cloud":
            DRIVE.open(page)
            DRIVE.wait_for(page, SIGNED_IN, "the account")
        name = f"{kind}-{width}-{scheme}-{machine}"
        page.evaluate("() => window.nibApp.settings.show('general')")
        page.evaluate("() => window.nibApp.settings.show('online')")
        DRIVE.wait_for(page, "document.querySelector('.online .meter')", f"[{name}] the meters")
        quiet(page)
        shot(page, name)

        seen = page.evaluate(MEASURE)
        say(f"[{name}] {json.dumps(seen)}")
        row, words, action = seen["row"], seen["name"], seen["action"]
        if not (row and words and action):
            wrong(f"[{name}] the machine's row is not drawn")
            continue
        check(f"[{name}] the row's name is as wide as its words", words["width"] >= words["words"] - 0.5)
        check(f"[{name}] the row's name is wider than a word", words["width"] >= 120)
        check(f"[{name}] the row is a row, not a column ({row['height']:.0f}px)", row["height"] <= 140)
        check(
            f"[{name}] {action['label']} is the small action at the row's end",
            action["chip"] and action["width"] < row["width"] / 3 and abs(action["right"] - row["end"]) <= 1,
        )
        for meter in seen["meters"]:
            check(f"[{name}] {meter['label']}: its name and numbers share a line", meter["oneLine"])
            check(f"[{name}] {meter['label']}: the bar is the card's width", meter["track"] >= meter["wide"] - 1)
        check(f"[{name}] nothing in the pane runs past its side {seen['past']}", not seen["past"])
        check(f"[{name}] the pane does not scroll sideways", not seen["scrolls"])

        every = f"document.querySelectorAll('.online .nib-setting').length === {len(SESSIONS) + 1}"
        DRIVE.wait_for(page, every, f"[{name}] the sessions")
        listed = page.evaluate(ROWS)
        say(f"[{name}] sessions {json.dumps(listed)}")
        check(
            f"[{name}] every session is a row, called by what runs in it, last printed first",
            [one["name"] for one in listed] == NAMES,
        )
        for one in listed:
            label = one["name"][:24]
            check(f"[{name}] {label}: a row, not a column ({one['height']:.0f}px)", one["height"] <= 140)
            check(f"[{name}] {label}: its name has room", one["nameWidth"] >= 80)
            check(
                f"[{name}] {label}: End is the small action at the row's end",
                bool(one["chips"])
                and one["chips"][-1]["label"] == "End"
                and all(chip["chip"] and chip["width"] < one["width"] / 3 for chip in one["chips"])
                and abs(one["lastRight"] - one["end"]) <= 1,
            )

        if kind == "desktop" and width == 1280 and scheme == "light" and machine == "cloud":
            ending(page, account)

    page.context.close()


def ending(page: Page, account: Account) -> None:
    """End on the session no file names: asked first, nothing ended when the question is
    put away, and ended on the account by its own id once said yes to, its row gone."""
    danger = "document.querySelector('button.nib-button.is-danger')"
    last = page.locator(".online .nib-setting").last
    last.get_by_role("button", name="End").click()
    DRIVE.wait_for(page, danger, "End's question")
    shot(page, "end-asked")
    page.keyboard.press("Escape")
    DRIVE.wait_for(page, f"!{danger}", "the question put away")
    check("put away, the question ends nothing", account.ended == [])

    last.get_by_role("button", name="End").click()
    DRIVE.wait_for(page, danger, "End's question again")
    page.locator("button.nib-button.is-danger").click()
    DRIVE.wait_for(page, "document.querySelectorAll('.online .nib-setting').length === 3", "its row gone")
    check("End ends the session no file names, by its own id", account.ended == ["s_orphan"])
    shot(page, "end-ended")
    # Every look after this one lists all three again.
    account.sessions = [dict(one) for one in SESSIONS]
    account.ended.clear()


def drive(browser: Browser) -> None:
    for kind, width, height, scheme in LOOKS:
        look(browser, kind, width, height, scheme)


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "Settings > Online terminal is laid out in every look"))
