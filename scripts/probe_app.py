"""What every drive of a native probe build shares: the build it may launch, and the one
window of it that is the app's.

Not a drive. Imported by name, which works because Python puts a script's own folder
first on the path: `from probe_app import refuse_updating, main_window, close_app`.

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
import pathlib
import subprocess
import sys
from ctypes import wintypes

#: The version a probe is built as; see the module's own docs.
PROBE_VERSION = "99.0.0"

#: What a window is sent when its close button is pressed.
WM_CLOSE = 0x0010

#: The class of every window Tauri makes. tao's event-loop window has one of its own.
APP_CLASS = "Tauri Window"

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None


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
