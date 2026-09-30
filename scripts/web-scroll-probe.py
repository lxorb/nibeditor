"""One notch of the wheel over a web tab, measured against Chrome on the same machine.
Windows only.

Emil, 2026-09-30: *"the scrolling doesn't feel like it should. I have the feeling it may
be faster than it should be (this is only when scrolling in a web tab)"*. It was twice as
fast. See src-tauri/src/web_wheel.rs for why and for the fix.

What it measures, all on one plain page tall enough to scroll, read back from the page
itself frame by frame:

* **the input window** - a notch delivered to the engine's input window over the page
  (`Chrome_RenderWidgetHostHWND`), which is where Windows delivers a wheel whenever the
  keyboard is not inside the page: the address field, the sidebar, a note, a tab just
  switched to. How many wheel events the page hears, how far it moves, over how many
  frames. Two events and twice the distance is the engine handling one message twice.
* **the page's window** - the same notch delivered to the page's own window, its parent,
  which is where `web_wheel.rs` now sends every wheel over a page. One event, one notch.
* **Ctrl+wheel** - the zoom steps each of the two takes, where the engine zooms on it.
* **the hook** - whether the thread that sends wheels there is running once a page is
  open.
* **Chrome** - Chrome 153 headless on the same page at the same size and scale, handed
  the notch the machine's own *lines to scroll* makes (lines x 100/3 pixels, Chromium's
  `kScrollbarPixelsPerLine`), against nib's page handed the same through the engine's
  devtools. Distance, frames with movement and the curve: Chrome's animation is the
  engine's own in both.

What it cannot drive: a real wheel or a precision touchpad. Real input goes to the window
under the pointer on the screen, and a probe is never on the screen; a touchpad pans the
page through Direct Manipulation, which only a hand starts. The hook is the one part a
posted message never passes through, so the Rust tests in web_wheel.rs hold that it sends
a wheel over a page's input window to the page's window, once, with the keys held.

    python scripts/web-scroll-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

The exe is a probe build that never updates, built as `scripts/probe_app.py` says;
`run_probe` starts it off the screen and without the keyboard. A posted wheel is aimed by
the engine at whatever `WindowFromPoint` finds at its point, and every probe is sent to
the same corner, so the window is moved to a corner of this drive's own - still on no
screen, which is checked before it moves - and every notch is only sent once the page is
what is found there.
"""

from __future__ import annotations

import argparse
import atexit
import ctypes
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from ctypes import wintypes

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "Web scroll probe"
PORT_FROM = 23920
PORT_TO = 23939

#: The corner this drive's window is moved to: off every screen, and away from the one
#: every other probe is sent to.
CORNER = (-26000, -12000)

#: The window's size, in physical pixels: a pane of about 1190 x 720 at 200 per cent.
SIZE = (2400, 1600)

WM_MOUSEWHEEL = 0x020A
MK_CONTROL = 0x0008
NOTCH = 120

#: `SetWindowPos`: keep the size, the order and the keyboard.
SWP_NOSIZE = 0x0001
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010

#: A devtools port on every engine process the probe starts, which is how the page is
#: read, and a window off the screen drawn at full rate rather than as a window nobody
#: can see - which is what the engine otherwise takes it for, and then it draws a frame
#: when it gets round to it. The probe's own process only; nothing the app ships changes.
ENGINE_ARGS = (
    "--remote-debugging-port=0 --disable-features=CalculateNativeWinOcclusion "
    "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
)

CHROME = pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

#: The page: a striped column 40 000 pixels tall that records where it is on every frame
#: and every wheel event it hears, from `__start()` on.
PAGE = b"""<!doctype html>
<title>Scroll page</title>
<body style="margin:0;font:16px system-ui">
<div style="height:40000px;background:repeating-linear-gradient(#fff 0 50px,#ccd 50px 100px)">
</div>
<script>
window.__t = []; window.__w = []; window.__on = false
function frame() {
  if (window.__on) window.__t.push([performance.now(), scrollY])
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
addEventListener('wheel', function (event) {
  window.__w.push([performance.now(), event.deltaY])
}, { passive: true })
window.__start = function () {
  scrollTo(0, 5000); window.__t = []; window.__w = []; window.__on = true
  return scrollY
}
window.__stop = function () {
  window.__on = false
  return JSON.stringify({ t: window.__t, w: window.__w })
}
window.__size = function () {
  return JSON.stringify({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio })
}
</script>
</body>
"""

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True) if sys.platform == "win32" else None
if user32 is not None:
    # Physical pixels, which is what the engine and `WindowFromPoint` speak.
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    user32.WindowFromPoint.restype = wintypes.HWND
    user32.WindowFromPoint.argtypes = [wintypes.POINT]
    user32.GetParent.restype = wintypes.HWND
    user32.MonitorFromRect.restype = wintypes.HANDLE
    user32.MonitorFromRect.argtypes = [ctypes.POINTER(wintypes.RECT), wintypes.DWORD]
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]


