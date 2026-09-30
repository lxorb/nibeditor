"""What a web tab hands a page: nothing. Windows only.

Emil, 2026-09-30: every Google Sheet he opens in a web tab shows Google's own *"Loading
issue - Troubleshoot this issue by clearing application resources"* over a sheet that had
started to draw. The page's console said why: `Uncaught SyntaxError: Identifier 'ipc' has
already been declared`, in the editor's own bundle. wry writes a non-configurable
`window.ipc` into every document a Tauri webview creates, and a classic script may not
declare a top level `let ipc` while the global object carries one - the whole script is a
`SyntaxError`, and the editor never starts. See docs/web-tabs.md, "What a page is given:
nothing", and src-tauri/src/web_worlds.rs.

What this asks, of a page served on the loopback in a real web tab, read back over the
engine's own `DevTools` protocol (see `devtools.py`):

* **a page may declare `ipc`** - a classic script with `let ipc` at the top level runs.
* **nothing of the app is on its `window`** - no `ipc`, `isTauri` or `__TAURI_*`, and no
  `window.chrome.webview`.
* **nib's own scripts are in nib's world and not the page's** - the middle button's and
  the keys' listeners are on the window in the world named `nib`, and none of them in the
  page's own; in the page, in a frame from the same site, and in a frame from another
  site, which runs in a process of its own.
* **a window asked for from nib's world reaches the app** - `nib-behind`, as the middle
  button asks, opens a tab behind the page.
* **a page's dialogs are the page's** - `confirm()` holds the page's script until nib's
  card is answered and gives back `true` or `false`, never a promise; `prompt()` gives
  back the words typed or `null`; `alert()` shows. The dialog plugin used to answer a
  site's `confirm()` with a truthy promise at once, so *"Delete this?"* went ahead as if
  the reader had said yes. The card is answered by pressing its own buttons in the app's
  page; no dialog of the system's is ever drawn.

With `--real` it also opens real sites and reads each one's uncaught exceptions over a
reload: Google Sheets, Docs, Slides and the sign-in page, YouTube, GitHub, Proton Mail and
Moodle's sign-in. A `SyntaxError` from a declared global, or Google's editor never
starting, is a failure; `--shots` keeps a picture of each page, taken by the engine
itself, off the screen.

    python scripts/web-globals-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name> [--real] [--shots DIR]

Build the exe as `scripts/probe_app.py` says, with `--mode drive` for the window's
`nib` handle: `npx vite build --mode drive` in apps/desktop, then `tauri build` with
`"build":{"beforeBuildCommand":""}` in its `--config`. Nothing here presses a key, moves
the pointer or looks at the screen, and the app's own page is kept from asking for the
keyboard: a site asking for something raises a bubble that takes the keyboard back into
the app's page, and a window off the screen must not be asked to come anywhere.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import http.server
import importlib.util
import json
import os
import pathlib
import re
import shutil
import sys
import threading
import time

import devtools
from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent

#: The names a runtime puts on a page's `window`: its own, and `ipc` where it is the
#: runtime's frozen channel rather than something the page declared itself - Google's
#: spreadsheet editor has a function of that name once it has started.
APP_GLOBALS = r"^__TAURI|^isTauri$"

#: What Google's editors throw when their bundle did not run.
NEVER_STARTED = re.compile(
    r"has already been declared|RITZ_initializeModules|DOCS_initialLoadTiming|waffle_api"
)

REAL = {
    "Sheet": "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit",
    "Doc": "https://docs.google.com/document/d/195j9eDD3ccgjQRttHhJPymLJUCOUjs-jmwTrekvdjFE/edit",
    "Slides": "https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit",
    "Sign-in": "https://accounts.google.com/ServiceLogin?service=wise&continue=https://docs.google.com/spreadsheets/",
    "YouTube": "https://www.youtube.com/",
    "GitHub": "https://github.com/lxorb/nibeditor",
    "Proton": "https://account.proton.me/mail",
    "Moodle": "https://moodle-app2.let.ethz.ch/",
}

# The page asks itself, in the shape Google's bundle is: a classic script whose first
# statement is a top level lexical declaration of `ipc`. If the global object already
# carries a non-configurable `ipc`, the script is a SyntaxError as a whole and never runs
# a line. The frames are one from the page's own site and one from another, which runs in
# a process of its own.
PAGE = """<!doctype html>
<title>asked</title>
<body style="margin:0;font:16px system-ui;padding:2rem">a page asking what it was given
<script>
  let ipc = 1
  window.__letIpc = 'ok' + String(ipc).slice(1)
