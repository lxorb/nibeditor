"""A launch and an hour of use the size of Emil's, measured: twelve spaces and five
thousand notes, two dozen web tabs in tab sets of their own, terminals that have printed
a lot, the Ask panel open, the wallpaper theme and an extension. Windows only.

Emil, 2026-10-04: *"nib still freezes pretty often. Also startup time is waaaay too
long."* Every launch measured before that was a light one - an empty space, or five
thousand notes and nothing else open - at 0.5 to 0.9 s. This is the other end.

Three parts, each through `run_probe` (off the screen, never taking the keyboard) and the
automation endpoint's `eval`, which the probe turns on in its own identifier's file:

* **prime**: a wiped profile, the spaces seeded on the disk, and one session that opens
  everything the way somebody would and closes the way they would.
* **launch**: warm launches of that profile with `NIB_TRACE_STARTUP` on. What a launch
  costs is read off the trace (window shown, first frame, the tab in front, the launch
  order done) and off the front web page itself, which tells this probe's own server
  the moment it has loaded.
* **use**: a minute of what Emil does - switching spaces, Ctrl+Tab through the tabs,
  terminals printing, the Ask panel - while this probe asks the window's thread and the
  page's main thread every 100 ms whether they answer. A stall is either one away for
  longer than a frame. What nib's own stall recorder wrote to nib.log is printed after.

    python scripts/heavy-launch-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name> [--runs 5] [--only prime,launch,use]

Build the exe as `scripts/probe_app.py` says. A few of the web tabs are real public sites
(they make the network part of the measurement, as it is for Emil); the rest are pages
this probe serves, heavy on purpose: a few thousand elements, a script that works for
a tenth of a second as it loads, and a timer redrawing part of the page every second, the
way a chat app does.
"""

from __future__ import annotations

import argparse
import ctypes
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import statistics
import sys
import tempfile
import threading
import time
from ctypes import wintypes

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from probe_app import close_app, main_window, run_probe, sized  # noqa: E402


