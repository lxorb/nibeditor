"""Does a site's login travel to another computer whole: every kind of cookie, the page's
storage and the tab's own, through a sealed bundle?

docs/sync-v2.md section 6 is the design and section 12 names this probe. A loopback site
signs in the way sites do: a session cookie, an `HttpOnly` one, a lasting one and a
partitioned (CHIPS) one, set by the server; a localStorage token, a sessionStorage step of
a wizard, and an IndexedDB database holding a Blob, a Date and a Map, set by the page. Then:

  1. the web key is made, and the key commands answer (a public key, six digits, a lease
     key, a wrap this computer can accept);
  2. `web_state_capture` takes the site out of the store its tab is in, sealed;
  3. the app quits and the store is taken away entirely: what is left is the sealed bundle
     and the keychain, which is what a second computer has once it is approved;
  4. the app starts again on the empty store, and the site is signed out, to prove it;
  5. the bundle is put in a folder `web_state_inbox` hands out (a download, as far as the
     restore can tell), and `web_state_restore` puts it into the store;
  6. the tab opens again, `web_state_session` gives it its sessionStorage back, and the
     page reads every value: the server says which cookies it was sent, the page says
     what its storage holds.

The store keeps its name (the seal binds a bundle to its store and site, so a second
computer is the same store name somewhere new), and that somewhere new is the store's
folder emptied with the app closed.

Launched through `probe_app.run_probe`, off the screen, with the spaces in a temp folder
and the keychain entries under the probe's own identifier (see web_state/keys.rs), which
the probe forgets again at the end.

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.web-state","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/web-state-probe.py --exe path/to/nib.exe
"""

from __future__ import annotations

import argparse
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

from probe_app import close_app, main_window, run_probe, sized

IDENTIFIER = "ch.emilvinu.nib.probe.web-state"
PORT_FROM = 22400
PORT_TO = 22499
SPACE = "Web state probe"
SITE_NOTE = "A site I log in to"
NOTE = "Idea"

# What the login leaves, each a marker read back out of the page.
SIGNED_IN = {
    "sid": "S1",
    "hsid": "H1",
    "pid": "P1",
    "part": "C1",
    "token": "T1",
    "wizard": "W1",
    "blob": "B1",
    "when": "2026-09-30T00:00:00.000Z",
    "map": "M1",
}

LOGIN = """<!doctype html>
<title>Signing in</title>
<body><p>Signing in...</p></body>
<script>
  localStorage.setItem('token', 'T1')
  sessionStorage.setItem('wizard', 'W1')
  const opening = indexedDB.open('probe', 3)
  opening.onupgradeneeded = () => opening.result.createObjectStore('things')
  opening.onsuccess = () => {
    const db = opening.result
    const writing = db.transaction('things', 'readwrite')
    writing.objectStore('things').put({
      blob: new Blob(['B1'], { type: 'text/plain' }),
      when: new Date(Date.UTC(2026, 8, 30)),
      map: new Map([['m', 'M1']]),
    }, 'login')
    writing.oncomplete = () => {
      db.close()
      location.replace('/app')
    }
  }
</script>
"""

# The server says which cookies it was sent, which is the only way to see an HttpOnly or a
# partitioned one; the page says what its storage holds. Both on lines of the article,
# which is what the clipper's reader hands back.
APP = """<!doctype html>
<title>App</title>
<body style="margin:0;font:16px system-ui">
<article style="padding:2rem">
<p>COOKIES|__COOKIES__|END</p>
<p id="storage">STORAGE|pending|END</p>
<p>This paragraph is here only so the reader keeps the article rather than the body, which
needs a couple of hundred characters of it before it will. It says nothing the lines above
do not, and the probe reads the markers on those lines regardless.</p>
</article>
</body>
<script>
  async function read() {
    const said = { token: localStorage.getItem('token') || '',
      wizard: sessionStorage.getItem('wizard') || '', blob: '', when: '', map: '' }
    try {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('probe')
        request.onupgradeneeded = () => request.transaction.abort()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      if (db.objectStoreNames.contains('things')) {
        const value = await new Promise((resolve, reject) => {
          const request = db.transaction('things').objectStore('things').get('login')
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        if (value) {
          said.blob = value.blob instanceof Blob ? await value.blob.text() : ''
          said.when = value.when instanceof Date ? value.when.toISOString() : ''
          said.map = value.map instanceof Map ? value.map.get('m') : ''
        }
      }
      db.close()
    } catch (error) {}
    document.getElementById('storage').textContent = 'STORAGE|' +
      Object.entries(said).map(([key, value]) => key + ':' + value).join('|') + '|END'
  }
  read()
</script>
"""


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True


