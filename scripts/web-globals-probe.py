"""What a web tab gives a page that a browser would not. Windows only.

Emil, 2026-09-18: Google Sheets in a web tab renders for a moment and is then replaced
by Google's own *"Loading issue - Troubleshoot this issue by clearing application
resources"* page. That is Google's message for "my storage is not usable", and the
storage is fine: `navigator.storage.estimate()`, cookies, `localStorage`, IndexedDB,
the Cache API, Web Locks, workers and the service worker registry all answer in a web
tab exactly as they answer in Edge on the same machine, and the profile on disk has a
`https_docs.google.com_0.indexeddb.leveldb` in it. What the page's own console said is
the whole of it:

    Uncaught SyntaxError: Identifier 'ipc' has already been declared
      at .../spreadsheets/_/js/k=spreadsheets.waffle_js_prod...O/m=core:1
    Uncaught ReferenceError: RITZ_initializeModules is not defined
    Uncaught ReferenceError: waffle_api is not defined
    Error: DOCS_initialLoadTiming is not defined.

**A web tab is a Tauri webview, and a Tauri webview carries the app's own globals into
whatever page it shows.** wry defines one for its message channel, before any script this
crate supplies:

    Object.defineProperty(window, 'ipc', { value: Object.freeze({ postMessage: ... }) })

`Object.defineProperty` leaves out `configurable`, so the property is non-configurable -
and a classic script may not declare `let ipc`, `const ipc` or `class ipc` at the top
level while the global object carries a non-configurable `ipc`. The *whole script* is a
SyntaxError before its first line runs. Google's editors bundle declares one, so the
sheet never starts and Google shows the page it shows when its own code did not load.

It cannot be undone from inside the page: `delete window.ipc` answers false and
`Object.defineProperty` throws `Cannot redefine property: ipc`. Nor can `GUARD` in
web_tabs.rs undo the rest - it is one of the injected scripts and it runs in the middle
of them, so it deletes globals Tauri has not written yet and they are all still there
when the site's first script runs. Measured, and this is what measures it.

So the two questions this drive asks of a real page in a real web tab:

* **a page may declare `ipc`** - a classic script with `let ipc` at the top level runs.
  `False` is the bug, and it is the bug that breaks Google Docs, Sheets and Slides.
* **nothing of the app is in the page** - no `ipc`, no `isTauri`, no `__TAURI_*`.

The page asks itself and puts the answer in its own title, which is the one thing a web
tab reports out of a page without anything being granted to it.

    npx vite build --mode drive                     # in apps/desktop
    pnpm --dir apps/desktop tauri build --no-bundle \
      --config '{"identifier":"ch.emilvinu.nib.probe.globals","build":{"beforeBuildCommand":""}}'
    python scripts/web-globals-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe

`--mode drive` is not optional and is not what the other probes here say: `tauri build`
runs `pnpm build`, which is a production build, and `__DRIVEABLE__` is false in one - so
the plain command in the older docstrings makes an exe with no `window.nib` in it for a
drive to steer. The identifier keeps the run off anybody's settings and browsing profile,
and `NIB_SPACES_DIR` keeps it off their notes.
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
PORT_FROM = 23860
PORT_TO = 23879

SPACES_DIR = "NIB_SPACES_DIR"
SPACE = "Web globals probe"
NOTE = "Idea"

# What the page puts in front of its answer, so a title that is still the file's name or
# the site's own is not read as one.
MARK = "NIBGLOBALS "

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None

# The page asks itself, in the two shapes that matter.
#
# The first script is the one Google's bundle is: a classic script whose first statement
# is a top level lexical declaration of `ipc`. If the global object already carries a
# non-configurable `ipc`, the script is a SyntaxError as a whole and never runs a line of
# itself - which is exactly what happens to `m=core` on docs.google.com. The second
# script reports whether the first one ran, and what else of the app's is in here.
PAGE = f"""<!doctype html>
<title>waiting</title>
<body style="margin:0;font:16px system-ui;padding:2rem">a page asking what it was given
<script>
  let ipc = 1
  window.__nibLetIpc = 'ok' + String(ipc).slice(1)
</script>
<script>
  var said = Object.getOwnPropertyDescriptor(window, 'ipc')
  document.title = {MARK!r} + JSON.stringify({{
    letIpc: window.__nibLetIpc || 'SyntaxError',
    ipc: typeof window.ipc,
    configurable: said ? said.configurable : null,
    globals: Object.getOwnPropertyNames(window).filter(function (one) {{
      return /^__TAURI|^isTauri$|^ipc$/.test(one)
    }}),
  }})
