"""Where a tab a page asks for lands, and whether a popup can still reach its opener.
Windows only.

Emil, 2026-09-28: *"I want Ctrl + Click to work for opening new tabs."* Inside a page
every window the page asks for becomes a tab, and it always came forward - a Ctrl+click
or a middle click took the reader off the page they meant to stay on. The crate now
works out how the window was asked for (see src-tauri/src/web_opens.rs) and the window
puts the tab beside the page that asked, behind it or in front. A window asked for at a
size of its own - a sign-in - is a window, so the page that opened it keeps hold of it.

A page served from here asks for each kind of window as it loads, so nothing on the
machine is pointed at or pressed and the probe runs beside somebody working:

    plain    `window.open(url)`: a tab beside the page, in front
    behind   `window.open(url, 'nib-behind')`: what the middle button's script opens,
             a tab beside the page, behind it
    popup    `window.open(url, name, 'width=..,height=..')`: a window of its own, whose
             page posts to `window.opener` and closes itself

Ctrl and Shift are read off the keyboard at the moment the engine asks, and a real key
is not something this probe presses; the rule those feed is `placed` in web_opens.rs,
which has tests of its own.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.new-tab","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/web-new-tab-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.new-tab

The window opens off the screen and without the keyboard, which `run_probe` in
scripts/probe_app.py sees to, and this probe never moves it. The popup is asked for off
the screen too, which is where a page's own `left` and `top` put it.
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
import urllib.parse
import urllib.request
from ctypes import wintypes

from probe_app import close_app, run_probe, main_window

PORT_FROM = 23900
PORT_TO = 23919

SPACES_DIR = "NIB_SPACES_DIR"
SPACE = "New tab probe"
NOTE = "Idea"

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None

# The page that asks. It asks as it loads, for the kind of window its address names, and
# says in its own title what it heard back from a popup - which only a popup that still
# has its opener can tell it.
ASKING = """<!doctype html>
<title>Opener</title>
<body style="font:16px system-ui;padding:2rem">
<h1>Opener</h1>
<script>
  addEventListener('message', (event) => {
    if (event.data === 'opener-ok') document.title = 'Opener heard the popup'
  })
  const how = new URLSearchParams(location.search).get('how')
  const to = location.origin + '/target-' + how
  if (how === 'plain') window.open(to)
  if (how === 'behind') window.open(to, 'nib-behind')
  if (how === 'popup') window.open(location.origin + '/popup', 'signin', 'width=480,height=520,left=-32000,top=-32000')
</script>
"""

# The popup: it tells its opener it is there, and closes, the way a sign-in does.
POPUP = """<!doctype html>
<title>Popup</title>
<body style="font:16px system-ui;padding:2rem">
<h1>Popup</h1>
<script>
  if (window.opener) window.opener.postMessage('opener-ok', '*')
  setTimeout(() => window.close(), 1500)
</script>
"""


def target(name: str) -> str:
    return f"<!doctype html><title>{name}</title><h1>{name}</h1>"


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = urllib.parse.urlparse(self.path).path
            if path == "/asking":
                body = ASKING
            elif path == "/popup":
                body = POPUP
            else:
                body = target(path.strip("/"))
            data = body.encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def space() -> pathlib.Path:
    """A spaces root of this probe's own, never `Documents/Nib`; see web-open-probe.py."""

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-new-tab-probe-"))
    os.environ[SPACES_DIR] = str(root)
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    made = root / SPACE
    made.mkdir(parents=True)
    (made / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", "utf-8")
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
    raise SystemExit(f"the app never wrote {path}")


def allow_eval(identifier: str) -> None:
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))


def act(port: int, secret: str, verb: str, args: dict[str, object], seconds: float = 60) -> object:
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
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def open(self, path: str, space: str) -> object:
        return act(self.port, self.secret, "open", {"path": path, "space": space})

    def ask(self, code: str) -> object:
        said = act(self.port, self.secret, "eval", {"code": code, "yes": True})
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value


# The strip and which tab is in front, as addresses; and every page's own title.
STRIP = r"""
(() => {
  const ws = nib.workspace
  return JSON.stringify({
    strip: ws.tabs.map((one) => one.address || one.path),
    front: (ws.active && (ws.active.address || ws.active.path)) || null,
  })
})()
"""

OPEN = r"""
(() => {
  const ws = nib.workspace
  for (const one of [...ws.tabs]) { if (one.kind === 'web') ws.close(one.id) }
  ws.openPage(__URL__)
  return 'ok'
})()
"""

