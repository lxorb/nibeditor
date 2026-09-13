"""Every drive in this folder, one after another, with a table at the end.

Forty-odd drives were each written beside the batch that needed them, and each
knows how to serve the built app and seed a space for itself. What nobody had
was a way to run the set: this is it.

    python apps/desktop/test/e2e/run-all.py              # build once, run all
    python apps/desktop/test/e2e/run-all.py --no-build   # reuse apps/desktop/dist
    python apps/desktop/test/e2e/run-all.py --only tree  # the drives matching a word
    python apps/desktop/test/e2e/run-all.py --list       # what would run, in order

One build, at the start, into `apps/desktop/dist`, and then every drive is run
with `NIB_SKIP_BUILD=1` so the set costs one build rather than forty. Drives run
one at a time, each on the port it already picked for itself, because two drives
sharing a port is only a problem when they overlap and none of them do here.

A drive passes when it exits zero, which is what the drives that check something
already do; the ones that only print what they saw and photograph it pass as
long as they get through, which is still worth knowing - a scratch drive that
throws is an app that broke. The last column says which kind each one is.

Two things about the set that are not true of a drive on its own:

  - Ten of them build the app against a Worker of their own, which bakes that
    Worker's address into `dist` as the API. The build left behind then points
    at a port with nothing on it, so the shared build is made again after any
    drive that did this; see WORKER_BUILD.
  - A port belongs to the machine rather than to this run, and drives are run by
    hand and by other people at the same time. A drive whose port is already
    taken is not a drive that failed, so its port is waited for and it is called
    blocked rather than failed if the wait runs out.
  - Those same ten want `CLOUDFLARE_API_TOKEN` in the environment, because the
    Worker binds Workers AI and that has no local emulation: `wrangler dev`
    opens a remote proxy session for it and cannot without one. The two that
    hold a socket open die without it; the ones that only make requests have
    been seen to carry on. So the run says the token is missing and goes ahead
    anyway.

The table at the end holds the exit status, how long it took and where it put
its screenshots. The exit status of the run is the number of drives that failed;
a drive that was blocked is counted and named separately.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
APP = ROOT / "apps" / "desktop"

#: This file, and anything else that is not a drive: a tool two of them use, and
#: the comparer, which is run by hand over two folders of shots.
NOT_A_DRIVE = {"run-all.py", "compare.py", "settling.py"}

#: How long one drive may take before it is called hung. The longest of them,
#: the one that drives two browsers through a shared canvas, takes minutes.
PATIENCE = 900

#: A drive that only prints what it saw is still a drive, but the table should
#: not claim it checked anything. A drive counts as checking something when it
#: can come back with a status other than zero of its own accord: a verdict it
#: counted up, or a walk-out over something it did not like. The one walk-out
#: that is not a verdict is the shared "gave up waiting" helper, which every
#: drive has and which says the app never got going rather than that it is
#: wrong, so it is not what makes a drive one that checks.
WAITED = "gave up waiting for"
VERDICT = re.compile(r"^\s+return 1\b", re.MULTILINE)
WALKED = re.compile(r"raise SystemExit\([\"f]", re.MULTILINE)

#: The port a drive picked for itself, as it writes it.
PICKED = re.compile(r"^[A-Z_]*PORT[A-Z_]* = (\d+)$", re.MULTILINE)

#: A drive that bakes its own Worker's address into the build as the API. The
#: build it leaves behind is no use to the drive after it, so the shared one is
#: made again; see the note at the top of this file.
WORKER_BUILD = "VITE_NIB_API"

#: What such a drive wants in the environment. The Worker binds Workers AI,
#: which has no local emulation, so `wrangler dev` opens a remote proxy session
#: for it and cannot without a token in a non-interactive shell. Nothing the
#: drives themselves do reaches the AI; it is the binding being there that asks
#: for this. Whether the failure is fatal depends on the drive: the two that
#: hold a socket open die on it, and the ones that only make requests have been
#: seen to carry on. So this is said and not acted on, because skipping a drive
#: that would have passed is worse than a drive that says why it did not.
WORKER_TOKEN = "CLOUDFLARE_API_TOKEN"

#: How long to wait for a port somebody else is using, and how often to look.
FREEING = 180
LOOKING = 3

#: What a blocked drive is reported as. Not a status any drive returns.
BLOCKED = -1


def drives(only: str | None) -> list[Path]:
    found = sorted(one for one in HERE.glob("*.py") if one.name not in NOT_A_DRIVE)
    if only:
        found = [one for one in found if only in one.name]
    return found


def kind_of(drive: Path) -> str:
    source = drive.read_text(encoding="utf-8")
    if VERDICT.search(source):
        return "checks"
    walkouts = [one for one in source.splitlines() if WALKED.search(one)]
    if any(WAITED not in one for one in walkouts):
        return "checks"
    return "shows"


def ports_of(drive: Path) -> list[int]:
    """The ports a drive says it uses. Read off the source because that is where
    a drive states them, and nothing hands them to it."""
    return [int(one) for one in PICKED.findall(drive.read_text(encoding="utf-8"))]


def taken(port: int) -> bool:
    """Whether something already holds a port. `SO_REUSEADDR` is deliberately
    not set: the question is whether a drive's own plain server could bind it,
    and that is the bind this imitates."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return True
    return False


def free(drive: Path, patience: int) -> list[int]:
    """Waits for every port a drive wants, and answers with the ones that never
    came free. Drives are run by other people and by hand on the same machine,
    and a port somebody else is on is not this drive being wrong."""
    wanted = ports_of(drive)
    until = time.monotonic() + patience
    while True:
        busy = [one for one in wanted if taken(one)]
        if not busy or time.monotonic() >= until:
            return busy
        print(f"  waiting for port {busy[0]}, which something else holds", flush=True)
        time.sleep(LOOKING)


