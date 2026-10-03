"""A terminal on another machine in the packaged app, against a stand-in `ssh`.

Windows only, and never a real machine: there is no `sshd` here to reach, and a reader's
own hosts are theirs. `NIB_SSH` points the crate at `scripts/fake-ssh.py` (through a
one-line `.cmd`) and `NIB_SSH_CONFIG` at a config written here, so what is checked is
everything on nib's side of `ssh`:

* the crate reads the config's hosts - a pattern and a `Match` left out, an `Include`
  followed, a heading's group - and refuses a host made in nib whose address could be
  read as an option;
* a remote terminal put back as a restart puts one back **waits** for Reconnect, and the
  bar's button starts `ssh` with `-F <config> -- <host>`;
* the tab is called by the host's name and wears the server;
* keystrokes reach `ssh`, and a connection that **drops** (255) leaves the tab and puts
  the Reconnect bar up, which connects again;
* `exit` (0) closes the tab, as a shell's own `exit` does.

    python scripts/remote-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says; `run_probe` starts it off the screen and
without the keyboard, and nothing here moves it or presses a real key.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import time

from probe_app import close_app, main_window, run_probe

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
SPACE = "Remote probe"

failures: list[str] = []


def borrowed(name: str, file: str):
    """Another drive's helpers, read from its file: the names have dashes in them."""

    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tabs = borrowed("tabs", "new-tabs-probe.py")
terminal = borrowed("terminal", "terminal-probe.py")
until = terminal.until


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    if ok:
        say(f"ok   {words}")
    else:
        failures.append(words)
        say(f"FAIL {words}")


CONFIG = """# A config of the probe's own; never the reader's.
Host *
  ServerAliveInterval 30

## Probe ##
Host fakepi pi-again
  HostName 127.0.0.1
  User probe

Match host fakepi
  User wrong

Include extra.d/*
"""


def starts(log: pathlib.Path) -> list[list[str]]:
    """Every start of the stand-in, with its arguments."""

    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines() if line]


def shown(window, tab: str) -> str:
    said = window.run(
        f"(() => {{ const label = document.querySelector('.pick[data-tab={json.dumps(tab)}] .label'); "
        "return label ? label.textContent : null })()"
    )
    return said if isinstance(said, str) else ""


def mark(window, tab: str) -> str:
    said = window.run(
        f"(() => {{ const one = document.querySelector('.pick[data-tab={json.dumps(tab)}] [data-mark]'); "
        "return one ? one.dataset.mark : null })()"
    )
    return said if isinstance(said, str) else ""


def bar(window) -> bool:
    return window.run("!!document.querySelector('.terminal .offline button')") is True


def reconnect(window) -> None:
    window.run("(() => { document.querySelector('.terminal .offline button').click(); return true })()")


