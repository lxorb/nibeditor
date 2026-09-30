"""What each press on a link opens: inside a web tab's page, and on a website's row in
the file list. Windows only.

Emil, 2026-09-30: *"Ctrl + click to open a new web page doesn't work."* Chrome's rule is
the one held here, and every press of it is made and checked:

    press        a link         target=_blank   a script's own link
    plain        this tab       a tab in front  this tab
    Ctrl         a tab behind   a tab behind    this tab
    Ctrl+Shift   a tab in front a tab in front  this tab
    middle       a tab behind   a tab behind    nothing

A script's own link is a `span` whose click handler sets `location`: Chrome opens no tab
for one, whatever is held, because the page navigates itself and no link was followed.
A tab behind is beside the page and not in front; a tab in front is beside it and in
front. Anything else - no tab, a tab on the wrong side, the page leaving as well as a tab
arriving - fails the run.

**Pressed in the page, not on the screen.** Each press is the engine's own devtools
protocol (`Input.dispatchMouseEvent`, with its `modifiers`) on the probe's own page, which
is a trusted press in that page with the keys it names held - and no key held on the
machine and no pointer moved. So what is checked is what the page saw, which is what a
real hand gives it too: the press's own modifiers, not the keyboard's.

**The file list, too.** In case "a new web page" meant a website's row: Ctrl+click,
Ctrl+Shift+click and the middle button on a `.url` in the file list open it in a tab
behind, in front, and behind.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.<name>","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/web-click-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

`run_probe` in scripts/probe_app.py starts it off the screen and without the keyboard,
and ends the run if any of it is ever in view. No key is pressed in a page here: a key
nib answers from inside a page hands the keyboard back to the window, which is what
puts a probe in front of somebody; see the page-first step of web-page-probe.py.
"""

from __future__ import annotations

import argparse
import atexit
import base64
import http.server
import json
import os
import pathlib
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from probe_app import close_app, main_window, run_probe

PORT_FROM = 23920
PORT_TO = 23939

SPACE = "Click probe"
NOTE = "Idea"
SITE = "Site"

#: The devtools port for the probe's own process, which is how a press is made inside a
#: page without a mouse. Each engine process picks its own and writes it beside its data.
ENGINE_ARGS = "--remote-debugging-port=0"

#: The page every press is made on: one link of each kind, each a block big enough to
#: aim at the middle of.
LINKS = """<!doctype html>
<title>Links</title>
<body style="margin:0;font:16px system-ui">
<a id="link" href="/to-link" style="display:block;height:60px;margin:20px">A link</a>
<a id="blank" href="/to-blank" target="_blank" style="display:block;height:60px;margin:20px">A link to a new window</a>
<span id="script" onclick="location.href = '/to-script'" style="display:block;height:60px;margin:20px;cursor:pointer">A link a script follows</span>
</body>
"""

#: The DOM's buttons, and the protocol's modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8.
PRESSES: dict[str, tuple[str, int]] = {
    "plain": ("left", 0),
    "ctrl": ("left", 2),
    "ctrl+shift": ("left", 10),
    "middle": ("middle", 0),
}

#: Chrome's answer to each press on each link; see the top of this file.
EXPECTED: dict[tuple[str, str], str] = {
    ("link", "plain"): "this tab",
    ("link", "ctrl"): "behind",
    ("link", "ctrl+shift"): "front",
    ("link", "middle"): "behind",
    ("blank", "plain"): "front",
    ("blank", "ctrl"): "behind",
    ("blank", "ctrl+shift"): "front",
    ("blank", "middle"): "behind",
    ("script", "plain"): "this tab",
    ("script", "ctrl"): "this tab",
    ("script", "ctrl+shift"): "this tab",
    ("script", "middle"): "nothing",
}

#: How long a press has to show what it did. One that should do nothing is given all of
#: it, so a tab arriving late is still seen.
SETTLE = 4.0


