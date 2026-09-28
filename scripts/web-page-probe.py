"""The page itself, on the packaged app: find, the speaker and Mute site, the zoom the
engine reports, and a page's source in a tab. Windows only.

Each is the engine's own event or call, so each is only proven on the engine; the unit
tests beside the code hold the logic on either side of it. See "The page itself" in
docs/web-tabs.md.

* **find** - Ctrl+F on the pane opens the find bar, a word typed into it comes back as
  the engine's tally (`1 of 3`), Enter and Shift+Enter walk it, and Escape closes it.
* **sound** - a page playing a tone puts the speaker on its tab; Mute site in the tab's
  own menu strikes it through, keeps the site muted, and the engine says it is.
* **zoom** - Zoom in, in the dots, is kept for the site: another site in the same tab
  opens at a hundred per cent, and the first one at its size again. Any zoom the engine
  reports on the way is listed too; one made with Ctrl and the wheel needs a real hand.
* **source** - `view-source:` and a page's address opens as a tab and loads.

A tone that plays by itself needs the engine's autoplay rule relaxed, which a page on
the web never gets without a press; the probe asks for it in the process it starts, and
nothing the app ships changes.

What it does not drive, and why: a page's own full screen and the developer tools each
put a window of their own on the screen, which a probe may not do, and the keys pressed
inside a page need a real keyboard in the foreground. Those are the crate's unit tests.

    python scripts/web-page-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

The exe is a probe build that opens off the screen and never updates:

    pnpm --dir apps/desktop tauri build --no-bundle --config <file>

with the identifier, `"version": "99.0.0"`, the updater on `https://127.0.0.1:9/latest.json`
and the window at `"x": -32000, "y": -32000, "focus": false`.
"""

from __future__ import annotations

import argparse
import atexit
import http.server
import io
import json
import math
import os
import pathlib
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from ctypes import byref, windll, wintypes

from probe_app import close_app, main_window, refuse_updating

PORT_FROM = 23800
PORT_TO = 23819

SPACE = "Web page probe"


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def tone() -> bytes:
    """A second of a quiet tone, as a WAV the page loops."""

    rate = 22050
    frames = b"".join(
        struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * at / rate))) for at in range(rate)
    )
    out = io.BytesIO()
    with wave.open(out, "wb") as made:
        made.setnchannels(1)
        made.setsampwidth(2)
        made.setframerate(rate)
        made.writeframes(frames)
    return out.getvalue()


PAGES = {
    "/find": b"""<!doctype html><title>Find page</title>
<body style="font:16px system-ui;padding:2rem">
<p>A needle, and another needle.</p><div style="height:1500px"></div><p>The last needle.</p>
</body>""",
    "/sound": b"""<!doctype html><title>Sound page</title>
<body style="font:16px system-ui;padding:2rem"><p>A tone.</p>
<audio src="/tone.wav" autoplay loop></audio></body>""",
}


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> None:
    wav = tone()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            if self.path == "/tone.wav":
                body, kind = wav, "audio/wav"
            else:
                body, kind = PAGES.get(self.path, b"<title>Other</title>"), "text/html; charset=utf-8"
            self.send_response(200)
            self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()


def shortcut(url: str, title: str) -> str:
    return f"[InternetShortcut]\r\nURL={url}\r\nTitle={title}\r\n"


def space(port: int) -> pathlib.Path:
    """A spaces root of this probe's own, never anybody's Documents/Nib."""

    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-page-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(root)
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    made = root / SPACE
    made.mkdir(parents=True)
    (made / "Idea.md").write_text("# Idea\n\nA note to open the space on.\n", encoding="utf-8")
    for name in ("find", "sound"):
        (made / f"{name.title()}.url").write_text(
            shortcut(f"http://127.0.0.1:{port}/{name}", name.title()), encoding="utf-8"
        )
    return made


def config_dir(identifier: str) -> pathlib.Path:
    return pathlib.Path(os.environ["APPDATA"]) / identifier


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    for base in (os.environ["APPDATA"], os.environ["LOCALAPPDATA"]):
        shutil.rmtree(pathlib.Path(base) / identifier, ignore_errors=True)


def endpoint(identifier: str, unlike: int = 0) -> tuple[int, str, int]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + 90
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8-sig"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"]), int(said.get("pid") or 0)
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}; close any nib running under this identifier")


