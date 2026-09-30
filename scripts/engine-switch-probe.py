"""Does the Browser row's engine switch work, and what does each engine cost? Windows only.

Emil, 2026-09-30: *"it should for now be possible to switch between chromium and the
alternative."* The switch is a file and a relaunch (src-tauri/src/engine_switch.rs), so
the drive does what the row does, through the window's own commands, and reads what
happens to the processes:

* **the launch on each engine** - from the process starting to the window on the screen
  it was sent to, and to the endpoint answering: the <1 s rule, for both.
* **the switch** - Chromium chosen, the app relaunched, and the process that answers
  afterwards is the Chromium build, on the same notes; then back again.
* **a second launch** - started while Chromium is running, it reaches the running app
  and ends, rather than opening a second app on the same notes.
* **a web tab on each engine** - opened, and live.

Two builds under one probe identifier and version, as a release pairs them:

    pnpm --dir apps/desktop tauri build --no-bundle --config <probe config>
    (cd apps/desktop/src-tauri/cef && TAURI_CONFIG=<probe config> cargo build --release)

    python scripts/engine-switch-probe.py --exe .../nib.exe --chromium .../release

`--chromium` is the Chromium build's folder: its executable and the engine's files
beside it, which the drive links into the app's engines folder the way a fetch would
(see engine_switch/fetch.rs), under this version.

**Every process is watched, not only the first.** A relaunch starts the app again from
inside the app, so the processes after it are nobody's children here; the drive finds
them by their executable's path and holds each to the same rule `run_probe` holds the
first one to: off the screen, never in front.
"""

from __future__ import annotations

import argparse
import ctypes
import importlib
import json
import os
import pathlib
import shutil
import subprocess
import sys
import threading
import time
from ctypes import wintypes

import probe_app
from probe_app import close_app, in_view, run_probe

switch = importlib.import_module("web-switch-probe")

#: The files of a Chromium build that are the engine's rather than the app's, by suffix,
#: and the one folder of them.
ENGINE_FILES = (".dll", ".pak", ".dat", ".bin", ".json")
ENGINE_FOLDERS = ("locales",)

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True) if sys.platform == "win32" else None
psapi = ctypes.WinDLL("psapi", use_last_error=True) if sys.platform == "win32" else None


def image_of(pid: int) -> str:
    """The executable a process runs, or the empty string where it cannot be asked."""

    assert kernel32 is not None
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(1024)
        name = ctypes.create_unicode_buffer(size.value)
        if kernel32.QueryFullProcessImageNameW(handle, 0, name, ctypes.byref(size)):
            return name.value
        return ""
    finally:
        kernel32.CloseHandle(handle)


def pids_running(exes: list[pathlib.Path]) -> list[int]:
    """Every process running one of these executables, by its full path - never by its
    name, which the reader's own nib shares."""

    assert psapi is not None
    wanted = {os.path.realpath(one).lower() for one in exes}
    ids = (wintypes.DWORD * 4096)()
    got = wintypes.DWORD()
    psapi.EnumProcesses(ids, ctypes.sizeof(ids), ctypes.byref(got))
    count = got.value // ctypes.sizeof(wintypes.DWORD)
    found = []
    for pid in ids[:count]:
        image = image_of(pid) if pid else ""
        if image and os.path.realpath(image).lower() in wanted:
            found.append(pid)
    return found


class Watch:
    """Holds every process of the two builds to the off-screen rule, the way `run_probe`
    holds the one it started; ends all of them and the drive if one is ever in view."""

    def __init__(self, exes: list[pathlib.Path]) -> None:
        self.exes = exes
        self.pids: list[int] = []
        self.stopped = False
        threading.Thread(target=self._find, daemon=True).start()
        threading.Thread(target=self._look, daemon=True).start()

    def _find(self) -> None:
        while not self.stopped:
            self.pids = pids_running(self.exes)
            time.sleep(0.05)

    def _look(self) -> None:
        while not self.stopped:
            for pid in list(self.pids):
                seen = in_view(pid)
                if seen:
                    self.end()
                    print(f"PROBE IN VIEW: {seen} (pid {pid}); ended every probe process.", file=sys.stderr)
                    os._exit(3)
            time.sleep(probe_app.LOOK_EVERY)

    def end(self) -> None:
        for pid in pids_running(self.exes):
            subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, check=False)

    def gone(self, seconds: float) -> bool:
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            if not pids_running(self.exes):
                return True
            time.sleep(0.1)
        return False


def install(chromium: pathlib.Path, identifier: str, version: str) -> pathlib.Path:
    """Puts the Chromium build where a fetch would, for this version: the engine's files
    linked, the executable copied, and the folder marked finished."""

    local = pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier
    folder = local / "engines" / "chromium" / version
    shutil.rmtree(folder, ignore_errors=True)
    folder.mkdir(parents=True)
    for one in chromium.iterdir():
        if one.is_file() and one.suffix.lower() in ENGINE_FILES:
            os.link(one, folder / one.name)
        elif one.is_dir() and one.name in ENGINE_FOLDERS:
            shutil.copytree(one, folder / one.name, copy_function=os.link)
    shutil.copy2(chromium / "nib-chromium.exe", folder / "nib-chromium.exe")
    (folder / ".ready").write_bytes(b"")
    return folder


def invoke(app: switch.App, command: str, args: dict | None = None, seconds: float = 60) -> object:
    """One of the window's own commands, run in the window, and its answer."""

    code = """(async () => {
  try {
    return JSON.stringify(await window.__TAURI_INTERNALS__.invoke('%s', %s))
  } catch (error) {
    return JSON.stringify({ error: String(error) })
  }
})()""" % (command, json.dumps(args or {}))
    return app.ask(code, seconds)


