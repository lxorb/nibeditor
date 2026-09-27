"""Does a download in a web tab land in the Downloads folder? Windows only.

Emil, 2026-09-27: *"downloads currently don't work, please fix"*. The everyday case is
a course page on Moodle: a link to a PDF behind a login, which the server sends as an
attachment. This probe serves the shapes a download takes on the web from the loopback
and follows each of them in a real web tab of a probe build:

    attach   a plain link to a file sent with `Content-Disposition: attachment`
    named    an `<a download="...">` link to a file the server would show inline
    inline   a link to a PDF sent inline, which a browser shows rather than saves
    blob     a file a script made in the page, saved through a `blob:` address
    data     a file written into a `data:` address
    cookie   a file only a signed-in session may have, the way Moodle's
             pluginfile.php is
    blank    a `target="_blank"` link to an attachment, which asks for a window first
    again    the first file a second time, which a browser saves as `name (1).ext`
    slow     a four megabyte file over three seconds, read halfway along
    stop     the same file, stopped halfway
    closed   the same file in a tab a page asked for, which closes as the file starts
    public   an attachment from a public site, httpbin.org; only when `--only` names it

Each page follows its own link as it loads, so nothing on the machine is pointed at
and the probe can run beside somebody working. What it reads back is the folder the
files arrive in, the tabs the window has, and the list of downloads the crate keeps.

    pnpm --dir apps/desktop tauri build --no-bundle \
      --config '{"identifier":"ch.emilvinu.nib.probe.downloads","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/web-downloads-probe.py --exe path/to/nib.exe \
      --identifier ch.emilvinu.nib.probe.downloads

The files go to a folder of this probe's own, named in `NIB_DOWNLOADS_DIR`, so a run
never writes into anybody's Downloads; see `downloads::folder` in src-tauri. A build
that predates that variable writes into the real Downloads folder, and `--watch` says
where to look for it; the probe then takes away only the files it wrote itself, which
all start with `nibprobe-`.
"""

from __future__ import annotations

import argparse
import base64
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

from probe_app import refuse_updating

PORT_FROM = 22400
PORT_TO = 22499

SPACE = "Web downloads probe"
NOTE = "Idea"
SITE = "Course page"

# The smallest file every PDF viewer will open, so an inline PDF is a page and a saved
# one is a document somebody could read.
PDF = (
    b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
    b"trailer<</Root 1 0 R>>\n%%EOF\n"
)

# A page that follows one link as it loads. The link fills the page, so a person
# watching sees what was followed, and a real click lands on it too.
FOLLOW = """<!doctype html>
<title>__NAME__</title>
<body style="margin:0;font:16px system-ui">
<a id="go" __ATTRS__ style="display:block;position:fixed;inset:0;padding:2rem">__NAME__</a>
<script>
  __BEFORE__
  setTimeout(function () { document.getElementById('go').click() }, 300)
</script>
</body>
"""

BLOB = """
  var go = document.getElementById('go')
  go.href = URL.createObjectURL(new Blob(['made in the page'], { type: 'text/plain' }))
"""

LOGIN = """<!doctype html>
<title>Signed in</title>
<body><p>Signed in</p></body>
"""

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


def page(name: str, attrs: str, before: str = "") -> bytes:
    return (
        FOLLOW.replace("__NAME__", name)
        .replace("__ATTRS__", attrs)
        .replace("__BEFORE__", before)
        .encode()
    )


DATA = "data:text/plain;base64," + base64.b64encode(b"written into an address").decode()

