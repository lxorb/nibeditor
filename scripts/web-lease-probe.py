"""Two computers, one web login: the lease, handed over and lost, end to end.

docs/sync-v2.md section 12 names this probe. Two probe builds - two identifiers, so two
devices with two device ids, two web stores and two keychains - signed in to one account on
the real Worker under `wrangler dev`, with web logins travelling for that account:

  1. A signs in, makes the web key (the first computer ever does, without a word), opens a
     web note on a loopback site and signs in to the site: a session cookie, a lasting one,
     localStorage.
  2. B signs in and asks for the web key; A shows the bubble with the six digits, B the line
     under its bar with the same six, and Allow on A gives it to B.
  3. B opens the same web note: A is using the site, so B shows the lock surface - the
     site's mark, `Open on A`, `Use here` - and runs nothing of the site.
  4. Use here on B: A captures its latest state, stops its page, uploads it under the fence;
     B restores it and its page loads, signed in with A's cookies. A shows the surface.
  5. Use here on A takes it back. B asks again (a resize makes its pane look) and waits.
  6. A's whole process family is suspended - a lid shut, a machine gone - with its socket
     still open, so no beat arrives and nothing closes: about 30 s later the hub counts A
     gone and B's page comes back by itself.

Every window through `probe_app.run_probe`, off the screen, spaces in temp folders, and the
keys each probe made forgotten at the end. Both builds bake the Worker's address in, so
they are made against `PORT`:

    set VITE_NIB_API=http://127.0.0.1:8797
    pnpm --dir apps/desktop tauri build --no-bundle --debug \\
      --config '{"identifier":"ch.emilvinu.nib.probe.web-lease-a","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    (and again as ...web-lease-b, copied aside between the two)
    python scripts/web-lease-probe.py --a path/to/a/nib.exe --b path/to/b/nib.exe --shots dir

Needs `CLOUDFLARE_API_TOKEN` for wrangler's remote AI binding, as the drives that hold a
socket open do (docs/conventions.md, "Drives").
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import hashlib
import http.server
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

from devtools import Session, debugged, port, targets
from probe_app import close_app, family, main_window, run_probe, sized

HERE = pathlib.Path(__file__).resolve().parent
SERVICE = HERE.parent / "services" / "sync"
PORT = 8797
API = f"http://127.0.0.1:{PORT}"
IDENTIFIERS = {"A": "ch.emilvinu.nib.probe.web-lease-a", "B": "ch.emilvinu.nib.probe.web-lease-b"}
SPACE = "Web lease probe"
SITE_NOTE = "A site I log in to"
NOTE = "Idea"
EMAIL = f"web-lease-probe-{uuid.uuid4().hex[:8]}@example.com"

LOGIN = """<!doctype html><title>Signing in</title><body><p>Signing in...</p></body>
<script>localStorage.setItem('token', 'T1'); location.replace('/app')</script>"""

APP = """<!doctype html><title>App</title>
<body style="margin:0;font:18px system-ui;background:#f4f1ea">
<article style="padding:2rem">
<h1>Signed in as __WHO__</h1>
<p>COOKIES|__COOKIES__|END</p>
<p id="storage">STORAGE|pending|END</p>
<p>This paragraph is here only so the reader keeps the article rather than the body, which
needs a couple of hundred characters of it before it will. It says nothing the lines above
do not, and the probe reads the markers on those lines regardless.</p>
</article></body>
<script>document.getElementById('storage').textContent =
  'STORAGE|token:' + (localStorage.getItem('token') || '') + '|END'</script>"""


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            if path == "/login":
                self.send_response(200)
                self.send_header("set-cookie", "sid=S1; Path=/")
                self.send_header("set-cookie", "pid=P1; Path=/; Max-Age=99999")
                body = LOGIN.encode()
            elif path == "/app":
                self.send_response(200)
                sent = {}
                for pair in (self.headers.get("cookie") or "").split(";"):
                    name, _, value = pair.strip().partition("=")
                    if name:
                        sent[name] = value
                who = "somebody" if sent.get("sid") else "nobody"
                line = "|".join(f"{name}:{sent.get(name, '')}" for name in ("sid", "pid"))
                body = APP.replace("__COOKIES__", line).replace("__WHO__", who).encode()
            else:
                self.send_response(404)
                body = b"no"
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def free_port(start: int) -> int:
    for port in range(start, start + 100):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit("no port free")


def say(words: str) -> None:
    print(f"  {words}", flush=True)


# ---- the Worker ----


def npx(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [shutil.which("npx") or "npx", *args],
        cwd=SERVICE,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def api(path: str, token: str, method: str = "GET", body: object = None) -> object:
    data = None if body is None else json.dumps(body).encode()
    headers = {"authorization": f"Bearer {token}"}
    if data is not None:
        headers["content-type"] = "application/json"
    call = urllib.request.Request(f"{API}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(call, timeout=20) as answer:
        return json.loads(answer.read() or b"null")


class Worker:
    def __init__(self, log: pathlib.Path) -> None:
        self.log = log
        self.process: subprocess.Popen[bytes] | None = None
        self.opened = None

    def start(self) -> None:
        state = SERVICE / ".wrangler" / "state"
        shutil.rmtree(state, ignore_errors=True)
        done = npx("wrangler", "d1", "migrations", "apply", "nib", "--local")
        if done.returncode != 0:
            raise SystemExit(f"the migrations failed:\n{done.stdout}\n{done.stderr}")
        self.opened = self.log.open("wb")
        self.process = subprocess.Popen(
            [
                shutil.which("npx") or "npx",
                "wrangler",
                "dev",
                "--port",
                str(PORT),
                "--ip",
                "127.0.0.1",
                "--show-interactive-dev-session=false",
            ],
            cwd=SERVICE,
            stdout=self.opened,
            stderr=subprocess.STDOUT,
        )
        until = time.monotonic() + 120
        while time.monotonic() < until:
            if self.process.poll() is not None:
                raise SystemExit("the Worker stopped before it answered")
            try:
                with urllib.request.urlopen(f"{API}/health", timeout=5) as answer:
                    if json.loads(answer.read()).get("ok"):
                        return
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError, ValueError):
                time.sleep(1)
        raise SystemExit("the Worker never answered")

    def sql(self, statement: str) -> None:
        # The Worker holds the same database open, and a write can meet it busy: tried
        # again rather than given up on.
        for _ in range(5):
            done = npx("wrangler", "d1", "execute", "nib", "--local", f"--command={statement}")
            if done.returncode == 0:
                return
            time.sleep(2)
        if done.returncode != 0:
            raise SystemExit(f"that query failed:\n{statement}\n{done.stdout}\n{done.stderr}")

    def account(self) -> tuple[str, str]:
        """One account, web logins travelling, with a session for each computer."""

        tokens = [uuid.uuid4().hex + uuid.uuid4().hex for _ in range(2)]
        now = int(time.time() * 1000)
        user = str(uuid.uuid4())
        rows = [
            f"insert into users (id, email, created_at, web_sync) values ('{user}', '{EMAIL}', {now}, 1);"
        ]
        for token in tokens:
            digest = hashlib.sha256(token.encode()).hexdigest()
            rows.append(
                "insert into sessions (id, token_hash, user_id, created_at, expires_at)"
                f" values ('{uuid.uuid4()}', '{digest}', '{user}', {now}, {now + 86_400_000});"
            )
        self.sql("".join(rows))
        return tokens[0], tokens[1]

    def stop(self) -> None:
        if self.process:
            subprocess.run(["taskkill", "/T", "/F", "/PID", str(self.process.pid)], capture_output=True, check=False)
            self.process = None
        if self.opened:
            self.opened.close()


# ---- the two computers ----


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def local_dir(identifier: str) -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / identifier


def wipe(identifier: str) -> None:
    if ".probe." not in identifier:
        raise SystemExit("not a probe identifier: refusing to delete its folders")
    for one in (config_dir(identifier), local_dir(identifier)):
        until = time.perf_counter() + 15
        while one.exists() and time.perf_counter() < until:
            shutil.rmtree(one, ignore_errors=True)
            time.sleep(0.5)


class Computer:
    def __init__(self, label: str, exe: pathlib.Path, token: str, origin: str) -> None:
        self.label = label
        self.exe = exe
        self.token = token
        self.origin = origin
        self.identifier = IDENTIFIERS[label]
        self.spaces = pathlib.Path(tempfile.mkdtemp(prefix=f"nib-web-lease-{label.lower()}-"))
        space = self.spaces / SPACE
        space.mkdir(parents=True)
        (space / f"{NOTE}.md").write_text(f"# {NOTE}\n\nAn ordinary note.\n", encoding="utf-8")
        (space / f"{SITE_NOTE}.url").write_text(
            f"[InternetShortcut]\r\nURL={origin}/app\r\nTitle={SITE_NOTE}\r\n"
            "Nib-Added=2026-09-30T08:00:00.000Z\r\n",
            encoding="utf-8",
        )
        self.process: subprocess.Popen[bytes] | None = None
        self.port = 0
        self.secret = ""
        self.hwnd = 0

    def endpoint(self, unlike: int = 0) -> None:
        path = config_dir(self.identifier) / "automation.json"
        until = time.perf_counter() + 120
        while time.perf_counter() < until:
            try:
                said = json.loads(path.read_text(encoding="utf-8"))
                if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                    self.port, self.secret = int(said["port"]), str(said["secret"])
                    return
            except (OSError, ValueError):
                pass
            time.sleep(0.2)
        raise SystemExit(f"{self.label} never wrote {path}")

    def launch(self) -> None:
        wipe(self.identifier)
        # Each browser process opens a debugging port, which is how the app's own page is
        # photographed: see `shot`.
        env = debugged({**os.environ, "NIB_SPACES_DIR": str(self.spaces)})
        # Once to write the endpoint file, so eval can be turned on in it.
        self.process = run_probe(self.exe, env=env, quiet=True)
        self.endpoint()
        self.process.terminate()
        self.process.wait(timeout=30)
        path = config_dir(self.identifier) / "automation.json"
        said = json.loads(path.read_text(encoding="utf-8"))
        said["eval"] = True
        path.write_text(json.dumps(said), encoding="utf-8")
        time.sleep(1)

        unlike = self.port
        self.process = run_probe(self.exe, env=env, quiet=True)
        self.endpoint(unlike)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not self.hwnd:
            self.hwnd = main_window(self.process.pid)
            time.sleep(0.2)
        if not self.hwnd:
            raise SystemExit(f"{self.label} never showed a window")
        sized(self.hwnd, 1100, 760)
        time.sleep(1.5)

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
        except (urllib.error.URLError, TimeoutError, ConnectionError) as failed:
            return {"ok": False, "error": str(failed)}

    def ask(self, code: str, seconds: float = 60) -> object:
        said = self.act("eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        return said.get("value")

    def invoke(self, command: str, args: dict[str, object] | None = None) -> object:
        code = (
            f"window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args or {})})"
            ".then((value) => ({ value }), (error) => ({ refused: String(error) }))"
        )
        said = self.ask(code)
        return said["value"] if isinstance(said, dict) and "value" in said else said

    def sign_in(self) -> None:
        self.ask(f"localStorage.setItem('nib:session', {json.dumps(self.token)}); location.reload(); true")
        time.sleep(4)

    def device(self) -> dict[str, object]:
        said = api("/v2/devices", self.token)
        for one in said.get("devices", []) if isinstance(said, dict) else []:
            if one.get("current"):
                return one
        return {}

    def open_site(self) -> str:
        self.act("open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(2)
        self.act("open", {"path": f"{SITE_NOTE}.url"})
        return self.wait(
            f"(nib.workspace.tabs.find((one) => one.name.startsWith({json.dumps(SITE_NOTE)})) || {{}}).id || ''",
            f"{self.label} to open the web note",
        )

    def wait(self, code: str, what: str, seconds: float = 60) -> object:
        until = time.perf_counter() + seconds
        while time.perf_counter() < until:
            said = self.ask(code)
            if said and not (isinstance(said, dict) and "error" in said):
                return said
            time.sleep(0.25)
        raise SystemExit(f"gave up waiting for {what}")

    def locked(self) -> str | None:
        said = self.ask(
            "(() => { const one = document.querySelector('.hole .locked'); "
            "return one ? one.textContent.replace(/\\s+/g, ' ').trim() : '' })()"
        )
        return said if isinstance(said, str) and said else None

    def page(self, tab: str) -> dict[str, str]:
        said = self.invoke("web_clip", {"tab": tab, "selection": False})
        html = said.get("html") if isinstance(said, dict) else None
        out: dict[str, str] = {}
        if isinstance(html, str):
            for marker in ("COOKIES", "STORAGE"):
                found = re.search(rf"{marker}\|(.*?)\|END", html)
                for pair in (found[1] if found else "").split("|"):
                    name, _, value = pair.partition(":")
                    if name:
                        out[name] = value
        return out

    def touch(self) -> None:
        """Somebody at this computer, as the app's own page hears it: a key event in the
        page's own document, which is no real key and reaches nothing outside it."""

        self.ask("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); true")

    def press(self, selector: str) -> None:
        self.ask(f"document.querySelector({json.dumps(selector)}).click(); true")

    def shot(self, out: pathlib.Path) -> None:
        """The app's own page, as its engine draws it (`Page.captureScreenshot`), which is
        where the lock surface and the bubble are. A photograph of the window cannot say
        what is in the hole: a web page is a webview of its own, composited by the system,
        and a window's picture holds whatever frame of it the system last kept."""

        at = port(local_dir(self.identifier) / "EBWebView")
        page = next(
            (one for one in (targets(at) if at else []) if str(one.get("url", "")).startswith("http://tauri.localhost")),
            None,
        )
        if page is None:
            return
        session = Session(page)
        try:
            said = session.call("Page.captureScreenshot", {"format": "png"})
            if "data" in said:
                out.write_bytes(base64.b64decode(said["data"]))
        finally:
            session.close()

    def page_shot(self, tab: str, out: pathlib.Path) -> None:
        """A web page, as its engine photographs it (`web_shot`)."""

        said = self.invoke("web_shot", {"tab": tab})
        if isinstance(said, str) and said.startswith("data:image/png;base64,"):
            out.write_bytes(base64.b64decode(said.split(",", 1)[1]))

    def quit(self) -> None:
        if self.process and self.process.poll() is None and not close_app(self.process):
            self.process.kill()
        self.process = None


