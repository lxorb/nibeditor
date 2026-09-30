"""Does `capture_to_note` put a page into a note from an agent's own tab nobody sees - the
clip the clip button would write, a password field grey in the picture, a PDF only where
nothing secret would print - with nothing of nib in front of anybody?

The agent is a real client of `nib mcp` over pipes, paired the way any client is, against
a probe build started by `run_probe` (scripts/probe_app.py). Its pages are served here:

    clip        an agent tab on a page with a filled password field: the note's words are
                `browser_read`'s article words (the clip button's script and converter),
                with `source:`, and no field's value; the page never saw a script of
                nib's, nor a global of it
    screenshot  the same tab: a picture kept beside the note, the password field flat
                grey pixel for pixel and the field beside it untouched
    pdf         refused on that page (`password_field`), printed on a page with no field
    reader      the reader's own web tab of the same page: the same words, the same grey
    another     a tab of another agent's is not there, even with the reader's tabs granted
    log         every capture in the audit log, filed by its status and code

Every process of the app's family is watched from the moment it exists, as
scripts/mcp-probe.py watches it; a window on a screen or in front ends the drive with
exit 3.

    pnpm --dir apps/desktop tauri build --no-bundle --config \\
      '{"identifier":"ch.emilvinu.nib.probe.agent-capture","version":"99.0.0",
        "plugins":{"updater":{"endpoints":["https://127.0.0.1:9/latest.json"]}}}'
    python scripts/capture-probe.py --exe apps/desktop/src-tauri/target/release/nib.exe \\
        --identifier ch.emilvinu.nib.probe.agent-capture
"""

from __future__ import annotations

import argparse
import ctypes
import datetime
import http.server
import importlib.util
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any

import psutil
from PIL import Image

from probe_app import close_app, refuse_updating, run_probe

# mcp-probe.py's client, family watch and endpoint helpers, taken as they are: its name
# has a dash, so it is loaded by path rather than imported by name.
_spec = importlib.util.spec_from_file_location("mcp_probe", pathlib.Path(__file__).with_name("mcp-probe.py"))
assert _spec is not None and _spec.loader is not None
mcp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mcp)

#: Where this drive's pages listen: a range of its own beside mcp-probe's.
PORT_FROM = 23640
PORT_TO = 23659

CLIENT = {"name": "nib-capture-probe", "title": "Capture probe", "version": "1"}
OTHER = {"name": "nib-capture-probe-other", "title": "Capture probe other", "version": "1"}

SPACE = "Capture probe"

#: The grey a secret field is painted in (agents/page.rs `PAINTED`), and the red both
#: fields are drawn in so either colour is unmistakable.
GREY = (128, 128, 128)
RED = (255, 0, 0)

#: Where the two fields are, in CSS pixels, which a picture's pixels are one to one.
SECRET_BOX = (40, 20, 280, 60)
NAME_BOX = (40, 80, 280, 120)

user32 = ctypes.WinDLL("user32", use_last_error=True)

FIELDS = """<!doctype html><title>Field notes</title>
<style>
  body { margin: 0; font: 16px sans-serif; background: #fff }
  #secret, #name { position: absolute; left: 40px; width: 240px; height: 40px; box-sizing: border-box;
    background: #f00; color: #f00; border: 0; padding: 0; margin: 0; outline: 0; caret-color: #f00 }
  #secret { top: 20px }
  #name { top: 80px }
  article { margin-top: 160px; padding: 0 40px }
</style>
<article>
  <h1>Field notes</h1>
  <p>The heron stood in the shallows for most of an hour, and in all that time it moved
  twice: once to turn its head toward the reeds, and once to strike. The second time it
  came up with a fish no longer than a finger, swallowed it, and went back to standing.</p>
  <p>Read <a href="/plain">the plain page</a> next.</p>
  <form>
    <input id="name" name="name" value="ada-lovelace-name" autocomplete="off">
    <input id="secret" name="password" type="password" value="hunter2-secret" autocomplete="off">
  </form>
  <p id="seen">untouched</p>
</article>
<script>
  // What the page itself can see: a script of nib's run in the page's world would call
  // these, and a global of nib's would be one more name on the window.
  const before = new Set(Object.getOwnPropertyNames(window))
  const say = (what) => { document.getElementById('seen').textContent = what }
  for (const [proto, name] of [[Node.prototype, 'cloneNode'], [Document.prototype, 'querySelectorAll'], [Element.prototype, 'querySelectorAll']]) {
    const real = proto[name]
    proto[name] = function (...args) { say('touched by ' + name); return real.apply(this, args) }
  }
  setInterval(() => {
    const added = Object.getOwnPropertyNames(window).filter((one) => !before.has(one))
    if (added.length) say('globals ' + added.join(','))
  }, 50)
</script>
"""

