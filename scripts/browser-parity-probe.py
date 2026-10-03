"""History, Delete browsing data, a private tab, the search engine and a link dropped on
the file list, driven on a probe build.

What Chrome keeps inside the browser stays inside nib (Emil, 2026-09-13); these are the
ones that were missing. Each step drives the app the way a person does - the keys, the
rows, the dialog's own buttons - through the probe's automation endpoint, and reads the
answer back out of the page a loopback server serves, so what is proved is what the
engine kept and not what the app believes. See docs/web-tabs.md, "History, Delete
browsing data, a private tab".

    pnpm --dir apps/desktop tauri build --no-bundle \\
      --config '{"identifier":"ch.emilvinu.nib.probe.browserparity","version":"99.0.0",
                 "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/browser-parity-probe.py --exe path/to/nib.exe \\
      --identifier ch.emilvinu.nib.probe.browserparity

Launched through `run_probe`, so the window is off the screen and never in front, with
`NIB_SPACES_DIR` in a temp folder. A drag between two webviews is a drag the system
carries and no probe may make with the real pointer, so the drops are played as the
drop events the window hears; what a real drag hands over is the same transfer.
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
import urllib.parse
import urllib.request

from probe_app import close_app, identifier_of, main_window, run_probe, sized

PORT_FROM = 22400
PORT_TO = 22499

SPACE = "Browser parity probe"
NOTE = "Idea"

# The page every step reads: what the store holds for this site, on one line.
PAGE = """<!doctype html><title>__TITLE__</title><body><article>
RESULT|cookie:__COOKIE__|ls:<span id=ls></span>|END
<p>A paragraph so the reader keeps the article: it says nothing the line above does not,
and it is long enough that the clipper's reader takes the article rather than the body,
which it does once there are a couple of hundred characters of it.</p>
</article><script>
var set = new URLSearchParams(location.search).get('set')
if (set) localStorage.setItem('ls', set)
document.getElementById('ls').textContent = localStorage.getItem('ls') || ''
</script></body>"""


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def serve(port: int) -> None:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            url = urllib.parse.urlparse(self.path)
            asked = urllib.parse.parse_qs(url.query)
            cookies = self.headers.get("Cookie") or ""
            had = re.search(r"(?:^|; )c=([^;]*)", cookies)
            title = url.path.strip("/").capitalize() or "Home"
            body = (
                PAGE.replace("__TITLE__", f"Page {title}")
                .replace("__COOKIE__", had[1] if had else "")
                .encode()
            )
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            if "set" in asked:
                self.send_header("set-cookie", f"c={asked['set'][0]}; Path=/; Max-Age=86400")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()


def config_dir(identifier: str) -> pathlib.Path:
    roaming = os.environ.get("APPDATA") or str(pathlib.Path.home() / "AppData" / "Roaming")
    return pathlib.Path(roaming) / identifier


def wipe(identifier: str) -> None:
    if "probe" not in identifier:
        raise SystemExit(f"{identifier} is not a probe identifier: refusing to delete its folders")
    local = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
    for one in (config_dir(identifier), pathlib.Path(local) / identifier):
        shutil.rmtree(one, ignore_errors=True)


def endpoint(identifier: str, unlike: int = 0) -> tuple[int, str]:
    path = config_dir(identifier) / "automation.json"
    until = time.perf_counter() + 90
    while time.perf_counter() < until:
        try:
            said = json.loads(path.read_text(encoding="utf-8"))
            if said.get("port") and said.get("secret") and int(said["port"]) != unlike:
                return int(said["port"]), str(said["secret"])
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    raise SystemExit(f"the app never wrote {path}")


class App:
    def __init__(self, port: int, secret: str) -> None:
        self.port = port
        self.secret = secret

    def act(self, verb: str, args: dict[str, object]) -> object:
        body = json.dumps({"verb": verb, "args": args, "rest": []}).encode()
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.port}/",
            data=body,
            headers={"authorization": f"Bearer {self.secret}", "content-type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as answer:
                return json.loads(answer.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as refused:
            return {"ok": False, "error": f"{refused.code}"}

    def ask(self, code: str) -> object:
        said = self.act("eval", {"code": code, "yes": True})
        if not isinstance(said, dict) or not said.get("ok"):
            return {"error": said}
        value = said.get("value")
        if isinstance(value, str):
            try:
                return json.loads(value)
            except ValueError:
                return value
        return value


def launch(exe: pathlib.Path, identifier: str, unlike: int = 0) -> tuple[subprocess.Popen[bytes], App]:
    app = run_probe(exe, quiet=True)
    port, secret = endpoint(identifier, unlike)
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


def until(check, seconds: float = 20, every: float = 0.4):  # type: ignore[no-untyped-def]
    """The first answer `check` gives that is worth having, or its last."""

    end = time.perf_counter() + seconds
    said = check()
    while not said and time.perf_counter() < end:
        time.sleep(every)
        said = check()
    return said


TABS = """JSON.stringify(nib.workspace.tabs.map((one) => ({
  id: one.id, kind: one.kind, name: one.name, path: one.path, private: one.inPrivate,
  url: nib.pages.addressOf(one.id), active: one.id === nib.workspace.activeTabId,
})))"""


def tabs(app: App) -> list[dict[str, object]]:
    said = app.ask(TABS)
    return said if isinstance(said, list) else []


def active(app: App) -> dict[str, object]:
    return next((one for one in tabs(app) if one.get("active")), {})


def key(app: App, key: str, code: str, ctrl: bool = True, shift: bool = False) -> None:
    """A chord, played on the window as the app's own key handler reads it."""

    app.ask(
        "window.dispatchEvent(new KeyboardEvent('keydown', "
        + json.dumps(
            {"key": key, "code": code, "ctrlKey": ctrl, "shiftKey": shift, "bubbles": True, "cancelable": True}
        )
        + ")); true"
    )


