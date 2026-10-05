"""Agents in nib, measured: every browser verb of docs/agent-native.md 5.2 on WebView2, on a
page set of our own, with nothing of it ever on a screen or in front.

Windows only, on a probe build (version 99.0.0, updater blocked), launched by `run_probe`.

What it asks, and how:

* **Out of sight.** An agent's pages are the crate's own agent tabs (src/agents/tabs.rs):
  children of the app's window, shown, outside its client area. Every page the agent opens
  is magenta, and the window is photographed by pid (`capture-window.ps1`): not one
  magenta pixel may be in it. Every top-level window of the app *and of every engine
  process under it* is watched from launch to the end, and one that is ever on a screen or
  in front ends the run (`run_probe`'s own watch, in scripts/probe_app.py), because a
  dialog, a picker or a popup a page raises belongs to an engine process.
* **No keyboard.** The window in front, and the app thread's focus window, are read before
  and after every step; neither may change. Keys are pressed into an agent's page through
  the engine (`Input.dispatchKeyEvent`) with that check around each press: this is the
  proof `browser_press` rests on.
* **Not throttled.** The page counts `requestAnimationFrame` and a 10 ms interval; the
  rates are read twice with the wall clock between.
* **Every verb.** Called over the endpoint exactly as an MCP server calls it, as the
  reader's own command line (the installation's secret) and as a paired agent with a
  token and Emil's default grant, on: a shop with a card form, a sign-in form, a page with
  a frame from another origin, dialogs (alert, confirm, prompt, beforeunload), a popup that
  posts to its opener, a download, a file input, a `<select>`, a date input. Each is
  timed.
* **The reader's tab is shared.** An agent acts in the reader's own web tab, and its
  presses never move the keyboard.
* **The reader's logins, not their extensions.** An agent tab asked for the reader's store
  is in its twin (src/agents/engines/mod.rs): a cookie the reader's store holds is there,
  and the agent's own cookie never reaches the reader's store.

    python scripts/agent-tab-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>

`--chromium` drives nib's own Chromium (`nib-chromium.exe`, src-tauri/cef), whose agent tabs
are browsers with no window at all (src/agents/engines/cef.rs). Off-screen rendering is a
switch CEF reads as it starts, and only a run that starts with an agent paired turns it on,
so this pairs the agent in a launch of its own and measures in the next.

Prints one JSON document; exits non-zero when a check fails.
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

from probe_app import close_app, family, keyboard, main_window, run_probe

PORT_FROM = 23860
PORT_TO = 23899
SPACE = "Agent probe"
HERE = pathlib.Path(__file__).resolve().parent

MAGENTA = "background:#ff00ff"

METER = """<script>
window.raf = 0; window.ticks = 0; window.changes = 0
;(function loop () { window.raf++; requestAnimationFrame(loop) })()
setInterval(function () { window.ticks++ }, 10)
document.addEventListener('visibilitychange', function () { window.changes++ })
window.m = function () {
  return { raf: window.raf, ticks: window.ticks, at: Date.now(), state: document.visibilityState,
           focus: document.hasFocus(), changes: window.changes }
}
</script>"""


def page(title: str, body: str, colour: str = MAGENTA) -> str:
    return (
        f"<!doctype html><meta charset=utf-8><title>{title}</title>"
        f'<body style="margin:0;{colour};font:16px system-ui;min-height:100vh"><main style="padding:2rem">'
        f"{body}</main>{METER}</body>"
    )


def pages(other: str) -> dict[str, tuple[str, str]]:
    """Every page, by path: (content type, body). `other` is the second origin."""

    html = "text/html; charset=utf-8"
    return {
        "/shop": (html, page("Shop", """
<h1>Basket</h1>
<p>One lamp, 42.00</p>
<form id="order" onsubmit="event.preventDefault(); document.getElementById('status').textContent = 'ordered'">
  <label>Name <input id="name" name="name" autocomplete="name"></label>
  <label>Quantity <select id="quantity" name="quantity"><option value="1">One</option><option value="2">Two</option><option value="3">Three</option></select></label>
  <label>Delivery <input id="when" type="date" name="when"></label>
  <label><input id="gift" type="checkbox" name="gift"> Gift wrap</label>
  <label>Card number <input id="card" name="cardnumber" autocomplete="cc-number"></label>
  <label>Expiry <input id="expiry" name="exp" autocomplete="cc-exp"></label>
  <label>Security code <input id="cvc" name="cvc" autocomplete="cc-csc"></label>
  <label>Receipt <input id="receipt" type="file" name="receipt"></label>
  <button id="place">Place order</button>
</form>
<p><a id="elsewhere" href="/other" target="_blank">Terms</a> <a id="file" href="/file.bin">Invoice</a></p>
<p id="status" role="status"></p>
<script>console.log('shop ready'); fetch('/api/cart').then(r => r.text())</script>
""")),
        "/signin": (html, page("Sign in", """
<h1>Sign in</h1>
<form onsubmit="event.preventDefault()">
  <label>Email <input id="email" type="email" autocomplete="username"></label>
  <label>Password <input id="password" type="password" autocomplete="current-password" value="hunter2"></label>
  <button>Sign in</button>
</form>
""")),
        "/frames": (html, page("Frames", f"""
