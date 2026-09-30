"""A terminal put back by a restart, in the packaged app: the lines it had, the folder it
was in, and its place in the strip - and nothing of its screen left anywhere once it closes.

Windows only. What the unit and effect tests cannot answer is whether the pieces meet on a
real disk and a real console: the lines written as the window goes and waited for, read
back by the next launch, drawn above a fresh Command Prompt that the pseudo console did not
paint over, the prompt in the folder the old one was in.

    python scripts/terminal-restore-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says. Every launch is `run_probe`'s: off the screen,
never taking the keyboard, with `NIB_SPACES_DIR` in a folder of this run's own. The app is
closed the way a person closes it, and nothing is ended by name.
"""

from __future__ import annotations

import argparse
import ctypes
import importlib.util
import json
import os
import pathlib
import secrets
import sys
import tempfile
import time
from ctypes import wintypes

from probe_app import close_app, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SPACE = "Restore probe"

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


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


def strip(window) -> list[list[str]]:
    """Every tab of the strip, in order: its kind and its name."""

    said = window.run("JSON.stringify(nib.workspace.tabs.map((one) => [one.kind, one.name]))")
    return json.loads(said) if isinstance(said, str) else []


def histories(identifier: str) -> list[pathlib.Path]:
    """Every history file the app keeps; see src-tauri/src/terminal/history.rs."""

    folder = tabs.local_dir(identifier) / "terminal"
    return sorted(folder.rglob("*.json")) if folder.exists() else []


def holding(paths: list[pathlib.Path], words: str) -> list[pathlib.Path]:
    return [path for path in paths if words in path.read_text(encoding="utf-8", errors="replace")]


def paged(window, key: str, code: int, times: int) -> None:
    """Shift and a paging key, pressed where the terminal has the keyboard: xterm.js's own
    way through its scrollback."""

    window.run(
        "(() => { const field = document.querySelector('.xterm-helper-textarea'); "
        f"for (let i = 0; i < {times}; i++) {{ "
        f"const press = new KeyboardEvent('keydown', {{ key: {json.dumps(key)}, code: {json.dumps(key)}, shiftKey: true, bubbles: true, cancelable: true }}); "
        f"Object.defineProperty(press, 'keyCode', {{ get: () => {code} }}); field.dispatchEvent(press) }} "
        "return true })()"
    )
    time.sleep(0.5)


