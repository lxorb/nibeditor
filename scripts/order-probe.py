"""The order the file list is read in, in the built app.

Seeds a space of sixty notes in nested folders in a temp folder of its own, launches
a probe build, photographs the panel in each of the seven orders, moves a row within
the order somebody arranged, and relaunches to prove the choice and the arrangement
came back off the disk rather than out of a store still in memory.

The pointer drag itself is not here: a window has no pointer to lend, so the gesture
is driven where a driver can hold one, against the same component in the same code -
see apps/desktop/test/e2e/tree-order.py, which lifts a row with a mouse and with a
finger. What this proves is the half that only a built app can answer: that the
orders read as they should in the shipped bundle, and that both halves of what is
remembered survive the process ending.

Windows only, and a probe build only: `--exe` must be a build made under its own
identifier, because the notes it writes go wherever `NIB_SPACES_DIR` says and the
settings folder it wipes is that identifier's.

    pnpm --dir apps/desktop tauri build --no-bundle --config '{"identifier":"ch.emilvinu.nib.probe.order"}'
    python scripts/order-probe.py --exe "<the built exe>"

An identifier of its own rather than the shared `ch.emilvinu.nib.probe`, because the
single-instance plugin keys on it: two drives holding probe builds under one
identifier hand off to each other, and the second one never gets a window.
"""

from __future__ import annotations

import argparse
import atexit
import ctypes
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

SPACES_DIR = "NIB_SPACES_DIR"
# What a reader does to a window. Asked for rather than killed, because a WebView
# writes its local storage to disk on its own schedule and on a clean shutdown: a
# process ended outright loses the last of what the app wrote down, which is exactly
# what a drive about what survives a relaunch must not do.
WM_CLOSE = 0x0010
SPACE = "Order"
SHOTS = pathlib.Path(__file__).resolve().parents[1] / "target" / "order-probe"

# The seven orders, and what each is called in the menu, so the log says what was
# pressed and not only what was stored.
ORDERS = [
    ("name", "Name, A to Z"),
    ("name-desc", "Name, Z to A"),
    ("modified-desc", "Modified, newest first"),
    ("modified-asc", "Modified, oldest first"),
    ("created-desc", "Created, newest first"),
    ("created-asc", "Created, oldest first"),
    ("manual", "Manual"),
]

user32 = ctypes.windll.user32 if sys.platform == "win32" else None
problems: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    problems.append(words)
    print(f"  WRONG: {words}", flush=True)


def windows_of(pid: int) -> list[int]:
    """Every top-level window of one process. A Tauri window is often not the one
    `MainWindowHandle` names, so they are enumerated."""
    assert user32 is not None
    found: list[int] = []
    proto = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    def each(hwnd: int, _lparam: int) -> bool:
        owner = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(proto(each), None)
    return found


def spaces_root() -> pathlib.Path:
    """A spaces root of this drive's own, in the temp area. Never `Documents/Nib`:
    the identifier a probe runs under says nothing at all about where the spaces
    are; see docs/automation.md."""
    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-order-probe-"))
    os.environ[SPACES_DIR] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made


# Sixty notes, in five folders, written in an order that is not their names' so that
# the created order and the name order cannot be the same answer by accident. `Note
# 2` and `Note 10` are the one thing a name order has to get right.
TOP = ["zeta", "Note 12", "Note 2", "Note 10", "Alpha", "Note 1", "beta", "Note 3"]
NESTED = {
    "Reading": ["Chapter two", "Chapter one", "Notes on it", "Later", "Earlier"],
    "Reading/Deep": ["Attention", "Residuals", "Scaling"],
    "Work": ["Q3 plan", "Budget", "Hiring", "Retro", "Offsite", "Roadmap"],
    "Work/Q3": ["Week 2", "Week 10", "Week 1", "Week 20"],
    "Archive": ["Last year", "Older still", "Oldest of all"],
}
# Filled out to sixty with numbered notes, so the window has more rows than it can
# draw and the drive is measuring a virtualised list.
FILLER = 60 - len(TOP) - sum(len(names) for names in NESTED.values())


