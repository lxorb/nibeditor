"""The spike behind docs/agent-native.md: a page an agent drives that nobody sees.
Windows only, on a probe build of branch `spike/agent-tabs`.

What it asks, and how:

* **Out of sight.** An agent's page is opened in the app's own window, shown to the
  engine but placed outside the window's client area (`agent_open`). The window is
  photographed by pid (`capture-window.ps1`, `PrintWindow`), and the agent page is
  magenta: not one magenta pixel may be in the picture. Every top-level window of the
  app *and of every engine process under it* is watched from launch to the end, and one
  that is ever on a screen or in front ends the run, on top of `run_probe`'s own watch.
* **No keyboard.** The window in front, and the app thread's focus window, are read
  before and after every step; neither may change. The page itself tries to take the
  focus (`window.focus`, an input's `focus`, `window.open`) and raises an `alert`.
* **Not throttled.** The page counts `requestAnimationFrame` and a 10 ms interval; the
  rates are read twice through `Runtime.evaluate`, which runs whatever the page's own
  timers are doing, with the wall clock between. The same page opened with the engine's
  own hiding (`IsVisible` false) is the control.
* **Driven.** `Accessibility.getFullAXTree` read as a snapshot with refs, an input
  clicked and filled (`Input.insertText`, never a key), a button clicked with
  `Input.dispatchMouseEvent`, and `Page.captureScreenshot`: each timed, each through
  `CallDevToolsProtocolMethod` on that one webview. No devtools port is opened.
* **The reader's own tab unaffected.** A web tab of the reader's is open and visible
  throughout: its rates, the tab strip, the active tab and the app's focused element are
  the same after as before.

No key is pressed anywhere, in a page or out of one.

    python scripts/agent-tab-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name> [--soak 330]

`--soak` holds both pages that many seconds longer and reads the rates again, which is
past the five minutes after which Chromium's intensive throttling starts on a hidden page.
"""

from __future__ import annotations

import argparse
import atexit
import base64
import ctypes
import http.server
import io
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
from ctypes import wintypes

from probe_app import close_app, main_window, run_probe

PORT_FROM = 23840
PORT_TO = 23859
SPACE = "Agent tab probe"
HERE = pathlib.Path(__file__).resolve().parent

METER = b"""<script>
window.raf = 0; window.ticks = 0; window.changes = 0
;(function loop () { window.raf++; requestAnimationFrame(loop) })()
setInterval(function () { window.ticks++ }, 10)
document.addEventListener('visibilitychange', function () { window.changes++ })
window.m = function () {
  return { raf: window.raf, ticks: window.ticks, at: Date.now(), state: document.visibilityState,
           focus: document.hasFocus(), changes: window.changes }
}
</script>"""

PAGES = {
    "/agent": b"""<!doctype html><title>Agent page</title>
<body style="margin:0;background:#ff00ff;font:16px system-ui;height:100vh">
<main style="padding:2rem">
<h1>Agent page</h1>
<label>Name <input id="name"></label>
<button id="save">Save</button>
<button id="shout">Alert</button>
<button id="steal">Steal</button>
<p id="status" role="status"></p>
</main>
<script>
window.clicked = []
document.getElementById('save').addEventListener('click', function (event) {
  const value = document.getElementById('name').value
  window.clicked.push({ what: 'save', trusted: event.isTrusted, value: value })
  document.getElementById('status').textContent = 'Saved ' + value
})
document.getElementById('shout').addEventListener('click', function () {
  const at = performance.now()
  alert('hello from the page')
  window.confirmed = confirm('and a question')
  window.alerted = Math.round(performance.now() - at)
  // The engine's own dialogs, from a frame the app's scripts were never put into.
  const frame = document.createElement('iframe')
  document.body.append(frame)
  const native = performance.now()
  frame.contentWindow.alert('a native alert')
  window.nativeConfirm = frame.contentWindow.confirm('a native question')
  window.nativeAfter = Math.round(performance.now() - native)
  window.nativeIsNative = String(frame.contentWindow.alert).includes('[native code]')
  // prompt is the one the app's scripts leave alone, so it is the engine's own.
  const asked = performance.now()
  window.prompted = prompt('a native prompt', 'x')
  window.promptAfter = Math.round(performance.now() - asked)
})
document.getElementById('steal').addEventListener('click', function () {
  window.focus()
  document.getElementById('name').focus()
  window.opened = String(window.open('/agent?popup', '_blank'))
  window.stole = true
})
</script>
"""
    + METER
    + b"</body>",
    "/user": b"""<!doctype html><title>User page</title>
<body style="margin:0;background:#00c000;font:16px system-ui;height:100vh">
<h1 style="padding:2rem">User page</h1>
"""
    + METER
    + b"</body>",
}


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