def allow_eval(identifier: str) -> None:
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def act(self, verb: str, args: dict[str, object], seconds: float = 60) -> object:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=seconds) as answer:
                return json.loads(answer.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as refused:
            return {"ok": False, "error": f"{refused.code} {refused.read().decode('utf-8', 'replace')}"}
        except Exception as error:  # noqa: BLE001 - a frozen app fails in its own ways
            return {"ok": False, "error": f"no answer: {error}"}

    def ask(self, code: str, seconds: float = 60) -> object:
        said = self.act("eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value


#: The engine's own switch for a sound that starts without a press, for the probe's
#: process only: the tone below has nobody to press play.
AUTOPLAY = "--autoplay-policy=no-user-gesture-required"


def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    refuse_updating(exe)
    env = {**os.environ, "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": AUTOPLAY}
    running = subprocess.Popen(
        [str(exe)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env
    )
    port, secret, pid = endpoint(identifier, unlike)
    if pid and pid != running.pid:
        raise SystemExit(f"another nib (pid {pid}) is listening under {identifier}: close it first")
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not main_window(running.pid):
        time.sleep(0.2)
    hwnd = main_window(running.pid)
    if not hwnd:
        raise SystemExit("the app never showed a window")
    # Off the screen, or not at all: a probe that opened where somebody is working stops
    # here, before it does anything else in their face.
    box = wintypes.RECT()
    windll.user32.GetWindowRect(hwnd, byref(box))
    if box.left > -10000:
        running.terminate()
        raise SystemExit(f"the window opened on the screen at {box.left},{box.top}: build it off it")
    time.sleep(1.5)
    return running, App(port, secret)


# Helpers every step below is written against: waiting on the window's own clock, the
# web tab in front, and its pane's own elements.
PRELUDE = r"""
const ws = nib.workspace
const wait = async (ok, ms = 15000) => {
  const until = performance.now() + ms
  for (;;) {
    const got = await ok()
    if (got) return got
    if (performance.now() > until) return null
    await new Promise((go) => setTimeout(go, 100))
  }
}
const front = () => ws.tabs.find((one) => one.id === ws.activeTabId)
const bar = () => document.querySelector('.webbar input')
const tally = () => {
  const said = document.querySelector('.findbar .tally')?.textContent ?? ''
  const found = said.match(/(\d+)\D+(\d+)/)
  return found ? `${found[1]}/${found[2]}` : said
}
const key = (target, init) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))
const invoke = window.__TAURI_INTERNALS__.invoke
"""


def step(app: App, body: str, seconds: float = 60) -> dict[str, object]:
    said = app.ask(f"(async () => {{ {PRELUDE}\n{body} }})()", seconds)
    return said if isinstance(said, dict) else {"error": said}


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    made = space(port)
    site = f"127.0.0.1:{port}"

    said: dict[str, object] = {}
    running = None
    try:
        running, app = launch(args.exe, args.identifier)
        close_app(running)
        allow_eval(args.identifier)
        time.sleep(1)
        running, app = launch(args.exe, args.identifier, unlike=app.port)

        # English, so the words read below are the words this file expects.
        app.ask("(localStorage.setItem('nib:language', 'en'), location.reload(), 1)")
        time.sleep(4)
        app.act("open", {"path": "Idea.md", "space": SPACE})
        time.sleep(2)

        said["find"] = step(
            app,
            f"""
  ws.openWeb({json.dumps(str(made / 'Find.url'))})
  const loaded = await wait(() => bar()?.value.includes('Find page'))
  key(window, {{ key: 'f', code: 'KeyF', ctrlKey: true }})
  const field = await wait(() => document.querySelector('.findbar input'))
  if (!field) return {{ loaded: !!loaded, bar: false }}
  field.value = 'needle'
  field.dispatchEvent(new Event('input', {{ bubbles: true }}))
  const first = await wait(() => (tally().includes('/') ? tally() : null))
  key(field, {{ key: 'Enter' }})
  const second = await wait(() => (tally() !== first ? tally() : null), 5000)
  key(field, {{ key: 'Enter', shiftKey: true }})
  const back = await wait(() => (tally() !== second ? tally() : null), 5000)
  key(field, {{ key: 'Escape' }})
  const closed = await wait(() => !document.querySelector('.findbar'), 3000)
  return {{ loaded: !!loaded, first, second, back, closed: !!closed }}
""",
        )

        said["zoom"] = step(
            app,
            f"""
  const tab = front()
  const heard = []
  const I = window.__TAURI_INTERNALS__
  await I.invoke('plugin:event|listen', {{
    event: 'nib://web-page',
    target: {{ kind: 'Any' }},
    handler: I.transformCallback((one) => one.payload.said === 'zoom' && heard.push(one.payload.factor)),
  }})
  const size = async (press) => {{
    document.querySelector('.webbar [aria-label="More"]').click()
    const rows = await wait(() => {{
      const all = [...document.querySelectorAll('.menu .nib-row')]
      return all.length ? all : null
    }})
    if (press) rows.find((one) => one.textContent.trim() === press)?.click()
    await new Promise((go) => setTimeout(go, 300))
    const said = [...document.querySelectorAll('.menu .nib-row')].map((one) => one.textContent.trim()).find((one) => one.endsWith('%'))
    key(window, {{ key: 'Escape' }})
    await new Promise((go) => setTimeout(go, 400))
    return said
  }}
  const go = async (url, title) => {{
    await invoke('web_navigate', {{ tab: tab.id, url }})
    await wait(() => bar()?.value.includes(title) && !document.querySelector('.webbar .turning'))
    await new Promise((done) => setTimeout(done, 1500))
  }}
  const zoomed = await size('Zoom in')
  const kept = localStorage.getItem('nib:web-zooms')
  await go('http://localhost:{port}/find', 'Find page')
  const elsewhere = await size(null)
  await go('http://127.0.0.1:{port}/find', 'Find page')
  const again = await size(null)
  await size('100%')
  return {{ zoomed, kept, elsewhere, again, heard }}
""",
        )

        said["sound"] = step(
            app,
            f"""
  ws.openWeb({json.dumps(str(made / 'Sound.url'))})
  const tab = await wait(() => (bar()?.value.includes('Sound page') ? front() : null))
  if (!tab) return {{ loaded: false }}
  const glyph = () => document.querySelector(`[data-tab="${{tab.id}}"] svg[viewBox="0 0 14 14"]`)
  const playing = await wait(() => glyph()?.getAttribute('aria-label'), 15000)
  document
    .querySelector(`[data-tab="${{tab.id}}"]`)
    .dispatchEvent(new MouseEvent('contextmenu', {{ bubbles: true, cancelable: true, clientX: 200, clientY: 20 }}))
  const row = await wait(() =>
    [...document.querySelectorAll('.menu .nib-row')].find((one) => one.textContent.includes('Mute site')),
  )
  row?.click()
  const muted = await wait(() => (glyph()?.getAttribute('aria-label') === 'Muted' ? 'Muted' : null), 10000)
  return {{ loaded: true, playing, row: !!row, muted, kept: localStorage.getItem('nib:web-muted') }}
""",
        )

        said["source"] = step(
            app,
            f"""
  const opener = front()
  ws.openPage('view-source:http://{site}/find', 'front', opener?.id)
  const shown = await wait(() => (bar()?.value.startsWith('view-source:') ? bar().value : null))
  return {{ shown }}
""",
        )
    finally:
        if running:
            if not close_app(running):
                running.terminate()

    for name, value in said.items():
        print(f"{name:8} {json.dumps(value)}")

    wrong: list[str] = []
    find = said.get("find", {})
    if not isinstance(find, dict) or find.get("first") != "1/3":
        wrong.append(f"find: a word typed in the bar should read 1 of 3, not {find}")
    elif find.get("second") != "2/3" or find.get("back") != "1/3" or not find.get("closed"):
        wrong.append(f"find: Enter, Shift+Enter and Escape did not walk and close: {find}")
    zoom = said.get("zoom", {})
    if not isinstance(zoom, dict) or zoom.get("zoomed") != "110%" or site not in str(zoom.get("kept")):
        wrong.append(f"zoom: Zoom in was not kept for the site: {zoom}")
    elif zoom.get("elsewhere") != "100%" or zoom.get("again") != "110%":
        wrong.append(f"zoom: another site did not open at its own size: {zoom}")
    sound = said.get("sound", {})
    if not isinstance(sound, dict) or sound.get("playing") != "Playing audio":
        wrong.append(f"sound: no speaker on the tab of a page playing a tone: {sound}")
    elif sound.get("muted") != "Muted" or site not in str(sound.get("kept")):
        wrong.append(f"sound: Mute site did not mute the site: {sound}")
    source = said.get("source", {})
    if not isinstance(source, dict) or not source.get("shown"):
        wrong.append(f"source: view-source did not open as a tab: {source}")

    for one in wrong:
        print(f"WRONG: {one}")
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main())
