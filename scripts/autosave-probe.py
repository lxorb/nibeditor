"""Autosave in the packaged app: nothing typed is lost, and nothing is ever asked.

Windows only, and the one thing no browser drive can answer: whether the words are on
the disk when the process is killed, which is a question about the real process, the
real file system and the real webview.

What it checks, through the app's own automation endpoint:

* **A note typed into, and the process killed** less than a second after the last
  keystroke: the words are in the file.
* **A new tab typed into, and the process killed** the same way: it is a file in the
  space, named after its first line, with the words in it.
* **Ctrl+S** asks nothing and opens nothing: no dialog, no file picker.
* **Closing the window** straight after typing: the app goes without a question, and
  the words are in the file.
* **A new note typed into for a while** is one file, and the same file through every
  save: its file id never changes and nothing is left beside it. A save that put a new
  file under the name is what Proton Drive kept as a "Name clash" copy, once per save.

The spaces are made in a temp folder named by `NIB_SPACES_DIR`, so the run touches
nothing of anybody's; see docs/automation.md. Every launch goes through `run_probe`,
off the screen and without the keyboard; see probe_app.py.

    npx vite build --mode drive                     # in apps/desktop
    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.autosave-only","version":"99.0.0",
                 "build":{"beforeBuildCommand":""},
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/autosave-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.autosave-only

This wipes that identifier's settings folder and webview profile at the start of every
run, and refuses to wipe one whose name does not say `probe`.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from probe_app import close_app, main_window, refuse_updating, run_probe

SPACES_DIR = "NIB_SPACES_DIR"
SPACE = "Autosave probe"

#: How long after the last keystroke the process is killed, in seconds: inside the
#: second the brief allows, with the endpoint's own round trip counted in it.
KILL_AFTER = 0.7

failures: list[str] = []


def say(words: str) -> None:
    print(words, flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    say(f"WRONG: {words}")


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier


def wipe(identifier: str) -> None:
    """Everything the last run left. Refused for anything but a probe."""
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier; refusing to wipe it")

    for path in (config_dir(identifier), local_dir(identifier)):
        shutil.rmtree(path, ignore_errors=True)


def endpoint(identifier: str, seconds: float, unlike: int = 0) -> tuple[int, str]:
    """The port and the secret this launch is listening behind, once it has written them
    down; see src-tauri/src/endpoint.rs."""
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)

    raise SystemExit(f"the app never wrote {path}")


def allow_eval(identifier: str) -> None:
    """`eval` is off until this installation's own file says otherwise."""
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")


