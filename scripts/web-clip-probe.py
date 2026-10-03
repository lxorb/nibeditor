"""A web tab's Clip, driven in a native Windows build: the page writes itself down in
nib's own world, and the window clips it with the clipper extension's extractor.

What it asks, against a news article served on the loopback (the extractor's own
fixture, packages/markdown/src/fixtures/news.html) with three things added to the page:
a password field holding a password, a field holding words, and a script that wraps
`cloneNode`, `querySelectorAll` and `getSelection` and writes on the page's root how
often anything called them.

* **`web_clip` answers a snapshot**: a doctype in front, the article in it, no script,
  no field's value and no password field.
* **The page never saw it**: a second snapshot carries the root's count as the first
  read left it, and it is nought - the reader ran in nib's world, where the page's
  wrappers are not the ones called (`web_tabs::web_clip`).
* **The Clip glyph writes the clipper's note**: `source:`, `title:` from the article's
  own name, `clipped:`, the page's tags, one heading, the article's words and none of
  the cookie banner, the navigation or the footer.
* **A selection wins**: on the same page with a paragraph selected by the page itself,
  the note is that paragraph and nothing else.

Nothing here presses a key or moves the mouse: the glyph is pressed in the app's own
page by the automation endpoint's `eval`, and every question to the page is the
crate's own command.

    python scripts/web-clip-probe.py --exe path/to/nib.exe --identifier ch.emilvinu.nib.probe.<name>

Build the exe as `scripts/probe_app.py` says. The launch is `run_probe`'s, off the
screen and without the keyboard.
"""

from __future__ import annotations

import argparse
import http.server
import importlib.util
import json
import pathlib
import re
import shutil
import sys
import threading
import time

from probe_app import close_app

HERE = pathlib.Path(__file__).resolve().parent
FIXTURE = HERE.parent / "packages" / "markdown" / "src" / "fixtures" / "news.html"


