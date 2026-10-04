"""A second launch while the first nib is frozen, and what the stall recorder says about
it. Windows only.

Emil's log of 2026-10-03 has five launches in twenty-five seconds: a nib had frozen,
and every launch after it waited on it for ever, invisible. This freezes a probe the
hard way - its window thread suspended from outside, so it pumps nothing at all - and
launches it again three times, each through `run_probe`, off the screen:

* **leave**: the second launch is told to leave the frozen one alone. It must end by
  itself within a few seconds, not wait on the frozen one, and the frozen one is still
  there afterwards.
* **wait**: the frozen one comes back while the second launch is waiting on its answer.
  The launch is handed over as usual - the second process ends, the first opens what it
  was handed - and the first one's log says how long its window did not answer.
* **end**: the second launch ends the frozen one and comes up as the first launch, and its
  log says what the frozen one was doing and for how long.

    python scripts/not-responding-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name>

The answer the question would get is `NIB_PROBE_NOT_RESPONDING`: a probe never shows it.
Only processes this probe started are suspended, resumed or waited on, by number.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time
from ctypes import wintypes

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from probe_app import close_app, main_window, run_probe  # noqa: E402

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
kernel32.OpenThread.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenThread.restype = wintypes.HANDLE
kernel32.SuspendThread.argtypes = [wintypes.HANDLE]
kernel32.ResumeThread.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

THREAD_SUSPEND_RESUME = 0x0002

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


def until(test, seconds: float, step: float = 0.1):
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        said = test()
        if said:
            return said
        time.sleep(step)
    return None


def config_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier


def log_of(identifier: str) -> str:
    try:
        return (local_dir(identifier) / "logs" / "nib.log").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def endpoint_port(identifier: str) -> int:
    try:
        return int(json.loads((config_dir(identifier) / "automation.json").read_text(encoding="utf-8"))["port"])
    except (OSError, ValueError, KeyError, TypeError):
        return 0


class Frozen:
    """A probe's window thread, suspended from outside, and let go again."""

    def __init__(self, hwnd: int) -> None:
        thread = user32.GetWindowThreadProcessId(hwnd, None)
        self.handle = kernel32.OpenThread(THREAD_SUSPEND_RESUME, False, thread)
        if not self.handle:
            raise SystemExit("could not open the probe's window thread")
        kernel32.SuspendThread(self.handle)

    def thaw(self) -> None:
        if self.handle:
            kernel32.ResumeThread(self.handle)
            kernel32.CloseHandle(self.handle)
            self.handle = None


def first(exe: pathlib.Path, env: dict[str, str]):
    app = run_probe(exe, env=env, quiet=True)
    hwnd = until(lambda: main_window(app.pid), 60)
    if not hwnd:
        raise SystemExit("the first launch never showed its window")
    # Its launch order, so the window thread is idle rather than mid-launch when frozen.
    time.sleep(6)
    return app, hwnd


def second(exe: pathlib.Path, env: dict[str, str], answer: str):
    return run_probe(exe, env={**env, "NIB_PROBE_NOT_RESPONDING": answer}, quiet=True)


def gone(app) -> None:
    if app.poll() is None and not close_app(app, seconds=20):
        app.kill()
        app.wait(timeout=30)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    told = parsed.parse_args()
    if "probe" not in told.identifier:
        raise SystemExit("a probe identifier, never the reader's")

    for folder in (config_dir(told.identifier), local_dir(told.identifier)):
        shutil.rmtree(folder, ignore_errors=True)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-not-responding-"))
    (spaces / "Notes").mkdir()
    (spaces / "Notes" / "A note.md").write_text("# A note\n", encoding="utf-8")
    env = {**os.environ, "NIB_SPACES_DIR": str(spaces)}

    started: list = []
    try:
        say("leave")
        app, hwnd = first(told.exe, env)
        started.append(app)
        frozen = Frozen(hwnd)
        began = time.perf_counter()
        other = second(told.exe, env, "leave")
        started.append(other)
        left = until(lambda: other.poll() is not None, 15)
        took = time.perf_counter() - began
        check(bool(left), f"the second launch goes by itself instead of waiting on the frozen one ({took:.1f} s)")
        check(took < 5, "and within a few seconds")
        check(app.poll() is None, "the frozen one is left alone")
        frozen.thaw()
        time.sleep(2)
        log = log_of(told.identifier)
        check("stall: the window has not answered for 1 s" in log, "the frozen one's log says its window stopped answering")
        check("stall: the window answered after" in log, "and when it answered again")
        gone(app)

        say("wait")
        app, hwnd = first(told.exe, env)
        started.append(app)
        before = len(log_of(told.identifier))
        frozen = Frozen(hwnd)
        other = second(told.exe, env, "wait")
        started.append(other)
        time.sleep(3)
        check(other.poll() is None, "the second launch is still waiting while the first is frozen")
        frozen.thaw()
        handed = until(lambda: other.poll() is not None, 10)
        check(bool(handed), "once the first answers, the second hands over and goes")
        check(app.poll() is None, "and the first is still the nib running")
        gone(app)
        written = log_of(told.identifier)[before:]
        say(f"log: {[line for line in written.splitlines() if 'stall' in line]}")

        say("end")
        app, hwnd = first(told.exe, env)
        started.append(app)
        was = endpoint_port(told.identifier)
        frozen = Frozen(hwnd)
        # Long enough to be written down as a hang; see stall.rs.
        time.sleep(6.5)
        began = time.perf_counter()
        other = second(told.exe, env, "end")
        started.append(other)
        ended = until(lambda: app.poll() is not None, 15)
        check(bool(ended), f"the frozen one is ended ({time.perf_counter() - began:.1f} s)")
        frozen.handle = None  # its process is gone, and the handle with it
        shown = until(lambda: main_window(other.pid), 30)
        check(bool(shown), f"the second launch comes up as the first ({time.perf_counter() - began:.1f} s to its window)")
        fresh = until(lambda: (lambda port: port if port and port != was else 0)(endpoint_port(told.identifier)), 30)
        check(bool(fresh), "and answers the automation endpoint")
        time.sleep(2)
        log = log_of(told.identifier)
        lines = [line for line in log.splitlines() if "stall" in line or "started nib" in line]
        for line in lines[-8:]:
            say(f"log: {line}")
        check(
            any("nib was not responding for" in line and "when it was ended" in line for line in lines),
            "the new launch says how long the old one was not responding, and what it was doing",
        )
        check(any("a launch ended the nib before it" in line for line in lines), "and that it ended it")
        gone(other)
    finally:
        for one in started:
            if one.poll() is None:
                one.kill()
        shutil.rmtree(spaces, ignore_errors=True)

    print()
    print("FAILED: " + "; ".join(failures) if failures else "all good")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
