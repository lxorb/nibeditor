"""What a launch of a release build costs, from before its first line to a usable
shell, cold and warm, on an empty space and on five thousand notes.

The one thing about this app that cannot be measured anywhere but on a real machine,
so the app times itself: `NIB_TRACE_STARTUP=1` and every launch appends a page and one
line of JSON to `startup-trace.log`. This runs a probe build as many times as asked,
reads the JSON and reports the median of every step, with the machine and what else
it was doing beside the table - a launch measured on a busy machine is a measurement
of the machine.

Every launch goes through `run_probe` in scripts/probe_app.py: off the screen, never
taking the keyboard, with a watch that ends the run if any window of it is ever on a
screen or in front, and `NIB_SPACES_DIR` in a folder of this run's own. So a probe
never opens in front of whoever is working at the machine, and never reads their notes.

    python apps/desktop/test/e2e/launch.py --runs 7

The build is a release build under an identifier of its own, as a version no release
passes and looking for updates on a port nothing listens on; see probe_app.py:

    pnpm --dir apps/desktop tauri build --no-bundle --config \\
      '{"identifier":"ch.emilvinu.nib.launch","version":"99.0.0",
        "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'

Its own identifier rather than a `.probe` one, because the app holds a single-instance
lock keyed by it: a launch made while another build with the same identifier is
running hands its arguments over and exits without a window. `--exe` and
`--identifier` point at another build, which is how two builds are compared.

**Cold** is a first launch: the identifier's own folders are wiped before each one, so
the webview starts on a profile it has never seen, and nothing about the last window -
its colour, its place, the tabs in it - is remembered. **Warm** is every launch after
the first, with the webview's profile and caches in place and one note open, the way
somebody reopens the app they closed. A primed launch between the two opens that note
and is not counted.

**Throttled** (`--throttle 4`) is the slow device, as Chrome's own DevTools makes one:
the page is reloaded inside a warm launch with the webview's main thread slowed four
times through the DevTools protocol, on a port the probe alone is given. Only the page
is slowed - the window and the webview's own start are the machine's - so the figure
reported is the unslowed native half of a warm launch plus the slowed page.

One step in the table is not the app's own: `window shown, as Windows reports it` is
the window manager's answer, polled from here, because that step happens before there
is a page to say so.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
import urllib.request
import winreg

ROOT = pathlib.Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"
sys.path.insert(0, str(ROOT / "scripts"))

from probe_app import close_app, main_window, run_probe  # noqa: E402

#: The identifier the default build carries; see the module's docs.
IDENTIFIER = "ch.emilvinu.nib.launch"

#: Where that build puts the binary.
EXE = APP / "src-tauri" / "target" / "release" / "nib.exe"

#: How long a launch is given to finish its launch order and hand its trace over,
#: which it does `SETTLE` after the order finishes; see lib/trace.ts.
PATIENCE = 45

#: How often to ask Windows whether the window is up, in seconds.
PEEK = 0.002

#: The step the poll is written into the trace as.
SHOWN = "window shown, as Windows reports it"

#: The step whose arrival means the window has handed its trace over.
LAST = "window: launch order finished"

#: The note a warm launch has open, in the five thousand note space.
OPENED = "note-0000.md"

#: The phases the table in docs/conventions.md is made of, in order: the name the
#: trace gives each and the name the table does.
PHASES = [
    (SHOWN, "window shown"),
    ("window: page requested", "webview up, page requested"),
    ("window: modules evaluated", "modules evaluated"),
    ("window: shell painted", "shell painted"),
    ("window: tree read", "tree read"),
    ("window: first frame painted", "first frame"),
    ("window: active tab painted", "note painted"),
    (LAST, "launch order finished"),
]


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def roaming(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def local(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier


def wipe(identifier: str) -> None:
    """Everything the identifier keeps, for a cold launch. Refused for any identifier
    that is not a launch probe's, so this can never take the reader's own nib."""

    if ".launch" not in identifier:
        raise SystemExit(f"{identifier} is not a launch probe's identifier; nothing is wiped")
    for folder in (roaming(identifier), local(identifier)):
        for _ in range(20):
            shutil.rmtree(folder, ignore_errors=True)
            if not folder.exists():
                break
            # The webview's processes can outlive the app by a moment and hold a file.
            time.sleep(0.25)


def trace_file(identifier: str) -> pathlib.Path:
    return local(identifier) / "logs" / "startup-trace.log"


def load() -> float:
    """The whole machine's processor load over one second, in per cent."""

    try:
        import psutil

        return float(psutil.cpu_percent(interval=1.0))
    except ImportError:
        answer = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        return float(answer.stdout.strip() or "nan")


