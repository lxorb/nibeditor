"""What every drive of a native probe build shares: the build it may launch, and the one
window of it that is the app's.

Not a drive. Imported by name, which works because Python puts a script's own folder
first on the path: `from probe_app import run_probe, main_window, close_app`.

**A probe is never in front of anybody.** Somebody is working at the machine a drive runs
on, and a window that pops up in their face - or takes their typing - is a drive that
interrupted them. So every probe is started by `run_probe`, which sets `NIB_OFF_SCREEN`:
the app then builds each of its windows hidden, sends it off the screen, and shows it
there without bringing it forward (see `built_away` in src-tauri/src/placement.rs). And
`run_probe` checks: from the moment the process exists it watches every window the process
owns, and one that is ever visible on a screen, or ever the window in front, ends the
app and the drive at once. A drive that wants the window a size of its own gives it one
with `sized`, which leaves it where it is.

**A probe build never updates.** A release build looks for a new version as it starts,
downloads it, and runs the installer as it closes - over the reader's own nib, which is
what probes that ignored this did on 2026-09-27. So a probe is built as a version no
release passes, looking for updates on a loopback port nothing listens on:

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.<name>","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'

An `http://` endpoint would not do: the updater refuses it, and the app exits 1. The
version is what `refuse_updating` reads back off the exe, so a build made without the
two is never launched.

**The app's window, and only that.** tao keeps a window of its own on the event loop's
thread, visible to `EnumWindows` though never drawn. Closing it breaks the loop, and
the app then never quits; so closing every window the process owns only ever looked
like a quit while the updater's installer was there to kill the app.
"""

from __future__ import annotations

import ctypes
import os
import pathlib
import subprocess
import sys
import threading
import time
from ctypes import wintypes

#: The version a probe is built as; see the module's own docs.
PROBE_VERSION = "99.0.0"

#: What a window is sent when its close button is pressed.
WM_CLOSE = 0x0010

#: The class of every window Tauri makes. tao's event-loop window has one of its own.
APP_CLASS = "Tauri Window"

#: What the app reads to open every window off the screen; see src-tauri/src/placement.rs.
OFF_SCREEN = "NIB_OFF_SCREEN"

#: How often the watch looks, in seconds: well inside one frame of the screen's.
LOOK_EVERY = 0.002

#: `STARTUPINFO`'s say in the first window a process shows: without coming forward,
#: which holds even for a build from before the app did so itself.
STARTF_USESHOWWINDOW = 0x0001
SW_SHOWNOACTIVATE = 4

#: `SetWindowPos`: keep the place, the order and the keyboard.
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010

#: Windows the process keeps for messages alone: visible by their style and 13 pixels
#: square in the corner of the primary screen, and never drawn. tao's event loop has one,
#: and the single instance plugin one named after the identifier with `-sic` on the end.
UNDRAWN = frozenset({"Tao Thread Event Target"})
UNDRAWN_SUFFIX = "-sic"

#: `MonitorFromRect`: no screen at all where the rectangle is on none.
MONITOR_DEFAULTTONULL = 0

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
if user32 is not None:
    user32.MonitorFromRect.restype = wintypes.HANDLE
    user32.MonitorFromRect.argtypes = [ctypes.POINTER(wintypes.RECT), wintypes.DWORD]
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]


def version_of(exe: pathlib.Path) -> str:
    """The version the exe was built as, off its own version resource - which is the
    configuration's `version`, `--config` included."""

    library = ctypes.WinDLL("version")
    library.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, wintypes.LPDWORD]
    library.GetFileVersionInfoW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.c_void_p,
    ]
    library.VerQueryValueW.argtypes = [
        ctypes.c_void_p,
        wintypes.LPCWSTR,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.POINTER(wintypes.UINT),
    ]

    size = library.GetFileVersionInfoSizeW(str(exe), None)
    if not size:
        return ""
    data = ctypes.create_string_buffer(size)
    if not library.GetFileVersionInfoW(str(exe), 0, size, data):
        return ""
    fixed = ctypes.c_void_p()
    length = wintypes.UINT()
    if not library.VerQueryValueW(data, "\\", ctypes.byref(fixed), ctypes.byref(length)):
        return ""
    # VS_FIXEDFILEINFO: a signature, a structure version, then the file version's two
    # halves, major.minor and patch.build.
    info = ctypes.cast(fixed, ctypes.POINTER(wintypes.DWORD * 4)).contents
    return f"{info[2] >> 16}.{info[2] & 0xFFFF}.{info[3] >> 16}"