def borrowed():
    """The page probe's own devtools client, and its helpers for a launch."""

    spec = importlib.util.spec_from_file_location("page_probe", HERE / "web-page-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-page-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def class_of(hwnd: int) -> str:
    assert user32 is not None
    name = ctypes.create_unicode_buffer(128)
    user32.GetClassNameW(wintypes.HWND(hwnd), name, 128)
    return name.value


def children(hwnd: int) -> list[int]:
    assert user32 is not None
    found: list[int] = []
    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumChildWindows(wintypes.HWND(hwnd), kind(lambda one, _l: found.append(one) or True), 0)
    return found


def rect(hwnd: int) -> tuple[int, int, int, int]:
    assert user32 is not None
    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    return box.left, box.top, box.right, box.bottom


def pid_of(hwnd: int) -> int:
    assert user32 is not None
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), ctypes.byref(owner))
    return owner.value


def lines_per_notch() -> int:
    """The machine's own *lines to scroll*, which is what a notch is worth in Chrome."""

    assert user32 is not None
    lines = wintypes.UINT()
    user32.SystemParametersInfoW(0x0068, 0, ctypes.byref(lines), 0)
    return lines.value


def to_corner(window: int) -> None:
    """Moves the window to this drive's own corner, which is on no screen: checked first,
    so a corner that is on one after all stops the drive instead."""

    assert user32 is not None
    left, top, right, bottom = rect(window)
    x, y = CORNER
    there = wintypes.RECT(x, y, x + right - left, y + bottom - top)
    if user32.MonitorFromRect(ctypes.byref(there), 0):
        raise SystemExit(f"{CORNER} is on a screen; pick another corner")
    user32.SetWindowPos(
        wintypes.HWND(window), None, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
    )
    time.sleep(0.5)


def page_windows(window: int) -> tuple[int, int]:
    """The site's input window and the page's own window above it: the smaller of the two
    webviews on screen is the site's, the app's own page filling the window."""

    assert user32 is not None
    shown = [
        one
        for one in children(window)
        if class_of(one) == "WRY_WEBVIEW" and user32.IsWindowVisible(wintypes.HWND(one))
    ]
    if len(shown) < 2:
        raise SystemExit(f"expected the app's page and the site's, found {len(shown)} webviews")

    def area(one: int) -> int:
        left, top, right, bottom = rect(one)
        return (right - left) * (bottom - top)

    site = min(shown, key=area)
    inputs = [one for one in children(site) if class_of(one) == "Chrome_RenderWidgetHostHWND"]
    if not inputs:
        raise SystemExit("the site's webview has no input window")
    return inputs[0], int(user32.GetParent(wintypes.HWND(inputs[0])) or 0)


def aimed_at(input_window: int) -> tuple[int, int]:
    """The middle of the input window, once `WindowFromPoint` finds that very window
    there: what the engine aims a posted wheel by."""

    assert user32 is not None
    left, top, right, bottom = rect(input_window)
    x, y = (left + right) // 2, (top + bottom) // 2
    found = int(user32.WindowFromPoint(wintypes.POINT(x, y)) or 0)
    if found != input_window:
        raise SystemExit(
            f"another window ({class_of(found)}, pid {pid_of(found)}) is over the page at "
            f"{x},{y}: another probe in this corner?"
        )
    return x, y


def notch(target: int, x: int, y: int, keys: int = 0, down: bool = True) -> None:
    """One notch of the wheel, posted the way Windows writes it."""

    assert user32 is not None
    turn = (-NOTCH if down else NOTCH) & 0xFFFF
    user32.PostMessageW(
        wintypes.HWND(target), WM_MOUSEWHEEL, (turn << 16) | keys, ((y & 0xFFFF) << 16) | (x & 0xFFFF)
    )


def traced(tools, send) -> dict[str, object]:
    """What the page did after `send`: wheel events heard, distance, frames with movement,
    how long it moved for, and where it was on each of those frames."""

    tools.value("__start()")
    time.sleep(0.4)
    send()
    time.sleep(1.2)
    said = json.loads(str(tools.value("__stop()")))
    frames = said["t"]
    if not frames:
        return {"events": len(said["w"]), "distance": None}
    first = frames[0][1]
    moving = [(at, where) for (at, where), (_, before) in zip(frames[1:], frames) if where != before]
    return {
        "events": len(said["w"]),
        "distance": round(frames[-1][1] - first, 1),
        "frames": len(moving),
        "ms": round(moving[-1][0] - moving[0][0]) if len(moving) > 1 else 0,
        "curve": [round(where - first, 1) for _, where in moving],
    }