def build() -> int:
    """One build for the whole set, in development mode: a production build hides
    the stores on `window.nibApp` that nearly every drive seeds its space through."""
    print("building the web app once for the whole set", flush=True)
    started = time.monotonic()
    done = subprocess.run(
        [shutil.which("npx") or "npx", "vite", "build", "--mode", "development"],
        cwd=APP,
        env={**os.environ, "NODE_ENV": "development"},
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if done.returncode != 0:
        print("the build failed:", flush=True)
        print(done.stdout, flush=True)
        print(done.stderr, flush=True)
        return done.returncode
    print(f"built in {time.monotonic() - started:.0f}s", flush=True)
    return 0


def run(drive: Path, patience: int) -> tuple[int, float, str]:
    """One drive, with its own output passed straight through, so a run that is
    going wrong says so while it is going wrong rather than at the end."""
    started = time.monotonic()
    try:
        done = subprocess.run(
            [sys.executable, str(drive)],
            cwd=ROOT,
            env={**os.environ, "NIB_SKIP_BUILD": "1", "PYTHONIOENCODING": "utf-8"},
            timeout=patience,
            check=False,
        )
        return done.returncode, time.monotonic() - started, ""
    except subprocess.TimeoutExpired:
        return 124, time.monotonic() - started, f"gave up after {patience}s"


def shots(drive: Path) -> str:
    """Where a drive left its screenshots, if it left any.

    A folder named after the drive, which is what every one of them does now. A
    folder that was written to while the drive ran would be the more general
    answer and was the first one tried, but a directory's own timestamp is too
    coarse to tell one drive's folder from the last one's, so the table ended up
    naming folders the drive had nothing to do with."""
    root = HERE / "shots"
    if not root.is_dir():
        return ""

    # Named after the drive, or after the drive with something in front of it:
    # the three that photograph the shell put their pictures under
    # `shell-<name>`. Anything else says nothing rather than something wrong.
    found = [
        one
        for one in sorted(root.iterdir())
        if one.is_dir() and (one.name == drive.stem or one.name.endswith(f"-{drive.stem}"))
    ]

    counted = [(one, sum(1 for two in one.iterdir() if two.is_file())) for one in found]
    return ", ".join(f"shots/{one.name} ({many})" for one, many in counted if many)


def main() -> int:
    ask = argparse.ArgumentParser(description="run every e2e drive, in order")
    ask.add_argument("--no-build", action="store_true", help="reuse apps/desktop/dist")
    ask.add_argument("--only", help="run the drives whose name holds this word")
    ask.add_argument("--list", action="store_true", help="say what would run and stop")
    ask.add_argument("--patience", type=int, default=PATIENCE, help="seconds per drive")
    ask.add_argument(
        "--freeing", type=int, default=FREEING, help="seconds to wait for a busy port"
    )
    ask.add_argument(
        "--no-rebuild",
        action="store_true",
        help="leave a Worker-pointing build in place",
    )
    said = ask.parse_args()

    found = drives(said.only)
    if not found:
        print("no drives matched", flush=True)
        return 1

    if said.list:
        for one in found:
            print(f"  {one.name:22} {kind_of(one)}", flush=True)
        return 0

    if not said.no_build and build() != 0:
        return 1
    if said.no_build and not (APP / "dist" / "index.html").exists():
        print("nothing built under apps/desktop/dist", flush=True)
        return 1

    table: list[tuple[str, int, float, str, str, str]] = []
    for at, one in enumerate(found, 1):
        print(f"=== {at}/{len(found)} {one.name} ===", flush=True)

        source = one.read_text(encoding="utf-8")
        worker = WORKER_BUILD in source

        if worker and not os.environ.get(WORKER_TOKEN):
            print(f"  note: no {WORKER_TOKEN}, so its Worker may not start", flush=True)

        busy = free(one, said.freeing)
        if busy:
            ports = ", ".join(str(port) for port in busy)
            print(f"  skipped: port {ports} is held by something else", flush=True)
            table.append((one.name, BLOCKED, 0.0, kind_of(one), "", f"port {ports} taken"))
            continue

        status, took, why = run(one, said.patience)
        table.append((one.name, status, took, kind_of(one), shots(one), why))

        # The six that build against a Worker leave `dist` pointing at a port
        # that is gone the moment they are. The drive after this one would open
        # that build and find no API behind it, so the shared build is made
        # again here rather than left as a trap.
        if worker and not said.no_rebuild:
            print(f"  {one.name} built against its own Worker; rebuilding", flush=True)
            if build() != 0:
                return len(found)

    failed = [one for one in table if one[1] not in (0, BLOCKED)]
    blocked = [one for one in table if one[1] == BLOCKED]

    print("", flush=True)
    print(f"{'drive':22} {'status':>8} {'time':>8}  {'kind':6} shots", flush=True)
    print("-" * 78, flush=True)
    for name, status, took, kind, where, why in table:
        if status == 0:
            mark = "pass"
        elif status == BLOCKED:
            mark = "blocked"
        else:
            mark = f"FAIL {status}"
        tail = f" {why}" if why else ""
        print(f"{name:22} {mark:>8} {took:7.0f}s  {kind:6} {where}{tail}", flush=True)

    print("-" * 78, flush=True)
    ran = len(table) - len(blocked)
    print(f"{ran - len(failed)} of {ran} ran and passed", flush=True)
    for name, status, _, _, _, why in failed:
        tail = f": {why}" if why else ""
        print(f"  FAILED {name}{tail}", flush=True)
    for name, _, _, _, _, why in blocked:
        print(f"  BLOCKED {name}: {why}", flush=True)

    return len(failed)


if __name__ == "__main__":
    raise SystemExit(main())