# ---- suspending a computer, which is a lid shut rather than a crash ----

PROCESS_SUSPEND_RESUME = 0x0800
ntdll = ctypes.WinDLL("ntdll") if sys.platform == "win32" else None
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True) if sys.platform == "win32" else None


def suspended(pids: set[int], suspend: bool) -> None:
    for pid in pids:
        handle = kernel32.OpenProcess(PROCESS_SUSPEND_RESUME, False, pid)
        if not handle:
            continue
        (ntdll.NtSuspendProcess if suspend else ntdll.NtResumeProcess)(handle)
        kernel32.CloseHandle(handle)


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives Windows builds")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--a", required=True, type=pathlib.Path)
    parsed.add_argument("--b", required=True, type=pathlib.Path)
    parsed.add_argument("--shots", required=True, type=pathlib.Path)
    args = parsed.parse_args()
    args.shots.mkdir(parents=True, exist_ok=True)

    site_port = free_port(22500)
    origin = f"http://127.0.0.1:{site_port}"
    serve(site_port)

    worker = Worker(args.shots / "worker.log")
    said: dict[str, object] = {}
    ok = True
    a = b = None
    try:
        say("starting the Worker")
        worker.start()
        token_a, token_b = worker.account()

        a = Computer("A", args.a, token_a, origin)
        b = Computer("B", args.b, token_b, origin)

        say("A signs in and becomes the first computer with the web key")
        a.launch()
        a.sign_in()
        until = time.perf_counter() + 60
        while time.perf_counter() < until and not a.device().get("webKey"):
            time.sleep(0.5)
        said["A holds the web key"] = bool(a.device().get("webKey"))
        api(f"/v2/devices/{a.device().get('id')}", token_a, "PATCH", {"name": "Laptop"})

        tab_a = str(a.open_site())
        time.sleep(3)
        a.invoke("web_navigate", {"tab": tab_a, "url": f"{origin}/login"})
        time.sleep(4)
        said["A signed in to the site"] = a.page(tab_a)

        say("B signs in and asks A for the web key")
        b.launch()
        b.sign_in()
        a.wait("!!document.querySelector('.approve')", "A's approval bubble", 60)
        said["A's bubble"] = a.ask("document.querySelector('.approve').textContent.replace(/\\s+/g, ' ').trim()")
        a.shot(args.shots / "a-approve.png")
        b.wait("!!document.querySelector('.waiting')", "B's waiting line", 30)
        said["B's waiting line"] = b.ask(
            "document.querySelector('.waiting').textContent.replace(/\\s+/g, ' ').trim()"
        )
        b.shot(args.shots / "b-waiting.png")
        b_device = b.device()
        api(f"/v2/devices/{b_device.get('id')}", token_b, "PATCH", {"name": "Desktop"})
        a.press(".approve .nib-button:not(.is-quiet)")
        until = time.perf_counter() + 60
        while time.perf_counter() < until and not b.device().get("webKey"):
            time.sleep(0.5)
        said["B was given the web key"] = bool(b.device().get("webKey"))
        ok = ok and bool(said["A holds the web key"]) and bool(said["B was given the web key"])

        say("B opens the site A is using")
        a.touch()
        tab_b = str(b.open_site())
        b.wait("!!document.querySelector('.hole .locked')", "B's lock surface", 60)
        time.sleep(1)
        said["B's surface"] = b.locked()
        b.shot(args.shots / "b-locked.png")
        said["B ran nothing of the site"] = b.page(tab_b) == {}
        ok = ok and "Use here" in str(said["B's surface"]) and bool(said["B ran nothing of the site"])

        say("Use here on B")
        b.touch()
        started = time.perf_counter()
        b.press(".hole .locked button")
        b.wait("!document.querySelector('.hole .locked')", "B's page to come", 60)
        until = time.perf_counter() + 30
        page_b: dict[str, str] = {}
        while time.perf_counter() < until:
            page_b = b.page(tab_b)
            if page_b.get("sid"):
                break
            time.sleep(0.2)
        said["handover, Use here to B's page signed in, ms"] = round((time.perf_counter() - started) * 1000)
        said["B's page after the handover"] = page_b
        ok = ok and page_b.get("sid") == "S1" and page_b.get("pid") == "P1" and page_b.get("token") == "T1"
        a.wait("!!document.querySelector('.hole .locked')", "A's lock surface", 30)
        time.sleep(1)
        said["A's surface"] = a.locked()
        a.shot(args.shots / "a-locked.png")
        b.page_shot(tab_b, args.shots / "b-page.png")
        ok = ok and "Desktop" in str(said["A's surface"])

        say("Use here on A, and B asks again")
        a.touch()
        started = time.perf_counter()
        a.press(".hole .locked button")
        a.wait("!document.querySelector('.hole .locked')", "A's page to come back", 60)
        said["handover back to A, ms"] = round((time.perf_counter() - started) * 1000)
        b.wait("!!document.querySelector('.hole .locked')", "B's lock surface again", 30)
        # A tab of a site taken away asks again at most every thirty seconds; a look of
        # the pane is what asks, and a resize is a look.
        for _ in range(4):
            time.sleep(8)
            a.touch()
        sized(b.hwnd, 1101, 760)
        time.sleep(2)
        a.touch()
        said["B waits on A"] = b.locked()

        say("A's machine goes away without a word")
        family_a = family(a.process.pid) if a.process else set()
        suspended(family_a, True)
        started = time.perf_counter()
        b.wait("!document.querySelector('.hole .locked')", "B to take the lease", 120)
        said["A gone to B's page back, s"] = round(time.perf_counter() - started, 1)
        said["B's page after A went"] = b.page(tab_b)
        took = float(said["A gone to B's page back, s"])
        ok = ok and 20 <= took <= 60
        suspended(family_a, False)

        said["B forgot its keys"] = b.invoke("web_key_forget")
    finally:
        for one in (b, a):
            if one is not None:
                try:
                    one.quit()
                except Exception:  # noqa: BLE001 - tidying up after anything
                    if one.process:
                        one.process.kill()
        # A's keys, forgotten by A itself.
        if a is not None:
            try:
                a.process = run_probe(a.exe, env={**os.environ, "NIB_SPACES_DIR": str(a.spaces)}, quiet=True)
                a.endpoint(a.port)
                a.wait("1", "A to answer again", 60)
                said["A forgot its keys"] = a.invoke("web_key_forget")
                a.quit()
            except (SystemExit, Exception) as failed:  # noqa: BLE001 - tidying up
                said["A forgot its keys"] = str(failed)
        worker.stop()
        for one in (a, b):
            if one is not None:
                shutil.rmtree(one.spaces, ignore_errors=True)
        # What each computer's log said about the lease, beside what the probe saw.
        for label, identifier in IDENTIFIERS.items():
            path = local_dir(identifier) / "logs" / "nib.log"
            if path.exists():
                said[f"{label}'s log"] = [
                    line.split(" ", 2)[-1]
                    for line in path.read_text("utf-8", errors="replace").splitlines()
                    if "web login" in line or "ERROR" in line
                ]
        print(json.dumps(said, indent=2), flush=True)

    print("\nPASS" if ok else "\nFAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
