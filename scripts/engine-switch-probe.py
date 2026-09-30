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
(see engine_switch/fetch.rs), under this version. Or `--release`, a folder holding what
a release carries - `chromium.json` and the archives `cef/pack.py` made, signed with the
key the probe build was given - which the drive serves on a port of its own and the app
then fetches the way it would from GitHub, through the Browser row's own command:

    python scripts/engine-switch-probe.py --exe .../nib.exe --release .../chromium-out

**Do not run it on a machine somebody is working at.** nib's own Chromium can take the
foreground on its own: on 2026-09-30 the watch found a Chromium probe the window in front
five times in a row - while its reader switched windows, and while their own nib was in
front - and neither pushing its windows to the bottom nor disabling them stopped it.
The likeliest cause is Chromium's own: a browser made in a window is given the keyboard,
and the runtime offers no way to make one with `WS_EX_NOACTIVATE`, which is how CEF is
told not to; see docs/browser.md, section 0. The watch ends every
process the moment it happens, which is a moment too late for whoever was typing.

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

import devtools
import probe_app
from probe_app import close_app, in_view, run_probe

switch = importlib.import_module("web-switch-probe")

#: What the drive is doing, for the watch to say when something came into view.
STEP = ["starting"]

#: The port nib's own Chromium opens for the drive to read its pages through; see
#: `debugging` in src-tauri/cef/src/main.rs. The system's engine ignores it.
DEBUG_PORT = 22357

#: The files of a Chromium build that are the engine's rather than the app's, by suffix,
#: and the one folder of them.
ENGINE_FILES = (".dll", ".pak", ".dat", ".bin", ".json")
ENGINE_FOLDERS = ("locales",)

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
HWND_BOTTOM = 1
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE = 0x0001, 0x0002, 0x0010

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


def step(name: str) -> None:
    """Says what the drive is doing now, on stderr and to the watch."""

    STEP[0] = name
    print(f"{time.strftime('%H:%M:%S')} {name}", file=sys.stderr, flush=True)


def lowest(pids: list[int], done: set[int]) -> None:
    """Every window of these processes at the bottom of the z-order and closed to the
    keyboard, once each, from the moment it exists: a window shown without the keyboard
    still goes to the top, where a window closing elsewhere hands it the foreground; and
    Chromium gives a page the keyboard whenever it is sent somewhere, which takes its
    window to the front wherever Windows lets it. It is not enough for the second: see
    the warning at the top of this file."""

    assert probe_app.user32 is not None
    user32 = probe_app.user32
    wanted = set(pids)

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value in wanted and hwnd not in done:
            done.add(hwnd)
            user32.EnableWindow(hwnd, False)
            user32.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)


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
        lowered: set[int] = set()
        while not self.stopped:
            lowest(list(self.pids), lowered)
            for pid in list(self.pids):
                seen = in_view(pid)
                if seen:
                    front = probe_app.user32.GetForegroundWindow()
                    kind = ctypes.create_unicode_buffer(256)
                    probe_app.user32.GetClassNameW(front, kind, 256)
                    self.end()
                    print(
                        f"PROBE IN VIEW: {seen} (pid {pid}, {image_of(pid) or 'gone'}, class {kind.value!r},"
                        f" during {STEP[0]!r}); ended every probe process.",
                        file=sys.stderr,
                    )
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


def serve_release(folder: pathlib.Path) -> str:
    """Serves a release's Chromium files on a port of this drive's own, as GitHub serves
    them; the address the app is told to fetch from."""

    import functools
    import http.server

    port = switch.free_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(folder))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}/"


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


