"""Every drive in this folder, on one build, with a table at the end.

    python apps/desktop/test/e2e/run-all.py                 # build once, run all
    python apps/desktop/test/e2e/run-all.py --no-build      # reuse apps/desktop/dist
    python apps/desktop/test/e2e/run-all.py --only tree     # the drives matching a word
    python apps/desktop/test/e2e/run-all.py --jobs 1        # one at a time, out loud
    python apps/desktop/test/e2e/run-all.py --shard 2/3     # the second third of them
    python apps/desktop/test/e2e/run-all.py --list          # what would run, and how

Everything round a drive is harness.py's, so what is left here is the set:

  - **One build**, `--mode drive`, into `apps/desktop/dist`, and every drive run with
    `NIB_SKIP_BUILD=1` so it serves that one. If any drive against the real Worker is
    in the set, one more goes into `dist-worker`: the same app asking its own origin
    for the API, which every one of those drives' Workers serves. Before the harness,
    each of them rebuilt `dist` for itself and this runner rebuilt it again after,
    twice a drive.
  - **Several at once.** Every drive serves the build - or runs its Worker - on a free
    port under an origin of its own, so two drives no longer share anything but the
    processor: `--jobs` lanes take the next drive from one queue, the longest first,
    so no lane is left holding the slowest at the end.
  - **A second chance, said out loud.** A drive that fails is run once more on its
    own at the end, the way Playwright and Chromium's own harness retry, and one that
    passes then is called `flaky` in the table rather than passed: green, and named,
    so a drive that only holds when the machine is quiet is written down every night
    instead of hidden. `--retries 0` turns it off.
  - **Skipped, with the reason.** A drive that says it needs what this machine does
    not have - `NEEDS = ("native",)` - is listed as skipped with what it needed,
    every run, so a skip is never forgotten.
  - **Known, with the owner.** A failure already handed on is named on the drive
    (`known=` in harness.py): the drive is `known` rather than red while it happens,
    and the table says the night it stops.

A drive passes when it exits zero. The table says how long each took, whether it
checks something or only shows it, and where its pictures went; it is written to
`shots/results.md` and `shots/results.json` as well, and each drive's own output to
`shots/logs/<drive>.log`. The exit status is the number of drives that failed.

A run leaves the working tree dirty in one place: `store-shot.py` writes
`docs/media/screenshot.png`, which is tracked.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import harness  # noqa: E402

HERE = harness.HERE
LOGS = harness.SHOTS / "logs"

#: This file, and what is not a drive: the harness, a helper two of them import, the
#: comparer run by hand over two folders of shots, and `embed-sandbox.py`, which
#: talks to YouTube, Vimeo and CodePen and is evidence for one decision rather than a
#: check on the app; see its own docstring.
NOT_A_DRIVE = {"run-all.py", "harness.py", "compare.py", "settling.py", "embed-sandbox.py"}

#: How many drives run at once unless told: a quarter of the cores, and never more
#: than four, because every one of them is a browser and past that the machine is
#: what is being measured. One is every drive in order with its output on the screen.
JOBS = max(1, min(4, (os.cpu_count() or 4) // 4))

#: How long one drive may take before it is called hung, in seconds. A drive whose
#: honest run is longer says so at its top - `BUDGET = 2400` - the way Chromium's
#: harness keeps a list of the tests that are slow rather than raising every
#: test's timeout.
PATIENCE = 900
BUDGET = re.compile(r"^BUDGET = (\d+)", re.MULTILINE)

#: A drive counts as checking something when it can come back with a status other
#: than zero of its own accord: a verdict it counted up, or a walk-out over something
#: it did not like. The one walk-out that is not a verdict is "gave up waiting for",
#: which says the app never got going rather than that it is wrong.
COUNTED = re.compile(r"\bwrong\(|failures\.append\(|^\s+return 1\b", re.MULTILINE)
WALKED = re.compile(r"raise SystemExit\((f?\"(?!gave up waiting)[^\"]*\")", re.MULTILINE)

#: The drives running now, so a run that is stopped - Ctrl+C, a cancelled job - ends
#: them and everything under them rather than leaving a browser or a Worker behind.
RUNNING: set[subprocess.Popen[bytes]] = set()
STOPPING = threading.Event()

#: What marks a drive against the real Worker.
AGAINST_THE_WORKER = re.compile(r"\bharness\.Worker\b|\bWorker\(DRIVE\b")


@dataclass
class Result:
    drive: str
    status: str
    seconds: float
    kind: str
    shots: str
    note: str = ""
    code: int = 0


def drives(only: str | None, shard: str | None) -> list[Path]:
    found = sorted(one for one in HERE.glob("*.py") if one.name not in NOT_A_DRIVE)
    if only:
        words = [one.strip() for one in only.split(",") if one.strip()]
        found = [one for one in found if any(word in one.name for word in words)]
    if shard:
        at, of = (int(one) for one in shard.split("/"))
        found = [one for index, one in enumerate(found) if index % of == at - 1]
    return found


def budget(source: str, patience: int) -> int:
    """How long this drive is given: its own budget where it states a longer one."""
    found = BUDGET.search(source)
    return max(patience, int(found.group(1))) if found else patience


def known_of(drive: Path, status: str, why: str) -> tuple[str, str]:
    """A pass that only passed past a known failure is called `known`, with what it
    is and who has it; one whose known failure no longer happens says so, so the
    entry is taken off. Read off the drive's own log, where the harness said both."""
    log = LOGS / f"{drive.stem}.log"
    said = log.read_text(encoding="utf-8", errors="replace") if log.exists() else ""
    gone = re.findall(r"^KNOWN NO LONGER: (.*) - take it off", said, re.MULTILINE)
    held = re.findall(r"^KNOWN: (.*)$", said, re.MULTILINE)
    if status == "pass" and held:
        return "known", "; ".join(held)
    if gone:
        return status, "; ".join([why, *(f"no longer: {one}" for one in gone)]).strip("; ")
    return status, why


