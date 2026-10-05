"""A program that leaves the mouse reported, in the packaged app: the prompt after it gets
nothing typed at it when the mouse moves, and neither does the prompt of a terminal a
restart put back while such a program was running.

Windows only. Emil, 2026-10-01: moving the mouse over a terminal wrote `C"1C%0C...` at the
PowerShell prompt - xterm.js still reporting every move (DECSET 1003) after Claude Code,
and a restart replaying the mode with the screen. PowerShell stands in for the program: it
reads the terminal's own input, as Claude Code does - which is when the pseudo console hands
a program's mouse request on to the terminal at all - asks for any-event tracking, and
nothing switches it off.

    python scripts/terminal-modes-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Every launch is `run_probe`'s, off the screen and without the keyboard; the mouse is the
page's own events dispatched in the window, never the real one.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import time

from probe_app import WM_CLOSE, close_app, main_window, run_probe, user32

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

failures: list[str] = []


def borrowed(name: str, file: str):
    """Another probe's helpers, read from its file: the names have dashes in them."""

    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tabs = borrowed("tabs", "new-tabs-probe.py")
terminal = borrowed("terminal", "terminal-probe.py")
until = terminal.until

#: The program: its console switched to VT input (ENABLE_VIRTUAL_TERMINAL_INPUT), then
#: any-event tracking asked for, and never taken back.
MOUSE_ON = (
    "Add-Type -ErrorAction SilentlyContinue -Name K -Namespace N -MemberDefinition "
    "'[DllImport(\"kernel32.dll\")] public static extern IntPtr GetStdHandle(int n); "
    "[DllImport(\"kernel32.dll\")] public static extern bool GetConsoleMode(IntPtr h, out uint m); "
    "[DllImport(\"kernel32.dll\")] public static extern bool SetConsoleMode(IntPtr h, uint m);'; "
    "$h = [N.K]::GetStdHandle(-10); $m = 0; $null = [N.K]::GetConsoleMode($h, [ref]$m); "
    "$null = [N.K]::SetConsoleMode($h, $m -bor 0x200); Write-Host -NoNewline \"$([char]27)[?1003h\""
)


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


def moved(window) -> None:
    """The mouse moved across the terminal, a dozen times, as the page's own events."""

    window.run(
        "(() => { const screen = document.querySelector('.xterm-screen'); "
        "const box = screen.getBoundingClientRect(); "
        "for (let i = 0; i < 12; i++) screen.dispatchEvent(new MouseEvent('mousemove', "
        "{ clientX: box.left + 30 + i * 17, clientY: box.top + 30 + i * 9, bubbles: true })); "
        "return true })()"
    )
    time.sleep(1.5)


def reporting(window) -> bool:
    """Whether xterm.js reports the mouse: it marks its element while it does."""

    return window.run("document.querySelector('.nib-terminal .xterm').classList.contains('enable-mouse-events')") is True


def screen(window) -> str:
    """Every line of the screen that has anything on it: a prompt that wraps - conda's
    `(base)` before a long folder - is more than its last row."""

    return "\n".join(row for row in window.rows() if row.strip())


def prompted(window, after: str = "", seconds: float = 120.0) -> str:
    """The screen once the shell is at its prompt and has stopped drawing: its last line
    ends at `>`, below `after` where that is said - the end of the line just typed - and
    the screen is the same a second later. A line typed at it is echoed across as many
    rows as it wraps over, `Add-Type` compiles for seconds first, and a shell whose
    profile starts conda takes many more to draw its first prompt, so a fixed pause read
    the command's own rows, or the prompt before it, as the prompt after it."""

    end = time.perf_counter() + seconds
    last = ""
    while time.perf_counter() < end:
        now = screen(window)
        # Rows put back together, so a line that wrapped is found whole.
        whole = now.replace("\n", "")
        below = whole.rsplit(after, 1)[-1] if after and after in whole else ""
        if now == last and now.endswith(">") and (not after or ">" in below):
            return now
        last = now
        time.sleep(1.0)
    return last