def above(window) -> list[str]:
    """The rows at the top of the terminal's scrollback, where a restart on Windows puts
    what the screen had (see `restoredAbove` in lib/terminal/history.ts): paged up to the
    top, read, and paged back down to the prompt."""

    paged(window, "PageUp", 33, 20)
    rows = window.rows()
    paged(window, "PageDown", 34, 20)
    return rows


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
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.terminal-restore")
    parsed.add_argument("--shots", default=str(ROOT / "apps/desktop/test/e2e/shots/terminal-restore-probe"))
    args = parsed.parse_args()

    exe = pathlib.Path(args.exe).resolve()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-restore-"))
    (spaces / SPACE).mkdir(parents=True, exist_ok=True)
    (spaces / SPACE / "Before.md").write_text("# Before\n\nWords.\n", encoding="utf-8")
    (spaces / SPACE / "After.md").write_text("# After\n\nWords.\n", encoding="utf-8")
    # Where the shell goes: outside every space, with a space in its name.
    here = pathlib.Path(tempfile.mkdtemp(prefix="nib restore here "))
    marker = f"nib-marker-{secrets.token_hex(4)}"
    say(f"spaces root {spaces}, shell goes to {here}, marker {marker}")

    tabs.wipe(args.identifier)
    environment = {**os.environ, "NIB_SPACES_DIR": str(spaces)}

    # Twice: the first launch writes the file `eval` is turned on in; see new-tabs-probe.py.
    first = run_probe(exe, env=environment)
    was, _ = tabs.endpoint(args.identifier, 150)
    tabs.allow_eval(args.identifier)
    first.terminate()
    first.wait(timeout=15)
    time.sleep(6.0)

    app, window, port = launched(exe, environment, args.identifier, was)
    try:
        say(f"pid {app.pid}, endpoint {port}")

        # A note, the terminal, a note: the terminal in the middle of the strip.
        root = window.run("nib.workspace.activeSpace ? nib.workspace.activeSpace.root : null")
        for name in ("Before.md", "After.md"):
            window.run(f"nib.workspace.openEntry({json.dumps(str(pathlib.Path(str(root)) / name))}).then(() => true)")
            until(lambda n=name: any(tab[1] == n.removesuffix(".md") for tab in strip(window)), 10)
        cmd = str(
            window.run(
                "(() => { const ws = nib.workspace; "
                f"ws.openUnsaved('terminal', JSON.stringify({{ shell: 'cmd', folder: {json.dumps(root)}, key: 'probe-restore' }}), "
                "'Command Prompt', ws.tabs[0].id); return ws.activeTabId })()"
            )
        )
        say(f"terminal tab {cmd}")
        before = strip(window)
        say(f"strip before: {before}")
        check(
            [tab[0] for tab in before] == ["note", "terminal", "note"],
            "the terminal sits between the two notes",
        )

        prompt = until(lambda: any(row.endswith(">") for row in window.rows()), 30)
        check(bool(prompt), "Command Prompt draws its prompt")
        window.typed(f'cd /d "{here}"\r')
        moved = until(lambda: str(window.spec(cmd).get("folder", "")).rstrip("\\") == str(here), 10)
        check(bool(moved), f"the tab's folder follows the cd ({window.spec(cmd).get('folder')})")
        window.typed(f"echo {marker}\r")
        check(bool(until(lambda: marker in window.rows(), 10)), "the marker is on the screen")

        # Written down once the output rests, into the app's own folder and nowhere else.
        kept = until(lambda: holding(histories(args.identifier), marker), 10)
        check(bool(kept), f"its lines are written into the app's data folder ({kept})")
        leaked = [path for path in spaces.rglob("*") if path.is_file() and marker in path.read_text(errors="replace")]
        check(not leaked, f"and into no space ({leaked})")

        # And a line printed the moment before the window goes, long before the output
        # could rest: written as the window goes, which waits for it.
        last = f"{marker}-last"
        window.typed(f"echo {last}\r")
        check(bool(until(lambda: last in window.rows(), 5, 0.05)), "a last line is on the screen")
        running = terminal.shells_of(app.pid)
        started = time.perf_counter()
        check(close_app(app), "the window closes the way a person closes it")
        say(f"closed in {time.perf_counter() - started:.2f} s")
        ended = until(lambda: not any(terminal.alive(pid) for pid, _name in running), 15)
        check(bool(ended), f"no shell outlives the app (were {running})")
        check(bool(holding(histories(args.identifier), last)), "the last line is on the disk as the app goes")

        time.sleep(6.0)
        app, window, port = launched(exe, environment, args.identifier, port)
        after = strip(window)
        say(f"strip after: {after}")
        check(after == before, "every tab is back, in the same place")

        back = window.run(
            "(() => { const tab = nib.workspace.tabs.find((one) => one.kind === 'terminal'); "
            "if (!tab) return null; nib.workspace.activate(tab.id); return tab.id })()"
        )
        check(isinstance(back, str), "the terminal tab comes back")
        if isinstance(back, str):
            fresh = until(lambda: any(row.endswith(f"{here}>") for row in window.rows()), 30)
            check(bool(fresh), f"a fresh prompt in {here}")
            first = window.rows()[:1]
            check(
                bool(first) and first[0].startswith("Restored "),
                f"under one line saying when, the screen's first row ({first})",
            )
            history = above(window)
            check(last in history and marker in history, "the marker and the last line are in the restored buffer")
            if fresh:
                window.typed("echo %CD%\r")
                said = until(lambda: sum(row == str(here) for row in window.rows()) >= 1, 10)
                check(bool(said), "the new shell's own folder is the one the old one was in")
            check(str(window.spec(back).get("folder", "")).rstrip("\\") == str(here), "and so is the tab's")
            tabs.shoot(app.pid, shots / "terminal-restored.png")

            # A narrower window: the pseudo console repaints, the history stays.
            hwnd = main_window(app.pid)
            box = wintypes.RECT()
            ctypes.WinDLL("user32").GetWindowRect(hwnd, ctypes.byref(box))
            sized(hwnd, int((box.right - box.left) * 0.7), box.bottom - box.top)
            time.sleep(1.5)
            narrow = window.rows()
            check(any(row.startswith("Restored ") for row in narrow), "the line saying when is still there after the window narrows")
            history = above(window)
            check(last in history and marker in history, "and so is the history above it")
            tabs.shoot(app.pid, shots / "terminal-restored-narrow.png")

            # Closing the tab takes its file with it; Reopen closed tab brings the lines back
            # from memory, and they are written down again once the new shell has spoken.
            running = terminal.shells_of(app.pid)
            window.run(f"nib.workspace.close({json.dumps(back)})")
            gone = until(lambda: not holding(histories(args.identifier), marker), 10)
            check(bool(gone), "closing the tab removes its lines from the disk")
            window.run("nib.workspace.reopenClosed().then(() => true)")
            again = until(
                lambda: window.run(
                    "(() => { const tab = nib.workspace.tabs.find((one) => one.kind === 'terminal'); "
                    "if (!tab) return null; nib.workspace.activate(tab.id); return tab.id })()"
                ),
                10,
            )
            check(isinstance(again, str), "Reopen closed tab brings the terminal back")
            check(
                bool(until(lambda: any(row.endswith(f"{here}>") for row in window.rows()), 30)),
                "with a fresh prompt",
            )
            check(marker in above(window), "and its lines, from memory")
            check(bool(until(lambda: holding(histories(args.identifier), marker), 15)), "written down again")
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
