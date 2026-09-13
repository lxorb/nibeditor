"""Does a web note keep you logged in when you close it and open it again?

Emil, 2026-09-13: *"When I close and then reopen a web note, all state is lost. For
example, when I log in, then I would be logged out. That should not be the case."*

A web note is a browser tab, and a browser tab keeps you logged in across being closed
and reopened because the browser process - and the session in it - outlives the tab.
This drive proves that nib's does now. It signs in to a page served on the loopback
(a session cookie, a persistent cookie, and a localStorage token - the three shapes a
login takes), closes the note so the webview is torn down, opens it again, and asks the
page what it still has. Then it starts the app over and asks once more.

    session cookie   - kept in the browser session; survives close + reopen while the
                       app runs, because the one shared WebView2 environment does; gone
                       after a relaunch, which is a fresh session, the way a browser is
    persistent cookie- written to the `web` folder on disk; survives everything
    localStorage     - written to disk; survives everything

The decisive line is the session cookie after a close and reopen: before the fix each
tab carried a WebView2 environment of its own, so closing the only web tab dropped the
session and the reopened note was signed out. See `session` in
apps/desktop/src-tauri/src/web_tabs.rs and docs/web-tabs.md.

    pnpm --dir apps/desktop tauri build --no-bundle \
      --config '{"identifier":"ch.emilvinu.nib.probe"}'
    python scripts/web-session-probe.py --exe path/to/nib.exe

The exe is a release build under an identifier of its own, so a run never touches your
real notes or your real browsing session. `eval` is turned on in that identifier's own
endpoint file by the probe, between two launches; nothing else can turn it on. See
src-tauri/src/endpoint.rs.
"""

from __future__ import annotations

import argparse
import ctypes
import http.server
import json
import os
import pathlib
import re
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

# Where this drive may listen; see docs/conventions.md.
PORT_FROM = 22300
PORT_TO = 22399

# What says where the notes go. The identifier a probe build runs under does not keep
# anybody's notes apart - it moves the settings and the browsing profile and leaves the
# spaces in `Documents/Nib` - so this is the one thing that does. See `SPACES_DIR` in
# src-tauri/src/paths.rs and docs/automation.md.
SPACES_DIR = "NIB_SPACES_DIR"

SPACE = "Web session probe"
NOTE = "Idea"
SITE = "A site I log in to"
BESIDE = "The same site in another tab"

# What a login leaves behind, in the three shapes it takes. The values are markers the
# probe reads straight back out of the page.
SID = "NIBSESSION"
PID = "NIBPERSIST"
TOKEN = "NIBTOKEN"

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


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


# The page a login lands on. It writes nothing; it reads what it was given and shows it
# in an <article>, which is what the clipper's reader hands back. So the probe learns
# what the page still has by reading the page, the way a person would.
APP = """<!doctype html>
<title>App</title>
<body style="margin:0;font:16px system-ui">
<article style="padding:2rem">
RESULT|sid:|pid:|token:|END
<p>This paragraph is here only so the reader keeps the article rather than the body,
which needs a couple of hundred characters of it before it will. It says nothing that
the line above did not, and the probe reads the markers on that line regardless.</p>
</article>
</body>
<script>
  function value(name) {
    var found = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return found ? found[1] : ''
  }
  var sid = value('sid')
  var pid = value('pid')
  var token = ''
  try { token = localStorage.getItem('token') || '' } catch (error) { token = '' }
  document.querySelector('article').firstChild.textContent =
    '\\nRESULT|sid:' + sid + '|pid:' + pid + '|token:' + token + '|END\\n'
</script>
"""