def target(name: str) -> str:
    return f"<!doctype html><title>{name}</title><h1>{name}</h1>"


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> None:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = urllib.parse.urlparse(self.path).path
            body = (LINKS if path == "/links" else target(path.strip("/"))).encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def space(port: int) -> pathlib.Path:
    """A spaces root of this probe's own, never anybody's Documents/Nib: a note to open
    the space on, and a website for the file list's rows."""

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-click-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(root)
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    made = root / SPACE
    made.mkdir(parents=True)
    (made / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", "utf-8")
    shortcut = f"[InternetShortcut]\r\nURL=http://127.0.0.1:{port}/site\r\nTitle={SITE}\r\n"
    (made / f"{SITE}.url").write_text(shortcut, "utf-8")
    return made


def config_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for base in (os.environ["APPDATA"], os.environ["LOCALAPPDATA"]):
        shutil.rmtree(pathlib.Path(base) / identifier, ignore_errors=True)


def endpoint(identifier: str, unlike: int = 0) -> tuple[int, str, int]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + 90
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"]), int(said.get("pid") or 0)
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}; close any nib running under this identifier")


def allow_eval(identifier: str) -> None:
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def act(self, verb: str, args: dict[str, object], seconds: float = 60) -> object:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=seconds) as answer:
                return json.loads(answer.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as refused:
            return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
        except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
            return {"ok": False, "error": f"no answer: {error}"}

    def ask(self, code: str, seconds: float = 60) -> object:
        said = self.act("eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value


def debug_ports(identifier: str) -> list[int]:
    """The devtools port of every engine process the app started."""

    ports: list[int] = []
    for base in (os.environ["APPDATA"], os.environ["LOCALAPPDATA"]):
        for found in (pathlib.Path(base) / identifier).rglob("DevToolsActivePort"):
            try:
                ports.append(int(found.read_text(encoding="utf-8").split()[0]))
            except (OSError, ValueError, IndexError):
                continue
    return ports


def page_socket(identifier: str, ending: str) -> str | None:
    """The devtools socket of the page whose address ends in `ending`."""

    for port in debug_ports(identifier):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as said:
                targets = json.loads(said.read())
        except (OSError, ValueError):
            continue
        for one in targets:
            if one.get("type") == "page" and str(one.get("url", "")).endswith(ending):
                return str(one["webSocketDebuggerUrl"])
    return None


class Devtools:
    """The least of a WebSocket that speaks the devtools protocol to one page."""

    def __init__(self, url: str) -> None:
        rest = url.removeprefix("ws://")
        host, _, path = rest.partition("/")
        name, _, port = host.partition(":")
        self.sock = socket.create_connection((name, int(port)), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET /{path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
                f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        head = b""
        while b"\r\n\r\n" not in head:
            head += self.sock.recv(1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise OSError(f"devtools refused the socket: {head[:80]!r}")
        self.next = 0

    def _exactly(self, count: int) -> bytes:
        out = b""
        while len(out) < count:
            got = self.sock.recv(count - len(out))
            if not got:
                raise OSError("devtools closed the socket")
            out += got
        return out

    def call(self, method: str, params: dict[str, object]) -> dict[str, object]:
        self.next += 1
        body = json.dumps({"id": self.next, "method": method, "params": params}).encode()
        mask = os.urandom(4)
        if len(body) < 126:
            head = bytes([0x81, 0x80 | len(body)])
        else:
            head = bytes([0x81, 0x80 | 126]) + struct.pack(">H", len(body))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(body)))
        while True:
            first, second = self._exactly(2)
            size = second & 0x7F
            if size == 126:
                size = struct.unpack(">H", self._exactly(2))[0]
            elif size == 127:
                size = struct.unpack(">Q", self._exactly(8))[0]
            payload = self._exactly(size)
            if first & 0x0F != 1:
                continue
            said = json.loads(payload)
            if said.get("id") == self.next:
                return said

    def value(self, expression: str) -> object:
        said = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True})
        result = said.get("result", {})
        return result.get("result", {}).get("value") if isinstance(result, dict) else None

    def click(self, x: float, y: float, button: str, modifiers: int) -> None:
        """One press and its release at `x`, `y` in the page, with `modifiers` held."""

        held = {"left": 1, "middle": 4}[button]
        at = {"x": x, "y": y, "modifiers": modifiers}
        self.call("Input.dispatchMouseEvent", {"type": "mouseMoved", **at})
        pressing = {**at, "button": button, "clickCount": 1}
        self.call("Input.dispatchMouseEvent", {"type": "mousePressed", **pressing, "buttons": held})
        self.call("Input.dispatchMouseEvent", {"type": "mouseReleased", **pressing, "buttons": 0})

    def close(self) -> None:
        self.sock.close()


def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    env = {**os.environ, "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": ENGINE_ARGS}
    running = run_probe(exe, env=env, quiet=True)
    port, secret, pid = endpoint(identifier, unlike)
    if pid and pid != running.pid:
        raise SystemExit(f"another nib (pid {pid}) is listening under {identifier}: close it first")
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not main_window(running.pid):
        time.sleep(0.2)
    if not main_window(running.pid):
        raise SystemExit("the app never showed a window")
    time.sleep(1.5)
    return running, App(port, secret)


#: The strip: every tab's id and address or path, and which one is in front.
STRIP = r"""
(() => {
  const ws = nib.workspace
  return JSON.stringify({
    tabs: ws.tabs.map((one) => ({ id: one.id, at: one.address || one.path || '' })),
    front: ws.activeTabId,
  })
})()
"""

#: Every web tab closed, and the page of links opened as a tab of its own, in front.
FRESH = r"""
(() => {
  const ws = nib.workspace
  for (const one of [...ws.tabs]) { if (one.kind === 'web') ws.close(one.id) }
  return ws.openPage(__URL__, 'front')
})()
"""


def strip(app: App) -> dict[str, object]:
    said = app.ask(STRIP)
    return said if isinstance(said, dict) else {"tabs": [], "front": None}


def reached(identifier: str, ending: str, seconds: float = 30) -> Devtools | None:
    """The page at `ending`, loaded, as a socket to press in."""

    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        url = page_socket(identifier, ending)
        if url is not None:
            tools = Devtools(url)
            if tools.value("document.readyState") == "complete":
                return tools
            tools.close()
        time.sleep(0.3)
    return None


def outcome(before: dict[str, object], after: dict[str, object], opener: str, left: bool, to: str) -> str:
    """What a press did, in the table's words: where a tab for `to` went, and whether the
    page itself left for it."""

    had = {str(one["id"]) for one in before["tabs"]}  # type: ignore[index, union-attr]
    tabs = after["tabs"]  # type: ignore[index]
    ids = [str(one["id"]) for one in tabs]  # type: ignore[union-attr]
    said: list[str] = []
    for one in tabs:  # type: ignore[union-attr]
        if str(one["id"]) in had or to not in str(one["at"]):
            continue
        at = ids.index(str(one["id"]))
        beside = at > 0 and ids[at - 1] == opener
        said.append(("front" if after["front"] == one["id"] else "behind") + ("" if beside else " (not beside)"))
    if left:
        said.append("this tab")
    return " + ".join(said) or "nothing"


def press_in_page(app: App, identifier: str, base: str, link: str, press: str) -> str:
    """One press on one link in a fresh page, and what it did."""

    mark = f"{link}-{press}".replace("+", "-")
    ending = f"/links?{mark}"
    opener = app.ask(FRESH.replace("__URL__", json.dumps(f"{base}{ending}")))
    tools = reached(identifier, ending)
    if tools is None or not isinstance(opener, str):
        return "no page to press in"
    try:
        # The page is found as soon as its address is, which can be before its body has
        # the link: asked again until it does.
        rect = None
        until = time.perf_counter() + 10
        while rect is None and time.perf_counter() < until:
            box = tools.value(
                f"JSON.stringify(document.getElementById('{link}')?.getBoundingClientRect() ?? null)"
            )
            rect = json.loads(box) if isinstance(box, str) and box.startswith("{") else None
            if rect is None:
                time.sleep(0.2)
        if rect is None:
            return "no link to press"
        before = strip(app)
        button, modifiers = PRESSES[press]
        tools.click(rect["x"] + 30, rect["y"] + rect["height"] / 2, button, modifiers)

        to = f"/to-{link}"
        expected = EXPECTED[(link, press)]
        until = time.perf_counter() + SETTLE
        said = "nothing"
        while time.perf_counter() < until:
            time.sleep(0.4)
            try:
                left = tools.value("location.pathname") == to
            except OSError:
                left = False
            said = outcome(before, strip(app), opener, left, to)
            # A press that did what it should has nothing more to show; one that did
            # nothing, or should do nothing, is watched to the end.
            if said != "nothing" and said == expected:
                time.sleep(0.8)
                left = tools.value("location.pathname") == to
                said = outcome(before, strip(app), opener, left, to)
                break
        return said
    finally:
        tools.close()


#: A press on the file list's row for the website, made as a click on it with the
#: modifiers held, and where the website's tab then is.
ROW = r"""
(async () => {
  const ws = nib.workspace
  for (const one of [...ws.tabs]) { if (one.kind === 'web') ws.close(one.id) }
  const note = ws.tabs.find((one) => (one.path || '').endsWith('__NOTE__'))
  if (note) ws.activate(note.id)
  ws.showPanel('tree')
  const pause = (ms) => new Promise((go) => setTimeout(go, ms))
  let row = null
  for (let tries = 0; tries < 30 && !row; tries++) {
    row = document.querySelector('.row[data-path$="__SITE__"]')
    if (!row) await pause(100)
  }
  if (!row) return JSON.stringify({ row: false })
  const init = { bubbles: true, cancelable: true, view: window, ...__INIT__ }
  row.dispatchEvent(new MouseEvent('mousedown', init))
  row.dispatchEvent(new MouseEvent('mouseup', init))
  row.dispatchEvent(new MouseEvent(init.button === 1 ? 'auxclick' : 'click', init))
  const until = performance.now() + 4000
  while (performance.now() < until) {
    const site = ws.tabs.find((one) => (one.path || '').endsWith('__SITE__'))
    if (site) {
      await pause(300)
      return JSON.stringify({ row: true, tab: true, front: ws.activeTabId === site.id })
    }
    await pause(100)
  }
  return JSON.stringify({ row: true, tab: false })
})()
"""

ROW_PRESSES: dict[str, tuple[dict[str, object], str]] = {
    "ctrl": ({"button": 0, "ctrlKey": True}, "behind"),
    "ctrl+shift": ({"button": 0, "ctrlKey": True, "shiftKey": True}, "front"),
    "middle": ({"button": 1}, "behind"),
}


def press_on_row(app: App, press: str) -> str:
    init, _ = ROW_PRESSES[press]
    code = (
        ROW.replace("__INIT__", json.dumps(init))
        .replace("__SITE__", f"{SITE}.url")
        .replace("__NOTE__", f"{NOTE}.md")
    )
    said = app.ask(code)
    if not isinstance(said, dict) or not said.get("row"):
        return "no row"
    if not said.get("tab"):
        return "nothing"
    return "front" if said.get("front") else "behind"


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    space(port)
    base = f"http://127.0.0.1:{port}"

    wrong: list[str] = []
    running = None
    try:
        running, app = launch(args.exe, args.identifier)
        close_app(running) or running.kill()
        allow_eval(args.identifier)
        time.sleep(1)
        running, app = launch(args.exe, args.identifier, unlike=app.port)

        app.act("open", {"path": f"{NOTE}.md", "space": SPACE})
        until = time.perf_counter() + 60
        while time.perf_counter() < until and not strip(app).get("tabs"):
            time.sleep(0.3)

        for link in ("link", "blank", "script"):
            for press in PRESSES:
                said = press_in_page(app, args.identifier, base, link, press)
                expected = EXPECTED[(link, press)]
                verdict = "ok" if said == expected else "WRONG"
                print(f"page  {link:7} {press:11} {said:24} want {expected:10} {verdict}")
                if said != expected:
                    wrong.append(f"{press} on {link}: {said}, not {expected}")

        for press, (_, expected) in ROW_PRESSES.items():
            said = press_on_row(app, press)
            verdict = "ok" if said == expected else "WRONG"
            print(f"row   {SITE + '.url':7} {press:11} {said:24} want {expected:10} {verdict}")
            if said != expected:
                wrong.append(f"{press} on the file list's website: {said}, not {expected}")
    finally:
        if running and running.poll() is None and not close_app(running):
            running.kill()

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
