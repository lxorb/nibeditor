"""A terminal tab in the packaged app: a shell answering, a window resized, and nothing
left running once the tab has gone.

Windows only, and the one thing no test in the repository can answer: a terminal is a
pseudo console the crate opens and xterm.js draws, and whether the two meet - bytes out
of ConPTY, through the channel, onto the screen, and keystrokes back - is a question about
the real thing. The unit tests hold the pieces; this holds them together.

What it checks, through the app's own automation endpoint with `eval` turned on (which is
the window itself, and so reaches what the window reaches; see docs/terminal.md):

* **Command Prompt** opens in a tab, types `echo hi` through xterm.js's own input, and
  `hi` comes back on a line of its own. `cd ..` is said back as OSC 9;9, and the tab's
  words follow it: the folder a restart puts it back in.
* **PowerShell** does the same, and says how wide its console is before and after the
  window is made narrower: the resize reaches the shell.
* **A running command** is busy (`ping`), Ctrl+C stops it, and then it is not.
* **Ctrl+T** in a terminal is the app's; **Ctrl+W** is the shell's and closes nothing.
* **Closing** the tab ends its shell, and **`exit`** in PowerShell closes its own tab;
  afterwards no shell and no console host of this app is left running.

A photograph of the window is written to `--shots`, off the app's own window and by pid.

    python scripts/terminal-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says; `run_probe` starts it off the screen and
without the keyboard, and nothing here moves it or presses a real key.
"""

from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SPACE = "Terminal probe"

failures: list[str] = []


def borrowed(name: str, file: str):
    """Another drive's helpers, read from its file: the names have dashes in them."""

    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tabs = borrowed("tabs", "new-tabs-probe.py")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


class Entry(ctypes.Structure):
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


def processes() -> list[tuple[int, int, str]]:
    """Every process, with its parent and its name, from the toolhelp snapshot."""

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    snapshot = kernel.CreateToolhelp32Snapshot(0x2, 0)
    entry = Entry()
    entry.dwSize = ctypes.sizeof(Entry)
    found: list[tuple[int, int, str]] = []
    more = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
    while more:
        found.append((entry.th32ProcessID, entry.th32ParentProcessID, entry.szExeFile.lower()))
        more = kernel.Process32NextW(snapshot, ctypes.byref(entry))
    kernel.CloseHandle(snapshot)
    return found


#: What a terminal leaves behind if it leaves anything: the shells and their consoles.
SHELLS = {"cmd.exe", "powershell.exe", "pwsh.exe", "conhost.exe", "openconsole.exe", "ping.exe"}


def shells_of(pid: int) -> list[tuple[int, str]]:
    """The shells and consoles below the app, however deep."""

    listed = processes()
    below = {pid}
    grew = True
    while grew:
        grew = False
        for one, parent, _name in listed:
            if parent in below and one not in below:
                below.add(one)
                grew = True
    return [(one, name) for one, parent, name in listed if one in below and name in SHELLS]


def alive(pid: int) -> bool:
    return any(one == pid for one, _parent, _name in processes())


class Window:
    """The app's window, through `eval`."""

    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def run(self, code: str) -> object:
        return tabs.ran(self.port, self.secret, code)

    def open(self, shell: str, label: str, key: str) -> str:
        code = (
            "(() => { const ws = nib.workspace; const root = ws.activeSpace ? ws.activeSpace.root : null; "
            f"ws.openUnsaved('terminal', JSON.stringify({{ shell: {json.dumps(shell)}, folder: root, key: {json.dumps(key)} }}), {json.dumps(label)}); "
            "return ws.activeTabId })()"
        )
        return str(self.run(code))

    def rows(self) -> list[str]:
        said = self.run(
            "JSON.stringify([...document.querySelectorAll('.xterm-rows > div')]"
            ".map((row) => row.textContent.replace(/\\u00a0/g, ' ').trimEnd()))"
        )
        try:
            return json.loads(said) if isinstance(said, str) else []
        except ValueError:
            return []

    def typed(self, words: str) -> None:
        """Through xterm.js's own input, as the keyboard's text arrives."""

        self.run(
            "(() => { const field = document.querySelector('.xterm-helper-textarea'); "
            f"field.dispatchEvent(new InputEvent('input', {{ data: {json.dumps(words)}, inputType: 'insertText', bubbles: true }})); "
            "return true })()"
        )

    def chord(self, key: str, code: str, key_code: int) -> None:
        """Ctrl and a key, pressed where the terminal has the keyboard, with the key code
        a real keyboard gives - which xterm.js reads a control character off."""

        self.run(
            "(() => { const field = document.querySelector('.xterm-helper-textarea'); "
            f"const press = new KeyboardEvent('keydown', {{ key: {json.dumps(key)}, code: {json.dumps(code)}, ctrlKey: true, bubbles: true, cancelable: true }}); "
            f"Object.defineProperty(press, 'keyCode', {{ get: () => {key_code} }}); "
            "field.dispatchEvent(press); return true })()"
        )

    def invoke(self, command: str, args: dict[str, object]) -> object:
        return self.run(
            f"window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args)})"
        )

    def spec(self, tab: str) -> dict:
        said = self.run(
            f"(() => {{ const tab = nib.workspace.tabs.find((one) => one.id === {json.dumps(tab)}); return tab ? tab.doc : null }})()"
        )
        try:
            return json.loads(said) if isinstance(said, str) else {}
        except ValueError:
            return {}

    def open_tabs(self) -> list[str]:
        said = self.run("JSON.stringify(nib.workspace.tabs.map((one) => one.id))")
        return json.loads(said) if isinstance(said, str) else []


