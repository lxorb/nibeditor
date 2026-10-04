"""Quick add's key from any app, on a probe. Windows only.

docs/tasks.md 5.6: once nib is running, a key the system holds for it opens a small window
of its own over whatever is in front. A probe never holds the reader's key: under
`NIB_OFF_SCREEN` the crate registers the key named in `NIB_QUICK_ADD_KEY` and nothing else
(`allowed` in src-tauri/src/quick_add.rs). So this starts a probe with a key nobody has on
a keyboard, Ctrl+Alt+Shift+F24, and then:

* **The key is held, after the launch order.** Asked the way the system answers it: a
  registration of the same key by this script is refused as already taken. Where it is
  not refused it is given back at once, and it is a key nobody has on a keyboard.
* **The key opens the window.** Pressed without a keyboard: the system's own message for
  a held key, posted to the window the global shortcut plugin keeps for them, which is
  exactly what the system posts when the key is pressed. The quick add window is then the
  probe's second window of the app's class, made off the screen like every other, and
  never in front (the watch in `run_probe` ends the probe if it ever is).
* **Pressed again, the same window comes back** rather than a second one.
* **A picker grows the window** to hold its list, and the window is its field's height
  again once it is put away.
* **A task typed there lands in the Inbox.** The words are put in its field and Enter
  said through the page's own script over the DevTools protocol, which presses nothing
  and brings nothing forward; the app's window writes the line into `Inbox.md`.

    python scripts/quick-add-probe.py --exe path/to/nib.exe

Build the exe as `scripts/probe_app.py` says, under `ch.emilvinu.nib.probe.quickadd`.
"""

from __future__ import annotations

import argparse
import ctypes
import os
import pathlib
import shutil
import sys
import time

from devtools import SWITCHES, Session, port, targets
from probe_app import APP_CLASS, close_app, look, main_window, run_probe, spaces_folder

user32 = ctypes.WinDLL("user32", use_last_error=True)

#: A key no keyboard has, so no window anybody is typing in can be holding it.
PROBE_KEY = "Control+Alt+Shift+F24"
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x1, 0x2, 0x4, 0x4000
VK_F24 = 0x87
ERROR_HOTKEY_ALREADY_REGISTERED = 1409
WM_HOTKEY = 0x0312

#: The id the global shortcut plugin gives that key: its modifiers' bits over the key's
#: code, which `the_probe_key_is_the_id_the_probe_presses` in src-tauri/src/quick_add.rs
#: holds to this number.
KEY_ID = 0x020900B7

#: The probe's identifier, whose folder holds its webview's DevTools port.
IDENTIFIER = "ch.emilvinu.nib.probe.quickadd"

#: The class of the window the plugin keeps for the keys it holds.
HOTKEY_CLASS = "global_hotkey_app"

failures: list[str] = []


def wrong(what: str) -> None:
    print(f"  WRONG: {what}")
    failures.append(what)


def held_elsewhere() -> bool:
    """Whether the probe key is held: a registration of it here is refused as taken. One
    that is not refused is given back at once."""

    if user32.RegisterHotKey(None, 0x5A5A, MOD_CONTROL | MOD_ALT | MOD_SHIFT | MOD_NOREPEAT, VK_F24):
        user32.UnregisterHotKey(None, 0x5A5A)
        return False
    return ctypes.get_last_error() == ERROR_HOTKEY_ALREADY_REGISTERED


def app_windows(pid: int) -> list[int]:
    return [one.hwnd for one in look({pid}).windows if one.kind == APP_CLASS and one.visible]


