"""Does a web note keep you logged in when you close it and open it again - and when
you quit nib and start it again?

Emil, 2026-09-13: *"When I close and then reopen a web note, all state is lost. For
example, when I log in, then I would be logged out. That should not be the case."*
And 2026-09-27: *"on moodle-app2.let.ethz.ch every time i reopen nib I have to
reloggin."*

A web note is a browser tab, and a browser that continues where it left off keeps you
logged in across both. This drive proves that nib does. It signs in to a page served
on the loopback (a session cookie, a persistent cookie, a localStorage token, and a
widget framed from another site that signs in with a partitioned cookie - the shapes a
login takes), closes the note so the webview is torn down, opens it again, and asks the
page what it still has. Then it quits the app the way a person does - the window
closed - starts it over and asks once more.

    session cookie   - no expiry of its own. Survives close + reopen because the one
                       shared WebView2 environment is held open; survives a restart
                       because nib gives it an expiry in the engine's own cookie store
                       (src-tauri/src/web_cookies.rs)
    persistent cookie- written to the `web` folder on disk; survives everything
    localStorage     - written to disk; survives everything
    partitioned      - a session cookie the widget's server sets with `Partitioned`
    cookie             (CHIPS), inside the app page's partition. Kept across a restart
                       like the other session cookie, and still in that partition: the
                       widget's own site, opened on its own, never sees it. The COM
                       cookie manager nib first kept logins through wrote a copy of it
                       without the partition, which the widget's site could read under
                       every site; the drive plants such a copy and proves the next
                       page load takes it away (src-tauri/src/web_cookies/twins.rs)

The widget is `localhost` framed in `127.0.0.1`: the same server, two sites.

See `session` in apps/desktop/src-tauri/src/web_tabs.rs and docs/web-tabs.md.

    pnpm --dir apps/desktop tauri build --no-bundle \
      --config '{"identifier":"ch.emilvinu.nib.probe","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
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

from probe_app import close_app, run_probe, main_window, sized

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
OWN = "The widget's own site"

# What a login leaves behind, in the three shapes it takes. The values are markers the
# probe reads straight back out of the page.
SID = "NIBSESSION"
PID = "NIBPERSIST"
TOKEN = "NIBTOKEN"
PART = "NIBPART"

# The widget's partitioned session cookie, as its server sets it inside the app page.
PARTITIONED = f"part={PART}; Path=/; Secure; SameSite=None; Partitioned"

# The copy the COM cookie manager made of it: the same cookie with no partition, lasting
# four hundred days from a day that manager was in use (2026-09-29). Planted by the
# widget's own site, which is where such a copy is a leak.
TWIN = f"part={PART}; Path=/; Secure; SameSite=None; Expires=Wed, 03 Nov 2027 00:00:00 GMT"

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


# What the reader needs besides the markers: a couple of hundred characters of article,
# or it keeps the body rather than the article.
FILLER = """<p>This paragraph is here only so the reader keeps the article rather than the body,
which needs a couple of hundred characters of it before it will. It says nothing that
the line above did not, and the probe reads the markers on that line regardless.</p>"""

# The page a login lands on. It writes nothing; it reads what it was given and shows it
# in an <article>, which is what the clipper's reader hands back. So the probe learns
# what the page still has by reading the page, the way a person would. The widget's
# cookie is the widget's to read, so the page frames it and shows what it says - and
# shows no markers until it has, so they are never read half written.
APP = """<!doctype html>
<title>App</title>
<body style="margin:0;font:16px system-ui">
<article style="padding:2rem">
WAITING
__FILLER__
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
  window.addEventListener('message', function (event) {
    if (event.origin !== '__WIDGET__') return
    document.querySelector('article').firstChild.textContent =
      '\\nRESULT|sid:' + sid + '|pid:' + pid + '|token:' + token + '|part:' + event.data +
      '|END\\n'
  })
  var frame = document.createElement('iframe')
  frame.src = '__WIDGET__/frame'
  document.body.appendChild(frame)