def zoom_steps(tools, send) -> float:
    """How far one `send` zooms the page, in steps of Chrome's ladder near 100 per cent:
    90 and 80 per cent are one and two steps out."""

    before = json.loads(str(tools.value("__size()")))["dpr"]
    send()
    time.sleep(1.0)
    after = json.loads(str(tools.value("__size()")))["dpr"]
    ladder = [1.0, 0.9, 0.8, 0.75, 0.67]
    ratio = after / before
    return float(min(range(len(ladder)), key=lambda step: abs(ladder[step] - ratio)))


def threads_named(pid: int, name: str) -> int:
    """How many threads of the process carry `name`, which Rust gives a thread it spawns."""

    assert kernel32 is not None

    class ThreadEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ThreadID", wintypes.DWORD),
            ("th32OwnerProcessID", wintypes.DWORD),
            ("tpBasePri", wintypes.LONG),
            ("tpDeltaPri", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
        ]

    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.OpenThread.restype = wintypes.HANDLE
    kernel32.GetThreadDescription.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_wchar_p)]
    snapshot = kernel32.CreateToolhelp32Snapshot(0x00000004, 0)
    entry = ThreadEntry()
    entry.dwSize = ctypes.sizeof(ThreadEntry)
    count = 0
    more = kernel32.Thread32First(snapshot, ctypes.byref(entry))
    while more:
        if entry.th32OwnerProcessID == pid:
            # THREAD_QUERY_INFORMATION: the limited right is refused a description.
            handle = kernel32.OpenThread(0x0040, False, entry.th32ThreadID)
            if handle:
                described = ctypes.c_wchar_p()
                kernel32.GetThreadDescription(handle, ctypes.byref(described))
                if described.value is not None:
                    count += described.value == name
                    kernel32.LocalFree(described)
                kernel32.CloseHandle(handle)
        more = kernel32.Thread32Next(snapshot, ctypes.byref(entry))
    kernel32.CloseHandle(snapshot)
    return count


