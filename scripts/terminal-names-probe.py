"""A terminal tab's name and mark in the packaged app: what runs in it, the title its
program set, a name of the reader's own, and that name after a restart.

Windows only. What the unit tests cannot answer is whether the real pieces meet: a
program started at a real PowerShell prompt, found in front by the crate's own walk of
the process tree (`pty_program`), a title it prints reaching xterm.js through the pseudo
console, and the prompt mark PowerShell is taught to make taking all of it away again.

Through the app's own automation endpoint with `eval` turned on, as terminal-probe.py
drives it:

* at the prompt the tab says **the shell and the folder**, and wears PowerShell's mark;
* `node` running says **`node · <folder>`** and wears Node's mark, and the shell's name
  comes back once it has finished;
* a program that **sets a title** (OSC 0) is called by it, and not after it has gone;
* a **double click** on the tab puts a field over its name, and the name typed there wins
  over a program's; **F2** with nothing typed gives it back;
* a name given **survives a restart**.

    python scripts/terminal-names-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says; `run_probe` starts it off the screen and
without the keyboard, and nothing here moves it or presses a real key.
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

from probe_app import close_app, main_window, run_probe

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SPACE = "Names probe"

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


def shown(window, tab: str) -> str:
    """What the strip says on the tab, off the page itself."""

    said = window.run(
        f"(() => {{ const label = document.querySelector('.pick[data-tab={json.dumps(tab)}] .label'); "
        "return label ? label.textContent : null })()"
    )
    return said if isinstance(said, str) else ""


def mark(window, tab: str) -> str:
    said = window.run(
        f"(() => {{ const one = document.querySelector('.pick[data-tab={json.dumps(tab)}] [data-mark]'); "
        "return one ? one.dataset.mark : null })()"
    )
    return said if isinstance(said, str) else ""


def named(window, tab: str, words: str, key: str = "Enter") -> bool:
    """The field over the tab's name, typed into and left with `key`."""

    up = until(
        lambda: window.run("!!document.querySelector('.tab input.field')") is True,
        5,
    )
    if not up:
        return False
    window.run(
        "(() => { const field = document.querySelector('.tab input.field'); "
        f"field.value = {json.dumps(words)}; field.dispatchEvent(new Event('input', {{ bubbles: true }})); "
        f"field.dispatchEvent(new KeyboardEvent('keydown', {{ key: {json.dumps(key)}, bubbles: true, cancelable: true }})); "
        "return true })()"
    )
    return True


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.terminal-names")
    parsed.add_argument("--shots", default=str(ROOT / "apps/desktop/test/e2e/shots/terminal-names-probe"))
    args = parsed.parse_args()

    exe = pathlib.Path(args.exe).resolve()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-terminal-names-"))
    folder = spaces / SPACE
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "A note.md").write_text("# A note\n", encoding="utf-8")
    # A program that only waits, and one that names its terminal the way Claude Code
    # does and then waits.
    (folder / "wait.js").write_text("setTimeout(() => {}, 6000);" + chr(10), encoding="utf-8")
    (folder / "titled.js").write_text(
        "process.stdout.write('\\x1b]0;\\u2733 Probe topic\\x07');\nsetTimeout(() => {}, 5000);\n",
        encoding="utf-8",
    )
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
        if not until(lambda: main_window(app.pid), 120, 0.25):
            raise SystemExit("the window never appeared")
        port, secret = tabs.endpoint(args.identifier, 150, unlike=was)
        window = terminal.Window(port, secret)
        until(lambda: window.run("1 + 1") == 2, 30)

        shells = window.invoke("terminal_shells", {})
        ids = [one.get("id") for one in shells] if isinstance(shells, list) else []
        ps = "pwsh" if "pwsh" in ids else "powershell"
        called = next(one.get("name") for one in shells if one.get("id") == ps)
        tab = window.open(ps, called, "names-probe")
        say(f"terminal tab {tab} ({ps})")
        ready = until(lambda: any(row.rstrip().endswith(">") for row in window.rows()), 40)
        check(bool(ready), "PowerShell draws its prompt")

        resting = f"{called} · {SPACE}"
        check(bool(until(lambda: shown(window, tab) == resting, 10)), f"at the prompt: {shown(window, tab)!r}")
        check(mark(window, tab) == "powershell", f"wearing PowerShell's mark ({mark(window, tab)})")

        # -- A program in front ----------------------------------------------------
        window.typed("node wait.js\r")
        running = until(lambda: shown(window, tab) == f"node · {SPACE}", 10)
        check(bool(running), f"node running: {shown(window, tab)!r}")
        check(bool(until(lambda: mark(window, tab) == "node", 5)), f"wearing Node's mark ({mark(window, tab)})")
        tabs.shoot(app.pid, shots / "names-node.png")
        back = until(lambda: shown(window, tab) == resting, 15)
        check(bool(back), f"and the shell's name once node has finished: {shown(window, tab)!r}")

        # -- A title -------------------------------------------------------------
        window.typed("node titled.js\r")
        titled = until(lambda: shown(window, tab) == "Probe topic", 10)
        check(bool(titled), f"a program's title, its glyph left off: {shown(window, tab)!r}")
        tabs.shoot(app.pid, shots / "names-title.png")
        gone = until(lambda: shown(window, tab) == resting, 15)
        check(bool(gone), f"and not once it has gone: {shown(window, tab)!r}")

        # -- A name of one's own ------------------------------------------------------
        window.run(
            f"(() => {{ document.querySelector('.pick[data-tab={json.dumps(tab)}]')"
            ".dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()"
        )
        check(named(window, tab, "builds"), "a double click puts a field over the name")
        check(bool(until(lambda: shown(window, tab) == "builds", 5)), f"renamed: {shown(window, tab)!r}")
        check(window.spec(tab).get("name") == "builds", "kept in the tab's words")
        window.typed("node titled.js\r")
        check(bool(until(lambda: mark(window, tab) == "node", 10)), "the mark still says what runs")
        time.sleep(1.5)
        check(shown(window, tab) == "builds", f"and the reader's name wins over the title: {shown(window, tab)!r}")
        tabs.shoot(app.pid, shots / "names-renamed.png")
        until(lambda: mark(window, tab) == "powershell", 15)

        window.run(
            f"(() => {{ document.querySelector('.pick[data-tab={json.dumps(tab)}]')"
            ".dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })); return true })()"
        )
        check(named(window, tab, ""), "F2 puts the field up too")
        cleared = until(lambda: shown(window, tab) == resting, 5)
        check(bool(cleared), f"and an empty name gives the tab back: {shown(window, tab)!r}")

        # -- A restart -----------------------------------------------------------
        window.run(
            f"(() => {{ document.querySelector('.pick[data-tab={json.dumps(tab)}]')"
            ".dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true })()"
        )
        named(window, tab, "kept")
        until(lambda: shown(window, tab) == "kept", 5)
        time.sleep(1.0)
        check(close_app(app), "the window closes")
        time.sleep(6.0)

        app = run_probe(exe, env=environment)
        if not until(lambda: main_window(app.pid), 120, 0.25):
            raise SystemExit("the window never came back")
        port, secret = tabs.endpoint(args.identifier, 150, unlike=port)
        window = terminal.Window(port, secret)
        until(lambda: window.run("1 + 1") == 2, 30)
        again = window.run(
            "(() => { const tab = nib.workspace.tabs.find((one) => one.kind === 'terminal'); "
            "return tab ? tab.id : null })()"
        )
        check(isinstance(again, str), "the terminal comes back after a restart")
        if isinstance(again, str):
            check(bool(until(lambda: shown(window, again) == "kept", 10)), f"under its name: {shown(window, again)!r}")
            tabs.shoot(app.pid, shots / "names-restored.png")
            window.run(f"nib.workspace.close({json.dumps(again)})")
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