def serve(port: int) -> Server:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            if path == "/login":
                self.send_response(200)
                self.send_header("set-cookie", "sid=S1; Path=/")
                self.send_header("set-cookie", "hsid=H1; Path=/; HttpOnly")
                self.send_header("set-cookie", "pid=P1; Path=/; Max-Age=99999")
                self.send_header("set-cookie", "part=C1; Path=/; Secure; SameSite=None; Partitioned")
                body = LOGIN.encode()
            elif path == "/app":
                self.send_response(200)
                sent = {}
                for pair in (self.headers.get("cookie") or "").split(";"):
                    name, _, value = pair.strip().partition("=")
                    if name:
                        sent[name] = value
                line = "|".join(f"{name}:{sent.get(name, '')}" for name in ("sid", "hsid", "pid", "part"))
                body = APP.replace("__COOKIES__", line).encode()
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


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def config_dir() -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / IDENTIFIER


def local_dir() -> pathlib.Path:
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    return pathlib.Path(local) / IDENTIFIER


def removed(path: pathlib.Path, seconds: float = 30) -> bool:
    """Takes a folder away, waiting for the engine's processes to let go of it."""

    until = time.perf_counter() + seconds
    while path.exists() and time.perf_counter() < until:
        shutil.rmtree(path, ignore_errors=True)
        time.sleep(0.5)
    return not path.exists()


def wipe() -> None:
    if "probe" not in IDENTIFIER:
        raise SystemExit("not a probe identifier: refusing to delete its folders")
    for one in (config_dir(), local_dir()):
        removed(one, 10)


def endpoint(seconds: float, unlike: int = 0) -> tuple[int, str]:
    path = config_dir() / "automation.json"
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


def allow_eval() -> None:
    path = config_dir() / "automation.json"
    said = json.loads(path.read_text(encoding="utf-8"))
    said["eval"] = True
    path.write_text(json.dumps(said), encoding="utf-8")


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def act(self, verb: str, args: dict[str, object], seconds: float = 120) -> object:
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

    def open(self, path: str, space: str | None = None) -> object:
        args: dict[str, object] = {"path": path}
        if space:
            args["space"] = space
        return self.act("open", args)

    def ask(self, code: str, seconds: float = 120) -> object:
        said = self.act("eval", {"code": code, "yes": True}, seconds)
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        return said.get("value")

    def invoke(self, command: str, args: dict[str, object] | None = None) -> object:
        """One of the crate's commands, as the window calls it; an error comes back as
        `{"refused": sentence}` rather than as nothing."""

        code = (
            f"window.__TAURI_INTERNALS__.invoke({json.dumps(command)}, {json.dumps(args or {})})"
            ".then((value) => ({ value }), (error) => ({ refused: String(error) }))"
        )
        said = self.ask(code)
        if isinstance(said, dict) and "value" in said:
            return said["value"]
        return said


def tab_of(app: App, name: str) -> str | None:
    said = app.ask("nib.workspace.tabs.map((one) => ({ id: one.id, name: one.name }))")
    for one in said if isinstance(said, list) else []:
        if isinstance(one, dict) and str(one.get("name", "")).startswith(name):
            return str(one.get("id"))
    return None


def wait_for_tab(app: App, name: str, seconds: float = 30) -> str:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        found = tab_of(app, name)
        if found:
            return found
        time.sleep(0.3)
    raise SystemExit(f"the app never opened {name}")