def serve() -> tuple[http.server.ThreadingHTTPServer, int]:
    import socket

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *_args: object) -> None:
            return

    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server, port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def chrome_reference(port: int, width: int, height: int, pixels: float) -> dict[str, object]:
    """Chrome, headless, at the pane's size and the screen's scale, handed one notch."""

    page_probe = borrowed()
    data = pathlib.Path(tempfile.mkdtemp(prefix="nib-scroll-chrome-"))
    chrome = subprocess.Popen(
        [
            str(CHROME),
            "--headless=new",
            f"--user-data-dir={data}",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--no-default-browser-check",
            "--force-device-scale-factor=2",
            "--disable-renderer-backgrounding",
            f"--window-size={width},{height}",
            f"http://127.0.0.1:{port}/page",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        url = None
        until = time.perf_counter() + 30
        while url is None and time.perf_counter() < until:
            time.sleep(0.5)
            written = data / "DevToolsActivePort"
            if not written.exists():
                continue
            try:
                debug = int(written.read_text().split()[0])
                with urllib.request.urlopen(f"http://127.0.0.1:{debug}/json/list", timeout=5) as said:
                    for one in json.loads(said.read()):
                        if one.get("type") == "page" and str(one.get("url", "")).endswith("/page"):
                            url = str(one["webSocketDebuggerUrl"])
            except (OSError, ValueError, IndexError):
                continue
        if url is None:
            return {"error": "Chrome never opened the page"}
        tools = page_probe.Devtools(url)
        try:
            # A page takes no wheel until it has drawn: one to wake it, then the one kept.
            time.sleep(1.5)
            traced(tools, lambda: wheel_in_engine(tools, pixels))
            return traced(tools, lambda: wheel_in_engine(tools, pixels))
        finally:
            tools.close()
    finally:
        chrome.terminate()
        try:
            chrome.wait(timeout=20)
        except subprocess.TimeoutExpired:
            chrome.kill()
        shutil.rmtree(data, ignore_errors=True)


def wheel_in_engine(tools, pixels: float) -> None:
    """A wheel of `pixels`, handed to the engine past the platform: the path a notch takes
    once Windows' message has become one, which is where the animation happens."""

    tools.call(
        "Input.emulateTouchFromMouseEvent",
        {"type": "mouseWheel", "x": 300, "y": 300, "button": "none", "deltaX": 0, "deltaY": -pixels},
    )


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    page_probe = borrowed()
    page_probe.wipe(args.identifier)
    server, port = serve()

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-scroll-probe-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    space = root / SPACE
    space.mkdir(parents=True)
    (space / "Idea.md").write_text("# Idea\n\nA note to open the space on.\n", encoding="utf-8")
    (space / "Scroll page.url").write_text(
        page_probe.shortcut(f"http://127.0.0.1:{port}/page", "Scroll page"), encoding="utf-8"
    )

    lines = lines_per_notch()
    pixels = round(lines * 100 / 3, 2)
    said: dict[str, object] = {"lines per notch": lines, "Chrome's notch in pixels": pixels}
    env = {**os.environ, "NIB_SPACES_DIR": str(root), "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": ENGINE_ARGS}
    running = run_probe(args.exe, env=env, quiet=True)
    size: dict[str, object] = {}
    try:
        endpoint_port, secret, _ = page_probe.endpoint(args.identifier)
        app = page_probe.App(endpoint_port, secret)
        window = 0
        until = time.perf_counter() + 90
        while not window and time.perf_counter() < until:
            window = main_window(running.pid)
            time.sleep(0.2)
        if not window:
            raise SystemExit("the app never showed its window")
        sized(window, *SIZE)
        to_corner(window)

        said["hook before a page"] = threads_named(running.pid, "wheel")
        app.act("open", {"path": "Scroll page.url", "space": SPACE})
        time.sleep(6)
        said["hook with a page"] = threads_named(running.pid, "wheel")

        input_window, page_window = page_windows(window)
        x, y = aimed_at(input_window)
        url = None
        until = time.perf_counter() + 30
        while url is None and time.perf_counter() < until:
            url = page_probe.page_socket(args.identifier, "/page")
            time.sleep(0.5)
        if url is None:
            raise SystemExit("the page's devtools never answered")
        tools = page_probe.Devtools(url)
        try:
            size = json.loads(str(tools.value("__size()")))
            said["pane"] = size
            said["a notch at the input window"] = traced(tools, lambda: notch(input_window, x, y))
            said["a notch at the page's window"] = traced(tools, lambda: notch(page_window, x, y))
            said["three notches at the page's window"] = traced(
                tools, lambda: [notch(page_window, x, y) or time.sleep(0.03) for _ in range(3)]
            )
            said["the engine's animation of one notch"] = traced(
                tools, lambda: wheel_in_engine(tools, pixels)
            )
            doubled = zoom_steps(tools, lambda: notch(input_window, x, y, MK_CONTROL))
            said["Ctrl+wheel steps at the input window"] = doubled
            # Back to a hundred per cent, where one notch is one step.
            for _ in range(round(doubled)):
                notch(page_window, x, y, MK_CONTROL, down=False)
                time.sleep(0.4)
            said["Ctrl+wheel steps at the page's window"] = zoom_steps(
                tools, lambda: notch(page_window, x, y, MK_CONTROL)
            )
        finally:
            tools.close()
    finally:
        if not close_app(running):
            running.terminate()
        server.shutdown()

    width = int(size.get("width", 1187)) if isinstance(size, dict) else 1187
    height = int(size.get("height", 718)) if isinstance(size, dict) else 718
    server, port = serve()
    try:
        said["Chrome"] = chrome_reference(port, width, height, pixels)
    finally:
        server.shutdown()

    print(json.dumps(said, indent=2))
    table = [
        ("", "events", "px", "frames", "ms"),
        ("input window (keyboard elsewhere)", *row(said["a notch at the input window"])),
        ("page's window (web_wheel.rs)", *row(said["a notch at the page's window"])),
        ("nib engine, one notch", *row(said["the engine's animation of one notch"])),
        ("Chrome 153, one notch", *row(said["Chrome"])),
    ]
    for line in table:
        print(f"{line[0]:<36}" + "".join(f"{str(cell):>9}" for cell in line[1:]))

    single = said["a notch at the page's window"]
    chrome = said["Chrome"]
    failed = []
    if not isinstance(single, dict) or single.get("events") != 1:
        failed.append("the page's window heard other than one wheel for one notch")
    if isinstance(single, dict) and isinstance(chrome, dict):
        if abs(float(single.get("distance") or 0) - float(chrome.get("distance") or 0)) > 2:
            failed.append("a notch at the page's window is not Chrome's distance")
    if said["hook with a page"] != 1:
        failed.append("the wheel thread is not running once a page is open")
    for one in failed:
        print(f"FAIL: {one}")
    return 1 if failed else 0


def row(measured: object) -> tuple[object, ...]:
    if not isinstance(measured, dict):
        return ("?", "?", "?", "?")
    return (
        measured.get("events", "-"),
        measured.get("distance", "?"),
        measured.get("frames", "?"),
        measured.get("ms", "?"),
    )


if __name__ == "__main__":
    raise SystemExit(main())