def refused(window, command: str, args: dict[str, object]) -> bool:
    said = window.run(
        f"window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args)})"
        ".then(() => 'taken', () => 'refused')"
    )
    return said == "refused"


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.remote-ssh")
    parsed.add_argument("--shots", default=str(ROOT / "apps/desktop/test/e2e/shots/remote-probe"))
    args = parsed.parse_args()

    exe = pathlib.Path(args.exe).resolve()
    shots = pathlib.Path(args.shots)
    shots.mkdir(parents=True, exist_ok=True)

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-remote-"))
    folder = spaces / SPACE
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "A note.md").write_text("# A note\n", encoding="utf-8")

    own = pathlib.Path(tempfile.mkdtemp(prefix="nib-remote-ssh-"))
    config = own / "config"
    # Relative includes are read against `~/.ssh`, which is the reader's; this one is
    # absolute, so nothing of theirs is read.
    config.write_text(CONFIG.replace("extra.d/*", str(own / "extra.d" / "*")), encoding="utf-8")
    (own / "extra.d").mkdir()
    (own / "extra.d" / "lab").write_text("Host labbox\n  HostName 127.0.0.2\n", encoding="utf-8")
    log = own / "starts.jsonl"
    shim = own / "fake-ssh.cmd"
    shim.write_text(f'@"{sys.executable}" "{HERE / "fake-ssh.py"}" %*\r\n', encoding="utf-8")
    say(f"spaces root {spaces}, ssh stand-in {shim}")

    tabs.wipe(args.identifier)
    environment = {
        **os.environ,
        "NIB_SPACES_DIR": str(spaces),
        "NIB_SSH": str(shim),
        "NIB_SSH_CONFIG": str(config),
        "FAKE_SSH_LOG": str(log),
    }

    first = run_probe(exe, env=environment)
    was, _ = tabs.endpoint(args.identifier, 150)
    tabs.allow_eval(args.identifier)
    first.terminate()
    first.wait(timeout=15)
    time.sleep(6.0)

    app = run_probe(exe, env=environment)
    try:
        if not until(lambda: main_window(app.pid), 120, 0.25):
            raise SystemExit("the window never appeared")
        port, secret = tabs.endpoint(args.identifier, 150, unlike=was)
        window = terminal.Window(port, secret)
        until(lambda: window.run("1 + 1") == 2, 30)

        # -- What the crate reads --------------------------------------------------
        hosts = window.invoke("remote_hosts", {})
        listed = hosts.get("config", []) if isinstance(hosts, dict) else []
        ids = [one.get("id") for one in listed]
        check(ids == ["fakepi", "labbox"], f"the config's hosts, no pattern, no Match: {ids}")
        pi = next((one for one in listed if one.get("id") == "fakepi"), {})
        check(pi.get("also") == ["pi-again"], f"other names on its line: {pi.get('also')}")
        check(pi.get("user") == "probe", f"the first User wins, not the Match's: {pi.get('user')}")
        check(pi.get("group") == "Probe", f"the heading is its group: {pi.get('group')}")
        lab = next((one for one in listed if one.get("id") == "labbox"), {})
        check(lab.get("group") == "lab", f"an included file's name is its group: {lab.get('group')}")

        bad = {"own": [{"id": "n-bad", "name": "Bad", "hostname": "-oProxyCommand=calc"}]}
        check(refused(window, "remote_keep", {"kept": bad}), "an address that reads as an option is refused")

        # -- Put back by a restart: it waits --------------------------------------
        tab = window.open("ssh:fakepi", "fakepi", "remote-probe")
        say(f"remote tab {tab}")
        waiting = until(lambda: bar(window), 15)
        check(bool(waiting), "a remote tab put back waits behind Reconnect")
        time.sleep(1.0)
        check(starts(log) == [], f"and has not started ssh: {starts(log)}")
        check(bool(until(lambda: shown(window, tab) == "fakepi", 10)), f"called by its host: {shown(window, tab)!r}")
        check(mark(window, tab) == "ssh", f"wearing the server ({mark(window, tab)})")
        tabs.shoot(app.pid, shots / "remote-waiting.png")

        reconnect(window)
        connected = until(lambda: any("connected to fakepi" in row for row in window.rows()), 20)
        check(bool(connected), "Reconnect starts ssh, and what it says is drawn")
        first_start = starts(log)[0] if starts(log) else []
        check(
            first_start == ["-F", str(config), "--", "fakepi"],
            f"with the config and the host after --: {first_start}",
        )
        check(bool(until(lambda: not bar(window), 5)), "and the bar goes")

        window.typed("hello\r")
        check(bool(until(lambda: any("you said: hello" in row for row in window.rows()), 10)), "keystrokes reach it")
        tabs.shoot(app.pid, shots / "remote-connected.png")

        # -- Dropped -------------------------------------------------------------
        window.typed("drop\r")
        check(bool(until(lambda: bar(window), 10)), "a dropped connection puts the bar up")
        check(tab in window.open_tabs(), "and keeps the tab")
        tabs.shoot(app.pid, shots / "remote-dropped.png")
        time.sleep(2.0)
        check(len(starts(log)) == 1, f"never connecting again by itself: {len(starts(log))} starts")

        window.typed("\r")
        check(bool(until(lambda: len(starts(log)) == 2, 15)), "Enter connects again")
        check(bool(until(lambda: not bar(window), 5)), "and the bar goes")

        # -- exit ----------------------------------------------------------------
        until(lambda: window.rows() and window.rows()[-1].strip().endswith("$"), 10)
        window.typed("exit\r")
        check(bool(until(lambda: tab not in window.open_tabs(), 15)), "exit closes the tab")

        # -- Ctrl+T, S, a digit -------------------------------------------------------
        # The chord pressed and let go where the window reads it, then S on the dialog:
        # the host picker, numbered, with the config's hosts in it.
        window.run(
            "(() => { const at = document.activeElement || document.body; "
            "for (const [type, key, ctrl] of [['keydown', 'Control', true], ['keydown', 't', true], ['keyup', 't', true]]) "
            "at.dispatchEvent(new KeyboardEvent(type, { key, code: key === 't' ? 'KeyT' : 'ControlLeft', ctrlKey: ctrl, bubbles: true, cancelable: true })); "
            "return true })()"
        )
        sheet = until(lambda: window.run("!!document.querySelector('.nib-screen [data-more], .nib-screen .kind')") is True, 10)
        check(bool(sheet), "Ctrl+T puts the kinds up")
        window.run(
            "(() => { const box = document.querySelector('.nib-screen'); "
            "(document.activeElement || box).dispatchEvent(new KeyboardEvent('keydown', { key: 's', code: 'KeyS', bubbles: true, cancelable: true })); "
            "window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', code: 'ControlLeft', bubbles: true })); return true })()"
        )
        rows = lambda: window.run(
            "JSON.stringify([...document.querySelectorAll('.picker .nib-row .nib-row-label')].map((one) => one.textContent))"
        )
        picked = until(lambda: isinstance(rows(), str) and "fakepi" in rows(), 10)
        check(bool(picked), f"and S the host picker: {rows()}")
        tabs.shoot(app.pid, shots / "remote-picker.png")
        before = len(starts(log))
        window.run(
            "(() => { const at = document.activeElement || document.querySelector('.picker'); "
            "at.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true, cancelable: true })); return true })()"
        )
        check(bool(until(lambda: len(starts(log)) == before + 1, 15)), "a digit connects at once, with no Reconnect to press")
        tabs.shoot(app.pid, shots / "remote-from-picker.png")
    finally:
        if app.poll() is None and not close_app(app):
            app.kill()

    print()
    if failures:
        print(f"{len(failures)} failed:")
        for one in failures:
            print(f"  - {one}")
        return 1

    print("every check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