def ran(port: int, secret: str, code: str) -> object:
    """One expression in the window, and what it came back as."""
    body = json.dumps({"verb": "eval", "args": {"code": code, "yes": True}, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as answer:
            said = answer.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as refused:
        return f"the app answered {refused.code}"
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return f"no answer: {error}"

    try:
        answer = json.loads(said)
    except ValueError:
        return said
    if isinstance(answer, dict) and "value" in answer:
        return answer["value"]
    return answer


def launch(exe: pathlib.Path, environment: dict[str, str], identifier: str, was: int) -> tuple:
    app = run_probe(exe, env=environment)
    until = time.perf_counter() + 120
    while not main_window(app.pid) and time.perf_counter() < until:
        time.sleep(0.25)
    if not main_window(app.pid):
        raise SystemExit("the window never appeared")

    port, secret = endpoint(identifier, 150, unlike=was)
    # The launch reads the session and the notes behind the first paint.
    time.sleep(3.0)
    if ran(port, secret, "1 + 1") != 2:
        raise SystemExit("the endpoint would not run anything; is eval on?")
    return app, port, secret


# Words typed at the end of the note in front, the way the editor takes a keystroke.
TYPE = """
(async () => {
  const app = window.nibApp
  const view = app.views.of(app.workspace.panes.focusedId)
  if (!view) return 'no editor'
  view.focus()
  view.dispatch({
    changes: { from: view.state.doc.length, insert: %s },
    userEvent: 'input.type',
  })
  return 'typed'
})()
"""

OPEN = """
(async () => {
  const ws = window.nibApp.workspace
  const note = ws.files.find((one) => one.name === %s)
  if (!note) return 'no such note'
  await ws.openEntry(note.path, { activate: true })
  return ws.active?.path ?? null
})()
"""

BLANK = "(() => { window.nibApp.workspace.openBlank(); return true })()"

# The tab in front given its file, the way Save gives a draft one: in the space, under
# the name its first line offers. See src/lib/workspace/drafts.ts.
PLACE = """
(async () => {
  const ws = window.nibApp.workspace
  return await ws.save(ws.tabs.find((one) => one.id === ws.activeTabId) ?? ws.active)
})()
"""

# Ctrl+S as the window hears it, and whether anything is asked afterwards.
CTRL_S = """
(() => {
  const event = new KeyboardEvent('keydown', {
    key: 's', code: 'KeyS', ctrlKey: true, bubbles: true, cancelable: true,
  })
  window.dispatchEvent(event)
  return event.defaultPrevented
})()
"""

ASKED = "(() => document.querySelectorAll('[role=\"dialog\"]').length)()"


#: How long a burst of typing is left before the next, in seconds: past the autosave's
#: quiet (SAVE_DELAY in src/lib/backoff.ts), so every burst is a save of its own.
BETWEEN_SAVES = 1.5


def identity(path: pathlib.Path) -> tuple[int, int]:
    """The volume and the file id, which NTFS gives a new file and keeps for an old one."""
    stat = path.stat()
    return stat.st_dev, stat.st_ino


def kill(app: subprocess.Popen[bytes]) -> None:
    """The process ended the way a crash or a power cut ends it: nothing runs after."""
    app.kill()
    app.wait(timeout=15)


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.autosave-only")
    args = parsed.parse_args()

    exe = pathlib.Path(args.exe).resolve()
    if not exe.exists():
        raise SystemExit(f"no such exe: {exe}")

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-autosave-"))
    space = spaces / SPACE
    space.mkdir(parents=True, exist_ok=True)
    (space / "Plan.md").write_text("# Plan\n\nWords.\n", encoding="utf-8")
    plan = identity(space / "Plan.md")
    say(f"spaces root {spaces}")

    refuse_updating(exe)
    wipe(args.identifier)
    environment = {**os.environ, SPACES_DIR: str(spaces)}

    # Twice, because `eval` is read once when the endpoint starts listening: the first
    # launch writes the file this turns it on in. See src-tauri/src/endpoint.rs.
    first = run_probe(exe, env=environment)
    was, _ = endpoint(args.identifier, 150)
    allow_eval(args.identifier)
    first.terminate()
    try:
        first.wait(timeout=15)
    except subprocess.TimeoutExpired:
        first.kill()
    time.sleep(6.0)

    try:
        say("--- a note typed into, and the process killed ---")
        app, port, secret = launch(exe, environment, args.identifier, was)
        say(f"opened                 -> {ran(port, secret, OPEN % json.dumps('Plan.md'))}")
        time.sleep(1.0)
        ran(port, secret, TYPE % json.dumps("\nA sentence typed just before the crash."))
        time.sleep(KILL_AFTER)
        kill(app)
        text = (space / "Plan.md").read_text(encoding="utf-8")
        if "A sentence typed just before the crash." not in text:
            wrong(f"the words typed {KILL_AFTER} s before the kill are not in the file: {text!r}")
        else:
            say(f"killed {KILL_AFTER} s after typing -> the words are in Plan.md")
        time.sleep(6.0)

        say("--- a new tab typed into, and the process killed ---")
        app, port, secret = launch(exe, environment, args.identifier, port)
        ran(port, secret, BLANK)
        time.sleep(1.0)
        ran(port, secret, TYPE % json.dumps("Killed straight after"))
        time.sleep(KILL_AFTER)
        kill(app)
        made = space / "Killed straight after.md"
        if not made.exists():
            wrong(f"the new tab is no file in the space: {sorted(one.name for one in space.iterdir())}")
        elif made.read_text(encoding="utf-8") != "Killed straight after":
            wrong(f"the new note does not say what was typed: {made.read_text(encoding='utf-8')!r}")
        else:
            say(f"killed {KILL_AFTER} s after typing -> {made.name}, with the words")
        time.sleep(6.0)

        say("--- Ctrl+S, and the window closed straight after typing ---")
        app, port, secret = launch(exe, environment, args.identifier, port)
        ran(port, secret, OPEN % json.dumps("Plan.md"))
        time.sleep(1.0)
        ran(port, secret, TYPE % json.dumps("\nPressed out of habit."))
        taken = ran(port, secret, CTRL_S)
        time.sleep(0.5)
        if taken is not True:
            wrong(f"Ctrl+S was left to the browser: {taken!r}")
        if ran(port, secret, ASKED) != 0:
            wrong("Ctrl+S put something up")
        else:
            say("Control+S              -> nothing asked, nothing opened")
        if "Pressed out of habit." not in (space / "Plan.md").read_text(encoding="utf-8"):
            wrong("Ctrl+S did not write the note")
        else:
            say("Control+S              -> the note is written")

        ran(port, secret, TYPE % json.dumps("\nThe last line before the window closed."))
        if not close_app(app, 15):
            wrong("the window did not go when it was closed: something asked, or it hung")
            kill(app)
        else:
            say("closed                 -> the app went, asking nothing")
        if "The last line before the window closed." not in (space / "Plan.md").read_text(
            encoding="utf-8"
        ):
            wrong("the line typed as the window closed is not in the file")
        else:
            say("closed                 -> the last line is in Plan.md")
        time.sleep(6.0)

        say("--- a new note typed into for a while: one file, the same file ---")
        app, port, secret = launch(exe, environment, args.identifier, port)
        ran(port, secret, BLANK)
        time.sleep(1.0)
        ran(port, secret, TYPE % json.dumps("Hackathon List"))
        say(f"saved                  -> {ran(port, secret, PLACE)}")
        time.sleep(BETWEEN_SAVES)
        note = space / "Hackathon List.md"
        if not note.exists():
            wrong(f"the new note is no file: {sorted(one.name for one in space.iterdir())}")
        else:
            born = identity(note)
            for save in range(6):
                ran(port, secret, TYPE % json.dumps(f"\n- idea {save}"))
                time.sleep(BETWEEN_SAVES)
                if identity(note) != born:
                    wrong(f"save {save + 2} made a new file under the name")
                    break
            beside = sorted(
                one.name
                for one in space.iterdir()
                if one.name.endswith(".tmp") or one.name.startswith("Hackathon List")
            )
            if beside != ["Hackathon List.md"]:
                wrong(f"more than the one note is there: {beside}")
            elif "- idea 5" not in note.read_text(encoding="utf-8"):
                wrong("the last save is not in the note")
            else:
                say("7 saves                -> one file, the same file id, nothing beside it")
        if not close_app(app, 15):
            kill(app)

        # Plan.md was typed into by three launches, one of them killed mid-save.
        if identity(space / "Plan.md") != plan:
            wrong("Plan.md is no longer the file it started as")
        else:
            say("Plan.md                -> the same file through every save")
    finally:
        shutil.rmtree(spaces, ignore_errors=True)

    if failures:
        print(f"\n{len(failures)} thing(s) wrong:")
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nall good")
    return 0


if __name__ == "__main__":
    sys.exit(main())
