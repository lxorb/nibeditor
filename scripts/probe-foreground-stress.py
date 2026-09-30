"""Is a probe ever the window in front? Fifty launches back to back, and the answer
written down every twenty milliseconds. Windows only.

A probe - a build started through `run_probe` in probe_app.py - must never be the
window in front of whoever is working at the machine; see
apps/desktop/src-tauri/src/foreground.rs for how the app holds itself back and why a
watch that ends it afterwards is not enough. This is the proof that it does, under the
load that made it fail on 2026-09-30: launches back to back, cold and warm, on an empty
space and on five thousand notes.

Each launch runs in a process of its own, because the watch in `run_probe` ends the
whole drive the moment a probe is in view, and a count needs the run to go on. Meanwhile
this process asks which process owns the window in front every twenty milliseconds, and
is told of every change the moment it happens besides (`EVENT_SYSTEM_FOREGROUND`, heard
out of context, which takes nothing from anybody). A launch fails when the window in front
was ever the probe's or any process's under it, or when the watch ended it. Nothing here
touches a window that is not the probe's, and nothing is ended but the processes this
started.

Each launch also says whether the process that started it could have taken the
foreground (asked with a lock released at once), and whether the probe said, as it
started, that it could have: that is what `run_probe` is meant to hand on none of.

    python scripts/probe-foreground-stress.py --exe path/to/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>.launch

The build is a release probe, as apps/desktop/test/e2e/launch.py says, whose identifier
has `.launch` in it: a cold launch wipes the identifier's own folders, and nothing else's.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
from ctypes import wintypes

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "apps" / "desktop" / "test" / "e2e"))

from probe_app import IN_VIEW_EXIT, close_app, family, main_window, run_probe  # noqa: E402

#: How often the window in front is asked for, in seconds.
EVERY = 0.02

#: What the probe says on its error stream when it started able to take the foreground;
#: see `run_on` in src-tauri/src/lib.rs.
ABLE = "started able to take the foreground"

#: How long one launch may take before it is ended, in seconds.
PATIENCE = 90

#: `SetWinEventHook`: a change of the window in front, heard out of context.
EVENT_SYSTEM_FOREGROUND = 0x0003
WINEVENT_OUTOFCONTEXT = 0x0000

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetForegroundWindow.restype = wintypes.HWND


def owner(hwnd: int | None) -> int:
    """The process a window belongs to, or 0 for no window."""

    if not hwnd:
        return 0
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return pid.value


def able_to_take_the_front() -> bool:
    """Whether this process could take the foreground now: the system grants a lock on
    it only to a process that could. Released at once, so nobody is held back by it."""

    if user32.LockSetForegroundWindow(1):
        user32.LockSetForegroundWindow(2)
        return True
    return False


# ---- one launch, in a process of its own ----


def one(exe: pathlib.Path, identifier: str, spaces: pathlib.Path, cold: bool, prime: bool) -> int:
    """Launches the probe once, says its process number on the first line of output as
    soon as it has one, waits for the launch order to finish, and closes it. Its exit is
    the drive's: the watch's own when it ended the probe."""

    import launch

    if cold:
        launch.wipe(identifier)
    trace = launch.trace_file(identifier)
    if trace.exists():
        trace.unlink()
    able = able_to_take_the_front()
    environment = {**os.environ, "NIB_TRACE_STARTUP": "1", "NIB_SPACES_DIR": str(spaces)}
    app = run_probe(exe, env=environment)
    print(json.dumps({"pid": app.pid, "launcher able": able}), flush=True)
    try:
        until = time.monotonic() + launch.PATIENCE
        while time.monotonic() < until and app.poll() is None:
            read = launch.last_line(trace) if main_window(app.pid) else None
            if read and any(step["step"] == launch.LAST for step in read["steps"]):
                break
            time.sleep(0.1)
        if prime:
            launch.opened_note(identifier)(app, {})
    finally:
        if app.poll() is None and not close_app(app, seconds=20):
            app.kill()
            app.wait(timeout=30)
        launch.settled(identifier)
    return 0


# ---- the run ----


class Front:
    """Who owns the window in front: asked every `EVERY` seconds, and told of each change
    as it happens. `seen` is every owner with when it was seen."""

    def __init__(self) -> None:
        self.seen: list[tuple[float, int]] = []
        self.lock = threading.Lock()
        self.going = True
        threading.Thread(target=self.poll, name="front, polled", daemon=True).start()
        threading.Thread(target=self.hear, name="front, heard", daemon=True).start()

    def note(self, pid: int) -> None:
        with self.lock:
            self.seen.append((time.perf_counter(), pid))

    def poll(self) -> None:
        while self.going:
            self.note(owner(user32.GetForegroundWindow()))
            time.sleep(EVERY)

    def hear(self) -> None:
        kind = ctypes.WINFUNCTYPE(
            None,
            wintypes.HANDLE,
            wintypes.DWORD,
            wintypes.HWND,
            wintypes.LONG,
            wintypes.LONG,
            wintypes.DWORD,
            wintypes.DWORD,
        )

        def changed(_hook, _event, hwnd, _object, _child, _thread, _time) -> None:
            self.note(owner(hwnd))

        self.callback = kind(changed)
        user32.SetWinEventHook.restype = wintypes.HANDLE
        hook = user32.SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, self.callback, 0, 0, WINEVENT_OUTOFCONTEXT
        )
        message = wintypes.MSG()
        while self.going and user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
        if hook:
            user32.UnhookWinEvent(hook)

    def since(self, start: float) -> list[int]:
        with self.lock:
            return [pid for at, pid in self.seen if at >= start]


def plan(launches: int) -> list[tuple[str, bool]]:
    """Which space and whether cold, launch by launch: half on each space, every fifth
    one cold, so both spaces are launched cold and warm."""

    half = launches // 2
    return [("empty" if at < half else "big", (at % half) % 5 == 0) for at in range(launches)]


def watched(exe: pathlib.Path, identifier: str, spaces: pathlib.Path, cold: bool, prime: bool, front: Front) -> dict:
    """One launch in a process of its own, and what the front did while it ran."""

    begun = time.perf_counter()
    child = subprocess.Popen(
        [
            sys.executable,
            __file__,
            "--one",
            "--exe",
            str(exe),
            "--identifier",
            identifier,
            "--spaces",
            str(spaces),
            *(["--cold"] if cold else []),
            *(["--prime"] if prime else []),
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    first = child.stdout.readline() if child.stdout else ""
    said = json.loads(first) if first.startswith("{") else {}
    pid = int(said.get("pid", 0))
    ours: set[int] = {pid} if pid else set()
    stop = threading.Event()

    def follow() -> None:
        while not stop.is_set() and pid:
            ours.update(family(pid))
            stop.wait(0.25)

    follower = threading.Thread(target=follow, daemon=True)
    follower.start()
    try:
        out, err = child.communicate(timeout=PATIENCE + 60)
    except subprocess.TimeoutExpired:
        child.kill()
        out, err = child.communicate()
    stop.set()
    follower.join()
    owners = front.since(begun)
    in_front = sum(1 for one in owners if one in ours)
    return {
        "pid": pid,
        "launcher able": bool(said.get("launcher able")),
        "probe able": ABLE in err,
        "samples": len(owners),
        "probe in front": in_front,
        "watch ended it": child.returncode == IN_VIEW_EXIT,
        "exit": child.returncode,
        "seconds": round(time.perf_counter() - begun, 1),
        "said": [line for line in err.splitlines() if "PROBE IN VIEW" in line or ABLE in line],
    }


def main() -> int:
    if sys.platform != "win32":
        print("this drive launches a Windows build")
        return 0

    ask = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ask.add_argument("--exe", type=pathlib.Path, required=True)
    ask.add_argument("--identifier", required=True)
    ask.add_argument("--launches", type=int, default=50)
    ask.add_argument("--json", type=pathlib.Path, help="every launch's line, written here")
    ask.add_argument("--one", action="store_true", help=argparse.SUPPRESS)
    ask.add_argument("--spaces", type=pathlib.Path, help=argparse.SUPPRESS)
    ask.add_argument("--cold", action="store_true", help=argparse.SUPPRESS)
    ask.add_argument("--prime", action="store_true", help=argparse.SUPPRESS)
    told = ask.parse_args()

    if told.one:
        return one(told.exe, told.identifier, told.spaces, told.cold, told.prime)
    if ".launch" not in told.identifier:
        raise SystemExit("a cold launch wipes the identifier's folders: give one with .launch in it")
    if not told.exe.exists():
        raise SystemExit(f"no probe build at {told.exe}")

    import launch

    front = Front()
    runs: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="nib-front-") as scratch:
        made: set[str] = set()
        for at, (kind, cold) in enumerate(plan(told.launches)):
            spaces = pathlib.Path(scratch) / kind
            if kind not in made:
                launch.corpus(kind, spaces)
                made.add(kind)
            # The first cold launch of the big space opens a note in it, so every warm one
            # after it reopens the note, as somebody reopening the app would.
            prime = kind == "big" and cold
            run = {"launch": at + 1, "space": kind, "cold": cold, **watched(told.exe, told.identifier, spaces, cold, prime, front)}
            runs.append(run)
            flag = "IN FRONT" if run["probe in front"] or run["watch ended it"] else "ok"
            print(
                f"  {at + 1:2} {kind:5} {'cold' if cold else 'warm'}: {flag}, pid {run['pid']}, "
                f"{run['samples']} looks, launcher able {run['launcher able']}, "
                f"probe able {run['probe able']}, {run['seconds']} s"
                + (f", exit {run['exit']}" if run["exit"] else ""),
                flush=True,
            )
            for line in run["said"]:
                print(f"       {line}", flush=True)
    front.going = False

    failed = [run for run in runs if run["probe in front"] or run["watch ended it"]]
    looks = sum(run["samples"] for run in runs)
    print()
    print(
        f"{len(failed)} of {len(runs)} launches had a probe in front; {looks} looks at the front; "
        f"launcher able {sum(run['launcher able'] for run in runs)}, probe able "
        f"{sum(run['probe able'] for run in runs)}, exits other than 0: "
        f"{sum(1 for run in runs if run['exit'])}"
    )
    if told.json:
        told.json.write_text(json.dumps(runs, indent=1), encoding="utf-8")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