def kind_of(source: str) -> str:
    return "checks" if COUNTED.search(source) or WALKED.search(source) else "shows"


def shots_of(drive: Path) -> str:
    """Where a drive left its pictures: the folder named after it, folders inside it
    counted too."""
    folder = harness.SHOTS / drive.stem
    many = sum(1 for _ in folder.rglob("*.png")) if folder.is_dir() else 0
    return f"shots/{drive.stem} ({many})" if many else ""


def run(drive: Path, patience: int, environment: dict[str, str], echo: bool) -> tuple[int, float, str]:
    """One drive, its output into its log and - one lane at a time - onto the screen as
    it happens, so a run that is going wrong says so while it is.

    The drive's end is its process ending, not its output: a browser's helper that
    outlives the drive can hold the other end of the pipe for ever, and a runner that
    read until the pipe closed would wait with it."""
    LOGS.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    with (LOGS / f"{drive.stem}.log").open("wb") as written:
        process = harness.spawn(
            [sys.executable, "-u", str(drive)],
            cwd=harness.ROOT,
            env={**environment, "NIB_HANG_AFTER": str(max(30, patience - 30))},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        RUNNING.add(process)

        def copy() -> None:
            assert process.stdout is not None
            # A line that arrives after the drive has been let go of has nowhere to go.
            with contextlib.suppress(ValueError, OSError):
                for line in process.stdout:
                    written.write(line)
                    written.flush()
                    if echo:
                        sys.stdout.write(line.decode("utf-8", errors="replace"))
                        sys.stdout.flush()

        reader = threading.Thread(target=copy, daemon=True)
        reader.start()
        try:
            code = process.wait(timeout=patience)
            why = ""
        except subprocess.TimeoutExpired:
            harness.end(process)
            code, why = 124, f"gave up after {patience}s"
        finally:
            RUNNING.discard(process)
        reader.join(timeout=5)
    return code, time.monotonic() - started, why


def longest_first(found: list[Path], sources: dict[Path, str], patience: int) -> list[Path]:
    """The order the queue hands drives out in: the ones with a budget of their own
    first, then by size, which is a fair stand-in for how long a drive takes and costs
    nothing to know. The last drive of a run is then a short one."""
    return sorted(
        found,
        key=lambda one: (budget(sources[one], patience), one.stat().st_size),
        reverse=True,
    )


def main() -> int:
    ask = argparse.ArgumentParser(description="run every e2e drive on one build")
    ask.add_argument("--no-build", action="store_true", help="reuse apps/desktop/dist")
    ask.add_argument("--only", help="run the drives whose name holds this word (or any of a,b,c)")
    ask.add_argument("--list", action="store_true", help="say what would run and stop")
    ask.add_argument("--jobs", type=int, default=JOBS, help=f"drives at once (here, {JOBS})")
    ask.add_argument("--retries", type=int, default=1, help="second chances for a failed drive")
    ask.add_argument("--shard", help="i/n: every n-th drive from the i-th, for splitting a run")
    ask.add_argument("--patience", type=int, default=PATIENCE, help="seconds per drive")
    said = ask.parse_args()

    found = drives(said.only, said.shard)
    if not found:
        print("no drives matched", flush=True)
        return 1

    sources = {one: one.read_text(encoding="utf-8") for one in found}
    skipped = {one: harness.missing(harness.needs_of(sources[one])) for one in found}
    against = [one for one in found if AGAINST_THE_WORKER.search(sources[one])]

    if said.list:
        for one in found:
            serves = "worker" if one in against else "build"
            why = f"  skipped: {skipped[one]}" if skipped[one] else ""
            print(f"  {one.name:28} {kind_of(sources[one]):6} {serves:6}{why}", flush=True)
        return 0

    began = time.monotonic()
    environment = {
        **os.environ,
        "NIB_SKIP_BUILD": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",
    }
    if not said.no_build:
        os.environ.pop("NIB_SKIP_BUILD", None)
    else:
        os.environ["NIB_SKIP_BUILD"] = "1"
    # A folder named by NIB_DIST was built by hand and is served as it is.
    if harness.OWN_BUILD:
        harness.build()

    running = [one for one in found if not skipped[one]]
    if any(one in against for one in running):
        harness.build(harness.WORKER_DIST, served_by_worker=True)

    results: dict[str, Result] = {}
    for one in found:
        if skipped[one]:
            results[one.stem] = Result(one.name, "skipped", 0.0, kind_of(sources[one]), "", skipped[one])

    lock = threading.Lock()
    echo = said.jobs <= 1
    # One at a time goes in the folder's own order, which is the run to watch; several
    # take the longest first.
    waiting = list(running) if echo else longest_first(running, sources, said.patience)

    def work() -> None:
        while not STOPPING.is_set():
            with lock:
                if not waiting:
                    return
                one = waiting.pop(0)
            if echo:
                print(f"=== {one.name} ===", flush=True)
            code, took, why = run(one, budget(sources[one], said.patience), environment, echo)
            status = "pass" if code == 0 else ("timeout" if code == 124 and why else "FAIL")
            status, why = known_of(one, status, why)
            result = Result(one.name, status, took, kind_of(sources[one]), shots_of(one), why, code)
            with lock:
                results[one.stem] = result
                if not echo:
                    print(f"  {status:8} {took:6.0f}s  {one.name}", flush=True)

    threads = [threading.Thread(target=work, daemon=True) for _ in range(max(1, said.jobs))]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            while thread.is_alive():
                thread.join(timeout=1)
    except KeyboardInterrupt:
        STOPPING.set()
        for process in list(RUNNING):
            harness.end(process)
        print("stopped; every drive that was running has been ended", flush=True)
        return 130

    # The second chances, one at a time on a machine with nothing else of this run's on
    # it: a drive that failed because four others were busy beside it is answered by
    # running it alone.
    for _ in range(said.retries):
        again = [one for one in running if results[one.stem].status in ("FAIL", "timeout")]
        for one in again:
            print(f"=== {one.name}, again ===", flush=True)
            # What went wrong the first time is kept beside the second go's log: a drive
            # called flaky is only worth something with the failure it had.
            log = LOGS / f"{one.stem}.log"
            if log.exists():
                log.replace(LOGS / f"{one.stem}.first.log")
            code, took, why = run(one, budget(sources[one], said.patience), environment, True)
            if code == 0:
                first = results[one.stem]
                status, why = known_of(one, "flaky", f"failed first ({first.code})")
                results[one.stem] = Result(one.name, status, took, first.kind, shots_of(one), why)

    table = [results[one.stem] for one in found]
    report(table, time.monotonic() - began)
    return sum(1 for one in table if one.status in ("FAIL", "timeout"))


def report(table: list[Result], wall: float) -> None:
    passed = sum(1 for one in table if one.status == "pass")
    flaky = [one for one in table if one.status == "flaky"]
    known = [one for one in table if one.status == "known"]
    failed = [one for one in table if one.status in ("FAIL", "timeout")]
    skipped = [one for one in table if one.status == "skipped"]
    ran = len(table) - len(skipped)
    summary = (
        f"{passed + len(flaky) + len(known)} of {ran} passed ({len(flaky)} flaky, "
        f"{len(known)} past a known failure), {len(failed)} failed, "
        f"{len(skipped)} skipped, in {wall / 60:.1f} min"
    )

    print("", flush=True)
    print(f"{'drive':28} {'status':>8} {'time':>7}  {'kind':6} shots", flush=True)
    print("-" * 88, flush=True)
    for one in table:
        mark = f"FAIL {one.code}" if one.status == "FAIL" else one.status
        tail = f"  {one.note}" if one.note else ""
        print(f"{one.drive:28} {mark:>8} {one.seconds:6.0f}s  {one.kind:6} {one.shots}{tail}", flush=True)
    print("-" * 88, flush=True)
    print(summary, flush=True)
    for one in failed:
        print(f"  FAILED  {one.drive}  (shots/logs/{Path(one.drive).stem}.log){'  ' + one.note if one.note else ''}")
    for one in flaky:
        print(f"  FLAKY   {one.drive}  {one.note}")
    for one in known:
        print(f"  KNOWN   {one.drive}  {one.note}")
    for one in skipped:
        print(f"  SKIPPED {one.drive}  {one.note}")

    harness.SHOTS.mkdir(parents=True, exist_ok=True)
    (harness.SHOTS / "results.json").write_text(
        json.dumps({"summary": summary, "drives": [asdict(one) for one in table]}, indent=2),
        encoding="utf-8",
    )
    rows = ["| drive | status | time | kind | note |", "| --- | --- | ---: | --- | --- |"]
    for one in table:
        mark = {"pass": "pass", "flaky": "flaky", "known": "known", "skipped": "skipped"}.get(
            one.status, f"**{one.status}**"
        )
        rows.append(f"| {one.drive} | {mark} | {one.seconds:.0f}s | {one.kind} | {one.note} |")
    (harness.SHOTS / "results.md").write_text(
        f"### Drives\n\n{summary}\n\n" + "\n".join(rows) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    raise SystemExit(main())
