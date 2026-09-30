"""What every drive of a native probe build shares: the build it may launch, and the one
window of it that is the app's.

Not a drive. Imported by name, which works because Python puts a script's own folder
first on the path: `from probe_app import run_probe, main_window, close_app`.

**A probe is never in front of anybody.** Somebody is working at the machine a drive runs
on, and a window that pops up in their face - or takes their typing - is a drive that
interrupted them. So every probe is started by `run_probe`, which sets `NIB_OFF_SCREEN`:
the app then builds each of its windows hidden, sends it off the screen, and shows it
there without bringing it forward (see `built_away` in src-tauri/src/placement.rs). And
`run_probe` checks: from the moment the process exists it watches every window of the
app **and of every process under it** - the engine's browser, its renderers, its GPU
process - and one that is ever visible on a screen, or ever the window in front, ends
the whole family and the drive at once. The engine's own because a `<select>`'s list, a
date picker, a dialog or a popup a page raises is a window of an engine process, not of
the app, and the app's own watch never saw one (docs/agent-native.md 6.5). A drive that
wants the window a size of its own gives it one with `sized`, which leaves it where it is.

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

**What the watch decides is a pure function** (`in_view`, over a `Look`), so it is tested
with windows and screens that are only numbers - apps/desktop/test/agents/watch_test.py -
and never by putting a real window on a screen to see whether it is caught.
"""

from __future__ import annotations

import ctypes
import os
import pathlib
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Collection, Iterable, Mapping, Sequence
from ctypes import wintypes
from dataclasses import dataclass
from typing import Any

#: The version a probe is built as; see the module's own docs.
PROBE_VERSION = "99.0.0"

#: What a window is sent when its close button is pressed.
WM_CLOSE = 0x0010

#: The class of every window Tauri makes. tao's event-loop window has one of its own.
APP_CLASS = "Tauri Window"

#: What the app reads to open every window off the screen; see src-tauri/src/placement.rs.
OFF_SCREEN = "NIB_OFF_SCREEN"

#: How often the watch looks, in seconds: inside one frame of a 240 Hz screen, and slow
#: enough that walking every window on the desktop leaves the machine a core.
LOOK_EVERY = 0.004

#: How often the watch asks again which processes are the app's. An engine process is
#: started well before it can have a window, so this is not a gap a window fits through.
FAMILY_EVERY = 0.25

#: How long the family is still watched after the app has ended: an engine process can
#: outlive its host by a moment, and a window it shows in that moment is still somebody's.
AFTERLIFE = 2.0

#: The exit code of a drive the watch ended.
IN_VIEW_EXIT = 3

#: `STARTUPINFO`'s say in the first window a process shows: without coming forward,
#: which holds even for a build from before the app did so itself.
STARTF_USESHOWWINDOW = 0x0001
SW_SHOWNOACTIVATE = 4

#: `SetWindowPos`: keep the place, the order and the keyboard.
SWP_NOMOVE = 0x0002
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010

#: Windows a process keeps for messages alone: visible by their style and 13 pixels
#: square in the corner of the primary screen, and never drawn. tao's event loop has one,
#: and the single instance plugin one named after the identifier with `-sic` on the end.
UNDRAWN = frozenset({"Tao Thread Event Target"})
UNDRAWN_SUFFIX = "-sic"

#: Every rectangle here is in the screen's own pixels, whatever the scale of the screen,
#: because the watch thread says it can read them that way.
DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4

#: `CreateToolhelp32Snapshot`: every process, with its parent.
TH32CS_SNAPPROCESS = 0x00000002
#: `OpenProcess`: enough to ask when a process started, and to end one.
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_TERMINATE = 0x0001
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

