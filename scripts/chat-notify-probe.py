"""A chat's notification as Windows holds it: the crate's toast is raised under the app's
own id, with the words, the chat's tag, nib's group and the field to answer in; a second
one for the same chat replaces the first; the page takes it back; and nothing of it is
left once the app has gone (docs/chats.md 4.11, src-tauri/src/notices.rs).

Windows only. The page is asked through its own bridge, over the DevTools protocol
(`Runtime.evaluate`, never a key or a click; see scripts/devtools.py), the way the chats'
notifications ask it, and the action centre is read back the way any program on the
machine can read it, through Windows PowerShell's WinRT.

**It never pops up on anybody's screen.** The app is a probe with an identifier of its
own (never `ch.emilvinu.nib`), and a probe shows a notice only when started with
`NIB_PROBE_NOTICES`, which only this script sets, and then straight into the action centre
with no banner (`SuppressPopup`). On the way out - pass, fail or crash - every toast of
that id is taken off and the id's registration removed, and the run fails if one is left.
A press cannot be made from outside the process that showed the toast, so what a press and
a reply do is the page's tests' (src/lib/notify.test.ts, src/lib/chats/notify.test.ts).
Where the person at the machine turned Windows' notifications off, Windows holds no toast
at all: the bridge is still asked and must answer, and the action centre's half is
skipped and said so.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.chats-notify","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/chat-notify-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe
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

from devtools import Session, debugged, port, targets
from probe_app import close_app, refuse_updating, run_probe

IDENTIFIER = "ch.emilvinu.nib.probe.chats-notify"
GROUP = "nib.notices"
CHAT = "c_3f9a0c1e5b7d4f2a8c6e0b1d3f5a7c9e"

#: How long the app has to come up and open its page's debugging port.
PATIENCE = 90.0


def say(words: str) -> None:
    print(words, flush=True)


#: The id's toasts in the action centre, one per line, or with `-Remove` every one of
#: them taken off. Windows PowerShell 5.1 projects WinRT.
HISTORY_PS1 = r"""
param([string]$Id, [switch]$Remove)
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$history = [Windows.UI.Notifications.ToastNotificationManager]::History
if ($Remove) { $history.Clear($Id); exit 0 }
'SETTING|' + [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Id).Setting
foreach ($t in $history.GetHistory($Id)) {
  'TOAST|' + $t.Group + '|' + $t.Tag + '|' + $t.SuppressPopup + '|' + $t.Content.GetXml()
}
"""


def history_script() -> pathlib.Path:
    path = pathlib.Path(tempfile.gettempdir()) / "nib-chat-notify-probe-history.ps1"
    path.write_text(HISTORY_PS1, encoding="utf-8")
    return path


def history(remove: bool = False) -> list[list[str]]:
    """The probe id's toasts in the action centre, each as group, tag, whether it was
    shown without a banner, and its XML; or every one of them taken off. Raises where
    PowerShell could not answer, so a failure to look is never read as nothing left."""
    done = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(history_script()),
            "-Id",
            IDENTIFIER,
            *(["-Remove"] if remove else []),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    if done.returncode != 0:
        raise RuntimeError(f"the action centre could not be read: {done.stderr.strip()}")
    return [
        line[len("TOAST|") :].split("|", 3)
        for line in done.stdout.splitlines()
        if line.startswith("TOAST|")
    ]


def register_id() -> None:
    import winreg

    key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\AppUserModelId\{IDENTIFIER}")
    winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, "nibeditor probe")
    winreg.CloseKey(key)


def unregister_id() -> None:
    import winreg

    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\AppUserModelId\{IDENTIFIER}")
    except FileNotFoundError:
        pass


def wipe_profile() -> None:
    for base in (os.environ.get("APPDATA"), os.environ.get("LOCALAPPDATA")):
        if base:
            shutil.rmtree(pathlib.Path(base) / IDENTIFIER, ignore_errors=True)


def the_page() -> Session:
    """The app's own page, once its browser has opened a debugging port."""
    profile = pathlib.Path(os.environ["LOCALAPPDATA"]) / IDENTIFIER
    deadline = time.monotonic() + PATIENCE
    while time.monotonic() < deadline:
        found = port(profile) if profile.exists() else 0
        if found:
            pages = [one for one in targets(found) if one.get("type") == "page"]
            if pages:
                page = Session(pages[0])
                if page.value("typeof window.__TAURI_INTERNALS__?.invoke") == "function":
                    return page
                page.close()
        time.sleep(1.0)
    raise RuntimeError("the app's page never opened a debugging port")


def ask(page: Session, command: str, args: dict) -> object:
    """A command through the page's own bridge, as the page asks it."""
    expression = (
        f"window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args)})"
        ".then(() => 'ok', (error) => 'refused: ' + String(error))"
    )
    said = page.call(
        "Runtime.evaluate", {"expression": expression, "awaitPromise": True, "returnByValue": True}
    )
    return said.get("result", {}).get("value", said)


