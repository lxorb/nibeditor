"""How long a web tab takes to show its page, and whether it shows one at all. Windows only.

Emil, 2026-09-17: *"Browser tabs take AN ETERNITY to load."* The eternity was not a
slow load. Every way of opening a website except clicking its row in the file list goes
through a layer - the palette, the app menu, the chooser Ctrl+T opens, a row's own menu
- and a layer that has closed is still in the document for the 120 to 190 ms it takes to
play its way out. The pane measured itself under it, the hit test said something was
over the hole, and **the page was not asked for at all**. Nothing asked again: the
rectangle had not changed and the overlay stack was already empty. The tab sat on an
empty pane until the reader happened to press something, which is what made the page
arrive. See `look` in lib/web-tab/WebTab.svelte.

So this probe asks two questions of the packaged app, and the first of them is not about
a clock:

* **opened under a layer** - a tab whose pane is covered at the moment it mounts has a
  page anyway, and got it without anybody touching the window. `False` is the bug.
  Checked on every run, because it is the same answer on a loaded machine and an idle
  one.
* **cold ms**, **open ms**, **covered ms** - the click to the page saying what it is
  called: the first web tab of the run, which pays for starting the engine, and every
  one after it. Held against a budget only when `NIB_PERF=1` says somebody is measuring
  rather than checking, because a clock on a busy machine says more about the machine
  than about the code; see fuzzy.perf.test.ts for the same rule in the unit tests.

The page is served from here, on a port of its own, so nothing is asked of anybody's
network and the number is about the app rather than about the weather. What the app is
asked to do goes through its own automation endpoint, so every stage is the one a reader
would walk.

    python scripts/web-open-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe

The exe is a probe build, under an identifier of its own, so a run never touches an
installed app's settings or its browsing profile:

    pnpm --dir apps/desktop tauri build --no-bundle \
      --config '{"identifier":"ch.emilvinu.nib.probe"}'

`eval` is turned on in that identifier's own endpoint file between two launches, because
the crate reads the flag when it opens the socket. Nothing else can turn it on; see
src-tauri/src/endpoint.rs.

The counts behind the same fix are in the unit tests beside the code, where they belong
and where CI runs them: `src/lib/web-tab/pages.test.ts` and
`test/effects/web-switch.effect.test.ts`.
"""

from __future__ import annotations

import argparse
import atexit
import ctypes
import http.server
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes

# Where this probe may listen; see docs/conventions.md.
PORT_FROM = 23780
PORT_TO = 23799

# What says where the notes go. The identifier a probe build runs under does not keep
# anybody's notes apart, so this is the one thing that does; see `spaces_root` and
# docs/automation.md.
SPACES_DIR = "NIB_SPACES_DIR"

SPACE = "Web open probe"
NOTE = "Idea"

# How many sites the space holds. One for the first tab of the run, one for an ordinary
# open, one for the open that happens under a layer, and a couple spare so no two
# measurements share a page the engine has already cached.
SITES = 5

# What the clock is held against, in milliseconds, and only when somebody asked for it
# to be. Wide on purpose: this machine opens a local page in a warm tab in about 100 ms
# and pays about 300 ms more for the first tab of a run, which is the engine starting.
# A budget is here to catch the page not being asked for at all - the shape of this bug -
# rather than to notice a handful of milliseconds.
COLD_MS = 2500
OPEN_MS = 800
COVERED_MS = 1500

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


def clocked() -> bool:
    """Whether the wall clock may be asserted on at all.

    `NIB_PERF=1` says somebody is measuring rather than checking. The one thing above
    that is not a clock is checked on every run."""

    return os.environ.get("NIB_PERF") == "1"


def windows_of(pid: int) -> list[int]:
    """The visible top level windows this process owns."""

    assert user32 is not None
    found: list[int] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return found


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def titled(at: int) -> str:
    """What the page at this address calls itself. Nothing but the engine reading the
    page can put this in the bar, which is what makes it the end of the measurement;
    the `Title` in the shortcut is `Site 1` and is there from the first frame."""

    return f"Probe page{at}"