CASES: dict[str, bytes] = {
    "attach": page("attach", 'href="/files/report"'),
    "named": page("named", 'href="/files/plain.txt" download="nibprobe-named.txt"'),
    "inline": page("inline", 'href="/files/slides.pdf"'),
    "blob": page("blob", 'download="nibprobe-blob.txt"', BLOB),
    "data": page("data", f'href="{DATA}" download="nibprobe-data.txt"'),
    "cookie": page("cookie", 'href="/pluginfile.php/42/mod_resource/content/1/nibprobe-cookie.pdf"'),
    # Not followed by script: a page gets a window only for a press; see `main`.
    "blank": page("blank", 'href="/files/blank" target="_blank"').replace(
        b"setTimeout(function () { document.getElementById('go').click() }, 300)", b""
    ),
    "again": page("again", 'href="/files/report"'),
    "public": page(
        "public",
        'href="https://httpbin.org/response-headers?Content-Disposition=attachment%3B%20filename%3Dnibprobe-public.txt"',
    ),
    "slow": page("slow", 'href="/files/slow"'),
    "stop": page("stop", 'href="/files/slow?stop"'),
    # A large file a page asked a window for, whose tab is closed while it is on its way.
    "closed": page("closed", 'href="/files/slow?closed" target="_blank"').replace(
        b"setTimeout(function () { document.getElementById('go').click() }, 300)", b""
    ),
}

# What each case should leave in the folder, if downloads work the way a browser's do.
EXPECTED: dict[str, str | None] = {
    "attach": "nibprobe-report.pdf",
    "named": "nibprobe-named.txt",
    "inline": None,
    "blob": "nibprobe-blob.txt",
    "data": "nibprobe-data.txt",
    "cookie": "nibprobe-cookie.pdf",
    "blank": "nibprobe-blank.pdf",
    "again": "nibprobe-report (1).pdf",
    "public": "nibprobe-public.txt",
    "slow": "nibprobe-slow.bin",
    "stop": None,
    "closed": "nibprobe-slow (1).bin",
}


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


HITS: list[str] = []

SLOW = 4 * 1024 * 1024
CHUNK = 64 * 1024


