"""What a launch of the installed app costs, from before its first line to a usable
shell.

The one thing about this app that cannot be measured anywhere but on the machine
complaining about it, so the app times itself: `NIB_TRACE_STARTUP=1` and every
launch appends a page and one line of JSON to `startup-trace.log`. This reads the
JSON, runs the app as many times as asked, and reports the median of each step.

One step in the table is not the app's own: `window on screen, as Windows reports it`
is the window manager's answer, polled from here, because that step is the one the app
cannot time about itself - the whole point of it is that it happens before there is a
webview to run a page that could say so.

Two columns, and the second is the one to read:

    ms      what somebody waited through, which is the question - and also what
            every other program on the machine was doing at the time
    cpu      what this process itself spent, user plus kernel. The same number on a
            quiet machine as on a loaded one, so it is the column that says whether
            a change made the app do less work rather than get luckier

Run it from the repository root. It never builds and never launches the app
somebody actually uses:

    python apps/desktop/test/e2e/launch.py --runs 5

The build has to be a release build under the probe identifier, because a debug
build loads the dev server rather than the page inside it and a window with no page
has no launch to trace:

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.launch"}'

Every run gets `NIB_SPACES_DIR` pointed at a folder of its own, so nothing here
reads or writes the notes anybody has. `--corpus big` copies the five thousand note
fixture in first; `--corpus empty` leaves the folder empty, which is the launch of
somebody who has just installed it.

Cold is the first launch after a build - the machine has not read the binary before
and neither has whatever scans it. Warm is every launch after that. They are
different questions and the table says which it is.

`--slow` pins the process to one core and puts it below normal, and it is here with a
warning on it: measured, it does not slow the app down. Four warm launches of the five
thousand note space came out at 735ms to a painted tree unpinned and 644ms pinned, on
the same machine in the same minute - pinning took the process off the cores the rest of
the machine was busy with, which helped. So it is not a slow device and nothing here
should be read as one. A real answer for a slow device wants a slow device, or the
webview throttled from the inside; neither is this.

What it said on this machine, over five thousand notes of four kilobytes each, before
this round and after it. Warm, median of four, and the machine had other work on it both
times - so the rows to trust are the differences inside one launch rather than the
totals, and the processor column beside them:

    first pixel on screen              370ms ->   46ms
    the tree read, asked to answered   142ms ->   38ms
      of which the walk itself         117ms ->   11ms
      processor spent by then          375ms ->  164ms
    modules evaluated                   89ms ->   86ms
    the shell painted, from the window
      being on screen                  162ms ->  514ms

The last row is the one to read twice. It grew because its zero moved: the window is on
screen 324ms earlier than it was, and the shell lands where it always did. Nothing was
made slower - the same launch, measured from a mark that now happens much sooner. Which
is the whole of what this round did on Windows: the wait is the same length and most of
it now happens behind a window somebody can see, in the colour they left it in.
"""

from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes
import json
import os
import shutil
import statistics
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

#: The identifier this build carries, and so the folder it keeps its own log and
#: settings in. Never the one somebody's real notes are under.
#:
#: Its own rather than the `.probe` other measurements here use, because the app holds a
#: single-instance lock keyed by exactly this string: a launch made while another build
#: with the same identifier is running never opens a window at all. It hands its
#: arguments to the one already up and exits, and leaves nothing behind - no window, no
#: trace, and a drive reporting "no line" for a reason that has nothing to do with the
#: app being slow. Four runs were lost that way before this was written, to another
#: agent's probe in another worktree; see `handed over` in `launched`.
PROBE = "ch.emilvinu.nib.launch"

#: Where that build puts the binary.
EXE = APP / "src-tauri" / "target" / "release" / "nib.exe"

#: How long a launch is given before it is asked to go away. Long enough for the
#: window's own half of the trace to be sent, which waits for the stages the launch
#: order lets go of; see `SETTLE` in lib/trace.ts.
WATCH = 26

#: And how long to wait for the file to be written after that.
WRITTEN = 3