def quit_anyway(app, window) -> bool:
    """Closes the window with a program running, answering Quit anyway where the question
    that names what runs comes up; see quit-warning-probe.py. A cmdlet runs inside the
    shell, which asks nothing."""

    user32.PostMessageW(main_window(app.pid), WM_CLOSE, 0, 0)
    asked = "document.querySelector('[role=\"alertdialog\"] .nib-button.is-danger')"

    def answered() -> bool:
        if app.poll() is not None:
            return True
        try:
            return window.run(f"(() => {{ const go = {asked}; go?.click(); return !!go }})()") is True
        except Exception:  # noqa: BLE001 - the app going away mid-call
            return False

    until(answered, 15)
    try:
        app.wait(timeout=30)
    except subprocess.TimeoutExpired:
        return False
    return True


def launched(exe: pathlib.Path, environment: dict[str, str], identifier: str, unlike: int):
    app = run_probe(exe, env=environment)
    if not until(lambda: main_window(app.pid), 120, 0.25):
        raise SystemExit("the window never appeared")
    port, secret = tabs.endpoint(identifier, 150, unlike=unlike)
    window = terminal.Window(port, secret)
    until(lambda: window.run("1 + 1") == 2, 30)
    return app, window, port


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.terminal-modes")
    args = parsed.parse_args()
    exe = pathlib.Path(args.exe).resolve()

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-modes-"))
    (spaces / "Modes probe").mkdir(parents=True, exist_ok=True)
    tabs.wipe(args.identifier)
    environment = {**os.environ, "NIB_SPACES_DIR": str(spaces)}

    first = run_probe(exe, env=environment)
    was, _ = tabs.endpoint(args.identifier, 150)
    tabs.allow_eval(args.identifier)
    first.terminate()
    first.wait(timeout=15)
    time.sleep(6.0)

    app, window, port = launched(exe, environment, args.identifier, was)
    try:
        shells = window.invoke("terminal_shells", {})
        ids = [one.get("id") for one in shells] if isinstance(shells, list) else []
        shell = "pwsh" if "pwsh" in ids else "powershell"
        tab = window.open(shell, "PowerShell", "probe-modes")
        say(f"{shell} in tab {tab}")
        check(prompted(window).endswith(">"), "PowerShell draws its prompt")

        # The program asks for every move and ends without taking it back.
        window.typed(f"{MOUSE_ON}\r")
        before = prompted(window, after=MOUSE_ON[-12:])
        check(before.endswith(">"), "the shell comes back to its prompt")
        check(not reporting(window), "the prompt after it has the mouse reported no more")
        moved(window)
        after = screen(window)
        say(f"prompt before the moves {before.splitlines()[-1]!r}, after {after.splitlines()[-1]!r}")
        check(after == before, "the prompt after it gets nothing when the mouse moves")

        # Now a program still running with the mouse reported as the app goes.
        window.typed(f"{MOUSE_ON}; Start-Sleep 600\r")
        check(bool(until(lambda: reporting(window), 10)), "a running program has the mouse reported")
        time.sleep(3.0)
        running = terminal.shells_of(app.pid)
        check(quit_anyway(app, window), "the app closes with the program running")
        until(lambda: not any(terminal.alive(pid) for pid, _name in running), 15)

        time.sleep(6.0)
        app, window, port = launched(exe, environment, args.identifier, port)
        back = window.run(
            "(() => { const tab = nib.workspace.tabs.find((one) => one.kind === 'terminal'); "
            "if (!tab) return null; nib.workspace.activate(tab.id); return tab.id })()"
        )
        check(isinstance(back, str), "the terminal comes back")
        before = prompted(window)
        check(before.endswith(">"), "with a fresh prompt")
        check(not reporting(window), "and the mouse not reported")
        moved(window)
        after = screen(window)
        say(f"restored prompt before the moves {before.splitlines()[-1]!r}, after {after.splitlines()[-1]!r}")
        check(after == before, "and the mouse moving over it types nothing")
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