def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def send(self, status: int, kind: str, body: bytes, extra: dict[str, str] | None = None) -> None:
            self.send_response(status)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            HITS.append(path)
            cookie = self.headers.get("cookie") or ""

            if path.startswith("/case/"):
                body = CASES.get(path.removeprefix("/case/"))
                self.send(200 if body else 404, "text/html; charset=utf-8", body or b"no")
            elif path == "/login":
                self.send(200, "text/html; charset=utf-8", LOGIN.encode(), {
                    "set-cookie": "MoodleSession=nibprobe; path=/; HttpOnly",
                })
            elif path == "/files/report":
                self.send(200, "application/pdf", PDF, {
                    "content-disposition": 'attachment; filename="nibprobe-report.pdf"',
                })
            elif path == "/files/blank":
                self.send(200, "application/pdf", PDF, {
                    "content-disposition": 'attachment; filename="nibprobe-blank.pdf"',
                })
            elif path == "/files/slow":
                # A file large enough to be seen on its way: four megabytes over about
                # three seconds, with its size said up front the way a server says it.
                self.send_response(200)
                self.send_header("content-type", "application/octet-stream")
                self.send_header("content-length", str(SLOW))
                self.send_header("content-disposition", 'attachment; filename="nibprobe-slow.bin"')
                self.end_headers()
                try:
                    for _ in range(SLOW // CHUNK):
                        self.wfile.write(b"n" * CHUNK)
                        self.wfile.flush()
                        time.sleep(3 / (SLOW // CHUNK))
                except OSError:
                    return
            elif path == "/files/plain.txt":
                self.send(200, "text/plain; charset=utf-8", b"shown inline unless asked")
            elif path == "/files/slides.pdf":
                self.send(200, "application/pdf", PDF)
            elif path.startswith("/pluginfile.php/"):
                if "MoodleSession=nibprobe" in cookie:
                    self.send(200, "application/pdf", PDF, {
                        "content-disposition": 'attachment; filename="nibprobe-cookie.pdf"',
                    })
                else:
                    self.send(403, "text/html; charset=utf-8", b"<title>Forbidden</title>not signed in")
            else:
                self.send(404, "text/plain", b"no")

        def log_message(self, *_args: object) -> None:
            return

    # Every loopback address rather than one, because each case is served from a host
    # of its own; see `host`.
    made = Server(("0.0.0.0", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("0.0.0.0", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


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


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def open(self, path: str, space_name: str | None = None) -> object:
        args: dict[str, object] = {"path": path}
        if space_name:
            args["space"] = space_name
        return act(self.port, self.secret, "open", args)

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


TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({
  id: one.id, kind: one.kind, name: one.name,
})))"""


def tabs(app: App) -> list[dict[str, str]]:
    said = app.ask(TABS)
    return [one for one in said if isinstance(one, dict)] if isinstance(said, list) else []


def wait_for_tab(app: App, name: str, seconds: float = 25) -> str:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        for one in tabs(app):
            if str(one.get("name", "")).startswith(name):
                return str(one["id"])
        time.sleep(0.3)
    raise SystemExit(f"the app never opened {name}: {app.ask(TABS)}")


def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    refuse_updating(exe)
    running = subprocess.Popen([str(exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port, secret = endpoint(identifier, 90, unlike)

    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        found = windows_of(running.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    assert user32 is not None
    user32.SetWindowPos(hwnd, None, 40, 40, 1280, 860, 0x0004)
    time.sleep(1.5)
    return running, App(port, secret)


def ours(folder: pathlib.Path) -> set[str]:
    try:
        return {one.name for one in folder.iterdir() if one.name.startswith("nibprobe-")}
    except OSError:
        return set()


def host(number: int, port: int) -> str:
    """A loopback host of its own for each case.

    Chromium lets a page start one download without a press and asks before the
    second - the "automatic downloads" question - and it keeps that count per tab until
    the tab goes somewhere else. A probe that follows every link by script would be
    asking that question from the second case on, so each case is somewhere else:
    `127.0.0.10`, `127.0.0.11` and so on, which are all this machine."""

    return f"http://127.0.0.{10 + number}:{port}"


def go(app: App, tab: str, url: str) -> object:
    return app.ask(
        "window.__TAURI_INTERNALS__.invoke('web_navigate', { tab: '" + tab + f"', url: '{url}' }})"
    )


def quiet(app: App) -> None:
    """Puts away the notice that a newer build is ready. It sits over the corner of the
    page, and a page with anything of the app's over it is out of sight - which is
    not the page a reader presses on."""

    app.ask(
        "[...document.querySelectorAll('.update button, button')]"
        ".find((one) => one.textContent.trim() === 'Later')?.click()"
    )


def shoot(pid: int, to: pathlib.Path) -> None:
    """The window as it is now, into a picture, through the repository's own capture."""

    to.parent.mkdir(parents=True, exist_ok=True)
    script = pathlib.Path(__file__).with_name("capture-window.ps1")
    subprocess.run(
        ["powershell", "-NoProfile", "-File", str(script), "-Pid", str(pid), "-Out", str(to)],
        check=False,
        capture_output=True,
    )


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.downloads")
    parsed.add_argument("--watch", type=pathlib.Path, default=None)
    parsed.add_argument("--only", default="")
    parsed.add_argument("--shots", type=pathlib.Path, default=None)
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-downloads-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(root / "spaces")
    arrive = root / "downloads"
    arrive.mkdir()
    os.environ["NIB_DOWNLOADS_DIR"] = str(arrive)
    folder: pathlib.Path = args.watch or arrive
    for stale in ours(folder):
        (folder / stale).unlink(missing_ok=True)

    space = root / "spaces" / SPACE
    space.mkdir(parents=True)
    (space / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note.\n", encoding="utf-8")
    (space / f"{SITE}.url").write_text(
        f"[InternetShortcut]\r\nURL=http://127.0.0.1:{port}/login\r\nTitle={SITE}\r\n",
        encoding="utf-8",
    )

    report: dict[str, object] = {}
    failed = 0
    running = None
    try:
        running, app = launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=30)
        allow_eval(args.identifier)
        time.sleep(1)

        running, app = launch(args.exe, args.identifier, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(2)
        app.open(f"{SITE}.url")
        tab = wait_for_tab(app, SITE)
        time.sleep(3)

        # The one case that leaves this machine runs only when it is asked for by name.
        named = args.only.split(",") if args.only else [one for one in CASES if one != "public"]
        chosen = [one for one in CASES if one in named]
        for number, case in enumerate(chosen):
            before = ours(folder)
            count = len(tabs(app))
            at = host(number, port)
            if case == "cookie":
                # Signed in first, on the host the file is on, the way somebody reading
                # a course page already is.
                go(app, tab, f"{at}/login")
                time.sleep(2)
            quiet(app)
            HITS.clear()
            go(app, tab, f"{at}/case/{case}")
            if case in ("blank", "closed"):
                # A page gets a window only for a press, and this probe presses nothing
                # on the machine. So the window hears what the crate says when the
                # page's press arrives - `nib://web-open`, with the tab that asked - and
                # opens a tab for it exactly as it would for the page.
                time.sleep(1)
                app.ask(
                    "window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'nib://web-open',"
                    f" payload: {{ tab: '{tab}', url: '{at}/files/{'blank' if case == 'blank' else 'slow'}' }} }})"
                )
            if case in ("slow", "stop", "closed"):
                # Halfway: the file is on its way, and the list says how far.
                time.sleep(1.6)
                listed = app.ask("window.__TAURI_INTERNALS__.invoke('web_downloads')")
                going = [one for one in listed if isinstance(one, dict) and one.get("state") == "going"] if isinstance(listed, list) else []
                report[f"{case}, on its way"] = going
                if args.shots:
                    shoot(running.pid, args.shots / f"{case}-going.png")
                if not going or not going[-1].get("received") or going[-1].get("total") != SLOW:
                    failed += 1
                if case == "closed":
                    # The tab the file is fetched in, closed by the reader halfway.
                    for one in tabs(app):
                        if one["id"] != tab and str(one.get("kind")) == "web":
                            app.ask(f"nib.workspace.close('{one['id']}')")
                    report["closed, tabs after closing"] = len(tabs(app))
                if case == "stop" and going:
                    app.ask(f"window.__TAURI_INTERNALS__.invoke('web_download_cancel', {{ id: {going[-1]['id']} }})")
            time.sleep(4)
            if args.shots:
                shoot(running.pid, args.shots / f"{case}.png")
            after = ours(folder)
            now = tabs(app)
            arrived = sorted(after - before)
            want = EXPECTED[case]
            # And no tab left behind: a tab a page opened for a file closes again, the way
            # a browser's does.
            ok = arrived == ([want] if want else []) and len(now) == count
            failed += 0 if ok else 1
            report[case] = {
                "ok": ok,
                "arrived": arrived,
                "wanted": want,
                "tabs": f"{count} -> {len(now)}",
                "server saw": HITS[:],
            }
            # A tab a case left behind is closed, so the next case starts where this one
            # did - in the tab the probe is steering.
            for one in now:
                if one["id"] != tab and str(one.get("kind")) == "web" and not str(one.get("name", "")).startswith(SITE):
                    app.ask(f"nib.workspace.close('{one['id']}')")
            app.ask(f"nib.workspace.activate?.('{tab}')")

        listed = app.ask("window.__TAURI_INTERNALS__.invoke('web_downloads')")
        report["the crate's list"] = listed
        if args.shots:
            # The list under the bar, opened the way a press opens it.
            app.ask("document.querySelector('.webbar .saving')?.click()")
            time.sleep(1)
            shoot(running.pid, args.shots / "list.png")
        # Everything has ended one way or another: a download the list still calls going
        # is one the bar would turn its ring for for ever.
        stuck = [one for one in listed if isinstance(one, dict) and one.get("state") == "going"] if isinstance(listed, list) else ["no list"]
        report["still going at the end"] = stuck
        failed += 1 if stuck else 0
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=30)
            except subprocess.TimeoutExpired:
                running.kill()
        for stale in ours(folder):
            (folder / stale).unlink(missing_ok=True)
        shutil.rmtree(root, ignore_errors=True)

    print(json.dumps(report, indent=2))
    print("\nPASS" if failed == 0 else f"\nFAIL ({failed})")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
