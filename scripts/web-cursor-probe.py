"""Does the pointer stay on screen over a web page after somebody types? Windows only.

Emil, 2026-09-28: *"manchmal habe ich einfach keinen mouse cursor waehrend ich im
browser bin. dann muss ich ihn aus dem browserfenster raus und dann wieder rein
bewegen"* - sometimes there is no pointer over a web tab, and it only comes back after
leaving the page and coming back in.

What it was: `WebView2`'s Chromium hides the pointer while somebody types, honouring
Windows' *Hide pointer while typing* (`SPI_GETMOUSEVANISH`, on by default). It hides with
`ShowCursor(FALSE)` on its own UI thread and shows it again on the next mouse event *it*
receives. The count `ShowCursor` moves is the input queue's, and every thread with a
window in nib's window shares one queue: the window's own, the app page's browser
process and the web pages' browser process - two processes, because the pages keep a
profile the app's session is not in. So a hide in one process is a pointer gone over the
whole window, and only a mouse event over that same process brings it back. Type an
address with the pointer resting over the page, and moving it about the page does
nothing: the page's process never hid it, and the app's process never hears the mouse.

This drive measures exactly that count, and never touches the real mouse or keyboard:

* **the level** is read by attaching this thread to the window's input queue for the two
  calls it takes - `ShowCursor(TRUE)` then `ShowCursor(FALSE)` - which add nothing and
  answer the queue's count. Below nought, the pointer is hidden over every window of the
  app wherever it is.
* **typing** is a key posted to the one engine window, with an editable focused in it:
  the address field in the app's own page, an `<input>` in the site's.
* **the pointer** is a `WM_MOUSEMOVE` posted to the window it would be over.

    python scripts/web-cursor-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says. Before the fix a line reads `level after
moving over the page: -1`; after it every level is nought.
"""

from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import pathlib
import shutil
import sys
import time
from ctypes import wintypes

from probe_app import close_app, main_window

HERE = pathlib.Path(__file__).resolve().parent

WM_KEYDOWN = 0x0100
WM_KEYUP = 0x0101
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN = 0x0201
WM_LBUTTONUP = 0x0202

PAGE = b"""<!doctype html>
<title>A form</title>
<body style="margin:0;font:16px system-ui;background:#eef">
<input id="field" autofocus style="margin:2rem;font-size:20px"
  onfocus="document.title = 'focused'" oninput="document.title = this.value">
<div style="height:2000px"></div>
</body>
"""

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
kernel32 = ctypes.WinDLL("kernel32") if sys.platform == "win32" else None


def borrowed():
    """The switch probe's own helpers: the space, the launch, the endpoint, `eval`."""

    spec = importlib.util.spec_from_file_location("switch", HERE / "web-switch-probe.py")
    if spec is None or spec.loader is None:
        raise SystemExit("could not read web-switch-probe.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def class_of(hwnd: int) -> str:
    assert user32 is not None
    name = ctypes.create_unicode_buffer(128)
    user32.GetClassNameW(wintypes.HWND(hwnd), name, 128)
    return name.value


def children(hwnd: int) -> list[int]:
    """Every window under this one, at any depth."""

    assert user32 is not None
    found: list[int] = []

    def each(child: int, _lparam: int) -> bool:
        found.append(child)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumChildWindows(wintypes.HWND(hwnd), kind(each), 0)
    return found


def engines(window: int) -> list[tuple[int, int, bool]]:
    """Each webview in the window: its container, the engine window that takes its input,
    and whether it is on screen. The first is the app's own page, which fills the window."""

    assert user32 is not None
    made = []
    for one in children(window):
        if class_of(one) != "WRY_WEBVIEW":
            continue
        inside = [child for child in children(one) if class_of(child) == "Chrome_WidgetWin_1"]
        if inside:
            made.append((one, inside[0], bool(user32.IsWindowVisible(wintypes.HWND(one)))))
    return made


def area(hwnd: int) -> int:
    assert user32 is not None
    box = wintypes.RECT()
    user32.GetWindowRect(wintypes.HWND(hwnd), ctypes.byref(box))
    return (box.right - box.left) * (box.bottom - box.top)


def thread_of(hwnd: int) -> int:
    assert user32 is not None
    return int(user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), None))


def level(window: int) -> int:
    """The window's input queue's pointer count, read without changing it."""

    assert user32 is not None and kernel32 is not None
    mine = kernel32.GetCurrentThreadId()
    theirs = thread_of(window)
    if not user32.AttachThreadInput(mine, theirs, True):
        raise SystemExit("could not attach to the window's input queue")
    try:
        user32.ShowCursor(True)
        return int(user32.ShowCursor(False))
    finally:
        user32.AttachThreadInput(mine, theirs, False)


def hidden_elsewhere(window: int) -> int:
    """The level while another thread on the same queue has hidden the pointer: what the
    reading says when somebody else's `ShowCursor(FALSE)` is in force, which is the
    reading's own proof that it sees the whole queue and not one thread."""

    import threading

    assert user32 is not None and kernel32 is not None
    theirs = thread_of(window)
    hid = threading.Event()
    done = threading.Event()

    def hide() -> None:
        mine = kernel32.GetCurrentThreadId()
        user32.AttachThreadInput(mine, theirs, True)
        user32.ShowCursor(False)
        hid.set()
        done.wait(10)
        user32.ShowCursor(True)
        user32.AttachThreadInput(mine, theirs, False)

    other = threading.Thread(target=hide)
    other.start()
    hid.wait(10)
    try:
        return level(window)
    finally:
        done.set()
        other.join()


