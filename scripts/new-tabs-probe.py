"""A new tab in the packaged app: the chord, the kinds, and a website nobody has saved.

Windows only, and the one thing the browser drive cannot answer: a web tab's page is a
second webview inside the window, so whether the app's own keys still reach the window
while a page is on screen, and whether saving one writes the shortcut, are questions
about the real thing. `apps/desktop/test/e2e/new-tabs.py` drives everything else in a
browser; this drives the built app.

What it checks, through the app's own automation endpoint:

* **Ctrl+Shift+P** opens the palette on the commands - `>` in the field, the caret after
  it - in the packaged window, and again over a web tab, which is the case a page could
  have swallowed. A page that has the keyboard keeps its own keys, as it does for every
  other chord; see docs/web-tabs.md.
* **Ctrl+T** opens the chooser, with the keyboard on the first row.
* **Every kind** - a plane, a deck of pages, a website - opens as a tab with no file in
  the space and no row in the list.
* **Saving the website** writes the `.url`, with the address the tab is on, into the
  space - and the tab becomes that file in place.

The page is served from here, on a port of its own, so nothing is asked of anybody's
network. The space is made in a temp folder named by `NIB_SPACES_DIR`, so the run
touches nothing of anybody's; see docs/automation.md.

    python scripts/new-tabs-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe

The exe is a probe build, under an identifier of its own:

    pnpm --dir apps/desktop tauri build --no-bundle \
      --config '{"identifier":"ch.emilvinu.nib.probe"}'

This wipes that identifier's settings folder and webview profile at the start of every
run, and refuses to wipe one whose name does not say `probe`.
"""

from __future__ import annotations

import argparse
import ctypes
import http.server
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes

# Where a drive of this repository may listen; see docs/conventions.md.
PORT = 23760

SPACES_DIR = "NIB_SPACES_DIR"
SPACE = "New tabs probe"

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

PAGE = b"""<!doctype html>
<title>A page in a tab</title>
<body style="background: #2b2b6b; color: white; font: 16px system-ui">
<h1>A page in a tab</h1>
<p>Served by scripts/new-tabs-probe.py.</p>
</body>
"""

failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def wrong(words: str) -> None:
    failures.append(words)
    print(f"  FAIL {words}", flush=True)


class Quiet(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - the library's own name
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(PAGE)))
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *args: object) -> None:
        return


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
    """`eval` is off until this installation's own file says otherwise, which is
    deliberately the same file the secret is in; see docs/automation.md."""
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")


def verb(port: int, secret: str, name: str, args: dict[str, object], seconds: float = 20.0) -> str:
    body = json.dumps({"verb": name, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=seconds) as answer:
            return answer.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as refused:
        return f"the app answered {refused.code}: {refused.read().decode('utf-8', 'replace')}"
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return f"no answer: {error}"


def ran(port: int, secret: str, code: str) -> object:
    """One expression in the window, and what it came back as.

    `yes` because every verb that changes something asks for it, and `eval` changes
    whatever it is sent; see `confirms` in automation/verbs.ts."""
    said = verb(port, secret, "eval", {"code": code, "yes": True})
    try:
        answer = json.loads(said)
    except ValueError:
        return said

    if isinstance(answer, dict):
        if answer.get("ok") is False:
            return f"refused: {answer.get('error')}"
        if "value" in answer:
            return answer["value"]

    return answer


def windows_of(pid: int) -> list[int]:
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    found: list[int] = []

    proc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def each(hwnd: int, _param: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(proc(each), 0)
    return found


def wait_for_window(app: subprocess.Popen[bytes], seconds: float) -> int:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        got = windows_of(app.pid)
        if got:
            return got[0]
        time.sleep(0.25)
    return 0


def shoot(pid: int, out: pathlib.Path) -> None:
    """A photograph of the window, by pid and nothing else; see capture-window.ps1."""
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(HERE / "capture-window.ps1"),
            "-Pid",
            str(pid),
            "-Out",
            str(out),
        ],
        check=False,
        capture_output=True,
    )


# One keystroke, as the window would hand one over: the app reads its own keys off the
# window, so this is the very handler a press goes through.
PRESS = """
(() => {
  const press = (key, code, shift) => window.dispatchEvent(new KeyboardEvent('keydown', {
    key, code, ctrlKey: true, shiftKey: !!shift, bubbles: true, cancelable: true,
  }))
  press('%s', '%s', %s)
  return true
})()
"""