</script>
"""

# The sign-in. It sets the three, has the widget sign in from inside it, then leaves for
# the app page without adding a step to history, so the note settles on the app page and
# reopening it reads rather than signs in again.
LOGIN = """<!doctype html>
<title>Signing in</title>
<body style="margin:0;font:16px system-ui"><p>Signing in...</p></body>
<script>
  document.cookie = 'sid=__SID__; path=/'
  document.cookie = 'pid=__PID__; path=/; max-age=99999'
  try { localStorage.setItem('token', '__TOKEN__') } catch (error) {}
  window.addEventListener('message', function (event) {
    if (event.origin === '__WIDGET__') location.replace('/app')
  })
  var frame = document.createElement('iframe')
  frame.src = '__WIDGET__/frame-login'
  document.body.appendChild(frame)
</script>
"""

# The widget, framed: it says which cookie it has. Signing in is the same page, answered
# with the partitioned cookie.
FRAME = """<!doctype html>
<script>
  var found = document.cookie.match(/(?:^|; )part=([^;]*)/)
  parent.postMessage(found ? found[1] : '', '*')
</script>
"""

# The widget's site on its own, top level: what it can read of the widget's cookie here
# is a copy without the partition, which is the leak.
OWN_PAGE = """<!doctype html>
<title>Widget</title>
<body style="margin:0;font:16px system-ui">
<article style="padding:2rem">
WAITING
__FILLER__
</article>
</body>
<script>
  var found = document.cookie.match(/(?:^|; )part=([^;]*)/)
  document.querySelector('article').firstChild.textContent =
    '\\nRESULT|own:' + (found ? found[1] : '') + '|END\\n'
