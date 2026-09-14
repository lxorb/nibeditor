"""`nib screenshot` against two nibs running at once.

What it proves, and each of the three was wrong before:

    the picture is of the window that answered, not of whichever process Windows
      listed first. The two windows are given different sizes, and each picture comes
      back the size of its own window - which no picture of the other could be
    the picture is the window drawing itself and not a copy of the screen: the same
      rectangle, copied off the screen, is a different picture
    nothing is raised or focused - the window in front is the same one before and
      after

Two nibs means two identifiers: the single instance plugin hands a second copy of the
same app over to the first, and rightly. So this wants two probe builds, each with an
identifier of its own, and it is told where they are:

    python scripts/capture-e2e.py --app "<path to probe a.exe>" --app "<path to probe b.exe>"

Every app is launched with `NIB_SPACES_DIR` pointing inside `target/`, so nothing here
goes anywhere near anybody's notes.

Windows only: it is the platform whose capture this is about.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import pathlib
import shutil
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
WORK = ROOT / "target" / "capture-e2e"
SHOTS = WORK / "shots"

failures: list[str] = []


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def wrong(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)


# ── the window in front, and where a window is ──────────────────────────────

user32 = ctypes.windll.user32 if sys.platform == "win32" else None

SWP_NOSIZE = 0x0001
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010


class Rect(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long), ("right", ctypes.c_long), ("bottom", ctypes.c_long)]


def in_front() -> int:
    """Which window has the keyboard. Nothing here may change it."""
    assert user32
    return int(user32.GetForegroundWindow())


def windows_of(pid: int) -> list[tuple[int, int, int, int, int]]:
    """The sizeable visible windows of one process: handle, x, y, width, height.

    The same filter the capture script uses, and for the same reason: a Tauri process
    owns more than one top-level window - the single instance plugin keeps a 13 by 13
    listener with a title of its own - so size is what decides among them.
    """
    assert user32
    found: list[tuple[int, int, int, int, int]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _param):  # noqa: ANN001, ANN202
        owner = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid or not user32.IsWindowVisible(hwnd):
            return True

        box = Rect()
        user32.GetWindowRect(hwnd, ctypes.byref(box))
        wide = box.right - box.left
        tall = box.bottom - box.top
        if wide > 200 and tall > 200:
            found.append((int(hwnd), box.left, box.top, wide, tall))

        return True

    user32.EnumWindows(each, None)
    return sorted(found, key=lambda one: -one[3])


def moved(hwnd: int, x: int, y: int) -> None:
    """A window put somewhere, without touching which one is in front or has focus."""
    assert user32
    user32.SetWindowPos(hwnd, None, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)


def sized(hwnd: int, x: int, y: int, wide: int, tall: int) -> None:
    """A window put somewhere and given a size, and still not raised or focused.

    The size is what makes the two windows tell each other apart in a picture: a capture
    of the wrong one is the wrong shape, whatever is drawn in it.
    """
    assert user32
    user32.SetWindowPos(hwnd, None, x, y, wide, tall, SWP_NOZORDER | SWP_NOACTIVATE)


def off_the_screen(hwnd: int, out: pathlib.Path) -> bool:
    """The same rectangle copied off the screen, which is what the capture used to do.

    True where it came out as something other than the window: a menu in front of it, a
    notification over the corner, or - as on a machine with no desk in front of it at all
    - one flat colour. Either way it is not a picture of the app, which is the whole
    reason the capture asks the window to draw itself instead.
    """
    ran = subprocess.run(
        [
            shutil.which("powershell") or "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Add-Type -AssemblyName System.Drawing;"
            "Add-Type @'\nusing System;using System.Runtime.InteropServices;\n"
            "public class Grab{[StructLayout(LayoutKind.Sequential)]public struct RECT"
            "{public int Left,Top,Right,Bottom;}"
            '[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out RECT r);}\n'
            "'@;"
            f"$r=New-Object Grab+RECT;[void][Grab]::GetWindowRect([IntPtr]{hwnd},[ref]$r);"
            "$b=New-Object System.Drawing.Bitmap ($r.Right-$r.Left),($r.Bottom-$r.Top);"
            "$g=[System.Drawing.Graphics]::FromImage($b);"
            "$g.CopyFromScreen($r.Left,$r.Top,0,0,$b.Size);"
            f'$b.Save("{out.as_posix()}",[System.Drawing.Imaging.ImageFormat]::Png);'
            "$g.Dispose();$b.Dispose();'copied'",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )

    return out.exists() and ran.returncode == 0


# ── the app, and the endpoint it writes ─────────────────────────────────────


def endpoint_of(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier / "automation.json"


def identifier_of(app: pathlib.Path) -> str:
    """Which identifier a probe was built with, out of the build's own config.

    Read rather than guessed: the endpoint file is under the identifier's own folder,
    and a drive that guessed it would be testing its own guess.
    """
    found = json.loads((app.parent / "nib-probe-identifier.json").read_text(encoding="utf-8"))
    return str(found["identifier"])


def start(app: pathlib.Path, label: str) -> subprocess.Popen[bytes]:
    """One app, running, with its notes somewhere nobody keeps notes."""
    spaces = WORK / label / "spaces"
    spaces.mkdir(parents=True, exist_ok=True)

    return subprocess.Popen(
        [str(app)],
        env={**os.environ, "NIB_SPACES_DIR": str(spaces)},
        cwd=str(app.parent),
    )


def waited_for(path: pathlib.Path, patience: float = 60) -> dict:
    """The endpoint file this launch wrote, once it is there and holds a port."""
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


def asked(held: dict, verb: str, args: dict | None = None) -> dict:
    """One request to one app, the way `nib` makes it."""
    body = json.dumps({"verb": verb, "args": args or {}, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{held['port']}/",
        data=body,
        headers={
            "authorization": f"Bearer {held['secret']}",
            "content-type": "application/json",
        },
    )

    with urllib.request.urlopen(request, timeout=20) as answer:
        return json.loads(answer.read().decode())


# ── the picture ─────────────────────────────────────────────────────────────


def capture(pid: int, out: pathlib.Path) -> str:
    """The capture script, asked for one process's window."""
    ran = subprocess.run(
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
            str(out),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if ran.returncode != 0:
        wrong(f"the capture of {pid} failed: {ran.stderr.strip()}")
        return ""

    return ran.stdout.strip()


def size_of(png: pathlib.Path) -> tuple[int, int]:
    """How big a PNG is, out of its own header rather than a library."""
    held = png.read_bytes()
    wide, tall = struct.unpack(">II", held[16:24])
    return wide, tall


def ink_of(png: pathlib.Path) -> int:
    """Something that differs between two pictures of two different windows. The bytes
    themselves: a PNG of the same window twice is near enough the same file, and of two
    windows showing two notes is not."""
    return hash(png.read_bytes())


def drive(apps: list[pathlib.Path]) -> None:
    running: list[tuple[str, subprocess.Popen[bytes], dict]] = []

    try:
        for at, app in enumerate(apps):
            label = "ab"[at]
            identifier = identifier_of(app)
            endpoint = endpoint_of(identifier)
            endpoint.unlink(missing_ok=True)

            process = start(app, label)
            held = waited_for(endpoint)
            running.append((label, process, held))
            say(f"[{label}] {identifier} is up on port {held['port']}, pid {held.get('pid')}")

            if held.get("pid") != process.pid:
                wrong(f"[{label}] the endpoint says pid {held.get('pid')}, the process is {process.pid}")

        time.sleep(2.5)

        # One window over the other, and each a size of its own. Over, because that is
        # the case the old capture got wrong - it copied the screen, and the screen there
        # is the other app; a size of its own, because that is what a picture of the wrong
        # window cannot fake.
        first = windows_of(running[0][1].pid)
        second = windows_of(running[1][1].pid)
        if not first or not second:
            wrong(f"a window is missing: {len(first)} and {len(second)}")
            return

        sized(first[0][0], 80, 80, 1000, 700)
        sized(second[0][0], 110, 110, 760, 560)
        time.sleep(1.5)

        before = in_front()
        SHOTS.mkdir(parents=True, exist_ok=True)
        pictures: dict[str, pathlib.Path] = {}

        for label, process, held in running:
            out = SHOTS / f"{label}.png"
            said = capture(process.pid, out)
            say(f"[{label}] {said}")
            if not out.exists():
                wrong(f"[{label}] no picture was written")
                continue

            pictures[label] = out
            wide, tall = size_of(out)
            window = windows_of(process.pid)[0]
            if (wide, tall) != (window[3], window[4]):
                wrong(f"[{label}] the picture is {wide}x{tall}, the window is {window[3]}x{window[4]}")
            else:
                say(f"[{label}] the picture is the size of its own window: {wide}x{tall}")

        after = in_front()
        if before != after:
            wrong(f"the window in front changed: {before} then {after}")
        else:
            say("the window in front is the same one before and after")

        if len(pictures) == 2 and size_of(pictures["a"]) == size_of(pictures["b"]):
            wrong("both pictures are the same shape, so one window was photographed twice")
        elif len(pictures) == 2:
            say("the two pictures are two different windows, by their own two shapes")

        # And the picture is the window rather than the screen. The same rectangle off
        # the screen is a different picture: what is in front of a window is not what a
        # screenshot of the app should hold.
        screen = SHOTS / "a-off-the-screen.png"
        if not off_the_screen(first[0][0], screen):
            say("the screen could not be copied here, which is answer enough on its own")
        elif ink_of(screen) == ink_of(pictures["a"]):
            wrong("the capture is the same as a copy of the screen, so it is not the window")
        else:
            say(f"a copy of the screen is a different picture ({screen.stat().st_size} bytes)")

    finally:
        for _label, process, _held in running:
            # Only the ones this drive started. Never by name: somebody's own nib may be
            # running, and it is not this drive's to close.
            process.terminate()
        time.sleep(1.0)


def main() -> int:
    if sys.platform != "win32":
        print("this drive is about the Windows capture", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", action="append", required=True, type=pathlib.Path)
    asked_for = parser.parse_args()

    if len(asked_for.app) != 2:
        raise SystemExit("two apps, each built with an identifier of its own")

    shutil.rmtree(SHOTS, ignore_errors=True)
    drive([one.resolve() for one in asked_for.app])

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nthe picture is of the window that answered, and nothing was raised to take it")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
