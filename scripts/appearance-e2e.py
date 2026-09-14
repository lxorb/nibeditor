"""The window's frame and its translucency, toggled in the real app.

What it proves:

    the window starts with nib's own frame and no material behind it
    the system's frame is the system's: a titlebar appears, which is a client area
      that no longer fills the window
    translucency on asks the compositor for the window's material, and off takes it
      away again - read back off the window itself with `DwmGetWindowAttribute`, not
      off the app's own opinion of what it did
    both choices are remembered: the app is stopped, started again, and comes up the
      way it was left
    nothing here is a screenshot of a hope - each state is photographed

It drives a probe build, which is told where to keep its notes:

    python scripts/appearance-e2e.py --app "<path to the probe .exe>"

`NIB_SPACES_DIR` points inside `target/`, so nothing goes near anybody's notes. The
app's own `eval` is turned on in the probe's endpoint file before it starts, which is
how the two settings are pressed from out here; see docs/automation.md.

Windows only, which is where Mica is.
"""

from __future__ import annotations

import argparse
import ctypes
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
WORK = ROOT / "target" / "appearance-e2e"
SHOTS = WORK / "shots"

# What DWM calls the material behind a window, and what it calls none.
DWMWA_SYSTEMBACKDROP_TYPE = 38
DWMSBT_DISABLE = 1
DWMSBT_MAINWINDOW = 2

failures: list[str] = []


def say(what: str) -> None:
    print(f"  {what}", flush=True)


def wrong(what: str) -> None:
    failures.append(what)
    print(f"  FAIL {what}", flush=True)


user32 = ctypes.windll.user32 if sys.platform == "win32" else None
dwmapi = ctypes.windll.dwmapi if sys.platform == "win32" else None


