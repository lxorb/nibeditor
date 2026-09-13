"""Does a web tab keep its page when you switch away from it? Windows only.

The question Emil asked: *"if I switch between web windows then it has decent
speed, but if I switch between a note and then back then it loads for an eternity
till the web window shows the website. Also I believe currently it resets the page
every time you reopen it."*

Both halves of that are one question - **is the webview still there?** - and the
crate can be asked it directly. `web_place` answers "that tab has no page open" for
a tab whose webview has gone, so a placement that succeeds is a page that is still
running and a placement that fails is a page that was closed and will have to be
built and loaded again. The probe asks it through the window's own `eval`, which is
where a tab's id can be read, so every number here is about the same tabs a reader
would be switching between.

What it reports:

* **kept on a switch** - whether the page is still running after the pane showing it
  went away. `False` is the bug: every switch away closed the webview, and coming
  back was a fresh browser process and a fresh load of the site.
* **cold ms** - the first web tab of a launch, which pays for starting the engine.
* **web to web ms**, **note to web ms** - how long until the tab has a page again.
  Where the page is kept these are the same number, and both are one placement.
* **kept the place** - whether the page came back where it was left rather than at
  the top, asked of the page itself.
* **the file** - what the `.url` says after the reading moved on, which is what makes
  reopening the note tomorrow open the page that was open.
* **back is lit** - whether the arrow over the page knows there is somewhere to go
  back to, before and after the app is started again. The engine will not answer that
  and a revived page's engine holds no history at all, so it is the trail's answer;
  the button the reader presses is what the probe reads.
* **bytes with ten** - what the pages cost this launch, with the cap doing its work.

    python scripts/web-switch-probe.py --exe path/to/nib.exe

The exe is a release build under an identifier of its own, so a run never touches an
installed app's session:

    pnpm --dir apps/desktop tauri build --no-bundle \
      --config '{"identifier":"ch.emilvinu.nib.probe"}'

`eval` is turned on in that identifier's own endpoint file by the probe, between two
launches, because the crate reads it once when it opens the socket. Nothing else can
turn it on; see src-tauri/src/endpoint.rs.
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

# Where this drive may listen; see docs/conventions.md.
PORT_FROM = 22300
PORT_TO = 22399

# What says where the notes go. The identifier a probe build runs under does not keep
# anybody's notes apart, so this is the one thing that does; see `spaces_root` and
# docs/automation.md.
SPACES_DIR = "NIB_SPACES_DIR"

SPACE = "Web switch probe"
NOTE = "Idea"
WEB = "A page in a tab"
OTHER = "Another page in a tab"

# How far down the page the probe scrolls before it switches away, in the page's own
# pixels. Anything that is not nought.
DOWN = 1200

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


def page(name: str) -> bytes:
    """A page tall enough to scroll and plain enough that nothing about it can move
    on its own."""

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
    pages = {"/page": page(WEB), "/other": page(OTHER)}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = pages.get(self.path)
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def spaces_root() -> pathlib.Path:
    """A spaces root of this drive's own, in the temp area, said to the app in
    `NIB_SPACES_DIR` and taken away when the drive exits.

    **Never `Documents/Nib`.** The identifier a probe build runs under moves the
    settings folder and the browsing profile and says nothing at all about where the
    spaces are, so a drive that wrote its space the obvious way wrote it beside
    somebody's real notes - which is what happened, and had to be deleted by hand. The
    variable is read by `spaces_dir` at call time and wins over the documents folder;
    see docs/automation.md.

    Set in this process's environment, so the app inherits it when it is launched, and
    removed through `atexit` rather than a caller's `finally`, so it goes on every road
    out of a drive - including the `SystemExit` a probe raises when the window never
    appears. `web-overlays-probe.py` calls this too, and is kept out of the notes by it.
    """

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-switch-probe-"))
    os.environ[SPACES_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made


def shortcut(url: str, title: str) -> str:
    return (
        "[InternetShortcut]\r\n"
        f"URL={url}\r\n"
        f"Title={title}\r\n"
        "Nib-Added=2026-09-13T08:00:00.000Z\r\n"
    )


def space(port: int) -> pathlib.Path:
    made = spaces_root() / SPACE
    shutil.rmtree(made, ignore_errors=True)
    made.mkdir(parents=True, exist_ok=True)
    (made / f"{NOTE}.md").write_text(
        f"# {NOTE}\n\nAn ordinary note, to switch away to.\n", encoding="utf-8"
    )
    (made / f"{WEB}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/page", WEB), encoding="utf-8"
    )
    (made / f"{OTHER}.url").write_text(
        shortcut(f"http://127.0.0.1:{port}/other", OTHER), encoding="utf-8"
    )
    # Ten more, for what ten tabs cost.
    for index in range(10):
        (made / f"Site {index}.url").write_text(
            shortcut(f"http://127.0.0.1:{port}/page?{index}", f"Site {index}"),
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
    """Turns on the one verb that can ask the crate a question of its own. Between
    two launches, because the crate reads the flag when it opens the socket."""

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
        """Runs a line in the window and answers what it came to, read back out of
        the JSON the verb wraps it in."""

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


# The tab strip, as the window sees it: which tab is which and which one is showing.
TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({
  id: one.id, kind: one.kind, name: one.name, path: one.path,
  showing: one.id === nib.workspace.activeTabId, address: one.address ?? null,
})))"""