def borrowed(name: str, file: str):
    """Another drive's helpers, read from its file: the names have dashes in them."""

    spec = importlib.util.spec_from_file_location(name, HERE / file)
    if spec is None or spec.loader is None:
        raise SystemExit(f"could not read {file}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


switch = borrowed("switch", "web-switch-probe.py")

#: What the page adds to the article: two fields, and the wrappers that count.
ADDED = """
<form><input name="q" value="words somebody typed"><input type="password" value="hunter2"></form>
<script>
  (() => {
    let calls = 0
    const said = () => document.documentElement.setAttribute('data-calls', String(calls))
    for (const [owner, name] of [
      [Node.prototype, 'cloneNode'],
      [Element.prototype, 'querySelectorAll'],
      [Document.prototype, 'querySelectorAll'],
      [Window.prototype, 'getSelection'],
    ]) {
      const own = owner[name]
      owner[name] = function (...args) {
        const answer = own.apply(this, args)
        calls += 1
        said()
        return answer
      }
    }
    said()
    if (location.hash === '#select') {
      addEventListener('load', () => {
        const range = document.createRange()
        range.selectNodeContents(document.querySelectorAll('article p')[2])
        getSelection().removeAllRanges()
        getSelection().addRange(range)
      })
    }
  })()
</script>
"""


def article() -> bytes:
    html = FIXTURE.read_text(encoding="utf-8")
    return html.replace("</body>", ADDED + "</body>").encode()


def serve(port: int) -> http.server.ThreadingHTTPServer:
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = article()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    made = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    made.daemon_threads = True
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def clip(app, tab: str, selection: bool) -> dict[str, object]:
    said = app.ask(
        "(async () => { try { return JSON.stringify(await window.__TAURI_INTERNALS__.invoke("
        f"'web_clip', {{ tab: '{tab}', selection: {'true' if selection else 'false'} }})) }}"
        " catch (error) { return JSON.stringify({ error: String(error) }) } })()"
    )
    return said if isinstance(said, dict) else {"error": said}


def press_clip(app) -> object:
    return app.ask(
        "(() => { const glyph = document.querySelector('.webbar button[aria-label=\"Clip this page\"]');"
        " glyph?.click(); return JSON.stringify(!!glyph) })()"
    )


def newest_note(space: pathlib.Path, before: set[str], seconds: float = 20) -> tuple[str, str] | None:
    until = time.perf_counter() + seconds
    while time.perf_counter() < until:
        fresh = [one for one in space.glob("*.md") if one.name not in before]
        if fresh:
            time.sleep(0.5)
            return fresh[0].name, fresh[0].read_text(encoding="utf-8")
        time.sleep(0.25)
    return None


def main() -> int:
    if sys.platform != "win32":
        print("this probe drives a Windows build")
        return 0

    parsed = argparse.ArgumentParser()
    parsed.add_argument("--exe", required=True, type=pathlib.Path)
    parsed.add_argument("--identifier", default="ch.emilvinu.nib.probe")
    args = parsed.parse_args()

    switch.wipe(args.identifier)
    port = switch.free_port()
    server = serve(port)
    base = f"http://127.0.0.1:{port}"

    space = switch.spaces_root() / switch.SPACE
    shutil.rmtree(space, ignore_errors=True)
    space.mkdir(parents=True, exist_ok=True)
    (space / "Idea.md").write_text("# Idea\n\nA note.\n", encoding="utf-8")
    (space / "News.url").write_text(switch.shortcut(f"{base}/news/2026/lake.html", "News"), encoding="utf-8")

    failures: list[str] = []
    said: dict[str, object] = {}
    running = None

    def check(name: str, ok: bool, detail: object = "") -> None:
        said[name] = "ok" if ok else f"FAILED {detail}"
        if not ok:
            failures.append(name)

    try:
        running, app, _ = switch.launch(args.exe, args.identifier)
        if not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        switch.allow_eval(args.identifier)
        time.sleep(2)

        running, app, _ = switch.launch(args.exe, args.identifier, unlike=app.port)
        app.open("Idea.md", switch.SPACE)
        time.sleep(3)
        app.open("News.url")
        tab = None
        until = time.perf_counter() + 30
        while tab is None and time.perf_counter() < until:
            tabs = app.ask(switch.TABS)
            webs = [one for one in tabs if one.get("kind") == "web"] if isinstance(tabs, list) else []
            tab = str(webs[0]["id"]) if webs else None
            time.sleep(0.5)
        if tab is None or switch.until_live(app, tab, 30) is None:
            raise SystemExit("the web tab never opened")
        time.sleep(3)

        first = clip(app, tab, False)
        html = str(first.get("html", ""))
        check("web_clip answers a snapshot", html.startswith("<!DOCTYPE html>"), str(first)[:200])
        check("with the article in it", "the cantonal water office" in html, html[:200])
        check("and no script", "<script" not in html.lower())
        check("and no field's value", "hunter2" not in html and "words somebody typed" not in html)
        check("and no password field", 'type="password"' not in html)

        second = clip(app, tab, False)
        calls = re.search(r'data-calls="(\d+)"', str(second.get("html", "")))
        said["the page's own count after a read"] = calls.group(1) if calls else None
        check("the page never saw the read", calls is not None and calls.group(1) == "0", calls)

        before = {one.name for one in space.glob("*.md")}
        check("the Clip glyph is there", press_clip(app) is True)
        found = newest_note(space, before)
        if found is None:
            check("the Clip glyph writes a note", False, "nothing appeared")
        else:
            name, note = found
            said["the note"] = name
            check("named after the article", name == "Lake Zurich warms a full degree in a decade.md", name)
            check("source", f"source: {base}/news/2026/lake.html" in note, note[:300])
            check("clipped", re.search(r"^clipped: \d{4}-", note, re.M) is not None, note[:300])
            check("the page's tags", "tags: [Climate, Zurich, Lakes]" in note, note[:300])
            check("one heading", len(re.findall(r"^# ", note, re.M)) == 1, note[:400])
            check("the article's words", "the cantonal water office said on Friday" in note)
            for furniture in ["We use cookies", "Subscribe", "Privacy", "hunter2"]:
                check(f"none of {furniture!r}", furniture not in note)

        app.ask(
            "(async () => { await window.__TAURI_INTERNALS__.invoke('web_navigate', { tab: '"
            + tab
            + f"', url: '{base}/news/2026/lake.html#select' }}); return JSON.stringify(true) }})()"
        )
        app.ask(
            "(async () => { await window.__TAURI_INTERNALS__.invoke('web_step', { tab: '"
            + tab
            + "', step: 'reload' }); return JSON.stringify(true) })()"
        )
        time.sleep(4)
        before = {one.name for one in space.glob("*.md")}
        press_clip(app)
        found = newest_note(space, before)
        if found is None:
            check("a selection is clipped", False, "nothing appeared")
        else:
            _, note = found
            body = note.split("\n---\n", 1)[-1]
            check("a selection is the paragraph selected", "Warmer water holds less oxygen" in body, body[:300])
            check("and nothing else of the article", "cantonal water office" not in body, body[:300])
    finally:
        if running is not None and not close_app(running):
            running.terminate()
            running.wait(timeout=30)
        server.shutdown()

    print(json.dumps(said, indent=2, ensure_ascii=False))
    print("FAILED: " + ", ".join(failures) if failures else "all good")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