user32 = ctypes.WinDLL("user32", use_last_error=True) if sys.platform == "win32" else None
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True) if sys.platform == "win32" else None
if user32 is not None and kernel32 is not None:
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
    user32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
    user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.GetProcessTimes.argtypes = [wintypes.HANDLE, *[ctypes.POINTER(wintypes.FILETIME)] * 4]


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
    args: Sequence[str] = (),
    piped: bool = False,
) -> subprocess.Popen[bytes]:
    """Starts a probe build off the screen and without the keyboard, and watches that it
    and every process under it stay there for as long as they run.

    `env` is the whole environment, `os.environ` where it is not given, and it must name
    `NIB_SPACES_DIR`: a probe that opened the reader's own notes is as bad as one that
    opened in front of them. `quiet` sends the app's own output nowhere. `args` is the
    command line after the program, the way the system writes one for a link or a file:
    a second launch hands it to the probe already running and exits, watched all the
    same. `piped` hands the drive the process's stdin and stdout, which is how `nib mcp`
    is spoken to."""

    refuse_updating(exe)
    environment = {**(os.environ if env is None else env), OFF_SCREEN: "1"}
    if not environment.get("NIB_SPACES_DIR"):
        raise SystemExit("a probe is launched with NIB_SPACES_DIR in a temp folder, never without")

    shown = subprocess.STARTUPINFO()
    shown.dwFlags |= STARTF_USESHOWWINDOW
    shown.wShowWindow = SW_SHOWNOACTIVATE
    output = subprocess.DEVNULL if quiet else None
    app = subprocess.Popen(
        [str(exe), *args],
        env=environment,
        cwd=str(exe.parent),
        startupinfo=shown,
        stdin=subprocess.PIPE if piped else None,
        stdout=subprocess.PIPE if piped else output,
        stderr=output,
    )
    threading.Thread(target=_watch, args=(app,), name="off-screen watch", daemon=True).start()
    return app


# ---- the watch: what is in view, decided over numbers ----


@dataclass(frozen=True)
class Seen:
    """One top-level window: whose it is, what kind, whether it is shown, and where, as
    left, top, right and bottom in the screen's own pixels."""

    hwnd: int
    pid: int
    kind: str
    visible: bool
    box: tuple[int, int, int, int]


@dataclass(frozen=True)
class Look:
    """Everything on the desktop at one moment: its windows, the one in front, and the
    screens, each a rectangle as a window's is."""

    windows: tuple[Seen, ...]
    front: int
    screens: tuple[tuple[int, int, int, int], ...]


def on_a_screen(box: tuple[int, int, int, int], screens: Iterable[tuple[int, int, int, int]]) -> bool:
    """Whether any pixel of the rectangle is on any screen, which is what `MonitorFromRect`
    answers with no default. A screen left of the primary one has negative coordinates,
    and one above it too; a rectangle with no area is on none."""

    left, top, right, bottom = box
    if right <= left or bottom <= top:
        return False
    return any(
        left < s_right and s_left < right and top < s_bottom and s_top < bottom
        for s_left, s_top, s_right, s_bottom in screens
    )


def in_view(look: Look, pids: Collection[int]) -> list[str]:
    """What of these processes is in front of somebody: a window of theirs that is the
    window in front, whatever it is and wherever, or one visible on a screen. Empty where
    there is nothing."""

    found: list[str] = []
    for one in look.windows:
        if one.pid not in pids:
            continue
        left, top, right, bottom = one.box
        where = f"{left},{top} {right - left}x{bottom - top}"
        if one.hwnd == look.front:
            found.append(f"{one.kind} 0x{one.hwnd:X} of pid {one.pid} is the window in front, at {where}")
        elif one.kind in UNDRAWN or one.kind.endswith(UNDRAWN_SUFFIX):
            continue
        elif one.visible and on_a_screen(one.box, look.screens):
            found.append(f"{one.kind} 0x{one.hwnd:X} of pid {one.pid} is on a screen at {where}")
    return found


