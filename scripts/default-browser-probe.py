"""Links handed to nib as the browser, driven on a Windows probe build.

Emil, 2026-09-30: nib as the default browser, set up with one press. This probe never
makes nib the default of anything, and cannot: a probe runs under an identifier of its
own, so the crate refuses the press and never registers (see `ships` in
src-tauri/src/default_browser.rs). What it drives is everything after the choice, which
needs no default at all - the command line Windows writes for a link, `nib.exe --url
"<address>"`, handed to a nib that is not running and to one that is:

* **cold** - a launch for a link opens nib with that page in a web tab.
* **warm** - two links handed to the running app are two tabs beside the one in front,
  in the order they came, the last one in front.
* **refused** - a `file:` address and a path open nothing, and a path smuggled after a
  link is part of that link's address rather than a note of its own.
* **the press** - `default_browser` answers, and `make_default_browser` refuses in a
  probe rather than touching this machine's settings.
* **the row** - a photograph of Settings > General with the Default browser row in it.

The pages are served from here, on a port of its own, so nothing is asked of anybody's
network. Every launch goes through `run_probe`, off the screen and without the keyboard,
and the second launches that hand a link over and exit are watched the same way.

    python scripts/default-browser-probe.py --exe <probe nib.exe> \\
      --identifier ch.emilvinu.nib.probe.<name>

Build the exe as scripts/probe_app.py says: version 99.0.0 and the updater pointed at a
loopback port nothing listens on.
"""

from __future__ import annotations

import argparse
import atexit
import http.server
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

from probe_app import main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent

# Where this probe may listen; see docs/conventions.md.
PORT_FROM = 23840
PORT_TO = 23859

SPACE = "Default browser probe"
NOTE = "Idea"


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            name = self.path.strip("/") or "home"
            body = f"<!doctype html><title>{name}</title><h1>{name}</h1>".encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def spaces_root() -> pathlib.Path:
    """A spaces root of this probe's own, never `Documents/Nib`; see web-open-probe.py."""

    made = pathlib.Path(tempfile.mkdtemp(prefix="nib-browser-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(made)
    atexit.register(shutil.rmtree, made, ignore_errors=True)
    return made


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for one in (config_dir(identifier), local_dir(identifier)):
        shutil.rmtree(one, ignore_errors=True)


def endpoint(identifier: str, seconds: float, pid: int) -> tuple[int, str]:
    """The port and secret of the app this probe launched, and no other: a nib that is
    already running would take every link below and exit this one."""

    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("secret") and int(said.get("pid") or 0) == pid:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path} for pid {pid}: is another probe running?")


def allow_eval(identifier: str) -> None:
    """Turns on the verb that asks the window a question, between two launches; see
    web-open-probe.py for why the bytes are written plain."""

    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))


