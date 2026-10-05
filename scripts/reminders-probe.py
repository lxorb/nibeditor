"""A reminder handed to Windows' own schedule: the toast is registered, under the app's id,
to ring with nib not running (docs/tasks.md 5.10 and 7.3).

Windows only. What it proves, end to end through the packaged app: a space with a task
that asks to be reminded is read, the reminders store plans it and hands the plan to the
crate, and the crate puts a toast on `ToastNotifier`'s schedule under the probe's own app
id, tagged with the reminder's id and in nib's group - which is read back here the way
any program on the machine can read it, through Windows PowerShell's WinRT.

**It never rings on anybody's screen.** The reminder is twenty minutes out, the app is a
probe with an identifier of its own (never `ch.emilvinu.nib`), and on the way out - pass,
fail or crash - every toast on that id's schedule is taken off and the id's registration
removed, and the run fails if one is left. A probe schedules nothing at all unless it is
started with `NIB_PROBE_REMINDERS`, which only this script sets; see reminders.rs.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.reminders","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/reminders-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe

The app id is registered for the run the way an installer's Start menu shortcut
registers the installed app's (`HKCU\\Software\\Classes\\AppUserModelId\\<id>`), which is
what Windows asks of an unpackaged app before it shows its toasts.
"""

from __future__ import annotations

import argparse
import datetime
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

from probe_app import close_app, refuse_updating, run_probe

IDENTIFIER = "ch.emilvinu.nib.probe.reminders"
GROUP = "nib.reminders"
SPACE = "Reminders probe"

#: How far out the reminder is: far enough that no run of this script lasts that long,
#: near enough that a toast left behind by a crash would be noticed, not lost.
OUT_MINUTES = 20

#: How long the app has to read the space, plan and hand it over.
PATIENCE = 90.0


def say(words: str) -> None:
    print(words, flush=True)


#: Windows PowerShell 5.1 projects WinRT, where `CreateToastNotifierWithId` is the
#: `CreateToastNotifier` overload that takes the id. Lists the id's scheduled toasts one
#: per line, or with `-Remove` takes every one off.
SCHEDULE_PS1 = r"""
param([string]$Id, [switch]$Remove)
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$n = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Id)
foreach ($t in $n.GetScheduledToastNotifications()) {
  if ($Remove) { $n.RemoveFromSchedule($t) }
  else { 'TOAST|' + $t.Group + '|' + $t.Tag + '|' + $t.DeliveryTime.ToUniversalTime().ToString('o') }
}
"""


def schedule_script() -> pathlib.Path:
    path = pathlib.Path(tempfile.gettempdir()) / "nib-reminders-probe-schedule.ps1"
    path.write_text(SCHEDULE_PS1, encoding="utf-8")
    return path


def schedule(remove: bool = False) -> list[str]:
    """The probe id's scheduled toasts, as `group|tag|delivery in UTC`; or every one of
    them taken off. Raises where PowerShell could not answer, so a failure to look is
    never read as nothing left."""
    done = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(schedule_script()),
            "-Id",
            IDENTIFIER,
            *(["-Remove"] if remove else []),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if done.returncode != 0:
        raise RuntimeError(f"the schedule could not be read: {done.stderr.strip()}")
    return [line[len("TOAST|") :] for line in done.stdout.splitlines() if line.startswith("TOAST|")]


def scheduled() -> list[str]:
    return schedule()


def unschedule() -> None:
    schedule(remove=True)


def register_id() -> None:
    import winreg

    key = winreg.CreateKey(
        winreg.HKEY_CURRENT_USER, rf"Software\Classes\AppUserModelId\{IDENTIFIER}"
    )
    winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, "nibeditor probe")
    winreg.CloseKey(key)


def unregister_id() -> None:
    import winreg

    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"Software\Classes\AppUserModelId\{IDENTIFIER}")
    except FileNotFoundError:
        pass


def wipe_profile() -> None:
    """What the last run of this identifier left, so a plan is made from nothing."""
    for base in (os.environ.get("APPDATA"), os.environ.get("LOCALAPPDATA")):
        if base:
            shutil.rmtree(pathlib.Path(base) / IDENTIFIER, ignore_errors=True)


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")
    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    args = parsed.parse_args()
    exe = pathlib.Path(args.exe).resolve()
    refuse_updating(exe)

    at = datetime.datetime.now() + datetime.timedelta(minutes=OUT_MINUTES)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-reminders-spaces-"))
    space = spaces / SPACE
    space.mkdir(parents=True)
    (space / "Plan.md").write_text(
        f"# Plan\n\n- [ ] Call the bank [remind:: {at:%Y-%m-%d %H:%M}]\n", encoding="utf-8"
    )

    failures: list[str] = []
    app = None
    try:
        unschedule()
        wipe_profile()
        register_id()
        environment = {**os.environ, "NIB_SPACES_DIR": str(spaces), "NIB_PROBE_REMINDERS": "1"}
        app = run_probe(exe, env=environment)

        found: list[str] = []
        deadline = time.monotonic() + PATIENCE
        while time.monotonic() < deadline and not found:
            time.sleep(2.0)
            found = [one for one in scheduled() if one.startswith(f"{GROUP}|")]
        if not found:
            failures.append("no toast was put on the schedule")
        else:
            group, tag, delivery = found[0].split("|", 2)
            say(f"scheduled: group {group}, tag {tag}, rings {delivery}")
            if len(tag) != 16:
                failures.append(f"the tag is not a reminder's id: {tag!r}")
            when = datetime.datetime.fromisoformat(delivery[:19]).replace(tzinfo=datetime.timezone.utc)
            wanted = at.replace(second=0, microsecond=0).astimezone(datetime.timezone.utc)
            off = abs(when - wanted)
            if off > datetime.timedelta(seconds=1):
                failures.append(f"it rings at {when}, not at {at:%H:%M}")
    finally:
        if app is not None and app.poll() is None:
            if not close_app(app):
                app.kill()
        try:
            unschedule()
            left = scheduled()
        except RuntimeError as error:
            left = [str(error)]
        unregister_id()
        if left:
            failures.append(f"toasts may be left on the schedule: {left}")
        else:
            say("cleaned up: nothing left on the probe id's schedule")
        shutil.rmtree(spaces, ignore_errors=True)

    for one in failures:
        say(f"WRONG: {one}")
    say("PASS" if not failures else "FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