def serve(port: int) -> None:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = PAGES.get(self.path.split("?")[0], b"<title>Other</title>")
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()


def space(port: int) -> pathlib.Path:
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-agent-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(root)
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    made = root / SPACE
    made.mkdir(parents=True)
    (made / "Idea.md").write_text("# Idea\n\nA note to open the space on.\n", encoding="utf-8")
    (made / "User.url").write_text(
        f"[InternetShortcut]\r\nURL=http://127.0.0.1:{port}/user\r\nTitle=User\r\n", encoding="utf-8"
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
    raise SystemExit(f"the app never wrote {path}")


def allow_eval(identifier: str) -> None:
    path = config_dir(identifier) / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8-sig"))
    said["eval"] = True
    path.write_bytes(json.dumps(said).encode("utf-8"))


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def act(self, verb: str, args: dict[str, object], seconds: float = 90) -> object:
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
        except Exception as error:  # noqa: BLE001 - a wedged app fails in its own ways
            return {"ok": False, "error": f"no answer: {error}"}

    def ask(self, code: str, seconds: float = 90) -> object:
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


PRELUDE = r"""
const ws = nib.workspace
const invoke = window.__TAURI_INTERNALS__.invoke
const pause = (ms) => new Promise((go) => setTimeout(go, ms))
const cdp = async (label, method, params = {}) => {
  const t = performance.now()
  try {
    const raw = await invoke('agent_cdp', { label, method, params: JSON.stringify(params) })
    return { ms: performance.now() - t, value: JSON.parse(raw) }
  } catch (error) {
    return { ms: performance.now() - t, error: String(error) }
  }
}
const value = async (label, expression) => {
  const said = await cdp(label, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return said.error ? { error: said.error } : said.value.result?.value
}
const loaded = async (label, ms = 20000) => {
  const until = performance.now() + ms
  while (performance.now() < until) {
    if ((await value(label, 'document.readyState')) === 'complete') return true
    await pause(50)
  }
  return false
}
const focusNow = () => {
  const one = document.activeElement
  return one ? `${one.tagName}.${one.className}`.slice(0, 80) : null
}
const snapshot = async (label) => {
  const tree = await cdp(label, 'Accessibility.getFullAXTree', {})
  if (tree.error) return { error: tree.error, ms: tree.ms }
  const nodes = tree.value.nodes
  const byId = new Map(nodes.map((one) => [one.nodeId, one]))
  const skip = new Set(['generic', 'none', 'InlineTextBox', 'LineBreak'])
  const lines = []
  const refs = {}
  let next = 0
  const walk = (node, depth) => {
    if (!node) return
    const role = node.role?.value ?? ''
    const name = node.name?.value ?? ''
    let inner = depth
    if (!node.ignored && !skip.has(role) && !(role === 'StaticText' && !name)) {
      next += 1
      const ref = `e${next}`
      if (node.backendDOMNodeId) refs[ref] = { role, name, backend: node.backendDOMNodeId }
      lines.push(`${'  '.repeat(depth)}- ${role}${name ? ` "${name}"` : ''} [ref=${ref}]`)
      inner = depth + 1
    }
    for (const child of node.childIds ?? []) walk(byId.get(child), inner)
  }
  walk(nodes[0], 0)
  return { ms: tree.ms, nodes: nodes.length, lines, refs }
}
const find = (snap, role, name) =>
  Object.values(snap.refs ?? {}).find((one) => one.role === role && one.name === name)
const click = async (label, backendNodeId) => {
  const t = performance.now()
  await cdp(label, 'DOM.scrollIntoViewIfNeeded', { backendNodeId })
  const quads = await cdp(label, 'DOM.getContentQuads', { backendNodeId })
  if (quads.error) return { error: quads.error }
  const q = quads.value.quads[0]
  const x = (q[0] + q[2] + q[4] + q[6]) / 4
  const y = (q[1] + q[3] + q[5] + q[7]) / 4
  await cdp(label, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  await cdp(label, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  const up = await cdp(label, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  return { ms: performance.now() - t, x, y, error: up.error ?? null }
}
"""


def step(app: App, body: str, seconds: float = 120) -> dict[str, object]:
    said = app.ask(f"(async () => {{ {PRELUDE}\n{body} }})()", seconds)
    return said if isinstance(said, dict) else {"error": said}


# ---- what the operating system says: windows in front, the keyboard, the engines ----

#: `ShowWindow`: minimised and restored, neither of them activating the window.
SW_SHOWMINNOACTIVE = 7
SW_SHOWNOACTIVATE = 4

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32.GetForegroundWindow.restype = wintypes.HWND
user32.MonitorFromRect.restype = wintypes.HANDLE
user32.MonitorFromRect.argtypes = [ctypes.POINTER(wintypes.RECT), wintypes.DWORD]


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND),
        ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND),
        ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND),
        ("hwndCaret", wintypes.HWND),
        ("rcCaret", wintypes.RECT),
    ]


