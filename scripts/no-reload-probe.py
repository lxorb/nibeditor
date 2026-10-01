"""Ctrl+Tab round ten web tabs never reloads one, in the packaged app. Windows only.

Emil, 2026-10-01: *"When I cycle with Ctrl+Tab through my tabs, some of them fully reload
every time [...] the default must be that tabs don't reload."*

Ten local pages, each counting its own loads on this probe's server, ticking it every
second while it runs, and holding a value typed into its field. Then:

* **Round twice**, Ctrl+Tab pressed in the app's own document: every page loaded once.
* **Out of sight past five minutes**: the nine pages out of sight stop ticking (frozen)
  and the one in front goes on; the memory under the app is read before and after.
* **Round again**: each frozen page ticks again, still loaded once, its field still
  holding what was typed.
* **Memory saver at Maximum**, a launch later: ten pages and a round, and the pages
  beyond six are loaded again, which is the old behaviour back.

    python scripts/no-reload-probe.py --exe path/to/nib.exe \\
        --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says. Every launch goes through `run_probe`, off
every screen and never taking the keyboard; the app is driven through its automation
endpoint's `eval`, and a page's field through the DevTools protocol's `Runtime.evaluate`,
which never brings a window forward (see devtools.py). The protocol is attached only while
the fields are typed and read, because the engine will not freeze a page with a debugger on
it.
"""

from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import threading
import time

from devtools import SWITCHES, Session, port, targets
from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent

SPACE = "No reload probe"
PAGES = 10
#: Five minutes is when a page out of sight is frozen (resting.ts), and a little more.
FROZEN_BY = 5 * 60 + 40

failures: list[str] = []


def borrowed(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


switch = borrowed("switch", "web-switch-probe.py")


def page(index: int) -> bytes:
    return f"""<!doctype html>
<title>Page {index}</title>
<body style="margin:0;font:32px system-ui;display:grid;place-items:center;height:100vh">
<input id="field" style="font:inherit">
<b id="n">0</b>
<script>
let n = 0
setInterval(() => {{
  n += 1
  document.getElementById('n').textContent = n
  fetch('/tick?{index}').catch(() => {{}})
}}, 1000)
</script>
""".encode()


class Heard:
    """Loads and ticks per page."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.loads = [0] * PAGES
        self.ticks: list[tuple[int, float]] = []

    def load(self, index: int) -> None:
        with self.lock:
            self.loads[index] += 1

    def tick(self, index: int) -> None:
        with self.lock:
            self.ticks.append((index, time.perf_counter()))

    def since(self, moment: float) -> list[int]:
        with self.lock:
            counts = [0] * PAGES
            for index, at in self.ticks:
                if at >= moment:
                    counts[index] += 1
            return counts

    def reset(self) -> None:
        with self.lock:
            self.loads = [0] * PAGES
            self.ticks = []


def serve(at: int, heard: Heard) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path, _, query = self.path.partition("?")
            index = int(query or 0) % PAGES
            if path == "/tick":
                heard.tick(index)
                body = b"ok"
            elif path == "/p":
                heard.load(index)
                body = page(index)
            else:
                body = b""
            if path not in ("/tick", "/p"):
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = switch.Server(("127.0.0.1", at), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    say(("ok   " if ok else "FAIL ") + words)
    if not ok:
        failures.append(words)


def ask(app, code: str, seconds: float = 60) -> object:
    end = time.perf_counter() + seconds
    said: object = None
    while time.perf_counter() < end:
        said = app.ask(code)
        if not (isinstance(said, dict) and "error" in said):
            return said
        time.sleep(0.5)
    return said


ACTIVE = "JSON.stringify(nib.workspace.active ? nib.workspace.active.name : null)"

#: Ctrl+Tab, as the window hears it: a key in the app's own document, so nothing outside
#: the app is pressed and nothing is brought forward.
CTRL_TAB = (
    "(window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', ctrlKey: true,"
    " bubbles: true, cancelable: true })), window.dispatchEvent(new KeyboardEvent('keyup',"
    " { key: 'Control', code: 'ControlLeft', bubbles: true })), 'pressed')"
)


def round_of(app, steps: int, rest: float = 0.6) -> list[object]:
    """Ctrl+Tab `steps` times, a moment on each tab; the tabs it landed on."""
    seen = []
    for _ in range(steps):
        ask(app, CTRL_TAB)
        time.sleep(rest)
        seen.append(ask(app, ACTIVE))
    return seen


def web_targets(identifier: str) -> list[dict]:
    # The pages' own browser, in the `web` store every space shares; see web_stores.rs.
    at = port(switch.config_dir(identifier) / "web")
    if not at:
        return []
    return [one for one in targets(at) if "/p?" in str(one.get("url", "")) and one.get("type") == "page"]


def index_of(target: dict) -> int:
    return int(str(target["url"]).rsplit("?", 1)[1]) % PAGES


def fields(identifier: str, write: bool) -> dict[int, object]:
    """Each page's field, typed into (`write`) or read back, through the protocol."""
    out: dict[int, object] = {}
    for target in web_targets(identifier):
        index = index_of(target)
        session = Session(target)
        try:
            if write:
                session.value(
                    f"(() => {{ const f = document.getElementById('field'); f.value = 'typed {index}';"
                    " f.dispatchEvent(new Event('input', { bubbles: true })); return f.value })()"
                )
            out[index] = session.value("document.getElementById('field').value")
        finally:
            session.close()
    return out


def processes(pid: int) -> list[tuple[str, int]]:
    """The engine processes under the app: each one's type and working set."""
    script = (
        "$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine;"
        f" $mine = @({pid}); $grew = $true;"
        " while ($grew) { $grew = $false; foreach ($one in $all) {"
        "  if ($mine -contains $one.ParentProcessId -and -not ($mine -contains $one.ProcessId))"
        "   { $mine += $one.ProcessId; $grew = $true } } }"
        f" $all | Where-Object {{ $mine -contains $_.ProcessId -and $_.ProcessId -ne {pid} }} |"
        " ForEach-Object { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' };"
        " \"$t $($_.WorkingSetSize)\" }"
    )
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True, text=True, timeout=90, check=False,
    ).stdout
    rows = []
    for line in out.splitlines():
        kind, _, size = line.strip().rpartition(" ")
        if kind and size.isdigit():
            rows.append((kind, int(size)))
    return rows