def machine() -> str:
    """The machine a table was measured on, in one line."""

    name = platform.processor() or platform.machine()
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"
        ) as key:
            name = str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
    except OSError:
        pass
    cores = os.cpu_count() or 0
    memory = ""
    try:
        import psutil

        memory = f", {psutil.virtual_memory().total / 2**30:.0f} GB"
    except ImportError:
        pass
    webview = "?"
    for hive, path in (
        (
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
        (
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        ),
    ):
        try:
            with winreg.OpenKey(hive, path) as key:
                webview = str(winreg.QueryValueEx(key, "pv")[0])
                break
        except OSError:
            continue
    return f"{name}, {cores} threads{memory}, Windows {platform.version()}, WebView2 {webview}"


def corpus(kind: str, into: pathlib.Path) -> None:
    """The notes a launch reads: one empty space, or the five thousand note fixture
    speed.py seeds into a browser, on the disk this time."""

    space = into / ("Big" if kind == "big" else "Notes")
    space.mkdir(parents=True, exist_ok=True)
    if kind != "big":
        return
    for at in range(5000):
        (space / f"note-{at:04d}.md").write_text(note(at), encoding="utf-8")


def note(at: int) -> str:
    tag = ["#wind", "#ink", "#paper", "#kestrel", "#plan"][at % 5]
    to = (at + 7) % 5000
    lines = [
        "---",
        "icon: rocket",
        "icon-color: violet",
        "aliases:",
        f"  - note {at} elsewhere",
        "---",
        "",
        f"# Note {at}",
        "",
        f"{tag} and a line about the wind, written on the {at}th of the month.",
        "",
        f"Filed under marker-{at:04d}.",
        "",
        f"See [[note-{to:04d}]] and [the plan](Work/Q3/plan.md).",
        "",
        "- [ ] Pressure on the pen",
        "- [x] Slides out of a note",
        "",
    ]
    part = 0
    while len("\n".join(lines)) < 4000:
        lines += [
            f"## What went in, {part}",
            "",
            "The wind was steady all week, and the ink took its time. What the pen leaves",
            "behind on paper is the only part of this anybody reads twice.",
            "",
        ]
        part += 1
    return "\n".join(lines)


def endpoint(identifier: str, patience: float = 20) -> tuple[int, str] | None:
    """The running app's automation port and secret, once it has written them."""

    path = roaming(identifier) / "automation.json"
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            held = json.loads(path.read_text(encoding="utf-8"))
            if held.get("port") and held.get("secret"):
                return int(held["port"]), str(held["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    return None


def asked(identifier: str, verb: str, args: dict) -> dict:
    found = endpoint(identifier)
    if not found:
        return {"ok": False, "error": "no endpoint"}
    port, secret = found
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=json.dumps({"verb": verb, "args": args, "rest": []}).encode(),
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=30) as answer:
        return json.loads(answer.read().decode())


def last_line(path: pathlib.Path) -> dict | None:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    lines = [one for one in text.splitlines() if one.startswith("{")]
    return json.loads(lines[-1]) if lines else None


def launched(
    exe: pathlib.Path,
    identifier: str,
    spaces: pathlib.Path,
    *,
    cold: bool,
    then=None,
    args: dict | None = None,
) -> dict | None:
    """One launch, watched off the screen, and the line it left behind.

    `then` runs against the app once its launch order has finished and before it is
    closed - the primed launch opens a note in it, the throttled one reloads it slowed.
    Closed the way a person closes it, so what the session keeps is written."""

    if cold:
        wipe(identifier)
    trace = trace_file(identifier)
    if trace.exists():
        trace.unlink()

    environment = {
        **os.environ,
        "NIB_TRACE_STARTUP": "1",
        "NIB_SPACES_DIR": str(spaces),
        **(args or {}),
    }
    begun = time.perf_counter()
    app = run_probe(exe, env=environment, quiet=True)
    shown: float | None = None
    read: dict | None = None
    try:
        until = begun + PATIENCE
        while time.perf_counter() < until:
            if app.poll() is not None:
                say("the process ended by itself: another build holds this identifier's lock?")
                return None
            if shown is None and main_window(app.pid):
                shown = (time.perf_counter() - begun) * 1000
            if shown is not None:
                read = last_line(trace)
                if read and any(one["step"] == LAST for one in read["steps"]):
                    break
            time.sleep(PEEK if shown is None else 0.1)
        if then is not None and read is not None:
            read = then(app, read) or read
    finally:
        if not close_app(app, seconds=20):
            app.kill()
            app.wait(timeout=30)
        settled(identifier)

    if read is None:
        return None
    if shown is not None:
        read["steps"].append({"step": SHOWN, "at": shown})
    return read


def settled(identifier: str, patience: float = 30) -> None:
    """Waits for the webview's own processes to go after the app has. They outlive it
    by anything from a moment to seconds, holding the profile, and the next launch's
    webview waits for them: two launches of twenty seconds and forty on a first run of
    this drive were that and nothing else."""

    try:
        import psutil
    except ImportError:
        time.sleep(2.0)
        return
    until = time.monotonic() + patience
    while time.monotonic() < until:
        alive = False
        for one in psutil.process_iter(["name", "cmdline"]):
            try:
                if one.info["name"] == "msedgewebview2.exe" and identifier in " ".join(
                    one.info["cmdline"] or []
                ):
                    alive = True
                    break
            except (psutil.Error, TypeError):
                continue
        if not alive:
            return
        time.sleep(0.2)


def opened_note(identifier: str):
    def run(_app, read: dict) -> dict:
        answer = asked(identifier, "open", {"path": f"Big/{OPENED}"})
        if not answer.get("ok"):
            say(f"the note would not open: {answer.get('error')}")
        # Long enough for the session to be written as it would be by somebody who
        # opened a note and read it.
        time.sleep(3)
        return read

    return run


def throttled(identifier: str, rate: float):
    """Reloads the page inside a warm launch with its main thread slowed `rate` times,
    and reads the page's own marks off its timeline."""

    def run(_app, read: dict) -> dict:
        from playwright.sync_api import sync_playwright

        port_file = next(local(identifier).rglob("DevToolsActivePort"), None)
        if port_file is None:
            say("no DevTools port: the probe was not started with one")
            return read
        port = port_file.read_text().splitlines()[0].strip()
        with sync_playwright() as driver:
            browser = driver.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            page = next(
                (
                    one
                    for context in browser.contexts
                    for one in context.pages
                    if "tauri.localhost" in one.url or one.url.startswith("tauri:")
                ),
                None,
            )
            if page is None:
                say("no app page behind the DevTools port")
                return read
            session = page.context.new_cdp_session(page)
            session.send("Emulation.setCPUThrottlingRate", {"rate": rate})
            page.reload(wait_until="commit")
            marks: dict[str, float] = {}
            until = time.monotonic() + PATIENCE
            while time.monotonic() < until:
                try:
                    marks = page.evaluate(
                        "() => Object.fromEntries(performance.getEntriesByType('mark')"
                        ".filter((one) => one.name.startsWith('nib: '))"
                        ".map((one) => [one.name.slice(5), one.startTime]))"
                    )
                except Exception:  # noqa: BLE001 - the page is mid-navigation
                    marks = {}
                if "launch order finished" in marks:
                    break
                time.sleep(0.2)
            session.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            browser.close()
        read["throttled"] = {"rate": rate, "marks": marks}
        return read

    return run


def table(runs: list[dict], what: str) -> dict[str, float]:
    """The median of each step, in the order they happened, and the medians by name."""

    names: list[str] = []
    for run in runs:
        for step in run["steps"]:
            if step["step"] not in names:
                names.append(step["step"])
    rows = []
    for name in names:
        at = [one["at"] for run in runs for one in run["steps"] if one["step"] == name]
        cpu = [
            one["cpu"] for run in runs for one in run["steps"] if one["step"] == name and "cpu" in one
        ]
        rows.append((statistics.median(at), name, statistics.median(cpu) if cpu else None, len(at)))
    rows.sort()

    print()
    print(f"{what}, median of {len(runs)}:")
    print(f"  {'step':52} {'at':>9} {'since':>9} {'cpu':>9}")
    last = 0.0
    for middle, name, spent, _count in rows:
        column = f"{spent:9.1f}" if spent is not None else " " * 9
        print(f"  {name[:52]:52} {middle:9.1f} {middle - last:9.1f} {column}")
        last = middle
    return {name: middle for middle, name, _spent, _count in rows}


def phases(medians: dict[str, float]) -> list[str]:
    return [
        f"{label} {medians[name]:.0f}" if name in medians else f"{label} -" for name, label in PHASES
    ]


def main() -> int:
    if sys.platform != "win32":
        print("this drive launches a Windows build")
        return 0

    ask = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ask.add_argument("--exe", type=pathlib.Path, default=EXE)
    ask.add_argument("--identifier", default=IDENTIFIER)
    ask.add_argument("--runs", type=int, default=7, help="launches per row, cold and warm")
    ask.add_argument("--corpus", default="both", choices=["empty", "big", "both"])
    ask.add_argument("--only", choices=["cold", "warm"], help="one half of the table")
    ask.add_argument("--throttle", type=float, default=0, help="also a warm launch slowed this many times")
    ask.add_argument("--json", type=pathlib.Path, help="every launch's line, written here")
    told = ask.parse_args()

    if not told.exe.exists():
        raise SystemExit(f"no probe build at {told.exe}; see this file's docstring")

    print(f"machine: {machine()}")
    kept: dict[str, list[dict]] = {}
    summary: list[str] = []
    corpora = ["empty", "big"] if told.corpus == "both" else [told.corpus]
    with tempfile.TemporaryDirectory(prefix="nib-launch-") as scratch:
        for kind in corpora:
            spaces = pathlib.Path(scratch) / kind
            corpus(kind, spaces)

            if told.only != "warm":
                before = load()
                cold = []
                for at in range(told.runs):
                    one = launched(told.exe, told.identifier, spaces, cold=True)
                    if one:
                        cold.append(one)
                    say(f"cold {kind} {at + 1} of {told.runs}: {'read' if one else 'no line'}")
                after = load()
                if cold:
                    kept[f"cold {kind}"] = cold
                    medians = table(cold, f"cold, {kind} (load {before:.0f}% before, {after:.0f}% after)")
                    summary.append(f"cold {kind}: " + ", ".join(phases(medians)))

            if told.only != "cold":
                # Primed: a profile that has run once, with a note open in the big space.
                launched(
                    told.exe,
                    told.identifier,
                    spaces,
                    cold=told.only == "warm",
                    then=opened_note(told.identifier) if kind == "big" else None,
                )
                before = load()
                warm = []
                for at in range(told.runs):
                    one = launched(told.exe, told.identifier, spaces, cold=False)
                    if one:
                        warm.append(one)
                    say(f"warm {kind} {at + 1} of {told.runs}: {'read' if one else 'no line'}")
                after = load()
                if warm:
                    kept[f"warm {kind}"] = warm
                    medians = table(warm, f"warm, {kind} (load {before:.0f}% before, {after:.0f}% after)")
                    summary.append(f"warm {kind}: " + ", ".join(phases(medians)))

                if told.throttle and warm:
                    slowed = []
                    port = {"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": "--remote-debugging-port=0"}
                    for at in range(told.runs):
                        one = launched(
                            told.exe,
                            told.identifier,
                            spaces,
                            cold=False,
                            then=throttled(told.identifier, told.throttle),
                            args=port,
                        )
                        if one and one.get("throttled", {}).get("marks"):
                            slowed.append(one["throttled"]["marks"])
                        say(f"{told.throttle:g}x {kind} {at + 1} of {told.runs}: {'read' if one else 'no line'}")
                    if slowed:
                        native = statistics.median(
                            next(s["at"] for s in run["steps"] if s["step"] == "window: page requested")
                            for run in warm
                            if any(s["step"] == "window: page requested" for s in run["steps"])
                        )
                        print()
                        print(
                            f"{told.throttle:g}x slower page, {kind}, median of {len(slowed)}, "
                            f"on top of {native:.0f} ms of warm native launch to the page request:"
                        )
                        names = sorted(
                            {name for marks in slowed for name in marks},
                            key=lambda name: statistics.median(m[name] for m in slowed if name in m),
                        )
                        for name in names:
                            page = statistics.median(m[name] for m in slowed if name in m)
                            print(f"  {name[:52]:52} {page:9.1f}  total {native + page:9.1f}")
                        kept[f"throttled {kind}"] = [{"native": native, "marks": m} for m in slowed]

    print()
    for line in summary:
        print(line)
    if told.json:
        told.json.write_text(json.dumps(kept, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