#: How long to give a launch to prove it is one. A build that met the single-instance
#: lock is gone well inside this; one that is opening a window is not.
ALIVE = 2

#: How often to ask Windows whether there is a window yet, in seconds. Fine enough that
#: the answer is the window's moment rather than the poll's.
PEEK = 0.004

#: The step the poll below is written into the trace as. Named rather than numbered
#: because its zero is a shade different from the trace's own: the trace counts from the
#: app's first line and this counts from just before the process was started, so it
#: carries whatever `CreateProcess` costs the parent. A millisecond or two, against a
#: figure worth hundreds.
ON_SCREEN = "window on screen, as Windows reports it"

#: A window smaller than this is not the window. A process can own message-only and
#: tooltip windows, and they are visible as far as the API is concerned.
SMALLEST = 100


def on_screen(pid: int) -> bool:
    """Whether this process has a window on screen, asked of Windows.

    The one thing the app cannot answer about itself. Every mark the app makes is a mark
    it makes *after* something happened, and "the window is up" is the one step whose
    whole point is that it happens before the app is in a position to say so - the
    webview that would run the page does not exist yet. So this asks the window manager
    instead.
    """
    user = ctypes.windll.user32
    proc = ctypes.wintypes.DWORD()
    found = False

    class Rect(ctypes.Structure):
        _fields_ = [
            ("left", ctypes.c_long),
            ("top", ctypes.c_long),
            ("right", ctypes.c_long),
            ("bottom", ctypes.c_long),
        ]

    def each(window: int, _unused: int) -> bool:
        nonlocal found
        user.GetWindowThreadProcessId(window, ctypes.byref(proc))
        if proc.value != pid or not user.IsWindowVisible(window):
            return True

        box = Rect()
        if not user.GetClientRect(window, ctypes.byref(box)):
            return True
        if box.right - box.left < SMALLEST or box.bottom - box.top < SMALLEST:
            return True

        found = True
        return False

    shape = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    user.EnumWindows(shape(each), 0)

    return found


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def logs() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise SystemExit("no LOCALAPPDATA, so no idea where the log goes")

    return Path(local) / PROBE / "logs"


def corpus(kind: str, into: Path) -> None:
    """The notes a launch reads, in a folder of this run's own."""
    into.mkdir(parents=True, exist_ok=True)
    if kind != "big":
        return

    # The fixture speed.py seeds into a browser's storage, on the disk this time:
    # the same five thousand notes, the same four kilobytes each, so the two drives
    # are talking about one corpus.
    space = into / "Big"
    space.mkdir(parents=True, exist_ok=True)
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