def seen(app: App, tab: str, seconds: float = 30) -> dict[str, str]:
    """What the page says it has, through the clipper's own reader: the cookies the server
    was sent, and the storage the page read (once it has finished reading)."""

    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        said = app.invoke("web_clip", {"tab": tab, "selection": False})
        html = said.get("html") if isinstance(said, dict) else None
        if isinstance(html, str):
            cookies = re.search(r"COOKIES\|(.*?)\|END", html)
            storage = re.search(r"STORAGE\|(.*?)\|END", html)
            if cookies and storage and storage[1] != "pending":
                out: dict[str, str] = {}
                for pair in f"{cookies[1]}|{storage[1]}".split("|"):
                    name, _, value = pair.partition(":")
                    out[name] = value
                return out
        time.sleep(0.4)
    return {"error": "the page never said"}


def launch(exe: pathlib.Path, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    app = run_probe(exe, quiet=True)
    port, secret = endpoint(90, unlike)
    hwnd = 0
    until = time.perf_counter() + 90
    while time.perf_counter() < until and not hwnd:
        hwnd = main_window(app.pid)
        time.sleep(0.2)
    if not hwnd:
        raise SystemExit("the app never showed a window")
    sized(hwnd, 1280, 860)
    time.sleep(1.5)
    return app, App(port, secret)


def quit_app(app: subprocess.Popen[bytes]) -> None:
    if not close_app(app):
        app.kill()
        raise SystemExit("the app did not quit when its window was closed")


def shortcut(url: str) -> str:
    return f"[InternetShortcut]\r\nURL={url}\r\nTitle={SITE_NOTE}\r\nNib-Added=2026-09-30T08:00:00.000Z\r\n"


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    args = parsed.parse_args()

    wipe()
    port = free_port()
    origin = f"http://127.0.0.1:{port}"
    serve(port)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-web-state-probe-"))
    os.environ["NIB_SPACES_DIR"] = str(spaces)
    space = spaces / SPACE
    space.mkdir(parents=True)
    (space / f"{NOTE}.md").write_text(f"# {NOTE}\n\nAn ordinary note.\n", encoding="utf-8")
    site_file = space / f"{SITE_NOTE}.url"
    site_file.write_text(shortcut(f"{origin}/app"), encoding="utf-8")

    said: dict[str, object] = {}
    ok = True
    running = None
    try:
        # One launch to write the endpoint file, so eval can be turned on in it.
        running, app = launch(args.exe)
        running.terminate()
        running.wait(timeout=30)
        allow_eval()
        time.sleep(1)

        running, app = launch(args.exe, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)
        app.open(f"{SITE_NOTE}.url")
        tab = wait_for_tab(app, SITE_NOTE)
        time.sleep(2)
        app.invoke("web_navigate", {"tab": tab, "url": f"{origin}/login"})
        time.sleep(4)
        before = seen(app, tab)
        said["signed in, first computer"] = before
        ok = ok and before == SIGNED_IN

        # The keys: made, and every command answering.
        generation = app.invoke("web_key_rotate")
        device = app.invoke("web_key_device")
        digits = app.invoke("web_key_digits", {"publicKey": device})
        lease = app.invoke("web_key_lease", {"store": None, "site": "127.0.0.1"})
        wrapped = app.invoke("web_key_wrap", {"targetPublicKey": device})
        accepted = app.invoke(
            "web_key_accept",
            {"wrapped": wrapped.get("wrapped") if isinstance(wrapped, dict) else "", "generation": generation},
        )
        said["keys"] = {
            "generation": generation,
            "digits": digits,
            "lease key": lease,
            "wrap": wrapped,
            "accepted": accepted,
            "current": app.invoke("web_key_current"),
        }
        ok = ok and isinstance(digits, str) and len(digits) == 6 and digits.isdigit()
        ok = ok and isinstance(lease, str) and len(lease) == 64 and accepted is None

        started = time.perf_counter()
        captured = app.invoke(
            "web_state_capture",
            {
                "store": None,
                "site": "127.0.0.1",
                "origins": [origin],
                "tab": tab,
                "app": {"zoom": 1.1},
            },
        )
        said["capture"] = captured
        said["capture took ms"] = round((time.perf_counter() - started) * 1000)
        if not isinstance(captured, dict) or "folder" not in captured:
            raise SystemExit(f"the capture failed: {captured}")
        # The same site read without its tab: every origin from a hidden page in the
        # store, as for an origin no tab is on. The database is unchanged, so its chunk is
        # the same name, which is what keeps an unchanged database from being uploaded
        # twice; there is no tab, so no sessionStorage.
        started = time.perf_counter()
        hidden = app.invoke(
            "web_state_capture",
            {"store": None, "site": "127.0.0.1", "origins": [origin], "tab": None},
        )
        said["capture from a hidden page"] = hidden
        said["capture from a hidden page took ms"] = round((time.perf_counter() - started) * 1000)
        same_chunks = isinstance(hidden, dict) and [one["name"] for one in hidden.get("chunks", [])] == [
            one["name"] for one in captured["chunks"]
        ]
        said["an unchanged database is the same chunk"] = same_chunks
        ok = ok and same_chunks and hidden.get("cookies") == captured.get("cookies")

        # Kept apart from the app's own folder, which is about to lose its store.
        carried = pathlib.Path(tempfile.mkdtemp(prefix="nib-web-state-bundle-"))
        for one in pathlib.Path(captured["folder"]).iterdir():
            shutil.copy2(one, carried / one.name)

        app.ask(f"nib.workspace.close('{tab}')")
        time.sleep(1)
        quit_app(running)
        running = None

        # The second computer: the same store name, with nothing in it.
        store = config_dir() / "web"
        said["store emptied"] = removed(store)
        ok = ok and bool(said["store emptied"])

        running, app = launch(args.exe, unlike=app.port)
        app.open(f"{NOTE}.md", SPACE)
        time.sleep(3)
        app.open(f"{SITE_NOTE}.url")
        tab = wait_for_tab(app, SITE_NOTE)
        time.sleep(3)
        empty = seen(app, tab)
        said["second computer, before the restore"] = empty
        ok = ok and not any(empty.get(name) for name in SIGNED_IN)
        app.ask(f"nib.workspace.close('{tab}')")
        time.sleep(1)

        inbox = app.invoke("web_state_inbox")
        if not isinstance(inbox, str):
            raise SystemExit(f"no inbox: {inbox}")
        for one in carried.iterdir():
            shutil.copy2(one, pathlib.Path(inbox) / one.name)
        shutil.rmtree(carried, ignore_errors=True)

        started = time.perf_counter()
        restored = app.invoke(
            "web_state_restore",
            {"store": None, "site": "127.0.0.1", "manifestPath": str(pathlib.Path(inbox) / "manifest")},
        )
        said["restore"] = restored
        said["restore took ms"] = round((time.perf_counter() - started) * 1000)
        if not isinstance(restored, dict) or "session" not in restored:
            raise SystemExit(f"the restore failed: {restored}")

        app.open(f"{SITE_NOTE}.url")
        tab = wait_for_tab(app, SITE_NOTE)
        time.sleep(3)
        session = restored.get("session") or {}
        said["session seeded"] = app.invoke(
            "web_state_session",
            {"tab": tab, "origin": session.get("origin", origin), "items": session.get("items", [])},
        )
        time.sleep(2)
        after = seen(app, tab)
        said["second computer, after the restore"] = after
        said["every value arrived"] = after == SIGNED_IN
        ok = ok and after == SIGNED_IN

        said["keys forgotten"] = app.invoke("web_key_forget")
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=30)
            except subprocess.TimeoutExpired:
                running.kill()
        shutil.rmtree(spaces, ignore_errors=True)

    print(json.dumps(said, indent=2))
    print("\nPASS" if ok else "\nFAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
