"""Does a web note's row in the file list wear the mark its tab wears? Windows only.

Emil, 2026-10-03: the icon of a `.url` row in the left sidebar often differed from the
same page's tab icon - WhatsApp and Slack most, whose marks carry an unread count. The
tab follows the page's live mark; the row now does too while the tab is open, and keeps
the last one after it closes (see `faviconFor` in apps/desktop/src/lib/chosen-icon.ts).

This serves a page of its own, opens its web note in a tab, and swaps the page's mark
twice the way a chat site does - a badge on, the badge off - through the page's own
debugging port, which presses nothing. After each, the tab's picture and the row's are
read off nib's own page and compared; then the tab is closed and the row read again.

    python scripts/web-note-mark-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says; `run_probe` starts it off the screen and
without the keyboard.
"""

from __future__ import annotations

import argparse
import base64
import http.server
import importlib.util
import json
import os
import pathlib
import socket
import struct
import sys
import tempfile
import threading
import time
import zlib

from devtools import Session, port

HERE = pathlib.Path(__file__).resolve().parent
SPACE = "Marks probe"
NOTE = "Chat"


def borrowed(name: str, file: str):
    """Another drive's helpers, read from its file: the names have dashes in them."""

    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


probe = borrowed("extensions_probe", "extensions-probe.py")
failures: list[str] = []


def say(words: str) -> None:
    print(f"  {words}", flush=True)


def check(ok: bool, words: str) -> None:
    say(f"{'ok  ' if ok else 'FAIL'} {words}")
    if not ok:
        failures.append(words)


def square(rgb: tuple[int, int, int]) -> str:
    """A 16-pixel square of one colour, as a PNG data address: a mark told apart by colour."""

    row = b"\x00" + bytes(rgb) * 16
    raw = row * 16

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 16, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )
    return "data:image/png;base64," + base64.b64encode(png).decode()


PLAIN = square((40, 120, 220))
UNREAD = square((220, 40, 40))
READ = square((40, 180, 80))

PAGE = f"""<!doctype html><html><head><meta charset="utf-8"><title>Chat</title>
<link rel="icon" href="{PLAIN}"></head><body><p>A chat.</p></body></html>""".encode()


def serve() -> int:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("content-length", str(len(PAGE)))
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *_args: object) -> None:
            return

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        free = sock.getsockname()[1]
    made = http.server.ThreadingHTTPServer(("127.0.0.1", free), Handler)
    made.daemon_threads = True
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return free


SHOWN = """JSON.stringify((() => {
  const picture = (one) => one ? one.getAttribute('src') : null
  const row = document.querySelector('.row[data-path$=%s] img')
  const tab = document.querySelector('.pick[data-tab=%s] img')
  return { row: picture(row), tab: picture(tab) }
})())"""


def pictures_of(app, tab: str) -> tuple[str | None, str | None]:
    """The row's picture and the tab's, off nib's own page."""

    said = app.ask(SHOWN % (json.dumps(f"{NOTE}.url"), json.dumps(tab)))
    return (said.get("row"), said.get("tab")) if isinstance(said, dict) else (None, None)


def same_mark(app, tab: str, seconds: float = 15) -> tuple[str | None, str | None]:
    """The row's and the tab's pictures once they agree, or as they last were."""

    until = time.perf_counter() + seconds
    row, worn = pictures_of(app, tab)
    while time.perf_counter() < until:
        row, worn = pictures_of(app, tab)
        if row and row == worn:
            break
        time.sleep(0.3)
    return row, worn


def swap(target: dict, icon: str, where: str) -> None:
    """The page moves on within itself - another channel, as Slack does - and redraws its
    mark, as a chat site does with an unread count."""

    session = Session(target)
    try:
        session.value(f"history.pushState({{}}, '', {json.dumps(where)})")
        session.value(f"document.querySelector('link[rel=icon]').href = {json.dumps(icon)}")
    finally:
        session._socket.close()


def main() -> int:
    if sys.platform != "win32":
        raise SystemExit("this probe is Windows only")
    parsed = argparse.ArgumentParser(description=__doc__)
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe.web-note-mark")
    args = parsed.parse_args()

    probe.wipe(args.identifier)
    site = f"http://127.0.0.1:{serve()}/chat"
    root = pathlib.Path(tempfile.mkdtemp(prefix="nib-web-note-mark-"))
    os.environ["NIB_SPACES_DIR"] = str(root / "spaces")
    space = root / "spaces" / SPACE
    space.mkdir(parents=True)
    (space / "A note.md").write_text("# A note\n", encoding="utf-8")
    (space / f"{NOTE}.url").write_text(f"[InternetShortcut]\r\nURL={site}\r\nTitle={NOTE}\r\n", encoding="utf-8")

    running = None
    try:
        running, app = probe.launch(args.exe, args.identifier)
        running.terminate()
        running.wait(timeout=probe.GONE)
        probe.allow_eval(args.identifier)
        time.sleep(1)
        running, app = probe.launch(args.exe, args.identifier, unlike=app.at)
        until = time.perf_counter() + 60
        while time.perf_counter() < until and not isinstance(app.ask("nib.workspace.tabs.length"), int):
            time.sleep(0.5)

        app.open("A note.md", SPACE)
        time.sleep(2)
        app.open(f"{NOTE}.url", SPACE)
        tab = probe.wait_for_tab(app, NOTE)
        say(f"web tab {tab}")

        # The engine writes its port down once its browser process is up.
        web_port = 0
        page = None
        until = time.perf_counter() + 30
        while time.perf_counter() < until and page is None:
            web_port = web_port or port(probe.config_dir(args.identifier) / "web")
            page = probe.page_target(web_port, site) if web_port else None
            time.sleep(0.5)
        if page is None:
            seen = [one.get("url") for one in probe.targets(web_port)] if web_port else []
            raise SystemExit(f"the page never appeared on its debugging port {web_port}: {seen}")

        row, worn = same_mark(app, tab)
        check(row is not None and row == worn, "the row wears the tab's mark as the page lands")

        for icon, where, what in ((UNREAD, "/chat/two", "the badge on"), (READ, "/chat/three", "the badge off")):
            before = worn
            swap(page, icon, where)
            until = time.perf_counter() + 15
            while time.perf_counter() < until:
                row, worn = pictures_of(app, tab)
                if worn and worn != before:
                    break
                time.sleep(0.3)
            check(bool(worn) and worn != before, f"{what}: the tab redraws its mark")
            row, worn = same_mark(app, tab)
            check(row is not None and row == worn, f"{what}: and the row with it")

        last = worn
        app.ask(f"nib.workspace.close('{tab}')")
        time.sleep(1.5)
        row, _ = pictures_of(app, tab)
        check(row == last, "the tab closed: the row keeps the last mark it showed")
    finally:
        if running is not None:
            running.terminate()
            try:
                running.wait(timeout=probe.GONE)
            except Exception:  # noqa: BLE001 - whatever it is, the app is ended
                running.kill()

    print()
    print("every check passed" if not failures else f"{len(failures)} failed: {failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