def notice(words: str) -> dict:
    return {
        "notice": {
            "id": os.urandom(8).hex(),
            "tag": CHAT,
            "title": "Lucile",
            "body": words,
            "from": "#thesis",
            "silent": True,
            "reply": {"placeholder": "Reply", "send": "Send"},
        }
    }


def setting() -> str:
    """Whether Windows holds this id's toasts at all: `Enabled`, or why not. Somebody who
    turned notifications off for every app (`DisabledForUser`) has a machine on which no
    toast is ever held, and that is theirs to choose, never a probe's to change."""
    done = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(history_script()),
            "-Id",
            IDENTIFIER,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    for line in done.stdout.splitlines():
        if line.startswith("SETTING|"):
            return line[len("SETTING|") :]
    return "unknown"


def ours() -> list[list[str]]:
    return [one for one in history() if one[0] == GROUP]


def settled(wanted: int) -> list[list[str]]:
    """The action centre once it holds `wanted` of ours, or after ten seconds."""
    deadline = time.monotonic() + 10
    found = ours()
    while len(found) != wanted and time.monotonic() < deadline:
        time.sleep(0.5)
        found = ours()
    return found


def held_checks(page: Session, app, failures: list[str]) -> None:
    """What the action centre says: one toast per chat, as the crate wrote it, taken
    back by the page and gone with the app."""
    found = settled(1)
    if len(found) != 1:
        failures.append(f"{len(found)} toasts of ours in the action centre, not one")
    else:
        group, tag, quiet, xml = found[0]
        say(f"raised: group {group}, tag {tag}, without a banner: {quiet}")
        if tag != CHAT:
            failures.append(f"the tag is not the chat's: {tag!r}")
        if quiet != "True":
            failures.append("a probe's toast was not kept off the screen")
        for wanted in (
            "<text>Lucile</text>",
            "<text>The figures are in</text>",
            'placement="attribution"',
            '<input id="reply" type="text"',
            'activationType="foreground"',
            '<audio silent="true"/>',
        ):
            if wanted not in xml:
                failures.append(f"the toast does not say {wanted}")

    ask(page, "notice_show", notice("Page 4 too"))
    found = settled(1)
    if len(found) != 1 or "Page 4 too" not in found[0][3]:
        failures.append("a second notice for the chat did not replace the first")
    else:
        say("replaced: one toast, the newer words")

    ask(page, "notice_clear", {"tag": CHAT})
    if settled(0):
        failures.append("the chat's notice was not taken back")
    else:
        say("taken back: none left for the chat")

    ask(page, "notice_show", notice("Left behind?"))
    if len(settled(1)) != 1:
        failures.append("the last notice was not raised")
    page.close()
    if not close_app(app):
        failures.append("the probe did not close")
    if settled(0):
        failures.append("a notice was left in the action centre after the app went")
    else:
        say("gone with the app: none left")


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")
    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    args = parsed.parse_args()
    exe = pathlib.Path(args.exe).resolve()
    refuse_updating(exe)

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-chat-notify-spaces-"))
    failures: list[str] = []
    app = None
    page = None
    try:
        history(remove=True)
        wipe_profile()
        register_id()
        held = setting()
        environment = debugged({**os.environ, "NIB_SPACES_DIR": str(spaces), "NIB_PROBE_NOTICES": "1"})
        app = run_probe(exe, env=environment)
        page = the_page()

        # Asked the way the page asks: the toast's XML is read and the toast made by
        # Windows before this answers, so a toast it would refuse is a refusal here.
        said = ask(page, "notice_show", notice("The figures are in"))
        if said != "ok":
            failures.append(f"the notice was not shown: {said}")
        bad = {"notice": {**notice("x")["notice"], "tag": "a b"}}
        if ask(page, "notice_show", bad) == "ok":
            failures.append("a tag that is not plain characters was taken")
        said = ask(page, "notice_clear", {"tag": CHAT})
        if said != "ok":
            failures.append(f"the notice could not be taken back: {said}")

        if held == "Enabled":
            held_checks(page, app, failures)
            page = None
        else:
            say(f"SKIP the action centre: Windows holds no toast for this user ({held})")
    finally:
        if page is not None:
            page.close()
        if app is not None and app.poll() is None:
            if not close_app(app):
                app.kill()
        try:
            history(remove=True)
            left = ours()
        except RuntimeError as error:
            left = [[str(error)]]
        unregister_id()
        if left:
            failures.append(f"toasts may be left in the action centre: {left}")
        shutil.rmtree(spaces, ignore_errors=True)

    for one in failures:
        say(f"WRONG: {one}")
    say("PASS" if not failures else "FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
