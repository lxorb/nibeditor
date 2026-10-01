"""Each space's own tabs and Hidden tabs, in the packaged app. Windows only.

Emil, 2026-10-01: *"there should be an option whether the tabs are global or only for the
space"* and *"a setting whether the stuff is paused when you switch to another space or
whether it keeps running in the background."*

Two spaces. Work keeps its own tabs (Tabs: Space in its menu) and Home shares the global
ones. In Work, a note, a page whose clock tells this probe's server every fifth of a
second that it is still running, and a terminal. Then:

* **Keep running**: Home on screen, and the page out of sight goes on ticking; the
  shell goes on running; Work comes back with its three tabs.
* **A restart**, the app closed the way a person closes it on Home: Home comes back on
  screen with its own tabs, and Work's are built back behind it; Work shown again has
  its note, its page - ticking again - and its terminal.
* **Pause**: Home on screen, and the page's clock stops within a moment and stays
  stopped while the shell still runs; Work shown again, and the clock goes on from where
  it was.
* The Hidden tabs row in Settings, photographed in the light and in the dark.

    python scripts/space-tabs-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says. Every launch goes through `run_probe`, off
every screen and never taking the keyboard, and the app is driven through its automation
endpoint's `eval`, which the probe turns on in its own identifier's endpoint file.
"""

from __future__ import annotations

import argparse
import base64
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import sys
import threading
import time

from devtools import SWITCHES, Session, port, targets
from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent


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
until = terminal.until

failures: list[str] = []

#: A page that says it is running: every fifth of a second it asks this probe's server for
#: the next number, so a page frozen by the engine is a page that stops asking.
CLOCK = b"""<!doctype html>
<title>Clock</title>
<body style="margin:0;font:48px system-ui;display:grid;place-items:center;height:100vh">
<b id="n">0</b>
<script>
let n = 0
setInterval(() => {
  n += 1
  document.getElementById('n').textContent = n
  fetch('/tick?' + n).catch(() => {})
}, 200)
</script>
"""


