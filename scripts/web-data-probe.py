"""A space's own web data, folded into the store every page shares (#239), proved across two
builds. Windows only.

Emil, 2026-10-13: the per-space web data option goes, and web data is global. A reader who
kept a space apart is signed in there, and the build without the option must not sign them
out. This drives the build from before (`--old`), which still has the option, and then the
build after (`--new`), on one and the same profile:

1. **old, a page in the shared store** - a local site's second origin (`localhost`) is given
   a cookie that ends in a day, `pref=global`, one that ends in thirty, `keep=global`, and
   `localStorage.token = global`;
2. **old, the space kept apart** - the space's choice set to its own store before any page
   of the run is built, and both origins visited there: `127.0.0.1` gets a session cookie
   `sid` (HttpOnly), `localStorage.token = space-a` and an IndexedDB record; `localhost`
   gets `pref=space` ending in ten days, `keep=space` ending in one, and `token = space-b`;
3. **new** - the same web note opened again, now in the shared store:
   * `127.0.0.1` has `sid`, `token = space-a` and the IndexedDB record: everything the
     shared store did not have came over;
   * `localhost` has `pref=space` (the later end wins), `keep=global` (so does the shared
     store's, where its end is later) and `token = global` (an origin the shared store had
     storage for keeps its own);
   * the space's own store is still on disk, and the merge is marked done;
4. **new, the note kept apart** - `Nib-Data` written into the note's file on disk, the way
   another computer's choice arrives: its open page is built again in `note_<id>`, where
   `127.0.0.1` has nothing; the key taken out again, and the page is back on the shared
   store and its login.

The cookies are read by the site itself, which says back the `Cookie` header it was sent,
so an HttpOnly cookie is seen as a site sees it. No real input is used and nothing is ever
on a screen; see probe_app.py.

    python scripts/web-data-probe.py --old <before>/nib.exe --new <after>/nib.exe \\
      --identifier ch.emilvinu.nib.probe.<name>
"""

from __future__ import annotations

import argparse
import atexit
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import socket
import sys
import tempfile
import threading
import time

from probe_app import close_app, main_window, run_probe

HERE = pathlib.Path(__file__).resolve().parent
SPACE = "Web data probe"

#: A devtools port for the probe's engines, and a window off the screen drawn at full rate.
ENGINE_ARGS = (
    "--remote-debugging-port=0 --disable-features=CalculateNativeWinOcclusion "
    "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding"
)


def borrowed(name: str):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


page_probe = borrowed("web-page-probe")

DAY = 86400

#: What each page sets, as cookies with their lifetimes and the storage it writes.
SETS = {
    "/global": ([("pref", "global", DAY), ("keep", "global", 30 * DAY)], "global", False),
    "/space-a": ([("sid", "space-a", None)], "space-a", True),
    "/space-b": ([("pref", "space", 10 * DAY), ("keep", "space", DAY)], "space-b", False),
}

#: The page that reads it all back: the Cookie header it was sent, the token, the record.
CHECK = """<!doctype html><title>check</title><script>
const said = { cookie: %s, token: localStorage.getItem('token'), record: null }
const asked = indexedDB.open('app', 1)
asked.onupgradeneeded = () => asked.result.createObjectStore('kv')
asked.onsuccess = () => {
  const read = asked.result.transaction('kv').objectStore('kv').get('token')
  read.onsuccess = () => { said.record = read.result ?? null; window.__said = said }
  read.onerror = () => { window.__said = said }
}
asked.onerror = () => { window.__said = said }
</script>"""

SET = """<!doctype html><title>set</title><script>
localStorage.setItem('token', %s)
const record = %s
if (record) {
  const asked = indexedDB.open('app', 1)
  asked.onupgradeneeded = () => asked.result.createObjectStore('kv')
  asked.onsuccess = () => {
    const tx = asked.result.transaction('kv', 'readwrite')
    tx.objectStore('kv').put(%s, 'token')
    tx.oncomplete = () => { window.__done = true }
  }
} else {
  window.__done = true
}
</script>"""


def serve() -> int:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            path = self.path.split("?")[0]
            if path == "/check":
                body = CHECK % json.dumps(self.headers.get("Cookie") or "")
                self.send_response(200)
            elif path in SETS:
                cookies, token, record = SETS[path]
                self.send_response(200)
                for name, value, lasts in cookies:
                    life = f"; Max-Age={lasts}" if lasts else ""
                    only = "; HttpOnly" if lasts is None else ""
                    self.send_header("Set-Cookie", f"{name}={value}; Path=/{life}{only}")
                body = SET % (json.dumps(token), json.dumps(record), json.dumps(token))
            else:
                body = "<!doctype html><title>home</title>home"
                self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body.encode())

        def log_message(self, *_args: object) -> None:
            return

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return port


