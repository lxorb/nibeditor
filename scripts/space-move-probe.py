"""Move to space, in the packaged app: a terminal moved to another space is the same shell.
Windows only.

Emil, 2026-10-03: *"It should be possible to move a tab to another space (e.g. relevant
for terminal tabs that you can't just close and reopen without losing progress)."*

Two spaces, Work and Home, each keeping its own tabs. In Work, a note and a Command
Prompt that has printed a line of its own. Then, through the tab's own menu - the right
click on the tab, Move to space, its chevron, Home - as a person does it:

* the window stays in Work, and the terminal leaves Work's strip;
* the Command Prompt is the same process: the same PID, and no second shell started;
* Home shown, the terminal is in front with the line it printed still on its screen, and
  it answers the next command - the same pty, read and written;
* its last lines are kept under Home's folder now and nothing is left under Work's;
* the note moved the same way is a file in Home's folder and none in Work's.

The menu with its chevron's list is photographed, in the light and in the dark.

    python scripts/space-move-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says. Every launch goes through `run_probe` (by
web-switch-probe.py's `launch`), off every screen and never taking the keyboard; the app
is driven through its automation endpoint's `eval`, turned on in the probe identifier's
own endpoint file, and every press is an event dispatched in the page, never the mouse.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import shutil
import sys
import time

from probe_app import close_app

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


switch = borrowed("switch", "web-switch-probe.py")
terminal = borrowed("terminal", "terminal-probe.py")
tabs_probe = borrowed("space_tabs", "space-tabs-probe.py")
until = terminal.until
ask = tabs_probe.ask
SWITCHES = tabs_probe.SWITCHES

MARK = "moved-with-its-shell"
AFTER = "still-the-same-shell"
KEY = "space-move-probe"


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


def cmd_of(pid: int) -> list[int]:
    return sorted(one for one, name in terminal.shells_of(pid) if name == "cmd.exe")


def rows(app) -> list[str]:
    said = ask(
        app,
        "JSON.stringify([...document.querySelectorAll('.xterm-rows > div')]"
        ".map((row) => row.textContent.replace(/\\u00a0/g, ' ').trimEnd()))",
    )
    return said if isinstance(said, list) else []


def typed(app, words: str) -> None:
    ask(
        app,
        "(() => { const field = document.querySelector('.xterm-helper-textarea'); "
        f"field.dispatchEvent(new InputEvent('input', {{ data: {json.dumps(words)}, inputType: 'insertText', bubbles: true }})); "
        "return true })()",
    )


def shown(app) -> dict:
    said = ask(app, tabs_probe.SHOWN)
    return said if isinstance(said, dict) else {}


def menu_on(app, tab: str) -> object:
    """The tab's own menu, opened by a right click dispatched on it."""

    return ask(
        app,
        f"(() => {{ const tab = document.querySelector('[data-tab=\"' + CSS.escape({json.dumps(tab)}) + '\"]'); "
        "if (!tab) return 'no tab'; const box = tab.getBoundingClientRect(); "
        "tab.dispatchEvent(new MouseEvent('contextmenu', { clientX: box.left + 10, clientY: box.bottom, button: 2, bubbles: true, cancelable: true })); "
        "return 'opened' })()",
    )


def menu_rows(app) -> list[str]:
    said = ask(
        app,
        "JSON.stringify([...document.querySelectorAll('.menu .nib-row .nib-row-label')].map((one) => one.textContent.trim()))",
    )
    return said if isinstance(said, list) else []


def chevron_of(app, label: str) -> object:
    """The chevron at the end of a menu's row: the row's alternatives."""

    return ask(
        app,
        "(() => { const row = [...document.querySelectorAll('.menu .nib-row')]"
        f".find((one) => one.querySelector('.nib-row-label')?.textContent.trim() === {json.dumps(label)}); "
        "const more = row && row.querySelector('[data-more]'); if (!more) return 'no chevron'; "
        "more.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return 'shown' })()",
    )


def press_row(app, label: str) -> object:
    return ask(
        app,
        "(() => { const row = [...document.querySelectorAll('.menu .nib-row')]"
        f".find((one) => one.querySelector('.nib-row-label')?.textContent.trim() === {json.dumps(label)}); "
        "if (!row) return 'no row'; row.click(); return 'pressed' })()",
    )


def moved_by_menu(app, tab: str, space: str, shots: pathlib.Path | None, identifier: str) -> None:
    """Move to space, its chevron, the space: the tab's own menu, as a person uses it."""

    check(menu_on(app, tab) == "opened", "the tab's menu opens")
    time.sleep(0.6)
    check("Move to space" in menu_rows(app), f"it offers Move to space ({menu_rows(app)})")
    check(chevron_of(app, "Move to space") == "shown", "its chevron lists the spaces")
    time.sleep(0.6)
    listed = menu_rows(app)
    check(space in listed, f"the list holds {space} ({listed})")
    if shots is not None:
        for scheme in ("light", "dark"):
            ask(app, f"(document.documentElement.dataset.theme = {json.dumps(scheme)}, 'set')")
            time.sleep(0.4)
            tabs_probe.shoot(identifier, shots / f"move-to-space-{scheme}.png")
        ask(app, "(delete document.documentElement.dataset.theme, 'reset')")
    check(press_row(app, space) == "pressed", f"{space} pressed")
    time.sleep(1.5)


