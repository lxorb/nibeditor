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


def powershell(script: str) -> str:
    """Windows PowerShell 5.1, which projects WinRT, with its answer as text."""
    done = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
        capture_output=True,
        text=True,
        timeout=60,
    )
    return done.stdout.strip() + (f"\n{done.stderr.strip()}" if done.returncode else "")


NOTIFIER = (
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications,"
    " ContentType = WindowsRuntime] > $null; "
    f"$n = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifierWithId('{IDENTIFIER}'); "
)


def scheduled() -> list[str]:
    """The toasts on the probe id's schedule, as `group|tag|delivery`."""
    said = powershell(
        NOTIFIER
        + "$n.GetScheduledToastNotifications() | ForEach-Object "
        + '{ "$($_.Group)|$($_.Tag)|$($_.DeliveryTime.ToString(\'o\'))" }'
    )
    return [line for line in said.splitlines() if "|" in line]


def unschedule() -> None:
    powershell(
        NOTIFIER
        + "$n.GetScheduledToastNotifications() | ForEach-Object { $n.RemoveFromSchedule($_) }"
    )


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
            when = datetime.datetime.fromisoformat(delivery.replace("Z", "+00:00"))
            off = abs(when.astimezone().replace(tzinfo=None) - at.replace(second=0, microsecond=0))
            if off > datetime.timedelta(seconds=1):
                failures.append(f"it rings at {when}, not at {at:%H:%M}")
    finally:
        if app is not None and app.poll() is None:
            if not close_app(app):
                app.kill()
        unschedule()
        unregister_id()
        left = scheduled()
        if left:
            failures.append(f"toasts left on the schedule: {left}")
        else:
            say("cleaned up: nothing left on the probe id's schedule")
        shutil.rmtree(spaces, ignore_errors=True)

    for one in failures:
        say(f"WRONG: {one}")
    say("PASS" if not failures else "FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