def focus(engine: int) -> None:
    """The keyboard focus of the window's own queue, put on one engine window.

    From a thread attached to that queue, which is the one way to reach another
    process's focus without making its window the foreground: the reader's own window
    stays in front and keeps their keyboard. The engine hides the pointer only for a key
    typed into something editable in the view that has the focus, so this is what makes a
    posted key count as typing."""

    assert user32 is not None and kernel32 is not None
    mine = kernel32.GetCurrentThreadId()
    theirs = thread_of(engine)
    user32.AttachThreadInput(mine, theirs, True)
    try:
        user32.SetFocus(wintypes.HWND(engine))
    finally:
        user32.AttachThreadInput(mine, theirs, False)
    time.sleep(0.3)


def type_into(engine: int, letters: str) -> None:
    """Keys, posted to the engine window the way the keyboard would deliver them, with
    the focus on it first. Down and up only: the engine's own loop translates a key
    into the character it types, as it does for a real one."""

    assert user32 is not None
    focus(engine)
    for letter in letters:
        vk = ord(letter.upper())
        user32.PostMessageW(wintypes.HWND(engine), WM_KEYDOWN, vk, 0x0000_0001)
        user32.PostMessageW(wintypes.HWND(engine), WM_KEYUP, vk, 0xC000_0001)
        time.sleep(0.05)
    time.sleep(0.4)


def press(engine: int, x: int, y: int) -> None:
    """A click, posted to an engine window at a point in its own client pixels."""

    assert user32 is not None
    at = (y << 16) | x
    user32.PostMessageW(wintypes.HWND(engine), WM_MOUSEMOVE, 0, at)
    user32.PostMessageW(wintypes.HWND(engine), WM_LBUTTONDOWN, 0x0001, at)
    user32.PostMessageW(wintypes.HWND(engine), WM_LBUTTONUP, 0, at)
    time.sleep(0.4)


def move_over(engine: int, steps: int = 6) -> None:
    """The pointer moving about inside an engine window, in its own client pixels."""

    assert user32 is not None
    for step in range(steps):
        x, y = 120 + step * 17, 140 + step * 11
        user32.PostMessageW(wintypes.HWND(engine), WM_MOUSEMOVE, 0, (y << 16) | x)
        time.sleep(0.05)
    time.sleep(0.4)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch = borrowed()
    switch.wipe(args.identifier)
    port = switch.free_port()

    import http.server
    import threading

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "A form.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{port}/form", "A form"), encoding="utf-8"
    )

    said: dict[str, object] = {}
    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        # The window is built hidden until its page is there, and the page waits for the
        # last run's engine to let go of the profile, which can take a while.
        window = 0
        until = time.perf_counter() + 90
        while not window and time.perf_counter() < until:
            window = main_window(running.pid)
            time.sleep(0.2)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("A form.url")
        time.sleep(6)

        if not window:
            raise SystemExit("the app never showed its window")
        found = engines(window)
        shown = [one for one in found if one[2]]
        if len(shown) != 2:
            raise SystemExit(f"expected the app's page and the site's on screen, found {found}")
        # The app's own page fills the window; the site's sits in the pane, smaller.
        shown.sort(key=lambda one: -area(one[0]))
        ours, page = shown[0][1], shown[1][1]
        said["threads share one queue"] = {
            "window": thread_of(window),
            "app page": thread_of(ours),
            "site": thread_of(page),
        }
        said["level at rest"] = level(window)
        said["level while another thread hides it"] = hidden_elsewhere(window)
        said["level once it shows it again"] = level(window)

        # 1. Typing in the app's own page - the address field - with the pointer resting
        #    over the site, which is where it is after Ctrl+L or Ctrl+T.
        app.ask("document.querySelector('.webbar input.nib-field')?.focus()")
        time.sleep(0.3)
        type_into(ours, "moodle")
        said["level after typing in the address field"] = level(window)
        said["what the field holds"] = app.ask(
            "JSON.stringify(document.querySelector('.webbar input.nib-field')?.value ?? null)"
        )
        move_over(page)
        said["level after moving over the page"] = level(window)
        move_over(ours)
        said["level after moving over the app"] = level(window)

        # 2. The other way round: typing in the site, then the page goes out of sight
        #    under the pointer - an overlay, a tab switch - and the pointer moves over
        #    the app's own page.
        app.ask("document.querySelector('.webbar input.nib-field')?.blur()")
        focus(page)
        press(page, 60, 45)
        type_into(page, "hello")
        said["level after typing in the page"] = level(window)
        said["what the page heard"] = app.ask(
            "JSON.stringify(document.querySelector('.webbar input.nib-field')?.value ?? null)"
        )
        # A tab switch, from the window's own keys: the page is hidden where it was,
        # and what is under the pointer now is the app's own page and nothing else.
        app.open("Idea.md")
        time.sleep(1.5)
        move_over(ours)
        said["level after moving over a note the page gave way to"] = level(window)
        app.open("A form.url")
        time.sleep(1.5)
        move_over(page)
        said["level after moving over the page again"] = level(window)
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print(json.dumps(said, indent=2))
    stuck = [
        name
        for name, value in said.items()
        if isinstance(value, int) and value < 0 and name != "level while another thread hides it"
    ]
    if stuck:
        print(f"FAIL: the pointer is hidden at {stuck}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
