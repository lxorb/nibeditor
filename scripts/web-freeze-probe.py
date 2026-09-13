"""Does the window still answer while a web tab opens? Windows only.

The one thing no unit test can see. A web tab's page is a second webview inside the
window, and the platform builds one of those asynchronously: the answer arrives on
the same message loop that asked for it. So whether the app is still alive while a
page opens is a question about that loop, and this asks it directly.

A window can be dead in two ways, and the probe watches for both:

* **the pump has stopped.** `SendMessageTimeout(hwnd, WM_NULL, ...)` sends the
  window a message that does nothing and times the answer. A loop that is running
  answers in under a millisecond; a loop inside a nested wait answers when the wait
  ends, and never if it does not. `IsHungAppWindow` is the shell's own second
  opinion - it is what Explorer draws "Not Responding" from.
* **the window threw.** The pump runs, the pixels are there, and nothing answers a
  press, because an error while Svelte was flushing left the page drawn and no
  longer reactive. Nothing outside can see that in a screenshot, so the probe reads
  the app's own log, where every uncaught error is written; see lib/log.ts.

Four phases, one app:

1. **launch** - started with nothing. What a healthy window looks like.
2. **open** - a website opened in a tab, through the app's own automation endpoint,
   which is the road `nib open` takes and ends in the same `openEntry` a click in
   the file list does. The samples go on across it.
3. **restart** - the app again, on the session it was left with, which is how a web
   tab reaches a pane with nobody pressing anything.
4. **verdict** - the worst latency in each phase, what the log holds, and a non-zero
   exit when the window died either way. A regression test, not only a picture.

The page is served from here, on a port of its own, so the measurement is about the
app and not about somebody's network. The space is made in the spaces folder,
because a path outside one is not a path the app will open, and taken away again at
the end.

    python scripts/web-freeze-probe.py --exe path/to/Nib.exe

The exe comes from CI: this machine does not compile the crate. Build it with an
identifier of its own so the run cannot walk over the session of an installed app,
and pass the same identifier here; see .github/workflows/ci-check-webfreeze.yml.
"""

from __future__ import annotations

import argparse
import ctypes
import http.server
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes

# Where a drive of this repository may listen; see docs/conventions.md.
PORT_FROM = 21500
PORT_TO = 21599

# The space the probe makes for itself, and the note in it.
SPACE = "Web freeze probe"
NOTE = "A page in a tab"

WM_NULL = 0x0000
SMTO_BLOCK = 0x0001
SMTO_ABORTIFHUNG = 0x0002

# A WM_NULL a running loop answers in microseconds. A second is long enough that a
# slow frame is not read as a freeze, and short enough that a run against a dead
# window still finishes.
WAIT_MS = 1000

# How often the pump is asked. Four times a second is fine enough to catch the
# moment a page opens and coarse enough to leave the window alone.
EVERY = 0.25

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


def bind_names() -> None:
    """Says what each call takes, because a handle passed as a plain int is a handle
    cut in half on a 64 bit machine."""

    assert user32 is not None
    user32.SendMessageTimeoutW.argtypes = [
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
        wintypes.UINT,
        wintypes.UINT,
        ctypes.POINTER(ctypes.c_size_t),
    ]
    user32.SendMessageTimeoutW.restype = ctypes.c_ssize_t
    user32.IsHungAppWindow.argtypes = [wintypes.HWND]
    user32.IsHungAppWindow.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD


def windows_of(pid: int) -> list[int]:
    """Every visible top level window the process owns. A Tauri window is one of
    these; a webview's own window is not top level, and the browser process that
    draws a page is not this pid."""

    assert user32 is not None
    found: list[int] = []
    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            if user32.GetWindowTextLengthW(hwnd) > 0:
                found.append(hwnd)
        return True

    user32.EnumWindows(kind(each), 0)
    return found


def ask(hwnd: int) -> tuple[bool, float]:
    """Sends the window a message that does nothing, and times the answer.

    Nothing about the window changes: WM_NULL is the message defined to mean
    nothing, which is why it is what every probe of a pump sends."""

    assert user32 is not None
    answer = ctypes.c_size_t()
    began = time.perf_counter()
    got = user32.SendMessageTimeoutW(
        hwnd, WM_NULL, 0, 0, SMTO_BLOCK | SMTO_ABORTIFHUNG, WAIT_MS, ctypes.byref(answer)
    )
    return bool(got), (time.perf_counter() - began) * 1000