PLAIN = """<!doctype html><title>Plain page</title>
<article><h1>Plain page</h1><p>Nothing on this page is anybody's secret. It is here to be
printed, which a page holding a filled password field is not.</p></article>
"""


def free_port() -> int:
    for port in range(PORT_FROM, PORT_TO + 1):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit(f"no port free in {PORT_FROM}-{PORT_TO}")


def serve(port: int) -> http.server.ThreadingHTTPServer:
    pages = {"/fields": FIELDS.encode(), "/plain": PLAIN.encode()}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - the base class names it
            body = pages.get(self.path.split("?")[0])
            self.send_response(200 if body else 404)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body or b"no")

        def log_message(self, *_args: object) -> None:
            return

    made = mcp.Server(("127.0.0.1", port), Handler)
    threading.Thread(target=made.serve_forever, daemon=True).start()
    return made


def words_of(note: str) -> str:
    """A clip's words under its front matter, without the line the page writes what it
    saw into, which a tab of the reader's and one of an agent's may say differently."""

    under = note.split("\n---\n", 1)[-1]
    return "\n".join(one for one in under.splitlines() if "touched" not in one and "globals" not in one)


def box_is(picture: Image.Image, box: tuple[int, int, int, int], colour: tuple[int, int, int]) -> tuple[bool, str]:
    """Whether every pixel inside a box, a pixel in from its edge, is one colour."""

    left, top, right, bottom = box
    wrong = 0
    seen: tuple[int, ...] = ()
    for y in range(top + 1, bottom - 1):
        for x in range(left + 1, right - 1):
            pixel = picture.getpixel((x, y))[:3]
            if pixel != colour:
                wrong += 1
                seen = pixel
    return wrong == 0, f"{wrong} of {(right - left - 2) * (bottom - top - 2)} pixels off" + (f", e.g. {seen}" if wrong else "")