</script>
"""


def windows_of(pid: int) -> list[int]:
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


def serve(port: int) -> None:
    body = PAGE.encode()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    made.daemon_threads = True
    threading.Thread(target=made.serve_forever, daemon=True).start()


def spaces_root() -> pathlib.Path:
    """A spaces root of this probe's own, in the temp area, taken away when it exits.

    **Never `Documents/Nib`.** A probe identifier moves the settings folder and the
    browsing profile and says nothing about where the spaces are; see `spaces_dir` and
    docs/automation.md."""

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-globals-probe-"))
    os.environ[SPACES_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
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
    raise SystemExit(
        f"the app never wrote {path} - if a nib is already running, close it first:"
        " this is a single instance app and a second launch hands over and exits"
    )


def allow_eval(identifier: str) -> None:
    """Turns on the one verb that can ask the window a question of its own. Between two
    launches, because the crate reads the flag when it opens the socket."""

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


# Opens the site and waits for the page to say what it found. The page's own title is the
# answer, and the address bar wears it: nothing at all is granted to the site, and what a
# page calls itself is the one thing a web tab reports out of one without anything being.
# The tab's own name is the file's - a web note is a `.url` on disk - so the bar is where
# to read it; see WebBar.svelte and scripts/web-open-probe.py, which waits on the same
# field for the same reason.
ASK = r"""
(async () => {
  const ws = nib.workspace
  const path = __PATH__
  ws.openWeb(path)

  const until = Date.now() + 20000
  while (Date.now() < until) {
    const bar = document.querySelector('.webbar input')
    const said = (bar && bar.value) || ''
    const at = said.indexOf(__MARK__)
    if (at >= 0) return said.slice(at + __MARK__.length)
    await new Promise((go) => setTimeout(go, 100))
  }
  return ''
})()
"""


def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    running = subprocess.Popen([str(exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port, secret, listening = endpoint(identifier, 90, unlike)
    if listening and listening != running.pid:
        raise SystemExit(
            f"another nib is already listening (pid {listening}, not {running.pid}): close it"
            " first. A second launch of a single instance app hands over and exits."
        )

    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        found = windows_of(running.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    assert user32 is not None
    # SWP_NOZORDER: nothing about which window is in front changes.
    user32.SetWindowPos(hwnd, None, 0, 0, 1280, 860, 0x0004)

    app = App(port, secret)
    # The endpoint is listening before there is a window to ask, and a request sent in
    # between is refused. Wait for the window rather than for the file.
    until = time.perf_counter() + 60
    while time.perf_counter() < until:
        said = act(port, secret, "eval", {"code": "1", "yes": True}, 20)
        if isinstance(said, dict) and (said.get("ok") or "eval is off" in str(said.get("error"))):
            break
        time.sleep(0.5)
    return running, app


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.globals")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)

    made = spaces_root() / SPACE
    made.mkdir(parents=True, exist_ok=True)
    (made / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", encoding="utf-8")
    (made / "Site.url").write_text(
        "[InternetShortcut]\r\n"
        f"URL=http://127.0.0.1:{port}/asked\r\n"
        "Title=Site\r\n"
        "Nib-Added=2026-09-18T01:00:00.000Z\r\n",
        encoding="utf-8",
    )

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

        code = ASK.replace("__PATH__", json.dumps(str(made / "Site.url"))).replace(
            "__MARK__", json.dumps(MARK)
        )
        # Asked more than once: the window answers a request on its own turn, and the
        # first turn after a launch is also the one reading the space.
        said: object = ""
        for _ in range(3):
            said = app.ask(code, seconds=60)
            if isinstance(said, dict) and "error" not in said:
                break
            if isinstance(said, str) and said:
                break
            time.sleep(2)
    finally:
        if running:
            running.terminate()

    # The page's answer is itself JSON, so `ask` has already read it; a string here is an
    # answer it could not, and an empty one is a page that never said anything at all.
    found = json.loads(said) if isinstance(said, str) and said else said
    if not isinstance(found, dict) or "letIpc" not in found:
        print(f"the page never said what it found: {said!r}")
        return 1

    for name, value in found.items():
        print(f"{name:16} {value}")

    wrong: list[str] = []
    if found.get("letIpc") != "ok":
        wrong.append(
            "a page may not declare `ipc`: wry defines window.ipc non-configurable in every"
            " webview, so a classic script whose top level declares one is a SyntaxError as a"
            " whole. That is Google Sheets, Docs and Slides. See this file's comment and"
            " docs/web-tabs.md"
        )
    if found.get("globals"):
        wrong.append(
            f"the app's own globals are in the site's page: {found['globals']}."
            " GUARD in web_tabs.rs is meant to take them away and cannot: it is one of the"
            " injected scripts and runs before the ones it deletes"
        )

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