PRELUDE = r"""
const ws = nib.workspace
const wait = async (ok, ms = 20000) => {
  const until = performance.now() + ms
  for (;;) {
    const got = await ok()
    if (got) return got
    if (performance.now() > until) return null
    await new Promise((go) => setTimeout(go, 100))
  }
}
"""


def ask(app, body: str, seconds: float = 90) -> object:
    return app.ask(f"(async () => {{ {PRELUDE}\n{body} }})()", seconds)


class Run:
    """One launch of a build, with eval on, until `close`."""

    def __init__(self, exe: pathlib.Path, identifier: str, env: dict[str, str], unlike: int) -> None:
        self.running = run_probe(exe, env=env, quiet=True)
        endpoint, secret, _ = page_probe.endpoint(identifier, unlike=unlike)
        self.port = endpoint
        self.app = page_probe.App(endpoint, secret)
        until = time.perf_counter() + 90
        while time.perf_counter() < until and not main_window(self.running.pid):
            time.sleep(0.2)
        ask(
            self.app,
            "await wait(() => performance.getEntriesByName('nib: launch order finished').length > 0, 60000); return true",
        )

    def close(self) -> None:
        if not close_app(self.running):
            self.running.terminate()
        time.sleep(1.5)


def page_now(identifier: str, seconds: float) -> str | None:
    """The devtools socket of the web tab's page, wherever it is in the site."""
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        for path in ("/home", "/check", *SETS):
            url = page_probe.page_socket(identifier, path)
            if url:
                return url
        time.sleep(0.3)
    return None


def go(identifier: str, address: str, seconds: float = 20) -> object:
    """The web tab's page sent to `address`, and what it said when it was done there. A
    socket the engine closes - a page built again in another store - is found again."""
    for _ in range(4):
        url = page_now(identifier, seconds)
        if url is None:
            raise SystemExit("the site's page never answered")
        try:
            tools = page_probe.Devtools(url)
        except OSError:
            time.sleep(1)
            continue
        try:
            tools.value(f"location.href = {json.dumps(address)}")
            time.sleep(1.0)
            until = time.perf_counter() + seconds
            said = None
            while said is None and time.perf_counter() < until:
                said = tools.value("window.__said ?? (window.__done ? 'done' : null)")
                time.sleep(0.2)
            return said
        except OSError:
            time.sleep(1)
        finally:
            tools.close()
    raise SystemExit(f"the site's page would not go to {address}")


#: The open web note's words with its last line of nib's own data replaced by `%s`.
OWN = r"""
const web = ws.tabs.find((one) => one.kind === 'web')
const doc = ws.documentAt(web.path)
const words = doc.text.replace(/(\r?\nNib-Data=[0-9a-f]+)?\r?\n$/, '') + %s
doc.replace(words, false)
"""

#: The store the web tab's page is in once it is the one wanted, waited for.
STORE_OF = """
const tab = await wait(() => ws.tabs.find((one) => one.kind === 'web'))
await wait(() => (nib.pages?.of?.(tab.id)?.store ?? '') === 'note_3f9a0c17e2b4d685' && nib.pages?.of?.(tab.id)?.live, 12000)
await new Promise((go) => setTimeout(go, 1500))
return nib.pages?.of?.(tab.id)?.store ?? ''
"""