def until(test, what: str, seconds: float = 60.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        found = test()
        if found:
            return found
        time.sleep(0.2)
    wrong(f"gave up waiting for {what}")
    return None


def press(pid: int) -> None:
    """The key pressed, the way the system says so: WM_HOTKEY to the plugin's window."""

    keeper = next((one.hwnd for one in look({pid}).windows if one.kind == HOTKEY_CLASS), 0)
    if not keeper:
        wrong("the global shortcut plugin keeps no window: nothing registered a key")
        return
    flags = MOD_CONTROL | MOD_ALT | MOD_SHIFT
    user32.PostMessageW(keeper, WM_HOTKEY, KEY_ID, (VK_F24 << 16) | flags)


def height(hwnd: int) -> int:
    box = next((one.box for one in look().windows if one.hwnd == hwnd), (0, 0, 0, 0))
    return box[3] - box[1]


def page_of_window() -> Session | None:
    web = pathlib.Path(os.environ["LOCALAPPDATA"]) / IDENTIFIER / "EBWebView"
    page = until(
        lambda: next(
            (one for one in targets(port(web)) if str(one.get("url", "")).endswith("/quick-add.html")),
            None,
        )
        if port(web)
        else None,
        "the quick add window's page",
    )
    return Session(page) if page else None


def grows(pid: int, hwnd: int) -> None:
    """The day's picker opened by the page's own script, and the window's height read."""

    session = page_of_window()
    if not session or not hwnd:
        return
    short = height(hwnd)
    session.value("document.querySelectorAll('.controls .control')[1].click()")
    tall = until(lambda: height(hwnd) > short and height(hwnd), "the window grown for the picker", 10)
    print(f"  the window grew from {short} to {tall} for the picker")
    session.value("document.querySelector('.picker').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
    back = until(lambda: height(hwnd) == short, "the window back to its field's height", 10)
    if back:
        print("  and back to its field's height")
    session.close()


def typed_in(spaces: pathlib.Path) -> None:
    """A task typed into the quick add window, and Enter, by the page's own script."""

    session = page_of_window()
    if not session:
        return
    said = session.call(
        "Runtime.evaluate",
        {
            "expression": """
              new Promise((done) => {
                const field = document.querySelector('input.field')
                if (!field) return done('no field')
                field.value = 'Call mum tomorrow p1'
                field.dispatchEvent(new Event('input', { bubbles: true }))
                setTimeout(() => {
                  const chips = [...document.querySelectorAll('[data-chip]')].map((one) => one.textContent)
                  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
                  done(chips.join(','))
                }, 300)
              })
            """,
            "awaitPromise": True,
            "returnByValue": True,
        },
    )
    session.close()
    chips = said.get("result", {}).get("value")
    print(f"  the window read {chips!r} as chips")
    if chips != "tomorrow,p1":
        wrong(f"the window's chips were {chips!r}, not tomorrow and p1")
    inbox = spaces / "Probe" / "Inbox.md"
    written = until(lambda: inbox.exists() and inbox.read_text(encoding="utf-8"), "the task in Inbox.md", 20)
    print(f"  Inbox.md: {written!a}")
    if not written or not written.startswith("- [ ] Call mum 🔺 📅 "):
        wrong(f"Inbox.md holds {written!a}, not the task")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    exe = parser.parse_args().exe

    spaces = spaces_folder("quick-add")
    # A space to open, so the launch order runs to its end, where the key is handed over.
    (spaces / "Probe").mkdir()
    (spaces / "Probe" / "Plan.md").write_text("# Plan", encoding="utf-8")
    env = {
        **os.environ,
        "NIB_SPACES_DIR": str(spaces),
        "NIB_QUICK_ADD_KEY": PROBE_KEY,
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": SWITCHES,
    }
    if held_elsewhere():
        print(f"  {PROBE_KEY} is already held by something else on this machine; not starting")
        return 1

    app = run_probe(exe, env=env, quiet=True)
    try:
        until(lambda: main_window(app.pid), "the app's window")
        print("  the app is up")
        if until(held_elsewhere, f"{PROBE_KEY} held by the probe"):
            print(f"  {PROBE_KEY} is held by the probe")

        before = app_windows(app.pid)
        press(app.pid)
        opened = until(lambda: [one for one in app_windows(app.pid) if one not in before], "the quick add window")
        if opened:
            print(f"  the key opened a window of its own: {opened}")

        time.sleep(1.0)
        press(app.pid)
        time.sleep(1.5)
        again = [one for one in app_windows(app.pid) if one not in before]
        print(f"  pressed again: {len(again)} quick add window(s)")
        if len(again) != 1:
            wrong(f"the key made {len(again)} quick add windows, not one window shown again")

        grows(app.pid, opened[0] if opened else 0)
        typed_in(spaces)
    finally:
        if not close_app(app):
            app.kill()
        shutil.rmtree(spaces, ignore_errors=True)

    if held_elsewhere():
        wrong(f"{PROBE_KEY} is still held after the probe closed")
    print("FAILED" if failures else "quick add's key opened its window, on a probe")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