def described(hwnd: int | None) -> str:
    if not hwnd:
        return "none"
    name = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, name, 256)
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
    return f"{name.value}@{owner.value}"


def keyboard(pid: int) -> dict[str, str]:
    """The window in front, and where the app's own thread would send a key."""

    front = user32.GetForegroundWindow()
    owner = wintypes.DWORD()
    user32.GetWindowThreadProcessId(front, ctypes.byref(owner))
    hwnd = main_window(pid)
    thread = user32.GetWindowThreadProcessId(hwnd, None) if hwnd else 0
    info = GUITHREADINFO()
    info.cbSize = ctypes.sizeof(GUITHREADINFO)
    focus = "?"
    if thread and user32.GetGUIThreadInfo(thread, ctypes.byref(info)):
        focus = described(info.hwndFocus)
    return {
        "front is the probe or its engine": owner.value in family(pid),
        "front": described(front),
        "app thread focus": focus,
    }


def family(pid: int) -> set[int]:
    """The app and every process under it: the engine's browser, renderers, GPU."""

    import psutil

    try:
        return {pid, *(one.pid for one in psutil.Process(pid).children(recursive=True))}
    except psutil.Error:
        return {pid}


def in_view(pids: set[int]) -> str:
    found: list[str] = []
    front = user32.GetForegroundWindow()

    def each(hwnd: int, _lparam: int) -> bool:
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value not in pids:
            return True
        box = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(box))
        name = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, name, 256)
        if hwnd == front:
            found.append(f"{name.value} 0x{hwnd:X} of pid {owner.value} is in front")
        elif name.value == "Tao Thread Event Target" or name.value.endswith("-sic"):
            pass
        elif (
            user32.IsWindowVisible(hwnd)
            and box.right > box.left
            and box.bottom > box.top
            and user32.MonitorFromRect(ctypes.byref(box), 0)
        ):
            found.append(
                f"{name.value} 0x{hwnd:X} of pid {owner.value} on a screen at {box.left},{box.top} "
                f"{box.right - box.left}x{box.bottom - box.top}"
            )
        return True

    kind = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(kind(each), 0)
    return "; ".join(found)


def watch_family(app: subprocess.Popen[bytes]) -> None:
    """`run_probe` watches the app's own windows; this watches the engine's as well, since
    a dialog, a popup or a picker an agent's page raises belongs to an engine process."""

    pids = {app.pid}
    refreshed = 0.0
    while app.poll() is None:
        if time.perf_counter() - refreshed > 0.25:
            pids = family(app.pid)
            refreshed = time.perf_counter()
        seen = in_view(pids)
        if seen:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(app.pid)], capture_output=True)
            print(f"ENGINE WINDOW IN VIEW: {seen}. Killed the app.", file=sys.stderr)
            sys.stderr.flush()
            os._exit(3)
        time.sleep(0.004)


def engine_memory(pid: int) -> dict[str, float]:
    import psutil

    total_ws = 0
    total_private = 0
    count = 0
    for one in family(pid) - {pid}:
        try:
            info = psutil.Process(one).memory_info()
        except psutil.Error:
            continue
        total_ws += info.rss
        total_private += getattr(info, "private", 0)
        count += 1
    return {"processes": count, "working set MB": round(total_ws / 2**20, 1),
            "private MB": round(total_private / 2**20, 1)}


def photograph(pid: int, out: pathlib.Path) -> dict[str, object]:
    """The app's window, drawn by itself, and how much of each page is in it."""

    from PIL import Image

    subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
         str(HERE / "capture-window.ps1"), "-Pid", str(pid), "-Out", str(out)],
        capture_output=True, timeout=60,
    )
    if not out.exists():
        return {"error": "no picture"}
    picture = Image.open(out).convert("RGB")
    magenta = green = 0
    for r, g, b in picture.get_flattened_data() if hasattr(picture, 'get_flattened_data') else picture.getdata():
        if r > 230 and g < 40 and b > 230:
            magenta += 1
        elif r < 40 and 170 < g < 210 and b < 40:
            green += 1
    return {"size": picture.size, "agent (magenta) pixels": magenta, "user page (green) pixels": green}