class Drive(mcp.Drive):
    def __init__(self, exe: pathlib.Path, identifier: str, spaces: pathlib.Path, site: str) -> None:
        super().__init__(exe, identifier, spaces, site)
        self.space = spaces / SPACE
        self.timings: list[tuple[str, float]] = []
        #: The log is kept by day, so a run reads only its own lines.
        self.started_ms = int(time.time() * 1000)

    def capture(self, agent: Any, args: dict[str, Any]) -> tuple[dict[str, Any], float]:
        started = time.perf_counter()
        said = agent.call("capture_to_note", args)
        ms = (time.perf_counter() - started) * 1000
        self.timings.append((f"{args.get('as')} of {args['tab']}", ms))
        return said, ms

    def written(self, name: str) -> str:
        path = self.space / f"{name}.md"
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    def kept(self, text: str) -> pathlib.Path | None:
        """The file a note embeds, `![[...]]`, found in the space."""

        found = re.search(r"!\[\[([^\]]+)\]\]", text)
        if not found:
            return None
        named = pathlib.Path(found.group(1)).name
        return next(self.space.rglob(named), None)

    def pair(self, info: dict[str, str]) -> Any:
        agent = self.client(info)
        mcp.answer_pairing(self.folder, info["title"], allow=True)
        listed, _, tools = self.settled(agent, lambda now: "capture_to_note" in now and "browser_open" in now, 40)
        self.check(f"{info['title']} paired, capture_to_note listed", listed, f"{len(tools)} tools")
        return agent

    def opened(self, agent: Any, path: str) -> str:
        said = agent.call("browser_open", {"url": f"{self.site}{path}"})
        tab = mcp.contract(said).get("result", {}).get("tab", "")
        agent.call("browser_wait", {"tab": tab, "for": "load"})
        return tab

    def clip(self, agent: Any, tab: str) -> None:
        print("clip: an agent's own tab into a note", flush=True)
        said, ms = self.capture(agent, {"tab": tab, "as": "clip", "note": "Clip"})
        words = mcp.text(said)
        self.check("the clip is written", not said.get("isError"), f"{ms:.0f} ms: {words[:120]}")
        self.check("the answer is marked as the page's", words.startswith(f'<untrusted source="{self.site}/fields">'), words[:80])

        note = self.written("Clip")
        article = mcp.contract(agent.call("browser_read", {"tab": tab, "as": "article"})).get("result", {}).get("text", "")
        self.check("the note says where it came from", f"source: {self.site}/fields" in note, note[:160])
        self.check("the note's words are the article's words", bool(article) and note.endswith(article + "\n"), repr(article[:120]))
        self.check("the heading and the prose are there", "# Field notes" in note and "the heron stood" in note.lower())
        self.check("the link is absolute", f"({self.site}/plain)" in note)
        self.check("no field's value is in it", "hunter2" not in note and "ada-lovelace" not in note)

    def said_by_the_page(self, agent: Any, tab: str) -> str:
        seen = mcp.contract(agent.call("browser_read", {"tab": tab, "as": "text"})).get("result", {}).get("text", "")
        return next((one for one in seen.splitlines() if "touched" in one or "globals" in one), "").strip()

    def untouched(self, agent: Any, tab: str) -> None:
        line = self.said_by_the_page(agent, tab)
        self.check("the clip ran no script of nib's in the page and left no global", line == "untouched", line)

    def seen_by_the_picture(self, agent: Any, tab: str) -> None:
        # Not a check: the picture's secret scan is browser_screenshot's own, and runs in
        # the page's world for its frame (agents/page.rs `secrets`); said, so it is known.
        self.note("after the picture, the page says", self.said_by_the_page(agent, tab))

    def screenshot(self, agent: Any, tab: str, note: str) -> None:
        said, ms = self.capture(agent, {"tab": tab, "as": "screenshot", "note": note})
        self.check(f"{note}: the picture is written", not said.get("isError"), f"{ms:.0f} ms: {mcp.text(said)[:120]}")
        text = self.written(note)
        kept = self.kept(text)
        self.check(f"{note}: the note embeds a picture kept in the space", kept is not None and kept.suffix == ".png", text[-120:])
        if kept is None:
            return
        picture = Image.open(kept).convert("RGB")
        grey, why = box_is(picture, SECRET_BOX, GREY)
        self.check(f"{note}: the password field is grey", grey, why)
        red, why = box_is(picture, NAME_BOX, RED)
        self.check(f"{note}: the field beside it is as the page drew it", red, why)
        self.note(f"{note} picture", f"{picture.width}x{picture.height}, {kept.stat().st_size} bytes")

    def pdf(self, agent: Any, tab: str) -> None:
        print("pdf: never with a secret on the page", flush=True)
        said, ms = self.capture(agent, {"tab": tab, "as": "pdf", "note": "Refused"})
        words = mcp.text(said)
        self.check("a page holding a password is not printed", bool(said.get("isError")) and words.startswith("password_field"), f"{ms:.0f} ms: {words[:160]}")
        self.check("and nothing was written", not (self.space / "Refused.md").exists())

        agent.call("browser_navigate", {"tab": tab, "url": f"{self.site}/plain"})
        said, ms = self.capture(agent, {"tab": tab, "as": "pdf", "note": "Printed"})
        words = mcp.text(said)
        self.check("a plain page is printed", not said.get("isError"), f"{ms:.0f} ms: {words[:160]}")
        kept = self.kept(self.written("Printed"))
        body = kept.read_bytes() if kept else b""
        self.check("the note embeds a PDF kept in the space", body.startswith(b"%PDF"), f"{kept}: {len(body)} bytes")
        # The reader's paper, which is A4 until Settings says otherwise: 8.27 by 11.69
        # inches, in the PDF's points.
        sheet = re.search(rb"/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", body)
        size = (float(sheet.group(1)), float(sheet.group(2))) if sheet else (0.0, 0.0)
        self.check("on the reader's paper", abs(size[0] - 595.4) < 2 and abs(size[1] - 841.7) < 2, f"{size[0]:.1f} by {size[1]:.1f} points")
        self.check("its words are the page's", "# Plain page" in self.written("Printed") and "![[" in self.written("Printed"))

    def reader(self, agent: Any, url_file: str) -> None:
        print("reader: the reader's own tab of the same page", flush=True)
        opened = mcp.ask(self.folder, "open", {"path": url_file})
        self.check("the reader opens the page in a tab", bool(opened.get("ok")), str(opened)[:160])
        tab = ""
        until = time.monotonic() + 30
        while time.monotonic() < until and not tab:
            listed = mcp.contract(agent.call("browser_tabs")).get("result", {}).get("reader", [])
            tab = next((one["id"] for one in listed if one.get("url", "").endswith("/fields") and one.get("on_screen")), "")
            if not tab:
                time.sleep(0.5)
        self.check("browser_tabs lists it", bool(tab))
        if not tab:
            return
        time.sleep(1.5)
        said, ms = self.capture(agent, {"tab": tab, "as": "clip", "note": "Reader clip"})
        self.check("the reader's tab is clipped", not said.get("isError"), f"{ms:.0f} ms: {mcp.text(said)[:120]}")
        self.check(
            "into the words a clip of the agent's tab wrote",
            bool(self.written("Reader clip")) and words_of(self.written("Reader clip")) == words_of(self.written("Clip")),
            words_of(self.written("Reader clip"))[:160],
        )
        self.screenshot(agent, tab, "Reader shot")

    def another(self, agent: Any) -> None:
        print("another: a tab of another agent's", flush=True)
        other = self.pair(OTHER)
        theirs = self.opened(other, "/fields")
        said, _ = self.capture(agent, {"tab": theirs, "as": "clip", "note": "Theirs"})
        words = mcp.text(said)
        self.check("is not there, the reader's tabs granted or not", bool(said.get("isError")) and words.startswith("no_such_tab"), words[:160])
        self.check("and nothing was written", not (self.space / "Theirs.md").exists())
        other.call("browser_close", {"tab": theirs})
        other.close()

    def log(self) -> None:
        print("log: every capture, filed by its status", flush=True)
        day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
        lines = [
            one
            for one in mcp.window(self.folder, "agents_log", {"day": day})
            if one.get("verb") == "capture_to_note" and one.get("at", 0) >= self.started_ms
        ]
        statuses = [(one.get("status"), one.get("code")) for one in lines]
        self.check("each capture is one line", len(lines) == len(self.timings), f"{len(lines)} lines, {len(self.timings)} captures")
        self.check("a refused print is error (password_field)", ("error", "password_field") in statuses, str(statuses))
        self.check("another's tab is error (no_such_tab)", ("error", "no_such_tab") in statuses)
        self.check("the rest are ok", sum(1 for status, _ in statuses if status == "ok") == len(lines) - 2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--exe", required=True, type=pathlib.Path)
    parser.add_argument("--identifier", required=True)
    options = parser.parse_args()

    exe = options.exe.resolve()
    refuse_updating(exe)
    if not options.identifier.startswith("ch.emilvinu.nib.probe"):
        raise SystemExit("a probe's identifier starts with ch.emilvinu.nib.probe")

    folder = mcp.config_dir(options.identifier)
    if mcp.app_pid(folder, exe):
        raise SystemExit("the probe is running already")
    mcp.fresh(folder)

    port = free_port()
    site = serve(port)
    spaces = pathlib.Path(tempfile.mkdtemp(prefix="nib-capture-probe-"))
    (spaces / SPACE).mkdir()
    (spaces / SPACE / "Plan.md").write_text("# Plan\n\nRead about herons.\n", encoding="utf-8")
    (spaces / SPACE / "Herons.url").write_text(
        f"[InternetShortcut]\r\nURL=http://127.0.0.1:{port}/fields\r\nTitle=Field notes\r\n", encoding="utf-8"
    )
    drive = Drive(exe, options.identifier, spaces, f"http://127.0.0.1:{port}")
    front = user32.GetForegroundWindow()
    app: subprocess.Popen[bytes] | None = None
    try:
        app = run_probe(exe, env=drive.env, quiet=True)
        drive.family.add(app.pid)
        drive.watch_app()
        drive.window_up()

        agent = drive.pair(CLIENT)
        print("an agent's own tab, out of sight", flush=True)
        tab = drive.opened(agent, "/fields")
        drive.check("browser_open answers a tab", bool(tab))
        drive.clip(agent, tab)
        drive.untouched(agent, tab)
        print("screenshot: a password field grey", flush=True)
        drive.screenshot(agent, tab, "Shot")
        drive.seen_by_the_picture(agent, tab)
        drive.pdf(agent, tab)
        agent.call("browser_close", {"tab": tab})
        drive.reader(agent, "Herons.url")
        drive.another(agent)
        drive.log()
        drive.shut(agent)
    finally:
        if app is not None and not close_app(app):
            app.kill()
        drive.quit()
        site.shutdown()
        shutil.rmtree(spaces, ignore_errors=True)
    drive.check("the window in front never changed", user32.GetForegroundWindow() == front)
    for name, ms in drive.timings:
        print(f"  time  {name}: {ms:.0f} ms", flush=True)
    time.sleep(3)
    left = [
        one
        for one in psutil.process_iter(["exe", "cmdline"])
        if one.info["exe"] and pathlib.Path(one.info["exe"]).resolve() == exe
    ]
    drive.check("nothing of the drive is left running", not left, ", ".join(str(one.info["cmdline"]) for one in left))
    for one in left:
        one.kill()

    failed = [name for name, ok, _ in drive.results if not ok]
    print(f"\n{len(drive.results) - len(failed)} of {len(drive.results)} passed", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
