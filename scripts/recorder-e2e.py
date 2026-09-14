"""The recorder in the real app, which is the one place it was broken.

The bug: `getUserMedia` in the window's own page never settled. A `WebView2` webview
with nothing listening for `PermissionRequested` answers such a request with neither an
allow nor a deny, and every web tab had that listener while the window's own page had
none. So the pill sat at 0:00, no file was written, and nothing was said. Every unit test
passed, because there is no `WebView2` under node.

So this is driven against a built app and nothing else:

    python scripts/recorder-e2e.py --app "<path to the probe .exe>"

What it proves:

    a microphone opens at all - the pill appears and its clock moves
    a file lands in the space, beside the note, and is a sound file with sound in it
    the note says so, as an embed a player can read
    and the promise is bounded either way: nothing here waits for ever

`NIB_SPACES_DIR` points inside `target/`, so the note and the recording are written
nowhere near anybody's own notes - and the space is read off the disk afterwards, which
is the real proof that a file was written.

Chrome's fake microphone is not available to a Tauri build, so this wants a real input:
with no microphone at all the app is right to refuse, and the drive says which of the two
it saw rather than passing on silence.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import secrets
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
WORK = ROOT / "target" / "recorder-e2e"
SPACES = WORK / "spaces"
SHOTS = WORK / "shots"

failures: list[str] = []


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def wrong(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)


def identifier_of(app: pathlib.Path) -> str:
    found = json.loads((app.parent / "nib-probe-identifier.json").read_text(encoding="utf-8"))
    return str(found["identifier"])


def endpoint_of(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier / "automation.json"


def allow_eval(path: pathlib.Path) -> None:
    """`eval` turned on in the endpoint file, which is the only way it can be."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"port": 0, "secret": secrets.token_hex(32), "eval": True}),
        encoding="utf-8",
    )


def started(app: pathlib.Path) -> subprocess.Popen[bytes]:
    SPACES.mkdir(parents=True, exist_ok=True)
    return subprocess.Popen(
        [str(app)],
        env={**os.environ, "NIB_SPACES_DIR": str(SPACES)},
        cwd=str(app.parent),
    )


def waited_for(path: pathlib.Path, patience: float = 90) -> dict:
    until = time.monotonic() + patience
    while time.monotonic() < until:
        try:
            held = json.loads(path.read_text(encoding="utf-8"))
            if held.get("port") and held.get("secret"):
                return held
        except (OSError, ValueError):
            pass
        time.sleep(0.4)

    raise SystemExit(f"no endpoint at {path} after {patience:.0f}s")


def asked(held: dict, verb: str, args: dict) -> dict:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{held['port']}/",
        data=body,
        headers={"authorization": f"Bearer {held['secret']}", "content-type": "application/json"},
    )

    with urllib.request.urlopen(request, timeout=60) as answer:
        return json.loads(answer.read().decode())


def ran(held: dict, code: str) -> object:
    answer = asked(held, "eval", {"code": code, "yes": True})
    if not answer.get("ok"):
        wrong(f"the window would not run {code!r}: {answer.get('error')}")
        return None

    return answer.get("value")


