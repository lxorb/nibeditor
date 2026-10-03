"""A stand-in for `ssh`, for the remote terminal's probe: it never reaches a machine.

nib starts the system's `ssh` in a terminal's pseudo console (docs/terminal.md, _Another
machine_). A probe cannot connect anywhere real - not to a reader's own hosts, not to the
internet - and this machine has no `sshd` to connect to, so `NIB_SSH` points the crate at
this instead, through a one-line `.cmd` the probe writes beside its own temp files.

What it does is what the probe checks against:

* writes the arguments it was given, one JSON line a start, to `FAKE_SSH_LOG`;
* says it is connected to the destination after `--`, and draws a prompt;
* `drop` ends it the way a connection that went away ends `ssh`: a line, and 255;
* `exit` ends it with 0, as a remote shell's `exit` does;
* anything else is said back, so a keystroke is seen to arrive.

    NIB_SSH=fake-ssh.cmd FAKE_SSH_LOG=log.jsonl nib.exe
"""

from __future__ import annotations

import json
import os
import sys


def main() -> int:
    args = sys.argv[1:]
    log = os.environ.get("FAKE_SSH_LOG")
    if log:
        with open(log, "a", encoding="utf-8") as out:
            out.write(json.dumps(args) + "\n")

    destination = args[args.index("--") + 1] if "--" in args and args.index("--") + 1 < len(args) else "?"
    sys.stdout.write(f"fake ssh: connected to {destination}\r\n")
    while True:
        sys.stdout.write(f"{destination}$ ")
        sys.stdout.flush()
        line = sys.stdin.readline()
        if not line:
            return 255
        said = line.strip()
        if said == "exit":
            return 0
        if said == "drop":
            sys.stdout.write(f"Connection to {destination} closed by remote host.\r\n")
            sys.stdout.flush()
            return 255
        sys.stdout.write(f"you said: {said}\r\n")


if __name__ == "__main__":
    raise SystemExit(main())