def space() -> pathlib.Path:
    made = spaces_root() / SPACE
    made.mkdir(parents=True, exist_ok=True)

    def write(folder: pathlib.Path, name: str, at: float) -> None:
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{name}.md"
        path.write_text(f"# {name}\n\nwritten for the drive\n", encoding="utf-8")
        # Distinct times, a minute apart, in the order they are written: the order the
        # notes were made is then something the drive can say for itself.
        os.utime(path, (at, at))

    started = time.time() - 60 * 60 * 24
    step = 0
    for name in TOP:
        write(made, name, started + step * 60)
        step += 1
    for folder, names in NESTED.items():
        for name in names:
            write(made / folder, name, started + step * 60)
            step += 1
    for index in range(FILLER):
        write(made, f"Filler {index + 1}", started + step * 60)
        step += 1

    # And a handful written in again, long after, so the last-modified order is not
    # the order they were made in.
    later = time.time() - 60 * 5
    for name in ("Note 12", "Alpha"):
        path = made / f"{name}.md"
        path.write_text(f"# {name}\n\nwritten in again\n", encoding="utf-8")
        os.utime(path, (later, later))
        later += 60

    return made


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for one in (config_dir(identifier), local_dir(identifier)):
        shutil.rmtree(one, ignore_errors=True)


def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")


def allow_eval(identifier: str) -> None:
    """Turns on the one verb that can ask a question of the window. Between two
    launches, because the crate reads the flag when it opens the socket."""
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")