def act(port: int, secret: str, verb: str, args: dict[str, object]) -> object:
    body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/",
        data=body,
        headers={"authorization": f"Bearer {secret}", "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as answer:
            return json.loads(answer.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as refused:
        return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
    except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
        return {"ok": False, "error": f"no answer: {error}"}


def ask(port: int, secret: str, code: str) -> object:
    said = act(port, secret, "eval", {"code": code, "yes": True})
    if not isinstance(said, dict) or not said.get("ok"):
        return {"error": said}
    value = said.get("value")
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return value
    return value


# The tabs of the pane in front, in the strip's order, and which of them is in front.
TABS = r"""
(() => {
  const ws = nib.workspace
  const front = ws.tabs.find((one) => one.id === ws.activeTabId)
  const pane = front ? front.paneId : null
  const strip = ws.tabs.filter((one) => one.paneId === pane)
  return JSON.stringify({
    strip: strip.map((one) => (one.kind === 'web' ? one.address ?? '' : `${one.kind}:${one.name}`)),
    front: front ? (front.kind === 'web' ? front.address ?? '' : `${front.kind}:${front.name}`) : null,
  })
})()
"""

# The two commands the Settings row calls, asked the way the row asks them.
PRESS = r"""
(async () => {
  const call = window.__TAURI_INTERNALS__.invoke
  const is = await call('default_browser').catch((error) => `failed: ${error}`)
  const made = await call('make_default_browser').then(() => 'made', (error) => String(error))
  return JSON.stringify({ is, made })
})()
"""


def tabs(port: int, secret: str) -> dict[str, object]:
    said = ask(port, secret, TABS)
    return said if isinstance(said, dict) else {"error": said}


def settled_tabs(port: int, secret: str, want: int) -> dict[str, object]:
    """The strip once it holds `want` web tabs, or as it is after twenty seconds."""

    until = time.perf_counter() + 20
    said: dict[str, object] = {}
    while time.perf_counter() < until:
        said = tabs(port, secret)
        strip = said.get("strip")
        if isinstance(strip, list) and sum(1 for one in strip if str(one).startswith("http")) >= want:
            return said
        time.sleep(0.3)
    return said


def hand_over(exe: pathlib.Path, *args: str) -> None:
    """A second launch, the way Windows starts nib for a link: it hands its command line
    to the running app and exits."""

    second = run_probe(exe, quiet=True, args=args)
    try:
        second.wait(timeout=30)
    except subprocess.TimeoutExpired:
        second.kill()
        raise SystemExit(f"a second launch with {args} did not hand over and exit") from None


def photograph(pid: int, out: pathlib.Path) -> None:
    """The window, by pid and nothing else; see capture-window.ps1."""

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


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--shots", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    parsed.add_argument("--keep-eval", action="store_true")
    options = parsed.parse_args()

    wipe(options.identifier)
    port = free_port()
    serve(port)
    site = f"http://127.0.0.1:{port}"
    space = spaces_root() / SPACE
    space.mkdir(parents=True)
    (space / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to open the space on.\n", encoding="utf-8")

    wrong: list[str] = []
    said: dict[str, object] = {}
    running: subprocess.Popen[bytes] | None = None
    try:
        # One launch to write the endpoint file and open the space, so eval can be
        # turned on and the next launch comes back to a space.
        running = run_probe(options.exe, quiet=True)
        port_, secret = endpoint(options.identifier, 90, running.pid)
        act(port_, secret, "open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(3)
        running.terminate()
        running.wait(timeout=30)
        allow_eval(options.identifier)

        # Cold: nib is not running, and Windows starts it for a link.
        started = time.perf_counter()
        running = run_probe(options.exe, quiet=True, args=["--url", f"{site}/cold"])
        port_, secret = endpoint(options.identifier, 90, running.pid)
        cold = settled_tabs(port_, secret, 1)
        said["cold"] = cold
        said["cold s"] = round(time.perf_counter() - started, 2)
        if f"{site}/cold" not in (cold.get("strip") or []):
            wrong.append(f"a launch for a link did not open it: {cold}")
        if cold.get("front") != f"{site}/cold":
            wrong.append(f"the link a launch was for is not the tab in front: {cold}")

        # Warm: two links while it runs, each a second launch that hands over and exits.
        hand_over(options.exe, "--url", f"{site}/one")
        hand_over(options.exe, "--url", f"{site}/two?a=1|2")
        warm = settled_tabs(port_, secret, 3)
        said["warm"] = warm
        strip = [str(one) for one in (warm.get("strip") or [])]
        expected = [f"{site}/cold", f"{site}/one", f"{site}/two?a=1|2"]
        webs = [one for one in strip if one.startswith("http")]
        if webs != expected:
            wrong.append(f"links while running did not land beside, in order: {strip}")
        if warm.get("front") != expected[-1]:
            wrong.append(f"the last link is not the tab in front: {warm}")

        # Refused: nothing that is not a page on the web opens anything.
        note = str(space / f"{NOTE}.md")
        hand_over(options.exe, "--url", pathlib.Path(note).as_uri())
        hand_over(options.exe, "--url", note)
        hand_over(options.exe, pathlib.Path(note).as_uri())
        time.sleep(2)
        after = tabs(port_, secret)
        said["refused"] = after
        if after.get("strip") != warm.get("strip"):
            wrong.append(f"a file handed over as a link opened something: {after}")

        # A path smuggled after a link is part of that link, never a note of its own.
        hand_over(options.exe, "--url", f"{site}/smuggled", note)
        smuggled = settled_tabs(port_, secret, 4)
        said["smuggled"] = smuggled
        added = [str(one) for one in (smuggled.get("strip") or []) if one not in (after.get("strip") or [])]
        if len(added) != 1 or not added[0].startswith(f"{site}/smuggled"):
            wrong.append(f"a path smuggled after a link opened as something else: {added}")

        # The press, which a probe refuses.
        press = ask(port_, secret, PRESS)
        said["press"] = press
        if not isinstance(press, dict) or press.get("made") == "made":
            wrong.append(f"a probe was allowed to ask to be the default browser: {press}")
        if isinstance(press, dict) and not isinstance(press.get("is"), bool):
            wrong.append(f"whether nib is the default browser was not answered: {press}")

        # The row, photographed off the screen.
        ask(port_, secret, "nib.settings.show('general')")
        hwnd = main_window(running.pid)
        if hwnd:
            sized(hwnd, 1180, 900)
        time.sleep(1.5)
        ask(
            port_,
            secret,
            "document.querySelector('.pane')?.scrollTo({ top: 1e6 })",
        )
        time.sleep(0.8)
        out = options.shots / "default-browser-row.png"
        photograph(running.pid, out)
        said["shot"] = str(out)
    finally:
        if running and running.poll() is None:
            running.terminate()

    for name, value in said.items():
        print(f"{name:8} {value}")
    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
