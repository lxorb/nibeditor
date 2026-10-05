"""The agent scenarios, run against a probe build. Windows only.

Each file in `scenarios/` is one promise of docs/agent-native.md, written as the calls an
agent makes and what must come back, and what the sites must have seen: the fake agent
(fake_agent.py) makes the calls, the sites (pages.py) say what happened, and the family
watch in scripts/probe_app.py ends the run the moment anything of the app or of the
engine under it is on a screen or in front. The keyboard is read before and after every
scenario, and must not have moved.

    python apps/desktop/test/agents/run.py --exe <probe nib.exe> \\
        --identifier ch.emilvinu.nib.probe.<name> [--via endpoint|mcp] \\
        [--only <word>] [--skip <word>] [--out report.json]
    python apps/desktop/test/agents/run.py ... --launch-cost 3
    python apps/desktop/test/agents/run.py --list

The exe is a probe build, as scripts/probe_app.py says. A scenario ends as one of four:

    pass      every step answered as written, and the sites saw what it says
    fail      a step did not; the exit code counts these
    waiting   a verb or tool it needs is not there yet, or it fails in a way a
              lane already owns (its `known` note): named, with that lane
    skipped   it cannot run here now (a picker waits for a minute of nobody at the
              machine), or not through this road

`--launch-cost N` launches the probe N times with no agent and N times with one set up,
alternately, with the app's own launch trace on, and compares the two: an agent that is
configured and not connected must cost the launch nothing (docs/agent-native.md 11).
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import pathlib
import re
import secrets
import shutil
import statistics
import sys
import tempfile
import threading
import time
from typing import Any

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(HERE))

from fake_agent import Endpoint, Mcp  # noqa: E402
from pages import CANARY, Site  # noqa: E402

SCENARIOS = HERE / "scenarios"
SPACE = "Agent harness"

#: The agent every scenario is: all the scopes, the denied site denied, the limits as
#: the grant's defaults. A scenario changes its own copy through `grant`.
GRANT: dict[str, Any] = {
    "id": "harness",
    "name": "Harness",
    "client": "nib-agent-harness",
    "scopes": [
        "context",
        "notes.read",
        "notes.write",
        "tree",
        "workspace",
        "browser",
        "browser.reader",
        "browser.script",
        "browser.network",
        "browser.storage",
    ],
    "spaces": "all",
    "sites": {"denied.localhost": "deny"},
    "scripts": ["127.0.0.1", "other.localhost"],
    "mode": "unsupervised",
    "asks": {},
    "limits": {"tabs": 4, "calls": 600, "navigations": 60},
}

#: The roads a scenario is run through unless it names its own.
ROADS = ("endpoint", "mcp")

#: Which lane owes a verb, for a scenario that waits on one.
LANES = {
    "browser_": "agent-core",
    "agent_": "agent-core",
    "approval_status": "agent-core",
    "read_note": "agent-workspace-tools",
    "edit_note": "agent-workspace-tools",
}


# ---- the app ----


def config_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def logs_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["LOCALAPPDATA"]) / identifier / "logs"


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for base in (os.environ["APPDATA"], os.environ["LOCALAPPDATA"]):
        shutil.rmtree(pathlib.Path(base) / identifier, ignore_errors=True)


def seeded(identifier: str, agents: bool) -> tuple[str, str]:
    """The endpoint's file with `eval` on and a secret of the harness's own, and, where
    asked, the harness's agent with a token of its own: both written before the app
    starts, as a person would edit the first and paste the second. Answers the secret
    and the token."""

    folder = config_dir(identifier)
    folder.mkdir(parents=True, exist_ok=True)
    secret = secrets.token_hex(32)
    endpoint = {"port": 0, "secret": secret, "eval": True, "pid": 0}
    (folder / "automation.json").write_text(json.dumps(endpoint), encoding="utf-8")
    token = secrets.token_hex(32)
    kept = folder / "agents.json"
    if agents:
        grant = {**GRANT, "token": hashlib.sha256(token.encode()).hexdigest(), "created": int(time.time())}
        kept.write_text(json.dumps({"agents": [grant]}, indent=2), encoding="utf-8")
    elif kept.exists():
        kept.unlink()
    return secret, token


def endpoint(identifier: str, pid: int, seconds: float = 90) -> tuple[int, str]:
    """The port and secret the running probe wrote down."""

    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and int(said.get("pid") or 0) == pid:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the probe never wrote {path}")


class Probe:
    """One launch of the probe, off the screen and watched, with the space open."""

    def __init__(self, exe: pathlib.Path, identifier: str, spaces: pathlib.Path, env: dict[str, str] | None = None) -> None:
        from probe_app import main_window, run_probe

        self.exe = exe
        self.identifier = identifier
        self.app = run_probe(exe, env={**os.environ, "NIB_SPACES_DIR": str(spaces), **(env or {})}, quiet=True)
        self.port, self.secret = endpoint(identifier, self.app.pid)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not main_window(self.app.pid):
            time.sleep(0.2)
        self.window = Endpoint(self.port, self.secret)

    def reader(self, code: str, seconds: float = 60) -> dict[str, Any]:
        """Something the reader does, run in the app's own window: a press on the stop, a
        grant changed in Settings."""

        wrapped = f"(async () => {{ {code} }})().then((v) => JSON.stringify(v ?? null))"
        said = self.window.call("eval", {"code": wrapped, "yes": True}, seconds)
        if said["status"] == "ok" and isinstance(said.get("result"), str):
            said["result"] = json.loads(said["result"])
        return said

    def open_space(self) -> None:
        self.window.call("open", {"path": "Idea.md", "space": SPACE})
        time.sleep(1.5)

    def close(self) -> None:
        from probe_app import close_app

        if self.app.poll() is None and not close_app(self.app):
            self.app.kill()


def made_spaces() -> pathlib.Path:
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-agent-harness-"))
    space = root / SPACE
    space.mkdir(parents=True)
    (space / "Idea.md").write_text("# Idea\n\nA note to open the space on.\n", encoding="utf-8")
    (space / "Secret.md").write_text(f"# Secret\n\nThe code for the door is {CANARY}.\n", encoding="utf-8")
    return root


# ---- a scenario ----


def dotted(value: Any, path: str) -> Any:
    """`result.matches.0.ref` read out of an answer, or None where it is not there."""

    for part in path.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def filled(value: Any, names: dict[str, Any]) -> Any:
    """A scenario's words with `{site}`, `{tab}` and the rest put in."""

    if isinstance(value, str):
        whole = re.fullmatch(r"\{(\w+)\}", value)
        if whole and whole.group(1) in names:
            return names[whole.group(1)]
        return re.sub(r"\{(\w+)\}", lambda one: str(names.get(one.group(1), one.group(0))), value)
    if isinstance(value, list):
        return [filled(one, names) for one in value]
    if isinstance(value, dict):
        return {key: filled(one, names) for key, one in value.items()}
    return value


