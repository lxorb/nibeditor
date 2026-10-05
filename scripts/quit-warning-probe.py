"""Quitting with a terminal running something, in the packaged app: nib's own question
names the busy terminal and not the idle one, Cancel and a row keep the app running,
Quit anyway ends it with every shell, and the next launch puts both terminals back - and
quits without a word, since nothing runs in them yet.

Windows only. Emil, 2026-10-05: *"When you want to close nib, it should give you a warning
about the terminal windows ... not just open, but the ones running something, e.g.
claude."* A `ping` stands in for Claude Code: a program the shell started, as Claude Code
is.

    python scripts/quit-warning-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Every launch is `run_probe`'s, off the screen and without the keyboard. The window is
closed the way its close button closes it (WM_CLOSE); the question is answered through
the page, never with the real mouse.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import time

from probe_app import WM_CLOSE, close_app, main_window, run_probe, user32

HERE = pathlib.Path(__file__).resolve().parent

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

#: A program the shell starts and waits on, for ten minutes.
BUSY = "ping -n 600 127.0.0.1 > $null"


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


def asking(window) -> dict | None:
    """The question while it is up: its title and the names of its rows."""

    said = window.run(
        "(() => { const sheet = document.querySelector('[role=\"alertdialog\"]:not([inert])'); "
        "if (!sheet) return null; return JSON.stringify({ "
        "title: sheet.querySelector('.title')?.textContent ?? '', "
        "rows: [...sheet.querySelectorAll('.rows .name')].map((one) => one.textContent) }) })()"
    )
    try:
        return json.loads(said) if isinstance(said, str) else None
    except ValueError:
        return None


def press(window, selector: str) -> None:
    window.run(
        f"(() => {{ document.querySelector('[role=\"alertdialog\"]:not([inert]) {selector}')?.click(); return true }})()"
    )


def closed_by_hand(app) -> None:
    """The window's close button, pressed: WM_CLOSE, without waiting for the end."""

    hwnd = main_window(app.pid)
    if hwnd:
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)


def active(window) -> str:
    return str(window.run("nib.workspace.activeTabId"))


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
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.quitwarning")
    args = parsed.parse_args()
    exe = pathlib.Path(args.exe).resolve()

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-quit-"))
    (spaces / "Quit probe").mkdir(parents=True, exist_ok=True)
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

        busy = window.open(shell, "PowerShell", "probe-quit-busy")
        check(bool(until(lambda: any(row.rstrip().endswith(">") for row in window.rows()), 40)), "the first shell draws its prompt")
        window.typed(f"echo quit-probe-marker; {BUSY}\r")
        time.sleep(3.0)

        idle = window.open(shell, "PowerShell", "probe-quit-idle")
        check(bool(until(lambda: any(row.rstrip().endswith(">") for row in window.rows()), 40)), "the second shell draws its prompt")
        time.sleep(2.0)
        busy_name = window.run(f"nib.workspace.tabs.find((one) => one.id === {json.dumps(busy)})?.shown")
        say(f"busy tab {busy} is called {busy_name!r}, idle tab {idle}")

        # The close button: the question, naming the busy one only.
        closed_by_hand(app)
        question = until(lambda: asking(window), 15)
        say(f"asked {question}")
        check(bool(question), "closing the window asks")
        if question:
            check(question["title"].startswith("Quit"), "as quitting, the window being the last")
            check(question["rows"] == [busy_name], "naming the busy terminal and not the idle one")

        # Cancel: nothing stops.
        press(window, ".nib-button.is-quiet")
        time.sleep(1.5)
        check(app.poll() is None and asking(window) is None, "Cancel keeps the app running")
        check(window.open_tabs().count(busy) == 1 and idle in window.open_tabs(), "with both terminals")

        # A row: the quit is off, and the busy terminal is in front.
        until(lambda: asking(window) is None, 10)
        closed_by_hand(app)
        until(lambda: asking(window), 15)
        press(window, ".rows button")
        check(bool(until(lambda: active(window) == busy, 5)), "pressing the row goes to its terminal")
        check(app.poll() is None, "and keeps the app running")

        # Quit anyway: every shell goes with the app. Once the last question has gone: a
        # sheet on its way out is inert, and answers nothing.
        until(lambda: asking(window) is None, 10)
        running = terminal.shells_of(app.pid)
        closed_by_hand(app)
        until(lambda: asking(window), 15)
        press(window, ".nib-button.is-danger")
        started = time.perf_counter()
        try:
            app.wait(timeout=90)
            say(f"ended in {time.perf_counter() - started:.1f} s")
            ended = True
        except Exception:  # noqa: BLE001 - the timeout, whichever module raised it
            ended = False
        check(ended, "Quit anyway ends the app")
        gone = until(lambda: not any(terminal.alive(pid) for pid, _name in running), 15)
        check(bool(gone), f"and every shell with it (were {running})")

        # The next launch puts both back, and quits without a word: nothing runs yet.
        time.sleep(6.0)
        app, window, port = launched(exe, environment, args.identifier, port)
        back = window.run("JSON.stringify(nib.workspace.tabs.filter((one) => one.kind === 'terminal').length)")
        check(back == "2", f"both terminals come back ({back})")
        window.run(
            "(() => { const tab = nib.workspace.tabs.find((one) => one.kind === 'terminal' "
            "&& one.doc.includes('probe-quit-busy')); if (tab) nib.workspace.activate(tab.id); return true })()"
        )
        until(lambda: any(row.rstrip().endswith(">") for row in window.rows()), 30)
        restored = any("quit-probe-marker" in row for row in terminal.above(window))
        check(bool(restored), "the busy one with its last lines")
        time.sleep(3.0)
        check(close_app(app, 30), "with nothing running, the window closes asking nothing")
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