def until(ask, seconds: float = 20.0, every: float = 0.25):
    """The first answer `ask` gives that is truthy, or its last one."""

    end = time.perf_counter() + seconds
    got = ask()
    while not got and time.perf_counter() < end:
        time.sleep(every)
        got = ask()
    return got


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.terminal")
    parsed.add_argument("--shots", default=str(ROOT / "apps/desktop/test/e2e/shots/terminal-probe"))
    args = parsed.parse_args()

    exe = pathlib.Path(args.exe).resolve()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-terminal-"))
    (spaces / SPACE / "inside").mkdir(parents=True, exist_ok=True)
    (spaces / SPACE / "A note.md").write_text("# A note\n\nWords.\n", encoding="utf-8")
    say(f"spaces root {spaces}")

    tabs.wipe(args.identifier)
    environment = {**os.environ, "NIB_SPACES_DIR": str(spaces)}

    # Twice: the first launch writes the file `eval` is turned on in, and the second is the
    # one that answers; see new-tabs-probe.py.
    first = run_probe(exe, env=environment)
    was, _ = tabs.endpoint(args.identifier, 150)
    tabs.allow_eval(args.identifier)
    first.terminate()
    first.wait(timeout=15)
    time.sleep(6.0)

    app = run_probe(exe, env=environment)
    try:
        hwnd = until(lambda: main_window(app.pid), 120, 0.25)
        if not hwnd:
            raise SystemExit("the window never appeared")
        port, secret = tabs.endpoint(args.identifier, 150, unlike=was)
        window = Window(port, secret)
        until(lambda: window.run("1 + 1") == 2, 30)
        say(f"window 0x{hwnd:X}, pid {app.pid}, endpoint {port}")

        # -- Command Prompt -------------------------------------------------------
        cmd = window.open("cmd", "Command Prompt", "probe-cmd")
        say(f"command prompt tab {cmd}")
        prompt = until(lambda: any(row.endswith(">") for row in window.rows()), 30)
        check(bool(prompt), "Command Prompt draws its prompt")

        window.typed("echo hi\r")
        answered = until(lambda: "hi" in window.rows(), 20)
        check(bool(answered), "echo hi comes back as a line of its own in Command Prompt")

        # The folder a restart would put it back in follows a cd.
        start = window.spec(cmd).get("folder")
        window.typed("cd inside\r")
        moved = until(lambda: window.spec(cmd).get("folder") != start, 10)
        check(
            bool(moved) and str(window.spec(cmd).get("folder", "")).endswith("inside"),
            f"cd is said back, and the tab's folder follows it ({window.spec(cmd).get('folder')})",
        )

        # Busy while something runs, and not once Ctrl+C has stopped it.
        pty = f"{cmd}-1"
        window.typed("ping -n 30 127.0.0.1\r")
        time.sleep(1.5)
        check(window.invoke("pty_busy", {"id": pty}) is True, "a running ping is busy")
        window.chord("c", "KeyC", 67)
        idle = until(lambda: window.invoke("pty_busy", {"id": pty}) is False, 10)
        check(bool(idle), "Ctrl+C stops it, and the shell is idle again")

        # Ctrl+W is the shell's: the tab stays.
        window.chord("w", "KeyW", 87)
        time.sleep(0.5)
        check(cmd in window.open_tabs(), "Ctrl+W in a terminal is the shell's and closes nothing")

        shoot = shots / "terminal-cmd.png"
        tabs.shoot(app.pid, shoot)
        say(f"photographed {shoot}")

        before = shells_of(app.pid)
        say(f"running below the app: {before}")

        # Ctrl+T is the app's: the dialog comes up over the terminal.
        window.chord("t", "KeyT", 84)
        dialog = until(
            lambda: window.run("!!document.querySelector('[role=dialog][aria-label=\"New\"]')") is True, 5
        )
        check(bool(dialog), "Ctrl+T in a terminal opens the new-tab dialog")
        window.run(
            "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); "
            "window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true })); return true })()"
        )
        time.sleep(0.5)

        # -- PowerShell -----------------------------------------------------------
        shells = window.invoke("terminal_shells", {})
        ids = [one.get("id") for one in shells] if isinstance(shells, list) else []
        say(f"shells found: {ids}")
        ps = "pwsh" if "pwsh" in ids else "powershell"
        power = window.open(ps, "PowerShell", "probe-ps")
        say(f"powershell tab {power} ({ps})")
        ready = until(lambda: any(row.rstrip().endswith(">") for row in window.rows()), 40)
        check(bool(ready), "PowerShell draws its prompt")

        window.typed("echo hi\r")
        answered = until(lambda: "hi" in window.rows(), 20)
        check(bool(answered), "echo hi comes back as a line of its own in PowerShell")

        width = "Write-Output ('cols=' + $Host.UI.RawUI.WindowSize.Width)\r"
        window.typed(width)
        wide = until(lambda: next((row for row in window.rows() if row.startswith("cols=")), None), 20)
        say(f"PowerShell said {wide}")

        box = wintypes.RECT()
        ctypes.WinDLL("user32").GetWindowRect(hwnd, ctypes.byref(box))
        sized(hwnd, int((box.right - box.left) * 0.6), box.bottom - box.top)
        time.sleep(1.5)
        window.typed("Clear-Host\r")
        time.sleep(1.0)
        window.typed(width)
        narrow = until(lambda: next((row for row in window.rows() if row.startswith("cols=")), None), 20)
        say(f"after the resize PowerShell said {narrow}")
        try:
            check(
                int(str(narrow).split("=")[1]) < int(str(wide).split("=")[1]),
                "a narrower window is a narrower console",
            )
        except (IndexError, ValueError):
            check(False, "PowerShell said how wide it is, before and after")

        shoot = shots / "terminal-powershell.png"
        tabs.shoot(app.pid, shoot)
        say(f"photographed {shoot}")

        # `exit` closes its own tab.
        window.typed("exit\r")
        gone = until(lambda: power not in window.open_tabs(), 15)
        check(bool(gone), "exit in PowerShell closes its own tab")

        # Quitting takes every shell with it, without a question, and the next launch
        # puts the terminal back: its shell, the folder it was last in, its last lines,
        # and a fresh prompt under them.
        # Escape first, which is Command Prompt's way of clearing the ^W left on the line.
        window.typed("\x1becho nib-before-restart\r")
        until(lambda: "nib-before-restart" in window.rows(), 10)
        running = shells_of(app.pid)
        # The last lines are written down once the output has rested.
        time.sleep(3.0)
        check(close_app(app), "the window closes with a shell running in it, asking nothing")
        ended = until(lambda: not any(alive(pid) for pid, _name in running), 15)
        check(bool(ended), f"no shell outlives the app (were {running})")

        time.sleep(6.0)
        app = run_probe(exe, env=environment)
        if not until(lambda: main_window(app.pid), 120, 0.25):
            raise SystemExit("the window never came back")
        port, secret = tabs.endpoint(args.identifier, 150, unlike=port)
        window = Window(port, secret)
        until(lambda: window.run("1 + 1") == 2, 30)

        back = window.run(
            "(() => { const tab = nib.workspace.tabs.find((one) => one.kind === 'terminal'); "
            "if (!tab) return null; nib.workspace.activate(tab.id); return tab.id })()"
        )
        check(isinstance(back, str), "the terminal tab comes back after a restart")
        if isinstance(back, str):
            folder = str(window.spec(back).get("folder", ""))
            check(folder.endswith("inside"), f"in the folder it was last in ({folder})")
            again = until(lambda: any(row.endswith("inside>") for row in window.rows()), 30)
            check(bool(again), "with a fresh shell at its prompt there")
            check(
                any("nib-before-restart" in row for row in window.rows()),
                "and its last lines above that",
            )

            shoot = shots / "terminal-restored.png"
            tabs.shoot(app.pid, shoot)
            say(f"photographed {shoot}")

            running = shells_of(app.pid)
            window.run(f"nib.workspace.close({json.dumps(back)})")
            ended = until(lambda: not any(alive(pid) for pid, _name in running), 15)
            check(bool(ended), f"closing the tab ends its shell (were {running})")
            left = shells_of(app.pid)
            check(not left, f"nothing of a terminal is left running ({left})")
    finally:
        if app.poll() is None and not close_app(app):
            app.kill()

    print()
    if failures:
        print(f"{len(failures)} failed:")
        for one in failures:
            print(f"  - {one}")
        return 1

    print("every check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