def act(port: int, secret: str, verb: str, args: dict[str, object], seconds: float = 90) -> object:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=seconds) as answer:
            return json.loads(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as refused:
        return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return {"ok": False, "error": f"no answer: {error}"}


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def ask(self, code: str, seconds: float = 90) -> object:
        said = act(self.port, self.secret, "eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value


def launch(exe: pathlib.Path, identifier: str, unlike: int = 0):
    """The app started, and the endpoint it wrote for this launch.

    `unlike` is the port the launch before it used: the file is rewritten every
    launch, and a read that arrives before the rewrite hands back a port nothing is
    listening on any more. Waiting for a port that is not the old one is what tells
    the two apart; see docs/automation.md."""
    app = subprocess.Popen([str(exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    port, secret = endpoint(identifier, 120, unlike)

    hwnd = 0
    until = time.perf_counter() + 120
    while time.perf_counter() < until and not hwnd:
        found = windows_of(app.pid)
        hwnd = found[0] if found else 0
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")

    assert user32 is not None
    user32.SetWindowPos(hwnd, None, 0, 0, 1280, 900, 0x0004)
    time.sleep(2.0)
    return app, App(port, secret), hwnd


def stop(app: subprocess.Popen, hwnd: int = 0) -> None:
    """The window asked to close, and the process killed only if it will not.

    Asked rather than killed, because what this drive is about is what survives the
    app ending: a WebView flushes its local storage on a clean shutdown, and a process
    ended outright loses the last of it - which is what made this run say an order had
    not survived when it had.

    Only ever the process this drive started, by its pid, and never by name: the
    reader's own app is running."""
    if hwnd and user32 is not None:
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
        try:
            app.wait(timeout=40)
            return
        except subprocess.TimeoutExpired:
            say("the window would not close when it was asked, so it is being ended")

    subprocess.run(
        ["taskkill", "/T", "/F", "/PID", str(app.pid)], capture_output=True, check=False
    )
    try:
        app.wait(timeout=30)
    except subprocess.TimeoutExpired:
        app.kill()


def shot(pid: int, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    script = pathlib.Path(__file__).resolve().parent / "capture-window.ps1"
    out = SHOTS / f"{name}.png"
    done = subprocess.run(
        ["powershell", "-NoProfile", "-File", str(script), "-Pid", str(pid), "-Out", str(out)],
        capture_output=True,
        text=True,
        check=False,
    )
    if done.returncode != 0:
        wrong(f"no picture of {name}: {done.stdout} {done.stderr}")
    else:
        say(f"wrote {out.name}: {(done.stdout or '').strip()}")


# The whole order of the top of the space, which is the app's own answer rather than
# the twenty rows that happen to be mounted.
TOP_NAMES = """JSON.stringify(nib.workspace.shownTree
  ? nib.workspace.shownTree.children.map((one) => one.name) : [])"""

KEPT = """JSON.stringify({
  mode: nib.workspace.sortMode,
  arranged: nib.workspace.arranged.of(nib.workspace.activeSpace.root),
  files: nib.workspace.files.length,
})"""


def showing(app: App) -> None:
    """The file list on screen. Asked for only when something else is there: pressing
    the tab of the panel already showing is what closes the sidebar, and a relaunch
    comes back with the panel it was left on."""
    app.ask("nib.workspace.panel === 'tree' ? true : nib.workspace.showPanel('tree')")
    time.sleep(0.8)


def ready(app: App) -> None:
    until = time.perf_counter() + 90
    while time.perf_counter() < until:
        held = app.ask("JSON.stringify(nib.workspace.files.length)")
        if isinstance(held, int) and held >= 50:
            return
        time.sleep(0.5)
    wrong(f"the space never came up: {app.ask(KEPT)}")


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    # An identifier of this drive's own rather than the shared `ch.emilvinu.nib.probe`:
    # the single-instance plugin keys on it, so two drives running probe builds under
    # one identifier hand off to each other and the second never gets a window.
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.order")
    args = parsed.parse_args()

    if not args.exe.exists():
        raise SystemExit(f"no exe at {args.exe}")

    made = space()
    say(f"the space is {made}")
    wipe(args.identifier)
    shutil.rmtree(SHOTS, ignore_errors=True)

    # The first launch only writes automation.json; `eval` is read when the socket
    # opens, so it is turned on between two launches.
    app, first, hwnd = launch(args.exe, args.identifier)
    stop(app, hwnd)
    allow_eval(args.identifier)
    say(f"eval is on for the probe identifier, whose first launch listened on {first.port}")

    app, talk, hwnd = launch(args.exe, args.identifier, first.port)
    was_on = talk.port
    arranged_order: list[str] = []
    try:
        ready(talk)
        showing(talk)

        orders: dict[str, list[str]] = {}
        for mode, label in ORDERS:
            talk.ask(f"nib.workspace.setSort({mode!r})")
            time.sleep(0.5)
            names = talk.ask(TOP_NAMES)
            if not isinstance(names, list):
                wrong(f"{mode}: no order came back: {names}")
                continue
            orders[mode] = names
            say(f"{label}: {' | '.join(names[:12])}")
            shot(app.pid, f"order-{mode}")

        folders = ["Archive", "Reading", "Work"]
        for mode, names in orders.items():
            if sorted(names[:3]) != folders:
                wrong(f"{mode} did not put the folders first: {names[:3]}")
        by_name = orders.get("name", [])
        if "Note 2.md" in by_name and by_name.index("Note 2.md") > by_name.index("Note 10.md"):
            wrong("Note 10 came before Note 2, so the digits were spelled rather than counted")
        if orders.get("modified-desc") == orders.get("created-desc"):
            wrong("the modified order and the created order were the same list")
        if orders.get("manual") != by_name:
            wrong("Manual did not start out as name order for a space nobody has arranged")

        # A row moved within the order somebody arranged, through the same call the
        # Alt and an arrow keys make; see `moveInOrder` in workspace.svelte.ts.
        talk.ask("nib.workspace.setSort('manual')")
        time.sleep(0.3)
        before = talk.ask(TOP_NAMES)
        moved = talk.ask(
            "JSON.stringify(nib.workspace.moveInOrder("
            "nib.workspace.activeSpace.root + '\\\\zeta.md', -1))"
        )
        time.sleep(0.6)
        after = talk.ask(TOP_NAMES)
        say(f"moving zeta up said {moved}")
        say(f"after: {' | '.join(after[:12]) if isinstance(after, list) else after}")
        if moved is not True:
            wrong(f"the move was refused: {moved}")
        if before == after:
            wrong("the move changed nothing")
        if isinstance(after, list):
            arranged_order = after
        shot(app.pid, "order-arranged")

        kept = talk.ask(KEPT)
        say(f"kept: {json.dumps(kept, ensure_ascii=False)}")
        if not isinstance(kept, dict) or not kept.get("arranged"):
            wrong(f"nothing was written down for the space: {kept}")

        # A moment for the store's own settling timer, so what reaches the disk is
        # everything the gesture wrote; see SETTLING in workspace/arranged.svelte.ts.
        time.sleep(1.5)
    finally:
        stop(app, hwnd)

    # And again, from cold: both halves of what is remembered are read off this
    # machine rather than held in a store that never went away.
    app, talk, hwnd = launch(args.exe, args.identifier, was_on)
    try:
        ready(talk)
        showing(talk)

        kept = talk.ask(KEPT)
        names = talk.ask(TOP_NAMES)
        say(f"after a relaunch: {json.dumps(kept, ensure_ascii=False)}")
        say(f"the order is {' | '.join(names[:12]) if isinstance(names, list) else names}")

        if not isinstance(kept, dict) or kept.get("mode") != "manual":
            wrong(f"the chosen order did not survive the relaunch: {kept}")
        if arranged_order and names != arranged_order:
            wrong(f"the arranged order did not survive:\n  was {arranged_order}\n  now {names}")
        shot(app.pid, "order-relaunched")
    finally:
        stop(app, hwnd)

    if problems:
        print("\n%d thing(s) were wrong:" % len(problems), flush=True)
        for one in problems:
            print(f"  - {one}", flush=True)
        return 1

    print(f"\nthe built app read the space seven ways and kept the seventh; shots in {SHOTS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