def refuse_updating(exe: pathlib.Path) -> None:
    """Stops the drive before it launches a build that would update itself."""

    found = version_of(exe)
    if found != PROBE_VERSION:
        raise SystemExit(
            f"{exe} is version {found or 'unknown'}, not {PROBE_VERSION}: it would fetch the "
            "real update and install it on close. Build it as scripts/probe_app.py says."
        )


def main_window(pid: int) -> int:
    """The app's own window in this process, or 0 while it has none on screen."""

    assert user32 is not None
    found: list[int] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid or not user32.IsWindowVisible(hwnd):
            return True
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        if name.value == APP_CLASS:
            found.append(hwnd)
            return False
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return found[0] if found else 0


def close_app(app: subprocess.Popen[bytes], seconds: float = 30) -> bool:
    """Closes the app's window the way a person does, and waits for the process to end.

    Not `terminate`, which is the task manager's kill: the engine then gets no word that
    the app is going. False if there was no window to close or the app outlived the
    wait; the process is left running for the caller to end."""

    assert user32 is not None
    hwnd = main_window(app.pid)
    if not hwnd:
        return False
    user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    try:
        app.wait(timeout=seconds)
    except subprocess.TimeoutExpired:
        return False
    return True


def run_probe(
    exe: pathlib.Path,
    env: dict[str, str] | None = None,
    quiet: bool = False,
) -> subprocess.Popen[bytes]:
    """Starts a probe build off the screen and without the keyboard, and watches that it
    stays there for as long as it runs.

    `env` is the whole environment, `os.environ` where it is not given, and it must name
    `NIB_SPACES_DIR`: a probe that opened the reader's own notes is as bad as one that
    opened in front of them. `quiet` sends the app's own output nowhere."""

    refuse_updating(exe)
    environment = {**(os.environ if env is None else env), OFF_SCREEN: "1"}
    if not environment.get("NIB_SPACES_DIR"):
        raise SystemExit("a probe is launched with NIB_SPACES_DIR in a temp folder, never without")

    shown = subprocess.STARTUPINFO()
    shown.dwFlags |= STARTF_USESHOWWINDOW
    shown.wShowWindow = SW_SHOWNOACTIVATE
    output = subprocess.DEVNULL if quiet else None
    app = subprocess.Popen(
        [str(exe)],
        env=environment,
        cwd=str(exe.parent),
        startupinfo=shown,
        stdout=output,
        stderr=output,
    )
    threading.Thread(target=_watch, args=(app,), name="off-screen watch", daemon=True).start()
    return app


def in_view(pid: int) -> str:
    """What of this process is in front of somebody: a window of it visible on a screen,
    or the window in front. Empty where there is nothing."""

    assert user32 is not None
    found: list[str] = []
    front = user32.GetForegroundWindow()

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid:
            return True
        box = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(box))
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        if hwnd == front:
            found.append(f"window 0x{hwnd:X} is the window in front")
        elif name.value in UNDRAWN or name.value.endswith(UNDRAWN_SUFFIX):
            pass
        elif (
            user32.IsWindowVisible(hwnd)
            and box.right > box.left
            and box.bottom > box.top
            and user32.MonitorFromRect(ctypes.byref(box), MONITOR_DEFAULTTONULL)
        ):
            found.append(
                f"window 0x{hwnd:X} is on a screen at {box.left},{box.top} "
                f"{box.right - box.left}x{box.bottom - box.top}"
            )
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return "; ".join(found)


def _watch(app: subprocess.Popen[bytes]) -> None:
    """Looks every couple of milliseconds from the moment the process exists until it
    ends, and ends the app and the whole drive the moment any of it is in view: loudly,
    and without the drive's own clean-up, which is time the window would stay there."""

    started = time.perf_counter()
    while app.poll() is None:
        seen = in_view(app.pid)
        if seen:
            app.kill()
            after = (time.perf_counter() - started) * 1000
            print(
                f"PROBE IN VIEW after {after:.0f} ms: {seen}. Killed pid {app.pid}; this "
                "build or drive puts a window in front of somebody. See scripts/probe_app.py.",
                file=sys.stderr,
            )
            sys.stderr.flush()
            os._exit(3)
        time.sleep(LOOK_EVERY)


def sized(hwnd: int, width: int, height: int) -> None:
    """Gives a window a size and leaves it where it is - off the screen - without
    touching which window is in front or has the keyboard."""

    assert user32 is not None
    user32.SetWindowPos(
        hwnd, None, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
    )