def worded(value: Any) -> str:
    """A value as the words a scenario looks for in it: a string as it is, anything else
    as its JSON."""

    return (value if isinstance(value, str) else json.dumps(value)).lower()


def judged(said: dict[str, Any], expect: dict[str, Any]) -> str | None:
    """Why an answer is not what the scenario expects, or None where it is."""

    if "one_of" in expect:
        reasons = [judged(said, one) for one in expect["one_of"]]
        return None if any(one is None for one in reasons) else " / ".join(str(one) for one in reasons)
    if "status" in expect and said.get("status") != expect["status"]:
        return f"status {said.get('status')} ({said.get('code') or ''} {str(said.get('message') or '')[:160]}), not {expect['status']}"
    if "code" in expect and said.get("code") != expect["code"]:
        return f"code {said.get('code')}, not {expect['code']}"
    for path in expect.get("has", []):
        if dotted(said, path) in (None, "", []):
            return f"no {path} in {json.dumps(said)[:300]}"
    for path, words in expect.get("contains", {}).items():
        if str(words).lower() not in worded(dotted(said, path)):
            return f"{path} does not say {words!r}: {worded(dotted(said, path))[:200]}"
    for path, words in expect.get("lacks", {}).items():
        if str(words).lower() in worded(dotted(said, path)):
            return f"{path} says {words!r}"
    if expect.get("untrusted") and said.get("untrusted") is None:
        return "the page's words came back unmarked"
    if "slower_than_ms" in expect and said.get("ms", 0) < expect["slower_than_ms"]:
        return f"answered in {said.get('ms')} ms, sooner than {expect['slower_than_ms']}"
    if "faster_than_ms" in expect and said.get("ms", 0) > expect["faster_than_ms"]:
        return f"took {said.get('ms')} ms, more than {expect['faster_than_ms']}"
    return None