def borrowed(name: str, file: pathlib.Path):
    """Another drive's helpers, read from its file: the names have dashes in them."""

    spec = importlib.util.spec_from_file_location(name, file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


switch = borrowed("switch", HERE / "web-switch-probe.py")
launch_drive = borrowed("launch_drive", HERE.parent / "apps" / "desktop" / "test" / "e2e" / "launch.py")

#: How many spaces, and how the five thousand notes are spread over them: one big one,
#: the rest a few hundred each.
SPACES = 12
NOTES = 5000
BIG = 2000

#: Real sites among the web tabs.
PUBLIC = [
    ("Wikipedia", "https://en.wikipedia.org/wiki/Main_Page"),
    ("VS Code", "https://github.com/microsoft/vscode"),
    ("ETH", "https://ethz.ch/en.html"),
    ("Hacker News", "https://news.ycombinator.com/"),
]

#: Web tabs per space.
PER_SPACE = 2

#: Spaces with a terminal, and how many lines each prints before the session ends.
TERMINALS = 3
LINES = 4000

#: The extension installed, from its store link.
EXTENSION = "https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh"

#: A picture kept the way the wallpaper store keeps one; see wallpaper-probe.py.
WALLPAPER = """
(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 183; canvas.height = 114
  const c = canvas.getContext('2d')
  const g = c.createLinearGradient(0, 0, 183, 114)
  g.addColorStop(0, '#0b1a3a'); g.addColorStop(0.5, '#e86a3a'); g.addColorStop(1, '#fff3c4')
  c.fillStyle = g; c.fillRect(0, 0, 183, 114)
  const side = (floor, ground) => ({ floor, ground })
  localStorage.setItem('nib:wallpaper', JSON.stringify({
    picture: canvas.toDataURL('image/png'), blur: 28,
    dark: side(0.62, '#3a2a2a'), light: side(0.6, '#e9dcd2'),
  }))
  return 'kept'
})()
"""

user32 = ctypes.WinDLL("user32", use_last_error=True)
SendMessageTimeoutW = user32.SendMessageTimeoutW
SendMessageTimeoutW.argtypes = [
    wintypes.HWND,
    wintypes.UINT,
    wintypes.WPARAM,
    wintypes.LPARAM,
    wintypes.UINT,
    wintypes.UINT,
    ctypes.POINTER(ctypes.c_size_t),
]
SendMessageTimeoutW.restype = ctypes.c_size_t


def say(words: str) -> None:
    print(f"  {words}", flush=True)


# ---------------------------------------------------------------------------- pages


class Heard:
    """Which heavy pages told the server they had loaded, and when."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.loaded: dict[str, float] = {}

    def heard(self, page: str) -> None:
        with self.lock:
            self.loaded.setdefault(page, time.perf_counter())

    def clear(self) -> None:
        with self.lock:
            self.loaded.clear()


def heavy(page: str) -> bytes:
    rows = "".join(
        f"<li class='m'><b>Person {i % 37}</b> <span>message {i} about the plan, the ink and the wind</span>"
        f"<time>{i % 24:02d}:{i % 60:02d}</time></li>"
        for i in range(2500)
    )
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Heavy {page}</title>
<link rel="icon" href="/icon.svg"><style>body{{font:14px system-ui;margin:0}}li{{padding:4px 12px}}
.m:nth-child(odd){{background:#f3f3f3}}</style></head><body><h1>Heavy {page}</h1><ul id="list">{rows}</ul>
<script>
const until = performance.now() + 100
let spin = 0
while (performance.now() < until) spin++
setInterval(() => {{
  const one = document.createElement('li')
  one.className = 'm'
  one.textContent = 'tick ' + Date.now()
  const list = document.getElementById('list')
  list.prepend(one)
  if (list.children.length > 2600) list.lastElementChild.remove()
}}, 1000)
addEventListener('load', () => fetch('/loaded?page={page}').catch(() => undefined))
</script></body></html>""".encode()


ICON = b"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#e86a3a"/></svg>"""


def serve(port: int, heard: Heard) -> http.server.ThreadingHTTPServer:
    class Pages(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path, _, query = self.path.partition("?")
            if path == "/loaded":
                heard.heard(query.removeprefix("page="))
                body, kind = b"ok", "text/plain"
            elif path == "/icon.svg":
                body, kind = ICON, "image/svg+xml"
            elif path.startswith("/heavy/"):
                body, kind = heavy(path.removeprefix("/heavy/")), "text/html; charset=utf-8"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# ---------------------------------------------------------------------------- the disk


def space_name(at: int) -> str:
    return f"Space {at + 1:02d}"


def seed(root: pathlib.Path, port: int) -> dict[str, list[str]]:
    """The spaces on the disk, once: the notes, and each space's web notes. Answers the
    web notes' paths by space."""

    webs: dict[str, list[str]] = {}
    marker = root / ".seeded"
    public = list(PUBLIC)
    counter = 0
    for at in range(SPACES):
        name = space_name(at)
        space = root / name
        space.mkdir(parents=True, exist_ok=True)
        count = BIG if at == 0 else (NOTES - BIG) // (SPACES - 1)
        if not marker.exists():
            for one in range(count):
                folder = space / f"Folder {one % 20:02d}"
                folder.mkdir(exist_ok=True)
                (folder / f"note-{one:04d}.md").write_text(launch_drive.note(one), encoding="utf-8")
        webs[name] = []
        for _ in range(PER_SPACE):
            if public and counter % 6 == 5:
                title, url = public.pop(0)
            else:
                title, url = f"Heavy {counter:02d}", f"http://127.0.0.1:{port}/heavy/{counter:02d}"
            file = space / f"{title}.url"
            file.write_text(switch.shortcut(url, title), encoding="utf-8")
            webs[name].append(str(file))
            counter += 1
    marker.write_text("seeded", encoding="utf-8")
    return webs


# ---------------------------------------------------------------------------- the app


def endpoint_of(identifier: str, pid: int, seconds: float) -> tuple[int, str]:
    """The endpoint the launch with this process number wrote. The file stays behind after
    an app has gone, and a port can come round again, so the number is what says whose
    it is."""

    path = switch.config_dir(identifier) / "automation.json"
    until_at = time.perf_counter() + seconds
    while time.perf_counter() < until_at:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("pid") == pid and said.get("port") and said.get("secret"):
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    raise SystemExit(f"the launch {pid} never wrote {path}")


def started(exe: pathlib.Path, identifier: str, spaces: pathlib.Path, trace: bool):
    env = {**os.environ, "NIB_SPACES_DIR": str(spaces)}
    if trace:
        env["NIB_TRACE_STARTUP"] = "1"
    begun = time.perf_counter()
    app = run_probe(exe, env=env, quiet=True)
    try:
        port, secret = endpoint_of(identifier, app.pid, 120)
    except SystemExit:
        app.kill()
        raise
    hwnd = 0
    until = time.perf_counter() + 60
    while not hwnd and time.perf_counter() < until:
        hwnd = main_window(app.pid)
        time.sleep(0.05)
    if hwnd:
        sized(hwnd, 1440, 900)
    return app, switch.App(port, secret), hwnd, begun


def ended(app) -> None:
    if not close_app(app, seconds=30):
        app.kill()
        app.wait(timeout=30)
    launch_drive.settled(app_identifier)


def until(test, seconds: float, step: float = 0.25):
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        said = test()
        if said:
            return said
        time.sleep(step)
    return None


def space_ids(app) -> dict[str, str]:
    said = app.ask("JSON.stringify(Object.fromEntries(nib.workspace.spaces.map((one) => [one.name, one.id])))")
    return said if isinstance(said, dict) else {}


def prime(exe: pathlib.Path, identifier: str, spaces: pathlib.Path, webs: dict[str, list[str]]) -> None:
    """One session that opens everything, the way somebody would, and closes."""

    switch.wipe(identifier)
    app, _, _, _ = started(exe, identifier, spaces, trace=False)
    ended(app)
    switch.allow_eval(identifier)

    app, window, hwnd, _ = started(exe, identifier, spaces, trace=False)
    try:
        ids = until(lambda: (lambda all: all if len(all) >= SPACES else None)(space_ids(window)), 90)
        if not ids:
            raise SystemExit(f"the spaces never came: {space_ids(window)}")
        # Every space keeps tabs of its own, the way somebody with this many spaces does.
        window.ask(
            f"localStorage.setItem('nib:space-tabs', {json.dumps(json.dumps({one: 'space' for one in ids.values()}))}) || 'kept'"
        )
        terminals = 0
        for name in sorted(webs):
            window.ask(f"nib.workspace.showSpace({json.dumps(ids[name])}).then(() => 'shown')")
            time.sleep(0.8)
            for file in webs[name]:
                window.ask(f"nib.workspace.openWeb({json.dumps(file)}).then(() => 'opened')")
                time.sleep(1.2)
            if terminals < TERMINALS:
                terminals += 1
                window.ask(
                    "(() => { const ws = nib.workspace; "
                    f"ws.openUnsaved('terminal', JSON.stringify({{ shell: 'cmd', folder: ws.activeSpace.root, key: 'heavy-{terminals}' }}), 'Command Prompt'); "
                    "return ws.activeTabId })()"
                )
                until(lambda: window.ask("document.querySelectorAll('.xterm-rows > div').length > 0"), 20)
                time.sleep(1.5)
                typed(window, f"for /L %i in (1,1,{LINES}) do @echo line %i of a long agent log, with some words after it\r")
                time.sleep(4)
            say(f"{name}: {len(webs[name])} web tabs")

        window.ask("nib.commands ? 'ok' : 'none'")
        asked(window, "commands.run", {"id": "ask-panel"})
        window.ask(WALLPAPER)
        asked(window, "commands.run", {"id": "theme:wallpaper"})
        installed = window.ask(
            f"window.__TAURI_INTERNALS__.invoke('extensions_install', {{ link: {json.dumps(EXTENSION)} }}).then(() => 'installed', (e) => 'not: ' + e)",
            seconds=180,
        )
        say(f"extension: {installed}")

        # End on the first space, with a heavy page in front.
        first = space_name(0)
        window.ask(f"nib.workspace.showSpace({json.dumps(ids[first])}).then(() => 'shown')")
        time.sleep(1)
        front = webs[first][0]
        window.ask(f"nib.workspace.openWeb({json.dumps(front)}).then(() => 'opened')")
        time.sleep(5)
        said = window.ask("JSON.stringify({ tabs: nib.workspace.tabs.length, kinds: nib.workspace.tabs.map((t) => t.kind) })")
        say(f"front set: {said}")
    finally:
        ended(app)


def typed(window, words: str) -> None:
    window.ask(
        "(() => { const field = document.querySelector('.xterm-helper-textarea'); if (!field) return 'none'; "
        f"field.dispatchEvent(new InputEvent('input', {{ data: {json.dumps(words)}, inputType: 'insertText', bubbles: true }})); "
        "return 'typed' })()"
    )


def asked(window, verb: str, args: dict) -> object:
    return switch.act(window.port, window.secret, verb, args)


# ---------------------------------------------------------------------------- launch


def launches(exe: pathlib.Path, identifier: str, spaces: pathlib.Path, runs: int, heard: Heard) -> dict:
    trace = launch_drive.trace_file(identifier)
    rows: list[dict] = []
    first_space = space_name(0)
    for at in range(runs + 1):
        if trace.exists():
            trace.unlink()
        heard.clear()
        app, window, _hwnd, begun = started(exe, identifier, spaces, trace=True)
        try:
            read = until(
                lambda: (lambda line: line if line and any(s["step"] == launch_drive.LAST for s in line["steps"]) else None)(
                    launch_drive.last_line(trace)
                ),
                60,
            )
            loaded = until(lambda: next(iter(heard.loaded.values()), None), 20, 0.05)
            row = {}
            if read:
                for step in read["steps"]:
                    row.setdefault(step["step"], step["at"])
            if loaded:
                row["front web page loaded (probe)"] = (loaded - begun) * 1000
            if at > 0:  # the first launch after a prime is not counted
                rows.append(row)
            say(f"launch {at}: {'trace' if read else 'no trace'}, web page {'loaded' if loaded else 'not loaded'}")
        finally:
            ended(app)
    keys = [
        "windows, before our first line",
        "window shown",
        "window: page requested",
        "window: shell painted",
        "window: tree read",
        "window: first frame painted",
        "window: active tab painted",
        "window: launch order finished",
        "front web page loaded (probe)",
    ]
    medians = {}
    for key in keys:
        values = [row[key] for row in rows if key in row]
        if values:
            medians[key] = statistics.median(values)
    others = sorted({key for row in rows for key in row} - set(keys))
    print()
    print(f"warm launches, median of {len(rows)} ({launch_drive.load()}):")
    for key in keys:
        if key in medians:
            print(f"  {key:52} {medians[key]:9.1f}")
    print("  (every step)")
    for key in sorted(others, key=lambda k: statistics.median([r[k] for r in rows if k in r])):
        values = [row[key] for row in rows if key in row]
        print(f"    {key[:60]:60} {statistics.median(values):9.1f}")
    return {"rows": rows, "medians": medians}


# ---------------------------------------------------------------------------- use


class Pulse:
    """Asks the window's thread every 100 ms whether it answers, from a thread of this
    probe's own: the longest it went without answering, and every time over a frame."""

    def __init__(self, hwnd: int) -> None:
        self.hwnd = hwnd
        self.stalls: list[tuple[float, float]] = []
        self.running = True
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def run(self) -> None:
        result = ctypes.c_size_t()
        while self.running:
            began = time.perf_counter()
            SendMessageTimeoutW(self.hwnd, 0, 0, 0, 0, 30_000, ctypes.byref(result))
            took = (time.perf_counter() - began) * 1000
            if took > 100:
                self.stalls.append((began, took))
            time.sleep(0.1)

    def stop(self) -> None:
        self.running = False
        self.thread.join(timeout=35)


def use(exe: pathlib.Path, identifier: str, spaces: pathlib.Path, seconds: float) -> dict:
    """A minute of Emil's afternoon, with the window's thread and the page's watched."""

    log = launch_drive.local(identifier) / "logs" / "nib.log"
    before = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
    app, window, hwnd, _ = started(exe, identifier, spaces, trace=False)
    page: list[float] = []
    try:
        until(lambda: len(space_ids(window)) >= SPACES, 60)
        time.sleep(8)  # the launch order and its background passes
        ids = space_ids(window)
        pulse = Pulse(hwnd)
        names = sorted(ids)
        end = time.perf_counter() + seconds
        turn = 0
        while time.perf_counter() < end:
            name = names[turn % len(names)]
            began = time.perf_counter()
            window.ask(f"nib.workspace.showSpace({json.dumps(ids[name])}).then(() => 'shown')")
            page.append((time.perf_counter() - began) * 1000)
            # Ctrl+Tab through what this space has open.
            for _ in range(3):
                began = time.perf_counter()
                window.ask(
                    "(() => { const ws = nib.workspace; const all = ws.tabsIn(ws.panes.focused.id); "
                    "const at = all.findIndex((t) => t.id === ws.activeTabId); const next = all[(at + 1) % all.length]; "
                    "if (next) ws.activate(next.id); return next ? next.kind : 'none' })()"
                )
                page.append((time.perf_counter() - began) * 1000)
                time.sleep(0.4)
            if turn % 4 == 1:
                typed(window, "for /L %i in (1,1,1500) do @echo printing while somebody works %i\r")
            if turn % 5 == 2:
                asked(window, "commands.run", {"id": "ask-panel"})
            turn += 1
        pulse.stop()
    finally:
        ended(app)
    after = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
    written = after[len(before):] if after.startswith(before) else after
    stalls = sorted(pulse.stalls, key=lambda one: -one[1])
    print()
    print(f"use, {seconds:.0f} s ({launch_drive.load()}):")
    print(f"  window thread away over 100 ms: {len(stalls)} times, longest {stalls[0][1]:.0f} ms" if stalls else "  window thread never away over 100 ms")
    for _, took in stalls[:8]:
        print(f"    {took:7.0f} ms")
    if page:
        print(
            f"  page round trips: median {statistics.median(page):.0f} ms, "
            f"90th {sorted(page)[int(len(page) * 0.9)]:.0f} ms, longest {max(page):.0f} ms ({len(page)} asked)"
        )
    lines = [line for line in written.splitlines() if line.strip()]
    print(f"  nib.log during the run: {len(lines)} lines")
    for line in lines[-40:]:
        print(f"    {line[:300]}")
    return {"window": [took for _, took in stalls], "page": page, "log": lines}


app_identifier = ""


def main() -> int:
    global app_identifier
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parsed = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--runs", type=int, default=5)
    parsed.add_argument("--only", default="prime,launch,use")
    parsed.add_argument("--seconds", type=float, default=60)
    parsed.add_argument("--port", type=int, default=0, help="the pages' port; fixed so a profile primed once keeps its addresses")
    parsed.add_argument("--spaces", type=pathlib.Path, help="a spaces folder kept between runs")
    parsed.add_argument("--json", type=pathlib.Path)
    told = parsed.parse_args()
    if "probe" not in told.identifier:
        raise SystemExit("a probe identifier, never the reader's")
    app_identifier = told.identifier

    spaces = told.spaces or pathlib.Path(tempfile.mkdtemp(prefix="nib-heavy-spaces-"))
    spaces.mkdir(parents=True, exist_ok=True)
    port = told.port or switch.free_port()
    heard = Heard()
    server = serve(port, heard)
    print(f"machine: {launch_drive.machine()}")
    print(f"spaces {spaces}, pages on {port}")
    webs = seed(spaces, port)

    out: dict = {}
    parts = told.only.split(",")
    try:
        if "prime" in parts:
            prime(told.exe, told.identifier, spaces, webs)
        if "launch" in parts:
            out["launch"] = launches(told.exe, told.identifier, spaces, told.runs, heard)
        if "use" in parts:
            out["use"] = use(told.exe, told.identifier, spaces, told.seconds)
    finally:
        server.shutdown()
        if not told.spaces:
            shutil.rmtree(spaces, ignore_errors=True)
    if told.json:
        told.json.write_text(json.dumps(out, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
