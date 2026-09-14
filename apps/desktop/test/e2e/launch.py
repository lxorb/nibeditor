"""What a launch of the installed app costs, from before its first line to a usable
shell.

The one thing about this app that cannot be measured anywhere but on the machine
complaining about it, so the app times itself: `NIB_TRACE_STARTUP=1` and every
launch appends a page and one line of JSON to `startup-trace.log`. This reads the
JSON, runs the app as many times as asked, and reports the median of each step.

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
      --config '{"identifier":"ch.emilvinu.nib.probe"}'

Every run gets `NIB_SPACES_DIR` pointed at a folder of its own, so nothing here
reads or writes the notes anybody has. `--corpus big` copies the five thousand note
fixture in first; `--corpus empty` leaves the folder empty, which is the launch of
somebody who has just installed it.

Cold is the first launch after a build - the machine has not read the binary before
and neither has whatever scans it. Warm is every launch after that. They are
different questions and the table says which it is.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import statistics
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
APP = ROOT / "apps" / "desktop"

#: The identifier the probe build carries, and so the folder it keeps its own log
#: and settings in. Never the one somebody's real notes are under.
PROBE = "ch.emilvinu.nib.probe"

#: Where that build puts the binary.
EXE = APP / "src-tauri" / "target" / "release" / "nib.exe"

#: How long a launch is given before it is asked to go away. Long enough for the
#: window's own half of the trace to be sent, which waits for the stages the launch
#: order lets go of; see `SETTLE` in lib/trace.ts.
WATCH = 26

#: And how long to wait for the file to be written after that.
WRITTEN = 3


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

    started = subprocess.Popen([str(EXE)], env=environment)
    if slow:
        # A slower device, as far as one can be had without one: the process pinned
        # to a single core and put below normal, which is the proxy this machine can
        # offer for a phone. Said in the report as a proxy rather than as a throttle.
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

    time.sleep(WATCH)
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

    return json.loads(lines[-1])


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
    ask.add_argument("--slow", action="store_true", help="one core, below normal")
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