class Waiting(Exception):
    """A scenario that needs what a lane has not landed."""


class Skipped(Exception):
    """A scenario that cannot run here now."""


class Run:
    """One scenario against one road into the app."""

    def __init__(self, scenario: dict[str, Any], agent: Any, probe: Probe, site: Site) -> None:
        self.scenario = scenario
        self.agent = agent
        self.probe = probe
        self.site = site
        self.names: dict[str, Any] = {**site.urls, "canary": CANARY, "space": SPACE}
        self.background: dict[str, dict[str, Any]] = {}
        self.threads: dict[str, threading.Thread] = {}
        self.observed: list[str] = []
        self.windows: list[dict[str, Any]] = []
        self.before: set[int] = set()
        self.tabs: list[str] = []

    def step(self, at: int, step: dict[str, Any]) -> None:
        step = filled(step, self.names)
        if "call" in step:
            self.call(step)
        elif "join" in step:
            self.threads[step["join"]].join(timeout=120)
            self.expect(self.background[step["join"]], step.get("expect", {}), f"{step['join']} (joined)")
        elif "record" in step:
            self.record(step)
        elif step.get("keyboard") == "now":
            # After something the reader did, which may move the keyboard as it likes.
            from probe_app import keyboard

            self.keys = keyboard(self.probe.app.pid)
        elif "keyboard" in step:
            self.keyboard_same(f"step {at}")
        elif "windows" in step:
            seen = len(self.windows)
            self.watch_windows(float(step["windows"]) / 1000)
            if step.get("none") and len(self.windows) > seen:
                raise AssertionError(f"a window of the engine's appeared: {self.windows[seen:]}")
        elif "reader" in step:
            self.reader(step)
        elif "reader_call" in step:
            # The reader acting in a page through the engine, as the command line does: a
            # press or words of theirs, made without touching this machine's mouse or keys.
            said = self.probe.window.call(step["reader_call"], step.get("args", {}))
            self.expect(said, step.get("expect", {"status": "ok"}), f"the reader's {step['reader_call']}")
        elif "reader_eval" in step:
            said = self.probe.reader(step["reader_eval"])
            if said["status"] != "ok":
                raise AssertionError(f"the reader's own step: {said.get('message')}")
            for name, path in step.get("save", {}).items():
                self.names[name] = dotted(said, path)
        elif "pause" in step:
            time.sleep(float(step["pause"]) / 1000)
        elif "observe" in step:
            self.observe(step["observe"])
        else:
            raise AssertionError(f"step {at} is not a kind of step: {step}")

    def call(self, step: dict[str, Any]) -> None:
        verb, args = step["call"], step.get("args", {})

        def made() -> dict[str, Any]:
            said = self.agent.call(verb, args, seconds=float(step.get("seconds", 60)))
            if said["status"] == "missing":
                raise Waiting(f"{lane_of(verb)}: {verb} ({self.agent.name})")
            if verb == "browser_open" and said["status"] == "ok":
                self.tabs.append(str(dotted(said, "result.tab")))
            return said

        if "as" in step:
            name = step["as"]
            self.background[name] = {}

            def later() -> None:
                try:
                    self.background[name] = made()
                except Waiting as waiting:
                    self.background[name] = {"status": "missing", "message": str(waiting)}

            self.threads[name] = threading.Thread(target=later, daemon=True)
            self.threads[name].start()
            return
        said = made()
        self.expect(said, step.get("expect", {"status": "ok"}), verb)
        for name, path in step.get("save", {}).items():
            self.names[name] = dotted(said, path)

    def expect(self, said: dict[str, Any], expect: dict[str, Any], what: str) -> None:
        if said.get("status") == "missing":
            raise Waiting(str(said.get("message")))
        why = judged(said, expect)
        if why:
            raise AssertionError(f"{what}: {why}")

    def record(self, step: dict[str, Any]) -> None:
        """What the sites saw, which is the only judge of whether something happened."""

        kind, where = step["record"], step.get("where", {})
        exact = step.get("count")
        least = step.get("at_least", exact or 0)
        until = time.perf_counter() + float(step.get("within_ms", 1500)) / 1000
        # A page reports a moment after it acts: "never" is only said once that moment has
        # passed, and "at least" as soon as it holds.
        while time.perf_counter() < until and (exact == 0 or len(self.site.seen(kind, where)) < least):
            time.sleep(0.05)
        found = self.site.seen(kind, where)
        if len(found) < least or (exact is not None and len(found) != exact):
            wanted = str(exact) if exact is not None else f"at least {least}"
            raise AssertionError(f"the sites saw {len(found)} {kind} {where or ''}, not {wanted}: {found[:3]}")

    def reader(self, step: dict[str, Any]) -> None:
        command, args = step["reader"], step.get("args", {})
        said = self.probe.reader(f"return await window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args)})")
        if said["status"] != "ok":
            message = str(said.get("message") or "")
            if "not found" in message or "unknown" in message.lower():
                raise Waiting(f"agent-core: the command {command}")
            raise AssertionError(f"the reader's {command}: {message}")

    def keyboard_same(self, when: str) -> None:
        from probe_app import keyboard

        now = keyboard(self.probe.app.pid)
        if now != self.keys:
            raise AssertionError(f"the keyboard moved by {when}: {self.keys} then {now}")

    def watch_windows(self, seconds: float) -> None:
        """Every window of the family, for a while, with where each one is. The watch
        ends the run if any is on a screen; this is for the report of where the others
        went."""

        from probe_app import UNDRAWN, UNDRAWN_SUFFIX, family, in_physical_pixels, look, on_a_screen

        in_physical_pixels()
        pids = family(self.probe.app.pid)
        known = self.before | {one["hwnd"] for one in self.windows}
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            now = look(pids)
            for one in now.windows:
                helper = one.kind in UNDRAWN or one.kind.endswith(UNDRAWN_SUFFIX)
                if one.visible and not helper and one.hwnd not in known:
                    known.add(one.hwnd)
                    self.windows.append({"hwnd": one.hwnd, "pid": one.pid, "kind": one.kind, "box": one.box,
                                         "on a screen": on_a_screen(one.box, now.screens)})
            time.sleep(0.004)

    def observe(self, what: dict[str, Any]) -> None:
        if "record" in what:
            time.sleep(float(what.get("within_ms", 1500)) / 1000)
            seen = self.site.seen(what["record"], what.get("where"))
            self.observed.append(f"the sites saw {len(seen)} {what['record']}: {[one.get('text', '') for one in seen][:2]}")
        if "saved" in what:
            value = str(self.names.get(what["saved"]) or "").lower()
            for label, words in what.get("counts", {}).items():
                self.observed.append(f"{label}: {value.count(str(words).lower())}")

    def run(self) -> dict[str, Any]:
        from probe_app import family, idle_seconds, keyboard, look

        scenario = self.scenario
        via = scenario.get("via", ROADS)
        if self.agent.name not in via:
            return {"result": "skipped", "why": f"only through {', '.join(via)}"}
        wait = float(scenario.get("idle", 0))
        if wait and idle_seconds() < wait:
            return {"result": "skipped", "why": f"somebody used this machine in the last {wait:.0f} s"}
        if getattr(self.agent, "absent", ""):
            return {"result": "waiting", "why": f"agent-mcp: {self.agent.absent}"}
        missing = [verb for verb in needed(scenario) if not self.agent.has(verb)]
        if missing:
            return {"result": "waiting", "why": f"{lane_of(missing[0])}: {', '.join(missing)} ({self.agent.name})"}

        if scenario.get("grant") and not granted(self.probe, scenario["grant"]):
            return {"result": "waiting", "why": "agent-core: agents_read and agents_write"}

        self.site.forget()
        self.keys = keyboard(self.probe.app.pid)
        self.before = {one.hwnd for one in look(family(self.probe.app.pid)).windows}
        started = time.perf_counter()
        try:
            for at, step in enumerate(scenario["steps"], 1):
                self.step(at, step)
            self.keyboard_same("the end")
            result: dict[str, Any] = {"result": "pass"}
        except Waiting as waiting:
            result = {"result": "waiting", "why": str(waiting)}
        except AssertionError as failed:
            result = {"result": "fail", "why": str(failed)}
        finally:
            for tab in self.tabs:
                self.agent.call("browser_close", {"tab": tab}, seconds=10)
            if scenario.get("grant"):
                granted(self.probe, GRANT)
        # A failure somebody already owns is that lane's to close, and said as waiting on
        # it; the day it passes, the note is stale and the run says so.
        known = scenario.get("known")
        if known and result["result"] == "fail":
            result = {"result": "waiting", "why": f"{known} ({result['why']})"}
        elif known and result["result"] == "pass":
            result["why"] = f"passes now: drop its known note ({known})"
        result["ms"] = round((time.perf_counter() - started) * 1000)
        if self.observed:
            result["observed"] = self.observed
        if self.windows:
            result["windows"] = self.windows
        return result