def page(name: str) -> bytes:
    """A page plain enough that nothing about it can move on its own, and tall enough
    that the engine has something to lay out."""

    return f"""<!doctype html>
<title>{name}</title>
<body style="margin:0;font:16px system-ui">
<h1 style="margin:0;padding:2rem">{name}</h1>
<div style="height:9000px;background:linear-gradient(#fff,#048)"></div>
</body>
""".encode()


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = page(f"Probe {self.path.strip('/')}")
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def spaces_root() -> pathlib.Path:
    """A spaces root of this probe's own, in the temp area, said to the app in
    `NIB_SPACES_DIR` and taken away when it exits.

    **Never `Documents/Nib`.** The identifier a probe build runs under moves the
    settings folder and the browsing profile and says nothing at all about where the
    spaces are, so a probe that wrote its space the obvious way would write it beside
    somebody's real notes; see `spaces_dir` and docs/automation.md."""

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-open-probe-"))
    os.environ[SPACES_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made


def shortcut(url: str, title: str) -> str:
    return (
        "[InternetShortcut]\r\n"
        f"URL={url}\r\n"
        f"Title={title}\r\n"
        "Nib-Added=2026-09-17T08:00:00.000Z\r\n"
    )


def space(port: int) -> pathlib.Path:
    made = spaces_root() / SPACE
    shutil.rmtree(made, ignore_errors=True)
    made.mkdir(parents=True, exist_ok=True)
    (made / f"{NOTE}.md").write_text(
        f"# {NOTE}\n\nAn ordinary note, to open the space on.\n", encoding="utf-8"
    )
    for index in range(1, SITES + 1):
        (made / f"Site {index}.url").write_text(
            shortcut(f"http://127.0.0.1:{port}/page{index}", f"Site {index}"),
            encoding="utf-8",
        )
    return made


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for one in (config_dir(identifier), local_dir(identifier)):
        shutil.rmtree(one, ignore_errors=True)


def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str, int]:
    """The port, the secret and the process listening on them.

    The process matters. nib is single instance, so a launch while a nib is already
    running hands the arguments over and exits - and a probe that did not look would
    then be driving somebody else's window, on somebody else's space, and reporting
    that no page ever arrived. See `launch`."""

    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"]), int(said.get("pid") or 0)
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(
        f"the app never wrote {path} - if a nib is already running, close it first:"
        " this is a single instance app and a second launch hands over and exits"
    )


def allow_eval(identifier: str) -> None:
    """Turns on the one verb that can ask the window a question of its own. Between two
    launches, because the crate reads the flag when it opens the socket. Written as
    plain bytes with no mark in front of them: the crate reads JSON, and a file that
    begins with a byte order mark is a file it cannot parse - which reads exactly like
    the flag having been ignored."""

    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))