def shot(pid: int, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            shutil.which("powershell") or "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(HERE / "capture-window.ps1"),
            "-ProcessId",
            str(pid),
            "-Out",
            str(SHOTS / f"{name}.png"),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    say(f"photographed {name}.png")


# Whether the machine has an input at all, asked of the page rather than assumed: the
# whole bug was a promise that never settled while `enumerateDevices` listed a
# microphone, so the two questions are asked separately here as well.
HAS_INPUT = """
navigator.mediaDevices.enumerateDevices().then((all) => all.filter((one) => one.kind === 'audioinput').length)
"""

# The microphone opened directly, with a clock on it. This is the call that used to hang:
# it answers how long it took and what happened, and never waits longer than the
# recorder itself would.
OPENS = """
(async () => {
  const began = Date.now()
  try {
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio: true }),
      new Promise((_ok, no) => setTimeout(() => no(new Error('never answered')), 25000)),
    ])
    const tracks = stream.getAudioTracks().map((one) => one.label || 'an input')
    for (const track of stream.getTracks()) track.stop()
    return { ms: Date.now() - began, tracks }
  } catch (error) {
    return { ms: Date.now() - began, refused: String(error && error.message ? error.message : error) }
  }
})()
"""


def drive(app: pathlib.Path) -> None:
    identifier = identifier_of(app)
    endpoint = endpoint_of(identifier)
    allow_eval(endpoint)

    process = started(app)
    try:
        held = waited_for(endpoint)
        say(f"{identifier} is up on port {held['port']}, pid {held.get('pid')}")
        time.sleep(4.0)

        inputs = ran(held, HAS_INPUT)
        say(f"the machine lists {inputs} audio input(s)")

        # ── the call that used to hang ─────────────────────────────────────
        opened = ran(held, OPENS)
        if not isinstance(opened, dict):
            wrong(f"the window said nothing about the microphone: {opened!r}")
            return

        if "refused" in opened:
            if inputs:
                wrong(f"a machine with {inputs} input(s) refused: {opened}")
            else:
                say(f"no microphone on this machine, and it said so in {opened['ms']}ms: {opened}")
                say("which is the honest answer; the bug was saying nothing at all")
            # Either way the promise settled, which is the half of this that is about
            # the crate. A machine with no input cannot record, so there is no file to
            # look for.
            if opened["ms"] > 24000:
                wrong(f"the microphone request never settled: {opened}")
            shot(process.pid, "01-no-microphone")
            return

        say(f"the microphone opened in {opened['ms']}ms: {opened['tracks']}")
        if opened["ms"] > 20000:
            wrong(f"opening the microphone took {opened['ms']}ms, which is a reader waiting")

        # ── and the recorder around it ─────────────────────────────────────
        note = ran(held, "nib.workspace.createNote().then(() => nib.workspace.active?.path ?? null)")
        say(f"recording into {note!r}")

        # The same row the palette shows, pressed by its own id. `byHand` keeps it out of
        # a *link's* reach and not out of the command line's, which is the road a drive
        # is on; see `runCommand` in automation/acts.ts.
        answer = asked(held, "commands.run", {"id": "record"})
        if not answer.get("ok"):
            wrong(f"the Record command would not run: {answer}")
            return
        say(f"Record pressed: {answer.get('value')}")

        time.sleep(4.0)
        pill = ran(
            held,
            "(() => { const one = document.querySelector('.recording'); return one ? one.textContent.trim() : null })()",
        )
        say(f"the pill says {pill!r}")
        if not pill:
            wrong("nothing is recording: there is no pill on the page")
        elif "0:00" in str(pill):
            wrong(f"the clock never moved: {pill!r}")

        shot(process.pid, "02-recording")

        answer = asked(held, "commands.run", {"id": "record"})
        if not answer.get("ok"):
            wrong(f"the Record command would not stop it: {answer}")
        time.sleep(4.0)

        text = ran(held, "nib.workspace.active?.doc ?? ''")
        say(f"the note now says {str(text)[:120]!r}")
        if "![[recording-" not in str(text):
            wrong("the note holds no embed, so nothing was written")

        shot(process.pid, "03-written")

        # The file itself, read off the disk rather than off the app's opinion of it.
        sounds = sorted(SPACES.rglob("recording-*.*"))
        if not sounds:
            wrong(f"no recording was written under {SPACES}")
        else:
            for one in sounds:
                size = one.stat().st_size
                say(f"{one.relative_to(SPACES)} is {size} bytes")
                if size < 2000:
                    wrong(f"{one.name} is {size} bytes, which is a header and no sound")
                if one.suffix not in {".weba", ".m4a"}:
                    wrong(f"{one.name} is not a sound file")

    finally:
        process.terminate()
        time.sleep(1.5)


def main() -> int:
    if sys.platform != "win32":
        print("this drive is about the WebView2 permission request", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True, type=pathlib.Path)
    said = parser.parse_args()

    shutil.rmtree(WORK, ignore_errors=True)
    drive(said.app.resolve())

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nthe microphone answers in the app, and what it heard is a file in the space")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