def descendants(root: int, parents: Mapping[int, int], born: Callable[[int], int | None]) -> set[int]:
    """The process and every process under it, from each process's parent.

    A child has to have started after its parent, because a parent's number is free for
    anybody once it has ended: a process whose parent died long ago names a number the app
    may have been handed since, and without this the reader's own explorer could be
    counted as the probe's and a window of theirs taken for the probe's."""

    found = {root}
    waiting = [root]
    while waiting:
        parent = waiting.pop()
        started = born(parent)
        for child, its in parents.items():
            if its != parent or child in found or child == parent:
                continue
            when = born(child)
            if started is not None and when is not None and when >= started:
                found.add(child)
                waiting.append(child)
    return found


# ---- the watch: the operating system's side ----


class _Entry(ctypes.Structure):
    """`PROCESSENTRY32W`."""

    _fields_ = [
        ("dwSize", wintypes.DWORD),
        ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD),
        ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wintypes.DWORD),
        ("szExeFile", ctypes.c_wchar * 260),
    ]


def parents() -> dict[int, int]:
    """Every process on the machine, by number, with its parent's number."""

    assert kernel32 is not None
    snapshot = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if not snapshot or snapshot == INVALID_HANDLE_VALUE:
        return {}
    found: dict[int, int] = {}
    try:
        entry = _Entry()
        entry.dwSize = ctypes.sizeof(_Entry)
        more = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        while more:
            found[entry.th32ProcessID] = entry.th32ParentProcessID
            more = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)
    return found


def born(pid: int) -> int | None:
    """When a process started, in the system's hundred-nanosecond ticks, or None for one
    that has ended or may not be asked."""

    assert kernel32 is not None
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return None
    try:
        created, ended, kernel, user = (wintypes.FILETIME() for _ in range(4))
        if not kernel32.GetProcessTimes(
            handle, ctypes.byref(created), ctypes.byref(ended), ctypes.byref(kernel), ctypes.byref(user)
        ):
            return None
        return (created.dwHighDateTime << 32) | created.dwLowDateTime
    finally:
        kernel32.CloseHandle(handle)


def family(pid: int) -> set[int]:
    """The app and every process under it: the engine's browser, renderers, GPU."""

    return descendants(pid, parents(), born)


def look(of: Collection[int] | None = None) -> Look:
    """The desktop now: the top-level windows of these processes (of every process where
    none are named), the window in front, and every screen.

    In the pixels of whichever thread asks; the watch's thread reads the screen's own
    (`in_physical_pixels`), and so should any other that compares a window with a screen."""

    assert user32 is not None
    windows: list[Seen] = []

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if of is not None and owner.value not in of:
            return True
        box = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(box))
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        windows.append(
            Seen(
                hwnd=hwnd,
                pid=owner.value,
                kind=name.value,
                visible=bool(user32.IsWindowVisible(hwnd)),
                box=(box.left, box.top, box.right, box.bottom),
            )
        )
        return True

    screens: list[tuple[int, int, int, int]] = []

    def screen(_monitor: int, _dc: int, box: Any, _lparam: int) -> bool:
        at = box.contents
        screens.append((at.left, at.top, at.right, at.bottom))
        return True

    front = user32.GetForegroundWindow() or 0
    window_kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(window_kind(each), 0)
    screen_kind = ctypes.WINFUNCTYPE(
        wintypes.BOOL, wintypes.HMONITOR, wintypes.HDC, ctypes.POINTER(wintypes.RECT), wintypes.LPARAM
    )
    user32.EnumDisplayMonitors(None, None, screen_kind(screen), 0)
    return Look(windows=tuple(windows), front=front, screens=tuple(screens))


def in_physical_pixels() -> None:
    """Makes the calling thread read every rectangle in the screen's own pixels. Per
    thread, so a drive that sizes windows in the scaled pixels it always has keeps them."""

    if user32 is not None:
        user32.SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)


def end_all(pids: Iterable[int]) -> None:
    """Ends every one of these processes, by number, now. The task manager's kill: a
    window in front of somebody does not wait for a graceful close."""

    assert kernel32 is not None
    for pid in pids:
        handle = kernel32.OpenProcess(PROCESS_TERMINATE, False, pid)
        if handle:
            kernel32.TerminateProcess(handle, IN_VIEW_EXIT)
            kernel32.CloseHandle(handle)