def act(port: int, secret: str, verb: str, args: dict[str, object], seconds: float = 90) -> object:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=seconds) as answer:
            return json.loads(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as refused:
        return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return {"ok": False, "error": f"no answer: {error}"}


class App:
    """The running app, asked things."""

    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def open(self, path: str, space: str | None = None) -> object:
        args: dict[str, object] = {"path": path}
        if space:
            args["space"] = space
        return act(self.port, self.secret, "open", args)

    def ask(self, code: str, seconds: float = 90) -> object:
        said = act(self.port, self.secret, "eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value


# One open, timed inside the window on the window's own clock, so the round trip this
# probe takes to ask the question is not in the number.
#
# `__VEIL__` is the layer that opened the tab, still in the document and already off the
# overlay stack: the app plays a scrim out over 130 ms and a menu over 120, and those are
# frames in which nothing in the app knows it is there. A plain element stands in for it,
# because the point is what the pane does while something is over the hole and not which
# component put it there.
#
# The end of the measurement is the page saying what **it** is called, which is the
# first moment there is a site on screen rather than an empty pane. The name has to come
# out of the page rather than out of the file: a shortcut carries a `Title` and the bar
# wears it from the first frame, so a probe that waited for the bar to say anything at
# all would be timing the file being read. `__NAMED__` is what the served page calls
# itself, and nothing but the engine can put it there.
OPEN = r"""
(async () => {
  const ws = nib.workspace
  const path = __PATH__
  const veiled = __VEIL__
  const named = __NAMED__

  let veil = null
  if (veiled) {
    veil = document.createElement('div')
    veil.style.cssText = 'position:fixed;inset:0;z-index:99999'
    document.body.append(veil)
    setTimeout(() => veil.remove(), 160)
  }

  const zero = performance.now()
  const said = (one) => (one && one.name) || ''
  ws.openWeb(path)

  const painted = await new Promise((go) => {
    const until = performance.now() + 20000
    const tick = () => {
      const tab = ws.tabs.find((one) => one.kind === 'web' && one.path === path)
      const bar = document.querySelector('.webbar input')
      // The field wears the site and the page's own name once the page has said what
      // it is called. See WebBar.svelte.
      if (tab && bar && bar.value.includes(named)) return go(Math.round(performance.now() - zero))
      if (performance.now() > until) return go(null)
      requestAnimationFrame(tick)
    }
    tick()
  })

  if (veil) veil.remove()
  const tab = ws.tabs.find((one) => one.kind === 'web' && one.path === path)
  return JSON.stringify({ ms: painted, name: said(tab) })
})()
"""

CLOSE_ALL = r"""
(() => {
  const ws = nib.workspace
  for (const one of [...ws.tabs]) { if (one.kind === 'web') ws.close(one.id) }
  return JSON.stringify({ left: ws.tabs.length })
})()
"""


def opened(app: App, space_dir: pathlib.Path, at: int, veiled: bool) -> int | None:
    """Opens one site and answers how long it took to be on screen, in milliseconds, or
    None for a page that never arrived - which is the bug this probe is about."""

    code = (
        OPEN.replace("__PATH__", json.dumps(str(space_dir / f"Site {at}.url")))
        .replace("__VEIL__", "true" if veiled else "false")
        .replace("__NAMED__", json.dumps(titled(at)))
    )
    said = app.ask(code, seconds=60)
    if not isinstance(said, dict):
        return None
    ms = said.get("ms")
    return int(ms) if isinstance(ms, int) else None


def launch(
    exe: pathlib.Path, identifier: str, unlike: int = 0
) -> tuple[subprocess.Popen[bytes], App]:
    app = subprocess.Popen([str(exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port, secret, listening = endpoint(identifier, 90, unlike)
    if listening and listening != app.pid:
        raise SystemExit(
            f"another nib is already listening (pid {listening}, not {app.pid}): close it first."
            " A second launch of a single instance app hands over and exits, and every number"
            " below would be about that window and its space rather than this one's."
        )

    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        found = windows_of(app.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    assert user32 is not None
    # A size that fits on one screen, so the pane the page is placed over has room in
    # it. SWP_NOZORDER: nothing about which window is in front changes.
    user32.SetWindowPos(hwnd, None, 0, 0, 1280, 860, 0x0004)
    time.sleep(1.5)
    return app, App(port, secret)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    made = space(port)

    said: dict[str, object] = {}
    running = None
    try:
        # One launch to write the endpoint file, so eval can be turned on in it.
        running, app = launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        allow_eval(args.identifier)
        time.sleep(1)

        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)

        # The first web tab of the run, which pays for starting the engine.
        said["cold ms"] = opened(app, made, 1, veiled=False)
        app.ask(CLOSE_ALL, seconds=30)
        time.sleep(1)

        # An ordinary one, on an engine that is already running.
        said["open ms"] = opened(app, made, 2, veiled=False)
        app.ask(CLOSE_ALL, seconds=30)
        time.sleep(1)

        # And one whose pane is covered at the moment it mounts, which is every way of
        # opening a website except clicking its row.
        covered = opened(app, made, 3, veiled=True)
        said["covered ms"] = covered
        said["opened under a layer"] = covered is not None
    finally:
        if running:
            running.terminate()

    for name, value in said.items():
        print(f"{name:24} {value}")

    wrong: list[str] = []
    if said["opened under a layer"] is not True:
        wrong.append(
            "a web tab whose pane was covered when it mounted never showed its page:"
            " see `look` in lib/web-tab/WebTab.svelte"
        )

    for name, budget in (("cold ms", COLD_MS), ("open ms", OPEN_MS), ("covered ms", COVERED_MS)):
        value = said.get(name)
        if value is None:
            wrong.append(f"{name}: the page never arrived")
        elif clocked() and isinstance(value, int) and value > budget:
            wrong.append(f"{name}: {value} over a budget of {budget}")

    if not clocked():
        print("\nthe clocks were read and not asserted on; set NIB_PERF=1 to hold them to a budget")

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