def needed(scenario: dict[str, Any]) -> list[str]:
    return sorted({step["call"] for step in scenario["steps"] if "call" in step})


def lane_of(verb: str) -> str:
    for prefix, lane in LANES.items():
        if verb.startswith(prefix):
            return lane
    return "agent-workspace-tools"


def scenarios(only: str | None, skip: list[str] | None = None) -> list[tuple[str, dict[str, Any]]]:
    found = []
    for path in sorted(SCENARIOS.glob("*.json")):
        if (only and only not in path.stem) or any(one in path.stem for one in skip or []):
            continue
        found.append((path.stem, json.loads(path.read_text(encoding="utf-8"))))
    # The step that could put an engine window on a screen goes last, so that if the
    # watch ends the run there, every other answer is already in.
    return sorted(found, key=lambda one: bool(one[1].get("idle")))


def granted(probe: Probe, change: dict[str, Any]) -> bool:
    """The harness's agent with a scenario's changes, written the way Settings writes it.
    False where the crate has no such command yet."""

    said = probe.reader("return await window.__TAURI_INTERNALS__.invoke('agents_read')")
    if said["status"] != "ok" or not isinstance(said.get("result"), list):
        return False
    grants = copy.deepcopy(said["result"])
    for grant in grants:
        if grant.get("id") == GRANT["id"]:
            for key, value in change.items():
                grant[key] = {**grant.get(key, {}), **value} if isinstance(value, dict) else value
    written = probe.reader(f"return await window.__TAURI_INTERNALS__.invoke('agents_write', {{ grants: {json.dumps(grants)} }})")
    return written["status"] == "ok"