def tab_of(app: App, name: str) -> str | None:
    said = app.ask(TABS)
    if not isinstance(said, list):
        return None
    for one in said:
        if isinstance(one, dict) and str(one.get("name", "")).startswith(name):
            return str(one.get("id"))
    return None


# Whether the crate still has a page for this tab. `web_place` is the cheapest
# question that only a living webview can answer; a page that has gone says so.
LIVE = """(async () => {
  try {
    await window.__TAURI_INTERNALS__.invoke('web_place', {
      tab: '%s', pane: { x: 0, y: 0, width: 10, height: 10 }, visible: false,
    })
    return JSON.stringify({ live: true })
  } catch (error) {
    return JSON.stringify({ live: false, said: String(error) })
  }
})()"""


def live(app: App, tab: str) -> bool:
    said = app.ask(LIVE % tab)
    return isinstance(said, dict) and said.get("live") is True


def until_live(app: App, tab: str, seconds: float) -> float | None:
    began = time.perf_counter()
    while time.perf_counter() - began < seconds:
        if live(app, tab):
            return (time.perf_counter() - began) * 1000
        time.sleep(0.05)
    return None


# Where the page is and how far down it. A tab that came back where it was left
# answers with the offset it was left at.
def place(app: App, tab: str) -> object:
    return app.ask(
        """(async () => {
  try {
    return JSON.stringify(await window.__TAURI_INTERNALS__.invoke('web_look', { tab: '%s' }))
  } catch (error) {
    return JSON.stringify({ error: String(error) })
  }
})()"""
        % tab
    )


def scroll(app: App, tab: str, down: int) -> object:
    """Puts the page somewhere that is not the top, in the page's own document."""

    return app.ask(
        """(async () => {
  try {
    await window.__TAURI_INTERNALS__.invoke('web_scroll', { tab: '%s', x: 0, y: %d })
    return JSON.stringify({ ok: true })
  } catch (error) {
    return JSON.stringify({ error: String(error) })
  }
})()"""
        % (tab, down)
    )


def lit(app: App) -> object:
    """Whether the back arrow is lit, which is the trail's own answer: the engine will
    not say whether a page can go back, and a revived page's engine has no history at
    all. The button the reader presses is what this reads."""

    return app.ask(
        "JSON.stringify(!document.querySelector('.webbar button[aria-label=\"Back\"]').disabled)"
    )