class Sample:
    """One reading: when it was taken, what it cost, and what the two flags said."""

    def __init__(self, at: float, answered: bool, cost: float, hung: bool) -> None:
        self.at = at
        self.answered = answered
        self.cost = cost
        self.hung = hung

    @property
    def dead(self) -> bool:
        return self.hung or not self.answered

    def line(self) -> str:
        state = "hung" if self.hung else ("answered" if self.answered else "no answer")
        return f"  {self.at:6.2f}s  {self.cost:8.2f} ms  {state}"


def measure(hwnd: int, seconds: float, began: float, out: list[Sample]) -> None:
    """Asks the pump every quarter second for as long as it is told to."""

    assert user32 is not None
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        answered, cost = ask(hwnd)
        hung = bool(user32.IsHungAppWindow(hwnd))
        sample = Sample(time.perf_counter() - began, answered, cost, hung)
        out.append(sample)
        print(sample.line(), flush=True)
        time.sleep(EVERY)


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


PAGE = b"""<!doctype html>
<title>A page in a tab</title>
<body style="font: 16px system-ui; padding: 3rem">
<h1>A page in a tab</h1>
<p>Served by scripts/web-freeze-probe.py, so the measurement is about the app.</p>
</body>
"""


class Quiet(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - the base class names it
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *_args: object) -> None:
        pass


def serve(port: int) -> http.server.ThreadingHTTPServer:
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def spaces_root() -> pathlib.Path:
    """`Documents/Nib`, which is where the app keeps spaces and the only place it
    opens a note from."""

    home = pathlib.Path.home()
    documents = home / "Documents"
    return (documents if documents.is_dir() else home) / "Nib"


def space_with_a_website(url: str) -> pathlib.Path:
    space = spaces_root() / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / f"{NOTE}.md").write_text(
        f"---\nurl: {url}\ntitle: {NOTE}\ndate: 2026-09-13T00:00:00.000Z\n---\n\n"
        f"# {NOTE}\n\n<{url}>\n",
        encoding="utf-8",
    )
    return space


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier


def wipe(identifier: str) -> None:
    """Everything the last run left: the session, the log, the webview's profile.

    A drive that starts from what the run before it left behind is not a drive. The
    name is checked first, because these two folders are where an installed app
    keeps everything it has and this is a script that deletes them."""

    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")

    for one in (config_dir(identifier), local_dir(identifier)):
        shutil.rmtree(one, ignore_errors=True)


def endpoint(identifier: str, seconds: float) -> tuple[int, str]:
    """The port and the secret this launch is listening behind, once it has written
    them down. The app's own handshake file; see src-tauri/src/endpoint.rs."""

    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret"):
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")


def act(port: int, secret: str, verb: str, args: dict[str, object]) -> str:
    """One request to the running app, the way `nib` makes one."""

    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as answer:
            return answer.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as refused:
        return f"the app answered {refused.code}: {refused.read().decode('utf-8', 'replace')}"
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return f"no answer: {error}"


def log_lines(identifier: str) -> list[str]:
    """What the app wrote down about itself. Every uncaught error in the window is
    appended to this file; see lib/log.ts and src-tauri/src/logs.rs."""

    path = local_dir(identifier) / "logs" / "nib.log"
    if not path.is_file():
        return []
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def onto_the_screen(hwnd: int) -> None:
    """Puts the window at the top left corner, at a size that fits on one screen.

    A photograph is copied off the screen, so a window hanging over an edge of it
    comes back with a black band where the pixels were not. Moving it is also a
    resize, which is the one thing a page in a tab has to follow."""

    assert user32 is not None
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    # SWP_NOZORDER, so nothing about which window is in front changes.
    user32.SetWindowPos(hwnd, None, 0, 0, 1280, 860, 0x0004)
    time.sleep(1.0)


def picture(out: pathlib.Path) -> None:
    """A photograph of the window, taken by the platform: a webview cannot photograph
    the window it is drawn in. The same script `nib screenshot` shells out to."""

    here = pathlib.Path(__file__).resolve().parent / "capture-window.ps1"
    try:
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-File",
                str(here),
                "-ProcessName",
                "Nib",
                "-Out",
                str(out),
            ],
            check=False,
            capture_output=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        pass


def worst(samples: list[Sample]) -> float:
    return max((one.cost for one in samples), default=0.0)


def dead(samples: list[Sample]) -> int:
    return sum(1 for one in samples if one.dead)


def wait_for_window(app: subprocess.Popen[bytes], seconds: float) -> int:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        found = windows_of(app.pid)
        if found:
            return found[0]
        time.sleep(0.2)
    return 0