# What the opener page calls itself, which is where the popup's message shows.
TITLED = r"""
(() => {
  const ws = nib.workspace
  const tab = ws.tabs.find((one) => (one.address || '').includes('/asking'))
  const bar = document.querySelector('.webbar input')
  return JSON.stringify({ bar: bar ? bar.value : null, tab: tab ? tab.name : null })
})()
"""


def windows_of(pid: int) -> list[str]:
    """The titles of the visible top level windows the process owns."""

    assert user32 is not None
    found: list[str] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            name = ctypes.create_unicode_buffer(256)
            user32.GetWindowTextW(hwnd, name, 256)
            found.append(name.value)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return found


def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    app = run_probe(exe, quiet=True)
    port, secret, listening = endpoint(identifier, 90, unlike)
    if listening and listening != app.pid:
        raise SystemExit(f"another nib is already listening (pid {listening}): close it first")

    until = time.perf_counter() + 90
    while time.perf_counter() < until and not main_window(app.pid):
        time.sleep(0.2)
    hwnd = main_window(app.pid)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    time.sleep(1.5)
    return app, App(port, secret)


def settled(app: App, want: int, seconds: float = 20) -> dict[str, object]:
    """The strip once it holds `want` tabs, or as it is when the wait runs out."""

    until = time.perf_counter() + seconds
    said: object = {}
    while time.perf_counter() < until:
        said = app.ask(STRIP)
        if isinstance(said, dict) and len(said.get("strip") or []) >= want:
            time.sleep(0.5)
            said = app.ask(STRIP)
            break
        time.sleep(0.3)
    return said if isinstance(said, dict) else {"error": said}


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.new-tab")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    space()
    base = f"http://127.0.0.1:{port}"
    note = f"{NOTE}.md"

    wrong: list[str] = []
    running = None
    try:
        running, app = launch(args.exe, args.identifier)
        close_app(running) or running.kill()
        allow_eval(args.identifier)
        time.sleep(1)

        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(note, SPACE)
        # The note on screen is the window ready to be asked things.
        if not settled(app, 1, seconds=60).get("strip"):
            raise SystemExit("the window never answered with its note open")

        for how, front in (("plain", "target-plain"), ("behind", "asking")):
            asking = f"{base}/asking?how={how}"
            app.ask(OPEN.replace("__URL__", json.dumps(asking)))
            said = settled(app, 3)
            strip = [str(one) for one in said.get("strip") or []]
            print(f"{how:8} strip  {strip}")
            print(f"{how:8} front  {said.get('front')}")
            at = next((i for i, one in enumerate(strip) if "/asking" in one), -1)
            beside = at >= 0 and at + 1 < len(strip) and f"target-{how}" in strip[at + 1]
            if not beside:
                wrong.append(f"{how}: the tab did not land beside the page that asked")
            if front is None or front not in str(said.get("front")):
                wrong.append(f"{how}: {said.get('front')} is in front, not {front}")

        # The popup: a window of its own, no tab, and a message back to the opener.
        app.ask(OPEN.replace("__URL__", json.dumps(f"{base}/asking?how=popup")))
        seen_popup = False
        heard = False
        until = time.perf_counter() + 20
        while time.perf_counter() < until and not heard:
            titles = windows_of(running.pid)
            seen_popup = seen_popup or any("Popup" in one or "127.0.0.1" in one for one in titles)
            titled = app.ask(TITLED)
            heard = isinstance(titled, dict) and "heard the popup" in str(titled)
            time.sleep(0.3)
        time.sleep(2.5)
        left = windows_of(running.pid)
        said = app.ask(STRIP)
        strip = said.get("strip") if isinstance(said, dict) else said
        print(f"popup    window seen {seen_popup}, opener heard it {heard}")
        print(f"popup    windows after it closed {left}")
        print(f"popup    strip  {strip}")
        if not seen_popup:
            wrong.append("popup: no window of its own appeared")
        if not heard:
            wrong.append("popup: the opener never heard from it - window.opener is lost")
        if any("Popup" in one for one in left):
            wrong.append("popup: it did not close itself")
        if isinstance(strip, list) and any("/popup" in str(one) for one in strip):
            wrong.append("popup: it opened as a tab too")
    finally:
        if running and running.poll() is None and not close_app(running):
            running.kill()

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