</script>
<iframe src="/same"></iframe>
<iframe src="http://localhost:__PORT__/other"></iframe>
"""

FRAME = "<!doctype html><title>frame</title><a href='https://example.com/'>a link</a>"

# The page's dialogs, opened on the next turn so the question that opens one comes back
# at once: the page's script stops at the dialog until it is answered, and what it was
# answered with - and how long it waited - is left on the page to be read afterwards.
DIALOGS = """<!doctype html><title>dialogs</title><p>a page with questions</p>
<script>
  window.__said = {}
  function ask(name, kind) {
    setTimeout(() => {
      const began = Date.now()
      const answer = kind === 'confirm' ? confirm('Delete this?')
        : kind === 'prompt' ? prompt('Your name?', 'Ada')
        : alert('Saved.')
      window.__said[name] = { type: typeof answer, value: answer ?? null, waited: Date.now() - began }
    }, 0)
  }
</script>
"""

#: Each case: the name it is kept under, the dialog, what is pressed on the card, what the
#: prompt's field holds when it is, and what the page must be left with.
DIALOG_CASES = [
    ("confirm, cancelled", "confirm", "cancel", None, {"type": "boolean", "value": False}),
    ("confirm, OK", "confirm", "ok", None, {"type": "boolean", "value": True}),
    ("prompt, typed", "prompt", "ok", "Grace", {"type": "string", "value": "Grace"}),
    ("prompt, cancelled", "prompt", "cancel", None, {"type": "object", "value": None}),
    ("alert", "alert", "ok", None, {"type": "undefined", "value": None}),
]

#: How long the card is left up before it is answered: a page that did not wait for it
#: would have answered itself long before.
HELD = 1.5

# The card, as the app's page draws it: what it says, and its buttons.
CARD = """JSON.stringify((() => {
  const card = document.querySelector('.dialog[role=alertdialog]')
  if (!card) return null
  return {
    said: card.innerText,
    buttons: [...card.querySelectorAll('button')].map((one) => one.textContent.trim()),
    field: card.querySelector('input')?.value ?? null,
  }
})())"""

PRESS = """(() => {
  const card = document.querySelector('.dialog[role=alertdialog]')
  if (!card) return 'no card'
  const field = card.querySelector('input')
  const typed = __TYPED__
  if (field && typed !== null) {
    field.value = typed
    field.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const quiet = card.querySelector('button.is-quiet')
  const main = [...card.querySelectorAll('button')].find((one) => !one.classList.contains('is-quiet'))
  ;(__CANCEL__ ? quiet : main).click()
  return 'pressed'
})()"""

ASKED = f"""(() => {{
  const channel = Object.getOwnPropertyDescriptor(window, 'ipc')
  const runtime = !!channel && !channel.configurable && typeof window.ipc === 'object'
    && !!window.ipc && typeof window.ipc.postMessage === 'function'
  return JSON.stringify({{
    letIpc: window.__letIpc || 'SyntaxError',
    globals: Object.getOwnPropertyNames(window).filter((one) => /{APP_GLOBALS}/.test(one))
      .concat(runtime ? ['ipc'] : []),
    webview: !!(window.chrome && window.chrome.webview),
  }})
}})()"""

LISTENING = "JSON.stringify(Object.keys(getEventListeners(window)).sort())"

# The app's own page keeps from asking for the keyboard while a probe runs: its `fetch`
# is how every call reaches the crate, and a call to focus is answered here instead.
FOCUSLESS = r"""(() => {
  const real = window.fetch.bind(window)
  window.fetch = function (input, init) {
    const url = String((input && input.url) || input)
    if (/set_webview_focus|%7Cset_focus/.test(url)) {
      return Promise.resolve(new Response('null', {
        headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' },
      }))
    }
    return real(input, init)
  }
  return 'ok'
})()"""

TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({
  name: one.name, kind: one.kind, showing: one.id === nib.workspace.activeTabId,
})))"""

SHOT = """(async () => window.__TAURI_INTERNALS__.invoke('web_shot', {
  tab: nib.workspace.activeTabId,
}))()"""

HWND_BOTTOM = 1
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010


def borrowed():
    """The switch probe's own helpers: the space, the launch, the endpoint, `eval`."""

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def serve(port: int) -> http.server.ThreadingHTTPServer:
    pages = {
        "/asked": PAGE.replace("__PORT__", str(port)),
        "/same": FRAME,
        "/other": FRAME,
        "/dialogs": DIALOGS,
    }

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = pages.get(self.path.split("?")[0], "").encode()
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    made.daemon_threads = True
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def ready(app, seconds: float = 90) -> None:
    """Waits for the window to answer. The endpoint listens before the window is there to
    ask, and a request sent in between is refused rather than queued."""

    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        if app.ask("1", 10) == 1:
            return
        time.sleep(0.5)
    raise SystemExit("the window never answered")


def lowest(hwnd: int) -> None:
    """The probe at the bottom of the z-order, so a window closing elsewhere never hands
    it the foreground."""

    ctypes.WinDLL("user32").SetWindowPos(
        hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
    )


def page_of(at: int, address: str, seconds: float = 30) -> dict | None:
    """The page target showing `address`, or one on its host, once there is one."""

    host = address.split("/")[2]
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        pages = [one for one in devtools.targets(at) if one.get("type") == "page"]
        for one in pages:
            if one.get("url", "").startswith(address.split("?")[0]):
                return one
        for one in pages:
            if host in one.get("url", ""):
                return one
        time.sleep(0.5)
    return None


def listeners(at: int, port: int) -> dict[str, dict[str, object]]:
    """Which listeners each frame of the loopback page has on its window, by the frame's
    path: in nib's world, and - for a frame that is a target of its own, the page and the
    frame from another site - in the page's own world as well."""

    out: dict[str, dict[str, object]] = {}
    for target in devtools.targets(at):
        if target.get("type") not in ("page", "iframe") or str(port) not in target.get("url", ""):
            continue
        session = devtools.Session(target)
        try:
            root = session.call("Page.getFrameTree").get("frameTree", {})
            frames = [root]
            while frames:
                node = frames.pop()
                frames.extend(node.get("childFrames", []))
                frame = node.get("frame", {})
                # A frame in a process of its own is listed here too, and answered by its
                # own target: no world can be made for it from this one.
                world = session.world("nib", frame.get("id"))
                if world is None:
                    continue
                one = out.setdefault("/" + frame.get("url", "").split("/", 3)[-1], {})
                one["nib"] = session.value(LISTENING, world, console=True)
                if node is root:
                    one["page"] = session.value(LISTENING, console=True)
        finally:
            session.close()
    return out


def dialogs(app, at: int, port: int) -> tuple[dict[str, object], list[str]]:
    """Opens each of the page's dialogs, answers nib's card for it, and reads back what
    the page's script was given."""

    said: dict[str, object] = {}
    wrong: list[str] = []
    target = page_of(at, f"http://127.0.0.1:{port}/dialogs")
    if target is None:
        return said, ["the dialogs page never appeared among the engine's targets"]

    for name, kind, press, typed, want in DIALOG_CASES:
        session = devtools.Session(target)
        session.value(f"ask({json.dumps(name)}, {json.dumps(kind)})")
        session.close()

        card = None
        until = time.perf_counter() + 10
        while card is None and time.perf_counter() < until:
            card = app.ask(CARD)
            if not isinstance(card, dict):
                card = None
                time.sleep(0.2)
        if card is None:
            wrong.append(f"{name}: no card appeared")
            continue

        time.sleep(HELD)
        app.ask(
            PRESS.replace("__TYPED__", json.dumps(typed)).replace(
                "__CANCEL__", "true" if press == "cancel" else "false"
            )
        )
        time.sleep(0.5)

        session = devtools.Session(target)
        got = session.value(f"JSON.stringify(window.__said[{json.dumps(name)}] ?? null)")
        session.close()
        got = json.loads(got) if isinstance(got, str) else None
        said[name] = {"card": card, "page": got}
        if not isinstance(got, dict):
            wrong.append(f"{name}: the page's script never went on")
            continue
        if {key: got.get(key) for key in want} != want:
            wrong.append(f"{name}: the page was given {got}, not {want}")
        if (got.get("waited") or 0) < HELD * 1000 * 0.8:
            wrong.append(f"{name}: the page did not wait for the answer ({got.get('waited')} ms)")
    return said, wrong


def shot(app, to: pathlib.Path | None, name: str) -> str:
    if to is None:
        return ""
    picture = app.ask(SHOT, 60)
    if not (isinstance(picture, str) and picture.startswith("data:image/png;base64,")):
        return f"no picture: {str(picture)[:120]}"
    to.mkdir(parents=True, exist_ok=True)
    path = to / f"{name}.png"
    path.write_bytes(base64.b64decode(picture.split(",", 1)[1]))
    return str(path)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.globals")
    parsed.add_argument("--real", action="store_true", help="also open the real sites")
    parsed.add_argument("--wait", type=float, default=15, help="seconds a real site gets to load")
    parsed.add_argument("--shots", type=pathlib.Path, help="keep a picture of each page here")
    args = parsed.parse_args()

    switch = borrowed()
    switch.wipe(args.identifier)
    port = switch.free_port()
    server = serve(port)

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "Asked.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/asked", "Asked"), encoding="utf-8"
    )
    (space / "Dialogs.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/dialogs", "Dialogs"), encoding="utf-8"
    )
    sites = REAL if args.real else {}
    for name, url in sites.items():
        (space / f"{name}.url").write_text(switch.shortcut(url, name), encoding="utf-8")

    os.environ.update(devtools.debugged())
    web = switch.config_dir(args.identifier) / "web"
    wrong: list[str] = []
    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)

        running, app, hwnd = switch.launch(args.exe, args.identifier, unlike=app.port)
        lowest(hwnd)
        ready(app)
        if app.ask(FOCUSLESS) != "ok":
            raise SystemExit("the app's own page could not be kept from asking for the keyboard")
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)

        app.open("Asked.url")
        time.sleep(6)
        at = devtools.port(web)
        target = page_of(at, f"http://127.0.0.1:{port}/asked") if at else None
        if target is None:
            print("the loopback page never appeared among the engine's targets")
            return 1
        session = devtools.Session(target)
        asked = session.value(ASKED)
        asked = json.loads(asked) if isinstance(asked, str) else {"letIpc": str(asked)}
        frames = listeners(at, port)
        before = app.ask(TABS)
        # The middle button's own request, from nib's world, as if pressed: the press is
        # `userGesture`, which is the page's word that a person asked and not a key.
        session.call(
            "Runtime.evaluate",
            {
                "expression": "open('https://example.com/?behind', 'nib-behind'), 'asked'",
                "contextId": session.world("nib"),
                "userGesture": True,
            },
        )
        session.close()
        time.sleep(4)
        after = app.ask(TABS)
        said["loopback"] = {"asked": asked, "frames": frames, "shot": shot(app, args.shots, "loopback")}

        if asked.get("letIpc") != "ok":
            wrong.append("a page may not declare `ipc`: the runtime's global is still in its world")
        if asked.get("globals"):
            wrong.append(f"the app's globals are on the page's window: {asked['globals']}")
        if asked.get("webview"):
            wrong.append("the page has window.chrome.webview")
        for path in ("/asked", "/same", "/other"):
            one = frames.get(path, {})
            nib = json.loads(str(one.get("nib") or "[]"))
            page = json.loads(str(one.get("page") or "[]"))
            if not {"auxclick", "keydown"} <= set(nib):
                wrong.append(f"nib's world in {path} has no listeners: {one}")
            if {"auxclick", "keydown"} & set(page):
                wrong.append(f"the page's own world in {path} has nib's listeners: {page}")
        added = (
            [one for one in after if one not in before]
            if isinstance(after, list) and isinstance(before, list)
            else []
        )
        if not any(one.get("kind") == "web" and not one.get("showing") for one in added):
            wrong.append(f"a window asked for from nib's world opened no tab behind: {after}")

        # Only on a build whose pages are handed nothing: an older one leaves the page's
        # `prompt` to the engine's own window, which is drawn by the engine's process -
        # where the probe's watch over the app's own windows cannot see it.
        if wrong:
            wrong.append("the dialogs were not asked: this build still hands the page the app's")
        else:
            app.open("Dialogs.url")
            time.sleep(4)
            said["dialogs"], asked_wrong = dialogs(app, at, port)
            wrong.extend(asked_wrong)

        for name, url in sites.items():
            app.open(f"{name}.url")
            time.sleep(args.wait)
            target = page_of(at, url)
            if target is None:
                wrong.append(f"{name}: never among the engine's targets")
                continue
            session = devtools.Session(target)
            session.call("Runtime.enable")
            session.listen(1)
            session.events.clear()
            session.call("Page.reload")
            session.listen(args.wait)
            thrown = devtools.thrown(session.events)
            given = session.value(ASKED)
            session.close()
            given = json.loads(given) if isinstance(given, str) else {}
            said[name] = {
                "exceptions": thrown,
                "app globals": given.get("globals"),
                "shot": shot(app, args.shots, name),
            }
            broken = [one for one in thrown if NEVER_STARTED.search(one)]
            if broken:
                wrong.append(f"{name}: {broken[0]}")
            if given.get("globals"):
                wrong.append(f"{name}: the app's globals are on its window: {given['globals']}")
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    raise SystemExit(main())