# The sign-in. It sets the three, then leaves for the app page without adding a step to
# history, so the note settles on the app page and reopening it reads rather than signs
# in again.
LOGIN = """<!doctype html>
<title>Signing in</title>
<body style="margin:0;font:16px system-ui"><p>Signing in...</p></body>
<script>
  document.cookie = 'sid=__SID__; path=/'
  document.cookie = 'pid=__PID__; path=/; max-age=99999'
  try { localStorage.setItem('token', '__TOKEN__') } catch (error) {}
  location.replace('/app')
</script>
"""


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> Server:
    # Replaced rather than formatted: both pages are JavaScript, and every brace in it
    # would be a field name to `str.format`.
    login = (
        LOGIN.replace("__SID__", SID).replace("__PID__", PID).replace("__TOKEN__", TOKEN).encode()
    )
    app = APP.encode()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = {"/login": login, "/app": app}.get(self.path.split("?")[0])
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            # No store, so the page is read afresh each time and never a cache of when
            # it was signed in.
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def spaces_root() -> pathlib.Path:
    """A folder of this drive's own, in the system's temp area, said to the app in
    `NIB_SPACES_DIR`.

    **Never `Documents/Nib`.** The identifier this build runs under moves the settings
    folder and the browsing profile and says nothing about where the spaces are, so a
    drive that wrote its space the obvious way wrote it beside somebody's real notes -
    which is exactly what happened once. The variable is read by `spaces_dir` at call
    time and wins over the documents folder; see docs/automation.md.

    Set in this process's environment, so the app inherits it when it is launched.
    """

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-session-probe-"))
    os.environ[SPACES_DIR] = str(made)
    return made


def shortcut(url: str, title: str) -> str:
    return (
        "[InternetShortcut]\r\n"
        f"URL={url}\r\n"
        f"Title={title}\r\n"
        "Nib-Added=2026-09-13T08:00:00.000Z\r\n"
    )


def space(port: int) -> pathlib.Path:
    """The space this drive opens, inside a spaces root of its own. Its parent is the
    temp folder `spaces_root` made and named in `NIB_SPACES_DIR`, which is what `main`
    takes away at the end."""

    made = spaces_root() / SPACE
    made.mkdir(parents=True, exist_ok=True)
    (made / f"{NOTE}.md").write_text(
        f"# {NOTE}\n\nAn ordinary note, to switch away to.\n", encoding="utf-8"
    )
    (made / f"{SITE}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/app", SITE), encoding="utf-8"
    )
    # A second note on the same site, to ask whether two tabs open at once share one
    # session - which is what says whether the environment is shared at all.
    (made / f"{BESIDE}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/app", BESIDE), encoding="utf-8"
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


def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")


def allow_eval(identifier: str) -> None:
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")


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


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def open(self, path: str, space_name: str | None = None) -> object:
        args: dict[str, object] = {"path": path}
        if space_name:
            args["space"] = space_name
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


TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({
  id: one.id, kind: one.kind, name: one.name, path: one.path,
})))"""


def tab_of(app: App, name: str) -> str | None:
    said = app.ask(TABS)
    if not isinstance(said, list):
        return None
    for one in said:
        if isinstance(one, dict) and str(one.get("name", "")).startswith(name):
            return str(one.get("id"))
    return None


def wait_for_tab(app: App, name: str, seconds: float = 25) -> str:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        found = tab_of(app, name)
        if found:
            return found
        time.sleep(0.3)
    raise SystemExit(f"the app never opened {name}")


# What the page still has, read back out of it through the clipper's own reader - the
# one way in that does not hand the site anything to call. The markers are on one line
# of the article, whichever part the reader chose.
def seen(app: App, tab: str, seconds: float = 20) -> dict[str, str]:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        said = app.ask(
            "window.__TAURI_INTERNALS__.invoke('web_clip', { tab: '"
            + tab
            + "', selection: false })"
        )
        html = said.get("html") if isinstance(said, dict) else None
        if isinstance(html, str):
            found = re.search(r"sid:([^|]*)\|pid:([^|]*)\|token:([^|]*)\|END", html)
            if found:
                return {"sid": found[1], "pid": found[2], "token": found[3]}
        time.sleep(0.4)
    return {"sid": "?", "pid": "?", "token": "?"}


def launch(
    exe: pathlib.Path, identifier: str, unlike: int = 0
) -> tuple[subprocess.Popen[bytes], App]:
    app = subprocess.Popen([str(exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port, secret = endpoint(identifier, 90, unlike)

    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        found = windows_of(app.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    assert user32 is not None
    user32.SetWindowPos(hwnd, None, 0, 0, 1280, 860, 0x0004)
    time.sleep(1.5)
    return app, App(port, secret)


def logged_in(state: dict[str, str]) -> bool:
    return state["sid"] == SID and state["pid"] == PID and state["token"] == TOKEN


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
    url_file = made / f"{SITE}.url"

    said: dict[str, object] = {}
    running = None
    ok = True
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

        # Open the site, then sign in: the login page sets the three and leaves for the
        # app page. Then send the tab to the app page for good, so the note settles
        # there - reopening it reads what it has rather than signing in a second time.
        def navigate(where: str) -> object:
            return app.ask(
                "window.__TAURI_INTERNALS__.invoke('web_navigate', { tab: '"
                + tab
                + f"', url: 'http://127.0.0.1:{port}{where}' }})"
            )

        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        said["signed out to begin with"] = seen(app, tab)

        navigate("/login")
        time.sleep(4)

        # Only the app page draws the markers, so reading them back is also what says
        # the login page has handed over to it.
        said["signed in"] = seen(app, tab)
        ok = ok and logged_in(said["signed in"])

        # The note is pinned to the app page, which only ever reads. What the keeper
        # writes into the file is the address feature and is proved elsewhere
        # (web-switch-probe.py); pinning it here is what keeps this drive about the
        # session alone - a note that reopened on the login page would sign itself in
        # again and prove nothing.
        said["the file the keeper wrote"] = (
            url_file.read_text(encoding="utf-8").replace("\r\n", " | ").strip()
        )
        url_file.write_text(shortcut(f"http://127.0.0.1:{port}/app", SITE), encoding="utf-8")

        # A second tab on the same site, open at the same time as the first. Whether it
        # sees the session says whether the two tabs share one browser session at all -
        # which is the difference between "the environment is not shared" and "a shared
        # environment does not keep a session across the last webview closing".
        app.open(f"{BESIDE}.url")
        beside = wait_for_tab(app, BESIDE)
        time.sleep(3)
        alongside = seen(app, beside)
        said["a second tab open at once"] = alongside
        said["two tabs share one session"] = alongside["sid"] == SID
        app.ask(f"nib.workspace.close('{beside}')")
        time.sleep(1)

        # Close the note. The webview is torn down; the tab is gone from the window.
        app.ask(f"nib.workspace.close('{tab}')")
        time.sleep(2)
        said["closed"] = tab_of(app, SITE) is None

        # Open it again. A new tab, a new webview - on the one session the run shares.
        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        after = seen(app, tab)
        said["after close and reopen"] = after
        # The decisive line: the session cookie is still there, so the login is.
        said["session kept on reopen"] = after["sid"] == SID
        said["still logged in on reopen"] = logged_in(after)
        ok = ok and logged_in(after)

        # And the app started over: a fresh session, so the session cookie is gone the
        # way a browser's is - but the login on disk is not.
        running.terminate()
        running.wait(timeout=30)
        time.sleep(2)
        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)
        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        relaunched = seen(app, tab)
        said["after relaunch"] = relaunched
        said["disk login kept on relaunch"] = (
            relaunched["pid"] == PID and relaunched["token"] == TOKEN
        )
        ok = ok and relaunched["pid"] == PID and relaunched["token"] == TOKEN
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=30)
            except subprocess.TimeoutExpired:
                running.kill()
        # The spaces root this drive made, taken away with the space in it: it is in the
        # temp area and nobody's notes, so there is nothing here worth keeping.
        shutil.rmtree(made.parent, ignore_errors=True)

    print(json.dumps(said, indent=2))
    print("\nPASS" if ok else "\nFAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