def memory(pid: int) -> int:
    """What this launch's pages cost, in bytes: the processes under the app's own and
    no others, because this machine runs WebView2 for several programs."""

    script = (
        "$all = Get-CimInstance Win32_Process |"
        " Select-Object ProcessId,ParentProcessId,WorkingSetSize;"
        f" $mine = @({pid}); $grew = $true;"
        " while ($grew) { $grew = $false;"
        "  foreach ($one in $all) {"
        "   if ($mine -contains $one.ParentProcessId -and -not ($mine -contains $one.ProcessId))"
        "    { $mine += $one.ProcessId; $grew = $true } } }"
        " ($all | Where-Object { $mine -contains $_.ProcessId -and $_.ProcessId -ne "
        + str(pid)
        + " } | Measure-Object WorkingSetSize -Sum).Sum"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        return int((out.stdout or "0").strip() or 0)
    except (OSError, ValueError, subprocess.SubprocessError):
        return 0


def launch(
    exe: pathlib.Path, identifier: str, unlike: int = 0
) -> tuple[subprocess.Popen[bytes], App, int]:
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
    # A size that fits on one screen, so the pane the page is placed over is a pane
    # with room in it. SWP_NOZORDER: nothing about which window is in front changes.
    user32.SetWindowPos(hwnd, None, 0, 0, 1280, 860, 0x0004)
    time.sleep(1.5)
    return app, App(port, secret), hwnd


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
    server = serve(port)
    made = space(port)

    said: dict[str, object] = {}
    running = None
    try:
        # One launch to write the endpoint file, so eval can be turned on in it.
        running, app, _ = launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        allow_eval(args.identifier)
        time.sleep(1)

        running, app, _ = launch(args.exe, args.identifier, unlike=app.port)

        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)

        # 1. cold: the first web tab of a launch pays for starting the engine.
        began = time.perf_counter()
        app.open(f"{WEB}.url")
        web = None
        until = time.perf_counter() + 20
        while web is None and time.perf_counter() < until:
            web = tab_of(app, WEB)
        if web is None:
            raise SystemExit("the app never opened the website")
        said["cold ms"] = until_live(app, web, 90)
        said["cold total ms"] = (time.perf_counter() - began) * 1000

        # The page is put somewhere that is not the top, so every switch below says
        # whether the page kept its place or started again.
        time.sleep(2)
        said["scrolled"] = scroll(app, web, DOWN)
        time.sleep(1)
        said["the place"] = place(app, web)

        # 2. away to a note, which is the switch Emil timed.
        app.open(f"{NOTE}.md")
        time.sleep(1.5)
        said["kept on a switch"] = live(app, web)

        began = time.perf_counter()
        app.open(f"{WEB}.url")
        said["note to web ms"] = until_live(app, web, 90)
        time.sleep(1.5)
        said["note to web kept the place"] = place(app, web)

        # 3. web to web, and back.
        app.open(f"{OTHER}.url")
        other = tab_of(app, OTHER)
        said["web to web ms"] = until_live(app, other, 90) if other else None
        time.sleep(1)
        began = time.perf_counter()
        app.open(f"{WEB}.url")
        said["back to the first ms"] = until_live(app, web, 90)
        said["back to the first kept the place"] = place(app, web)

        # 4. a link followed inside the page, so the tab has a trail behind it.
        #    `web_navigate` is the call the bar makes and the one a link inside the page
        #    ends in, and it is the only way a drive can follow one.
        app.ask(
            "window.__TAURI_INTERNALS__.invoke('web_navigate', { tab: '"
            + web
            + "', url: 'http://127.0.0.1:"
            + str(port)
            + "/other' })"
        )
        time.sleep(4)
        said["the trail after following a link"] = place(app, web)
        said["back is lit"] = lit(app)

        # 5. ten tabs, and what parking gives back.
        for index in range(10):
            app.open(f"Site {index}.url")
            time.sleep(1.5)
        time.sleep(5)
        said["bytes with ten"] = memory(running.pid)
        said["live with ten"] = app.ask(
            "JSON.stringify(nib.workspace.tabs.filter((one) => one.kind === 'web').length)"
        )

        # 6. what the file says now, which is what reopening the note tomorrow reads.
        said["the file"] = (made / f"{WEB}.url").read_text(encoding="utf-8").replace("\r\n", " | ")

        # 7. the app again, on the session it was left with, and the note reopened.
        running.terminate()
        running.wait(timeout=30)
        time.sleep(2)
        running, app, _ = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)
        app.open(f"{WEB}.url")
        web = None
        until = time.perf_counter() + 20
        while web is None and time.perf_counter() < until:
            web = tab_of(app, WEB)
        said["relaunch ms"] = until_live(app, web, 90) if web else None
        time.sleep(3)
        said["relaunch kept the place"] = place(app, web) if web else None
        # The arrows over a revived page are the trail's, because the engine's own
        # history went with the webview; see `Trail::engine` in web_tabs.rs.
        said["relaunch: back is lit"] = lit(app)
    finally:
        if running is not None:
            running.terminate()
        server.shutdown()

    for name, value in said.items():
        shown = f"{value:.0f}" if isinstance(value, float) else json.dumps(value)
        print(f"{name}: {shown}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