def endpoint_after(identifier: str, old: int, seconds: float) -> tuple[int, str, float]:
    began = time.perf_counter()
    port, secret = switch.endpoint(identifier, seconds, unlike=old)
    return port, secret, (time.perf_counter() - began) * 1000


def window_after(watch: Watch, exe: pathlib.Path, seconds: float) -> tuple[int, float]:
    """The first app window of a process running `exe`, and how long it took to come."""

    began = time.perf_counter()
    until = began + seconds
    while time.perf_counter() < until:
        for pid in pids_running([exe]):
            if probe_app.main_window(pid):
                return pid, (time.perf_counter() - began) * 1000
        time.sleep(0.02)
    return 0, -1.0


def web_tab(app: switch.App, name: str) -> object:
    app.open(f"{name}.url")
    tab = None
    until = time.perf_counter() + 20
    while tab is None and time.perf_counter() < until:
        tab = switch.tab_of(app, name)
    if tab is None:
        return {"error": "the app never opened the website"}
    return {"live after ms": switch.until_live(app, tab, 60)}


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--chromium", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.engine")
    parsed.add_argument("--version", default=probe_app.PROBE_VERSION)
    args = parsed.parse_args()

    system_exe = args.exe.resolve()
    probe_app.refuse_updating(system_exe)
    switch.wipe(args.identifier)
    engine = install(args.chromium, args.identifier, args.version)
    chromium_exe = (engine / "nib-chromium.exe").resolve()
    watch = Watch([system_exe, chromium_exe])

    port = switch.free_port()
    switch.serve(port)
    switch.space(port)
    said: dict[str, object] = {}

    try:
        # One launch to write the endpoint file, so the window's own commands can be run.
        first = run_probe(system_exe, quiet=True)
        old, _ = switch.endpoint(args.identifier, 90)
        window_after(watch, system_exe, 60)
        close_app(first, 30)
        if not watch.gone(30):
            raise SystemExit("the first launch never ended")
        switch.allow_eval(args.identifier)

        # The system's engine: the launch, and a web tab.
        began = time.perf_counter()
        running = run_probe(system_exe, quiet=True)
        _, took = window_after(watch, system_exe, 60)
        port_system, secret, answered = endpoint_after(args.identifier, old, 90)
        said["system: window ms"] = round(took)
        said["system: endpoint ms"] = round((time.perf_counter() - began) * 1000)
        app = switch.App(port_system, secret)
        app.open(f"{switch.NOTE}.md", switch.SPACE)
        time.sleep(2)
        said["system: state"] = invoke(app, "engine_state")
        said["system: web tab"] = web_tab(app, switch.WEB)

        # Chromium chosen, and the app started again.
        said["choose chromium"] = invoke(app, "engine_choose", {"engine": "chromium"})
        began = time.perf_counter()
        invoke(app, "engine_relaunch", seconds=5)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and [one for one in pids_running([system_exe]) if one == running.pid]:
            time.sleep(0.05)
        said["relaunch to chromium: system gone ms"] = round((time.perf_counter() - began) * 1000)
        pid, took = window_after(watch, chromium_exe, 90)
        said["relaunch to chromium: window ms"] = round((time.perf_counter() - began) * 1000)
        port_chromium, secret, _ = endpoint_after(args.identifier, port_system, 90)
        said["relaunch to chromium: endpoint ms"] = round((time.perf_counter() - began) * 1000)
        said["system build still running"] = bool(
            [one for one in pids_running([system_exe]) if one != pid]
        )
        app = switch.App(port_chromium, secret)
        time.sleep(4)
        said["chromium: state"] = invoke(app, "engine_state")
        said["chromium: web tab"] = web_tab(app, switch.OTHER)

        # A second launch reaches the running app and ends.
        second = run_probe(system_exe, quiet=True, args=[f"http://127.0.0.1:{port}/page?second"])
        try:
            second.wait(timeout=30)
            said["second launch ended"] = True
        except subprocess.TimeoutExpired:
            said["second launch ended"] = False
        time.sleep(3)
        said["processes after the second launch"] = {
            "system": len(pids_running([system_exe])),
            "chromium": len(pids_running([chromium_exe])) > 0,
        }

        # And back to the system's engine.
        said["choose system"] = invoke(app, "engine_choose", {"engine": "system"})
        began = time.perf_counter()
        invoke(app, "engine_relaunch", seconds=5)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and pids_running([chromium_exe]):
            time.sleep(0.05)
        said["relaunch to system: chromium gone ms"] = round((time.perf_counter() - began) * 1000)
        window_after(watch, system_exe, 90)
        said["relaunch to system: window ms"] = round((time.perf_counter() - began) * 1000)
        port_back, secret, _ = endpoint_after(args.identifier, port_chromium, 90)
        said["relaunch to system: endpoint ms"] = round((time.perf_counter() - began) * 1000)
        app = switch.App(port_back, secret)
        time.sleep(1)
        said["back: state"] = invoke(app, "engine_state")
    finally:
        print(json.dumps(said, indent=2))
        for pid in pids_running([system_exe, chromium_exe]):
            window = probe_app.main_window(pid)
            if window:
                probe_app.user32.PostMessageW(window, probe_app.WM_CLOSE, 0, 0)
        if not watch.gone(30):
            watch.end()
        watch.stopped = True
    return 0


if __name__ == "__main__":
    sys.exit(main())