def main() -> int:
    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True, help="the built Nib.exe")
    parsed.add_argument("--settle", type=float, default=6.0, help="seconds before the tab opens")
    parsed.add_argument("--watch", type=float, default=20.0, help="seconds after it opens")
    parsed.add_argument(
        "--identifier",
        default="ch.emilvinu.nib.probe",
        help="the identifier the exe was built with, which says where its files are",
    )
    parsed.add_argument("--keep", action="store_true", help="leave the app and the space behind")
    parsed.add_argument("--shots", default="", help="where to put the two photographs")
    args = parsed.parse_args()

    if sys.platform != "win32":
        print("this probe is about Windows: the pump it measures is Windows' own")
        return 0

    bind_names()

    exe = pathlib.Path(args.exe).resolve()
    if not exe.is_file():
        raise SystemExit(f"no exe at {exe}")

    shots = pathlib.Path(args.shots) if args.shots else pathlib.Path.cwd()
    shots.mkdir(parents=True, exist_ok=True)

    wipe(args.identifier)

    port = free_port()
    httpd = serve(port)
    url = f"http://127.0.0.1:{port}/"
    space = space_with_a_website(url)

    print(f"exe    {exe}")
    print(f"space  {space}")
    print(f"page   {url}\n")

    app = subprocess.Popen([str(exe)], cwd=str(exe.parent))
    began = time.perf_counter()
    hwnd = wait_for_window(app, 40)
    if not hwnd:
        app.kill()
        httpd.shutdown()
        raise SystemExit("the window never appeared")

    print(f"window 0x{hwnd:X} after {time.perf_counter() - began:.2f}s\n")

    launch: list[Sample] = []
    opened: list[Sample] = []
    restored: list[Sample] = []

    print("launch: the app with nothing open")
    measure(hwnd, args.settle, began, launch)

    print("\nopen: the website, through the app's own endpoint")
    where, secret = endpoint(args.identifier, 20)
    said: list[str] = []

    def open_it() -> None:
        # Twice, and the first one is only the space. A website is a website because
        # the link index says so, and the index of a space that has just been switched
        # to has not read it yet - so the first open lands on the note the file also
        # is, exactly as `openEntry` says it will. The second is the one a reader
        # makes: a row in the file list, with the globe already on it.
        said.append(act(where, secret, "open", {"space": SPACE, "path": f"{NOTE}.md"}))
        time.sleep(4)
        said.append(act(where, secret, "open", {"path": f"{NOTE}.md"}))

    asking = threading.Thread(target=open_it)
    asking.start()
    measure(hwnd, args.watch, began, opened)
    asking.join(timeout=5)
    for one in said:
        print(f"  the app said: {one}")
    if len(said) < 2:
        print("  and did not answer the second time it was asked")
    onto_the_screen(hwnd)
    picture(shots / "web-freeze-open.png")

    print("\nrestart: the app again, on the session it was left with")
    app.kill()
    app.wait(timeout=15)
    app = subprocess.Popen([str(exe)], cwd=str(exe.parent))
    again = time.perf_counter()
    hwnd = wait_for_window(app, 40)
    if hwnd:
        print(f"window 0x{hwnd:X} after {time.perf_counter() - again:.2f}s")
        measure(hwnd, args.watch, began, restored)
        onto_the_screen(hwnd)
        picture(shots / "web-freeze-restored.png")
    else:
        print("  the window never appeared on the second launch")

    wrong = [one for one in log_lines(args.identifier) if " ERROR " in one]

    print("\nverdict")
    print(f"  launch   worst {worst(launch):8.2f} ms  dead {dead(launch)}/{len(launch)}")
    print(f"  open     worst {worst(opened):8.2f} ms  dead {dead(opened)}/{len(opened)}")
    print(f"  restart  worst {worst(restored):8.2f} ms  dead {dead(restored)}/{len(restored)}")
    print(f"  the app's own log holds {len(wrong)} error lines")
    for one in wrong[-8:]:
        print(f"    {one}")

    if not args.keep:
        app.kill()
        app.wait(timeout=10)
        shutil.rmtree(space, ignore_errors=True)
    httpd.shutdown()

    if dead(launch):
        print("\nthe window was not answering before a web tab was even opened")
        return 2
    if dead(opened) or dead(restored):
        print("\nthe window stopped answering while a web tab opened")
        return 1
    if wrong:
        print("\nthe window went on answering and something in it threw: the lines above")
        return 1

    print("\nthe window answered every message, and nothing in it threw")
    return 0


if __name__ == "__main__":
    sys.exit(main())