class Rect(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


def window_of(pid: int) -> int:
    """The app's own window: visible, sizeable, and the widest of them.

    A Tauri process owns more than one top-level window - the single instance plugin
    keeps a small listener with a title of its own - so size is what decides, exactly as
    it does in capture-window.ps1.
    """
    assert user32
    found: list[tuple[int, int]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def each(hwnd, _param):  # noqa: ANN001, ANN202
        owner = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value != pid or not user32.IsWindowVisible(hwnd):
            return True

        box = Rect()
        user32.GetWindowRect(hwnd, ctypes.byref(box))
        wide = box.right - box.left
        if wide > 200 and box.bottom - box.top > 200:
            found.append((wide, int(hwnd)))

        return True

    user32.EnumWindows(each, None)
    if not found:
        raise SystemExit(f"process {pid} has no window")

    return sorted(found, reverse=True)[0][1]


def frame_of(hwnd: int) -> int:
    """How many pixels of the window the system's own frame takes.

    The window rect against the client rect: an undecorated window is all client, and a
    decorated one has a titlebar the app never sees.
    """
    assert user32
    whole = Rect()
    client = Rect()
    user32.GetWindowRect(hwnd, ctypes.byref(whole))
    user32.GetClientRect(hwnd, ctypes.byref(client))

    return (whole.bottom - whole.top) - (client.bottom - client.top)


def backdrop_of(hwnd: int) -> int:
    """Which material the compositor is drawing behind the window, asked of DWM.

    The app's own claim about what it did is not evidence; this is what Windows says.
    """
    assert dwmapi
    held = ctypes.c_int(0)
    dwmapi.DwmGetWindowAttribute(
        ctypes.c_void_p(hwnd),
        ctypes.c_uint(DWMWA_SYSTEMBACKDROP_TYPE),
        ctypes.byref(held),
        ctypes.sizeof(held),
    )

    return held.value


# ── the app ─────────────────────────────────────────────────────────────────


def identifier_of(app: pathlib.Path) -> str:
    found = json.loads((app.parent / "nib-probe-identifier.json").read_text(encoding="utf-8"))
    return str(found["identifier"])


def endpoint_of(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier / "automation.json"


def allow_eval(path: pathlib.Path) -> None:
    """`eval` turned on in the endpoint file, which is the only way it can be.

    Deliberately not reachable from a request or a link: it runs whatever it is sent
    inside the window, so turning it on costs opening the file the secret is in. A drive
    is exactly the caller that should have to.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"port": 0, "secret": secrets.token_hex(32), "eval": True}),
        encoding="utf-8",
    )


def started(app: pathlib.Path) -> subprocess.Popen[bytes]:
    spaces = WORK / "spaces"
    spaces.mkdir(parents=True, exist_ok=True)

    return subprocess.Popen(
        [str(app)],
        env={**os.environ, "NIB_SPACES_DIR": str(spaces)},
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

    with urllib.request.urlopen(request, timeout=30) as answer:
        return json.loads(answer.read().decode())


def ran(held: dict, code: str) -> object:
    """One line of JavaScript, inside the window."""
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


def drive(app: pathlib.Path) -> None:
    identifier = identifier_of(app)
    endpoint = endpoint_of(identifier)
    allow_eval(endpoint)

    process = started(app)
    try:
        held = waited_for(endpoint)
        say(f"{identifier} is up on port {held['port']}, pid {held.get('pid')}")
        time.sleep(3.0)

        hwnd = window_of(process.pid)
        say(f"its window is {hwnd}")

        # ── as it comes up ─────────────────────────────────────────────────
        bare = frame_of(hwnd)
        if bare != 0:
            wrong(f"a window with nib's own frame has {bare}px of the system's on it")
        else:
            say("nib's own frame: the window is all client area")

        if backdrop_of(hwnd) == DWMSBT_MAINWINDOW:
            wrong("the window came up with a material behind it, which is not the default")
        shot(process.pid, "01-nib-frame")

        # ── the system's frame ─────────────────────────────────────────────
        ran(held, "window.nibApp.modes.setFrame('system')")
        time.sleep(1.5)

        framed = frame_of(hwnd)
        if framed <= bare:
            wrong(f"the system's frame added {framed - bare}px, which is no frame at all")
        else:
            say(f"the system's frame: {framed}px of titlebar and border the app does not draw")

        # And the app's own three buttons stand down, because the system draws them now.
        if ran(held, "document.documentElement.dataset.frame") != "system":
            wrong("the root does not say which frame is on, so the shell cannot read it")
        if ran(held, "!!document.querySelector('header .controls')"):
            wrong("nib is still drawing its own window buttons under the system's titlebar")
        else:
            say("and nib's own window buttons are gone from the bar")

        shot(process.pid, "02-system-frame")

        ran(held, "window.nibApp.modes.setFrame('nib')")
        time.sleep(1.5)
        if frame_of(hwnd) != 0:
            wrong("going back to nib's own frame left the system's on")

        # ── translucency ───────────────────────────────────────────────────
        ran(held, "window.nibApp.modes.setTranslucent(true)")
        time.sleep(1.5)

        behind = backdrop_of(hwnd)
        if behind != DWMSBT_MAINWINDOW:
            wrong(f"DWM says the backdrop is {behind}, not the window material ({DWMSBT_MAINWINDOW})")
        else:
            say("translucency on: the compositor is drawing the window's own material")

        if not ran(held, "document.documentElement.hasAttribute('data-translucent')"):
            wrong("the root does not say so, so the app's own ground is still opaque")
        ground = ran(held, "getComputedStyle(document.documentElement).getPropertyValue('--window-ground').trim()")
        if ground != "transparent":
            wrong(f"the window's ground is {ground!r} rather than transparent")
        else:
            say("and the app's own ground is transparent, so the material can be seen")

        shot(process.pid, "03-translucent")

        ran(held, "window.nibApp.modes.setTranslucent(false)")
        time.sleep(1.5)
        if backdrop_of(hwnd) == DWMSBT_MAINWINDOW:
            wrong("turning translucency off left the material behind the window")
        else:
            say("off again: the material is cleared")

        # ── and both of them are remembered ────────────────────────────────
        ran(held, "window.nibApp.modes.setFrame('system')")
        ran(held, "window.nibApp.modes.setTranslucent(true)")
        time.sleep(1.5)

    finally:
        # Only this drive's own process, by its pid. Never by name: somebody's own nib
        # may be running, and it is not this drive's to close.
        process.terminate()
        time.sleep(2.0)

    process = started(app)
    try:
        held = waited_for(endpoint)
        time.sleep(3.5)
        hwnd = window_of(process.pid)

        if frame_of(hwnd) <= 0:
            wrong("the system's frame was not there after a restart")
        else:
            say("after a restart the system's frame is still on")

        if backdrop_of(hwnd) != DWMSBT_MAINWINDOW:
            wrong("translucency was not there after a restart")
        else:
            say("and so is the material behind the window")

        shot(process.pid, "04-remembered")

        # Left as it was found, so the next run of this starts where this one did.
        ran(held, "window.nibApp.modes.setFrame('nib')")
        ran(held, "window.nibApp.modes.setTranslucent(false)")
        time.sleep(1.0)
    finally:
        process.terminate()
        time.sleep(1.0)


def main() -> int:
    if sys.platform != "win32":
        print("this drive reads the Windows compositor", flush=True)
        return 0

    parser = argparse.ArgumentParser()
    parser.add_argument("--app", required=True, type=pathlib.Path)
    said = parser.parse_args()

    shutil.rmtree(SHOTS, ignore_errors=True)
    drive(said.app.resolve())

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\nthe frame and the material are both the reader's, and both are remembered")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