FIELD = """
(() => {
  const input = document.querySelector('.palette input')
  return input ? input.value + '|' + input.selectionStart : null
})()
"""

STATE = """
(() => {
  const ws = window.nibApp.workspace
  return JSON.stringify({
    tabs: ws.tabs.map((one) => ({ kind: one.kind, path: one.path, shown: one.shown })),
    files: ws.files.map((one) => one.name),
    active: ws.active ? { kind: ws.active.kind, path: ws.active.path } : null,
  })
})()
"""

MENU = """
(() => {
  const rows = [...document.querySelectorAll('.menu [role="menuitem"]')].map((o) => o.textContent.trim())
  const on = document.activeElement ? document.activeElement.textContent.trim() : null
  return JSON.stringify({ rows, on })
})()
"""


def state(port: int, secret: str) -> dict:
    said = ran(port, secret, STATE)
    try:
        return json.loads(said if isinstance(said, str) else json.dumps(said))
    except ValueError:
        return {}


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")

    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    exe = pathlib.Path(args.exe).resolve()
    if not exe.exists():
        raise SystemExit(f"no such exe: {exe}")

    shots = ROOT / "apps" / "desktop" / "test" / "e2e" / "shots" / "new-tabs-probe"
    shots.mkdir(parents=True, exist_ok=True)

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Quiet)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    say(f"serving a page on http://127.0.0.1:{PORT}")

    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-new-tabs-"))
    (spaces / SPACE).mkdir(parents=True, exist_ok=True)
    (spaces / SPACE / "A note.md").write_text("# A note\n\nWords.\n", encoding="utf-8")
    say(f"spaces root {spaces}")

    wipe(args.identifier)
    environment = {**os.environ, SPACES_DIR: str(spaces)}

    # Twice, because `eval` is read once when the endpoint starts listening: the first
    # launch is what writes the file this turns it on in, and the second is the one that
    # answers. See `eval` in src-tauri/src/endpoint.rs.
    first = subprocess.Popen([str(exe)], cwd=str(exe.parent), env=environment)
    was, _ = endpoint(args.identifier, 150)
    allow_eval(args.identifier)
    say(f"eval turned on in {config_dir(args.identifier) / 'automation.json'}")
    first.terminate()
    try:
        first.wait(timeout=15)
    except subprocess.TimeoutExpired:
        first.kill()
    # Long enough for the single-instance lock to go with it: a launch while the last one
    # is still holding it hands its arguments over and exits, and then there is no window
    # of this process to wait for. See tauri-plugin-single-instance.
    time.sleep(6.0)

    app = subprocess.Popen([str(exe)], cwd=str(exe.parent), env=environment)
    try:
        hwnd = wait_for_window(app, 120)
        if not hwnd:
            raise SystemExit("the window never appeared")
        say(f"window 0x{hwnd:X}, pid {app.pid}")

        port, secret = endpoint(args.identifier, 150, unlike=was)
        time.sleep(2.0)
        say(f"endpoint on {port}")

        if ran(port, secret, "1 + 1") != 2:
            wrong("the endpoint would not run anything; is eval on?")
            return 1

        say("--- Ctrl+Shift+P in the packaged window ---")
        ran(port, secret, PRESS % ("P", "KeyP", "true"))
        time.sleep(0.8)
        field = ran(port, secret, FIELD)
        if field != ">|1":
            wrong(f"the chord did not open the palette on the commands: {field!r}")
        else:
            say("from a note            -> '>' with the caret after it")
        shoot(app.pid, shots / "commands.png")
        ran(port, secret, "(() => { window.nibApp.overlays.escape(); return true })()")
        time.sleep(0.5)

        say("--- Ctrl+T ---")
        ran(port, secret, PRESS % ("t", "KeyT", "false"))
        time.sleep(1.0)
        menu = json.loads(str(ran(port, secret, MENU)))
        if menu["rows"] != ["New note", "New canvas", "New web note", "New page note"]:
            wrong(f"Ctrl+T did not offer the kinds: {menu['rows']}")
        else:
            say(f"the chooser            -> {menu['rows']}")
        if menu["on"] != "New note":
            wrong(f"the keyboard did not land on the first row: {menu['on']!r}")
        else:
            say("the keyboard           -> on New note")
        shoot(app.pid, shots / "chooser.png")
        ran(port, secret, "(() => { window.nibApp.overlays.escape(); return true })()")
        time.sleep(0.4)

        say("--- a tab of each kind, and nothing on disk ---")
        before = sorted(one.name for one in (spaces / SPACE).iterdir())
        for kind, code in (
            ("canvas", "window.nibApp.workspace.newCanvas()"),
            ("pages", "window.nibApp.workspace.newPages()"),
            ("web", "window.nibApp.workspace.openWebsite()"),
        ):
            ran(port, secret, f"(() => {{ void {code}; return true }})()")
            time.sleep(1.2)
            now = state(port, secret)
            if now.get("active") != {"kind": kind, "path": None}:
                wrong(f"a new {kind} did not open unsaved: {now.get('active')}")
            else:
                say(f"a new {kind:<10}      -> a tab, path null")

        after = sorted(one.name for one in (spaces / SPACE).iterdir())
        if after != before:
            wrong(f"something was written into the space: {after}")
        else:
            say(f"the space              -> still {after}")

        say("--- the chord over a web tab ---")
        # Where the bar would have pointed it: the tab remembers the address, and the
        # pane asks for the page the next time anything moves - a press is one of the
        # things that makes it look again. See `follow` in WebTab.svelte.
        ran(
            port,
            secret,
            f"(() => {{ const ws = window.nibApp.workspace;"
            f" const tab = ws.tabs.find((o) => o.kind === 'web'); if (!tab) return false;"
            f" ws.activate(tab.id); ws.webWalked(tab, 'http://127.0.0.1:{PORT}/');"
            f" return true }})()",
        )
        time.sleep(1.0)
        ran(port, secret, PRESS % ("0", "Digit0", "false"))
        time.sleep(6.0)

        aimed = ran(
            port,
            secret,
            "(() => { const ws = window.nibApp.workspace;"
            " const tab = ws.tabs.find((o) => o.kind === 'web');"
            " return tab ? (tab.address ?? '') : '' })()",
        )
        say(f"the tab points at      -> {aimed!r}")
        shoot(app.pid, shots / "web-tab.png")

        ran(port, secret, PRESS % ("P", "KeyP", "true"))
        time.sleep(0.8)
        field = ran(port, secret, FIELD)
        if field != ">|1":
            wrong(f"the chord did not answer over a web tab: {field!r}")
        else:
            say("over a page            -> '>' as well, the app's key wins")
        shoot(app.pid, shots / "commands-over-page.png")
        ran(port, secret, "(() => { window.nibApp.overlays.escape(); return true })()")
        time.sleep(0.5)

        say("--- saving the website ---")
        ran(
            port,
            secret,
            "(() => { const ws = window.nibApp.workspace;"
            " const tab = ws.tabs.find((o) => o.kind === 'web'); if (tab) void ws.save(tab); return true })()",
        )
        time.sleep(1.5)
        if not ran(port, secret, "(() => !!document.querySelector('.sheet input'))()"):
            wrong("Ctrl+S on an unsaved website asked nothing")
        else:
            ran(
                port,
                secret,
                "(() => { const input = document.querySelector('.sheet input');"
                " input.value = 'A page'; input.dispatchEvent(new Event('input', { bubbles: true }));"
                " input.closest('form').requestSubmit(); return true })()",
            )
            time.sleep(2.0)
            now = state(port, secret)
            path = (now.get("active") or {}).get("path") or ""
            if not path.endswith("A page.url"):
                wrong(f"saving the website did not write the shortcut: {now.get('active')}")
            else:
                say(f"saved                  -> {path}")

            written = spaces / SPACE / "A page.url"
            if not written.exists():
                wrong(f"no shortcut on disk: {sorted(one.name for one in (spaces / SPACE).iterdir())}")
            else:
                text = written.read_text(encoding="utf-8", errors="replace")
                if f"URL=http://127.0.0.1:{PORT}" not in text:
                    wrong(f"the shortcut does not hold the address: {text!r}")
                else:
                    say(f"the file               -> {text.splitlines()[:3]}")

        shoot(app.pid, shots / "after.png")
        say(f"shots in {shots}")
    finally:
        app.terminate()
        try:
            app.wait(timeout=10)
        except subprocess.TimeoutExpired:
            app.kill()
        httpd.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)

    if failures:
        print("\n%d thing(s) wrong:" % len(failures))
        for one in failures:
            print(f"  - {one}")
        return 1

    print("\neverything the probe checked was right")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