class Ticks:
    """When the page last asked, and what it last said."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.at: list[float] = []
        self.last = 0

    def heard(self, number: int) -> None:
        with self.lock:
            self.at.append(time.perf_counter())
            self.last = number

    def since(self, moment: float) -> int:
        with self.lock:
            return sum(1 for one in self.at if one >= moment)


def serve(port: int, ticks: Ticks) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            if self.path.startswith("/tick?"):
                ticks.heard(int(self.path.split("?", 1)[1] or 0))
                body = b"ok"
            else:
                body = CLOCK
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = switch.Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


def ask(app, code: str, seconds: float = 60) -> object:
    """What the window answers, asked again while it is still coming up."""
    end = time.perf_counter() + seconds
    said: object = None
    while time.perf_counter() < end:
        said = app.ask(code)
        if not (isinstance(said, dict) and "error" in said):
            return said
        time.sleep(0.5)
    return said


#: Each space's id, by name.
IDS = "JSON.stringify(Object.fromEntries(nib.workspace.spaces.map((one) => [one.name, one.id])))"

#: What is on screen: the space, and the tabs of the panes on screen, by kind and name.
SHOWN = """JSON.stringify((() => {
  const ws = nib.workspace
  return {
    space: ws.activeSpace ? ws.activeSpace.name : null,
    tabs: ws.panes.all.flatMap((pane) => ws.tabsIn(pane.id).map((one) => one.kind + ' ' + one.name)),
    all: ws.tabs.length,
  }
})())"""


def cmd_of(pid: int) -> list[tuple[int, str]]:
    """The command prompts below the app: the shell itself, not the console host, which
    comes and goes around it."""
    return [one for one in terminal.shells_of(pid) if one[1].lower() == "cmd.exe"]


def shown(app) -> dict:
    said = ask(app, SHOWN)
    return said if isinstance(said, dict) else {}


def to_space(app, space: str) -> None:
    ask(app, f"nib.workspace.showSpace({json.dumps(space)}).then(() => 'shown')")
    time.sleep(0.6)


def ticking(ticks: Ticks, seconds: float) -> int:
    """How many times the page asked over the next few seconds."""
    start = time.perf_counter()
    time.sleep(seconds)
    return ticks.since(start)


def front(app, kind: str) -> object:
    return ask(
        app,
        f"(() => {{ const tab = nib.workspace.tabs.find((one) => one.kind === {json.dumps(kind)}); "
        "if (!tab) return null; nib.workspace.activate(tab.id); return tab.id })()",
    )


def shoot(identifier: str, out: pathlib.Path) -> None:
    """The app's own page as its engine draws it (`Page.captureScreenshot`): a window off
    every screen has no picture of its own to hand over. See web-lease-probe.py."""
    at = port(switch.local_dir(identifier) / "EBWebView")
    page = next(
        (one for one in (targets(at) if at else []) if str(one.get("url", "")).startswith("http://tauri.localhost")),
        None,
    )
    if page is None:
        say(f"no picture of {out.name}: the app's page has no debugging port")
        return
    session = Session(page)
    try:
        said = session.call("Page.captureScreenshot", {"format": "png"})
        if "data" in said:
            out.write_bytes(base64.b64decode(said["data"]))
    finally:
        session.close()


def settings_shot(app, identifier: str, scheme: str, shots: pathlib.Path) -> None:
    """The Hidden tabs row, in a scheme: the page is loaded again in it, which is how a
    scheme chosen in Settings comes to a window that was already open."""
    ask(app, f"localStorage.setItem('nib:theme-scheme', {json.dumps(scheme)}) || 'kept'")
    ask(app, "(location.reload(), 'reloading')", 10)
    time.sleep(3)
    until(lambda: ask(app, "nib.workspace.restored") is True, 60)
    ask(app, "(nib.settings.show('general'), 'shown')")
    time.sleep(1.5)
    row = ask(
        app,
        "[...document.querySelectorAll('.setting')].some((one) => one.textContent.includes('Hidden tabs'))",
    )
    check(row is True, f"Settings shows the Hidden tabs row ({scheme})")
    shoot(identifier, shots / f"settings-hidden-tabs-{scheme}.png")
    ask(app, "(nib.settings.hide ? nib.settings.hide() : (nib.settings.open = false), 'closed')")


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.space-tabs")
    parsed.add_argument("--shots", default=str(ROOT / "apps/desktop/test/e2e/shots/space-tabs-probe"))
    args = parsed.parse_args()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)

    switch.wipe(args.identifier)
    # Each engine process opens a debugging port, which is how the pictures are taken.
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = SWITCHES
    serving = switch.free_port()
    ticks = Ticks()
    server = serve(serving, ticks)

    root = switch.spaces_root()
    for name in ("Work", "Home"):
        shutil.rmtree(root / name, ignore_errors=True)
        (root / name).mkdir(parents=True)
    (root / "Work" / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (root / "Work" / "Clock.url").write_text(
        switch.shortcut(f"http://127.0.0.1:{serving}/clock", "Clock"), encoding="utf-8"
    )
    (root / "Home" / "A note.md").write_text("# A note\n", encoding="utf-8")

    running = None
    try:
        # One launch to write the endpoint file, so eval can be turned on in it.
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        ids = until(lambda: (lambda said: said if isinstance(said, dict) and {"Work", "Home"} <= set(said) else None)(ask(app, IDS)), 60)
        if not isinstance(ids, dict):
            raise SystemExit(f"the two spaces are not there: {ids}")
        work, home = str(ids["Work"]), str(ids["Home"])
        say(f"Work {work}, Home {home}")

        # Work keeps its own tabs; hidden pages keep running.
        ask(app, f"localStorage.setItem('nib:space-tabs', {json.dumps(json.dumps({work: 'space'}))}) || 'kept'")
        ask(app, "localStorage.setItem('nib:hidden-tabs', '\"run\"') || 'kept'")

        to_space(app, home)
        to_space(app, work)
        idea = f"{json.dumps(str(root / 'Work' / 'Idea.md'))}"
        clock = f"{json.dumps(str(root / 'Work' / 'Clock.url'))}"
        ask(app, f"nib.workspace.openEntry({idea}).then(() => 'idea')")
        ask(app, f"nib.workspace.openWeb({clock}).then(() => 'clock')")
        check(bool(until(lambda: ticks.since(0) > 3, 30)), "the page in Work runs")
        ask(
            app,
            "(() => { const ws = nib.workspace; "
            f"ws.openUnsaved('terminal', JSON.stringify({{ shell: 'cmd', folder: ws.activeSpace.root, key: 'space-tabs' }}), 'Command Prompt'); "
            "return ws.activeTabId })()",
        )
        shells = until(lambda: cmd_of(running.pid), 30)
        check(bool(shells), f"the terminal in Work starts its shell ({shells})")
        front(app, "web")
        time.sleep(1)
        in_work = shown(app)
        say(f"Work: {in_work}")
        check(
            in_work.get("tabs") == ["note Idea.md", "web Clock.url", "terminal Command Prompt"],
            "Work holds its note, its page and its terminal",
        )
        work_shot = shots / "work.png"

        to_space(app, home)
        in_home = shown(app)
        say(f"Home: {in_home}")
        check(
            not any(one.startswith(("web Clock", "terminal", "note Idea")) for one in in_home.get("tabs", [])),
            "Home shows none of Work's tabs",
        )
        heard = ticking(ticks, 3)
        check(heard > 0, f"Keep running: the page out of sight goes on ticking ({heard} in 3 s)")
        check(all(terminal.alive(pid) for pid, _name in shells), "and the shell goes on running")
        home_shot = shots / "home.png"

        to_space(app, work)
        check(shown(app).get("tabs") == in_work.get("tabs"), "Work comes back with its three tabs")
        to_space(app, home)
        # Pause from the next launch on: the answer this one read stays this one's.
        ask(app, "localStorage.setItem('nib:hidden-tabs', '\"pause\"') || 'kept'")

        # The restart, on Home.
        first = app.port
        if not close_app(running):
            raise SystemExit("the app did not close when asked")
        time.sleep(2)
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=first)
        back = until(lambda: (lambda said: said if said.get("space") == "Home" else None)(shown(app)), 60)
        say(f"after the restart: {back}")
        check(isinstance(back, dict), "the restart comes back on Home")
        built = until(lambda: shown(app).get("all", 0) >= 4, 30)
        check(bool(built), f"and Work's tabs are built back behind it ({shown(app)})")

        before = ticks.last
        to_space(app, work)
        again = shown(app)
        say(f"Work after the restart: {again}")
        check(again.get("tabs") == in_work.get("tabs"), "Work after the restart holds its note, page and terminal")
        check(bool(until(lambda: ticks.last > before, 30)), "its page ticks again")
        front(app, "terminal")
        shells = until(lambda: cmd_of(running.pid), 30)
        check(bool(shells), "its terminal starts again when shown")
        front(app, "web")
        time.sleep(1.5)

        # Pause.
        to_space(app, home)
        time.sleep(1.5)
        stopped = ticking(ticks, 3)
        check(stopped == 0, f"Pause: the page out of sight stops ticking ({stopped} in 3 s)")
        check(all(terminal.alive(pid) for pid, _name in shells), "and the shell goes on running")
        stood = ticks.last
        to_space(app, work)
        check(bool(until(lambda: ticks.last > stood, 10)), "Work shown again: its page ticks again")
        check(ticks.last <= stood + 30, f"from where it was, with no reload ({stood} then {ticks.last})")

        # The pictures last: a page the protocol is attached to is one the engine will not
        # suspend, and nothing above is asked of a page with a debugger on it.
        shoot(args.identifier, work_shot)
        to_space(app, home)
        shoot(args.identifier, home_shot)
        settings_shot(app, args.identifier, "light", shots)
        settings_shot(app, args.identifier, "dark", shots)
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print("PASS" if not failures else f"FAIL: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