</script>
"""


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def widget(port: int) -> str:
    """The widget's origin: the same server, a site other than the app's."""

    return f"http://localhost:{port}"


def serve(port: int) -> Server:
    # Replaced rather than formatted: the pages are JavaScript, and every brace in it
    # would be a field name to `str.format`.
    def page(text: str) -> bytes:
        return (
            text.replace("__SID__", SID)
            .replace("__PID__", PID)
            .replace("__TOKEN__", TOKEN)
            .replace("__WIDGET__", widget(port))
            .replace("__FILLER__", FILLER)
            .encode()
        )

    pages = {
        "/login": page(LOGIN),
        "/app": page(APP),
        "/frame": page(FRAME),
        "/frame-login": page(FRAME),
        "/own": page(OWN_PAGE),
        "/plant": page(OWN_PAGE),
    }
    # What a response sets besides: the widget's sign-in, and the planted copy.
    cookies = {"/frame-login": PARTITIONED, "/plant": TWIN}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            body = pages.get(path)
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            if path in cookies:
                self.send_header("set-cookie", cookies[path])
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
    # The widget's own site, top level, to ask whether its cookie left its partition.
    (made / f"{OWN}.url").write_text(shortcut(f"{widget(port)}/own", OWN), encoding="utf-8")
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
# of the article, whichever part the reader chose: `RESULT|name:value|...|END`.
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
            found = re.search(r"RESULT\|(.*?)\|END", html)
            if found:
                return {
                    name: value
                    for name, _, value in (pair.partition(":") for pair in found[1].split("|"))
                }
        time.sleep(0.4)
    return {}


def launch(
    exe: pathlib.Path, identifier: str, unlike: int = 0
) -> tuple[subprocess.Popen[bytes], App]:
    app = run_probe(exe, quiet=True)
    port, secret = endpoint(identifier, 90, unlike)

    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        hwnd = main_window(app.pid)
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    sized(hwnd, 1280, 860)
    time.sleep(1.5)
    return app, App(port, secret)


def quit(app: subprocess.Popen[bytes]) -> None:
    """Closes the window the way a person does, and waits for the app to be gone.

    Not `terminate`, which is the task manager's kill: the engine then gets no word that
    the app is going, and a drive that only ever killed the app would be measuring a
    crash rather than a quit."""

    if not close_app(app):
        app.kill()
        raise SystemExit("the app did not quit when its window was closed")


def logged_in(state: dict[str, str]) -> bool:
    return (
        state.get("sid") == SID
        and state.get("pid") == PID
        and state.get("token") == TOKEN
        and state.get("part") == PART
    )


def apart(state: dict[str, str]) -> bool:
    """Whether the widget's own site, opened on its own, has none of the widget's cookie:
    the partitioned one stayed in its partition, and there is no copy without one."""

    return state.get("own") == ""


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

        # Open the site, then sign in: the login page sets the three, has the widget
        # sign in, and leaves for the app page. Then send the tab to the app page for
        # good, so the note settles there - reopening it reads what it has rather than
        # signing in a second time.
        def navigate(on: str, url: str) -> object:
            return app.ask(
                "window.__TAURI_INTERNALS__.invoke('web_navigate', { tab: '"
                + on
                + f"', url: '{url}' }})"
            )

        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        said["signed out to begin with"] = seen(app, tab)

        navigate(tab, f"http://127.0.0.1:{port}/login")
        time.sleep(4)

        # Only the app page draws the markers, so reading them back is also what says
        # the login page has handed over to it.
        said["signed in"] = seen(app, tab)
        ok = ok and logged_in(said["signed in"])

        # The widget's own site, on its own. Every page load has kept the logins by now
        # (web_cookies.rs); a keep that wrote the partitioned cookie back without its
        # partition would show it here.
        app.open(f"{OWN}.url")
        own = wait_for_tab(app, OWN)
        time.sleep(3)
        said["the widget's own site after signing in"] = seen(app, own)
        ok = ok and apart(said["the widget's own site after signing in"])

        # A copy without the partition, planted the way the COM cookie manager left one.
        # The page that plants it sees it - which is what says this page would see one -
        # and the keep after that page's load takes it away, so the page loaded again
        # has none. The partitioned cookie is still there, in its partition.
        navigate(own, f"{widget(port)}/plant")
        time.sleep(3)
        planted = seen(app, own)
        said["a copy without the partition, planted"] = planted
        ok = ok and planted.get("own") == PART
        navigate(own, f"{widget(port)}/own")
        time.sleep(3)
        said["the copy after the next page load"] = seen(app, own)
        ok = ok and apart(said["the copy after the next page load"])
        navigate(tab, f"http://127.0.0.1:{port}/app")
        time.sleep(3)
        said["the partitioned cookie after the copy went"] = seen(app, tab)
        ok = ok and logged_in(said["the partitioned cookie after the copy went"])
        app.ask(f"nib.workspace.close('{own}')")
        time.sleep(1)

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
        said["two tabs share one session"] = alongside.get("sid") == SID
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
        said["session kept on reopen"] = after.get("sid") == SID
        said["still logged in on reopen"] = logged_in(after)
        ok = ok and logged_in(after)

        # And the app quit the way a person quits it - the window closed - and started
        # over. All three come back, the session cookie too: a browser that continues
        # where it left off keeps a session-only login across a restart, and so does
        # nib. See `RESTORE` in src-tauri/src/engine.rs.
        quit(running)
        time.sleep(2)
        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)
        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)
        relaunched = seen(app, tab)
        said["after relaunch"] = relaunched
        said["still logged in on relaunch"] = logged_in(relaunched)
        ok = ok and logged_in(relaunched)

        # And the widget's cookie came back in its partition and nowhere else.
        app.open(f"{OWN}.url")
        own = wait_for_tab(app, OWN)
        time.sleep(3)
        said["the widget's own site after relaunch"] = seen(app, own)
        ok = ok and apart(said["the widget's own site after relaunch"])
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