def histories(identifier: str, space: str) -> list[str]:
    folder = switch.local_dir(identifier) / "terminal" / space
    return sorted(one.name for one in folder.glob("*.json")) if folder.exists() else []


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.space-move")
    parsed.add_argument("--shots", default=str(ROOT / "apps/desktop/test/e2e/shots/space-move-probe"))
    args = parsed.parse_args()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)

    switch.wipe(args.identifier)
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = SWITCHES
    root = switch.spaces_root()
    for name in ("Work", "Home"):
        shutil.rmtree(root / name, ignore_errors=True)
        (root / name).mkdir(parents=True)
    (root / "Work" / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (root / "Home" / "A note.md").write_text("# A note\n", encoding="utf-8")

    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        ids = until(
            lambda: (lambda said: said if isinstance(said, dict) and {"Work", "Home"} <= set(said) else None)(
                ask(app, tabs_probe.IDS)
            ),
            60,
        )
        if not isinstance(ids, dict):
            raise SystemExit(f"the two spaces are not there: {ids}")
        work, home = str(ids["Work"]), str(ids["Home"])
        say(f"Work {work}, Home {home}")

        ask(app, f"localStorage.setItem('nib:space-tabs', {json.dumps(json.dumps({work: 'space', home: 'space'}))}) || 'kept'")
        ask(app, "localStorage.setItem('nib:hidden-tabs', '\"run\"') || 'kept'")
        tabs_probe.to_space(app, home)
        tabs_probe.to_space(app, work)

        idea = json.dumps(str(root / "Work" / "Idea.md"))
        ask(app, f"nib.workspace.openEntry({idea}).then(() => 'idea')")
        tab = ask(
            app,
            "(() => { const ws = nib.workspace; "
            f"ws.openUnsaved('terminal', JSON.stringify({{ shell: 'cmd', folder: ws.activeSpace.root, key: {json.dumps(KEY)} }}), 'Command Prompt'); "
            "return ws.activeTabId })()",
        )
        tab = str(tab)
        prompt = until(lambda: any(row.endswith(">") for row in rows(app)), 30)
        check(bool(prompt), "the Command Prompt in Work draws its prompt")
        typed(app, f"echo {MARK}\r")
        printed = until(lambda: MARK in rows(app), 20)
        check(bool(printed), "and prints a line of its own")
        before = until(lambda: cmd_of(running.pid), 20)
        say(f"Command Prompt PIDs before the move: {before}")
        check(len(before) == 1, "one shell runs")
        # The output rests, and its lines are written down under Work.
        until(lambda: histories(args.identifier, work), 10)
        check(bool(histories(args.identifier, work)), f"its last lines are kept under Work ({histories(args.identifier, work)})")

        moved_by_menu(app, tab, "Home", shots, args.identifier)

        in_work = shown(app)
        say(f"Work after the move: {in_work}")
        check(in_work.get("space") == "Work", "the window stays in Work")
        check(
            not any(one.startswith("terminal") for one in in_work.get("tabs", [])),
            "and the terminal has left Work's strip",
        )
        check(ask(app, f"nib.workspace.tabs.some((one) => one.id === {json.dumps(tab)})") is True, "the tab itself is still open")
        after = cmd_of(running.pid)
        check(after == before, f"the same Command Prompt runs: {before} then {after}")
        time.sleep(1)
        check(histories(args.identifier, home) == [f"{KEY}.json"], f"its lines are under Home now ({histories(args.identifier, home)})")
        check(histories(args.identifier, work) == [], f"and nothing is left under Work ({histories(args.identifier, work)})")

        tabs_probe.to_space(app, home)
        in_home = shown(app)
        say(f"Home: {in_home}")
        check("terminal Command Prompt" in in_home.get("tabs", []), "Home holds the terminal")
        check(ask(app, "nib.workspace.active ? nib.workspace.active.kind : null") == "terminal", "in front")
        kept = until(lambda: MARK in "\n".join(rows(app)), 15)
        check(bool(kept), "with the line it printed still on its screen")
        typed(app, f"echo {AFTER}\r")
        answered = until(lambda: sum(AFTER in row for row in rows(app)) >= 2, 20)
        check(bool(answered), "and it answers the next command")
        check(cmd_of(running.pid) == before, f"still the one shell ({cmd_of(running.pid)})")
        tabs_probe.shoot(args.identifier, shots / "home-terminal.png")

        # The note, moved the same way: its file goes with it.
        tabs_probe.to_space(app, work)
        note = ask(app, "(() => { const tab = nib.workspace.tabs.find((one) => one.name === 'Idea.md'); return tab ? tab.id : null })()")
        if isinstance(note, str):
            moved_by_menu(app, note, "Home", None, args.identifier)
            check(bool(until(lambda: (root / "Home" / "Idea.md").exists(), 10)), "the note's file is in Home's folder")
            check(not (root / "Work" / "Idea.md").exists(), "and gone from Work's")
            check(
                "".join(shown(app).get("tabs", [])).find("Idea") < 0,
                f"and its tab left Work's strip ({shown(app).get('tabs')})",
            )
        else:
            check(False, "the note's tab is open")
    finally:
        if running is not None and not close_app(running):
            running.terminate()

    print("PASS" if not failures else f"FAIL: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