def _watch(app: subprocess.Popen[bytes]) -> None:
    """Looks every few milliseconds from the moment the process exists until it and its
    family have ended, and ends all of them and the whole drive the moment any of it is
    in view: loudly, and without the drive's own clean-up, which is time the window would
    stay there."""

    in_physical_pixels()
    started = time.perf_counter()
    pids = {app.pid}
    asked = 0.0
    gone_at: float | None = None
    while True:
        now = time.perf_counter()
        if app.poll() is None:
            if now - asked > FAMILY_EVERY:
                living = parents()
                # Those seen before stay while they live: an engine process whose own
                # parent has ended is no longer under the app, and still its.
                pids = descendants(app.pid, living, born) | (pids & living.keys())
                asked = now
        else:
            gone_at = gone_at or now
            pids &= parents().keys()
            if not pids or now - gone_at > AFTERLIFE:
                return
        seen = in_view(look(pids), pids)
        if seen:
            end_all([app.pid, *(pids - {app.pid})])
            after = (now - started) * 1000
            print(
                f"PROBE IN VIEW after {after:.0f} ms: {'; '.join(seen)}. Ended pid {app.pid} and "
                f"{len(pids) - 1} under it; this build or drive puts a window in front of "
                "somebody. See scripts/probe_app.py.",
                file=sys.stderr,
            )
            sys.stderr.flush()
            os._exit(IN_VIEW_EXIT)
        time.sleep(LOOK_EVERY)


# ---- what a drive asks before and after a step ----


class _GuiThread(ctypes.Structure):
    """`GUITHREADINFO`."""

    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND),
        ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND),
        ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND),
        ("hwndCaret", wintypes.HWND),
        ("rcCaret", wintypes.RECT),
    ]


def described(hwnd: int | None) -> str:
    """A window as `class@pid 0xHWND`. The handle as well, because every page of the
    engine is a `Chrome_WidgetWin_1` of the same browser process: without it the keyboard
    moving from the reader's page to an agent's reads as nothing having changed."""

    assert user32 is not None
    if not hwnd:
        return "none"
    name = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, name, 256)
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    return f"{name.value}@{owner.value} 0x{hwnd:X}"


def keyboard(pid: int) -> dict[str, object]:
    """Where a key pressed now would go: the window in front, whether it is the probe's or
    an engine process under it, and the window the app's own thread would hand a key to.
    Read before and after a step, the three must not change."""

    assert user32 is not None
    front = user32.GetForegroundWindow()
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(front, ctypes.byref(owner))
    hwnd = main_window(pid)
    thread = user32.GetWindowThreadProcessId(hwnd, None) if hwnd else 0
    info = _GuiThread()
    info.cbSize = ctypes.sizeof(_GuiThread)
    focus = "?"
    if thread and user32.GetGUIThreadInfo(thread, ctypes.byref(info)):
        focus = described(info.hwndFocus)
    return {
        "front": described(front),
        "front is ours": owner.value in family(pid),
        "app thread focus": focus,
    }


class _LastInput(ctypes.Structure):
    """`LASTINPUTINFO`."""

    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


def idle_seconds() -> float:
    """How long since anybody touched the keyboard or the mouse, in seconds: the one
    step that could put an engine window on a screen waits for a minute of this."""

    assert user32 is not None and kernel32 is not None
    last = _LastInput()
    last.cbSize = ctypes.sizeof(_LastInput)
    if not user32.GetLastInputInfo(ctypes.byref(last)):
        return 0.0
    return ((kernel32.GetTickCount() - last.dwTime) & 0xFFFFFFFF) / 1000


def sized(hwnd: int, width: int, height: int) -> None:
    """Gives a window a size and leaves it where it is - off the screen - without
    touching which window is in front or has the keyboard."""

    assert user32 is not None
    user32.SetWindowPos(
        hwnd, None, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE
    )