<h1>Frames</h1>
<p id="said">nothing yet</p>
<iframe id="same" src="/inner?same" style="width:400px;height:120px"></iframe>
<iframe id="away" src="{other}/inner?away" style="width:400px;height:120px"></iframe>
<script>addEventListener('message', (e) => {{ document.getElementById('said').textContent = String(e.data) }})</script>
""")),
        "/inner": (html, page("Inner", """
<button id="inner" onclick="this.textContent = 'pressed'; parent.postMessage('inner pressed ' + location.search, '*')">Inner button</button>
""", "background:#ff00ff")),
        "/dialogs": (html, page("Dialogs", """
<h1>Dialogs</h1>
<button id="alert" onclick="alert('hello from the page'); window.alerted = true">Alert</button>
<button id="confirm" onclick="window.confirmed = confirm('Delete this?')">Confirm</button>
<button id="prompt" onclick="window.prompted = prompt('Your name?', 'x')">Prompt</button>
<button id="arm" onclick="window.addEventListener('beforeunload', (e) => { e.preventDefault(); e.returnValue = '' }); this.textContent = 'armed'">Arm</button>
<button id="print" onclick="window.printed = String(window.print())">Print</button>
""")),
        "/popup": (html, page("Popup", """
<h1>Popup</h1>
<button id="open" onclick="window.child = window.open('/child', 'child', 'width=420,height=320')">Sign in with a popup</button>
<p id="got">nothing yet</p>
<script>addEventListener('message', (e) => { document.getElementById('got').textContent = 'got ' + e.data })</script>
""")),
        "/child": (html, page("Child", """
<h1>Child</h1>
<script>setTimeout(() => { if (window.opener) window.opener.postMessage('token-123', '*'); document.title = 'Child done' }, 200)</script>
""")),
        "/keys": (html, page("Keys", """
<form id="form" onsubmit="event.preventDefault(); document.getElementById('sent').textContent = 'sent ' + document.getElementById('box').value">
  <input id="box" aria-label="Box">
</form>
<p id="sent"></p>
<script>window.keys = []; addEventListener('keydown', (e) => window.keys.push([e.key, e.isTrusted]))</script>
""")),
        "/more": (html, page("More", """