def memory(pid: int, words: str) -> int:
    rows = processes(pid)
    total = sum(size for _, size in rows)
    renderers = sorted((size for kind, size in rows if kind == "renderer"), reverse=True)
    say(
        f"memory {words}: {total / 2**20:.0f} MB under the app, {total / PAGES / 2**20:.0f} MB a page;"
        f" renderers {[round(one / 2**20) for one in renderers]} MB"
    )
    return total


def make_space(at: int) -> pathlib.Path:
    made = switch.spaces_root() / SPACE
    shutil.rmtree(made, ignore_errors=True)
    made.mkdir(parents=True)
    (made / "A note.md").write_text("# A note\n", encoding="utf-8")
    for index in range(PAGES):
        (made / f"Page {index}.url").write_text(
            switch.shortcut(f"http://127.0.0.1:{at}/p?{index}", f"Page {index}"), encoding="utf-8"
        )
    return made


def open_all(app) -> None:
    for index in range(PAGES):
        app.open(f"Page {index}.url", SPACE)
        time.sleep(1.2)
    time.sleep(3)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.no-reload")
    args = parsed.parse_args()

    switch.wipe(args.identifier)
    os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = SWITCHES
    serving = switch.free_port()
    heard = Heard()
    server = serve(serving, heard)
    make_space(serving)

    running = None
    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(1)
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        ask(app, "localStorage.setItem('nib:memory-saver', 'off') || 'kept'")

        say("ten pages")
        open_all(app)
        check(heard.loads == [1] * PAGES, f"each page loaded once ({heard.loads})")
        typed = fields(args.identifier, write=True)
        check(len(typed) == PAGES, f"a value typed into each page's field ({len(typed)} pages)")
        before = memory(running.pid, "with ten running")

        say("round twice")
        landed = round_of(app, 2 * PAGES)
        pages_seen = {str(one) for one in landed if str(one).startswith("Page ")}
        check(len(pages_seen) == PAGES, f"Ctrl+Tab went round all ten ({sorted(pages_seen)})")
        check(heard.loads == [1] * PAGES, f"no page loaded again going round twice ({heard.loads})")

        say(f"out of sight for {FROZEN_BY} s")
        # A page in front for the wait, whichever tab the round ended on.
        ask(app, "(nib.workspace.activate(nib.workspace.tabs.find((one) => one.name.startsWith('Page 0')).id), 'shown')")
        time.sleep(FROZEN_BY)
        front = ask(app, ACTIVE)
        moment = time.perf_counter()
        time.sleep(6)
        ticks = heard.since(moment)
        front_index = int(str(front).rsplit(" ", 1)[-1].split(".")[0]) if front else -1
        hidden = [count for index, count in enumerate(ticks) if index != front_index]
        say(f"ticks in 6 s: {ticks} (in front: {front})")
        check(sum(hidden) == 0, "the nine out of sight are frozen: none ticks")
        check(ticks[front_index] > 0 if front_index >= 0 else False, "the one in front goes on")
        after = memory(running.pid, "with nine frozen")
        say(f"freezing gave back {(before - after) / 2**20:.0f} MB")

        say("round again")
        moment = time.perf_counter()
        round_of(app, PAGES, rest=1.5)
        woke = heard.since(moment)
        check(all(count > 0 for count in woke), f"every page ticks again when shown ({woke})")
        check(heard.loads == [1] * PAGES, f"and none loaded again ({heard.loads})")
        kept = fields(args.identifier, write=False)
        check(
            all(kept.get(index) == f"typed {index}" for index in range(PAGES)),
            f"each field still holds what was typed ({kept})",
        )
        memory(running.pid, "after the round")

        say("Memory saver at Maximum, a launch later")
        ask(app, "localStorage.setItem('nib:memory-saver', 'maximum') || 'kept'")
        ask(app, "(nib.workspace.tabs.filter((one) => one.kind === 'web').forEach((one) => nib.workspace.close(one.id)), 'closed')")
        time.sleep(2)
        first = app.port
        if not close_app(running):
            raise SystemExit("the app did not close when asked")
        time.sleep(2)
        running, app, _ = switch.launch(args.exe, args.identifier, unlike=first)
        time.sleep(3)
        heard.reset()
        open_all(app)
        round_of(app, PAGES)
        again = heard.loads
        check(any(count > 1 for count in again), f"pages beyond six load again, as before ({again})")
        memory(running.pid, "under Memory saver")
    finally:
        if running is not None and not close_app(running):
            running.terminate()
        server.shutdown()

    print("PASS" if not failures else f"FAIL: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