def road(via: str, probe: Probe, token: str, spaces: pathlib.Path) -> Any:
    from probe_app import run_probe

    if via == "endpoint":
        return Endpoint(probe.port, token)
    # The token kept where `nib mcp` keeps the one a pairing gave it, and as it keeps it -
    # the agent it was made for and the token (mcp/pairing.rs `Kept`) - so it never asks
    # (docs/agent-native.md 9.1, a pasted token); and `nib mcp` is the probe's own binary
    # in a mode with no window, so it is launched, and watched, like the probe itself.
    clients = config_dir(probe.identifier) / "agents" / "clients"
    clients.mkdir(parents=True, exist_ok=True)
    kept = {"agent": GRANT["id"], "token": token}
    (clients / Mcp.CLIENT).write_text(json.dumps(kept), encoding="utf-8")
    process = run_probe(probe.exe, env={**os.environ, "NIB_SPACES_DIR": str(spaces)}, args=["mcp"], piped=True)
    return Mcp(process)


def scenario_run(args: argparse.Namespace) -> int:
    wipe(args.identifier)
    spaces = made_spaces()
    site = Site()
    _, token = seeded(args.identifier, agents=True)
    probe = Probe(args.exe, args.identifier, spaces)
    report: dict[str, Any] = {"via": args.via, "exe": str(args.exe), "scenarios": {}}
    failed = 0
    try:
        probe.open_space()
        agent = road(args.via, probe, token, spaces)
        for name, scenario in scenarios(args.only, args.skip):
            said = Run(scenario, agent, probe, site).run()
            said["proves"] = scenario.get("proves", "")
            report["scenarios"][name] = said
            failed += said["result"] == "fail"
            print(f"{name:28} {said['result']:8} {said.get('why', '')}", flush=True)
            for line in said.get("observed", []):
                print(f"{'':28} {'':8} {line}", flush=True)
            for one in said.get("windows", []):
                print(f"{'':28} {'':8} window {one['kind']} at {one['box']}, on a screen: {one['on a screen']}", flush=True)
            if args.out:
                args.out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        agent.close()
    finally:
        probe.close()
        site.close()
        shutil.rmtree(spaces, ignore_errors=True)
    return failed


# ---- what an agent that is set up and not connected costs the launch ----


def traced(identifier: str) -> dict[str, Any] | None:
    path = logs_dir(identifier) / "startup-trace.log"
    if not path.exists():
        return None
    lines = [one for one in path.read_text(encoding="utf-8", errors="replace").splitlines() if one.startswith("{")]
    return json.loads(lines[-1]) if lines else None