def open_site(app, store_check: str | None = None) -> object:
    ask(app, f"for (const one of [...ws.tabs]) ws.close(one.id); {store_check or ''}; return true")
    app.act("open", {"path": "Site.url", "space": SPACE})
    said = ask(
        app,
        """
        const tab = await wait(() => ws.tabs.find((one) => one.kind === 'web'))
        await wait(() => nib.pages?.of?.(tab.id)?.live, 20000)
        await new Promise((go) => setTimeout(go, 1500))
        return { store: nib.pages?.of?.(tab.id)?.store ?? null, space: nib.pages?.of?.(tab.id)?.space }
        """,
    )
    print(f"opened: {said}", file=sys.stderr, flush=True)
    return said


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--old", required=True, type=pathlib.Path)
    parsed.add_argument("--new", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", required=True)
    args = parsed.parse_args()

    page_probe.wipe(args.identifier)
    port = serve()
    a, b = f"http://127.0.0.1:{port}", f"http://localhost:{port}"
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-web-data-probe-"))
    atexit.register(shutil.rmtree, root, ignore_errors=True)
    (root / SPACE).mkdir(parents=True)
    (root / SPACE / "Site.url").write_text(page_probe.shortcut(f"{b}/home", "Site"), encoding="utf-8")
    env = {**os.environ, "NIB_SPACES_DIR": str(root), "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": ENGINE_ARGS}
    said: dict[str, object] = {}
    failed: list[str] = []

    # Once to write the endpoint file, then with `eval` on in it.
    first = run_probe(args.old, env=env, quiet=True)
    port_one, _, _ = page_probe.endpoint(args.identifier)
    time.sleep(3)
    close_app(first)
    page_probe.allow_eval(args.identifier)
    time.sleep(1)

    # 1. The old build, a page in the shared store.
    run = Run(args.old, args.identifier, env, port_one)
    try:
        said["old, shared"] = open_site(run.app)
        said["old, shared: localhost"] = go(args.identifier, f"{b}/global")
        ask(run.app, "for (const one of [...ws.tabs]) ws.close(one.id); return true")
        space = ask(run.app, "return ws.spaces.find((one) => one.name === %s)?.id" % json.dumps(SPACE))
        said["space"] = space
        # The space's choice, as the old build keeps it, for its next launch to read: the
        # build reads it once, as the first page of a run is built.
        ask(run.app, "localStorage.setItem('nib:web-data', JSON.stringify({ %s: 'space' })); return true" % json.dumps(space))
    finally:
        run.close()
    last = run.port

    # 2. The old build, the space kept apart.
    run = Run(args.old, args.identifier, env, last)
    try:
        said["old, apart"] = open_site(run.app)
        said["old, apart: 127.0.0.1"] = go(args.identifier, f"{a}/space-a")
        said["old, apart: localhost"] = go(args.identifier, f"{b}/space-b")
        said["old, apart: localhost, read"] = go(args.identifier, f"{b}/check")
        ask(run.app, "for (const one of [...ws.tabs]) ws.close(one.id); return true")
    finally:
        run.close()
    last = run.port
    store_folder = page_probe.config_dir(args.identifier) / "web-stores" / f"space_{space}"
    if not store_folder.is_dir():
        failed.append(f"the old build kept no store of the space's own at {store_folder}")

    # 3. The new build: the same note, in the shared store now.
    run = Run(args.new, args.identifier, env, last)
    try:
        said["new"] = open_site(run.app)
        here_a = go(args.identifier, f"{a}/check")
        here_b = go(args.identifier, f"{b}/check")
        said["new: 127.0.0.1"] = here_a
        said["new: localhost"] = here_b
        said["new: merged"] = ask(run.app, "return localStorage.getItem('nib:web-data-merged')")
        said["new: choice left"] = ask(run.app, "return localStorage.getItem('nib:web-data')")

        # 4. The note keeps its own web data, said in its words the way a change synced from
        # another computer arrives in an open note: its page is built again in a store of
        # its own, signed out; and taken out again, back on the shared store and its login.
        said["apart"] = ask(run.app, OWN % r"'\r\nNib-Data=3f9a0c17e2b4d685\r\n'" + STORE_OF, 40)
        said["apart: 127.0.0.1"] = go(args.identifier, f"{a}/check")
        said["shared again"] = ask(run.app, OWN % r"'\r\n'" + STORE_OF.replace("note_3f9a0c17e2b4d685", ""), 40)
        said["shared again: 127.0.0.1"] = go(args.identifier, f"{a}/check")
    finally:
        run.close()

    apart, alone = said.get("apart"), said.get("apart: 127.0.0.1")
    if apart != "note_3f9a0c17e2b4d685":
        failed.append(f"the note kept apart was not built in its own store: {apart}")
    if not (isinstance(alone, dict) and "sid=" not in str(alone.get("cookie")) and alone.get("token") is None):
        failed.append(f"the note's own store was not a fresh one: {alone}")
    back = said.get("shared again: 127.0.0.1")
    if said.get("shared again") != "" or not (isinstance(back, dict) and "sid=space-a" in str(back.get("cookie"))):
        failed.append(f"the note shared again did not find the shared login: {said.get('shared again')} {back}")

    new = said.get("new")
    if not (isinstance(new, dict) and new.get("store") is None):
        failed.append(f"the page was not in the shared store: {new}")
    cookie_a = str(here_a.get("cookie", "")) if isinstance(here_a, dict) else ""
    cookie_b = str(here_b.get("cookie", "")) if isinstance(here_b, dict) else ""
    if "sid=space-a" not in cookie_a:
        failed.append(f"127.0.0.1 lost its session cookie: {here_a}")
    if not (isinstance(here_a, dict) and here_a.get("token") == "space-a" and here_a.get("record") == "space-a"):
        failed.append(f"127.0.0.1 lost its storage: {here_a}")
    if "pref=space" not in cookie_b:
        failed.append(f"localhost's later cookie did not win: {here_b}")
    if "keep=global" not in cookie_b:
        failed.append(f"localhost's shared cookie that ends later was not kept: {here_b}")
    if not (isinstance(here_b, dict) and here_b.get("token") == "global"):
        failed.append(f"localhost's own storage in the shared store was not kept: {here_b}")
    if not said.get("new: merged") or said.get("new: choice left") is not None:
        failed.append("the merge was not marked done")
    if not store_folder.is_dir():
        failed.append("the space's own store was deleted")

    print(json.dumps(said, indent=2, default=str))
    for one in failed:
        print(f"FAIL: {one}")
    if not failed:
        print("a space's logins and storage are in the shared store, and nothing was deleted")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