def read(app: App, tab: str) -> dict[str, str]:
    """What the page in `tab` says its store holds: `cookie` and `ls`."""

    def look() -> dict[str, str]:
        said = app.ask(f"window.__TAURI_INTERNALS__.invoke('web_clip', {{ tab: '{tab}', selection: false }})")
        html = said.get("html") if isinstance(said, dict) else None
        found = re.search(r"RESULT\|(.*?)\|END", html) if isinstance(html, str) else None
        if not found:
            return {}
        flat = re.sub(r"<[^>]*>", "", found[1])
        return {name: value for name, _, value in (pair.partition(":") for pair in flat.split("|"))}

    return until(look) or {}


def go(app: App, tab: str, url: str) -> None:
    app.ask(f"nib.pages.go('{tab}', '{url}'); true")
    time.sleep(2.5)


def history_rows(app: App) -> list[str]:
    said = app.ask("[...document.querySelectorAll('.history .page .nib-row-label')].map((one) => one.textContent)")
    return said if isinstance(said, list) else []


def visits(app: App) -> list[str]:
    said = app.ask("(JSON.parse(localStorage.getItem('nib:web-visits') || '[]')).map((one) => one.url)")
    return said if isinstance(said, list) else []


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier")
    args = parsed.parse_args()
    identifier = identifier_of(args.exe, args.identifier)

    wipe(identifier)
    port = free_port()
    serve(port)
    site = f"http://127.0.0.1:{port}"
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-browser-parity-spaces-"))
    os.environ["NIB_SPACES_DIR"] = str(root)
    made = root / SPACE
    (made / "Read").mkdir(parents=True)
    (made / f"{NOTE}.md").write_text(f"# {NOTE}\n\nA note to start from.\n", encoding="utf-8")

    said: dict[str, object] = {}
    checks: dict[str, bool] = {}
    running = None
    try:
        running, app = launch(args.exe, identifier)
        running.terminate()
        running.wait(timeout=30)
        eval_file = config_dir(identifier) / "automation.json"
        written = json.loads(eval_file.read_text(encoding="utf-8"))
        written["eval"] = True
        eval_file.write_text(json.dumps(written), encoding="utf-8")
        # The search engine, chosen before the launch reads it: a custom one on the loopback.
        time.sleep(1)
        running, app = launch(args.exe, identifier, unlike=app.port)
        app.act("open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(2)

        # ── History ──────────────────────────────────────────────────────────────────
        first = app.ask(f"nib.workspace.openPage('{site}/alpha', 'front')")
        tab = str(first)
        time.sleep(3)
        go(app, tab, f"{site}/beta")
        go(app, tab, f"{site}/gamma")
        said["visits"] = visits(app)
        checks["each page is a visit"] = all(
            any(url.startswith(f"{site}/{name}") for url in said["visits"])  # type: ignore[union-attr]
            for name in ("alpha", "beta", "gamma")
        )

        key(app, "h", "KeyH")
        history = until(lambda: next((one for one in tabs(app) if one.get("url") == "nib://history"), None))
        said["history tab"] = history
        checks["Ctrl+H opens the History page in a tab"] = bool(history) and bool(history.get("active"))  # type: ignore[union-attr]
        rows = until(lambda: history_rows(app))
        said["history rows"] = rows
        checks["it lists the pages, newest first"] = rows[:3] == ["Page Gamma", "Page Beta", "Page Alpha"]

        key(app, "h", "KeyH")
        time.sleep(1)
        checks["Ctrl+H again keeps the one History tab"] = (
            len([one for one in tabs(app) if one.get("url") == "nib://history"]) == 1
        )

        app.ask(
            "(() => { const field = document.querySelector('.history .find');"
            " field.value = 'beta'; field.dispatchEvent(new Event('input', { bubbles: true })); return true })()"
        )
        time.sleep(0.6)
        said["searched for beta"] = history_rows(app)
        checks["the search narrows the list"] = said["searched for beta"] == ["Page Beta"]

        app.ask("document.querySelectorAll('.history .line .gone')[0].click(); true")
        time.sleep(0.6)
        checks["a row's cross takes it out of the history"] = not any(
            url.startswith(f"{site}/beta") for url in visits(app)
        )
        app.ask(
            "(() => { const field = document.querySelector('.history .find');"
            " field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); return true })()"
        )
        time.sleep(0.6)
        app.ask("document.querySelector('.history .page').click(); true")
        time.sleep(3)
        here = active(app)
        said["after pressing a row"] = here
        checks["a row opens its page in the History tab"] = str(here.get("url", "")).startswith(f"{site}/gamma")

        # ── A private tab ────────────────────────────────────────────────────────────
        go(app, tab, f"{site}/plain?set=normal")
        key(app, "N", "KeyN", shift=True)
        private = until(lambda: next((one for one in tabs(app) if one.get("private")), None))
        said["private tab"] = private
        checks["Ctrl+Shift+N opens a private tab"] = bool(private)
        secret_tab = str(private.get("id")) if isinstance(private, dict) else ""
        go(app, secret_tab, f"{site}/secret?set=private")
        time.sleep(1.5)
        # The page says what the request carried, so the cookie it was given shows on the
        # next one.
        go(app, secret_tab, f"{site}/secret")
        inside = read(app, secret_tab)
        said["the private page"] = inside
        said["the private page's state"] = app.ask(
            f"JSON.stringify((({{ live, openable, url, inPrivate }}) => ({{ live, openable, url, inPrivate }}))(nib.pages.of('{secret_tab}')))"
        )
        checks["the private page has a store of its own"] = inside.get("cookie") == "private" and inside.get("ls") == "private"
        go(app, tab, f"{site}/plain")
        outside = read(app, tab)
        said["the ordinary page after it"] = outside
        checks["nothing private reaches the ordinary store"] = outside.get("cookie") == "normal" and outside.get("ls") == "normal"
        checks["a private page writes no history"] = not any("/secret" in url for url in visits(app))
        layout = app.ask("JSON.stringify(nib.workspace.layout())")
        checks["a private tab is not in the session"] = "/secret" not in json.dumps(layout)
        marked = app.ask("document.querySelectorAll('svg.private').length")
        checks["a private tab wears its mark"] = isinstance(marked, int) and marked >= 1

        app.ask(f"nib.workspace.close('{secret_tab}'); true")
        time.sleep(3)
        key(app, "N", "KeyN", shift=True)
        again = until(lambda: next((one for one in tabs(app) if one.get("private")), None))
        again_tab = str(again.get("id")) if isinstance(again, dict) else ""
        go(app, again_tab, f"{site}/secret")
        time.sleep(1.5)
        forgotten = read(app, again_tab)
        said["a private tab after the last one closed"] = forgotten
        checks["closing the last private tab forgets everything"] = forgotten.get("cookie") == "" and forgotten.get("ls") == ""
        checks["closed, it is not on the closed stack"] = "/secret" not in json.dumps(app.ask("JSON.stringify(nib.workspace.closed.stack)"))
        app.ask(f"nib.workspace.close('{again_tab}'); true")
        time.sleep(1)

        # ── Delete browsing data ─────────────────────────────────────────────────────
        app.ask(f"nib.workspace.activate('{tab}'); true")
        time.sleep(1)
        go(app, tab, f"{site}/plain?set=kept")
        before = read(app, tab)
        said["before the clearing"] = before
        key(app, "Delete", "Delete", shift=True)
        dialog = until(lambda: app.ask("!!document.querySelector('.nib-screen [role=switch]')"))
        checks["Ctrl+Shift+Delete opens the dialog"] = dialog is True
        app.ask(
            "(() => { const all = [...document.querySelectorAll('.nib-screen button')];"
            " const it = all.find((one) => one.textContent.trim() === 'Delete data'); it.click(); return !!it })()"
        )
        gone = until(lambda: app.ask("!document.querySelector('.nib-screen [role=switch]')"), 30)
        checks["the dialog closes once the engine has answered"] = gone is True
        go(app, tab, f"{site}/plain")
        after = read(app, tab)
        said["after the last hour was cleared"] = after
        checks["cookies and site data are gone"] = before.get("ls") == "kept" and after.get("cookie") == "" and after.get("ls") == ""
        checks["the last hour's history is gone"] = not any(url.startswith(f"{site}/alpha") for url in visits(app))

        # ── A link dropped on the file list, and on the strip ────────────────────────
        dropped = app.ask(
            "(() => { const data = new DataTransfer();"
            f" data.setData('text/uri-list', '{site}/dropped');"
            f" data.setData('text/html', '<a href=\"{site}/dropped\">A dropped link</a>');"
            " const rest = document.querySelector('[data-space-rest]');"
            " rest.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));"
            " rest.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));"
            " return !!rest })()"
        )
        note = made / "A dropped link.url"
        found = until(lambda: note.exists(), 10)
        said["the dropped web note"] = note.read_text(encoding="utf-8") if found else None
        checks["a link dropped on the list is a web note there"] = bool(dropped) and bool(found) and f"URL={site}/dropped" in str(said["the dropped web note"])

        count = len(tabs(app))
        app.ask(
            "(() => { const data = new DataTransfer();"
            f" data.setData('text/uri-list', '{site}/onstrip');"
            " const strip = document.querySelector('[data-strip]');"
            " strip.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));"
            " strip.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));"
            " return true })()"
        )
        time.sleep(2)
        checks["a link dropped on the strip is a tab"] = len(tabs(app)) == count + 1 and any(
            str(one.get("url", "")).startswith(f"{site}/onstrip") for one in tabs(app)
        )

        # ── The search engine ────────────────────────────────────────────────────────
        app.ask(
            "localStorage.setItem('nib:search-engine', JSON.stringify({ id: 'custom',"
            f" custom: '{site}/search?q=%s' }})); true"
        )
        close_app(running)
        running, app = launch(args.exe, identifier, unlike=app.port)
        app.act("open", {"path": f"{NOTE}.md", "space": SPACE})
        time.sleep(2)
        searching = str(app.ask("(nib.workspace.openWebsite(), nib.workspace.activeTabId)"))
        time.sleep(2)
        app.ask(
            "(() => { const field = document.querySelector('.webbar input');"
            " field.focus(); field.value = 'nib probe words';"
            " field.dispatchEvent(new Event('input', { bubbles: true }));"
            " field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));"
            " return true })()"
        )
        time.sleep(3)
        url = str(next((one.get("url") for one in tabs(app) if one.get("id") == searching), ""))
        said["words typed in the address field went to"] = url
        checks["the address field searches on the engine chosen"] = url.startswith(f"{site}/search?q=nib%20probe%20words")
        checks["the private tab did not come back after the restart"] = not any(one.get("private") for one in tabs(app))
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=30)
            except subprocess.TimeoutExpired:
                running.kill()
        shutil.rmtree(root, ignore_errors=True)

    print(json.dumps(said, indent=2))
    for name, ok in checks.items():
        print(f"{'ok  ' if ok else 'FAIL'} {name}")
    passed = all(checks.values())
    print("\nPASS" if passed else "\nFAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