def isolated(page_url: str, app: switch.App, tab: str, other: str) -> dict[str, object]:
    """What a Chromium web tab's page is given, read through the engine's own debugging
    port: none of the app's globals in the page's world, nib's binding in nib's world and
    only there, a link pressed for a tab behind arriving as one, and find running in nib's
    world without leaving anything in the page's."""

    found: dict[str, object] = {}
    # A tab is live before its page has left the blank page it is built on.
    page, targets, until = None, [], time.perf_counter() + 30
    while page is None and time.perf_counter() < until:
        targets = devtools.targets(DEBUG_PORT)
        page = next((one for one in targets if one.get("url", "").startswith(page_url)), None)
        if page is None:
            time.sleep(0.25)
    if page is None:
        return {"error": f"no page at {page_url} among {[one.get('url') for one in targets]}"}
    session = devtools.Session(page)
    try:
        found["the page's own world has"] = session.value(
            "Object.getOwnPropertyNames(window).filter((name) => /tauri|ipc|nib/i.test(name))"
        )
        # nib's world as the app made it: a world this session made under the same name
        # would be this session's own, so the drive reads the contexts the page reports.
        session.call("Runtime.enable")
        session.listen(1)
        frame = session.call("Page.getFrameTree").get("frameTree", {}).get("frame", {}).get("id")
        worlds = [
            one["params"]["context"]
            for one in session.events
            if one.get("method") == "Runtime.executionContextCreated"
            and one["params"]["context"].get("name") == "nib"
            and one["params"]["context"].get("auxData", {}).get("frameId") == frame
        ]
        found["nib's worlds in the page's frame"] = len(worlds)
        if not worlds:
            return found
        world = worlds[-1]["id"]
        found["nib's world has its binding"] = session.value("typeof nibAsked", context=world)
        found["the page's world has none"] = session.value("typeof nibAsked")

        before = app.ask(switch.TABS)
        session.value(
            f"nibAsked(JSON.stringify([{json.dumps(other)}, 'nib-behind']))", context=world
        )
        time.sleep(2)
        after = app.ask(switch.TABS)
        if isinstance(before, list) and isinstance(after, list):
            found["a link pressed for a tab behind opens one"] = len(after) == len(before) + 1
            found["and the page stays in front"] = any(
                one.get("id") == tab and one.get("showing") for one in after if isinstance(one, dict)
            )

        invoke(app, "web_find", {"tab": tab, "term": "tab", "look": "fresh"})
        time.sleep(1)
        found["find leaves nothing in the page's world"] = session.value("typeof window.__nibFound")
        found["find ran in nib's world"] = session.value("typeof window.__nibFound", context=world)
    finally:
        session.close()
    return found


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--chromium", type=pathlib.Path)
    parsed.add_argument("--release", type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.engine")
    parsed.add_argument("--version", default=probe_app.PROBE_VERSION)
    args = parsed.parse_args()

    system_exe = args.exe.resolve()
    probe_app.refuse_updating(system_exe)
    os.environ["NIB_CEF_DEBUG_PORT"] = str(DEBUG_PORT)
    switch.wipe(args.identifier)
    local = pathlib.Path(os.environ["LOCALAPPDATA"]) / args.identifier
    if args.release:
        engine = local / "engines" / "chromium" / args.version
        served = serve_release(args.release)
        os.environ["NIB_ENGINE_SOURCE"] = served
    else:
        engine = install(args.chromium, args.identifier, args.version)
    chromium_exe = (engine / "nib-chromium.exe").resolve()
    watch = Watch([system_exe, chromium_exe])

    port = switch.free_port()
    switch.serve(port)
    switch.space(port)
    said: dict[str, object] = {}

    try:
        step('the first launch')
        # One launch to write the endpoint file, so the window's own commands can be run.
        first = run_probe(system_exe, quiet=True)
        old, _ = switch.endpoint(args.identifier, 90)
        window_after(watch, system_exe, 60)
        close_app(first, 30)
        if not watch.gone(30):
            raise SystemExit("the first launch never ended")
        switch.allow_eval(args.identifier)

        step("the system's engine")
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

        step('chromium chosen and fetched')
        # Chromium chosen, and the app started again.
        said["choose chromium"] = invoke(app, "engine_choose", {"engine": "chromium"})
        if args.release:
            began = time.perf_counter()
            said["fetch"] = invoke(app, "engine_fetch", seconds=900)
            said["fetch ms"] = round((time.perf_counter() - began) * 1000)
            said["fetched"] = {
                "engine files": len(list(engine.iterdir())) if engine.exists() else 0,
                "folders": sorted(one.name for one in engine.parent.iterdir()) if engine.parent.exists() else [],
            }
        step('the relaunch to chromium')
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
        step('a web tab on chromium')
        said["chromium: web tab"] = web_tab(app, switch.OTHER)
        other_tab = switch.tab_of(app, switch.OTHER)
        said["chromium: the page's worlds"] = (
            isolated(f"http://127.0.0.1:{port}/other", app, other_tab, f"http://127.0.0.1:{port}/page?behind")
            if other_tab
            else {"error": "no tab"}
        )

        step('a second launch')
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

        step('closing chromium')
        # A launch with Chromium chosen, the way a shortcut starts it: the system's build
        # is what the system starts, and it hands the launch over.
        # Closed the way its close button closes it, and timed: the window hides at once,
        # and the process goes once Chromium has let go of every page.
        closed = [
            window for window in map(probe_app.main_window, pids_running([chromium_exe])) if window
        ]
        began = time.perf_counter()
        for window in closed:
            probe_app.user32.PostMessageW(window, probe_app.WM_CLOSE, 0, 0)
        while any(map(probe_app.user32.IsWindowVisible, closed)) and time.perf_counter() - began < 30:
            time.sleep(0.02)
        said["closed on chromium: window hidden ms"] = round((time.perf_counter() - began) * 1000)
        if not watch.gone(120):
            raise SystemExit("Chromium never ended")
        said["closed on chromium: every process gone ms"] = round((time.perf_counter() - began) * 1000)
        step('a launch on chromium')
        began = time.perf_counter()
        run_probe(system_exe, quiet=True)
        window_after(watch, chromium_exe, 90)
        said["launch on chromium: window ms"] = round((time.perf_counter() - began) * 1000)
        port_chromium, secret, _ = endpoint_after(args.identifier, port_chromium, 90)
        said["launch on chromium: endpoint ms"] = round((time.perf_counter() - began) * 1000)
        app = switch.App(port_chromium, secret)
        time.sleep(4)

        step("the relaunch to the system's engine")
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

        step("a launch on the system's engine")
        # And a launch on the system's engine again, cold of nothing but the process.
        for pid in pids_running([system_exe]):
            window = probe_app.main_window(pid)
            if window:
                probe_app.user32.PostMessageW(window, probe_app.WM_CLOSE, 0, 0)
        if not watch.gone(60):
            raise SystemExit("the system's build never ended")
        began = time.perf_counter()
        run_probe(system_exe, quiet=True)
        window_after(watch, system_exe, 90)
        said["launch on system: window ms"] = round((time.perf_counter() - began) * 1000)
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