def rates(before: dict[str, object], after: dict[str, object]) -> dict[str, object]:
    if not isinstance(before, dict) or not isinstance(after, dict) or "raf" not in before or "raf" not in after:
        return {"error": {"before": before, "after": after}}
    seconds = (float(after["at"]) - float(before["at"])) / 1000
    return {
        "seconds": round(seconds, 1),
        "rAF per s": round((float(after["raf"]) - float(before["raf"])) / seconds, 1),
        "10 ms interval per s": round((float(after["ticks"]) - float(before["ticks"])) / seconds, 1),
        "visibilityState": after["state"],
        "hasFocus": after["focus"],
        "visibility changes": after["changes"],
    }


def meter(app: App, label: str, seconds: float) -> dict[str, object]:
    first = step(app, f"return await value({json.dumps(label)}, 'window.m()')")
    time.sleep(seconds)
    second = step(app, f"return await value({json.dumps(label)}, 'window.m()')")
    return rates(first, second)


def drive(app: App, label: str, hidden: bool, url: str) -> dict[str, object]:
    """Opens one agent page and does everything an agent would do with it, timed."""

    said: dict[str, object] = {}
    said["open"] = step(
        app,
        f"""
  const t = performance.now()
  try {{
    await invoke('agent_open', {{ id: {json.dumps(label.removeprefix('agent-'))}, url: {json.dumps(url)},
                                  hidden: {json.dumps(hidden)}, width: 1280, height: 800 }})
  }} catch (error) {{ return {{ error: String(error) }} }}
  const built = performance.now() - t
  const ok = await loaded({json.dumps(label)})
  return {{ built_ms: Math.round(built), loaded_ms: Math.round(performance.now() - t), loaded: ok }}
""",
    )
    time.sleep(1)
    said["rates"] = meter(app, label, 4)

    said["snapshot"] = step(
        app,
        f"""
  await cdp({json.dumps(label)}, 'DOM.enable', {{}})
  const first = await snapshot({json.dumps(label)})
  const again = await snapshot({json.dumps(label)})
  if (first.error) return first
  return {{ ms: Math.round(first.ms), ms_again: Math.round(again.ms), nodes: first.nodes,
           lines: first.lines.length, chars: first.lines.join('\\n').length, text: first.lines.join('\\n') }}
""",
    )

    said["fill and click"] = step(
        app,
        f"""
  const label = {json.dumps(label)}
  const snap = await snapshot(label)
  const box = find(snap, 'textbox', 'Name')
  const save = find(snap, 'button', 'Save')
  if (!box || !save) return {{ error: 'no textbox or button in the tree', refs: snap.refs }}
  const into = await click(label, box.backend)
  const typed = await cdp(label, 'Input.insertText', {{ text: 'Ada Lovelace' }})
  const pressed = await click(label, save.backend)
  await pause(100)
  return {{ click_input_ms: Math.round(into.ms), insert_text_ms: Math.round(typed.ms), click_button_ms: Math.round(pressed.ms),
           errors: [into.error, typed.error, pressed.error].filter(Boolean),
           clicked: await value(label, 'window.clicked'), status: await value(label, "document.getElementById('status').textContent") }}
""",
    )

    said["dialog and focus attempts"] = step(
        app,
        f"""
  const label = {json.dumps(label)}
  const snap = await snapshot(label)
  const shout = find(snap, 'button', 'Alert')
  const steal = find(snap, 'button', 'Steal')
  const a = await click(label, shout.backend)
  await pause(300)
  const b = await click(label, steal.backend)
  await pause(500)
  return {{ errors: [a.error, b.error].filter(Boolean), alerted_after_ms: await value(label, 'window.alerted ?? false'), confirmed: await value(label, 'window.confirmed ?? null'),
           native: await value(label, '({{ after: window.nativeAfter, confirm: window.nativeConfirm, isNative: window.nativeIsNative, pageAlertIsNative: String(window.alert).includes("[native code]"), prompted: window.prompted, promptAfter: window.promptAfter, promptIsNative: String(window.prompt).includes("[native code]") }})'),
           dialogs: await invoke('agent_dialogs', {{ id: {json.dumps(label.removeprefix('agent-'))} }}),
           stole: await value(label, 'window.stole ?? false'), opened: await value(label, 'window.opened ?? null'),
           page_active: await value(label, 'document.activeElement?.id ?? null') }}
""",
    )

    said["screenshot"] = step(
        app,
        f"""
  const shot = await cdp({json.dumps(label)}, 'Page.captureScreenshot', {{ format: 'png' }})
  if (shot.error) return {{ ms: Math.round(shot.ms), error: shot.error }}
  return {{ ms: Math.round(shot.ms), data: shot.value.data }}
""",
        seconds=60,
    )
    shot = said["screenshot"]
    if isinstance(shot, dict) and isinstance(shot.get("data"), str):
        from PIL import Image

        picture = Image.open(io.BytesIO(base64.b64decode(shot.pop("data")))).convert("RGB")
        shot["size"] = picture.size
        shot["centre"] = picture.getpixel((picture.size[0] // 2, picture.size[1] - 10))
    return said


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--out", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    parsed.add_argument("--soak", type=float, default=0)
    parsed.add_argument("--minimize", action="store_true")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    serve(port)
    made = space(port)
    site = f"http://127.0.0.1:{port}"
    args.out.mkdir(parents=True, exist_ok=True)

    said: dict[str, object] = {}
    running = None
    try:
        running = run_probe(args.exe, quiet=True)
        threading.Thread(target=watch_family, args=(running,), daemon=True).start()
        first_port, _, _ = endpoint(args.identifier)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not main_window(running.pid):
            time.sleep(0.2)
        time.sleep(1.5)
        close_app(running)
        allow_eval(args.identifier)
        time.sleep(1)

        running = run_probe(args.exe, quiet=True)
        threading.Thread(target=watch_family, args=(running,), daemon=True).start()
        port_now, secret, pid = endpoint(args.identifier, unlike=first_port)
        if pid and pid != running.pid:
            raise SystemExit(f"another nib (pid {pid}) is listening under {args.identifier}")
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not main_window(running.pid):
            time.sleep(0.2)
        time.sleep(2)
        app = App(port_now, secret)

        app.act("open", {"path": "Idea.md", "space": SPACE})
        time.sleep(1.5)

        # The reader's own web tab, visible, and what it and the app look like first.
        said["user tab"] = step(
            app,
            f"""
  ws.openWeb({json.dumps(str(made / 'User.url'))})
  const until = performance.now() + 20000
  let label = null
  while (performance.now() < until) {{
    label = 'web-' + ws.activeTabId
    if ((await value(label, 'document.readyState')) === 'complete') break
    await pause(100)
  }}
  return {{ label, tabs: ws.tabs.length, active: ws.activeTabId, focus: focusNow() }}
""",
        )
        user = str(said["user tab"].get("label")) if isinstance(said["user tab"], dict) else ""
        time.sleep(1)
        said["keyboard before"] = keyboard(running.pid)
        said["user rates before"] = meter(app, user, 4)
        said["engine memory before"] = engine_memory(running.pid)

        said["agent, out of sight"] = drive(app, "agent-seen", False, f"{site}/agent")
        said["keyboard after the out of sight page"] = keyboard(running.pid)
        said["agent, hidden (control)"] = drive(app, "agent-hidden", True, f"{site}/agent")
        said["keyboard after the hidden page"] = keyboard(running.pid)
        said["engine memory with both"] = engine_memory(running.pid)

        said["user rates during"] = meter(app, user, 4)
        said["app after"] = step(
            app, "return { tabs: ws.tabs.length, active: ws.activeTabId, focus: focusNow() }"
        )
        said["window picture"] = photograph(running.pid, args.out / "agent-probe-window.png")

        if args.minimize:
            # The reader minimising nib while an agent works: shown minimised without being
            # activated, measured, and put back where it was, off the screen, the same way.
            hwnd = main_window(running.pid)
            user32.ShowWindow(hwnd, SW_SHOWMINNOACTIVE)
            time.sleep(1.5)
            said["while minimised"] = {
                "out of sight": meter(app, "agent-seen", 4),
                "user": meter(app, user, 4),
                "iconic": bool(user32.IsIconic(hwnd)),
            }
            user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
            time.sleep(1.5)
            said["restored"] = {"out of sight": meter(app, "agent-seen", 4), "keyboard": keyboard(running.pid)}

        if args.soak:
            time.sleep(args.soak)
            said[f"after {args.soak:.0f} s more"] = {
                "out of sight": meter(app, "agent-seen", 10),
                "hidden": meter(app, "agent-hidden", 10),
                "user": meter(app, user, 10),
            }
            said["keyboard after the soak"] = keyboard(running.pid)

        said["close"] = step(
            app,
            "for (const id of ['seen', 'hidden']) await invoke('agent_close', { id }).catch(() => null); await pause(500); return { closed: true }",
        )
        said["engine memory after close"] = engine_memory(running.pid)
    finally:
        print(json.dumps(said, indent=2, default=str))
        if running is not None and running.poll() is None:
            if not close_app(running):
                running.kill()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