def launched(spaces: Path, slow: bool) -> dict | None:
    """One launch, and the line it left behind.

    Killed by the process object rather than by name: another agent's build may be
    running under the same name, and a drive has no business ending anybody else's
    process.
    """
    trace = logs() / "startup-trace.log"
    if trace.exists():
        trace.unlink()

    environment = {
        **os.environ,
        "NIB_TRACE_STARTUP": "1",
        "NIB_SPACES_DIR": str(spaces),
    }

    from_here = time.perf_counter()
    started = subprocess.Popen([str(EXE)], env=environment)

    # Whether this process is the one that opens the window, or whether it found a window
    # already up under the same identifier and handed itself over to it. The second is
    # not a slow launch and not a failed one: it is no launch, and reporting it as either
    # is a measurement of nothing.
    #
    # Waited out by polling for the window rather than by sleeping, so that the one step
    # the app cannot time about itself is timed here; see `on_screen`.
    appeared: float | None = None
    while time.perf_counter() - from_here < ALIVE:
        if started.poll() is not None:
            say("handed over to a build already running under this identifier: no launch")
            return None
        if on_screen(started.pid):
            appeared = (time.perf_counter() - from_here) * 1000
            break
        time.sleep(PEEK)

    if slow:
        # The process pinned to a single core and put below normal.
        #
        # Meant as the nearest thing to a slow device this machine can offer, and kept
        # because somebody will want to try it - but it is not one, and the docstring
        # says so with the numbers. A launch pinned to one core measured *faster* than
        # the same launch unpinned, because the core it was pinned to was not the one
        # the rest of the machine was busy on.
        subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"$p = Get-Process -Id {started.pid} -ErrorAction SilentlyContinue;"
                " if ($p) { $p.ProcessorAffinity = 1; $p.PriorityClass = 'BelowNormal' }",
            ],
            capture_output=True,
            check=False,
        )

    # Whatever is left of the watch, and the poll kept going until there is a window:
    # a launch slower than `ALIVE` has one later rather than never.
    waited = time.perf_counter() - from_here
    while appeared is None and time.perf_counter() - from_here < WATCH:
        if on_screen(started.pid):
            appeared = (time.perf_counter() - from_here) * 1000
            break
        time.sleep(PEEK)

    time.sleep(max(0.0, WATCH - max(waited, time.perf_counter() - from_here)))
    started.kill()
    started.wait(timeout=30)
    time.sleep(WRITTEN)

    if not trace.exists():
        return None

    lines = [
        one
        for one in trace.read_text(encoding="utf-8", errors="replace").splitlines()
        if one.startswith("{")
    ]
    if not lines:
        return None

    read = json.loads(lines[-1])

    # The poll's answer goes in with the app's own marks, so one table holds the whole
    # launch. `table` sorts by the median moment, so it lands where it happened.
    if appeared is not None:
        read["steps"].append({"step": ON_SCREEN, "at": appeared})

    return read


def table(runs: list[dict], what: str) -> None:
    """The median of each step, in both columns, in the order they happened."""
    names: list[str] = []
    for run in runs:
        for step in run["steps"]:
            if step["step"] not in names:
                names.append(step["step"])

    # In the order the medians say, not the order the first run happened to have:
    # two runs whose stages interleave differently would otherwise print a step
    # before the one it came after, and a "since" column of nonsense with it.
    rows = []
    for name in names:
        at = [one["at"] for run in runs for one in run["steps"] if one["step"] == name]
        cpu = [
            one["cpu"]
            for run in runs
            for one in run["steps"]
            if one["step"] == name and "cpu" in one
        ]
        rows.append((statistics.median(at), name, statistics.median(cpu) if cpu else None))

    rows.sort()

    print()
    print(f"{what}, median of {len(runs)}:")
    print(f"  {'step':44} {'at':>9} {'since':>9} {'cpu':>9}")

    last = 0.0
    for middle, name, spent in rows:
        column = f"{spent:9.1f}" if spent is not None else " " * 9
        print(f"  {name:44} {middle:9.1f} {middle - last:9.1f} {column}")
        last = middle


def main() -> int:
    ask = argparse.ArgumentParser(description=__doc__)
    ask.add_argument("--runs", type=int, default=5)
    ask.add_argument("--corpus", default="empty", choices=["empty", "big"])
    ask.add_argument(
        "--slow", action="store_true", help="one core, below normal - not a slow device"
    )
    told = ask.parse_args()

    if not EXE.exists():
        raise SystemExit(f"no probe build at {EXE}; see this file's docstring")

    spaces = APP / "test" / "e2e" / "shots" / f"launch-{told.corpus}"
    if spaces.exists():
        shutil.rmtree(spaces, ignore_errors=True)
    say(f"the {told.corpus} corpus, in {spaces}")
    corpus(told.corpus, spaces)

    cold = launched(spaces, told.slow)
    if cold:
        table([cold], f"cold, {told.corpus}" + (" , one core" if told.slow else ""))
    else:
        say("the cold launch left no line")

    warm: list[dict] = []
    for at in range(told.runs):
        one = launched(spaces, told.slow)
        if one:
            warm.append(one)
        say(f"warm {at + 1} of {told.runs}: {'read' if one else 'no line'}")

    if warm:
        table(warm, f"warm, {told.corpus}" + (", one core" if told.slow else ""))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