def launch_cost(args: argparse.Namespace) -> int:
    from probe_app import family, parents

    wipe(args.identifier)
    spaces = made_spaces()
    runs: dict[bool, list[dict[str, Any]]] = {False: [], True: []}
    try:
        for turn in range(args.launch_cost):
            # Each way first in turn, so whatever the machine drifts through lands on both.
            for agents in (False, True) if turn % 2 == 0 else (True, False):
                seeded(args.identifier, agents=agents)
                trace = logs_dir(args.identifier) / "startup-trace.log"
                if trace.exists():
                    trace.unlink()
                probe = Probe(args.exe, args.identifier, spaces, env={"NIB_TRACE_STARTUP": "1"})
                # The window's half of the trace waits for the launch order's last stage.
                time.sleep(12)
                pids = family(probe.app.pid)
                probe.close()
                # The next launch is on the same engine folder, and waits for this one's
                # engine to let go of it: that wait is the last launch's, not the next's.
                until = time.perf_counter() + 20
                while time.perf_counter() < until and pids & parents().keys():
                    time.sleep(0.2)
                time.sleep(1)
                processes = len(pids)
                line = traced(args.identifier)
                if line:
                    runs[agents].append({"steps": {one["step"]: one["at"] for one in line["steps"]}, "processes": processes})
    finally:
        shutil.rmtree(spaces, ignore_errors=True)

    wrong: list[str] = []
    if not runs[False] or not runs[True]:
        print("no trace was written; is this a build with NIB_TRACE_STARTUP?")
        return 1
    steps = {False: set(), True: set()}
    for agents, lines in runs.items():
        for one in lines:
            steps[agents] |= set(one["steps"])
    extra = sorted(steps[True] - steps[False])
    if extra:
        wrong.append(f"steps only with an agent set up: {extra}")
    # The fastest of each, beside the median: on a machine doing other work nothing makes a
    # launch faster than it is, so the fastest is the launch's own cost and the median is
    # that plus whatever else was running.
    print(f"{'step':44} {'no agent, fastest / median':>28} {'an agent, fastest / median':>28}")
    common = sorted(steps[False] & steps[True], key=lambda one: min(r["steps"].get(one, 0) for r in runs[False]))
    for step in common:
        cells = []
        for agents in (False, True):
            times = [r["steps"][step] for r in runs[agents] if step in r["steps"]]
            cells.append(f"{min(times):>8.0f} / {statistics.median(times):>6.0f} ms")
        print(f"{step[:44]:44} {cells[0]:>28} {cells[1]:>28}")
    last = common[-1] if common else ""
    for agents in (False, True):
        each = ", ".join(f"{r['steps'][last]:.0f}" for r in runs[agents] if last in r["steps"])
        print(f"{'each launch, ' + ('an agent' if agents else 'no agent'):44} {last}: {each} ms")
    processes = {agents: statistics.median(r["processes"] for r in lines) for agents, lines in runs.items()}
    print(f"{'processes under the app':44} {processes[False]:>28.0f} {processes[True]:>28.0f}")
    if processes[True] > processes[False]:
        wrong.append("more processes with an agent set up: a webview or a helper started for nobody")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


def main() -> int:
    parsed = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parsed.add_argument("--exe", type=pathlib.Path)
    parsed.add_argument("--identifier")
    parsed.add_argument("--via", choices=ROADS, default="endpoint")
    parsed.add_argument("--only")
    parsed.add_argument("--skip", action="append")
    parsed.add_argument("--out", type=pathlib.Path)
    parsed.add_argument("--launch-cost", type=int, default=0)
    parsed.add_argument("--list", action="store_true")
    args = parsed.parse_args()
    # A page's words end up in the report, and a pipe on Windows is not UTF-8.
    sys.stdout.reconfigure(errors="backslashreplace")  # type: ignore[union-attr]

    if args.list:
        for name, scenario in scenarios(args.only, args.skip):
            print(f"{name:28} {scenario.get('proves', '')}")
        return 0
    if sys.platform != "win32":
        print("the scenarios drive a Windows build")
        return 0
    if not args.exe or not args.identifier:
        parsed.error("--exe and --identifier name the probe build")
    return launch_cost(args) if args.launch_cost else scenario_run(args)


if __name__ == "__main__":
    raise SystemExit(main())