<h1>More</h1>
<div id="hover" style="width:200px;height:40px;background:#fff" onmouseover="window.hovered = true">Hover me</div>
<div id="drag" draggable="true" style="width:120px;height:40px;background:#ccc" ondragstart="event.dataTransfer.setData('text/plain', 'the card')">Card</div>
<div id="drop" style="width:200px;height:80px;background:#eee" ondragover="event.preventDefault()" ondrop="event.preventDefault(); window.dropped = event.dataTransfer.getData('text/plain')">Drop here</div>
<input id="hidden-file" type="file" style="display:none" onchange="window.chosen = this.files[0] && this.files[0].name">
<button id="choose" onclick="document.getElementById('hidden-file').click()">Attach a file</button>
<button id="where" onclick="navigator.geolocation.getCurrentPosition(() => { window.located = 'yes' }, (e) => { window.located = 'refused ' + e.code })">Where am I</button>
<button id="slow" onclick="fetch('/slow').then(r => r.text()).then(t => { document.getElementById('late').textContent = t })">Fetch slowly</button>
<p id="late"></p>
<div style="height:3000px"></div>
<p id="bottom">The bottom</p>
""")),
        "/other": (html, page("Other", "<h1>Terms</h1>")),
        "/meter": (html, page("Meter", "<h1>Meter</h1>")),
        "/user": (html, page("User page", "<h1>User page</h1><button id='mine' onclick=\"this.textContent='pressed'\">Mine</button>", "background:#00c000")),
        "/api/cart": ("application/json", '{"items": 1}'),
    }


def free_port(skip: int = 0) -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        if port == skip:
            continue
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int, other: str) -> None:
    served = pages(other)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            if path == "/slow":
                time.sleep(1.2)
            if path == "/auth":
                self.send_response(401)
                self.send_header("www-authenticate", 'Basic realm="probe"')
                self.send_header("content-length", "0")
                self.end_headers()
                return
            if path == "/file.bin":
                body = b"nib agent download " * 64
                self.send_response(200)
                self.send_header("content-type", "application/octet-stream")
                self.send_header("content-disposition", 'attachment; filename="invoice.bin"')
            else:
                kind, text = served.get(path, ("text/html", "<title>Nothing</title>"))
                body = text.encode("utf-8")
                self.send_response(200)
                self.send_header("content-type", kind)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()


def space(port: int) -> tuple[pathlib.Path, pathlib.Path]:
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-agent-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(root / "spaces")
    os.environ["NIB_DOWNLOADS_DIR"] = str(root / "downloads")
    (root / "downloads").mkdir()
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    made = root / "spaces" / SPACE
    made.mkdir(parents=True)
    (made / "Idea.md").write_text("# Idea\n\nA note to open the space on.\n", encoding="utf-8")
    (made / "receipt.txt").write_text("a receipt\n", encoding="utf-8")
    (made / "User.url").write_text(
        f"[InternetShortcut]\r\nURL=http://127.0.0.1:{port}/user\r\nTitle=User\r\n", encoding="utf-8"
    )
    return made, root / "downloads"


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


class Endpoint:
    """The app's endpoint, called the way `nib mcp` calls it."""

    def __init__(self, port: int, bearer: str) -> None:
        self.port = port
        self.bearer = bearer

    def raw(self, verb: str, args: dict[str, object], seconds: float = 150) -> tuple[object, float]:
        body = json.dumps({"verb": verb, "args": args}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.bearer}", "content-type": "application/json"},
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(request, timeout=seconds) as answer:
                said = json.loads(answer.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as refused:
            said = {"status": "http", "code": refused.code, "message": refused.read().decode("utf-8", "replace")}
        except Exception as error:  # noqa: BLE001 - a wedged app fails in its own ways
            said = {"status": "no answer", "message": str(error)}
        return said, round((time.perf_counter() - started) * 1000, 1)

    def call(self, verb: str, **args: object) -> dict[str, object]:
        said, ms = self.raw(verb, args)
        out = said if isinstance(said, dict) else {"value": said}
        out["ms"] = ms
        return out

    def window(self, code: str) -> object:
        """Runs code in the app's own window through `eval`: the window's half of what the
        reader does - answering a question, pressing the stop."""

        said, _ = self.raw("eval", {"code": code, "yes": True}, 90)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value


# ---- what the operating system says: the engines, and the window itself ----
#
# The window in front, the app thread's focus and the watch over every engine process are
# scripts/probe_app.py's, which every probe shares.

user32 = ctypes.WinDLL("user32", use_last_error=True)


def engine_memory(pid: int) -> dict[str, float]:
    import psutil

    total = 0
    count = 0
    for one in family(pid) - {pid}:
        try:
            total += psutil.Process(one).memory_info().rss
        except psutil.Error:
            continue
        count += 1
    return {"processes": count, "working set MB": round(total / 2**20, 1)}


def photograph(pid: int, out: pathlib.Path) -> dict[str, object]:
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
    for r, g, b in picture.getdata():
        if r > 230 and g < 40 and b > 230:
            magenta += 1
        elif r < 40 and 170 < g < 210 and b < 40:
            green += 1
    return {"size": picture.size, "agent (magenta) pixels": magenta, "reader page (green) pixels": green}


def png_of(said: dict[str, object]) -> tuple[int, int] | None:
    result = said.get("result")
    if not isinstance(result, dict) or not isinstance(result.get("png"), str):
        return None
    from PIL import Image

    picture = Image.open(io.BytesIO(base64.b64decode(result["png"])))
    return picture.size


def ref_of(snapshot: dict[str, object], role: str, name: str) -> str | None:
    """The ref of the first line with that role and name in a snapshot's text."""

    text = str((snapshot.get("result") or {}).get("text", "")) if isinstance(snapshot.get("result"), dict) else ""
    for line in text.splitlines():
        line = line.strip()
        if line.startswith(f"- {role} \"{name}") and "[ref=" in line:
            return line.split("[ref=")[1].split("]")[0]
    return None


def result(said: dict[str, object]) -> dict[str, object]:
    got = said.get("result")
    return got if isinstance(got, dict) else {}


def rates(before: object, after: object) -> dict[str, object]:
    if not isinstance(before, dict) or not isinstance(after, dict) or "raf" not in before:
        return {"error": {"before": before, "after": after}}
    seconds = (float(after["at"]) - float(before["at"])) / 1000
    return {
        "rAF per s": round((float(after["raf"]) - float(before["raf"])) / seconds, 1),
        "10 ms interval per s": round((float(after["ticks"]) - float(before["ticks"])) / seconds, 1),
        "visibilityState": after["state"],
    }


def pair(cli: "Endpoint", check: "Checks", said: dict[str, object]) -> str:
    """A client becomes an agent, the reader answering in the window; its token."""

    asked = cli.call("agent_pair", client="Probe Agent")
    said["pair asked"] = asked
    check.that("pairing asks", asked.get("status") == "needs_approval", asked)
    answered = cli.window(f"window.__TAURI_INTERNALS__.invoke('agents_answer', {{ id: {json.dumps(asked.get('approval'))}, allow: true, always: false }})")
    said["pair answered"] = answered
    paired = cli.call("agent_pair", client="Probe Agent")
    token = str(result(paired).get("token", ""))
    check.that("pairing answers a token once allowed", len(token) == 64, paired)
    return token


class Checks:
    def __init__(self) -> None:
        self.failed: list[str] = []

    def that(self, name: str, ok: bool, said: object = None) -> bool:
        if not ok:
            self.failed.append(f"{name}: {json.dumps(said, default=str)[:600]}")
        return ok


def main() -> int:  # noqa: PLR0915 - one run, step by step
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    parsed.add_argument("--out", type=pathlib.Path, default=pathlib.Path(tempfile.gettempdir()))
    parsed.add_argument("--host", action="store_true", help="also measure agent tabs in a hidden and a minimised window")
    parsed.add_argument("--chromium", action="store_true", help="the build is nib's own Chromium: pair first, measure in the next launch")
    args = parsed.parse_args()

    wipe(args.identifier)
    port = free_port()
    other_port = free_port(skip=port)
    site = f"http://127.0.0.1:{port}"
    other = f"http://localhost:{other_port}"
    serve(port, other)
    serve(other_port, other)
    made, downloads = space(port)
    args.out.mkdir(parents=True, exist_ok=True)

    said: dict[str, object] = {}
    check = Checks()
    running = None
    try:
        running = run_probe(args.exe, quiet=True)
        first_port, _, _ = endpoint(args.identifier)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not main_window(running.pid):
            time.sleep(0.2)
        time.sleep(1.5)
        close_app(running)
        allow_eval(args.identifier)
        time.sleep(1)

        token = ""
        if args.chromium:
            running = run_probe(args.exe, quiet=True)
            paired_port, secret, _ = endpoint(args.identifier, unlike=first_port)
            until = time.perf_counter() + 90
            while time.perf_counter() < until and not main_window(running.pid):
                time.sleep(0.2)
            time.sleep(2)
            token = pair(Endpoint(paired_port, secret), check, said)
            close_app(running)
            first_port = paired_port
            time.sleep(1)

        running = run_probe(args.exe, quiet=True)
        port_now, secret, pid = endpoint(args.identifier, unlike=first_port)
        if pid and pid != running.pid:
            raise SystemExit(f"another nib (pid {pid}) is listening under {args.identifier}")
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not main_window(running.pid):
            time.sleep(0.2)
        time.sleep(2)
        cli = Endpoint(port_now, secret)
        cli.raw("open", {"path": "Idea.md", "space": SPACE})
        time.sleep(1.5)

        # The reader's own web tab, visible, green.
        opened = cli.window(f"""(async () => {{
  const ws = nib.workspace
  ws.openWeb({json.dumps(str(made / 'User.url'))})
  await new Promise((go) => setTimeout(go, 2500))
  return {{ tab: ws.activeTabId }}
}})()""")
        reader_tab = opened.get("tab") if isinstance(opened, dict) else None
        said["reader tab"] = opened
        time.sleep(1)
        before = keyboard(running.pid)
        said["keyboard before"] = before
        said["engine memory before"] = engine_memory(running.pid)
        check.that("nothing ours in front before", not before["front is ours"], before)

        def unmoved(step: str) -> None:
            now = keyboard(running.pid)
            check.that(f"{step}: window in front unchanged", now["front"] == before["front"] and not now["front is ours"], now)
            check.that(f"{step}: app focus unchanged", now["app thread focus"] == before["app thread focus"], now)

        if not token:
            token = pair(cli, check, said)
        agent = Endpoint(port_now, token)
        status = agent.call("agent_status")
        said["agent status"] = {"status": status.get("status"), "scopes": result(status).get("grant", {}).get("scopes")}
        check.that("an agent's token is its own", status.get("status") == "ok", status)
        evaluated, _ = agent.raw("eval", {"code": "1", "yes": True})
        check.that("an agent never reaches eval", isinstance(evaluated, dict) and evaluated.get("code") == 403, evaluated)
        written, _ = agent.raw("files.write", {"path": "x.md", "content": "x", "yes": True})
        check.that("an agent never reaches the command line's own verbs", isinstance(written, dict) and written.get("code") == 403, written)

        # ---- an agent tab, out of sight, running at full speed ----
        meter = cli.call("browser_open", url=f"{site}/meter")
        said["open"] = meter
        tab = str(result(meter).get("tab", ""))
        check.that("browser_open answers a tab", tab.startswith("a"), meter)
        said["wait load"] = cli.call("browser_wait", tab=tab, **{"for": "load"})
        first = result(cli.call("browser_evaluate", tab=tab, expression="window.m()", world="page")).get("value")
        time.sleep(4)
        second = result(cli.call("browser_evaluate", tab=tab, expression="window.m()", world="page")).get("value")
        said["agent tab rates"] = rates(first, second)
        check.that("agent tab not throttled", isinstance(said["agent tab rates"], dict) and said["agent tab rates"].get("rAF per s", 0) > 50, said["agent tab rates"])
        unmoved("open")
        if reader_tab:
            # The reader's own page, beside it: an agent's page costs it nothing.
            mine = cli.call("browser_navigate", tab=reader_tab, url=f"{site}/meter")
            first = result(cli.call("browser_evaluate", tab=reader_tab, expression="window.m()", world="page")).get("value")
            time.sleep(4)
            second = result(cli.call("browser_evaluate", tab=reader_tab, expression="window.m()", world="page")).get("value")
            said["reader tab rates"] = {"navigate": mine.get("status"), **rates(first, second)}
            cli.call("browser_navigate", tab=reader_tab, url=f"{site}/user")
            unmoved("the reader's tab measured")

        # ---- the twin: the reader's logins, and nothing of the agent's back ----
        if reader_tab:
            cli.call("browser_evaluate", tab=reader_tab, world="page", expression="document.cookie = 'reader=1; max-age=3600; path=/'")
            twin = cli.call("browser_open", url=f"{site}/meter")
            twin_tab = str(result(twin).get("tab", ""))
            cli.call("browser_wait", tab=twin_tab, **{"for": "load"})
            seen = result(cli.call("browser_evaluate", tab=twin_tab, world="page", expression="document.cookie")).get("value")
            cli.call("browser_evaluate", tab=twin_tab, world="page", expression="document.cookie = 'agent=1; max-age=3600; path=/'")
            back = result(cli.call("browser_evaluate", tab=reader_tab, world="page", expression="document.cookie")).get("value")
            said["twin"] = {"store": result(twin).get("store"), "twin sees": seen, "reader sees": back, "ms": twin.get("ms")}
            check.that("the twin has the reader's cookie", "reader=1" in str(seen), said["twin"])
            check.that("the agent's cookie never reaches the reader", "agent=1" not in str(back), said["twin"])
            cli.call("browser_close", tab=twin_tab)
            unmoved("the twin")

        if args.host:
            # Where agent tabs could live instead: a window nobody ever sees. Measured by
            # hiding the window they are in (never activating it, never on a screen), and
            # minimising it, then putting it back as it was.
            hwnd = main_window(running.pid)
            host = {}
            for how, show in (("hidden", 0), ("minimised", 7)):
                user32.ShowWindow(hwnd, show)
                time.sleep(1.5)
                first = result(cli.call("browser_evaluate", tab=tab, expression="window.m()", world="page")).get("value")
                time.sleep(4)
                second = result(cli.call("browser_evaluate", tab=tab, expression="window.m()", world="page")).get("value")
                shot = cli.call("browser_screenshot", tab=tab)
                host[how] = {"rates": rates(first, second), "screenshot": [png_of(shot), shot.get("ms")]}
                user32.ShowWindow(hwnd, 4)
                time.sleep(1.5)
            said["host window"] = host
            # Hiding a window hands its thread's focus from the page to the window itself;
            # that is this measurement's doing, not an agent's, so what follows is held to
            # the window as it now is.
            before.update(keyboard(running.pid))
            said["keyboard after the host window"] = dict(before)

        # ---- the shop: snapshot, find, fill, select, date, checkbox, file, press ----
        shop = cli.call("browser_navigate", tab=tab, url=f"{site}/shop")
        said["navigate"] = shop
        snap = cli.call("browser_snapshot", tab=tab)
        said["snapshot"] = {"ms": snap.get("ms"), "chars": len(str(result(snap).get("text", ""))), "untrusted": snap.get("untrusted"),
                            "text": str(result(snap).get("text", ""))[:1500]}
        check.that("a snapshot says where it came from", snap.get("untrusted", "").startswith(site), snap.get("untrusted"))
        name = ref_of(snap, "textbox", "Name")
        quantity = ref_of(snap, "combobox", "Quantity")
        when = ref_of(snap, "textbox", "Delivery") or ref_of(snap, "date", "Delivery")
        gift = ref_of(snap, "checkbox", "Gift wrap")
        receipt = ref_of(snap, "button", "Receipt")
        place = ref_of(snap, "button", "Place order")
        said["refs"] = {"name": name, "quantity": quantity, "when": when, "gift": gift, "receipt": receipt, "place": place}
        found = cli.call("browser_find", tab=tab, role="button", name="place")
        said["find"] = found
        check.that("find finds the button", any(one.get("ref") == place for one in result(found).get("matches", [])), found)

        said["type"] = cli.call("browser_type", tab=tab, ref=name, text="Ada Lovelace")
        said["select"] = cli.call("browser_select", tab=tab, ref=quantity, values=["Two"])
        said["type a date"] = cli.call("browser_type", tab=tab, ref=when, text="2026-10-01")
        said["click the checkbox"] = cli.call("browser_click", tab=tab, ref=gift)
        said["fill form"] = cli.call("browser_fill_form", tab=tab, fields=[{"ref": name, "value": "Grace Hopper"}, {"ref": quantity, "value": "3"}, {"ref": gift, "value": False}])
        said["select refused as a press"] = cli.call("browser_click", tab=tab, ref=quantity)
        check.that("a <select> is never pressed open", said["select refused as a press"].get("code") == "bad_arguments", said["select refused as a press"])
        receipt_file = str(made / "receipt.txt")
        said["upload"] = cli.call("browser_upload", tab=tab, ref=receipt, files=[receipt_file])
        values = result(cli.call("browser_evaluate", tab=tab, world="page", expression="(() => { const at = (id) => document.getElementById(id); return { name: at('name').value, quantity: at('quantity').value, when: at('when').value, gift: at('gift').checked, receipt: at('receipt').files[0] && at('receipt').files[0].name } })()")).get("value")
        said["form values"] = values
        check.that("the form took every value", values == {"name": "Grace Hopper", "quantity": "3", "when": "2026-10-01", "gift": False, "receipt": "receipt.txt"}, values)
        unmoved("the shop")

        # ---- keys pressed inside an agent's page, with the keyboard watched around each ----
        cli.call("browser_navigate", tab=tab, url=f"{site}/keys")
        keys_snap = cli.call("browser_snapshot", tab=tab)
        box = ref_of(keys_snap, "textbox", "Box")
        cli.call("browser_click", tab=tab, ref=box)
        presses = {}
        for key in ["a", "Shift+B", "Backspace", "c", "Enter"]:
            presses[key] = cli.call("browser_press", tab=tab, keys=key)
            unmoved(f"press {key}")
        keyed = result(cli.call("browser_evaluate", tab=tab, world="page", expression="({ keys: window.keys, sent: document.getElementById('sent').textContent })")).get("value")
        said["keys"] = {"ms": {k: v.get("ms") for k, v in presses.items()}, "page": keyed}
        check.that("keys arrive trusted and Enter submits", isinstance(keyed, dict) and keyed.get("sent") == "sent ac" and all(one[1] for one in keyed.get("keys", [])), keyed)

        # ---- dialogs, held for the agent ----
        cli.call("browser_navigate", tab=tab, url=f"{site}/dialogs")
        dsnap = cli.call("browser_snapshot", tab=tab)
        dialogs = {}
        for button, accept, text in [("Alert", True, None), ("Confirm", False, None), ("Prompt", True, "Ada")]:
            pressed = cli.call("browser_click", tab=tab, ref=ref_of(dsnap, "button", button))
            held = pressed.get("dialog") or cli.call("browser_tabs").get("dialog")
            answer = {"tab": tab, "accept": accept}
            if text:
                answer["text"] = text
            dialogs[button] = {"held": held, "click ms": pressed.get("ms"), "answer": cli.call("browser_dialog", **answer)}
        cli.call("browser_click", tab=tab, ref=ref_of(dsnap, "button", "Arm"))
        leaving = cli.call("browser_navigate", tab=tab, url=f"{site}/other")
        dialogs["beforeunload"] = {"held": leaving.get("dialog"), "answer": cli.call("browser_dialog", tab=tab, accept=False)}
        cli.call("browser_click", tab=tab, ref=ref_of(dsnap, "button", "Print"))
        page_side = result(cli.call("browser_evaluate", tab=tab, world="page", expression="({ alerted: window.alerted, confirmed: window.confirmed, prompted: window.prompted, printed: window.printed, alertNative: String(window.alert).includes('[native code]'), confirmNative: String(window.confirm).includes('[native code]') })")).get("value")
        dialogs["page"] = page_side
        said["dialogs"] = dialogs
        for button in ("Alert", "Confirm", "Prompt"):
            check.that(f"{button} reaches the agent", isinstance(dialogs[button]["held"], dict), dialogs[button])
        check.that("beforeunload reaches the agent", isinstance(dialogs["beforeunload"]["held"], dict), dialogs["beforeunload"])
        check.that("print does nothing", isinstance(page_side, dict) and page_side.get("printed") == "undefined", page_side)
        unmoved("dialogs")
        # Leaving for good this time: the page asks again, and is told yes.
        again = cli.call("browser_navigate", tab=tab, url=f"{site}/meter")
        dialogs["leave"] = {"held": again.get("dialog"), "answer": cli.call("browser_dialog", tab=tab, accept=True)}
        cli.call("browser_wait", tab=tab, **{"for": {"url": "/meter"}, "timeout_ms": 5000})

        # ---- a popup that posts to its opener: another agent tab, opener kept ----
        cli.call("browser_navigate", tab=tab, url=f"{site}/popup")
        psnap = cli.call("browser_snapshot", tab=tab)
        popped = cli.call("browser_click", tab=tab, ref=ref_of(psnap, "button", "Sign in with a popup"))
        waited = cli.call("browser_wait", tab=tab, **{"for": {"text": "got token-123"}, "timeout_ms": 8000})
        said["popup"] = {"click": popped, "wait": waited, "tabs": result(cli.call("browser_tabs")).get("agent")}
        check.that("a popup is an agent tab with its opener", bool(result(popped).get("opened")) and waited.get("status") == "ok", said["popup"])
        unmoved("popup")

        # ---- a download, into the agent's own folder ----
        cli.call("browser_navigate", tab=tab, url=f"{site}/shop")
        ssnap = cli.call("browser_snapshot", tab=tab)
        cli.call("browser_click", tab=tab, ref=ref_of(ssnap, "link", "Invoice"))
        time.sleep(2)
        got = cli.call("browser_downloads")
        said["downloads"] = got
        files = [str(p.relative_to(downloads)) for p in downloads.rglob("*") if p.is_file()]
        said["downloaded files"] = files
        check.that("the download is in Downloads/nib agents/<agent>", any(f.startswith("nib agents") for f in files), files)
        unmoved("download")

        # ---- a frame from another origin, in a process of its own ----
        cli.call("browser_navigate", tab=tab, url=f"{site}/frames")
        time.sleep(1)
        fsnap = cli.call("browser_snapshot", tab=tab)
        text = str(result(fsnap).get("text", ""))
        away = [line for line in text.splitlines() if "Inner button" in line and "[ref=f" in line]
        said["frames"] = {"lines": [line.strip() for line in text.splitlines() if "Inner" in line or "iframe" in line]}
        if away:
            inner = away[0].split("[ref=")[1].split("]")[0]
            said["frames"]["click"] = cli.call("browser_click", tab=tab, ref=inner)
            said["frames"]["page"] = result(cli.call("browser_evaluate", tab=tab, world="page", expression="document.getElementById('said').textContent")).get("value")
        check.that("a frame from another origin has f-refs and is pressed", bool(away) and "away" in str(said["frames"].get("page")), said["frames"])

        # ---- screenshots, console, network, read, storage ----
        cli.call("browser_navigate", tab=tab, url=f"{site}/shop")
        view = cli.call("browser_screenshot", tab=tab)
        whole = cli.call("browser_screenshot", tab=tab, full_page=True)
        one = cli.call("browser_screenshot", tab=tab, ref=ref_of(cli.call("browser_snapshot", tab=tab), "button", "Place order"))
        said["screenshots"] = {"viewport": [png_of(view), view.get("ms")], "full": [png_of(whole), whole.get("ms")], "element": [png_of(one), one.get("ms")]}
        check.that("a viewport screenshot is 1280 wide in CSS pixels", (png_of(view) or (0, 0))[0] == 1280, said["screenshots"])
        said["console"] = cli.call("browser_console", tab=tab)
        said["network"] = {"rows": len(result(cli.call("browser_network", tab=tab)).get("requests", [])), "ms": cli.call("browser_network", tab=tab, match="/api/cart").get("ms")}
        for shape in ("text", "markdown", "article"):
            read = cli.call("browser_read", tab=tab, **{"as": shape})
            said[f"read {shape}"] = {"ms": read.get("ms"), "chars": len(str(result(read).get("text", ""))), "start": str(result(read).get("text", ""))[:120]}
        own = cli.call("browser_open", url=f"{site}/meter", store="agent")
        own_tab = str(result(own).get("tab", ""))
        said["storage"] = {
            "set": cli.call("browser_storage", tab=own_tab, op="set_cookie", cookie={"name": "probe", "value": "1"}),
            "cookies": cli.call("browser_storage", tab=own_tab, op="cookies"),
            "local": cli.call("browser_storage", tab=own_tab, op="local"),
            "clear": cli.call("browser_storage", tab=own_tab, op="clear"),
        }

        # ---- the rest of the verbs: hover, drag, scroll, waits, the chooser, permissions ----
        cli.call("browser_navigate", tab=tab, url=f"{site}/more")
        msnap = cli.call("browser_snapshot", tab=tab)
        mtext = str(result(msnap).get("text", ""))
        def ref_named(words: str) -> str | None:
            for line in mtext.splitlines():
                if words in line and "[ref=" in line:
                    return line.split("[ref=")[1].split("]")[0]
            return None
        found_text = cli.call("browser_find", tab=tab, text="drop here")
        more = {
            "find by text": found_text,
            "hover": cli.call("browser_hover", tab=tab, ref=ref_named("Hover me")),
            "drag": cli.call("browser_drag", tab=tab, **{"from": ref_named("Card"), "to": ref_named("Drop here")}),
            "scroll by": cli.call("browser_scroll", tab=tab, dy=1200),
            "scrolled by": result(cli.call("browser_evaluate", tab=tab, expression="Math.round(scrollY)")).get("value"),
            "scroll to": cli.call("browser_scroll", tab=tab, ref=ref_named("The bottom")),
            "scrolled to": result(cli.call("browser_evaluate", tab=tab, expression="Math.round(scrollY)")).get("value"),
            "chooser": cli.call("browser_upload", tab=tab, ref=ref_named("Attach a file"), files=[receipt_file]),
            "permission": cli.call("browser_click", tab=tab, ref=ref_named("Where am I")),
            "wait ref": cli.call("browser_wait", tab=tab, **{"for": {"ref": ref_named("Drop here")}}),
        }
        cli.call("browser_click", tab=tab, ref=ref_named("Fetch slowly"))
        more["wait network idle"] = cli.call("browser_wait", tab=tab, **{"for": "network_idle", "timeout_ms": 8000})
        more["page"] = result(cli.call("browser_evaluate", tab=tab, world="page", expression="({ hovered: window.hovered, dropped: window.dropped, scrolled: Math.round(scrollY), chosen: window.chosen, located: window.located, late: document.getElementById('late').textContent })")).get("value")
        more["isolated world"] = result(cli.call("browser_evaluate", tab=tab, expression="typeof window.m")).get("value")
        more["page world"] = result(cli.call("browser_evaluate", tab=tab, world="page", expression="typeof window.m")).get("value")
        more["bodies"] = [row.get("body", "")[:40] for row in result(cli.call("browser_network", tab=tab, match="/slow", bodies=True)).get("requests", [])]
        more["console"] = [line.get("text") for line in result(cli.call("browser_console", tab=tab, level="warning")).get("lines", [])]
        more["to basic auth"] = cli.call("browser_navigate", tab=tab, url=f"{site}/auth")
        time.sleep(0.5)
        lines_now = result(cli.call("browser_console", tab=tab)).get("lines", [])
        more["basic auth"] = [line.get("text") for line in lines_now if "sign-in" in str(line.get("text"))]
        more["console after auth"] = [line.get("text") for line in lines_now][-6:]
        said["more"] = more
        page_now = more["page"] if isinstance(more["page"], dict) else {}
        check.that("hover reaches the page", page_now.get("hovered") is True, more)
        check.that("a drag drops, through the engine's intercepted drag", page_now.get("dropped") == "the card", more)
        check.that("a scroll scrolls, by an amount and to an element", (more["scrolled by"] or 0) >= 1000 and (more["scrolled to"] or 0) > (more["scrolled by"] or 0), more)
        check.that("a chooser a press opens is answered, never shown", page_now.get("chosen") == "receipt.txt", more)
        check.that("a permission is refused, never asked", str(page_now.get("located", "")).startswith("refused"), more)
        check.that("network idle waits for the slow request", page_now.get("late") not in (None, ""), more)
        check.that("scripts run in nib's own world by default", more["isolated world"] == "undefined" and more["page world"] == "function", more)
        check.that("basic authentication is refused and said", bool(more["basic auth"]), more)
        unmoved("the rest of the verbs")

        # ---- the agent's grant and the policy, recognised from the page ----
        atab = str(result(agent.call("browser_open", url=f"{site}/shop")).get("tab", ""))
        asnap = agent.call("browser_snapshot", tab=atab)
        paying = agent.call("browser_click", tab=atab, ref=ref_of(asnap, "button", "Place order"))
        said["paying asks"] = paying
        check.that("Place order asks first", paying.get("status") == "needs_approval", paying)
        agent.call("browser_navigate", tab=atab, url=f"{site}/signin")
        isnap = agent.call("browser_snapshot", tab=atab)
        check.that("a password's value is never in a snapshot", "hunter2" not in str(result(isnap).get("text")), result(isnap).get("text"))
        refused = agent.call("browser_type", tab=atab, ref=ref_of(isnap, "textbox", "Email"), text="a@b.c")
        said["sign-in refused"] = refused
        check.that("a sign-in is never typed", refused.get("code") == "password_field", refused)
        scripted = agent.call("browser_evaluate", tab=atab, expression="1")
        check.that("scripts need browser.script", scripted.get("code") == "not_granted", scripted)
        foreign = agent.call("browser_snapshot", tab=tab)
        check.that("another agent's tab does not exist to it", foreign.get("code") == "no_such_tab", foreign)
        shown = agent.call("browser_show", tab=atab)
        check.that("showing an agent tab asks", shown.get("status") == "needs_approval", shown)
        taken = agent.call("browser_takeover", tab=atab, reason="Sign in to the probe")
        meanwhile = agent.call("browser_snapshot", tab=atab)
        cli.window(f"window.__TAURI_INTERNALS__.invoke('agents_answer', {{ id: {json.dumps(taken.get('approval'))}, allow: true, always: false }})")
        handed = agent.call("browser_snapshot", tab=atab)
        state = cli.window("window.__TAURI_INTERNALS__.invoke('agents_state')")
        said["show and takeover"] = {"show": shown, "takeover": taken, "while asked": meanwhile.get("status"), "after": handed.get("status"),
                                     "state": {k: (len(v) if isinstance(v, list) else v) for k, v in state.items()} if isinstance(state, dict) else state}
        check.that("a takeover asks and the tab stays the agent's all the while", taken.get("status") == "needs_approval" and meanwhile.get("status") == "ok" and handed.get("status") == "ok", said["show and takeover"])

        # ---- the reader's own tab: the agent's presses never take the keyboard ----
        if reader_tab:
            rsnap = agent.call("browser_snapshot", tab=reader_tab)
            pressed = agent.call("browser_click", tab=reader_tab, ref=ref_of(rsnap, "button", "Mine"))
            time.sleep(0.5)
            after = agent.call("agent_status")
            said["reader tab"] = {"snapshot ms": rsnap.get("ms"), "click": pressed, "stopped": result(after).get("stopped")}
            check.that("the agent acts in the reader's tab and is never stopped by it", pressed.get("status") == "ok" and not result(after).get("stopped"), said["reader tab"])
            unmoved("reader tab")

        # ---- the stop ----
        cli.window("window.__TAURI_INTERNALS__.invoke('agents_stop')")
        stopped = agent.call("browser_tabs")
        cli.window("window.__TAURI_INTERNALS__.invoke('agents_resume', {})")
        resumed = agent.call("browser_tabs")
        said["stop"] = {"stopped": stopped.get("code"), "resumed": resumed.get("status")}
        check.that("the stop stops and resumes", stopped.get("code") == "stopped" and resumed.get("status") == "ok", said["stop"])

        # ---- the audit log: every call, one line each, no secret in it ----
        logs = pathlib.Path(os.environ["LOCALAPPDATA"]) / args.identifier / "agents" / "log"
        lines = [json.loads(line) for day in sorted(logs.glob("*.jsonl")) for line in day.read_text(encoding="utf-8").splitlines() if line]
        raw = "\n".join(day.read_text(encoding="utf-8") for day in logs.glob("*.jsonl"))
        said["log"] = {"lines": len(lines), "agents": sorted({one.get("agent") for one in lines}), "verbs": len({one.get("verb") for one in lines})}
        check.that("every call is in the log", len(lines) > 50 and "probe-agent" in said["log"]["agents"], said["log"])
        check.that("no token and no password is in the log", token not in raw and "hunter2" not in raw, said["log"])

        said["engine memory with tabs"] = engine_memory(running.pid)
        said["window picture"] = photograph(running.pid, args.out / "agent-probe-window.png")
        check.that("not one agent pixel in the window", said["window picture"].get("agent (magenta) pixels") == 0, said["window picture"])
        said["keyboard after"] = keyboard(running.pid)
        unmoved("the end")
        for one in result(cli.call("browser_tabs")).get("agent", []):
            cli.call("browser_close", tab=one["id"])
        for one in result(agent.call("browser_tabs")).get("agent", []):
            agent.call("browser_close", tab=one["id"])
        time.sleep(1)
        said["engine memory after close"] = engine_memory(running.pid)
    finally:
        said["failed"] = check.failed
        print(json.dumps(said, indent=2, default=str))
        if running is not None and running.poll() is None:
            if not close_app(running):
                running.kill()

    return 1 if check.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
